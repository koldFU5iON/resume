'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { parseUrlsFromText } from '@/modules/jobs/batch-capture'

type UrlStatus =
  | { status: 'pending' }
  | { status: 'processing' }
  | { status: 'success'; job: { id: string; title: string; company: string }; created: boolean }
  | { status: 'failed'; error: string }

type Step = 'input' | 'processing' | 'done'

type DoneSummary = { added: number; existing: number; failed: number }

export function BatchCaptureDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('input')
  const [text, setText] = useState('')
  const [urls, setUrls] = useState<string[]>([])
  const [statuses, setStatuses] = useState<Map<number, UrlStatus>>(new Map())
  const [summary, setSummary] = useState<DoneSummary | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const parsedCount = parseUrlsFromText(text).length
  const atCap = parsedCount >= 50

  function handleStart() {
    const parsed = parseUrlsFromText(text)
    if (parsed.length === 0) return
    setUrls(parsed)
    setStatuses(new Map(parsed.map((_, i) => [i, { status: 'pending' } as UrlStatus])))
    setStep('processing')
    runBatch(parsed)
  }

  async function runBatch(urlList: string[]) {
    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch('/api/jobs/batch-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urlList }),
        signal: abort.signal,
      })

      if (!res.ok || !res.body) {
        setSummary({ added: 0, existing: 0, failed: urlList.length })
        setStep('done')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) {
          const line = chunk.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'done') {
              setSummary({ added: event.added, existing: event.existing, failed: event.failed })
              setStep('done')
              router.refresh()
            } else if (typeof event.index === 'number') {
              setStatuses(prev => {
                const next = new Map(prev)
                if (event.status === 'success') {
                  next.set(event.index, { status: 'success', job: event.job, created: event.created })
                } else if (event.status === 'failed') {
                  next.set(event.index, { status: 'failed', error: event.error })
                } else {
                  next.set(event.index, { status: 'processing' })
                }
                return next
              })
            }
          } catch { /* malformed SSE chunk — skip */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setSummary({ added: 0, existing: 0, failed: urlList.length })
        setStep('done')
      }
    }
  }

  function handleClose() {
    if (step === 'processing') return
    abortRef.current?.abort()
    setStep('input')
    setText('')
    setUrls([])
    setStatuses(new Map())
    setSummary(null)
    onOpenChange(false)
  }

  const processedCount = [...statuses.values()].filter(
    s => s.status !== 'pending' && s.status !== 'processing',
  ).length

  const failedUrls = urls.filter((_, i) => statuses.get(i)?.status === 'failed')

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-md:max-h-[90dvh] max-md:overflow-y-auto max-md:[&_button]:min-h-11 max-md:[&_[data-slot=dialog-close]]:size-11">
        <DialogHeader>
          <DialogTitle>Batch Add Jobs</DialogTitle>
        </DialogHeader>

        {step === 'input' && (
          <div className="space-y-4">
            <Textarea
              placeholder="Paste job URLs, one per line or comma-separated"
              value={text}
              onChange={e => setText(e.target.value)}
              rows={8}
              className="min-h-40 resize-none text-base md:font-mono md:text-xs"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {parsedCount === 0
                  ? 'No URLs detected'
                  : atCap
                    ? '50 URLs detected (maximum)'
                    : `${parsedCount} URL${parsedCount === 1 ? '' : 's'} detected`}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={parsedCount === 0} onClick={handleStart}>
                  Start Import
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="space-y-3">
            <Progress value={urls.length > 0 ? (processedCount / urls.length) * 100 : 0} />
            <p className="text-xs text-muted-foreground text-right">
              {processedCount} / {urls.length} processed
            </p>
            <div className="max-h-72 overflow-y-auto overflow-x-hidden space-y-1 pr-1">
              {urls.map((url, i) => {
                const s = statuses.get(i) ?? { status: 'pending' as const }
                return (
                  <div key={i} className="flex items-start gap-2 py-0.5 text-xs">
                    <StatusIcon status={s.status} />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-mono text-muted-foreground">{url}</p>
                      {s.status === 'success' && (
                        <p className="text-foreground">{s.job.title} — {s.job.company}</p>
                      )}
                      {s.status === 'failed' && (
                        <p className="text-destructive">{s.error}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {step === 'done' && summary && (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="font-medium">{summary.added} added</span>
              {summary.existing > 0 && (
                <span className="text-muted-foreground"> · {summary.existing} already existed</span>
              )}
              {summary.failed > 0 && (
                <span className="text-destructive"> · {summary.failed} failed</span>
              )}
            </p>
            {failedUrls.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Failed URLs</p>
                <Textarea
                  readOnly
                  value={failedUrls.join('\n')}
                  rows={Math.min(failedUrls.length + 1, 5)}
                  className="font-mono text-xs resize-none"
                />
              </div>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={handleClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StatusIcon({ status }: { status: UrlStatus['status'] }) {
  switch (status) {
    case 'pending':    return <Circle size={14} className="mt-0.5 shrink-0 text-muted-foreground/40" />
    case 'processing': return <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-muted-foreground" />
    case 'success':    return <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-green-500" />
    case 'failed':     return <XCircle size={14} className="mt-0.5 shrink-0 text-destructive" />
  }
}
