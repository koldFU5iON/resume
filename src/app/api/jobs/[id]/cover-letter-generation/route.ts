// POST /api/jobs/[id]/cover-letter-generation  suggest angles for a cover letter (phase 1)
//   body (optional JSON): { fresh?: boolean }  fresh: new angles even when some are waiting for a choice
//   → 202 { runId, existing: false }            started: Gather → Angles, then the run waits at awaiting_choice
//   → 200 { runId, existing: true, status }     the job already has an open run (processing or waiting)
//   → 409 { code: 'draft_exists', documentId }  the job's cover letter already has a draft waiting; nothing started or spent
//   → 400 invalid body · 404 not your job · 429 too many runs · 401 not signed in
//
// Session cookie only. Runs in after() on the user's own LLM key. Read the run
// (angles, status) with GET /api/jobs/[id]/cover-letter-generation/[runId];
// choose with POST .../[runId]/choice. Spec: docs/cover-letter-generation.md.

import { NextResponse, type NextRequest } from 'next/server'
import { requireProfile } from '@/lib/session'
import { startCoverLetter } from '@/modules/cover-letter-generation/pipeline'
import { CONCURRENCY_PER_PROFILE, StartBodySchema } from '@/modules/cover-letter-generation/schema'

// Keep in sync with ROUTE_MAX_DURATION_S (src/modules/cover-letter-generation/schema.ts); segment config must be a literal.
export const maxDuration = 300

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  let profileId: string
  try {
    profileId = (await requireProfile()).profile.id
  } catch {
    return NextResponse.json({ error: 'unauthorized', message: 'Sign in to write a cover letter' }, { status: 401 })
  }
  let raw: unknown = {}
  const text = await request.text().catch(() => '')
  if (text.trim()) {
    try { raw = JSON.parse(text) } catch {
      return NextResponse.json({ error: 'invalid', message: 'The request body must be JSON.' }, { status: 400 })
    }
  }
  const body = StartBodySchema.safeParse(raw)
  if (!body.success) return NextResponse.json({ error: 'invalid', message: 'Body options are { fresh?: boolean }.' }, { status: 400 })

  const { id } = await params
  const result = await startCoverLetter(profileId, id, body.data)
  switch (result.kind) {
    case 'started': return NextResponse.json({ runId: result.runId, existing: false }, { status: 202 })
    case 'existing': return NextResponse.json({ runId: result.runId, existing: true, status: result.status }, { status: 200 })
    case 'draft_exists':
      return NextResponse.json(
        { code: 'draft_exists', error: 'draft_exists', documentId: result.documentId, message: 'This job’s cover letter already has a draft waiting. Open it, or discard it, then try again.' },
        { status: 409 },
      )
    case 'not_found': return NextResponse.json({ error: 'not_found', message: 'Job not found' }, { status: 404 })
    case 'limit':
      return NextResponse.json({ error: 'limit', message: `${CONCURRENCY_PER_PROFILE} cover letters are already being written. Try again when one finishes.` }, { status: 429 })
  }
}
