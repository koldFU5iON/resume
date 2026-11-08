import { redirect } from 'next/navigation'
import { oauthResumePath, oauthSearchParams } from '@/modules/mcp/consent'

export default async function McpLoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const callbackUrl = oauthResumePath(oauthSearchParams(await searchParams))
  redirect(`/sign-in?${new URLSearchParams({ callbackUrl })}`)
}
