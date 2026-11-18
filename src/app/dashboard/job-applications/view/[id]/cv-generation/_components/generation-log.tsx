import { Check, Circle, CircleAlert, Loader2, MinusCircle, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  PROVENANCE_SUMMARY,
  bulletSourceLines,
  provenanceBySection,
  retryReasonLine,
  sectionMeta,
  stageMeta,
  stageRowHasDetail,
  stageNotes,
  type StageRow,
  type StageState,
} from "@/app/dashboard/job-applications/_components/cv-generation-view"
import { LogSection } from "./log-sections"
import type { BulletProvenance, CvAssembled, FlaggedClaim, SectionLogEntry } from "@/modules/cv-generation/schema"

const STATE_LABEL: Record<StageState, string> = {
  done: "done",
  active: "in progress",
  waiting: "not run yet",
  failed: "failed",
  skipped: "skipped",
}

function StateIcon({ state }: { state: StageState }) {
  switch (state) {
    case "done": return <Check className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
    case "active": return <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
    case "failed": return <TriangleAlert className="size-4 text-destructive" aria-hidden="true" />
    case "skipped": return <MinusCircle className="size-4 text-muted-foreground" aria-hidden="true" />
    case "waiting": return <Circle className="size-4 text-muted-foreground/50" aria-hidden="true" />
  }
}

