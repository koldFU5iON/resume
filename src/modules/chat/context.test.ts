import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    jobApplication: { findMany: vi.fn().mockResolvedValue([]) },
    interviewPrepSession: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('@/modules/profile-map/load', async () => {
  const { buildVault } = await import('@/modules/profile-map/build')
  const { vaultSource } = await import('@/modules/profile-map/__fixtures__/source')
  return {
    loadVault: vi.fn().mockResolvedValue(buildVault(vaultSource({ name: 'Devon Stanton', headline: 'Senior Engineer' }))),
  }
})

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

  it('builds the overview from the vault, pointing at the profile tools', async () => {
    const result = await buildSystemPrompt('profile-1', null)
    expect(result).toContain('Most recent role: Program Manager at Fictional Freight')
    expect(result).toContain('Top skills: Release management (expert), Jira (advanced)')
    expect(result).toContain('- Target roles: Head of Delivery')
    expect(result).toContain('call profile_map first')
    expect(result).not.toContain('robin@example.test')
  })

  it('includes memory summaries when present', async () => {
    const result = await buildSystemPrompt('profile-1', null)
    expect(result).toContain('Past session summary.')
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

  it('describes an old CV as read-only and offers no CV edit tools (#469)', async () => {
    const result = await buildSystemPrompt('profile-1', {
      type: 'cv',
      cvId: 'cv-1',
      title: 'Stripe Application',
      company: 'Stripe',
    })
    expect(result).toContain('read-only CV')
    expect(result).toContain('Copy to writing desk')
    expect(result).not.toMatch(/propose_cv_update|propose_cv_section_create/)
  })
})

describe('buildSystemPrompt — writing desk', () => {
  it('describes a job document with its job and deep dive', async () => {
    const result = await buildSystemPrompt('profile-1', {
      type: 'writing_desk', deskId: 'desk-1', jobId: 'job-1', title: 'Engineer', company: 'Acme', documentType: 'cv', revision: 2,
    })
    expect(result).toContain('for "Engineer" at Acme')
    expect(result).toContain('Job ID: job-1')
  })

  it('describes the master CV (#469) with no job and no deep dive', async () => {
    const result = await buildSystemPrompt('profile-1', {
      type: 'writing_desk', deskId: 'desk-master', title: 'Master CV', isMaster: true, documentType: 'cv', revision: 1,
    })
    expect(result).toContain('editing their master CV')
    expect(result).toContain('Writing Desk ID: desk-master')
    expect(result).not.toContain('Job ID:')
    expect(result).not.toContain('undefined')
  })
})
