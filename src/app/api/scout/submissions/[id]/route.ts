import { cookies } from 'next/headers'
import { getScoutSubmission, SCOUT_COOKIE_NAME, verifyScoutInvite } from '@/modules/scout-inbox/service'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rawToken = (await cookies()).get(SCOUT_COOKIE_NAME)?.value
  const invite = await verifyScoutInvite(rawToken)
  if (!invite) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Referrer-Policy': 'no-referrer' } })

  const { id } = await params
  const submission = await getScoutSubmission(invite.id, id)
  if (!submission) return Response.json({ error: 'Not found' }, { status: 404, headers: { 'Referrer-Policy': 'no-referrer' } })

  return Response.json({
    title: submission.title,
    company: submission.company,
    triageStatus: submission.triageStatus,
    verdict: submission.scoutVerdict,
    feedback: submission.scoutFeedback,
  }, { headers: { 'Referrer-Policy': 'no-referrer' } })
}
