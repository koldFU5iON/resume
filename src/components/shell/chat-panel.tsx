'use client'

import React, { useEffect, useRef, useState, useTransition } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, isTextUIPart, isToolUIPart, type UIMessage } from 'ai'
import { Sparkles, X, Send, Bot, SquarePen, Maximize2, Minimize2, FileText, Briefcase, Mail, ClipboardList, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { usePageContext } from '@/lib/context/page-context'
import type { PageContext } from '@/modules/chat/schema'
import { getChatSettings, saveChatModel } from '@/modules/llm/actions'
import { splitThinkingContent } from '@/modules/chat/thinking'
import { ChatMessage } from './chat-message'
import { toast } from 'sonner'

type ChatSettings = {
  chatModel: string | null
  llmModel: string
  availableModels: { id: string; name: string }[] | null
  configured: boolean
}

const IDLE_TIMEOUT_MS = 10 * 60 * 1000
const SESSION_STORAGE_KEY = 'chat-session-messages'
// Must match HISTORY_WINDOW in src/app/api/chat/stream/route.ts
const HISTORY_WINDOW = 20

type SavedMessage = { id: string; role: 'user' | 'assistant'; text: string }

function persistMessages(messages: UIMessage[]) {
  try {
    const saved: SavedMessage[] = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        text: m.parts
          ?.filter(isTextUIPart)
          .map(p => m.role === 'assistant' ? splitThinkingContent(p.text).content : p.text)
          .join('\n') ?? '',
      }))
      .filter(m => m.text && !m.text.startsWith('[navigated to '))
    if (saved.length > 0) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(saved))
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
    }
  } catch { /* sessionStorage unavailable */ }
}

function restoreMessages(): UIMessage[] {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return []
    const saved = JSON.parse(raw) as SavedMessage[]
    return saved.map(m => ({
      id: m.id,
      role: m.role,
      content: m.text,
      parts: [{ type: 'text' as const, text: m.text }],
      createdAt: new Date(),
    }))
  } catch {
    return []
  }
}

function navKey(ctx: PageContext | null): string {
  if (!ctx) return ''
  switch (ctx.type) {
    case 'cv': return `cv:${ctx.cvId}`
    case 'job_fit': return `job_fit:${ctx.jobId}`
    case 'cover_letter': return `cover_letter:${ctx.letterId}`
    case 'interview_prep': return `interview_prep:${ctx.sessionId}`
    case 'job_application': return `job_application:${ctx.jobId}`
    case 'profile': return 'profile'
  }
}

const CONTEXT_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; label: (ctx: PageContext) => string }
> = {
  cv: {
    icon: FileText,
    label: (ctx) => `CV${ctx.type === 'cv' && ctx.company ? ` · ${ctx.company}` : ''}`,
  },
  job_fit: {
    icon: Briefcase,
    label: (ctx) => `Job fit${ctx.type === 'job_fit' && ctx.company ? ` · ${ctx.company}` : ''}`,
  },
  cover_letter: {
    icon: Mail,
    label: (ctx) =>
      `Cover letter${ctx.type === 'cover_letter' && ctx.company ? ` · ${ctx.company}` : ''}`,
  },
  interview_prep: {
    icon: ClipboardList,
    label: (ctx) =>
      `Interview prep${ctx.type === 'interview_prep' && ctx.company ? ` · ${ctx.company}` : ''}`,
  },
  profile: {
    icon: User,
    label: (ctx) =>
      `Profile${ctx.type === 'profile' && ctx.activeExperienceName ? ` · ${ctx.activeExperienceName}` : ''}`,
  },
}

