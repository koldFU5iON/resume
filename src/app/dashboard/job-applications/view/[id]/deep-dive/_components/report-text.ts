/**
 * The deep dive report in words: the labels the page shows, and the whole
 * report as Markdown (Copy as Markdown, for review in another LLM).
 * Pure: no React, no server imports.
 */

import type { DeepDiveReport, DeepDiveResearch, Evidence, Researcher } from "@/modules/deep-dive/schema"
import { VERDICT_LABEL, formatMoney, hostOf } from "@/app/dashboard/job-applications/_components/deep-dive-view"

export const LIKELIHOOD_LABEL = { low: 'Low', medium: 'Medium', high: 'High' } as const

export const BLOCKER_LABEL = {
  hard: 'Rules you out',
  confirm_with_recruiter: 'Confirm with the recruiter',
  cleared: 'Cleared',
} as const

export const CLOSABILITY_LABEL = {
  closable_now: 'Closable now: add it to your profile or CV',
  closable_later: 'Closable with work',
  not_closable: "Can't be closed for this application",
} as const

export const SIGNAL_LABEL = { positive: 'Positive', neutral: 'Neutral', negative: 'Negative' } as const

export const WORK_MODE = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On site', unknown: 'Not clear' } as const

export const REGISTER = {
  licensed: 'Licensed sponsor (Skilled Worker)',
  licensed_other_route: 'Licensed, but not for Skilled Worker',
  not_listed: 'Not on the register',
  unknown: 'Not matched to the register',
  not_applicable: 'Not a UK job',
} as const

export const AD_WORDING = {
  offers: 'Offers sponsorship',
  not_offered: 'Says no sponsorship',
  right_to_work_required: 'Asks for existing right to work',
  silent: "Doesn't say",
} as const

export const RESEARCHER_LABEL: Record<Researcher, string> = { company: 'Company', pay: 'Pay', practicalities: 'Practicalities' }

export const OUTCOME_LABEL = {
  ok: 'Researched',
  cached: 'From recent research on this company',
  skipped: 'Skipped',
  failed: 'Failed',
  timeout: 'Ran out of time',
} as const

export function yesNo(v: boolean | null): string {
  return v === null ? 'Not clear' : v ? 'Yes' : 'No'
}

/** "about 6 weeks", or months past 12 weeks ("about 18 months"). */
export function timeToClose(weeks: number): string {
  if (weeks <= 12) return `about ${Math.round(weeks)} week${Math.round(weeks) === 1 ? '' : 's'}`
  return `about ${Math.round(weeks / 4.345)} months`
}

/** Plain words for a researcher's skip or failure reason. */
export function outcomeReason(reason: string | null): string | null {
  if (!reason) return null
  if (reason === 'no_web_search') return 'your provider has no web search'
  if (reason.startsWith('no_notes')) return 'the search found nothing it could use'
  if (reason === 'timeout') return null
  return reason.replace(/_/g, ' ')
}

/** "£80,000 – £95,000", one figure, or "Not stated". */
export function moneyRange(min: number | null, max: number | null, currency: string): string {
  if (min !== null && max !== null && min !== max) return `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`
  const one = min ?? max
  return one !== null ? formatMoney(one, currency) : 'Not stated'
}

// ── Markdown ────────────────────────────────────────────────────────────────

export type ReportMarkdownMeta = {
  jobTitle: string
  company: string | null
  /** The job ad's URL, when known. */
  jobUrl: string | null
  /** When the run was made. */
  createdAt: Date
  models: string[]
}

/** One line of model text: no line breaks, so a list item stays one item. */
function line(text: string): string {
  return text.replace(/\s*\n+\s*/g, ' ').trim()
}

function evidenceLines(evidence: Evidence[], findingCount: number): string[] {
  const out: string[] = []
  for (const e of evidence) {
    if (e.kind === 'jd') out.push(`Job ad: "${line(e.quote)}"`)
    else if (e.kind === 'profile') out.push(`Candidate profile: ${line(e.ref)}${e.text ? ` — ${line(e.text)}` : ''}`)
  }
  const sources = evidence
    .filter((e): e is Extract<Evidence, { kind: 'finding' }> => e.kind === 'finding' && e.index < findingCount)
    .map((e) => `[${e.index + 1}]`)
  if (evidence.some((e) => e.kind === 'register')) sources.push('UK sponsor register')
  if (sources.length) out.push(`Sources: ${sources.join(', ')}`)
  return out.map((l) => `   - ${l}`)
}

/**
 * The whole report as Markdown, in the page's order, with evidence under each
 * item and research findings as numbered sources ([n] in the text).
 */
