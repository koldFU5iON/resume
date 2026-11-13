'use client'

import { useId, useState, useTransition } from "react"
import { StickyNote } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { updateJobNotes } from "@/modules/jobs/mutations"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type JobNotesProps = {
  jobId: string
  initialNotes: string | null
  initialIncludeInFit: boolean
  showLabel?: boolean
}

export function JobNotes({ jobId, initialNotes, initialIncludeInFit, showLabel = false }: JobNotesProps) {
  const includeId = useId()
  const [saved, setSaved] = useState(initialNotes ?? '')
  const [savedIncludeInFit, setSavedIncludeInFit] = useState(initialIncludeInFit)
  const [draft, setDraft] = useState(saved)
  const [includeInFit, setIncludeInFit] = useState(initialIncludeInFit)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const hasNotes = saved.trim().length > 0
  const isDirty = draft !== saved || includeInFit !== savedIncludeInFit

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft(saved)
      setIncludeInFit(savedIncludeInFit)
    }
    setOpen(next)
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await updateJobNotes(jobId, draft, includeInFit)
        const trimmed = draft.trim()
        const effectiveIncludeInFit = trimmed ? includeInFit : false
        setSaved(trimmed)
        setDraft(trimmed)
        setSavedIncludeInFit(effectiveIncludeInFit)
        setIncludeInFit(effectiveIncludeInFit)
        setOpen(false)
        toast.success(trimmed ? 'Note saved.' : 'Note cleared.')
      } catch {
        toast.error('Failed to save note. Please try again.')
      }
    })
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        aria-label={hasNotes ? 'View note' : 'Add note'}
        title={hasNotes ? 'View note' : 'Add note'}
        className={cn(
          "flex items-center justify-center rounded-md transition-colors",
          showLabel ? "min-h-11 gap-2 border border-border px-3 text-sm text-muted-foreground" : "size-6",
          hasNotes
            ? "hover:bg-muted/50"
            : showLabel ? "hover:bg-muted hover:text-foreground" : "text-muted-foreground/40 hover:bg-muted hover:text-foreground",
        )}
      >
        <StickyNote
          size={14}
          className={hasNotes ? 'fill-amber-200 text-amber-500' : ''}
        />
        {showLabel && (hasNotes ? 'View note' : 'Add note')}
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="space-y-3">
          <p className="text-sm font-semibold">Notes</p>
          <Textarea
            value={draft}
            onChange={e => { setDraft(e.target.value); if (!e.target.value.trim()) setIncludeInFit(false) }}
            placeholder="Add a note..."
            rows={4}
            disabled={isPending}
            className="resize-none text-base md:text-xs"
          />
          <label htmlFor={includeId} className={cn(
            "flex min-h-11 items-center gap-2 text-sm cursor-pointer select-none md:min-h-0 md:text-xs",
            (!draft.trim() || isPending) ? "text-muted-foreground/40 cursor-not-allowed" : "text-muted-foreground",
          )}>
            <Checkbox
              id={includeId}
              checked={includeInFit}
              onCheckedChange={setIncludeInFit}
              disabled={isPending || !draft.trim()}
            />
            Include in job-fit assessment
          </label>
          <div className="flex justify-end gap-2 [&_button]:max-md:min-h-11">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isPending || !isDirty}
            >
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
