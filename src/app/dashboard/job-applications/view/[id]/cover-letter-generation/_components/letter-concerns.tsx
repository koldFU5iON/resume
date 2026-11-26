"use client"

import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { openCoachWithDraft } from "@/components/shell/coach-handoff"
import { concernCoachMessage } from "@/app/dashboard/job-applications/_components/cover-letter-view"

type Concern = { kind: string; why: string; suggestion: string }

/** The review's concerns, each with a suggestion, and one button that opens the coach with them typed (never sent). */
export function LetterConcerns({ concerns, job }: { concerns: Concern[]; job: { title: string; company: string | null } }) {
  if (concerns.length === 0) return null
  return (
    <section aria-labelledby="letter-concerns" className="space-y-3 rounded-lg border p-4">
      <h3 id="letter-concerns" className="font-medium">Worth a look before you send it</h3>
      <ul className="space-y-3">
        {concerns.map((c, i) => (
          <li key={i} className="text-sm">
            <p>{c.why}</p>
            <p className="mt-0.5 text-muted-foreground">{c.suggestion}</p>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => openCoachWithDraft(concernCoachMessage(concerns, job))}>
        <MessageSquare className="size-3.5" aria-hidden="true" />
        Discuss with coach
      </Button>
    </section>
  )
}
