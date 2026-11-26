// POST /api/jobs/[id]/cover-letter-generation/[runId]/choice  write the letter from the owner's choice (phase 2)
//   body: { angle: { index } | { custom }, answers?: [{ topic, question, answer }], tone, length, remember? }
//   → 202 { runId }                              started: Write → Review → Land (a writing desk draft)
//   → 409 { code: 'not_waiting', status }        the run isn't waiting for a choice (already chosen, finished, expired)
//   → 409 { code: 'draft_exists', documentId }   the job's cover letter already has a draft waiting; nothing spent
//   → 400 invalid choice · 404 not your run · 429 too many runs · 401 not signed in
//
// Session cookie only. With remember (default true) the tone, length and reusable answers
// (why now, motivation) become the picker's defaults next time. Spec: docs/cover-letter-generation.md.

import { NextResponse, type NextRequest } from 'next/server'
import { requireProfile } from '@/lib/session'
import { chooseCoverLetterAngle } from '@/modules/cover-letter-generation/pipeline'
import { CONCURRENCY_PER_PROFILE } from '@/modules/cover-letter-generation/schema'

// Keep in sync with ROUTE_MAX_DURATION_S (src/modules/cover-letter-generation/schema.ts).
export const maxDuration = 300

type Params = { params: Promise<{ id: string; runId: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  let profileId: string
  try {
    profileId = (await requireProfile()).profile.id
  } catch {
    return NextResponse.json({ error: 'unauthorized', message: 'Sign in to write a cover letter' }, { status: 401 })
  }
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'invalid', message: 'The request body must be JSON.' }, { status: 400 })
  }
  const { id, runId } = await params
  const result = await chooseCoverLetterAngle(profileId, id, runId, body)
  switch (result.kind) {
    case 'started': return NextResponse.json({ runId: result.runId }, { status: 202 })
    case 'invalid': return NextResponse.json({ error: 'invalid', message: result.message }, { status: 400 })
    case 'not_found': return NextResponse.json({ error: 'not_found', message: 'Run not found' }, { status: 404 })
    case 'not_waiting':
      return NextResponse.json({ code: 'not_waiting', error: 'not_waiting', status: result.status, message: 'These angles are no longer waiting for a choice. Start again for fresh suggestions.' }, { status: 409 })
    case 'draft_exists':
      return NextResponse.json({ code: 'draft_exists', error: 'draft_exists', documentId: result.documentId, message: 'This job’s cover letter already has a draft waiting. Open it, or discard it, then try again.' }, { status: 409 })
    case 'limit':
      return NextResponse.json({ error: 'limit', message: `${CONCURRENCY_PER_PROFILE} cover letters are already being written. Try again when one finishes.` }, { status: 429 })
  }
}
