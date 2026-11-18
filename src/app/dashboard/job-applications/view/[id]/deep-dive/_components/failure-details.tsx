'use client'

import { useState } from "react"
import { Bug, Check, ChevronRight, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { FeedbackDrawer } from "@/app/components/FeedbackDrawer"

/** Collapsed technical cause of a failed run, with Copy and Report an issue. */
export function FailureDetails({ detail, runId, jobId }: { detail: string; runId: string; jobId: string }) {
  const [copied, setCopied] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const text = `${detail}\n\nDeep dive run: ${runId}\nJob: ${jobId}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success("Details copied")
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy to the clipboard")
    }
  }

  return (
    <details className="group rounded-md border border-border/60 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
        Technical details
      </summary>
      <div className="space-y-3 border-t border-border/60 px-3 py-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-muted-foreground">{text}</pre>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={copy}>
            {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setReportOpen(true)}>
            <Bug className="size-3.5" aria-hidden="true" />
            Report an issue
          </Button>
        </div>
      </div>
      <FeedbackDrawer
        key={runId}
        open={reportOpen}
        onOpenChange={setReportOpen}
        initial={{ title: 'Deep dive failed', description: `The deep dive failed with:\n\n${text}` }}
      />
    </details>
  )
}
