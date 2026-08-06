'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { LLMError, type LLMErrorKind } from '@/modules/llm/errors'
import { runCareerVerticalAnalysis } from './analyse'
import { generateMasterCVContent } from './master-cv'
import type { CareerVerticalAnalysis } from './schema'

type AnalyseResult =
  | { ok: true; analysis: CareerVerticalAnalysis }
  | { ok: false; error: 'no_jobs' | LLMErrorKind; message: string }

export async function analyseCareerVertical(jobIds: string[]): Promise<AnalyseResult> {
  const { profile } = await requireProfile()

  const ids = jobIds.filter(Boolean)
  if (ids.length === 0) {
    return {
      ok: false,
      error: 'no_jobs',
      message: 'Select at least one job with a description to analyse.',
    }
  }

  // Flip status to analysing so the page can show progress while the LLM runs.
  await prisma.careerVertical.upsert({
    where: { profileId: profile.id },
    update: { status: 'analysing' },
    create: { profileId: profile.id, status: 'analysing' },
  })
  revalidatePath('/dashboard/career-vertical')

  try {
    const analysis = await runCareerVerticalAnalysis(profile.id, ids)
    revalidatePath('/dashboard/career-vertical')
    return { ok: true, analysis }
  } catch (err) {
    await prisma.careerVertical
      .update({ where: { profileId: profile.id }, data: { status: 'failed' } })
      .catch(() => {})
    revalidatePath('/dashboard/career-vertical')
    if (err instanceof LLMError) return { ok: false, error: err.kind, message: err.message }
    return {
      ok: false,
      error: 'no_jobs',
      message: err instanceof Error ? err.message : 'Career vertical analysis failed.',
    }
  }
}

type GenerateMasterCVResult =
  | { ok: true; cvId: string }
  | { ok: false; error: 'no_vertical' | LLMErrorKind; message: string }

export async function generateMasterCV(): Promise<GenerateMasterCVResult> {
  const { profile } = await requireProfile()

  const vertical = await prisma.careerVertical.findUnique({ where: { profileId: profile.id } })
  if (!vertical || vertical.status !== 'ready' || !vertical.thesis) {
    return {
      ok: false,
      error: 'no_vertical',
      message: 'Run a career vertical analysis before generating a master CV.',
    }
  }

  const template = await prisma.cVTemplate.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      name: 'Default',
      description: 'Standard CV template',
      isDefault: true,
      isBuiltIn: true,
    },
    select: { id: true },
  })

  // One master per career vertical. Regenerate the existing document rather
  // than stacking duplicates every time the button is pressed.
  const existing = await prisma.cVDocument.findFirst({
    where: { profileId: profile.id, jobApplicationId: null, careerVerticalId: vertical.id },
    select: { id: true },
  })

  const doc =
    existing ??
    (await prisma.cVDocument.create({
      data: {
        profileId: profile.id,
        careerVerticalId: vertical.id,
        jobApplicationId: null,
        templateId: template.id,
        generatedContent: '{}',
        status: 'generating',
        jobTitle: 'Master CV',
      },
    }))

  try {
    await prisma.cVDocument.update({ where: { id: doc.id }, data: { status: 'generating' } })
    const content = await generateMasterCVContent(profile.id, vertical)
    await prisma.cVDocument.update({
      where: { id: doc.id },
      data: { generatedContent: JSON.stringify(content), status: 'draft' },
    })
  } catch (err) {
    await prisma.cVDocument
      .update({ where: { id: doc.id }, data: { status: 'failed' } })
      .catch(() => {})
    if (err instanceof LLMError) return { ok: false, error: err.kind, message: err.message }
    throw err
  }

  revalidatePath('/dashboard/career-vertical')
  revalidatePath('/dashboard/cv-builder')
  return { ok: true, cvId: doc.id }
}
