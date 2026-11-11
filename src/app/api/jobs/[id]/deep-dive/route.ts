// POST /api/jobs/[id]/deep-dive  start a deep dive  → 202 { deepDiveId }
// GET  /api/jobs/[id]/deep-dive  newest run: status, stage, report when complete
//
// Session cookie or a bearer token with the `deep-dive:run` scope. The run
// itself executes in after() (src/modules/deep-dive/run.ts) and is billed to
// the user's own LLM key. Spec: docs/superpowers/specs/2026-11-11-job-deep-dive-design.md §8.

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/session'
import { verifyBearerHeader } from '@/modules/api-tokens/service'
import { getLatestDeepDive } from '@/modules/deep-dive/queries'
import { startDeepDive } from '@/modules/deep-dive/run'

// The run executes in after() within this limit; keep in sync with
// DEEP_DIVE_ROUTE_MAX_DURATION_S in src/modules/deep-dive/schema.ts.
export const maxDuration = 300

type Params = { params: Promise<{ id: string }> }

/** The caller's profile id: a bearer token with deep-dive:run, else the session. */
async function callerProfileId(request: NextRequest): Promise<string | null | 'forbidden'> {
  const header = request.headers.get('authorization')
  if (header) {
    const token = await verifyBearerHeader(header)
    if (!token) return null
    return token.scopes.includes('deep-dive:run') ? token.profileId : 'forbidden'
  }
  const session = await getSession()
  if (!session) return null
  const profile = await prisma.profile.findUnique({ where: { userId: session.user.id }, select: { id: true } })
  return profile?.id ?? null
}

function authError(who: null | 'forbidden') {
  return who === 'forbidden'
    ? NextResponse.json({ error: 'forbidden', message: 'Token lacks the deep-dive:run scope' }, { status: 403 })
    : NextResponse.json({ error: 'unauthorized', message: 'Sign in or send a valid Bearer token' }, { status: 401 })
}

export async function POST(request: NextRequest, { params }: Params) {
  const [{ id }, who] = await Promise.all([params, callerProfileId(request)])
  if (who === null || who === 'forbidden') return authError(who)

  const result = await startDeepDive(who, id)
  switch (result.kind) {
    case 'started':
      return NextResponse.json({ deepDiveId: result.deepDiveId, existing: false }, { status: 202 })
    case 'existing':
      return NextResponse.json({ deepDiveId: result.deepDiveId, existing: true }, { status: 202 })
    case 'not_found':
      return NextResponse.json({ error: 'not_found', message: 'Job not found' }, { status: 404 })
    case 'no_description':
      return NextResponse.json({ error: 'no_description', message: 'Add a job description first' }, { status: 422 })
    case 'no_llm_key':
      return NextResponse.json({ error: 'no_llm_key', message: 'Add an LLM API key in Settings → LLM' }, { status: 422 })
    case 'limit':
      return NextResponse.json(
        { error: 'limit', message: 'Two deep dives are already running. Try again when one finishes.' },
        { status: 429 },
      )
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  const [{ id }, who] = await Promise.all([params, callerProfileId(request)])
  if (who === null || who === 'forbidden') return authError(who)

  const view = await getLatestDeepDive(who, id)
  if (!view) return NextResponse.json({ error: 'not_found', message: 'No deep dive for this job' }, { status: 404 })
  return NextResponse.json(view)
}
