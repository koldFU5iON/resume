import { describe, expect, it } from 'vitest'
import type { DeepDiveReport, DeepDiveResearch, Finding } from '@/modules/deep-dive/schema'
import { reportToMarkdown } from './report-text'

const report: DeepDiveReport = {
  verdict: 'apply_with_caveats',
  verdictSummary: 'Strong product fit.\nSponsorship needs confirming.',
  worthTailoredCv: { answer: true, reason: 'Close match on payments.' },
  likelihood: { band: 'medium', reason: 'Good fit, crowded field.' },
  blockers: [{
    label: 'Visa sponsorship',
    status: 'confirm_with_recruiter',
    fromEarlyAssessment: true,
    reason: 'The ad is silent.',
    evidence: [{ kind: 'register' }, { kind: 'finding', index: 1 }, { kind: 'finding', index: 9 }],
  }],
  gaps: [{
    requirement: 'Kotlin',
    closability: 'closable_later',
    action: 'Ship a side project.',
    weeksToClose: 6,
    evidence: [{ kind: 'jd', quote: 'Kotlin experience' }],
  }],
  strengths: [{ point: 'Led payments teams', evidence: [{ kind: 'profile', ref: 'Senior PM — Acme', text: 'Ran card issuing' }] }],
  practicalities: {
    location: { summary: 'London, 3 days in office.', workMode: 'hybrid', relocationNeeded: false },
    sponsorship: { needed: true, register: 'licensed', adWording: 'silent', meetsSalaryThreshold: true, summary: 'Licensed sponsor.' },
    employmentType: 'Permanent',
    other: [{ label: 'Start', detail: 'January' }],
  },
  pay: {
    stated: { min: 80_000, max: 95_000, currency: 'GBP' },
    market: { min: 85_000, max: 110_000, currency: 'GBP', evidence: [{ kind: 'finding', index: 0 }] },
    ask: { floor: 90_000, target: 100_000, stretch: 110_000, currency: 'GBP', reasoning: 'Top of the band.' },
    vsSearchProfile: 'Above your floor.',
  },
  company: { summary: 'Fintech, 2,000 people.', signals: [{ label: 'Profitable', tone: 'positive', evidence: [{ kind: 'finding', index: 0 }] }] },
  cvStrategy: {
    leadWith: ['Payments launches'],
    emphasise: [{ item: 'Card issuing', why: 'Core to the role' }],
    playDown: ['Agency work'],
    positioning: 'Payments product leader.',
  },
  questionsToAsk: ['Do you sponsor?'],
  unknowns: ['Team size'],
}

const finding = (over: Partial<Finding>): Finding => ({
  topic: 'pay_band', claim: 'Claim', sourceUrl: null, quote: null, publishedAt: null, confidence: 'medium', ...over,
})

const research: DeepDiveResearch = {
  researchers: {
    company: { status: 'ok', reason: null, findings: [], model: 'm', sourceCount: 3 },
    pay: { status: 'ok', reason: null, findings: [], model: 'm', sourceCount: 2 },
    practicalities: { status: 'skipped', reason: 'no_web_search', findings: [], model: null, sourceCount: 0 },
  },
  findings: [
    { ...finding({ claim: 'PMs earn £85–110k', sourceUrl: 'https://levels.fyi/x', quote: 'median £97k', publishedAt: '2026-09' }), researcher: 'pay' },
    { ...finding({ claim: 'Sponsors visas', sourceUrl: 'javascript:alert(1)' }), researcher: 'company' },
  ],
}

const meta = {
  jobTitle: 'Senior PM', company: 'Monzo', jobUrl: 'https://monzo.com/jobs/1',
  createdAt: new Date('2026-11-12T10:00:00Z'), models: ['model-a', 'model-b'],
}

describe('reportToMarkdown', () => {
  const md = reportToMarkdown(report, research, meta)

  it('has a header with the job, run date, models and ad', () => {
    expect(md.startsWith('# Deep dive: Senior PM at Monzo\n')).toBe(true)
    expect(md).toContain('- Run: 2026-11-12')
    expect(md).toContain('- Models: model-a, model-b')
    expect(md).toContain('- Job ad: https://monzo.com/jobs/1')
  })

  it('includes every section, in the page order', () => {
    const headings = md.split('\n').filter((l) => l.startsWith('## '))
    expect(headings).toEqual([
      '## Verdict: Apply, with caveats',
      '## Blockers',
      '## Gaps',
      '## Strengths',
      '## Pay',
      '## Practicalities',
      '## Company',
      '## CV strategy',
      '## Questions for the recruiter or hiring manager',
      "## What research couldn't settle",
      '## Sources',
    ])
  })

  it('keeps model text on one line and cites evidence', () => {
    expect(md).toContain('Strong product fit. Sponsorship needs confirming.')
    expect(md).toContain('1. **Visa sponsorship** — Confirm with the recruiter (flagged by the early assessment). The ad is silent.')
    // Out-of-range finding indexes are dropped, like on the page.
    expect(md).toContain('   - Sources: [2], UK sponsor register')
    expect(md).toContain('**Kotlin** — Closable in about 6 weeks.')
    expect(md).toContain('   - Job ad: "Kotlin experience"')
    expect(md).toContain('   - Candidate profile: Senior PM — Acme — Ran card issuing')
    expect(md).toContain('floor £90,000, target £100,000, stretch £110,000')
    expect(md).toContain('- **In the ad:** £80,000 – £95,000')
  })

  it('lists sources with their links, and never as a link for other schemes', () => {
    expect(md).toContain('- Practicalities research: Skipped (your provider has no web search)')
    expect(md).toContain('1. PMs earn £85–110k\n   > "median £97k"\n   - Pay · https://levels.fyi/x · 2026-09 · medium confidence')
    expect(md).toContain('unreadable link: javascript:alert(1)')
  })

  it('omits empty sections and sources when there is no research', () => {
    const bare = reportToMarkdown({ ...report, blockers: [], gaps: [], questionsToAsk: [], unknowns: [] }, null, { ...meta, company: null, jobUrl: null })
    expect(bare.startsWith('# Deep dive: Senior PM\n')).toBe(true)
    expect(bare).not.toContain('## Blockers')
    expect(bare).not.toContain('## Sources')
    expect(bare).not.toContain('Job ad: https')
    expect(bare).not.toMatch(/\n{3,}/)
  })
})
