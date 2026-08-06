'use client'

import { useMemo, useState, useTransition } from 'react'
import { AlertTriangle, RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  resetAllPrompts,
  revertPrompt,
  savePromptOverride,
} from '@/modules/prompts/actions'
import { PROMPT_GROUP_LABELS, type PromptDef, type PromptGroup } from '@/modules/prompts/registry'
import type { PromptOverrides } from '@/modules/prompts/schema'
import { toast } from 'sonner'

type Props = {
  registry: PromptDef[]
  defaults: Record<string, string>
  overrides: PromptOverrides
}

const GROUPS: PromptGroup[] = ['rules', 'cv', 'cover-letter']

export function PromptsForm({ registry, defaults, overrides: initialOverrides }: Props) {
  const [savedOverrides, setSavedOverrides] = useState<PromptOverrides>(initialOverrides)
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const def of registry) {
      initial[def.key] = initialOverrides[def.key] ?? defaults[def.key]
    }
    return initial
  })
  const [selectedKey, setSelectedKey] = useState(registry[0]?.key ?? '')
  const [isPending, startTransition] = useTransition()

  const selected = registry.find(d => d.key === selectedKey)
  const savedText = savedOverrides[selectedKey] ?? defaults[selectedKey]
  const isDirty = drafts[selectedKey] !== savedText
  const isCustomized = selectedKey in savedOverrides

  const missingMarkers = useMemo(() => {
    if (!selected?.requiredMarkers?.length) return []
    return selected.requiredMarkers.filter(marker => !drafts[selectedKey]?.includes(marker))
  }, [selected, drafts, selectedKey])

  function handleSave() {
    if (!selectedKey) return
    const trimmed = drafts[selectedKey].trim()
    if (!trimmed) {
      toast.error('Prompt cannot be empty. Revert to default instead.')
      return
    }
    startTransition(async () => {
      try {
        await savePromptOverride(selectedKey, trimmed)
        setSavedOverrides(prev => ({ ...prev, [selectedKey]: trimmed }))
        setDrafts(prev => ({ ...prev, [selectedKey]: trimmed }))
        toast.success('Prompt saved.')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save prompt.')
      }
    })
  }

  function handleRevert() {
    if (!selectedKey) return
    startTransition(async () => {
      try {
        await revertPrompt(selectedKey)
        setSavedOverrides(prev => {
          const next = { ...prev }
          delete next[selectedKey]
          return next
        })
        setDrafts(prev => ({ ...prev, [selectedKey]: defaults[selectedKey] }))
        toast.success('Reverted to the default prompt.')
      } catch {
        toast.error('Failed to revert prompt.')
      }
    })
  }

  function handleResetAll() {
    if (!confirm('Reset every prompt to its default? Your custom versions will be deleted.')) return
    startTransition(async () => {
      try {
        await resetAllPrompts()
        setSavedOverrides({})
        setDrafts({ ...defaults })
        toast.success('All prompts reset to defaults.')
      } catch {
        toast.error('Failed to reset prompts.')
      }
    })
  }

  function handleSelect(value: string | null) {
    if (value) setSelectedKey(value)
  }

  const customizedCount = Object.keys(savedOverrides).length

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-2">
        <Label htmlFor="prompt-select">Prompt</Label>
        <div className="flex items-center gap-3">
          <Select value={selectedKey} onValueChange={handleSelect} disabled={isPending}>
            <SelectTrigger id="prompt-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUPS.map(group => (
                <SelectGroup key={group}>
                  <SelectLabel>{PROMPT_GROUP_LABELS[group]}</SelectLabel>
                  {registry.filter(d => d.group === group).map(def => (
                    <SelectItem key={def.key} value={def.key}>
                      {def.label}
                      {def.key in savedOverrides && (
                        <span className="ml-1 rounded-sm bg-amber-100 px-1 py-px text-[10px] font-medium text-amber-700">
                          Custom
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {customizedCount > 0 && (
            <Badge variant="outline" className="shrink-0 text-xs">
              {customizedCount} customized
            </Badge>
          )}
        </div>
        {selected && (
          <p className="text-xs text-muted-foreground">{selected.description}</p>
        )}
      </div>

      {selected && (
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="prompt-text">Prompt text</Label>
              {isCustomized && (
                <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
                  Customized — applied to your account only
                </Badge>
              )}
            </div>
            <Textarea
              id="prompt-text"
              value={drafts[selectedKey]}
              onChange={e => setDrafts(prev => ({ ...prev, [selectedKey]: e.target.value }))}
              rows={24}
              disabled={isPending}
              className="resize-y text-xs leading-relaxed font-mono"
              spellCheck={false}
            />
          </div>

          {missingMarkers.length > 0 && (
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-medium">Removing these markers breaks the feature they activate:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {missingMarkers.map(marker => (
                    <li key={marker}>
                      <code className="font-mono">{marker}</code>
                    </li>
                  ))}
                </ul>
                <p className="text-amber-700">
                  Keep them if you want the injected context (job intelligence, ATS uplift, master CV) to still apply.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isPending || !isDirty}
            >
              <Save size={14} className="mr-1.5" aria-hidden="true" />
              {isPending ? 'Saving…' : 'Save'}
            </Button>
            {isCustomized && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRevert}
                disabled={isPending}
              >
                <RotateCcw size={14} className="mr-1.5" aria-hidden="true" />
                Revert to default
              </Button>
            )}
            {customizedCount > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={handleResetAll}
                disabled={isPending}
              >
                Reset all prompts
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
