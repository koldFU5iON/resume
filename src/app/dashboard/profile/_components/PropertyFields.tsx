'use client'

import type { ReactNode } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { FieldStatus } from './use-field-saver'

/** One labelled property. The label is tied to its control; a problem is read out with it. */
export function PropertyRow({ id, label, problem, children, className }: {
  id: string
  label: string
  problem?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {problem && <p id={`${id}-problem`} role="alert" className="text-xs text-destructive">{problem}</p>}
    </div>
  )
}

/** Where a properties form says whether it has saved. */
export function PropertiesStatus({ status, failure }: { status: FieldStatus; failure: string | null }) {
  return (
    <div role="status" aria-live="polite" className="min-h-5 text-xs">
      {status === 'saving' && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden="true" />Saving…</span>}
      {status === 'saved' && <span className="flex items-center gap-1 text-muted-foreground"><Check className="size-3" aria-hidden="true" />Saved</span>}
      {status === 'error' && <span className="text-destructive">{failure}</span>}
    </div>
  )
}

/** Native control styling to match Input, for the select. */
export const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

export const toDateInput = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().split('T')[0] : '')
