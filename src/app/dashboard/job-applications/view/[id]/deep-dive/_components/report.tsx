import type { ReactNode } from "react"
import {
  Ban,
  Check,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CirclePlus,
  ExternalLink,
  MessageCircleQuestion,
  TriangleAlert,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { DeepDiveReport, DeepDiveResearch, Evidence, Researcher } from "@/modules/deep-dive/schema"
import {
  VERDICT_LABEL,
  VERDICT_TEXT,
  formatMoney,
  hostOf,
} from "@/app/dashboard/job-applications/_components/deep-dive-view"
import { PayScale } from "./pay-scale"

/**
 * The deep dive report (spec §6) as a document: one column, sections split by
 * hairlines, evidence inline, research findings as numbered sources at the
 * end. Server component: no state.
 */

export const REPORT_SECTIONS = [
  { id: 'verdict', label: 'Verdict' },
  { id: 'blockers', label: 'Blockers' },
  { id: 'gaps', label: 'Gaps' },
  { id: 'strengths', label: 'Strengths' },
  { id: 'pay', label: 'Pay' },
  { id: 'practicalities', label: 'Practicalities' },
  { id: 'company', label: 'Company' },
  { id: 'cv-strategy', label: 'CV strategy' },
  { id: 'questions', label: 'Questions and unknowns' },
  { id: 'sources', label: 'Sources' },
] as const

export type ReportSectionId = typeof REPORT_SECTIONS[number]['id']

/** Sections that have something to show, for the contents list. */
export function presentSections(report: DeepDiveReport, research: DeepDiveResearch | null): ReportSectionId[] {
  const has: Record<ReportSectionId, boolean> = {
    verdict: true,
    blockers: report.blockers.length > 0,
    gaps: report.gaps.length > 0,
    strengths: report.strengths.length > 0,
    pay: true,
    practicalities: true,
    company: true,
    'cv-strategy': true,
    questions: report.questionsToAsk.length > 0 || report.unknowns.length > 0,
    sources: !!research,
  }
  return REPORT_SECTIONS.map((s) => s.id).filter((id) => has[id])
}

export function DeepDiveReportView({ report, research }: { report: DeepDiveReport; research: DeepDiveResearch | null }) {
  const findingCount = research?.findings.length ?? 0
  return (
    <article className="min-w-0">
      <VerdictSection report={report} />

      {report.blockers.length > 0 && (
        <Section id="blockers" title="Blockers" hint="Requirements that could rule you out, checked against research and your profile.">
          <ul className="space-y-5">
            {report.blockers.map((b, i) => {
              const status = BLOCKER_STATUS[b.status]
              return (
                <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2">
                  <status.Icon className={cn("mt-0.5 size-4", status.tone)} aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="font-medium leading-snug">
                      {b.label}
                    </p>
                    <p className="text-xs">
                      <span className={cn("font-medium", status.tone)}>{status.label}</span>
                      {b.fromEarlyAssessment && <span className="text-muted-foreground"> · flagged by the early assessment</span>}
                    </p>
                    <Prose>{b.reason}</Prose>
                    <EvidenceList evidence={b.evidence} findingCount={findingCount} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {report.gaps.length > 0 && (
        <Section id="gaps" title="Gaps" hint="What the role asks for that your profile doesn't show yet, and how to close it.">
          <ul className="space-y-5">
            {report.gaps.map((g, i) => {
              const c = CLOSABILITY[g.closability]
              return (
                <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2">
                  <c.Icon className={cn("mt-0.5 size-4", c.tone)} aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="font-medium leading-snug">{g.requirement}</p>
                    <p className={cn("text-xs font-medium", c.tone)}>
                      {g.closability === 'closable_later' && g.weeksToClose
                        ? `Closable in ${timeToClose(g.weeksToClose)}`
                        : c.label}
                    </p>
                    <Prose>{g.action}</Prose>
                    <EvidenceList evidence={g.evidence} findingCount={findingCount} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {report.strengths.length > 0 && (
        <Section id="strengths" title="Strengths">
          <ul className="space-y-4">
            {report.strengths.map((s, i) => (
              <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2">
                <Check className="mt-0.5 size-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                <div className="space-y-1">
                  <Prose>{s.point}</Prose>
                  <EvidenceList evidence={s.evidence} findingCount={findingCount} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <PaySection pay={report.pay} findingCount={findingCount} />
      <PracticalitiesSection p={report.practicalities} />

      <Section id="company" title="Company">
        <Prose>{report.company.summary}</Prose>
        {report.company.signals.length > 0 && (
          <ul className="mt-4 space-y-3">
            {report.company.signals.map((s, i) => {
              const tone = SIGNAL_TONE[s.tone]
              return (
                <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2">
                  <tone.Icon className={cn("mt-0.5 size-4", tone.className)} aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="text-sm leading-relaxed"><span className="sr-only">{tone.label}: </span>{s.label}</p>
                    <EvidenceList evidence={s.evidence} findingCount={findingCount} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <CvStrategySection s={report.cvStrategy} />

      {(report.questionsToAsk.length > 0 || report.unknowns.length > 0) && (
        <Section id="questions" title="Questions and unknowns">
          <div className="grid gap-8 md:grid-cols-2">
            {report.questionsToAsk.length > 0 && (
              <div>
                <SubHeading>Ask the recruiter or hiring manager</SubHeading>
                <ol className="space-y-2.5">
                  {report.questionsToAsk.map((q, i) => (
                    <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 text-sm leading-relaxed">
                      <MessageCircleQuestion className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                      {q}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {report.unknowns.length > 0 && (
              <div>
                <SubHeading>Research couldn&apos;t settle</SubHeading>
                <ul className="space-y-2.5">
                  {report.unknowns.map((u, i) => (
                    <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 text-sm leading-relaxed">
                      <CircleHelp className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                      {u}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Section>
      )}

      {research && <SourcesSection research={research} />}
    </article>
  )
}

// ── Verdict ─────────────────────────────────────────────────────────────────

const LIKELIHOOD_LABEL = { low: 'Low', medium: 'Medium', high: 'High' } as const

function VerdictSection({ report }: { report: DeepDiveReport }) {
  return (
    <section id="verdict" aria-labelledby="verdict-heading" className="scroll-mt-6 pb-10">
      <h1 id="verdict-heading" className={cn("text-3xl font-semibold tracking-[-0.02em] text-balance", VERDICT_TEXT[report.verdict])}>
        {VERDICT_LABEL[report.verdict]}
      </h1>
      <p className="mt-3 max-w-[68ch] text-base leading-relaxed text-pretty">{report.verdictSummary}</p>

      <dl className="mt-8 grid gap-6 border-t pt-6 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Worth a tailored CV</dt>
          <dd className="mt-1">
            <span className="font-medium">{report.worthTailoredCv.answer ? 'Yes' : 'No'}</span>
            <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{report.worthTailoredCv.reason}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Chance of an interview</dt>
          <dd className="mt-1">
            <span className="font-medium">{LIKELIHOOD_LABEL[report.likelihood.band]}</span>
            <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{report.likelihood.reason}</span>
          </dd>
        </div>
      </dl>
    </section>
  )
}

// ── Pay ─────────────────────────────────────────────────────────────────────

function range(min: number | null, max: number | null, currency: string): string {
  if (min !== null && max !== null && min !== max) return `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`
  const one = min ?? max
  return one !== null ? formatMoney(one, currency) : 'Not stated'
}

function PaySection({ pay, findingCount }: { pay: DeepDiveReport['pay']; findingCount: number }) {
  return (
    <Section id="pay" title="Pay">
      {pay.ask ? (
        <div>
          <SubHeading>Suggested ask</SubHeading>
          <dl className="grid grid-cols-3 gap-4 tabular-nums">
            <AskFigure label="Floor" value={formatMoney(pay.ask.floor, pay.ask.currency)} />
            <AskFigure label="Target" value={formatMoney(pay.ask.target, pay.ask.currency)} emphasis />
            <AskFigure label="Stretch" value={formatMoney(pay.ask.stretch, pay.ask.currency)} />
          </dl>
          <Prose className="mt-3">{pay.ask.reasoning}</Prose>
        </div>
      ) : (
        <Prose className="text-muted-foreground">No suggested ask: there wasn&apos;t enough sourced pay data or a stated band to base one on.</Prose>
      )}

      <PayScale pay={pay} />

      <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <Fact label="In the ad">{pay.stated ? range(pay.stated.min, pay.stated.max, pay.stated.currency) : 'Not stated'}</Fact>
        <Fact label="Market">
          {pay.market ? range(pay.market.min, pay.market.max, pay.market.currency) : 'No sourced figures'}
          {pay.market && <EvidenceList evidence={pay.market.evidence} findingCount={findingCount} />}
        </Fact>
      </dl>
      {pay.vsSearchProfile && (
        <Prose className="mt-4 text-muted-foreground">{pay.vsSearchProfile}</Prose>
      )}
    </Section>
  )
}

function AskFigure({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5", emphasis ? "text-2xl font-semibold tracking-[-0.02em]" : "text-lg font-medium text-muted-foreground")}>{value}</dd>
    </div>
  )
}

// ── Practicalities ──────────────────────────────────────────────────────────

const WORK_MODE = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On site', unknown: 'Not clear' } as const
const REGISTER = {
  licensed: 'Licensed sponsor (Skilled Worker)',
  licensed_other_route: 'Licensed, but not for Skilled Worker',
  not_listed: 'Not on the register',
  unknown: 'Not matched to the register',
  not_applicable: 'Not a UK job',
} as const
const AD_WORDING = {
  offers: 'Offers sponsorship',
  not_offered: 'Says no sponsorship',
  right_to_work_required: 'Asks for existing right to work',
  silent: "Doesn't say",
} as const

function yesNo(v: boolean | null): string {
  return v === null ? 'Not clear' : v ? 'Yes' : 'No'
}

function PracticalitiesSection({ p }: { p: DeepDiveReport['practicalities'] }) {
  const s = p.sponsorship
  return (
    <Section id="practicalities" title="Practicalities">
      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
        <div>
          <SubHeading>Location</SubHeading>
          <Prose>{p.location.summary}</Prose>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <Fact label="Work mode">{WORK_MODE[p.location.workMode]}</Fact>
            <Fact label="Relocation">{yesNo(p.location.relocationNeeded)}</Fact>
            {p.employmentType && <Fact label="Employment">{p.employmentType}</Fact>}
          </dl>
        </div>
        <div>
          <SubHeading>Sponsorship</SubHeading>
          <Prose>{s.summary}</Prose>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <Fact label="You need it">{s.needed ? 'Yes' : 'No'}</Fact>
            <Fact label="UK register">{REGISTER[s.register]}</Fact>
            <Fact label="The ad">{AD_WORDING[s.adWording]}</Fact>
            <Fact label="Meets salary threshold">{yesNo(s.meetsSalaryThreshold)}</Fact>
          </dl>
        </div>
      </div>
      {p.other.length > 0 && (
        <dl className="mt-8 grid gap-x-8 gap-y-4 border-t pt-6 sm:grid-cols-2">
          {p.other.map((o, i) => <Fact key={i} label={o.label}>{o.detail}</Fact>)}
        </dl>
      )}
    </Section>
  )
}

// ── CV strategy ─────────────────────────────────────────────────────────────

function CvStrategySection({ s }: { s: DeepDiveReport['cvStrategy'] }) {
  return (
    <Section id="cv-strategy" title="CV strategy" hint="Saved to the job's analysis, so CV generation and cover letters use it.">
      <p className="max-w-[68ch] text-base leading-relaxed text-pretty">{s.positioning}</p>
      <div className="mt-6 grid gap-x-10 gap-y-6 md:grid-cols-2">
        {s.leadWith.length > 0 && (
          <div>
            <SubHeading>Lead with</SubHeading>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed marker:text-muted-foreground marker:tabular-nums">
              {s.leadWith.map((l, i) => <li key={i}>{l}</li>)}
            </ol>
          </div>
        )}
        {s.playDown.length > 0 && (
          <div>
            <SubHeading>Play down</SubHeading>
            <ul className="space-y-1.5 text-sm leading-relaxed">
              {s.playDown.map((l, i) => (
                <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2">
                  <CircleMinus className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                  {l}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {s.emphasise.length > 0 && (
        <div className="mt-6">
          <SubHeading>Emphasise</SubHeading>
          <dl className="divide-y border-y">
            {s.emphasise.map((e, i) => (
              <div key={i} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-6">
                <dt className="text-sm font-medium leading-relaxed">{e.item}</dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">{e.why}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </Section>
  )
}

// ── Sources ─────────────────────────────────────────────────────────────────

const RESEARCHER_LABEL: Record<Researcher, string> = { company: 'Company', pay: 'Pay', practicalities: 'Practicalities' }

const OUTCOME_LABEL = {
  ok: 'Researched',
  cached: 'From recent research on this company',
  skipped: 'Skipped',
  failed: 'Failed',
  timeout: 'Ran out of time',
} as const

/** Plain words for a researcher's skip or failure reason. */
function outcomeReason(reason: string | null): string | null {
  if (!reason) return null
  if (reason === 'no_web_search') return 'your provider has no web search'
  if (reason.startsWith('no_notes')) return 'the search found nothing it could use'
  if (reason === 'timeout') return null
  return reason.replace(/_/g, ' ')
}

function SourcesSection({ research }: { research: DeepDiveResearch }) {
  return (
    <Section id="sources" title="Sources" hint="What the researchers found. They only saw the job ad, never your profile.">
      <dl className="mb-6 grid gap-3 sm:grid-cols-3">
        {(Object.keys(RESEARCHER_LABEL) as Researcher[]).map((r) => {
          const o = research.researchers[r]
          const reason = outcomeReason(o.reason)
          const ok = o.status === 'ok' || o.status === 'cached'
          return (
            <div key={r}>
              <dt className="text-xs text-muted-foreground">{RESEARCHER_LABEL[r]}</dt>
              <dd className={cn("mt-0.5 text-sm", !ok && "text-amber-700 dark:text-amber-400")}>
                {OUTCOME_LABEL[o.status]}
                {ok && <span className="text-muted-foreground"> · {o.findings.length} finding{o.findings.length === 1 ? '' : 's'}</span>}
                {!ok && reason && <span className="block text-xs text-muted-foreground">{reason}</span>}
              </dd>
            </div>
          )
        })}
      </dl>
      {research.findings.length === 0 ? (
        <Prose className="text-muted-foreground">No research findings. The report is built from the job ad, your profile, the early assessment and the sponsor register.</Prose>
      ) : (
        <ol className="space-y-4">
          {research.findings.map((f, i) => {
            const host = hostOf(f.sourceUrl)
            return (
              <li key={i} id={`source-${i + 1}`} className="grid scroll-mt-6 grid-cols-[2rem_minmax(0,1fr)] gap-x-2 rounded-sm target:bg-primary/10">
                <span className="pt-px text-right font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <div className="space-y-1">
                  <p className="text-sm leading-relaxed">{f.claim}</p>
                  {f.quote && (
                    <blockquote className="border-l pl-3 text-xs italic leading-relaxed text-muted-foreground">“{f.quote}”</blockquote>
                  )}
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{RESEARCHER_LABEL[f.researcher]}</span>
                    <span aria-hidden="true">·</span>
                    {f.sourceUrl && host ? (
                      <a
                        href={f.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1 underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-current"
                      >
                        {host}
                        <ExternalLink className="size-3" aria-hidden="true" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : f.sourceUrl ? (
                      <span>Unreadable link</span>
                    ) : (
                      <span>The job ad</span>
                    )}
                    {f.publishedAt && (<><span aria-hidden="true">·</span><span>{f.publishedAt}</span></>)}
                    <span aria-hidden="true">·</span>
                    <span>{f.confidence} confidence</span>
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Section>
  )
}

// ── Evidence ────────────────────────────────────────────────────────────────

/**
 * Evidence under an item: job-ad quotes and profile items in words,
 * findings as numbered links into Sources.
 */
function EvidenceList({ evidence, findingCount }: { evidence: Evidence[]; findingCount: number }) {
  const quotes = evidence.filter((e): e is Extract<Evidence, { kind: 'jd' }> => e.kind === 'jd')
  const profile = evidence.filter((e): e is Extract<Evidence, { kind: 'profile' }> => e.kind === 'profile')
  const findings = evidence.filter((e): e is Extract<Evidence, { kind: 'finding' }> => e.kind === 'finding' && e.index < findingCount)
  const register = evidence.some((e) => e.kind === 'register')
  if (!quotes.length && !profile.length && !findings.length && !register) return null

  return (
    <div className="max-w-[80ch] space-y-1 pt-0.5 text-xs leading-relaxed text-muted-foreground">
      {quotes.map((q, i) => (
        <p key={`q${i}`}><span className="text-foreground/70">Job ad:</span> <q className="italic">{q.quote}</q></p>
      ))}
      {profile.map((p, i) => (
        <p key={`p${i}`}>
          <span className="text-foreground/70">Your profile:</span> {p.ref}{p.text && <> — {p.text}</>}
        </p>
      ))}
      {(findings.length > 0 || register) && (
        <p className="flex flex-wrap items-center gap-x-1.5">
          <span className="text-foreground/70">Sources:</span>
          {findings.map((f) => (
            <a
              key={f.index}
              href={`#source-${f.index + 1}`}
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-muted px-1 font-mono text-[10px] tabular-nums text-foreground/80 hover:bg-primary/15 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Source ${f.index + 1}`}
            >
              {f.index + 1}
            </a>
          ))}
          {register && <span>UK sponsor register</span>}
        </p>
      )}
    </div>
  )
}

// ── Shared pieces ───────────────────────────────────────────────────────────

/** "about 6 weeks", or months past 12 weeks ("about 18 months"). */
export function timeToClose(weeks: number): string {
  if (weeks <= 12) return `about ${Math.round(weeks)} week${Math.round(weeks) === 1 ? '' : 's'}`
  return `about ${Math.round(weeks / 4.345)} months`
}

const BLOCKER_STATUS = {
  hard: { label: 'Rules you out', Icon: Ban, tone: 'text-destructive' },
  confirm_with_recruiter: { label: 'Confirm with the recruiter', Icon: CircleAlert, tone: 'text-amber-700 dark:text-amber-400' },
  cleared: { label: 'Cleared', Icon: CircleCheck, tone: 'text-emerald-700 dark:text-emerald-400' },
} as const

const CLOSABILITY = {
  closable_now: { label: 'Closable now: add it to your profile or CV', Icon: CirclePlus, tone: 'text-emerald-700 dark:text-emerald-400' },
  closable_later: { label: 'Closable with work', Icon: TriangleAlert, tone: 'text-amber-700 dark:text-amber-400' },
  not_closable: { label: "Can't be closed for this application", Icon: Ban, tone: 'text-destructive' },
} as const

const SIGNAL_TONE = {
  positive: { label: 'Positive', Icon: CirclePlus, className: 'text-emerald-700 dark:text-emerald-400' },
  neutral: { label: 'Neutral', Icon: CircleMinus, className: 'text-muted-foreground' },
  negative: { label: 'Negative', Icon: TriangleAlert, className: 'text-amber-700 dark:text-amber-400' },
} as const

function Section({ id, title, hint, children }: { id: ReportSectionId; title: string; hint?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-6 border-t py-10">
      <h2 id={`${id}-heading`} className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
      {hint && <p className="mt-1 max-w-[68ch] text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-sm font-medium text-muted-foreground">{children}</h3>
}

function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("max-w-[68ch] text-sm leading-relaxed text-pretty", className)}>{children}</p>
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  )
}
