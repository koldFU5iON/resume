// POST /api/jobs/[id]/cv-generation  start a CV generation run
//   body (optional JSON): { fresh?: boolean, review?: boolean }
//     fresh: true  → a new Brief and Select even when nothing changed (otherwise the stored ones are reused)
//     review: false → skip the Review call; the CV lands unreviewed
//   → 202 { runId, existing: false }   started
//   → 200 { runId, existing: true }    a run of this job is already active
//   → 409 { code: 'draft_exists', documentId }  the job's CV document already has a draft; nothing started or spent
//   → 400 invalid body · 404 not your job · 429 too many runs · 401 not signed in
//
// Session cookie only. The run executes in after()
// (src/modules/cv-generation/run-pipeline.ts) on the user's own LLM key:
// Gather → Brief → Select → Write → Assemble → Review → Land. The CV lands as a
// writing desk DRAFT the owner accepts or discards; nothing live is overwritten.
// A missing key or job description is not refused here: the run ends
// failed and the log page says why. Spec: docs/cv-generation.md.

import { NextResponse, type NextRequest } from 'next/server'
import { requireProfile } from '@/lib/session'
import { CV_GENERATION_CONCURRENCY_PER_PROFILE, StartCvGenerationBodySchema } from '@/modules/cv-generation/schema'
import { startCvGeneration } from '@/modules/cv-generation/run-pipeline'

// The run executes in after() within this limit. Route segment config must be a literal:
// keep in sync with CV_GENERATION_ROUTE_MAX_DURATION_S in src/modules/cv-generation/schema.ts.
export const maxDuration = 300

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  let profileId: string
  try {
    profileId = (await requireProfile()).profile.id
  } catch {
    return NextResponse.json({ error: 'unauthorized', message: 'Sign in to generate a CV' }, { status: 401 })
  }

  // The body is optional: no body (or an empty one) means the defaults.
  let raw: unknown = {}
  const text = await request.text().catch(() => '')
  if (text.trim()) {
    try {
      raw = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: 'invalid', message: 'The request body must be JSON.' }, { status: 400 })
    }
  }
  const body = StartCvGenerationBodySchema.safeParse(raw)
  if (!body.success) {
    return NextResponse.json({ error: 'invalid', message: 'Body options are { fresh?: boolean, review?: boolean }.' }, { status: 400 })
  }

  const { id } = await params
  const result = await startCvGeneration(profileId, id, body.data)
  switch (result.kind) {
    case 'started':
      return NextResponse.json({ runId: result.runId, existing: false }, { status: 202 })
    case 'existing':
      return NextResponse.json({ runId: result.runId, existing: true }, { status: 200 })
    case 'draft_exists':
      return NextResponse.json(
        { code: 'draft_exists', error: 'draft_exists', documentId: result.documentId, message: 'This job’s CV document already has a draft waiting. Open it, or discard it, then generate again.' },
        { status: 409 },
      )
    case 'not_found':
      return NextResponse.json({ error: 'not_found', message: 'Job not found' }, { status: 404 })
    case 'limit':
      return NextResponse.json(
        { error: 'limit', message: `${CV_GENERATION_CONCURRENCY_PER_PROFILE} CV generations are already running. Try again when one finishes.` },
        { status: 429 },
      )
  }
}
