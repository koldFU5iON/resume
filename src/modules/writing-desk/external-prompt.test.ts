import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {
  writingDeskDocument: { findFirst: vi.fn() },
  jobDeepDive: { findFirst: vi.fn() },
} }))
vi.mock('@/modules/mcp/context', () => ({ getWritingContractForProfile: vi.fn() }))

import { prisma } from '@/lib/db'
import { modelReport } from '@/modules/deep-dive/__fixtures__/inputs'
import { getWritingContractForProfile } from '@/modules/mcp/context'
import { buildWritingContract } from '@/modules/mcp/contract'
import { DEFAULT_CV_STRUCTURE } from './structure-guide'
import { BLOCK_LIST } from './markdown'
import { getExternalCvPrompt } from './external-prompt'

const desk = { documentType: 'cv', jobApplication: { id: 'job-1', title: 'Platform Lead', company: 'Acme' } }
const contract = buildWritingContract({ source: 'default', sections: DEFAULT_CV_STRUCTURE }, 'paste')

describe('external CV prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.writingDeskDocument.findFirst).mockResolvedValue(desk as never)
    vi.mocked(prisma.jobDeepDive.findFirst).mockResolvedValue(null)
    vi.mocked(getWritingContractForProfile).mockResolvedValue(contract)
  })

  it('includes the full saved strategy, registered block examples and a read-only paste workflow', async () => {
    const strategy = {
      positioning: 'A platform lead who ships.',
      leadWith: ['Migration delivery'],
      emphasise: [{ item: 'Team leadership', why: 'The role manages teams' }],
      playDown: ['Agency years'],
    }
    vi.mocked(prisma.jobDeepDive.findFirst).mockResolvedValue({ report: modelReport({ cvStrategy: strategy }) } as never)

    const prompt = await getExternalCvPrompt('profile-1', 'desk-1')

    expect(prompt).toContain(JSON.stringify(strategy, null, 2))
    expect(prompt).toContain('jobId "job-1"')
    expect(prompt).toContain('"documentId": "desk-1"')
    for (const block of BLOCK_LIST) expect(prompt).toContain(block.example)
    expect(prompt).toContain('profile_search and profile_get_note')
    expect(prompt).toContain('one fenced code block labelled markdown')
    expect(prompt).toContain('Do not call create_draft')
    expect(prompt).toContain('Ignore the contract field it returns')
    expect(prompt).toContain('replace it manually after pasting')
    expect(prompt).not.toContain('the app fills it in')
    expect(getWritingContractForProfile).toHaveBeenCalledWith('profile-1', 'paste')
    expect(prisma.writingDeskDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'desk-1', profileId: 'profile-1' } }))
    expect(prisma.jobDeepDive.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: 'profile-1', jobApplicationId: 'job-1', status: 'complete' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }))
  })

  it.each([null, { report: { cvStrategy: {} } }])('handles missing or unreadable strategy: %j', async run => {
    vi.mocked(prisma.jobDeepDive.findFirst).mockResolvedValue(run as never)
    const prompt = await getExternalCvPrompt('profile-1', 'desk-1')
    expect(prompt).toContain('No readable completed deep-dive strategy is saved')
    expect(prompt).toContain('If MCP is unavailable, ask me to connect it')
    expect(prompt).toContain(contract)
  })

  it('rejects documents outside the profile before reading strategy or contract', async () => {
    vi.mocked(prisma.writingDeskDocument.findFirst).mockResolvedValue(null)
    await expect(getExternalCvPrompt('other-profile', 'desk-1')).rejects.toThrow('Writing desk not found')
    expect(prisma.jobDeepDive.findFirst).not.toHaveBeenCalled()
    expect(getWritingContractForProfile).not.toHaveBeenCalled()
  })

  it('rejects non-CV documents', async () => {
    vi.mocked(prisma.writingDeskDocument.findFirst).mockResolvedValue({ ...desk, documentType: 'cover-letter' } as never)
    await expect(getExternalCvPrompt('profile-1', 'desk-1')).rejects.toThrow('Choose a CV document')
  })

  it('preserves automatic contact filling for existing MCP drafts', () => {
    expect(buildWritingContract({ source: 'default', sections: DEFAULT_CV_STRUCTURE })).toContain('the app fills it in when the owner accepts the draft')
  })
})
