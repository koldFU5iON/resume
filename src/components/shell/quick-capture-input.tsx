'use client'

import { useState, useTransition } from 'react'
import { Loader2, Link as LinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { quickCaptureJob } from '@/modules/jobs/quick-capture'
import { cn } from '@/lib/utils'

export function QuickCaptureInput({ className, autoFocus, onCaptured }: {
  className?: string
  autoFocus?: boolean
  /** Called after a capture attempt finishes (e.g. to close the Add job dialog). */
  onCaptured?: (ok: boolean) => void
}) {
  const [value, setValue] = useState('')
  const [isPending, startTransition] = useTransition()

  function submit(url: string) {
    const trimmed = url.trim()
    if (!trimmed || !trimmed.startsWith('https://')) return
    startTransition(async () => {
      const result = await quickCaptureJob(trimmed)
      setValue('')
      onCaptured?.(result.ok)
      if (result.ok) {
        const href = `/dashboard/job-applications/view/${result.jobId}`
        const fn   = result.duplicate ? toast.info : toast.success
        fn(`${result.duplicate ? 'Already captured' : 'Captured'}: ${result.title} @ ${result.company}`, {
          action: { label: 'Review', onClick: () => { window.location.href = href } },
        })
      } else {
        const manualHref = `/dashboard/job-applications/create?url=${encodeURIComponent(trimmed)}`
        toast.error(result.error, {
          action: { label: 'Add manually', onClick: () => { window.location.href = manualHref } },
        })
      }
    })
  }

  return (
    <div className={cn('relative flex w-full items-center', className)}>
      {isPending
        ? <Loader2 className="absolute left-2.5 size-4 shrink-0 text-muted-foreground animate-spin" />
        : <LinkIcon className="absolute left-2.5 size-4 shrink-0 text-muted-foreground" />}
      <Input
        type="url"
        placeholder="Paste job URL…"
        disabled={isPending}
        aria-label="Job URL"
        autoFocus={autoFocus}
        className="h-9 pl-8 text-sm"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(e.currentTarget.value) } }}
        onPaste={e => {
          const pasted = e.clipboardData.getData('text').trim()
          if (pasted.startsWith('https://')) setTimeout(() => submit(pasted), 0)
        }}
      />
    </div>
  )
}
