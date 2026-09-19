import { NextResponse } from 'next/server'
import { SCOUT_COOKIE_NAME, verifyScoutInvite } from '@/modules/scout-inbox/service'

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invite = await verifyScoutInvite(token)
  if (!invite) return new NextResponse('Invite not found', { status: 404, headers: { 'Referrer-Policy': 'no-referrer' } })

  const response = NextResponse.redirect(new URL('/scout', request.url))
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.cookies.set(SCOUT_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/scout',
    maxAge: invite.expiresAt
      ? Math.max(0, Math.floor((invite.expiresAt.getTime() - Date.now()) / 1000))
      : 60 * 60 * 24 * 30,
  })
  return response
}
