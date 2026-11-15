'use client'

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Sparkles } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { MAX_SUMMARY_LENGTH } from "@/modules/profile/schema"
import { Button } from "@/components/ui/button"
import { updateProfileSummary } from "@/modules/profile/actions"
import { generateProfileSummary } from "@/modules/profile/generate-summary"
import { toast } from "sonner"

type ProfileSummaryCardProps = {
  initialSummary: string | null
  hasLLMKey: boolean
}

export function ProfileSummaryCard({ initialSummary, hasLLMKey }: ProfileSummaryCardProps) {
  const router = useRouter()
  const [saved, setSaved] = useState(initialSummary ?? '')
  const [draft, setDraft] = useState(saved)
  // The server's summary is the truth: when it changes (the Coach applied one, another tab saved), follow it.
  // Text you are in the middle of editing is kept; only a draft that matches what was saved moves with it.
  const [seen, setSeen] = useState(initialSummary)
  if (seen !== initialSummary) {
    setSeen(initialSummary)
    const next = initialSummary ?? ''
    if (draft === saved) setDraft(next)
    setSaved(next)
  }
  const [isSaving, startSaving] = useTransition()
  const [isGenerating, startGenerating] = useTransition()

  const isDirty = draft !== saved
  const isPending = isSaving || isGenerating

  function handleSave() {
    startSaving(async () => {
      try {
        await updateProfileSummary(draft)
        setSaved(draft.trim())
        setDraft(draft.trim())
        toast.success('Summary saved.')
      } catch {
        toast.error('Failed to save summary. Please try again.')
      }
    })
  }

  function handleGenerate() {
    startGenerating(async () => {
      const result = await generateProfileSummary()
      if (result.ok) {
        setDraft(result.summary)
        toast.success('Summary generated — review and save when ready.')
      } else {
        toast.error(result.message, {
          action: result.error === 'not_configured'
            ? { label: 'Set up', onClick: () => router.push('/dashboard/settings/llm') }
            : undefined,
        })
      }
    })
  }

  return (
    <div className="space-y-3">
      <Textarea
        maxLength={MAX_SUMMARY_LENGTH}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder="Write a professional summary, or generate one from your profile…"
        rows={5}
        disabled={isPending}
        className="resize-none text-sm"
      />
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-md:h-11"
          onClick={hasLLMKey ? handleGenerate : undefined}
          disabled={isPending || !hasLLMKey}
          title={!hasLLMKey ? 'Add an LLM API key in Settings to generate a summary' : undefined}
        >
          <Sparkles size={13} className="mr-1.5" />
          {isGenerating ? 'Generating…' : 'Generate from profile'}
        </Button>
        <Button
          type="button"
          size="sm"
          className="max-md:h-11"
          onClick={handleSave}
          disabled={isPending || !isDirty}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
