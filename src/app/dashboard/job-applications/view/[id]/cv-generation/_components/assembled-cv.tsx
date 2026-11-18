"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { WritingDeskPreview } from "@/app/components/writing-desk-preview"
import { assembledSummary } from "@/app/dashboard/job-applications/_components/cv-generation-view"
import { LogSection } from "./log-sections"
import type { CvAssembled } from "@/modules/cv-generation/schema"

/**
 * The assembled CV, rendered with the writing desk's own preview (no editor),
 * with the Markdown behind a disclosure and a copy button. The header carries
 * the literal {{contact}} placeholder: contact details are filled in only when
 * a draft is accepted (a later phase), so the preview shows it as written.
 * The preview renders no images and no links: the text is model-written and
 * not yet reviewed (writers also strip them, write/plain.ts).
 */
export function AssembledCvPanel({ assembled }: { assembled: CvAssembled }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(assembled.markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy. Select the Markdown and copy it by hand.")
    }
  }

  return (
    <LogSection
      id="assembled"
      level={2}
      title="Assembled CV"
      titleClassName="text-lg font-semibold tracking-[-0.01em]"
      actions={
        <Button variant="outline" size="sm" className="gap-1.5" onClick={copy}>
          {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          {copied ? "Copied" : "Copy Markdown"}
        </Button>
      }
    >
      <p className="mt-1 text-sm text-muted-foreground">{assembledSummary(assembled)}. Contact details are added when a draft is accepted, so the header shows a placeholder.</p>
      <div className="mt-4 rounded-lg border bg-card px-5 py-5">
        <WritingDeskPreview markdown={assembled.markdown} documentType="cv" blockRemoteContent />
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Markdown</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">{assembled.markdown}</pre>
      </details>
    </LogSection>
  )
}
