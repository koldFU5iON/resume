import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { fetchJobList, fetchDescription } from './smartrecruiters'

beforeEach(() => { mockFetch.mockReset() })

describe('fetchJobList (SmartRecruiters)', () => {
  it('maps content array to JobListing shape', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            id: 'abc123',
            name: 'Senior Software Engineer',
            releasedDate: '2026-01-15T10:00:00.000Z',
            location: { city: 'Amsterdam', country: 'NL', remote: false },
            ref: 'https://api.smartrecruiters.com/v1/companies/Canva/postings/abc123',
          },
        ],
      }),
    })

    const listings = await fetchJobList('Canva')

    expect(listings).toHaveLength(1)
    expect(listings[0]).toMatchObject({
      externalId: 'abc123',
      title: 'Senior Software Engineer',
      location: 'Amsterdam, NL',
      url: 'https://jobs.smartrecruiters.com/Canva/abc123',
    })
    expect(listings[0].postedAt).toBeInstanceOf(Date)
  })

  it('returns Remote for remote listings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            id: 'xyz',
            name: 'Remote Engineer',
            releasedDate: null,
            location: { remote: true },
            ref: 'https://jobs.smartrecruiters.com/Canva/remote-engineer-xyz',
          },
        ],
      }),
    })

    const listings = await fetchJobList('Canva')
    expect(listings[0].location).toBe('Remote')
    expect(listings[0].postedAt).toBeNull()
  })

  it('handles missing content array', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    const listings = await fetchJobList('Canva')
    expect(listings).toHaveLength(0)
  })

  it('throws when API returns error status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    await expect(fetchJobList('unknown-company')).rejects.toThrow('SmartRecruiters returned 404')
  })
})

describe('fetchDescription (SmartRecruiters)', () => {
  it('returns job description text from jobAd.sections.jobDescription.text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jobAd: {
          sections: {
            jobDescription: { text: '<p>We are hiring...</p>' },
          },
        },
      }),
    })

    const result = await fetchDescription('Canva', 'abc123')
    expect(result).toBe('<p>We are hiring...</p>')
  })

  it('returns null when job is not found', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    const result = await fetchDescription('Canva', 'bad-id')
    expect(result).toBeNull()
  })

  it('returns null when jobAd sections are missing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    const result = await fetchDescription('Canva', 'abc123')
    expect(result).toBeNull()
  })
})
