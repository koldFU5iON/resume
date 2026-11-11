import { requireProfile } from '@/lib/session'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'

export async function GET(request: Request) {
  let profileId: string
  try {
    const { profile } = await requireProfile()
    profileId = profile.id
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') ?? 'md'

  const snapshot = await buildProfileSnapshot(profileId)

  if (format === 'json') {
    return new Response(JSON.stringify(snapshot, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="profile.json"',
      },
    })
  }

  return new Response(serializeProfileForLLM(snapshot, { pii: 'include' }), {
    headers: {
      'Content-Type': 'text/markdown',
      'Content-Disposition': 'attachment; filename="profile.md"',
    },
  })
}
