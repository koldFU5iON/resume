// GET /api/jobs/[id]/cover-letter-generation/[runId]  read a cover letter run
//   → 200 { run, defaults }  run: status (stale and expired runs read as failed), angles and questions,
//     choice, letter, review, log, the document it landed in. defaults: the remembered tone, length and
//     reusable answers the angle picker starts from.
//   → 404 not your run (or not this job's) · 401 not signed in
//
// Session cookie only. The picker polls this while angles are being suggested.

import { NextResponse } from 'next/server'
import { requireProfile } from '@/lib/session'
import { getCoverLetterRun, getPickerDefaults } from '@/modules/cover-letter-generation/queries'

type Params = { params: Promise<{ id: string; runId: string }> }

export async function GET(_request: Request, { params }: Params) {
  let profileId: string
  try {
    profileId = (await requireProfile()).profile.id
  } catch {
    return NextResponse.json({ error: 'unauthorized', message: 'Sign in to read this' }, { status: 401 })
  }
  const { id, runId } = await params
  const [run, defaults] = await Promise.all([getCoverLetterRun(profileId, runId), getPickerDefaults(profileId)])
  if (!run || run.jobApplicationId !== id) return NextResponse.json({ error: 'not_found', message: 'Run not found' }, { status: 404 })
  return NextResponse.json({ run, defaults })
}
