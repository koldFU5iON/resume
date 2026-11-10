import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'profile-1' } }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    companyWatch: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    discoveredJob: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    jobApplication: { create: vi.fn() },
    userSettings: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    experience: { findMany: vi.fn().mockResolvedValue([]) },
    skill: { findMany: vi.fn().mockResolvedValue([]) },
    profile: { findUnique: vi.fn().mockResolvedValue({ headline: null }) },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/job-assessment/queue', () => ({ queueJobAssessmentSafely: vi.fn() }))
vi.mock('./ats-discovery', () => ({ discoverAts: vi.fn() }))
vi.mock('./adapters/index', () => ({ getAdapter: vi.fn() }))
vi.mock('@/modules/llm/client', () => ({
  completeStructured: vi.fn(),
}))
vi.mock('@/modules/profile/snapshot', () => ({
  buildProfileSnapshot: vi.fn().mockResolvedValue({}),
  serializeProfileForLLM: vi.fn().mockReturnValue('profile text'),
}))
vi.mock('@/modules/llm/prompt-context', () => ({
  loadWritingRules: vi.fn().mockResolvedValue(''),
  composeSystem: vi.fn().mockReturnValue('system'),
}))
vi.mock('@/modules/onboarding/schema', () => ({
  normalizeOnboardingContext: vi.fn().mockReturnValue({
    targetRole: 'Senior Engineer',
    currentRole: '',
    industries: '',
    workPreferences: '',
    extraContext: '',
    preferredName: '',
    additionalRoles: [],
  }),
}))

import { addCompany, scanCompany, importJob, ignoreJob, addCompanyFromHint, getAtsHintFromUrl, removeWatch } from './actions'
import { prisma } from '@/lib/db'
import { queueJobAssessmentSafely } from '@/modules/job-assessment/queue'
import { discoverAts } from './ats-discovery'
import { getAdapter } from './adapters/index'

const mockDiscoverAts = vi.mocked(discoverAts)
const mockGetAdapter = vi.mocked(getAdapter)
const mockCreate = vi.mocked(prisma.companyWatch.create)
const mockFindFirst = vi.mocked(prisma.companyWatch.findFirst)
const mockJobCreate = vi.mocked(prisma.jobApplication.create)
const mockDiscoveredFindFirst = vi.mocked(prisma.discoveredJob.findFirst)

describe('addCompany', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls discoverAts and creates CompanyWatch', async () => {
    mockDiscoverAts.mockResolvedValueOnce({
      provider: 'greenhouse',
      boardSlug: 'acme',
      careersUrl: 'https://boards.greenhouse.io/acme',
      confidence: 0.9,
      reasoning: 'found greenhouse',
    })
    mockCreate.mockResolvedValueOnce({ id: 'watch-1' } as never)

    const result = await addCompany({ name: 'Acme', website: 'https://acme.com', searchLocations: [], includeRemote: true })

    expect(result.ok).toBe(true)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Acme',
          atsProvider: 'greenhouse',
          boardSlug: 'acme',
          profileId: 'profile-1',
        }),
      }),
    )
  })

  it('sets status discovery_failed when provider is unknown', async () => {
    mockDiscoverAts.mockResolvedValueOnce({
      provider: 'unknown', confidence: 0, reasoning: 'not found',
    })
    mockCreate.mockResolvedValueOnce({ id: 'watch-2' } as never)

    const result = await addCompany({ name: 'NoATS', website: 'https://noats.com', searchLocations: [], includeRemote: true })

    expect(result.ok).toBe(true)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'discovery_failed' }),
      }),
    )
  })

  it('skips discoverAts when URL is a direct Greenhouse job board URL', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'watch-3' } as never)

    const result = await addCompany({
      name: '2K',
      website: 'https://job-boards.greenhouse.io/2k/jobs/7762602003',
      searchLocations: [],
      includeRemote: true,
    })

    expect(result.ok).toBe(true)
    expect(mockDiscoverAts).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          atsProvider: 'greenhouse',
          boardSlug: '2k',
          confidence: 1,
          status: 'active',
        }),
      }),
    )
  })

  it('skips discoverAts when URL is a Greenhouse board-level URL', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'watch-4' } as never)

    const result = await addCompany({
      name: 'Stripe',
      website: 'https://boards.greenhouse.io/stripe',
      searchLocations: [],
      includeRemote: true,
    })

    expect(result.ok).toBe(true)
    expect(mockDiscoverAts).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ atsProvider: 'greenhouse', boardSlug: 'stripe' }),
      }),
    )
  })
})

