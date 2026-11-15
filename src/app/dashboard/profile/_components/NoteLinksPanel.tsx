'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { confirmEvidenceLinksAction, rejectEvidenceLinksAction } from '@/modules/profile-map/link-actions'
import type { PendingSuggestion } from '@/modules/profile-map/link-store'
import type { NoteCapabilityLink } from '@/modules/profile-map/note-links'
import { capabilitiesHref } from '@/modules/profile/note-index'

const VIA_LABEL = {
  confirmed: 'confirmed by you',
  exact: 'named in the text',
  wikilink: '[[linked]] in the text',
} as const

const STATUS_LABEL = { proven: 'Proven', certified: 'Certified', claimed: 'Claimed only' } as const

/**
 * The capabilities a role or project uses or proves, and how each link came
 * about; and the suggestions waiting on its evidence, to accept or dismiss
 * here. The profile-wide queue and "Suggest links" are on the Overview.
 */
export function NoteLinksPanel({ capabilities, pending }: { capabilities: NoteCapabilityLink[]; pending: PendingSuggestion[] }) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()

  function decide(action: typeof confirmEvidenceLinksAction, pairs: { evidenceId: string; capabilityId: string }[]) {
    startTransition(async () => {
      try {
        await action(pairs)
        router.refresh()
      } catch {
        toast.error('Something went wrong. Please try again.')
      }
    })
  }
  const pair = (s: PendingSuggestion) => ({ evidenceId: s.evidenceId, capabilityId: s.capabilityId })

  return (
    <div className="space-y-6">
      <section aria-labelledby="note-links-capabilities" className="space-y-2">
        <h2 id="note-links-capabilities" className="text-sm font-semibold">Capabilities</h2>
        {capabilities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing linked yet. Name a skill or tool in the note, write it as [[Skill]], or add evidence and accept the links suggested for it.
          </p>
        ) : (
          <ul className="space-y-2">
            {capabilities.map(capability => (
              <li key={capability.id} className="rounded-md bg-muted/50 px-3 py-2">
                <p className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{capability.name}</span>
                  <span className="shrink-0 text-xs capitalize text-muted-foreground">{capability.kind}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {STATUS_LABEL[capability.status]}
                  {capability.evidence > 0 && ` · ${capability.evidence} evidence item${capability.evidence === 1 ? '' : 's'}`}
                  {capability.via.length > 0 && ` · ${capability.via.map(v => VIA_LABEL[v]).join(', ')}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs">
          <Link href={capabilitiesHref()} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">All capabilities</Link>
        </p>
      </section>

      <section aria-labelledby="note-links-pending" className="space-y-2 border-t pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="note-links-pending" className="text-sm font-semibold">Suggested links</h2>
          {pending.length > 1 && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => decide(rejectEvidenceLinksAction, pending.map(pair))}>Dismiss all</Button>
              <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={busy} onClick={() => decide(confirmEvidenceLinksAction, pending.map(pair))}>Accept all</Button>
            </div>
          )}
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No suggestions waiting for this note&apos;s evidence.</p>
        ) : (
          <ul className="space-y-1.5">
            {pending.map(suggestion => (
              <li key={`${suggestion.evidenceId}:${suggestion.capabilityId}`} className="flex items-start gap-1.5 rounded-md bg-muted/50 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{suggestion.capability}</p>
                  <p className="text-sm leading-snug text-muted-foreground">{suggestion.evidence}</p>
                  {suggestion.reason && <p className="mt-0.5 text-xs text-muted-foreground">{suggestion.reason}</p>}
                </div>
                <Button size="icon" variant="ghost" className="size-7 shrink-0" disabled={busy} aria-label={`Link to ${suggestion.capability}`} onClick={() => decide(confirmEvidenceLinksAction, [pair(suggestion)])}>
                  <Check size={14} />
                </Button>
                <Button size="icon" variant="ghost" className="size-7 shrink-0 hover:text-destructive" disabled={busy} aria-label={`Don't link to ${suggestion.capability}`} onClick={() => decide(rejectEvidenceLinksAction, [pair(suggestion)])}>
                  <X size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
