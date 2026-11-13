// src/modules/interview-prep/ai-actions.ts
'use server'

import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { complete } from '@/modules/llm/client'
import { LLMError, type LLMErrorKind } from '@/modules/llm/errors'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { insertAiBlock } from './actions'

type AIResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'no_content' | LLMErrorKind; message: string }

const DOC_SYSTEM = `You are a career coach helping a candidate prepare for a job interview.
You are given the candidate's career profile, a document from the company (interview pack, process guide, values doc, etc.), and the role they are interviewing for.
Surface insights from the document that are specifically relevant to THIS candidate for THIS role. Ignore generic boilerplate.
Focus on: what the company/interviewer actually cares about, how this candidate's experience connects to those priorities, and anything the candidate should be prepared for.
Write in clear, direct prose. Be specific — reference the candidate's actual experience. Format as markdown.`

const INTERVIEWER_SYSTEM = `You are a career coach helping a candidate prepare for a job interview.
You are given the candidate's career profile, an interviewer's LinkedIn profile or background notes, and the role being interviewed for.
Analyse this interviewer to help the candidate prepare. Cover:
- Who they are and their professional background
- What they likely care about and value based on their career trajectory
- The kinds of questions they are likely to ask or areas they will probe
- How the candidate's specific experience connects to this person's background and interests
Be specific and actionable. Reference the candidate's actual background. Format as markdown with clear sections.`

export async function analyseDocument(
  documentId: string,
  noteId: string,
): Promise<AIResult> {
  const { profile } = await requireProfile()

  const doc = await prisma.prepDocument.findFirst({
    where: { id: documentId, profileId: profile.id },
    select: { id: true, name: true, content: true, session: { select: { title: true, company: true, jobTitle: true, jobApplicationId: true } } },
  })
  if (!doc) return { ok: false, error: 'not_found', message: 'Document not found.' }
  if (!doc.content.trim()) return { ok: false, error: 'no_content', message: 'Document has no text content to analyse.' }

  const snapshot = await buildProfileSnapshot(profile.id)
  const profileText = serializeProfileForLLM(snapshot)
  const role = [doc.session.jobTitle, doc.session.company].filter(Boolean).join(' at ') || doc.session.title

  const prompt = `Candidate profile:\n${profileText}\n\nRole: ${role}\n\nDocument (${doc.name}):\n${doc.content}`

  try {
    const result = await complete(profile.id, prompt, {
      feature: 'interview-prep-doc-analysis',
      attribution: { jobApplicationId: doc.session.jobApplicationId },
      system: DOC_SYSTEM,
    })
    const content = result.text

    await prisma.prepDocument.update({
      where: { id: documentId },
      data: { aiAnalysis: { content }, aiAnalysedAt: new Date() },
    })

    await insertAiBlock(noteId, {
      title: `✦ ${doc.name}`,
      content,
      sourceDocIds: [documentId],
    })

    return { ok: true }
  } catch (err) {
    if (err instanceof LLMError) return { ok: false, error: err.kind, message: err.message }
    throw err
  }
}

export async function analyseInterviewer(
  interviewerId: string,
  noteId: string,
): Promise<AIResult> {
  const { profile } = await requireProfile()

  const interviewer = await prisma.prepInterviewer.findFirst({
    where: { id: interviewerId, profileId: profile.id },
    select: {
      id: true, name: true, role: true, linkedInText: true, notes: true,
      session: { select: { title: true, company: true, jobTitle: true, jobApplicationId: true } },
    },
  })
  if (!interviewer) return { ok: false, error: 'not_found', message: 'Interviewer not found.' }

  const rawText = [interviewer.linkedInText, interviewer.notes].filter(Boolean).join('\n\n')
  if (!rawText.trim()) return { ok: false, error: 'no_content', message: 'No LinkedIn profile or notes found for this interviewer.' }

  const snapshot = await buildProfileSnapshot(profile.id)
  const profileText = serializeProfileForLLM(snapshot)
  const role = [interviewer.session.jobTitle, interviewer.session.company].filter(Boolean).join(' at ') || interviewer.session.title
  const interviewerLabel = [interviewer.name, interviewer.role].filter(Boolean).join(', ')

  const prompt = `Candidate profile:\n${profileText}\n\nRole: ${role}\n\nInterviewer — ${interviewerLabel}:\n${rawText}`

  try {
    const result = await complete(profile.id, prompt, {
      feature: 'interview-prep-interviewer-analysis',
      attribution: { jobApplicationId: interviewer.session.jobApplicationId },
      system: INTERVIEWER_SYSTEM,
    })
    const content = result.text

    await prisma.prepInterviewer.update({
      where: { id: interviewerId },
      data: { aiAnalysis: { content }, aiAnalysedAt: new Date() },
    })

    await insertAiBlock(noteId, {
      title: `✦ ${interviewer.name}`,
      content,
      sourceInterviewerIds: [interviewerId],
    })

    return { ok: true }
  } catch (err) {
    if (err instanceof LLMError) return { ok: false, error: err.kind, message: err.message }
    throw err
  }
}

export async function analyseAllDocuments(
  sessionId: string,
  noteId: string,
): Promise<{ ok: true; count: number } | { ok: false; error: LLMErrorKind; message: string }> {
  const { profile } = await requireProfile()

  const docs = await prisma.prepDocument.findMany({
    where: { sessionId, profileId: profile.id, aiAnalysedAt: null },
    select: { id: true },
  })

  let count = 0
  for (const doc of docs) {
    const result = await analyseDocument(doc.id, noteId)
    if (!result.ok && result.error !== 'no_content' && result.error !== 'not_found') {
      return { ok: false, error: result.error, message: result.message }
    }
    if (result.ok) count++
  }

  return { ok: true, count }
}
