"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ClipboardCopy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { copyText } from "./copy-text"

/**
 * "Copy log": copies the whole run (header, Brief, Selection, every stage,
 * the assembled CV) as readable Markdown, built on the server by
 * `runLogMarkdown`. The clipboard API where it exists, a hidden textarea where
 * it does not (an insecure context, an older browser); an error toast when
 * neither works. "Copied" is announced to screen readers through a polite
 * live region as well as shown on the button.
 */
export function CopyLogButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function copy() {
    if (await copyText(text)) {
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error("Couldn't copy the log. Your browser blocked clipboard access.")
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={copy}>
        {copied ? <Check className="size-3.5" aria-hidden="true" /> : <ClipboardCopy className="size-3.5" aria-hidden="true" />}
        {copied ? "Copied" : "Copy log"}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">{copied ? "Log copied to the clipboard" : ""}</span>
    </>
  )
}
