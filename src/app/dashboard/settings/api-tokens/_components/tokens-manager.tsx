'use client'

import { useState } from 'react'
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  createApiTokenAction,
  revokeApiTokenAction,
} from '@/modules/api-tokens/actions'
import type { ApiTokenScope, ApiTokenSummary, CreatedToken } from '@/modules/api-tokens/service'
import { cn } from '@/lib/utils'

type Props = {
  tokens: ApiTokenSummary[]
}

const ACCESS_OPTIONS: Record<string, { label: string; scopes: ApiTokenScope[] }> = {
  capture: { label: 'Capture jobs only', scopes: ['capture'] },
  deepDive: { label: 'Capture jobs and run deep dives', scopes: ['capture', 'deep-dive:run'] },
  read: { label: 'MCP read-only', scopes: ['mcp:read'] },
  write: { label: 'MCP read and edit drafts', scopes: ['mcp:read', 'mcp:write'] },
}

export function TokensManager({ tokens }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  // Tracks the raw token between create-success and dismissal. After dismiss
  // it's gone forever — there's no other place it lives.
  const [justCreated, setJustCreated] = useState<CreatedToken | null>(null)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">API tokens</h2>
          <p className="text-sm text-muted-foreground max-w-prose">
            Give scripts and agents access to capture jobs or use MCP tools.
            Each token is shown once at creation; store it somewhere safe.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0 gap-1.5">
          <Plus size={16} />
          New token
        </Button>
      </div>

      {tokens.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <TokensList tokens={tokens} />
      )}

      <CreateTokenDialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o)
          if (!o) setJustCreated(null) // discarding closes the one-shot reveal
        }}
        justCreated={justCreated}
        onCreated={setJustCreated}
      />
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-10 text-center">
      <KeyRound className="mx-auto mb-3 size-8 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm font-medium">No tokens yet</p>
      <p className="text-sm text-muted-foreground mt-1">Mint one to start posting jobs from an agent or script.</p>
      <Button size="sm" variant="secondary" onClick={onCreate} className="mt-4 gap-1.5">
        <Plus size={14} />
        Create your first token
      </Button>
    </div>
  )
}

function TokensList({ tokens }: { tokens: ApiTokenSummary[] }) {
  return (
    <ul className="divide-y divide-border rounded-lg border">
      {tokens.map(token => (
        <TokenRow key={token.id} token={token} />
      ))}
    </ul>
  )
}

function TokenRow({ token }: { token: ApiTokenSummary }) {
  const [revoking, setRevoking] = useState(false)
  const isRevoked = !!token.revokedAt

  async function handleRevoke() {
    if (!confirm(`Revoke "${token.name}"? Any tool using this token will stop working immediately.`)) return
    setRevoking(true)
    try {
      await revokeApiTokenAction(token.id)
      toast.success('Token revoked')
    } catch {
      toast.error('Failed to revoke token')
      setRevoking(false)
    }
  }

  return (
    <li className={cn(
      "flex items-center gap-4 px-4 py-3",
      isRevoked && "opacity-60",
    )}>
      <KeyRound size={16} className="text-muted-foreground shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{token.name}</span>
          {isRevoked && <Badge variant="outline" className="text-xs">Revoked</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
          <code className="font-mono">{token.prefix}…</code>
          <span>Created {formatDate(token.createdAt)}</span>
          <span>
            {token.lastUsedAt
              ? `Last used ${formatDate(token.lastUsedAt)}`
              : 'Never used'}
          </span>
          {token.revokedAt && <span>Revoked {formatDate(token.revokedAt)}</span>}
          <span>{token.scopes.join(', ')}</span>
          <span>{token.expiresAt ? `Expires ${new Date(token.expiresAt).toLocaleDateString()}` : 'No expiry'}</span>
        </div>
      </div>
      {!isRevoked && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRevoke}
          disabled={revoking}
          className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
        >
          {revoking ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          Revoke
        </Button>
      )}
    </li>
  )
}

function CreateTokenDialog({
  open,
  onOpenChange,
  justCreated,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  justCreated: CreatedToken | null
  onCreated: (t: CreatedToken) => void
}) {
  const [name, setName] = useState('')
  const [access, setAccess] = useState('capture')
  const [expiry, setExpiry] = useState('90')
  const [submitting, setSubmitting] = useState(false)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      const result = await createApiTokenAction(name.trim(), ACCESS_OPTIONS[access].scopes, expiry === 'never' ? null : Number(expiry))
      onCreated(result)
      setName('')
    } catch {
      toast.error('Failed to create token')
    } finally {
      setSubmitting(false)
    }
  }

  function handleDone() {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {justCreated ? (
          <CreatedTokenReveal token={justCreated} onDone={handleDone} />
        ) : (
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>New API token</DialogTitle>
              <DialogDescription>
                Give the token a name so you can recognize it later. The token
                value will be shown once after creation — copy it then.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-4">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Hermes laptop, bookmarklet"
                autoFocus
                maxLength={80}
                required
              />
              <p className="text-xs text-muted-foreground">
                For your reference only — appears in the tokens list and in usage logs.
              </p>
              <Label htmlFor="token-access" className="mt-4">Access</Label>
              <Select value={access} onValueChange={value => { if (value) setAccess(value) }}>
                <SelectTrigger id="token-access" className="w-full"><SelectValue>{ACCESS_OPTIONS[access].label}</SelectValue></SelectTrigger>
                <SelectContent>{Object.entries(ACCESS_OPTIONS).map(([value, option]) => <SelectItem key={value} value={value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
              {access === 'deepDive' && <p className="text-xs text-muted-foreground">This agent can start deep dives on your jobs. Each one runs on your own LLM API key and costs roughly what a deep dive from the dashboard costs.</p>}
              {access === 'write' && <p className="text-xs text-muted-foreground">This agent can create and edit CV drafts for any of your jobs. You still accept drafts in the Writing Desk.</p>}
              <Label htmlFor="token-expiry" className="mt-4">Expires after</Label>
              <Select value={expiry} onValueChange={value => { if (value) setExpiry(value) }}>
                <SelectTrigger id="token-expiry" className="w-full"><SelectValue>{expiry === 'never' ? 'Never' : `${expiry} days`}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="365">365 days</SelectItem>
                  <SelectItem value="never">Never</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting ? 'Creating…' : 'Create token'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreatedTokenReveal({ token, onDone }: { token: CreatedToken; onDone: () => void }) {
  const [copied, setCopied] = useState(false)

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token.token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Copy failed — select and copy manually')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save this token now</DialogTitle>
        <DialogDescription>
          This is the only time it will be shown. After you close this dialog,
          you can&apos;t see it again — only revoke and replace.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-4">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          {token.name}
        </Label>
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2.5 font-mono text-xs break-all">
          <code className="flex-1 select-all">{token.token}</code>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={copyToken}
            aria-label={copied ? 'Copied' : 'Copy token'}
            className="shrink-0 gap-1.5"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Use as a Bearer token in the <code className="font-mono">Authorization</code> header.
        </p>
      </div>

      <DialogFooter>
        <Button onClick={onDone}>I&apos;ve saved it — close</Button>
      </DialogFooter>
    </>
  )
}

function formatDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return '—'
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
