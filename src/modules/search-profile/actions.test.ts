import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: { userSettings: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() } } }))
vi.mock('@/lib/session', () => ({ requireProfile: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('nanoid', () => ({ nanoid: () => 'test-id-123' }))

import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { emitSuggestion, acceptSuggestion, dismissSuggestion, saveSearchProfile } from './actions'
import { emptySearchProfile } from './schema'

const mockProfile = { id: 'profile-1', name: 'Devon' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireProfile).mockResolvedValue({ profile: mockProfile } as never)
})

describe('emitSuggestion', () => {
  it('adds a new suggestion when queue is empty', async () => {
    vi.mocked(prisma.userSettings.findUnique).mockResolvedValue({ searchSuggestions: null } as never)
    vi.mocked(prisma.userSettings.upsert).mockResolvedValue({} as never)

    await emitSuggestion('profile-1', {
      field: 'roles',
      suggestedValue: ['Head of DevRel'],
      reason: 'You explored DevRel paths in chat',
      source: 'chat',
    })

    expect(prisma.userSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          searchSuggestions: expect.arrayContaining([
            expect.objectContaining({ field: 'roles', source: 'chat', id: 'test-id-123' }),
          ]),
        }),
      }),
    )
  })

  it('skips if a pending suggestion for the same field already exists', async () => {
    const existing = [{
      id: 'existing-1', field: 'roles', suggestedValue: ['DevRel'],
      reason: 'earlier', source: 'job-fit', createdAt: '2026-01-01T00:00:00Z',
    }]
    vi.mocked(prisma.userSettings.findUnique).mockResolvedValue({ searchSuggestions: existing } as never)

    await emitSuggestion('profile-1', {
      field: 'roles', suggestedValue: ['Head of DevRel'], reason: 'new', source: 'chat',
    })

    expect(prisma.userSettings.upsert).not.toHaveBeenCalled()
  })
})

describe('acceptSuggestion', () => {
  it('merges the suggestion value into searchProfile and removes it from the queue', async () => {
    const suggestion = {
      id: 'sugg-1', field: 'salaryBand',
      suggestedValue: { min: 90000, max: null, currency: 'GBP' },
      reason: 'noted in job fit', source: 'job-fit', createdAt: '2026-01-01T00:00:00Z',
    }
    vi.mocked(prisma.userSettings.findUnique).mockResolvedValue({
      searchProfile: { preferredName: 'Devon', currentRole: '', roles: [], countries: [], remotePreference: '', salaryBand: null, careerGoals: '', pivotContext: '', extraContext: '' },
      searchSuggestions: [suggestion],
    } as never)
    vi.mocked(prisma.userSettings.update).mockResolvedValue({} as never)

    await acceptSuggestion('sugg-1')

    expect(prisma.userSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          searchProfile: expect.objectContaining({ salaryBand: { min: 90000, max: null, currency: 'GBP' } }),
          searchSuggestions: [],
        }),
      }),
    )
  })

  it('drops an invalid suggestion without blanking the stored field', async () => {
    const suggestion = {
      id: 'sugg-2', field: 'remotePreference', suggestedValue: 'sometimes-ish',
      reason: 'bad value', source: 'chat', createdAt: '2026-01-01T00:00:00Z',
    }
    vi.mocked(prisma.userSettings.findUnique).mockResolvedValue({
      searchProfile: { ...emptySearchProfile, remotePreference: 'hybrid' },
      searchSuggestions: [suggestion],
    } as never)
    vi.mocked(prisma.userSettings.update).mockResolvedValue({} as never)

    await acceptSuggestion('sugg-2')

    const data = vi.mocked(prisma.userSettings.update).mock.calls[0][0].data as Record<string, unknown>
    expect(data.searchProfile).toEqual(expect.objectContaining({ remotePreference: 'hybrid' }))
    expect(data.searchSuggestions).toEqual([])
  })
})

describe('dismissSuggestion', () => {
  it('removes the suggestion without touching searchProfile', async () => {
    const suggestion = {
      id: 'sugg-2', field: 'roles', suggestedValue: ['DevRel'],
      reason: 'chat', source: 'chat', createdAt: '2026-01-01T00:00:00Z',
    }
    vi.mocked(prisma.userSettings.findUnique).mockResolvedValue({ searchSuggestions: [suggestion] } as never)
    vi.mocked(prisma.userSettings.update).mockResolvedValue({} as never)

    await dismissSuggestion('sugg-2')

    expect(prisma.userSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { searchSuggestions: [] } }),
    )
  })
})

describe('saveSearchProfile', () => {
  it('normalises the whole profile, stores it scoped to the profile, and returns what it stored', async () => {
    vi.mocked(prisma.userSettings.upsert).mockResolvedValue({} as never)

    const result = await saveSearchProfile({
      ...emptySearchProfile,
      preferredName: `  ${'D'.repeat(130)}  `,
      careerGoals: 'g'.repeat(4000),
      eligibility: {
        currentCountry: 'fr',
        citizenships: ['es', 'ES', 'uk'],
        visas: [{ country: 'gb', type: 'Skilled Worker', expiresOn: '2027-03-31' }],
        salaryFloors: [
          { currency: 'eur', floor: 90000, target: 100000 },
          { currency: 'EUR', floor: 1, target: null },
        ],
        dealbreakers: ['  Fixed-term contract  '],
      },
    })

    const expected = {
      ...emptySearchProfile,
      preferredName: 'D'.repeat(120),
      careerGoals: 'g'.repeat(3000),
      eligibility: {
        currentCountry: 'FR',
        citizenships: ['ES', 'GB'],
        visas: [{ country: 'GB', type: 'Skilled Worker', expiresOn: '2027-03-31' }],
        salaryFloors: [{ currency: 'EUR', floor: 90000, target: 100000 }],
        dealbreakers: ['Fixed-term contract'],
      },
    }
    expect(prisma.userSettings.upsert).toHaveBeenCalledWith({
      where: { profileId: 'profile-1' },
      create: { profileId: 'profile-1', searchProfile: expected },
      update: { searchProfile: expected },
    })
    expect(result).toEqual({ ok: true, profile: expected })
  })

  it('rejects a non-object without writing', async () => {
    const result = await saveSearchProfile(null as never)
    expect(result).toEqual({ ok: false, error: 'Invalid search profile' })
    expect(prisma.userSettings.upsert).not.toHaveBeenCalled()
  })

  it('requires a signed-in user', async () => {
    vi.mocked(requireProfile).mockRejectedValue(new Error('Unauthorized'))
    await expect(saveSearchProfile(emptySearchProfile)).rejects.toThrow('Unauthorized')
    expect(prisma.userSettings.upsert).not.toHaveBeenCalled()
  })
})
