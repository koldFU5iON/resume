'use client'

import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

export function ConsentForm({ scopes, oauthQuery }: { scopes: string[]; oauthQuery: string }) {
  const [allowEditing, setAllowEditing] = useState(scopes.includes('mcp:write'))
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function respond(accept: boolean) {
    setBusy(accept ? 'allow' : 'deny')
    setError(null)
    try {
      const result = await authClient.oauth2.consent({
        accept,
        oauth_query: oauthQuery,
        scope: scopes.filter(scope => scope !== 'mcp:write' || allowEditing).join(' '),
      })
      if (result.error || !result.data?.url) throw new Error(result.error?.message || 'Could not complete the connection. Try again.')
      window.location.assign(result.data.url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete the connection. Try again.')
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4 border-y py-5">
        {scopes.includes('mcp:read') && <div className="space-y-1">
          <p className="text-sm font-medium">Read your career information</p>
          <p className="text-sm text-muted-foreground">Access your jobs, profile, master CV, and CV drafts.</p>
        </div>}
        {scopes.includes('mcp:write') && <div className="flex items-start gap-3">
          <Checkbox id="draft-access" checked={allowEditing} onCheckedChange={setAllowEditing} disabled={busy !== null} />
          <div className="space-y-1">
            <Label htmlFor="draft-access">Create and edit CV drafts</Label>
            <p className="text-sm text-muted-foreground">You review and accept drafts in the Writing Desk before they become live.</p>
          </div>
        </div>}
        {scopes.includes('offline_access') && <p className="text-sm text-muted-foreground">Stay connected between chats. You can disconnect this app in Settings → API tokens.</p>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" disabled={busy !== null} onClick={() => void respond(false)}>{busy === 'deny' ? 'Denying…' : 'Deny'}</Button>
        <Button className="flex-1" disabled={busy !== null} onClick={() => void respond(true)}>{busy === 'allow' ? 'Connecting…' : 'Allow access'}</Button>
      </div>
    </div>
  )
}
