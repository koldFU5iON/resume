'use client'

import { useState } from 'react'
import { isTextUIPart, isToolUIPart, getToolName, type UIMessage } from 'ai'
import { Bot, Check, Copy, User, Loader2, ChevronRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { splitThinkingContent } from '@/modules/chat/thinking'
import type React from 'react'

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children)
  }
  return ''
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(extractText(children)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className="group/code relative my-2">
      <pre className="overflow-x-auto rounded-md bg-black/10 p-2 pr-8 text-xs dark:bg-white/10">
        {children}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity group-hover/code:opacity-100 hover:bg-black/10 hover:text-muted-foreground"
        aria-label="Copy code"
      >
        {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
      </button>
    </div>
  )
}
import { patchCVSectionData, addCustomSection } from '@/modules/cv/actions'
import type { CVSection } from '@/modules/cv/schema'
import { patchProfileField, createTool } from '@/modules/profile/actions'
import { updateBlock } from '@/modules/interview-prep/actions'
import { updateCoverLetterContent, updateCoverLetterSection } from '@/modules/cover-letters/actions'
import { ToolConfirmationCard } from './tool-confirmation-card'
import { FeedbackSubmissionCard } from './feedback-submission-card'

function buildWriteAction(toolName: string, args: Record<string, unknown>): (() => Promise<string | CVSection | void>) | undefined {
  if (toolName === 'propose_cv_update') {
    return () => patchCVSectionData(
      args.cvId as string,
      args.sectionId as string,
      args.proposedData as Record<string, unknown>,
    )
  }
  if (toolName === 'propose_cv_section_create') {
    return () => addCustomSection(args.cvId as string, args.heading as string, args.subtype as 'text' | 'list')
  }
  if (toolName === 'propose_profile_update') {
    return () => patchProfileField(args.field as string, args.proposedValue as string)
  }
  if (toolName === 'propose_tool_create') {
    return async () => { await createTool({ name: args.name as string, category: args.category as string | undefined }) }
  }
  if (toolName === 'propose_prep_note_update') {
    return () => updateBlock(
      args.noteId as string,
      args.blockId as string,
      { content: args.proposedContent as string },
    )
  }
  if (toolName === 'propose_cover_letter_update') {
    return () => updateCoverLetterContent(
      args.letterId as string,
      args.proposedContent as string,
    )
  }
  if (toolName === 'propose_cover_letter_section_update') {
    return () => updateCoverLetterSection(
      args.letterId as string,
      args.sectionId as string,
      args.proposedContent as string,
    )
  }
  return undefined
}

type ChatMessageProps = {
  message: UIMessage
  onToolOutput: (toolCallId: string, toolName: string, output: unknown) => void
}

export function ChatMessage({ message, onToolOutput }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  function handleCopy(text: string, idx: number) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 2000)
    }).catch(() => {})
  }

  // Navigation breadcrumbs and system pills — render as subtle centred dividers.
  const navText = message.parts?.find(p => isTextUIPart(p))?.text ?? ''
  const navMatch = navText.match(/^\[navigated to (.+)\]$/)
  if (navMatch) {
    return (
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="h-px flex-1 bg-border" />
        <span className="shrink-0 text-[10px] text-muted-foreground">{navMatch[1]}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    )
  }
  if (navText === '[conversation summarised]') {
    return (
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="h-px flex-1 bg-border" />
        <span className="shrink-0 text-[10px] text-muted-foreground">Context saved</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    )
  }

  return (
    <div className={cn('flex gap-2.5 px-4 py-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>

      <div className={cn('flex max-w-[85%] flex-col gap-2', isUser && 'items-end')}>
        {message.parts?.map((part, i) => {
          if (isTextUIPart(part)) {
            const { content, isThinking } = isUser
              ? { content: part.text, isThinking: false }
              : splitThinkingContent(part.text)
            return (
              <div key={`text-${i}`} className="group/msg">
                {isThinking && !isUser && (
                  <div className="mb-2 flex items-center gap-1.5 rounded-lg border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    Thinking…
                  </div>
                )}
                {content && (
                  <div
                    className={cn(
                      'rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                      isUser
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground',
                    )}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="mb-1 ml-4 list-disc last:mb-0">{children}</ul>,
                        ol: ({ children }) => <ol className="mb-1 ml-4 list-decimal last:mb-0">{children}</ol>,
                        li: ({ children }) => <li className="mb-0.5">{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                        code: ({ children }) => (
                          <code className="rounded bg-black/10 px-1 py-0.5 text-xs font-mono dark:bg-white/10">
                            {children}
                          </code>
                        ),
                        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
                      }}
                    >
                      {content}
                    </ReactMarkdown>
                  </div>
                )}
                {!isUser && (
                  <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100">
                    <button
                      onClick={() => handleCopy(content, i)}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Copy message"
                    >
                      {copiedIdx === i
                        ? <><Check className="size-3 text-green-500" /><span>Copied</span></>
                        : <><Copy className="size-3" /><span>Copy</span></>
                      }
                    </button>
                  </div>
                )}
              </div>
            )
          }

          if (isToolUIPart(part)) {
            const toolName = getToolName(part)
            const isWriteTool = toolName.startsWith('propose_')
            const { state } = part

            if (state === 'input-available' && toolName === 'submit_feedback') {
              const input = part.input as { type: 'bug' | 'idea'; title: string; description: string }
              return (
                <FeedbackSubmissionCard
                  key={part.toolCallId}
                  toolCallId={part.toolCallId}
                  type={input.type}
                  title={input.title}
                  description={input.description}
                  onResult={(toolCallId, output) => onToolOutput(toolCallId, 'submit_feedback', output)}
                />
              )
            }

            if (state === 'input-available' && isWriteTool) {
              const toolArgs = part.input as Record<string, unknown>
              return (
                <ToolConfirmationCard
                  key={part.toolCallId}
                  toolName={toolName}
                  args={toolArgs}
                  writeAction={buildWriteAction(toolName, toolArgs)}
                  onAccept={() => onToolOutput(part.toolCallId, toolName, { status: 'accepted' })}
                  onReject={() => onToolOutput(part.toolCallId, toolName, { status: 'rejected' })}
                />
              )
            }

            if (state === 'input-streaming' && isWriteTool) {
              return (
                <div
                  key={part.toolCallId}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <Loader2 className="size-3 animate-spin" />
                  {toolName.replace(/^propose_/, '').replace(/_/g, ' ')} — thinking…
                </div>
              )
            }

            if ((state === 'input-available' || state === 'input-streaming') && !isWriteTool) {
              return (
                <div
                  key={part.toolCallId}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <Loader2 className="size-3 animate-spin" />
                  Looking up {toolName.replace(/_/g, ' ')}…
                </div>
              )
            }

            if (state === 'output-available' && toolName === 'submit_feedback') {
              const output = part.output as { status: string } | null
              return (
                <div
                  key={part.toolCallId}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <ChevronRight className="size-3" />
                  {output?.status === 'submitted' ? 'Feedback submitted' : 'Feedback cancelled'}
                </div>
              )
            }

            if (state === 'output-available' && isWriteTool) {
              const output = part.output as { status: string } | null
              return (
                <div
                  key={part.toolCallId}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <ChevronRight className="size-3" />
                  {output?.status === 'accepted' ? 'Change accepted' : 'Change declined'}
                </div>
              )
            }

            return null
          }

          return null
        })}
      </div>
    </div>
  )
}
