'use client'

import { useState, useTransition } from 'react'
import { Check, Eye, EyeOff, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { saveLLMApiKey, saveLLMModel, refreshModels, clearLLMApiKey } from '@/modules/llm/actions'
import { toast } from 'sonner'

type ProviderModel = { id: string; name: string }

type Props = {
  initial: {
    provider: string
    model: string
    keyConfigured: boolean
    availableModels: ProviderModel[] | null
    availableModelsUpdatedAt: Date | null
  }
}

const PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai',    label: 'OpenAI (GPT)' },
  { value: 'google',    label: 'Google (Gemini)' },
] as const

export function LLMSettingsForm({ initial }: Props) {
  const [provider, setProvider] = useState(initial.provider || 'anthropic')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keyConfigured, setKeyConfigured] = useState(initial.keyConfigured)
  const [availableModels, setAvailableModels] = useState<ProviderModel[] | null>(
    initial.availableModels,
  )
  const [availableModelsUpdatedAt, setAvailableModelsUpdatedAt] = useState<Date | null>(
    initial.availableModelsUpdatedAt,
  )
  const [selectedModel, setSelectedModel] = useState(initial.model)
  const [modelError, setModelError] = useState<string | null>(null)
  const [saving, startSaveTransition] = useTransition()
  const [refreshing, startRefreshTransition] = useTransition()
  const [modelSaving, startModelSaveTransition] = useTransition()

  function handleProviderChange(next: string | null) {
    if (!next) return
    setProvider(next)
    setAvailableModels(null)
    setAvailableModelsUpdatedAt(null)
    setModelError(null)
  }

  function handleSaveKey() {
    if (!apiKey.trim()) return
    startSaveTransition(async () => {
      try {
        const { models } = await saveLLMApiKey({ provider, apiKey })
        setKeyConfigured(true)
        setAvailableModels(models)
        setAvailableModelsUpdatedAt(new Date())
        setSelectedModel(models[0]?.id ?? '')
        setApiKey('')
        toast.success('Key saved and models loaded')
        // Auto-save the first model so there's always a selection
        if (models[0]) await saveLLMModel(models[0].id)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save key')
      }
    })
  }

  function handleModelSelect(model: string | null) {
    if (!model) return
    setSelectedModel(model)
    startModelSaveTransition(async () => {
      try {
        await saveLLMModel(model)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save model')
      }
    })
  }

  function handleRefresh() {
    setModelError(null)
    startRefreshTransition(async () => {
      try {
        const models = await refreshModels()
        setAvailableModels(models)
        setAvailableModelsUpdatedAt(new Date())
        toast.success('Models refreshed')
      } catch (err) {
        setModelError(
          err instanceof Error ? err.message : "Couldn't load models — Refresh to retry.",
        )
      }
    })
  }

  async function handleClearKey() {
    if (
      !confirm(
        'Remove the saved API key? Any AI features that need it will stop working until you re-enter it.',
      )
    )
      return
    try {
      await clearLLMApiKey()
      setKeyConfigured(false)
      setAvailableModels(null)
      setAvailableModelsUpdatedAt(null)
      setSelectedModel('')
      toast.success('API key removed')
    } catch {
      toast.error('Failed to remove key')
    }
  }

  const isBusy = saving || refreshing

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Provider */}
      <div className="space-y-2">
        <Label htmlFor="provider">Provider</Label>
        <Select value={provider} onValueChange={handleProviderChange} disabled={isBusy}>
          <SelectTrigger id="provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map(p => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* API Key — input group */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="api-key">API Key</Label>
          {keyConfigured && (
            <Badge
              variant="outline"
              className="gap-1 text-xs text-emerald-600 border-emerald-300"
            >
              <Check size={11} />
              Saved
            </Badge>
          )}
        </div>
        <div className="flex rounded-md border overflow-hidden">
          <Input
            id="api-key"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
            placeholder={
              keyConfigured
                ? '•••••••• (leave blank to keep existing)'
                : 'sk-ant-api03-…'
            }
            autoComplete="off"
            disabled={isBusy}
            className="border-0 rounded-none flex-1 font-mono focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <button
            type="button"
            onClick={handleSaveKey}
            disabled={isBusy || !apiKey.trim()}
            aria-label="Save API key"
            className="px-3 border-l bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowKey(v => !v)}
            aria-label={showKey ? 'Hide key' : 'Show key'}
            className="px-3 border-l bg-muted text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Encrypted at rest (AES-256-GCM). Saves key and loads available models.
        </p>
      </div>

      {/* Model */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Model</Label>
          {keyConfigured && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
            >
              {refreshing ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              Refresh
            </button>
          )}
        </div>

        {!keyConfigured ? (
          <div className="flex h-9 items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
            Save a key first
          </div>
        ) : availableModels === null ? (
          <div className="flex h-9 items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground gap-2">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? 'Fetching models…' : 'No models loaded'}
          </div>
        ) : (
          <Select
            value={selectedModel}
            onValueChange={handleModelSelect}
            disabled={modelSaving || isBusy}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a model" />
            </SelectTrigger>
            <SelectContent>
              {availableModels.map(m => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {modelError && <p className="text-xs text-destructive">{modelError}</p>}
        {availableModels !== null && !modelError && (
          <p className="text-xs text-muted-foreground">
            {availableModels.length} model{availableModels.length !== 1 ? 's' : ''} · saves on select
            {availableModelsUpdatedAt && ` · refreshed ${availableModelsUpdatedAt.toLocaleString()}`}
          </p>
        )}
      </div>

      {/* Remove key */}
      {keyConfigured && (
        <div className="border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClearKey}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
          >
            <Trash2 size={14} />
            Remove API key
          </Button>
        </div>
      )}
    </div>
  )
}
