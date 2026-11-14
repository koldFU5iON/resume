'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { extractFromNotes, type ExtractionSource } from '@/modules/profile/extract'
import {
  acceptSuggestions,
  type AcceptSuggestionsPayload,
} from '@/modules/profile/actions'
import type { ActivityWithMatch, SkillWithMatch } from '@/modules/profile/duplicate-detect'
import { Bot, Check, Loader2, RefreshCw, ScanText, X, AlertCircle } from 'lucide-react'
import clsx from 'clsx'

// ── Types ─────────────────────────────────────────────────────────────────────

type SuggestionDecision = 'accept' | 'replace' | 'skip'

type ActivityRow = ActivityWithMatch & {
  decision: SuggestionDecision
  editedDescription: string
  editedImpact: string
}

type SkillRow = SkillWithMatch & {
  decision: SuggestionDecision
  editedName: string
  editedCategory: string
}

// ── Source meta header ────────────────────────────────────────────────────────

function SourceHeader({ source, llmError }: { source: ExtractionSource; llmError?: string }) {
  const messages: Record<ExtractionSource, string> = {
    parser: 'Parsed from tags.',
    'parser+llm': 'Parsed from tags · LLM filled the gaps.',
    'parser-only-no-key':
      'Parsed from tags · Add an LLM key in Settings to also extract from prose.',
    'parser-llm-error': 'Parsed from tags · LLM unavailable, prose not extracted.',
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
        <ScanText size={13} className="shrink-0" />
        {messages[source]}
      </div>
      {source === 'parser-llm-error' && llmError && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          {llmError}
        </div>
      )}
    </div>
  )
}

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: 'parser' | 'llm' }) {
  return source === 'llm' ? (
    <span title="Extracted by LLM from unstructured prose">
      <Bot size={11} className="text-blue-500" />
    </span>
  ) : (
    <span title="Parsed from tagged headings">
      <ScanText size={11} className="text-green-600" />
    </span>
  )
}

// ── Decision controls ─────────────────────────────────────────────────────────

function DecisionControls({
  decision,
  hasNearMatch,
  onDecide,
}: {
  decision: SuggestionDecision
  hasNearMatch: boolean
  onDecide: (d: SuggestionDecision) => void
}) {
  return (
    <div className="flex gap-1 shrink-0">
      {hasNearMatch ? (
        <>
          <Button
            variant={decision === 'accept' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => onDecide('accept')}
          >
            Add new
          </Button>
          <Button
            variant={decision === 'replace' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => onDecide('replace')}
          >
            Replace
          </Button>
          <Button
            variant={decision === 'skip' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => onDecide('skip')}
          >
            Skip
          </Button>
        </>
      ) : (
        <>
          <Button
            variant={decision === 'accept' ? 'default' : 'outline'}
            size="icon"
            className="h-7 w-7"
            onClick={() => onDecide('accept')}
            aria-label="Accept"
          >
            <Check size={12} />
          </Button>
          <Button
            variant={decision === 'skip' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => onDecide('skip')}
            aria-label="Skip"
          >
            <X size={12} />
          </Button>
        </>
      )}
    </div>
  )
}

// ── Activity row ──────────────────────────────────────────────────────────────

