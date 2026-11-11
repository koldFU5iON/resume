// GET  /api/internal/sponsor-register/import — daily Vercel Cron (vercel.json)
// POST /api/internal/sponsor-register/import — manual run
//
// Imports the UK register of licensed sponsors for the companies in jobs, then
// links jobs to companies (the backfill and safety net). Auth: CRON_SECRET bearer.

import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { runSponsorRegisterImport } from '@/modules/companies/import'
import { sweepJobCompanyLinks } from '@/modules/companies/match'

export const maxDuration = 300

/** Stop linking jobs with this much of maxDuration left. */
const LINK_RESERVE_MS = 20_000

async function run(request: Request) {
  const startedAt = Date.now()
  if (!isAuthorizedCronRequest(request)) return new NextResponse(null, { status: 401 })

  const result = await runSponsorRegisterImport()
  const linking = await sweepJobCompanyLinks({ deadline: startedAt + maxDuration * 1000 - LINK_RESERVE_MS })
  const status = result.status === 'failed' ? 500 : 200
  return NextResponse.json({ import: result, linking }, { status })
}

export function GET(request: Request) {
  return run(request)
}

export function POST(request: Request) {
  return run(request)
}
