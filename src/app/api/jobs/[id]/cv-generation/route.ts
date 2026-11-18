// POST /api/jobs/[id]/cv-generation  start a CV generation run
//   → 202 { runId, existing: false }   started
//   → 200 { runId, existing: true }    a run of this job is already active
//   → 404 not your job · 429 too many runs · 401 not signed in
//
// Session cookie only. The run executes in after()
// (src/modules/cv-generation/run-pipeline.ts) on the user's own LLM key. Until
// review and draft creation exist this starts a preview run (gather through
// assemble: the assembled CV is stored on the run, no draft is created). A missing key or job description is not refused here: the run ends
// failed and the log page says why. Spec: docs/cv-generation.md.

import { NextResponse, type NextRequest } from 'next/server'
import { requireProfile } from '@/lib/session'
import { CV_GENERATION_CONCURRENCY_PER_PROFILE } from '@/modules/cv-generation/schema'
import { startCvGeneration } from '@/modules/cv-generation/run-pipeline'

// The run executes in after() within this limit. Route segment config must be a literal:
// keep in sync with CV_GENERATION_ROUTE_MAX_DURATION_S in src/modules/cv-generation/schema.ts.
export const maxDuration = 300

type Params = { params: Promise<{ id: string }> }

export async function POST(_request: NextRequest, { params }: Params) {
  let profileId: string
  try {
    profileId = (await requireProfile()).profile.id
  } catch {
    return NextResponse.json({ error: 'unauthorized', message: 'Sign in to generate a CV' }, { status: 401 })
  }

  const { id } = await params
  const result = await startCvGeneration(profileId, id, { stopAfter: 'assembling' })
  switch (result.kind) {
    case 'started':
      return NextResponse.json({ runId: result.runId, existing: false }, { status: 202 })
    case 'existing':
      return NextResponse.json({ runId: result.runId, existing: true }, { status: 200 })
    case 'not_found':
      return NextResponse.json({ error: 'not_found', message: 'Job not found' }, { status: 404 })
    case 'limit':
      return NextResponse.json(
        { error: 'limit', message: `${CV_GENERATION_CONCURRENCY_PER_PROFILE} CV generations are already running. Try again when one finishes.` },
        { status: 429 },
      )
  }
}
