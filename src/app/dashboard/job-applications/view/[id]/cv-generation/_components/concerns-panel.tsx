import { CircleAlert } from "lucide-react"
import type { ConcernRow } from "@/app/dashboard/job-applications/_components/cv-generation-view"

/**
 * The reviewer's concerns for the coach, as a plain readable list: a kind
 * badge, the title, why, and the question to put to you. They never block the
 * draft; the richer preview and the "discuss with coach" action come later.
 */
export function ConcernsPanel({ concerns }: { concerns: ConcernRow[] }) {
  return (
    <section aria-labelledby="concerns-heading" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3.5">
      <h2 id="concerns-heading" className="flex items-center gap-2 text-lg font-semibold tracking-[-0.01em]">
        <CircleAlert className="size-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
        {concerns.length === 1 ? "1 concern" : `${concerns.length} concerns`} to discuss with the coach
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Questions the review could not settle from your profile. The draft does not wait on them.</p>
      <ul className="mt-3 space-y-3.5">
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
          </li>
        ))}
      </ul>
    </section>
  )
}
