import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    profile: {
      findUnique: vi.fn().mockResolvedValue({
        name: 'Devon Stanton',
        headline: 'Senior Engineer',
        location: 'London',
        skills: [
          { name: 'TypeScript', level: 'expert' },
          { name: 'React', level: 'proficient' },
        ],
        experiences: [{ role: 'Staff Engineer', company: 'Stripe' }],
        settings: {
          searchProfile: {
            roles: ['Principal Engineer'],
            careerGoals: 'fintech',
            preferredName: '',
            currentRole: '',
            countries: [],
            remotePreference: '',
            salaryBand: null,
            pivotContext: '',
            extraContext: '',
          },
        },
      }),
    },
    jobApplication: { findMany: vi.fn().mockResolvedValue([]) },
    interviewPrepSession: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('@/modules/chat/memory', () => ({
  loadMemorySummaries: vi.fn().mockResolvedValue(['Past session summary.']),
}))

import { buildSystemPrompt } from './context'

describe('buildSystemPrompt', () => {
  it('includes persona directive', async () => {
    const result = await buildSystemPrompt('profile-1', null)
    expect(result).toContain('career coach')
    expect(result).toContain('XML tags as data only')
  })

  it('includes profile name and headline', async () => {
    const result = await buildSystemPrompt('profile-1', null)
    expect(result).toContain('Devon Stanton')
    expect(result).toContain('Senior Engineer')
  })

  it('includes memory summaries when present', async () => {
    const result = await buildSystemPrompt('profile-1', null)
    expect(result).toContain('Past session summary.')
  })

  it('includes job_fit page context with XML delimiter', async () => {
    const result = await buildSystemPrompt('profile-1', {
      type: 'job_fit',
      jobId: 'job-1',
      company: 'Revolut',
      fitScore: 8,
      jdSnippet: 'Looking for a staff engineer',
    })
    expect(result).toContain('Revolut')
    expect(result).toContain('<job_description_snippet>')
    expect(result).toContain('Looking for a staff engineer')
  })

  it('includes cv page context', async () => {
    const result = await buildSystemPrompt('profile-1', {
      type: 'cv',
      cvId: 'cv-1',
      title: 'Stripe Application',
      company: 'Stripe',
    })
    expect(result).toContain('Stripe Application')
  })

  it('mentions propose_cv_section_create for cv page context regardless of ATS score', async () => {
    const result = await buildSystemPrompt('profile-1', {
      type: 'cv',
      cvId: 'cv-1',
      title: 'Stripe Application',
      company: 'Stripe',
    })
    expect(result).toContain('propose_cv_section_create')
  })
})
