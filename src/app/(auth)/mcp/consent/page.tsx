import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { getConsentDetails, oauthSearchParams } from '@/modules/mcp/consent'
import { ConsentForm } from './consent-form'

export default async function McpConsentPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = oauthSearchParams(await searchParams)
  const session = await getSession()
  if (!session) redirect(`/mcp/login?${params}`)

  let details
  try {
    details = await getConsentDetails(params, new Headers(await headers()))
  } catch {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Connection request expired</h1>
        <p className="text-sm text-muted-foreground">This request is invalid or has expired. Return to your AI app and connect again.</p>
        <Link href="/dashboard/settings/api-tokens" className="text-sm underline underline-offset-4">Back to connection settings</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="break-words text-2xl font-semibold">Connect {details.name}?</h1>
        <p className="break-words text-sm font-medium">Return address: {details.redirectHost}</p>
        <p className="text-sm text-muted-foreground">App names are supplied by the connecting app. Only approve access if you trust this return address.</p>
        <p className="break-words text-sm text-muted-foreground">Signed in as {session.user.email}</p>
      </div>
      <ConsentForm {...details} />
    </div>
  )
}