describe('scanCompany', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns not_found when watch does not exist', async () => {
    mockFindFirst.mockResolvedValueOnce(null)
    const result = await scanCompany('nonexistent')
    expect(result).toEqual({ ok: false, error: 'not_found' })
  })

  it('returns no_ats_detected when boardSlug is null', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 'w1', profileId: 'profile-1', atsProvider: 'unknown', boardSlug: null, name: 'X', status: 'active',
    } as never)
    const result = await scanCompany('w1')
    expect(result).toEqual({ ok: false, error: 'no_ats_detected' })
  })

  it('returns fetch_failed when adapter throws', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 'w1', profileId: 'profile-1', atsProvider: 'greenhouse', boardSlug: 'acme', name: 'Acme', status: 'active',
    } as never)
    mockGetAdapter.mockReturnValueOnce({
      fetchJobList: vi.fn().mockRejectedValue(new Error('network')),
      fetchDescription: vi.fn(),
    })
    vi.mocked(prisma.discoveredJob.findMany).mockResolvedValueOnce([])

    const result = await scanCompany('w1')
    expect(result).toEqual({ ok: false, error: 'fetch_failed' })
  })
})

describe('importJob', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates a JobApplication and marks discovered job as imported', async () => {
    mockDiscoveredFindFirst.mockResolvedValueOnce({
      id: 'dj-1', profileId: 'profile-1', title: 'Engineer', company: 'Acme',
      location: 'Remote', url: 'https://x.com', description: 'desc',
      postedAt: new Date('2026-01-01'), fitLabel: null, fitScore: null,
      fitJustification: null, status: 'new',
    } as never)
    mockJobCreate.mockResolvedValueOnce({ id: 'ja-1' } as never)
    vi.mocked(prisma.discoveredJob.updateMany).mockResolvedValueOnce({ count: 1 })

    const result = await importJob('dj-1')

    expect(result).toMatchObject({ ok: true, jobId: 'ja-1' })
    expect(mockJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Engineer',
          company: 'Acme',
          applicationSource: 'cold',
        }),
      }),
    )
    expect(vi.mocked(prisma.discoveredJob.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'dj-1', profileId: 'profile-1' }),
        data: expect.objectContaining({ status: 'imported', importedJobId: 'ja-1' }),
      }),
    )
    expect(queueJobAssessmentSafely).toHaveBeenCalledWith('profile-1', 'ja-1', { reason: 'job-hunt-import' })
  })

  it('queues nothing when the discovered job is missing', async () => {
    mockDiscoveredFindFirst.mockResolvedValueOnce(null)
    expect(await importJob('dj-x')).toEqual({ ok: false, error: 'Job not found' })
    expect(queueJobAssessmentSafely).not.toHaveBeenCalled()
  })
})

describe('ignoreJob', () => {
  it('sets status to ignored via updateMany', async () => {
    vi.mocked(prisma.discoveredJob.updateMany).mockResolvedValueOnce({ count: 1 })

    await ignoreJob('dj-1')

    expect(vi.mocked(prisma.discoveredJob.updateMany)).toHaveBeenCalledWith({
      where: { id: 'dj-1', profileId: 'profile-1' },
      data: { status: 'ignored' },
    })
  })
})

describe('addCompanyFromHint', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates CompanyWatch with confidence 1 and active status', async () => {
    vi.mocked(prisma.companyWatch.create).mockResolvedValueOnce({ id: 'watch-3' } as never)

    const result = await addCompanyFromHint({
      provider: 'greenhouse',
      boardSlug: 'acme',
      name: 'Acme Corp',
    })

    expect(result.ok).toBe(true)
    expect(vi.mocked(prisma.companyWatch.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          atsProvider: 'greenhouse',
          boardSlug: 'acme',
          confidence: 1,
          status: 'active',
        }),
      }),
    )
  })
})

