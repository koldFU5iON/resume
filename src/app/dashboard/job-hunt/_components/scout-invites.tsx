'use client'

import { useState } from 'react'
import { Copy, Link2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createScoutInviteAction, revokeScoutInviteAction } from '@/modules/scout-inbox/actions'

type Invite = {
  id: string
  name: string
  prefix: string
  revokedAt: Date | null
}

export function ScoutInvites({ invites }: { invites: Invite[] }) {
  const [name, setName] = useState('')
  const [createdLink, setCreatedLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function createInvite(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const invite = await createScoutInviteAction(name)
      setCreatedLink(`${window.location.origin}/scout/${invite.token}`)
      setName('')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this Scout invite? The shared link will stop working immediately.')) return
    await revokeScoutInviteAction(id)
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Scout invites</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Create a limited link for someone to share roles. They cannot access applications.</p>
      <form className="mt-3 flex gap-2" onSubmit={createInvite}>
        <Input value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Mum" maxLength={80} required />
        <Button size="sm" type="submit" disabled={busy}><Plus className="size-3.5" /> Create</Button>
      </form>
      {createdLink && (
        <div className="mt-3 rounded-md border bg-muted/30 p-2 text-xs">
          <p className="mb-1 font-medium">Copy this link now. It will not be shown again.</p>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 break-all">{createdLink}</code>
            <Button size="sm" variant="ghost" type="button" onClick={() => navigator.clipboard.writeText(createdLink)} aria-label="Copy Scout invite link"><Copy className="size-3.5" /></Button>
          </div>
        </div>
      )}
      {invites.length > 0 && (
        <ul className="mt-3 space-y-2 text-xs">
          {invites.map(invite => (
            <li key={invite.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{invite.name} <code className="text-muted-foreground">{invite.prefix}…</code>{invite.revokedAt ? ' (revoked)' : ''}</span>
              {!invite.revokedAt && <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => revoke(invite.id)}><Trash2 className="size-3.5" /> Revoke</Button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
