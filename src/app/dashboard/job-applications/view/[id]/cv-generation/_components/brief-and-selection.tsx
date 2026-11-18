import {
  briefRows,
  employerBlocks,
  selectionGroups,
  selectionSummary,
  uncoveredLine,
  type EmployerBlock,
} from "@/app/dashboard/job-applications/_components/cv-generation-view"
import { LogSection } from "./log-sections"
import type { CvBrief, CvSelection } from "@/modules/cv-generation/schema"

/** The Brief as labelled, readable rows. */
export function BriefPanel({ brief }: { brief: CvBrief }) {
  return (
    <LogSection id="brief" level={2} title="Brief" titleClassName="text-lg font-semibold tracking-[-0.01em]">
      <dl className="mt-4 space-y-3 rounded-lg border px-4 py-3.5 text-sm">
        {briefRows(brief).map((r) => (
          <div key={r.label}>
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd className="mt-0.5">
              {r.text !== undefined
                ? <p className="leading-relaxed">{r.text}</p>
                : (
                  <ul className="list-disc space-y-1 pl-4">
                    {r.items?.map((it, i) => (
                      <li key={i}>
                        {it.strong ? <strong className="font-semibold">{it.text}</strong> : it.text}
                        {it.note && <span className="block text-xs text-muted-foreground">{it.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}
            </dd>
          </div>
        ))}
      </dl>
    </LogSection>
  )
}

function Dropped({ items }: { items: Array<{ label: string; why: string }> }) {
  if (items.length === 0) return null
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Left out ({items.length})</summary>
      <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
        {items.map((d, i) => <li key={i} className="break-words">{d.label} <span className="text-xs">({d.why})</span></li>)}
      </ul>
    </details>
  )
}

/** One employer: company, latest title, dates, progression sub-text, then its bullets. */
function EmployerCard({ e }: { e: EmployerBlock }) {
  return (
    <div className="space-y-2 px-4 py-3.5">
      <div>
        <h3 className="text-sm font-medium">{e.company}</h3>
        <p className="text-sm">{e.title}{e.period && <span className="text-muted-foreground"> · {e.period}</span>}</p>
        {e.progression && <p className="text-xs text-muted-foreground">{e.progression}</p>}
        {!e.headerOnly && (
          <p className="text-xs text-muted-foreground">
            {e.relevance !== undefined && `Relevance ${e.relevance}/5, `}{e.kept.length} {e.kept.length === 1 ? "bullet" : "bullets"}{e.reason ? ` · ${e.reason}` : ""}
          </p>
        )}
      </div>
      {!e.headerOnly && (
        e.kept.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bullets kept.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {e.kept.map((k, i) => (
              <li key={i} className="break-words">
                {k.label}
                {k.reason && <span className="block text-xs text-muted-foreground">{k.reason}</span>}
              </li>
            ))}
          </ul>
        )
      )}
      <Dropped items={e.dropped} />
    </div>
  )
}

/** What Select kept (with the reason) and left out (with why): the work history by employer, then the other sections. */
export function SelectionPanel({ selection }: { selection: CvSelection }) {
  const groups = selectionGroups(selection)
  const work = employerBlocks(selection)
  const uncovered = uncoveredLine(selection)
  return (
    <LogSection id="selection" level={2} title="Selection" titleClassName="text-lg font-semibold tracking-[-0.01em]">
      <p className="mt-1 text-sm text-muted-foreground">{selectionSummary(selection)}</p>
      {uncovered && (
        <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">{uncovered}</p>
      )}
      <div className="mt-4 divide-y rounded-lg border">
        {work.withBullets.map((e) => <EmployerCard key={e.key} e={e} />)}
        {work.headerOnly.length > 0 && (
          <div className="space-y-2 px-4 py-3.5">
            <h3 className="text-sm font-medium">Listed without bullets</h3>
            <ul className="space-y-2 text-sm">
              {work.headerOnly.map((e) => (
                <li key={e.key} className="break-words">
                  {e.company}: {e.title}{e.period && <span className="text-muted-foreground"> · {e.period}</span>}
                  {e.progression && <span className="block text-xs text-muted-foreground">{e.progression}</span>}
                  {e.dropped.length > 0 && <span className="block text-xs text-muted-foreground">{e.dropped.length} picked {e.dropped.length === 1 ? "activity" : "activities"} not used</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {work.dropped.length > 0 && (
          <div className="px-4 py-3.5">
            <h3 className="mb-1 text-sm font-medium">Employers left out</h3>
            <Dropped items={work.dropped} />
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key} className="space-y-2 px-4 py-3.5">
            <h3 className="text-sm font-medium">{g.title}</h3>
            {g.kept.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing kept.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {g.kept.map((k, i) => (
                  <li key={i} className="break-words">
                    {k.label}
                    {k.reason && <span className="block text-xs text-muted-foreground">{k.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
            <Dropped items={g.dropped} />
          </div>
        ))}
      </div>
    </LogSection>
  )
}