type ChatPanelProps = {
  open: boolean
  onClose: () => void
}

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const { context } = usePageContext()
  const contextRef = useRef(context)
  const prevContextRef = useRef(context)
  useEffect(() => { contextRef.current = context }, [context])

  const [settings, setSettings] = useState<ChatSettings | null>(null)
  const [input, setInput] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [modelSaving, startModelSave] = useTransition()
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore prior session lazily (client-only — avoids SSR issues)
  const [initialMessages] = useState<UIMessage[]>(() => restoreMessages())

  const { messages, sendMessage, status, addToolOutput, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat/stream',
      // body is called fresh on every send — always captures the latest context
      body: () => ({ pageContext: contextRef.current }),
    }),
    messages: initialMessages,
    onError: () => toast.error('Something went wrong. Try again.'),
  })

  // Persist messages to sessionStorage on every update
  useEffect(() => { persistMessages(messages) }, [messages])

  useEffect(() => {
    if (status !== 'ready') return
    setMessages(current => current.map(message => ({
      ...message,
      parts: message.parts?.map(part =>
        message.role === 'assistant' && isTextUIPart(part)
          ? { ...part, text: splitThinkingContent(part.text).content }
          : part,
      ),
    })))
  }, [setMessages, status])

  useEffect(() => {
    if (open && !settings) {
      getChatSettings()
        .then(setSettings)
        .catch(() => toast.error('Failed to load chat settings'))
    }
  }, [open, settings])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // When the user navigates to a new page mid-conversation, inject a brief navigation
  // marker so the LLM has an explicit in-history signal (system prompt alone is invisible
  // to the conversation thread).
  useEffect(() => {
    const prev = prevContextRef.current
    prevContextRef.current = context
    if (!context) return
    if (navKey(prev) === navKey(context)) return
    // Only inject if a conversation is already in progress — no need to pollute a fresh chat
    setMessages(msgs => {
      if (msgs.length === 0) return msgs
      const meta = CONTEXT_META[context.type]
      const label = meta?.label(context) ?? context.type
      return [
        ...msgs,
        {
          id: `nav-${Date.now()}`,
          role: 'user' as const,
          content: `[navigated to ${label}]`,
          parts: [{ type: 'text' as const, text: `[navigated to ${label}]` }],
          createdAt: new Date(),
        },
      ]
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context])

  useEffect(() => {
    if (open) {
      // Small rAF so the panel has finished its CSS transition before focusing
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [])

  function resetIdleTimer() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      submitSummarize(() => {
        setMessages(msgs => [
          ...msgs,
          {
            id: `summarised-${Date.now()}`,
            role: 'user' as const,
            content: '[conversation summarised]',
            parts: [{ type: 'text' as const, text: '[conversation summarised]' }],
            createdAt: new Date(),
          },
        ])
      })
    }, IDLE_TIMEOUT_MS)
  }

  function submitSummarize(afterSuccess?: () => void) {
    if (messages.length < 2) return
    const body = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.parts?.find(p => isTextUIPart(p))?.text ?? '',
      }))
      .filter(m => m.content)
    if (body.length < 2) return
    fetch('/api/chat/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: body }),
    })
      .then(() => {
        sessionStorage.removeItem(SESSION_STORAGE_KEY)
        afterSuccess?.()
      })
      .catch(() => {})
  }

  function handleClose() {
    onClose()
  }

  function handleNewChat() {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
    submitSummarize()
    setMessages([])
  }

  function handleModelChange(model: string | null) {
    if (!model || !settings) return
    setSettings(prev => (prev ? { ...prev, chatModel: model } : prev))
    startModelSave(async () => {
      try {
        await saveChatModel(model)
      } catch {
        toast.error('Failed to save model preference')
      }
    })
  }

  function handleSend() {
    const trimmed = input.trim()
    if (!trimmed || status === 'streaming' || status === 'submitted') return
    setInput('')
    resetIdleTimer()
    sendMessage({ text: trimmed })
  }

  const isLoading = status === 'streaming' || status === 'submitted'
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null
  // Suppress the thinking indicator only when the assistant is already visibly producing
  // content — either streaming text or showing a tool-call spinner in the message body.
  // This keeps the indicator visible during multi-step gaps (tool completed, next text
  // not yet started) so users always have a signal that work is in progress.
  const lastAssistantHasText =
    lastMessage?.role === 'assistant' &&
    lastMessage.parts?.some(p => isTextUIPart(p) && p.text.trim().length > 0)
  const lastAssistantHasActiveToolCall =
    lastMessage?.role === 'assistant' &&
    lastMessage.parts?.some(
      p => isToolUIPart(p) && (p.state === 'input-streaming' || p.state === 'input-available'),
    )
  const showThinking = isLoading && !lastAssistantHasText && !lastAssistantHasActiveToolCall
  const activeModel = settings?.chatModel ?? settings?.llmModel ?? ''
  const modelOptions = settings?.availableModels ?? []

  // Count substantive turns (exclude nav markers injected on page change)
  const turnCount = messages.filter(m => {
    if (m.role !== 'user' && m.role !== 'assistant') return false
    const text = m.parts?.filter(isTextUIPart).map(p => p.text).join('') ?? ''
    return !text.startsWith('[navigated to ')
  }).length
  const windowFill = Math.min(turnCount / HISTORY_WINDOW, 1)
  const windowFull = turnCount >= HISTORY_WINDOW
  const showContextBar = turnCount >= 6

  if (!open) return null

  return (
    <aside
      className={cn(
        'flex h-full w-full flex-col border-l bg-background',
        'fixed inset-y-0 right-0 z-40 max-w-sm shadow-lg md:static md:z-auto md:w-[28rem] md:max-w-none md:shadow-none lg:w-[36rem] xl:w-[44rem]',
      )}
      aria-label="Career coach assistant"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-muted-foreground" />
          Career Coach
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleNewChat}
              aria-label="New chat"
              title="New chat"
              disabled={isLoading}
            >
              <SquarePen className="size-4" />
            </Button>
          )}
          {modelOptions.length > 0 && (
            <Select
              value={activeModel}
              onValueChange={handleModelChange}
              disabled={modelSaving}
            >
              <SelectTrigger className="h-7 w-40 text-xs">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map(m => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleClose}
            aria-label="Close assistant"
          >
            <X />
          </Button>
        </div>
      </header>

      {context && (() => {
        const meta = CONTEXT_META[context.type]
        const Icon = meta?.icon
        const label = meta?.label(context) ?? context.type
        return (
          <div
            key={JSON.stringify(context)}
            className="flex shrink-0 items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground animate-in fade-in slide-in-from-top-1 duration-200"
          >
            {Icon && <Icon className="size-3 shrink-0" />}
            <span className="truncate">{label}</span>
          </div>
        )
      })()}

      <div className="flex flex-1 flex-col overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-muted">
              <Sparkles className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">
              {settings?.configured === false
                ? 'Set up your API key to get started'
                : "I'm your career coach"}
            </p>
            <p className="max-w-[14rem] text-xs text-muted-foreground">
              {settings?.configured === false
                ? 'Go to Settings → LLM to add your key.'
                : 'Ask me anything about your profile, applications, or interview prep.'}
            </p>
          </div>
        ) : (
          messages.map(m => (
            <ChatMessage
              key={m.id}
              message={m}
              onToolOutput={(toolCallId, toolName, output) =>
                addToolOutput({
                  toolCallId,
                  output: output as never,
                  tool: toolName as never,
                })
              }
            />
          ))
        )}
        {showThinking && (
          <div className="flex gap-2.5 px-4 py-3">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Bot className="size-3.5" />
            </div>
            <div className="flex items-center gap-1 rounded-2xl bg-muted px-3.5 py-2">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {showContextBar && (
        <div className="shrink-0 border-t px-3 py-1.5">
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {windowFull ? `Last ${HISTORY_WINDOW} turns` : `${turnCount} / ${HISTORY_WINDOW} turns`}
            </span>
            {windowFull && (
              <span className="text-amber-500">older context summarised</span>
            )}
          </div>
          <div className="h-0.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                windowFill >= 0.8 ? 'bg-amber-500' : 'bg-primary/50',
              )}
              style={{ width: `${windowFill * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="border-t p-3">
        <div className="relative">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask your coach…"
            className={cn(
              'resize-none pr-8 text-sm transition-all',
              expanded ? 'min-h-[160px]' : 'min-h-[60px] max-h-[60px]',
            )}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={expanded ? 'Collapse input' : 'Expand input'}
          >
            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={handleSend}
            disabled={isLoading || !input.trim() || settings?.configured === false}
            className="gap-1.5"
          >
            <Send className="size-3.5" />
            Send
          </Button>
        </div>
      </div>
    </aside>
  )
}
