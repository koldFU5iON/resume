'use client'

import React, { useState } from 'react'
import { Check, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { CVSection } from '@/modules/cv/schema'

class MarkdownPreview extends React.Component<
  { content: string },
  { errored: boolean }
> {
  constructor(props: { content: string }) {
    super(props)
    this.state = { errored: false }
  }

  static getDerivedStateFromError() {
    return { errored: true }
  }

  render() {
    if (this.state.errored) {
      return (
        <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed">
          {this.props.content}
        </pre>
      )
    }
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {this.props.content}
        </ReactMarkdown>
      </div>
    )
  }
}

type Props = {
  toolName: string
  args: Record<string, unknown>
  onAccept: () => void
  onReject: () => void
  writeAction?: () => Promise<string | CVSection | void>
}

const TOOL_LABELS: Record<string, string> = {
  propose_profile_update: 'Update profile field',
  propose_tool_create: 'Add tool to profile',
  propose_cv_update: 'Update CV section',
  propose_cv_section_create: 'Add CV section',
  propose_prep_note_update: 'Update prep note',
  propose_cover_letter_update: 'Update cover letter',
  propose_cover_letter_section_update: 'Update cover letter paragraph',
  submit_feedback: 'Submit feedback',
}

export function ToolConfirmationCard({ toolName, args, onAccept, onReject, writeAction }: Props) {
  const [pending, setPending] = useState(false)
  const label = TOOL_LABELS[toolName] ?? 'Proposed change'

  async function handleAccept() {
    if (!writeAction) { onAccept(); return }
    setPending(true)
    try {
      const result = await writeAction()
      if (toolName === 'propose_cv_update') {
        window.dispatchEvent(new CustomEvent('cv-section-updated', {
          detail: {
            sectionId: args.sectionId,
            section: result ?? (args.proposedData as Record<string, unknown>),
          },
        }))
      }
      if (toolName === 'propose_cv_section_create') {
        window.dispatchEvent(new CustomEvent('cv-section-created', {
          detail: { section: result },
        }))
      }
      if (toolName === 'propose_cover_letter_update') {
        window.dispatchEvent(new CustomEvent('cover-letter-updated', {
          detail: { letterId: args.letterId, proposedContent: args.proposedContent },
        }))
      }
      if (toolName === 'propose_cover_letter_section_update') {
        window.dispatchEvent(new CustomEvent('cover-letter-section-updated', {
          detail: {
            letterId: args.letterId,
            sectionId: args.sectionId,
            proposedContent: args.proposedContent,
            newContent: result,
          },
        }))
      }
      onAccept()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply change')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="w-full rounded-xl border border-border bg-background p-3 text-sm shadow-sm">
      <p className="mb-2 font-medium text-foreground">{label}</p>
      {args.rationale != null && (
        <p className="mb-3 text-xs text-muted-foreground">{String(args.rationale)}</p>
      )}
      {toolName !== 'propose_cover_letter_section_update' && (args.currentValue ?? args.currentContent) !== undefined && (
        <div className="mb-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 line-through dark:bg-red-950 dark:text-red-400">
          {String(args.currentValue ?? args.currentContent)}
        </div>
      )}
      {toolName === 'propose_cover_letter_update' && args.proposedContent != null && (
        <div className="mb-3 max-h-64 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          <MarkdownPreview content={String(args.proposedContent)} />
        </div>
      )}
      {toolName === 'propose_cover_letter_section_update' && (
        <>
          <p className="mb-1 text-[10px] text-muted-foreground">
            Paragraph {args.sectionIndex != null ? (args.sectionIndex as number) + 1 : '?'}
          </p>
          <div className="mb-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 line-through dark:bg-red-950 dark:text-red-400">
            {String(args.currentContent)}
          </div>
          <div className="mb-3 rounded-md bg-green-50 px-2.5 py-1.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-400">
            {String(args.proposedContent)}
          </div>
        </>
      )}
      {(() => {
        if (toolName === 'propose_cover_letter_update') return null
        if (toolName === 'propose_cover_letter_section_update') return null
        const display = args.proposedValue ?? args.proposedContent ??
          (args.name != null ? `${args.name}${args.category ? ` · ${args.category}` : ''}` : undefined) ??
          (args.heading != null ? `${args.heading} (${args.subtype ?? 'text'})` : undefined)
        return display !== undefined ? (
          <div className="mb-3 rounded-md bg-green-50 px-2.5 py-1.5 text-xs text-green-700 dark:bg-green-950 dark:text-green-400">
            {String(display)}
          </div>
        ) : null
      })()}
      <div className="flex gap-2">
        <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleAccept} disabled={pending}>
          {pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          {pending ? 'Applying…' : 'Accept'}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={onReject} disabled={pending}>
          <X className="size-3" />Decline
        </Button>
      </div>
    </div>
  )
}
