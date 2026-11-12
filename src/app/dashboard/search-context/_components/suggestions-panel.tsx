'use client'

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { acceptSuggestion, dismissSuggestion } from '@/modules/search-profile/actions'
import { formatSalaryBand } from '@/modules/search-profile/schema'
import type { SearchSuggestion, SearchProfile, SalaryBand } from '@/modules/search-profile/schema'

type Props = {
  suggestions: SearchSuggestion[]
  currentProfile: SearchProfile
  onAccepted: (id: string, field: keyof SearchProfile, value: unknown) => void
  onDismissed: (id: string) => void
}

const SOURCE_LABELS: Record<SearchSuggestion['source'], string> = {
  'job-fit': 'job fit',
  'deep-dive': 'deep dive',
  'chat': 'chat',
  'cover-letter': 'cover letter',
  'interview-prep': 'interview prep',
}

function formatSuggestedValue(field: keyof SearchProfile, value: unknown, currentProfile: SearchProfile): string {
  if (field === 'salaryBand' && value && typeof value === 'object') {
    return formatSalaryBand(value as SalaryBand)
  }
  if (Array.isArray(value)) {
    const current = currentProfile[field]
    const existing = new Set(Array.isArray(current) ? current : [])
    const newItems = value.filter((item) => !existing.has(item))
    return (newItems.length > 0 ? newItems : value).join(', ')
  }
  if (typeof value === 'string') return value
  return String(value)
}

export function SuggestionsPanel({ suggestions, currentProfile, onAccepted, onDismissed }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [pending, startTransition] = useTransition()

  if (suggestions.length === 0) return null

  function handleAccept(suggestion: SearchSuggestion) {
    startTransition(async () => {
      await acceptSuggestion(suggestion.id)
      onAccepted(suggestion.id, suggestion.field, suggestion.suggestedValue)
    })
  }

  function handleDismiss(suggestion: SearchSuggestion) {
    startTransition(async () => {
      await dismissSuggestion(suggestion.id)
      onDismissed(suggestion.id)
    })
  }

  return (
    <div className="rounded-lg border border-l-4 border-l-violet-500 bg-card">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500 text-[10px] font-bold text-white">
          {suggestions.length}
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold">
            {suggestions.length === 1 ? '1 suggestion' : `${suggestions.length} suggestions`} from your recent activity
          </p>
          <p className="text-xs text-muted-foreground">Review and lock in what&apos;s useful</p>
        </div>
        {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t">
          {suggestions.map((suggestion, i) => (
            <div
              key={suggestion.id}
              className={`flex items-start gap-4 px-4 py-3 ${i < suggestions.length - 1 ? 'border-b' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium capitalize">
                    {suggestion.field.replace(/([A-Z])/g, ' $1').toLowerCase()}
                  </span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {SOURCE_LABELS[suggestion.source]}
                  </Badge>
                </div>
                <p className="text-sm font-medium">
                  Add {formatSuggestedValue(suggestion.field, suggestion.suggestedValue, currentProfile)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{suggestion.reason}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0 mt-0.5">
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  onClick={() => handleAccept(suggestion)}
                  disabled={pending}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleDismiss(suggestion)}
                  disabled={pending}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
