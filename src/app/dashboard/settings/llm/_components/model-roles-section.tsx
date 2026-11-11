'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { saveLLMModelRole } from '@/modules/llm/actions'
import {
  CONFIGURABLE_ROLES,
  ROLE_INFO,
  recommendedModel,
  resolveRoleModel,
  type ConfigurableRole,
  type ModelRoleChoices,
} from '@/modules/llm/roles'
import { toast } from 'sonner'

type ProviderModel = { id: string; name: string }

/** Select value for "no explicit choice". Not a valid model id. */
const SAME_AS_DEFAULT = '__default__'

type Props = {
  provider: string
  defaultModel: string
  availableModels: ProviderModel[]
  initialChoices: ModelRoleChoices
}

export function ModelRolesSection({ provider, defaultModel, availableModels, initialChoices }: Props) {
  const [choices, setChoices] = useState<ModelRoleChoices>(initialChoices)
  const [saving, startSaving] = useTransition()

  const nameOf = (id: string) => availableModels.find(m => m.id === id)?.name ?? id
  const ids = availableModels.map(m => m.id)

  function handleSelect(role: ConfigurableRole, value: string | null) {
    if (value === null) return
    const model = value === SAME_AS_DEFAULT ? null : value
    const previous = choices
    setChoices(c => {
      const next = { ...c }
      if (model) next[role] = model
      else delete next[role]
      return next
    })
    startSaving(async () => {
      try {
        await saveLLMModelRole(role, model)
      } catch (err) {
        setChoices(previous)
        toast.error(err instanceof Error ? err.message : 'Failed to save model')
      }
    })
  }

  return (
    <div className="space-y-4 border-t pt-6">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Models by task</h2>
        <p className="text-xs text-muted-foreground">
          Pick a cheaper or stronger model for each kind of work. Writing, CVs and cover letters use
          your default model above.
        </p>
      </div>

      {CONFIGURABLE_ROLES.map(role => {
        const info = ROLE_INFO[role]
        const recommended = recommendedModel(provider, role)
        // With no choice, a recommended model the key has applies before the default model.
        const sameAsDefaultLabel =
          recommended !== null && ids.includes(recommended)
            ? `Recommended (${nameOf(recommended)})`
            : 'Same as my default model'
        const resolved = resolveRoleModel(
          { provider, defaultModel, availableModels: ids, choices },
          role,
        )
        const value = choices[role] && !resolved.staleChoice ? choices[role]! : SAME_AS_DEFAULT
        const selectId = `model-role-${role}`

        return (
          <div key={role} className="space-y-1.5">
            <Label htmlFor={selectId}>{info.label}</Label>
            <p className="text-xs text-muted-foreground">{info.description}</p>
            <Select value={value} onValueChange={v => handleSelect(role, v)} disabled={saving}>
              <SelectTrigger id={selectId} className="w-full">
                <SelectValue>{value === SAME_AS_DEFAULT ? sameAsDefaultLabel : nameOf(value)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SAME_AS_DEFAULT}>{sameAsDefaultLabel}</SelectItem>
                {availableModels.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                    {m.id === recommended ? ' · recommended' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {resolved.staleChoice && (
              <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>
                  Your choice <span className="font-mono">{resolved.staleChoice}</span> is no longer
                  available for your key. Using {nameOf(resolved.model)} instead. Pick a model to
                  replace it.
                </span>
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
