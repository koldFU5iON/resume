import { after } from 'next/server'
import * as z from 'zod'
import { cookies } from 'next/headers'
import { SCOUT_COOKIE_NAME, submitScoutJob, verifyScoutInvite } from '@/modules/scout-inbox/service'
import { triageScoutSubmission } from '@/modules/scout-inbox/triage'

const RequestSchema = z.object({
  url: z.string().url(),
  note: z.string().max(500).optional(),
})

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  const expected = process.env.BETTER_AUTH_URL?.replace(/\/$/, '') ?? new URL(request.url).origin
  return origin === expected
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: 'Invalid origin' }, { status: 403, headers: { 'Referrer-Policy': 'no-referrer' } })

  const rawToken = (await cookies()).get(SCOUT_COOKIE_NAME)?.value
  const invite = await verifyScoutInvite(rawToken)
  if (!invite) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Referrer-Policy': 'no-referrer' } })

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400, headers: { 'Referrer-Policy': 'no-referrer' } })

  const result = await submitScoutJob(invite.id, invite.profileId, parsed.data)
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status, headers: { 'Referrer-Policy': 'no-referrer' } })

  if (result.created && result.submissionId) {
    after(() => triageScoutSubmission(result.submissionId!))
  }

  return Response.json(result, {
    status: result.created ? 202 : 200,
    headers: { 'Referrer-Policy': 'no-referrer' },
  })
}
