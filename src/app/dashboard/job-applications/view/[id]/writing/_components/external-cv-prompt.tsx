"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { getExternalCvPromptAction } from "@/modules/writing-desk/actions"

export function ExternalCvPrompt({ documentId }: { documentId: string }) {
  const [prompt, setPrompt] = useState("")
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const requestId = useRef(0)

  async function loadPrompt() {
    const id = ++requestId.current
    setLoading(true)
    setFailed(false)
    setPrompt("")
    try {
      const next = await getExternalCvPromptAction(documentId)
      if (id === requestId.current) setPrompt(next)
    } catch {
      if (id === requestId.current) setFailed(true)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      toast.success("CV prompt copied")
    } catch {
      toast.error("Could not copy. Select the prompt below and copy it manually.")
    }
  }

  return (
    <Sheet onOpenChange={open => { if (open) void loadPrompt() }}>
      <SheetTrigger render={<Button variant="outline" size="sm" className="h-7 text-xs" />}>
        CV prompt
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader className="pr-12">
          <SheetTitle>Draft a CV in your own AI app</SheetTitle>
          <SheetDescription>
            Copy this prompt into ChatGPT, Claude or another LLM. It includes your saved deep-dive CV strategy and the supported CV blocks.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-6">
          <p className="text-sm text-muted-foreground">
            Enable your resume / currnt MCP connection so your AI app can read your profile. <Link href="/dashboard/settings/api-tokens" className="underline underline-offset-4">Connection settings</Link>
          </p>
          <p className="text-sm text-muted-foreground">
            Paste the returned code block contents into the Markdown editor, then check Preview. Replace {"{{contact}}"} with your contact details before exporting.
          </p>
          {loading && <p role="status" className="text-sm text-muted-foreground">Preparing your prompt…</p>}
          {failed && (
            <div role="alert" className="space-y-2">
              <p className="text-sm">Could not load the CV prompt. Check your connection and try again.</p>
              <Button variant="outline" size="sm" onClick={() => void loadPrompt()}>Try again</Button>
            </div>
          )}
          {prompt && !loading && (
            <>
              <Button className="self-start" onClick={() => void copyPrompt()}><Copy className="size-4" aria-hidden="true" />Copy CV prompt</Button>
              <textarea
                aria-label="CV drafting prompt"
                readOnly
                value={prompt}
                className="min-h-48 flex-1 resize-none rounded-md border bg-background p-3 font-mono text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
