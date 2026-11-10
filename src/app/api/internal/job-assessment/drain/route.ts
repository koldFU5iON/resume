// POST /api/internal/job-assessment/drain
//
// Queue continuation (src/modules/job-assessment/continuation.ts): a drain
// that ran out of time or runs with rows still queued calls this route with a
// short-lived signed token; it answers 202 at once and drains that profile's
// queue in after() with a fresh time budget. Not for external callers.

import { after, NextResponse } from 'next/server'
import { verifyContinuationHeader } from '@/modules/job-assessment/continuation'
import { assessmentMaybeEnabled, DRAIN_TIME_BUDGET_MS, drainProfileQueue } from '@/modules/job-assessment/queue'

// The drain runs in after() within this limit; keep in sync with
// ROUTE_MAX_DURATION_S in src/modules/job-assessment/queue.ts.
export const maxDuration = 300

export async function POST(request: Request) {
  const requestStartedAt = Date.now()
  const claims = verifyContinuationHeader(request.headers.get('authorization'))
  if (!claims) return new NextResponse(null, { status: 401 })

  // Kill switch: a chain stops as soon as the feature is switched off.
  if (assessmentMaybeEnabled()) {
    after(() =>
      drainProfileQueue(claims.profileId, {
        deadline: requestStartedAt + DRAIN_TIME_BUDGET_MS,
        continuation: claims.hop,
      }),
    )
  }
  return new NextResponse(null, { status: 202 })
}