export function reportToMarkdown(report: DeepDiveReport, research: DeepDiveResearch | null, meta: ReportMarkdownMeta): string {
  const findingCount = research?.findings.length ?? 0
  const ev = (evidence: Evidence[]) => evidenceLines(evidence, findingCount)
  const out: string[] = []
  const push = (...lines: string[]) => out.push(...lines)

  const role = meta.company ? `${line(meta.jobTitle)} at ${line(meta.company)}` : line(meta.jobTitle)
  push(`# Deep dive: ${role}`, '')
  push(`- Run: ${meta.createdAt.toISOString().slice(0, 10)}`)
  if (meta.models.length) push(`- Models: ${meta.models.join(', ')}`)
  if (meta.jobUrl) push(`- Job ad: ${meta.jobUrl}`)
  push('', 'Researchers saw only the job ad, never the candidate profile; one model then weighed the findings against the profile.', '')

  push(`## Verdict: ${VERDICT_LABEL[report.verdict]}`, '', line(report.verdictSummary), '')
  push(`- **Worth a tailored CV:** ${report.worthTailoredCv.answer ? 'Yes' : 'No'}. ${line(report.worthTailoredCv.reason)}`)
  push(`- **Chance of an interview:** ${LIKELIHOOD_LABEL[report.likelihood.band]}. ${line(report.likelihood.reason)}`, '')

  if (report.blockers.length) {
    push('## Blockers', '')
    report.blockers.forEach((b, i) => {
      const flagged = b.fromEarlyAssessment ? ' (flagged by the early assessment)' : ''
      push(`${i + 1}. **${line(b.label)}** — ${BLOCKER_LABEL[b.status]}${flagged}. ${line(b.reason)}`, ...ev(b.evidence))
    })
    push('')
  }

  if (report.gaps.length) {
    push('## Gaps', '')
    report.gaps.forEach((g, i) => {
      const status = g.closability === 'closable_later' && g.weeksToClose
        ? `Closable in ${timeToClose(g.weeksToClose)}`
        : CLOSABILITY_LABEL[g.closability]
      push(`${i + 1}. **${line(g.requirement)}** — ${status}. ${line(g.action)}`, ...ev(g.evidence))
    })
    push('')
  }

  if (report.strengths.length) {
    push('## Strengths', '')
    report.strengths.forEach((s, i) => push(`${i + 1}. ${line(s.point)}`, ...ev(s.evidence)))
    push('')
  }

  const pay = report.pay
  push('## Pay', '')
  if (pay.ask) {
    const c = pay.ask.currency
    push(`- **Suggested ask:** floor ${formatMoney(pay.ask.floor, c)}, target ${formatMoney(pay.ask.target, c)}, stretch ${formatMoney(pay.ask.stretch, c)}`)
    push(`- **How it was reached:** ${line(pay.ask.reasoning)}`)
  } else {
    push("- **Suggested ask:** none; there wasn't enough sourced pay data or a stated band to base one on.")
  }
  push(`- **In the ad:** ${pay.stated ? moneyRange(pay.stated.min, pay.stated.max, pay.stated.currency) : 'Not stated'}`)
  push(`- **Market:** ${pay.market ? moneyRange(pay.market.min, pay.market.max, pay.market.currency) : 'No sourced figures'}`)
  if (pay.market) push(...ev(pay.market.evidence))
  if (pay.vsSearchProfile) push(`- **Against the candidate's targets:** ${line(pay.vsSearchProfile)}`)
  push('')

  const p = report.practicalities
  push('## Practicalities', '', '### Location', '', line(p.location.summary), '')
  push(`- **Work mode:** ${WORK_MODE[p.location.workMode]}`, `- **Relocation:** ${yesNo(p.location.relocationNeeded)}`)
  if (p.employmentType) push(`- **Employment:** ${line(p.employmentType)}`)
  push('', '### Sponsorship', '', line(p.sponsorship.summary), '')
  push(
    `- **Candidate needs it:** ${p.sponsorship.needed ? 'Yes' : 'No'}`,
    `- **UK register:** ${REGISTER[p.sponsorship.register]}`,
    `- **The ad:** ${AD_WORDING[p.sponsorship.adWording]}`,
    `- **Meets salary threshold:** ${yesNo(p.sponsorship.meetsSalaryThreshold)}`,
  )
  if (p.other.length) {
    push('', '### Other')
    push('', ...p.other.map((o) => `- **${line(o.label)}:** ${line(o.detail)}`))
  }
  push('')

  push('## Company', '', line(report.company.summary), '')
  report.company.signals.forEach((s) => push(`- ${SIGNAL_LABEL[s.tone]}: ${line(s.label)}`, ...ev(s.evidence).map((l) => l.slice(1))))
  if (report.company.signals.length) push('')

  const cv = report.cvStrategy
  push('## CV strategy', '', line(cv.positioning), '')
  if (cv.leadWith.length) push('### Lead with', '', ...cv.leadWith.map((l, i) => `${i + 1}. ${line(l)}`), '')
  if (cv.emphasise.length) push('### Emphasise', '', ...cv.emphasise.map((e) => `- **${line(e.item)}:** ${line(e.why)}`), '')
  if (cv.playDown.length) push('### Play down', '', ...cv.playDown.map((l) => `- ${line(l)}`), '')

  if (report.questionsToAsk.length) {
    push('## Questions for the recruiter or hiring manager', '', ...report.questionsToAsk.map((q, i) => `${i + 1}. ${line(q)}`), '')
  }
  if (report.unknowns.length) {
    push("## What research couldn't settle", '', ...report.unknowns.map((u) => `- ${line(u)}`), '')
  }

  if (research) {
    push('## Sources', '')
    for (const r of Object.keys(RESEARCHER_LABEL) as Researcher[]) {
      const o = research.researchers[r]
      const reason = o.status === 'ok' || o.status === 'cached' ? `${o.findings.length} findings` : outcomeReason(o.reason)
      push(`- ${RESEARCHER_LABEL[r]} research: ${OUTCOME_LABEL[o.status]}${reason ? ` (${reason})` : ''}`)
    }
    push('')
    research.findings.forEach((f, i) => {
      const where = f.sourceUrl && hostOf(f.sourceUrl) ? f.sourceUrl : f.sourceUrl ? `unreadable link: ${line(f.sourceUrl)}` : 'the job ad'
      const meta = [RESEARCHER_LABEL[f.researcher], where, f.publishedAt, `${f.confidence} confidence`].filter(Boolean).join(' · ')
      push(`${i + 1}. ${line(f.claim)}`)
      if (f.quote) push(`   > "${line(f.quote)}"`)
      push(`   - ${meta}`)
    })
    push('')
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
