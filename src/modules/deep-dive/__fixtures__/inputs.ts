// Test fixtures for the deep dive: a gather result and a model-shaped report.

import { emptySearchProfile } from '@/modules/search-profile/schema'
import type { GatherResult } from '../gather'
import type { DeepDiveResearch, Finding, ResearcherOutcome } from '../schema'

/** A minimal report as a model would write it (flat evidence). */
export function modelReport(over: Record<string, unknown> = {}) {
  return {
    verdict: 'apply_with_caveats',
    verdictSummary: 'Good fit with one open question.',
    worthTailoredCv: { answer: true, reason: 'Strong overlap.' },
    likelihood: { band: 'medium', reason: 'Meets most must-haves.' },
    blockers: [],
    gaps: [],
    strengths: [],
    practicalities: {
      location: { summary: 'London, hybrid.', workMode: 'hybrid', relocationNeeded: false },
      sponsorship: { needed: false, register: 'unknown', adWording: 'silent', meetsSalaryThreshold: null, summary: 'Not needed.' },
      employmentType: 'Permanent',
      other: [],
    },
    pay: { stated: null, market: null, ask: null, vsSearchProfile: 'No floor set.' },
    company: { summary: 'A software company.', signals: [] },
    cvStrategy: { leadWith: [], emphasise: [], playDown: [], positioning: 'Lead with delivery.' },
    questionsToAsk: [],
    unknowns: [],
    ...over,
  }
}

export const JD = 'We are hiring a Platform Lead in London. Hybrid, 3 days in the office. Candidates must have the right to work in the UK.'

export function gatherFixture(over: Partial<GatherResult> = {}): GatherResult {
  return {
    brief: {
      title: 'Platform Lead',
      company: 'Acme',
      url: 'https://jobs.example/acme/1',
      countries: ['GB'],
      jobDescription: JD,
      salaryBand: '£90k–£110k',
      isRecruitmentAgency: false,
      ukJob: true,
    },
    companyId: 'co-1',
    profileText: '# Jane Candidate\nPRIVATE_PROFILE_MARKER',
    searchProfile: {
      ...emptySearchProfile,
      careerGoals: 'PRIVATE_GOALS_MARKER',
      eligibility: { currentCountry: 'GB', citizenships: ['FR'], visas: [], salaryFloors: [{ currency: 'GBP', floor: 95000, target: 110000 }], dealbreakers: [] },
    },
    writingRules: '',
    writingBrief: null,
    notes: 'PRIVATE_NOTES_MARKER',
    salaryEstimate: null,
    earlyAssessment: {
      id: 'as-1', score: 62, level: 'consider', blocked: false,
      blockers: [{ kind: 'work_rights', severity: 'unconfirmed', label: 'Right to work in GB' }],
      strengths: ['Platform leadership'], gaps: ['Kubernetes'], unsettled: [], facts: null, combine: null,
    },
    sponsorship: { needed: true, jobCountries: ['GB'], register: 'licensed', sponsorStatus: null },
    cachedCompanyResearch: null,
    inputsHash: 'hash-1',
    ...over,
  } as GatherResult
}

export function finding(claim: string, over: Partial<Finding> = {}): Finding {
  return { topic: 't', claim, sourceUrl: 'https://src.example/a', quote: null, publishedAt: null, confidence: 'medium', ...over }
}

export function outcome(over: Partial<ResearcherOutcome> = {}): ResearcherOutcome {
  return { status: 'ok', reason: null, findings: [], model: 'research-model', sourceCount: 0, ...over }
}

export function researchFixture(findings: Finding[] = [finding('Acme has 200 staff')]): DeepDiveResearch {
  const researchers = { company: outcome({ findings }), pay: outcome({ status: 'failed', reason: 'rate_limit' }), practicalities: outcome() }
  return { researchers, findings: findings.map((f) => ({ ...f, researcher: 'company' as const })) }
}