function ActivitySuggestionRow({
  row,
  existingDescription,
  onUpdate,
}: {
  row: ActivityRow
  existingDescription: string | undefined
  onUpdate: (patch: Partial<ActivityRow>) => void
}) {
  return (
    <div
      className={clsx(
        'rounded-md border px-3 py-2 space-y-1 transition-colors',
        row.decision === 'skip' && 'opacity-40',
        row.decision !== 'skip' && 'border-border',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5">
            <SourceBadge source={row.source} />
            <Badge
              variant="outline"
              className={clsx(
                'text-[10px] py-0 px-1.5',
                row.kind === 'responsibility'
                  ? 'border-green-500/50 text-green-700 dark:text-green-400'
                  : 'border-amber-500/50 text-amber-700 dark:text-amber-400',
              )}
            >
              {row.kind}
            </Badge>
          </div>
          <input
            type="text"
            value={row.editedDescription}
            onChange={(e) => onUpdate({ editedDescription: e.target.value })}
            className="w-full text-sm bg-transparent border-0 outline-none focus:ring-0 p-0"
          />
          {row.decision !== 'skip' && (
            <input
              type="text"
              value={row.editedImpact}
              onChange={(e) => onUpdate({ editedImpact: e.target.value })}
              placeholder="Impact (optional)"
              className="w-full text-xs text-muted-foreground bg-transparent border-0 outline-none focus:ring-0 p-0 placeholder:text-muted-foreground/50"
            />
          )}
          {row.nearMatchId && existingDescription && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              Similar to existing: &ldquo;{existingDescription}&rdquo;
            </p>
          )}
        </div>
        <DecisionControls
          decision={row.decision}
          hasNearMatch={!!row.nearMatchId}
          onDecide={(d) => onUpdate({ decision: d })}
        />
      </div>
    </div>
  )
}

// ── Skill row ─────────────────────────────────────────────────────────────────

function SkillSuggestionRow({
  row,
  existingName,
  onUpdate,
}: {
  row: SkillRow
  existingName: string | undefined
  onUpdate: (patch: Partial<SkillRow>) => void
}) {
  return (
    <div
      className={clsx(
        'rounded-md border px-3 py-2 space-y-1 transition-colors',
        row.decision === 'skip' && 'opacity-40',
        row.decision !== 'skip' && 'border-border',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5">
            <SourceBadge source={row.source} />
          </div>
          <input
            type="text"
            value={row.editedName}
            onChange={(e) => onUpdate({ editedName: e.target.value })}
            className="w-full text-sm font-medium bg-transparent border-0 outline-none focus:ring-0 p-0"
          />
          <input
            type="text"
            value={row.editedCategory}
            onChange={(e) => onUpdate({ editedCategory: e.target.value })}
            placeholder="Category (e.g. Backend, DevOps)"
            className="w-full text-xs text-muted-foreground bg-transparent border-0 outline-none focus:ring-0 p-0 placeholder:text-muted-foreground/50"
          />
          {row.nearMatchId && existingName && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              Similar to existing: &ldquo;{existingName}&rdquo;
            </p>
          )}
        </div>
        <DecisionControls
          decision={row.decision}
          hasNearMatch={!!row.nearMatchId}
          onDecide={(d) => onUpdate({ decision: d })}
        />
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

type Props = {
  experienceId: string
  existingActivities: { id: string; description: string; kind: string }[]
  existingSkills: { id: string; name: string }[]
}

type PanelState =
  | { stage: 'idle' }
  | { stage: 'extracting' }
  | { stage: 'error'; message: string }
  | {
      stage: 'review'
      source: ExtractionSource
      llmError?: string
      activityRows: ActivityRow[]
      skillRows: SkillRow[]
    }

export function ExtractionPanel({ experienceId, existingActivities, existingSkills }: Props) {
  const [panel, setPanel] = useState<PanelState>({ stage: 'idle' })
  const [isAccepting, startAccepting] = useTransition()

  const runExtract = async () => {
    setPanel({ stage: 'extracting' })
    const result = await extractFromNotes(experienceId)

    if (!result.ok) {
      setPanel({ stage: 'error', message: result.message })
      return
    }

    const activityRows: ActivityRow[] = result.suggestions.activities.map((a) => ({
      ...a,
      decision: 'accept',
      editedDescription: a.description,
      editedImpact: a.impact ?? '',
    }))
    const skillRows: SkillRow[] = result.suggestions.skills.map((s) => ({
      ...s,
      decision: 'accept',
      editedName: s.name,
      editedCategory: s.category ?? '',
    }))

    setPanel({ stage: 'review', source: result.meta.source, llmError: result.meta.llmError, activityRows, skillRows })
  }

  const updateActivityRow = (idx: number, patch: Partial<ActivityRow>) => {
    setPanel((prev) => {
      if (prev.stage !== 'review') return prev
      const rows = [...prev.activityRows]
      rows[idx] = { ...rows[idx], ...patch }
      return { ...prev, activityRows: rows }
    })
  }

  const updateSkillRow = (idx: number, patch: Partial<SkillRow>) => {
    setPanel((prev) => {
      if (prev.stage !== 'review') return prev
      const rows = [...prev.skillRows]
      rows[idx] = { ...rows[idx], ...patch }
      return { ...prev, skillRows: rows }
    })
  }

  const handleAcceptAll = () => {
    if (panel.stage !== 'review') return
    startAccepting(async () => {
      const payload: AcceptSuggestionsPayload = {
        experienceId,
        activities: panel.activityRows
          .filter((r) => r.decision !== 'skip' && r.editedDescription.trim())
          .map((r) => ({
            kind: r.kind,
            description: r.editedDescription.trim(),
            impact: r.editedImpact.trim() || null,
            ...(r.decision === 'replace' && r.nearMatchId
              ? { replaceId: r.nearMatchId }
              : {}),
          })),
        skills: panel.skillRows
          .filter((r) => r.decision !== 'skip' && r.editedName.trim())
          .map((r) => ({
            name: r.editedName.trim(),
            category: r.editedCategory.trim() || null,
            level: r.level,
            ...(r.decision === 'replace' && r.nearMatchId
              ? { replaceId: r.nearMatchId }
              : {}),
          })),
      }

      await acceptSuggestions(payload)
      setPanel({ stage: 'idle' })
    })
  }

  const acceptedCount =
    panel.stage === 'review'
      ? panel.activityRows.filter((r) => r.decision !== 'skip').length +
        panel.skillRows.filter((r) => r.decision !== 'skip').length
      : 0

  return (
    <div className="space-y-4">
      <Separator />

      <div className="flex items-center justify-between">
        <span className="text-base font-medium">Extract suggestions</span>
        <Button
          size="sm"
          variant="outline"
          disabled={panel.stage === 'extracting' || isAccepting}
          onClick={runExtract}
          className="gap-1.5"
        >
          {panel.stage === 'extracting' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          {panel.stage === 'extracting' ? 'Extracting…' : 'Extract'}
        </Button>
      </div>

      {panel.stage === 'error' && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          {panel.message}
        </div>
      )}

      {panel.stage === 'review' && (
        <div className="space-y-4">
          <SourceHeader source={panel.source} llmError={panel.llmError} />

          {panel.activityRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Activities</p>
              {panel.activityRows.map((row, idx) => (
                <ActivitySuggestionRow
                  key={idx}
                  row={row}
                  existingDescription={
                    row.nearMatchId
                      ? existingActivities.find((a) => a.id === row.nearMatchId)?.description
                      : undefined
                  }
                  onUpdate={(patch) => updateActivityRow(idx, patch)}
                />
              ))}
            </div>
          )}

          {panel.skillRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Skills</p>
              {panel.skillRows.map((row, idx) => (
                <SkillSuggestionRow
                  key={idx}
                  row={row}
                  existingName={
                    row.nearMatchId
                      ? existingSkills.find((s) => s.id === row.nearMatchId)?.name
                      : undefined
                  }
                  onUpdate={(patch) => updateSkillRow(idx, patch)}
                />
              ))}
            </div>
          )}

          {panel.activityRows.length === 0 && panel.skillRows.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No suggestions found. Try adding more detail to your notes.
            </p>
          )}

          {(panel.activityRows.length > 0 || panel.skillRows.length > 0) && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPanel({ stage: 'idle' })}>
                Discard
              </Button>
              <Button
                size="sm"
                disabled={isAccepting || acceptedCount === 0}
                onClick={handleAcceptAll}
                className="gap-1.5"
              >
                {isAccepting && <Loader2 size={13} className="animate-spin" />}
                {isAccepting
                  ? 'Saving…'
                  : `Save ${acceptedCount} item${acceptedCount === 1 ? '' : 's'}`}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
