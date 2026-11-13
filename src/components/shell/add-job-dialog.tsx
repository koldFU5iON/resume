"use client"

import Link from "next/link"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { usePageContext } from "@/lib/context/page-context"
import { QuickCaptureInput } from "./quick-capture-input"

/** Quick add job, opened from the sidebar or the command palette. Capture runs in the background; the toast links to the job. */
export function AddJobDialog() {
  const { addJobOpen, setAddJobOpen } = usePageContext()

  return (
    <Dialog open={addJobOpen} onOpenChange={setAddJobOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add job</DialogTitle>
          <DialogDescription>
            Paste a job listing URL. We capture it and queue its assessment without leaving this page.
          </DialogDescription>
        </DialogHeader>
        <QuickCaptureInput autoFocus onCaptured={(ok) => { if (ok) setAddJobOpen(false) }} />
        <p className="text-xs text-muted-foreground">
          No link?{" "}
          <Link
            href="/dashboard/job-applications/create"
            onClick={() => setAddJobOpen(false)}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Enter the details manually
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  )
}