/** The run's stages as a compact horizontal stepper; the current stage is marked. */
export function StageStepper({ rows }: { rows: StageRow[] }) {
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Stages">
      {rows.map((r) => (
        <li key={r.stage} className="flex items-center gap-1.5 text-sm" aria-current={r.state === "active" ? "step" : undefined}>
          <StateIcon state={r.state} />
          <span className={cn(r.state === "waiting" && "text-muted-foreground", r.state === "active" && "font-medium")}>
            {r.label}
            <span className="sr-only"> ({STATE_LABEL[r.state]})</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * The generation log: one row per stage with what it did (model, time, tokens,
 * cost), what Select kept and dropped, retries, and claims Review flagged.
 * Stages that haven't logged anything show only their purpose.
 */
export function GenerationLog({ rows, assembled }: { rows: StageRow[]; assembled?: CvAssembled | null }) {
  const provenance = provenanceBySection(assembled)
  return (
    <section aria-labelledby="generation-log-heading">
      <h2 id="generation-log-heading" className="text-lg font-semibold tracking-[-0.01em]">Generation log</h2>
      <ol className="mt-4 divide-y rounded-lg border">
        {rows.map((r) => <LogRow key={r.stage} row={r} warnings={r.stage === "assemble" ? assembled?.warnings ?? [] : []} provenance={provenance} />)}
      </ol>
    </section>
  )
}

function LogRow({ row, warnings, provenance }: { row: StageRow; warnings: string[]; provenance: Map<string, readonly BulletProvenance[]> }) {
  const meta = stageMeta(row)
  const e = row.entry
  const notes = e ? stageNotes(e) : []
  const retryLine = e ? retryReasonLine(e) : null
  const header = (
    <>
      <span className={cn("font-medium", row.state === "waiting" && "text-muted-foreground")}>
        {row.label}
        <span className="sr-only"> ({STATE_LABEL[row.state]})</span>
        {row.state === "skipped" && <span className="ml-2 text-xs font-normal text-muted-foreground">skipped</span>}
        {row.state === "failed" && <span className="ml-2 text-xs font-normal text-destructive">failed</span>}
      </span>
    </>
  )
  const purpose = <p className="text-sm text-muted-foreground">{row.detail}</p>
  const detail = (
    <div className="space-y-2">
      {meta.length > 0 && (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
          {meta.map((m, i) => <span key={i} className={i === 0 && e?.model ? "font-mono" : undefined}>{m}</span>)}
        </p>
      )}

      {retryLine && <p className="text-sm text-muted-foreground">{retryLine}</p>}

      {notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">
          {notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}

      {e && e.sections.length > 0 && <SectionRows sections={e.sections} provenance={provenance} />}
      {warnings.length > 0 && <Warnings warnings={warnings} />}

      {e && (e.kept.length > 0 || e.dropped.length > 0) && <KeptDropped kept={e.kept} dropped={e.dropped} />}
      {e && e.flaggedClaims.length > 0 && <FlaggedClaims claims={e.flaggedClaims} />}
    </div>
  )
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 px-4 py-3.5">
      <span className="mt-0.5"><StateIcon state={row.state} /></span>
      <div className="min-w-0">
        {stageRowHasDetail(row, warnings) ? (
          <LogSection id={`stage:${row.stage}`} title={header} preview={purpose}>
            <div className="mt-2">{detail}</div>
          </LogSection>
        ) : (
          <div><p>{header}</p>{purpose}</div>
        )}
      </div>
    </li>
  )
}

/** One compact row per section under Write: what wrote it, what it cost, what it noted. */
function SectionRows({ sections, provenance }: { sections: SectionLogEntry[]; provenance: Map<string, readonly BulletProvenance[]> }) {
  return (
    <ul className="divide-y rounded-md border text-sm" aria-label="Sections">
      {sections.map((s) => {
        const meta = sectionMeta(s)
        const retryLine = retryReasonLine(s)
        return (
          <li key={s.id} className="space-y-1 px-3 py-2">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{s.label}</span>
              {s.status === "failed" && <span className="text-xs text-destructive">failed</span>}
            </p>
            <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
              {meta.map((m, i) => <span key={i} className={i === 0 && s.model ? "font-mono" : undefined}>{m}</span>)}
            </p>
            {retryLine && <p className="text-xs text-muted-foreground">{retryLine}</p>}
            {s.notes.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                {s.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
            {provenance.has(s.id) && <BulletSources bullets={provenance.get(s.id) ?? []} />}
          </li>
        )
      })}
    </ul>
  )
}

/** Under an experience row: each bullet with the evidence it was written from, so a bullet that mixed two activities is easy to spot. */
function BulletSources({ bullets }: { bullets: readonly BulletProvenance[] }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{PROVENANCE_SUMMARY}</summary>
      <ol className="mt-1.5 space-y-2">
        {bullets.map((b, i) => (
          <li key={i}>
            <p className="break-words text-sm">{b.text}</p>
            {bulletSourceLines(b).map((l, j) => <p key={j} className="break-words text-muted-foreground">{l}</p>)}
          </li>
        ))}
      </ol>
    </details>
  )
}

/** Block and fact-check warnings of the assembled CV; they never fail the run. */
function Warnings({ warnings }: { warnings: string[] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        {warnings.length} {warnings.length === 1 ? "warning" : "warnings"} from the block and fact checks
      </summary>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
        {warnings.map((w, i) => <li key={i} className="break-words">{w}</li>)}
      </ul>
    </details>
  )
}

function KeptDropped({ kept, dropped }: { kept: string[]; dropped: string[] }) {
  return (
    <details className="group text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Kept {kept.length}, dropped {dropped.length}
      </summary>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <EvidenceList title="Kept" items={kept} />
        <EvidenceList title="Dropped" items={dropped} />
      </div>
    </details>
  )
}

function EvidenceList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <ul className="space-y-0.5">{items.map((it, i) => <li key={i} className="break-words">{it}</li>)}</ul>
      )}
    </div>
  )
}

function FlaggedClaims({ claims }: { claims: FlaggedClaim[] }) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <CircleAlert className="size-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
        {claims.length} {claims.length === 1 ? "claim" : "claims"} flagged
      </p>
      <ul className="mt-2 space-y-2">
        {claims.map((c, i) => (
          <li key={i}>
            <p>
              <span className="mr-2 text-xs font-medium text-muted-foreground">{c.verdict === "unsupported" ? "Removed" : "Verify"}</span>
              {c.claim}
            </p>
            {(c.section || c.reason) && (
              <p className="text-xs text-muted-foreground">{[c.section, c.reason].filter(Boolean).join(" · ")}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
