'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Plus, Sparkles, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  addCapabilityWithEvidenceAction,
  confirmEvidenceLinksAction,
  rejectEvidenceLinksAction,
  suggestEvidenceLinksAction,
} from '@/modules/profile-map/link-actions'
import type { PendingSuggestion } from '@/modules/profile-map/link-store'
import type { CapabilitySuggestion } from '@/modules/profile-map/suggest'
import { SectionHelp } from './SectionHelp'

export type EvidenceLinkStats = { total: number; proven: number; certified: number; claimed: number }

type Props = {
  stats: EvidenceLinkStats
  pending: PendingSuggestion[]
  hasLLMKey: boolean
}

const HELP =
  'Links each skill, tool and competency to the achievements that prove it. Exact mentions and [[wikilinks]] in your ' +
  'notes link automatically. "Suggest links" asks AI for the rest; suggestions wait here for your review.'

/** How many capability groups show before "Show all". */
const COLLAPSED_GROUPS = 6

export function EvidenceLinksSection({ stats, pending, hasLLMKey }: Props) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [suggesting, setSuggesting] = useState(false)
  const [newCapabilities, setNewCapabilities] = useState<CapabilitySuggestion[]>([])
  const [showAll, setShowAll] = useState(false)

  const groups = useMemo(() => {
    const byCapability = new Map<string, PendingSuggestion[]>()
    for (const s of pending) byCapability.set(s.capability, [...(byCapability.get(s.capability) ?? []), s])
    return [...byCapability.entries()]
  }, [pending])

  function run(work: () => Promise<unknown>, done?: string) {
    startTransition(async () => {
      try {
        await work()
        if (done) toast.success(done)
        router.refresh()
      } catch {
        toast.error('Something went wrong. Please try again.')
      }
    })
  }

  async function suggest() {
    setSuggesting(true)
    try {
      const result = await suggestEvidenceLinksAction()
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setNewCapabilities(result.newCapabilities)
      toast.success(
        result.links || result.newCapabilities.length
          ? `${result.links} link${result.links === 1 ? '' : 's'} and ${result.newCapabilities.length} new capabilit${result.newCapabilities.length === 1 ? 'y' : 'ies'} to review.`
          : 'No new links found.',
      )
      router.refresh()
    } catch {
      toast.error('Could not suggest links. Please try again.')
    } finally {
      setSuggesting(false)
    }
  }

  const pair = (s: PendingSuggestion) => ({ evidenceId: s.evidenceId, capabilityId: s.capabilityId })
  const visibleGroups = showAll ? groups : groups.slice(0, COLLAPSED_GROUPS)
  const pct = stats.total ? Math.round(((stats.proven + stats.certified) / stats.total) * 100) : 0

  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5">
        <h3 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Evidence links</h3>
        <SectionHelp text={HELP} />
      </div>

      {stats.total === 0 ? (
        <p className="text-sm text-muted-foreground">Add skills or tools first; they get linked to your achievements here.</p>
      ) : (
        <>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span>
              <span className="font-medium">{stats.proven + stats.certified}</span>
              <span className="text-muted-foreground"> of {stats.total} backed by evidence</span>
            </span>
            {stats.claimed > 0 && <span className="text-xs text-muted-foreground">{stats.claimed} claimed only</span>}
          </div>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Capabilities backed by evidence">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={!hasLLMKey || suggesting || busy}
            onClick={() => void suggest()}
            title={hasLLMKey ? undefined : 'Add an AI provider key in Settings to suggest links'}
          >
            <Sparkles />
            {suggesting ? 'Suggesting…' : 'Suggest links'}
          </Button>
        </>
      )}

      {newCapabilities.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Missing from your profile</p>
          {newCapabilities.map((c) => (
            <div key={c.name} className="rounded-md bg-muted/50 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="flex-1 font-medium">{c.name}</span>
                <Badge variant="outline" className="text-xs capitalize">{c.kind}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{c.reason}</p>
              <div className="mt-2 flex gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7"
                  disabled={busy}
                  onClick={() => {
                    setNewCapabilities((prev) => prev.filter((p) => p.name !== c.name))
                    run(() => addCapabilityWithEvidenceAction(c), `Added ${c.name}, linked to ${c.evidenceIds.length} achievement${c.evidenceIds.length === 1 ? '' : 's'}.`)
                  }}
                >
                  <Plus />Add
                </Button>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setNewCapabilities((prev) => prev.filter((p) => p.name !== c.name))}>
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">{pending.length} suggested link{pending.length === 1 ? '' : 's'}</p>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => run(() => rejectEvidenceLinksAction(pending.map(pair)), 'Suggestions dismissed.')}>
                Dismiss all
              </Button>
              <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={busy} onClick={() => run(() => confirmEvidenceLinksAction(pending.map(pair)), `Linked ${pending.length} achievements.`)}>
                Accept all
              </Button>
            </div>
          </div>
          <ul className="space-y-3">
            {visibleGroups.map(([capability, items]) => (
              <li key={capability}>
                <p className="mb-1 text-sm font-medium">{capability}</p>
                <ul className="space-y-1.5">
                  {items.map((s) => (
                    <li key={`${s.evidenceId}:${s.capabilityId}`} className="flex items-start gap-1.5 rounded-md bg-muted/50 px-2.5 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug">{s.evidence}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{s.role}{s.reason ? ` · ${s.reason}` : ''}</p>
                      </div>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" disabled={busy} aria-label={`Link to ${capability}`} onClick={() => run(() => confirmEvidenceLinksAction([pair(s)]))}>
                        <Check />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 hover:text-destructive" disabled={busy} aria-label={`Don't link to ${capability}`} onClick={() => run(() => rejectEvidenceLinksAction([pair(s)]))}>
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {groups.length > COLLAPSED_GROUPS && (
            <Button size="sm" variant="ghost" className="mt-2 h-7 w-full text-xs" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${groups.length} capabilities`}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