describe('getAtsHintFromUrl', () => {
  it('detects Greenhouse from URL', async () => {
    const hint = await getAtsHintFromUrl(
      'https://boards.greenhouse.io/acme/jobs/123',
      'Acme',
    )
    expect(hint).not.toBeNull()
    expect(hint?.provider).toBe('greenhouse')
    expect(hint?.name).toBe('Acme')
  })

  it('returns null for non-ATS URLs', async () => {
    const hint = await getAtsHintFromUrl('https://acme.com/jobs/engineer', 'Acme')
    expect(hint).toBeNull()
  })
})

describe('addCompany — Workday URL fast-path', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('detects Workday board slug from subdomain + path', async () => {
    vi.mocked(prisma.companyWatch.create).mockResolvedValueOnce({ id: 'watch-wd' } as never)

    const result = await addCompany({
      name: 'Logitech',
      website: 'https://logitech.wd5.myworkdayjobs.com/Logitech',
      searchLocations: [],
      includeRemote: true,
    })

    expect(result.ok).toBe(true)
    expect(mockDiscoverAts).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.companyWatch.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          atsProvider: 'workday',
          boardSlug: 'logitech.wd5/Logitech',
          confidence: 1,
          status: 'active',
        }),
      }),
    )
  })
})

describe('addCompany — SuccessFactors URL fast-path', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('detects SuccessFactors board slug from company= query param', async () => {
    vi.mocked(prisma.companyWatch.create).mockResolvedValueOnce({ id: 'watch-sf' } as never)

    const result = await addCompany({
      name: 'Bentley',
      website: 'https://career4.successfactors.com/careers?company=bentleyprod',
      searchLocations: [],
      includeRemote: true,
    })

    expect(result.ok).toBe(true)
    expect(mockDiscoverAts).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.companyWatch.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          atsProvider: 'successfactors',
          boardSlug: 'bentleyprod',
          confidence: 1,
          status: 'active',
        }),
      }),
    )
  })
})

describe('addCompany — SuccessFactors EU URL fast-path', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('detects SuccessFactors EU domain from company= query param', async () => {
    vi.mocked(prisma.companyWatch.create).mockResolvedValueOnce({ id: 'watch-sf-eu' } as never)

    const result = await addCompany({
      name: 'EY',
      website: 'https://career5.successfactors.eu/careers?company=EYHRISPRD1',
      searchLocations: [],
      includeRemote: true,
    })

    expect(result.ok).toBe(true)
    expect(mockDiscoverAts).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.companyWatch.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          atsProvider: 'successfactors',
          boardSlug: 'EYHRISPRD1',
          confidence: 1,
          status: 'active',
        }),
      }),
    )
  })
})

describe('addCompany — BambooHR URL fast-path', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('detects BambooHR from subdomain URL', async () => {
    vi.mocked(prisma.companyWatch.create).mockResolvedValueOnce({ id: 'watch-bhr' } as never)

    const result = await addCompany({
      name: 'Waystone',
      website: 'https://waystone.bamboohr.com/careers/1507',
      searchLocations: [],
      includeRemote: true,
    })

    expect(result.ok).toBe(true)
    expect(mockDiscoverAts).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.companyWatch.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          atsProvider: 'bamboohr',
          boardSlug: 'waystone',
          confidence: 1,
          status: 'active',
        }),
      }),
    )
  })
})

describe('removeWatch', () => {
  it('calls deleteMany with profileId guard', async () => {
    vi.mocked(prisma.companyWatch.deleteMany).mockResolvedValueOnce({ count: 1 })

    await removeWatch('watch-1')

    expect(vi.mocked(prisma.companyWatch.deleteMany)).toHaveBeenCalledWith({
      where: { id: 'watch-1', profileId: 'profile-1' },
    })
  })
})
