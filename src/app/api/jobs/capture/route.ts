// POST /api/jobs/capture
//
// Bearer-token authenticated endpoint for external tools (Hermes, bookmarklets,
// browser extensions, future MCP servers) to submit a job URL for processing
// without going through the dashboard UI.
//
//   curl -X POST https://resume.devonstanton.com/api/jobs/capture \
//     -H 'Authorization: Bearer rsm_xxx' \
//     -H 'Content-Type: application/json' \
//     -d '{"url":"https://...","notes":"saw this on linkedin"}'

import { NextResponse } from 'next/server'
import * as z from 'zod'
import { verifyBearerHeader } from '@/modules/api-tokens/service'
import { captureJobFromUrl } from '@/modules/jobs/capture'

const RequestSchema = z.object({
  url: z.string().url({ message: 'url must be a valid URL' }),
  notes: z.string().max(2000).optional(),
  applicationSource: z.enum(['cold', 'referral', 'recruiter_outreach']).optional(),
  dedupeStrategy: z.enum(['return_existing', 'create_anyway']).optional(),
})

const BASE_URL =
  process.env.BETTER_AUTH_URL?.replace(/\/$/, '') ?? 'https://resume.devonstanton.com'

export async function POST(request: Request) {
  const auth = await verifyBearerHeader(request.headers.get('authorization'))
  if (!auth) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Missing or invalid Bearer token' },
      { status: 401 },
    )
  }

  if (!auth.scopes.includes('capture')) {
    return NextResponse.json(
      { error: 'forbidden', message: 'Token lacks the capture scope' },
      { status: 403 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON' },
      { status: 400 },
    )
  }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: 'Request body did not match schema',
        issues: parsed.error.issues.map(i => ({ path: i.path, message: i.message })),
      },
      { status: 400 },
    )
  }

  const result = await captureJobFromUrl(auth.profileId, parsed.data)
  if (!result.ok) {
    return NextResponse.json(
      { error: 'capture_failed', message: result.error },
      { status: result.status },
    )
  }

  // Stable response shape — agents key off `id`, `created`, `reviewUrl`, and `duplicate`.
  return NextResponse.json(
    {
      id: result.job.id,
      created: result.created,
      title: result.job.title,
      company: result.job.company,
      reviewUrl: `${BASE_URL}/dashboard/job-applications/view/${result.job.id}`,
      duplicate: result.duplicate
        ? {
            isDuplicate: true,
            existingId: result.duplicate.id,
            status: result.duplicate.status,
            archivedAt: result.duplicate.archivedAt,
          }
        : { isDuplicate: false },
      extraction: result.extraction,
    },
    { status: result.created ? 201 : 200 },
  )
}
