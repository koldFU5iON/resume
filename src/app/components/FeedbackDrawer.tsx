'use client'

import { useState, useTransition } from 'react'
import { usePathname } from 'next/navigation'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { createFeedbackIssue, type FeedbackType } from '@/modules/feedback/actions'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const TYPES: { value: FeedbackType; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'idea', label: 'Idea' },
  { value: 'other', label: 'Other' },
]

const DESCRIPTION_PLACEHOLDERS: Record<FeedbackType, string> = {
  bug: 'Steps to reproduce, or anything else useful…',
  idea: 'What problem would this solve?…',
  other: 'Any extra context…',
}

const FALLBACK_URL = 'https://github.com/koldFU5iON/currnt/issues/new'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Prefills the form (e.g. a failure's technical details); kept after a reset. */
  initial?: { title?: string; description?: string }
}

export function FeedbackDrawer({ open, onOpenChange, initial }: Props) {
  const isMobile = useIsMobile()
  const pathname = usePathname()

  const [type, setType] = useState<FeedbackType>('bug')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [isPending, startTransition] = useTransition()

  function reset() {
    setType('bug')
    setTitle(initial?.title ?? '')
    setDescription(initial?.description ?? '')
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  function handleSubmit() {
    startTransition(async () => {
      const result = await createFeedbackIssue(type, title, description, pathname)
      if (result.ok) {
        toast.success('Issue filed — thanks!')
        handleOpenChange(false)
      } else {
        toast.error(result.message, {
          action: {
            label: 'Open on GitHub',
            onClick: () => {
              window.open(
                `${FALLBACK_URL}?title=${encodeURIComponent(title)}`,
                '_blank',
              )
            },
          },
        })
      }
    })
  }

  const typeToggle = (
    <div className="flex gap-1 rounded-md bg-muted p-1">
      {TYPES.map(t => (
        <button
          key={t.value}
          type="button"
          onClick={() => setType(t.value)}
          disabled={isPending}
          className={cn(
            'flex-1 rounded px-3 py-1 text-xs font-medium transition-colors',
            type === t.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

  const formFields = (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); handleSubmit() }}>
      {typeToggle}
      <div className="space-y-1.5">
        <Label htmlFor="feedback-title">Title</Label>
        <Input
          id="feedback-title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Short description…"
          maxLength={256}
          disabled={isPending}
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="feedback-description">
          Description{' '}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="feedback-description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={DESCRIPTION_PLACEHOLDERS[type]}
          rows={3}
          disabled={isPending}
          className="resize-none text-sm"
        />
      </div>
    </form>
  )

  const submitButton = (
    <Button
      type="submit"
      size="sm"
      className="min-w-28"
      onClick={handleSubmit}
      disabled={isPending || !title.trim()}
    >
      {isPending ? 'Submitting…' : 'Submit report'}
    </Button>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} repositionInputs={false}>
        <DrawerContent className="max-h-[90vh] flex flex-col overflow-hidden">
          <DrawerHeader>
            <DrawerTitle>Report an issue</DrawerTitle>
            <DrawerDescription>Tell us what you ran into or share an idea.</DrawerDescription>
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-2">{formFields}</div>
          <DrawerFooter className="flex-row justify-end gap-2">
            <DrawerClose asChild>
              <Button type="button" variant="outline" size="sm" className="min-w-28" disabled={isPending}>
                Cancel
              </Button>
            </DrawerClose>
            {submitButton}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => handleOpenChange(next)}>
      <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Report an issue</DialogTitle>
          <DialogDescription>Tell us what you ran into or share an idea.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-4">{formFields}</div>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" size="sm" className="min-w-28" disabled={isPending} />}>
            Cancel
          </DialogClose>
          {submitButton}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
