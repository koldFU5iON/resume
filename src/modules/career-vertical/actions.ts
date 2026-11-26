'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { LLMError, type LLMErrorKind } from '@/modules/llm/errors'
import { runCareerVerticalAnalysis } from './analyse'
import { generateMasterCVContent } from './master-cv'
import type { CareerVerticalAnalysis } from './schema'
import { cvContentToDeskMarkdown } from '@/modules/writing-desk/from-cv-content'
import { landMasterCvDraft } from '@/modules/writing-desk/master'
import { getMasterCvDeskView } from '@/modules/writing-desk/queries'
import { MASTER_CV_HREF } from '@/modules/writing-desk/schema'

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
  | { ok: true; deskId: string }
  | { ok: false; error: 'no_vertical' | 'draft_exists' | 'invalid' | LLMErrorKind; message: string }

/**
 * Generates the master CV from the career vertical and lands it as a draft of
 * the master CV Writing Desk document (#469): the live master is never
 * overwritten, and a draft already waiting is never replaced (nothing is
 * generated or spent then). The owner accepts or discards it in the editor.
 */
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

  // Check before spending: a waiting draft would refuse the new one anyway.
  const existing = await getMasterCvDeskView(profile.id)
  if (existing?.draft) {
    return { ok: false, error: 'draft_exists', message: 'A master CV draft is already waiting for review. Accept or discard it first.' }
  }

  let content
  try {
    content = await generateMasterCVContent(profile.id, vertical)
  } catch (err) {
    if (err instanceof LLMError) return { ok: false, error: err.kind, message: err.message }
    throw err
  }

  const landed = await landMasterCvDraft(profile.id, cvContentToDeskMarkdown(content))
  if (!landed.ok) return { ok: false, error: landed.reason, message: landed.message }

  revalidatePath('/dashboard/career-vertical')
  revalidatePath(MASTER_CV_HREF)
  return { ok: true, deskId: landed.deskId }
}
