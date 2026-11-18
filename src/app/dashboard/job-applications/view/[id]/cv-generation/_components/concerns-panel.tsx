"use client"

import { CircleAlert, MessageCircle } from "lucide-react"
import { LogSection } from "./log-sections"
import { Button } from "@/components/ui/button"
import { openCoachWithDraft } from "@/components/shell/coach-handoff"
import {
  allConcernsCoachMessage,
  concernCoachMessage,
  type ConcernRow,
} from "@/app/dashboard/job-applications/_components/cv-generation-view"

/**
 * The reviewer's concerns, as suggestions to talk through (never a gate: the
 * draft does not wait on them). Collapsed it previews the count and the titles;
 * opened it shows each concern's kind, why, the question and the evidence.
 * "Discuss with coach" opens the coach with a message already typed; the user
 * sends it. Nothing here writes to the profile.
 */
export function ConcernsPanel({ concerns, job }: { concerns: ConcernRow[]; job: { title: string; company?: string | null } }) {
  const count = concerns.length === 1 ? "1 concern" : `${concerns.length} concerns`
  return (
    <LogSection
      id="concerns"
      level={2}
      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3.5"
      titleClassName="text-lg font-semibold tracking-[-0.01em]"
      title={
        <span className="flex items-center gap-2">
          <CircleAlert className="size-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          {count} to discuss with the coach
        </span>
      }
      preview={
        <>
          <p className="mt-1 text-sm text-muted-foreground">{concerns.map((c) => c.title).join(" · ")}</p>
          <div className="mt-3">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => openCoachWithDraft(allConcernsCoachMessage(concerns, job))}>
              <MessageCircle className="size-3.5" aria-hidden="true" />
              {concerns.length === 1 ? "Discuss with coach" : "Discuss all with coach"}
            </Button>
          </div>
        </>
      }
    >
      <p className="mt-3 text-sm text-muted-foreground">Questions the review could not settle from your profile. They are suggestions: the draft does not wait on them.</p>
      <ul className="mt-3 space-y-4">
        {concerns.map((c, i) => (
          <li key={i} className="space-y-1">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{c.badge}</span>
              <span className="font-medium">{c.title}</span>
            </p>
            {c.why && <p className="text-sm text-muted-foreground">{c.why}</p>}
            <p className="text-sm">{c.question}</p>
            {c.refs.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                {c.refs.map((r, j) => <li key={j} className="break-words">{r}</li>)}
              </ul>
            )}
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => openCoachWithDraft(concernCoachMessage(c, job))}>
              <MessageCircle className="size-3.5" aria-hidden="true" />
              Discuss with coach
            </Button>
          </li>
        ))}
      </ul>
    </LogSection>
  )
}
