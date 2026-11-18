import {
  briefRows,
  selectionGroups,
  selectionSummary,
} from "@/app/dashboard/job-applications/_components/cv-generation-view"
import type { CvBrief, CvSelection } from "@/modules/cv-generation/schema"

/** The Brief as labelled, readable rows. */
export function BriefPanel({ brief }: { brief: CvBrief }) {
  return (
    <section aria-labelledby="brief-heading">
      <h2 id="brief-heading" className="text-lg font-semibold tracking-[-0.01em]">Brief</h2>
      <dl className="mt-4 space-y-3 rounded-lg border px-4 py-3.5 text-sm">
        {briefRows(brief).map((r) => (
          <div key={r.label}>
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            <dd className="mt-0.5">
              {r.text !== undefined
                ? <p className="leading-relaxed">{r.text}</p>
                : <ul className="list-disc space-y-0.5 pl-4">{r.items?.map((it, i) => <li key={i}>{it}</li>)}</ul>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** What Select kept (with the reason) and left out (with why), grouped by section. */
export function SelectionPanel({ selection }: { selection: CvSelection }) {
  const groups = selectionGroups(selection)
  return (
    <section aria-labelledby="selection-heading">
      <h2 id="selection-heading" className="text-lg font-semibold tracking-[-0.01em]">Selection</h2>
      <p className="mt-1 text-sm text-muted-foreground">{selectionSummary(selection)}</p>
      <div className="mt-4 divide-y rounded-lg border">
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
            {g.dropped.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Left out ({g.dropped.length})</summary>
                <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                  {g.dropped.map((d, i) => <li key={i} className="break-words">{d.label} <span className="text-xs">({d.why})</span></li>)}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
