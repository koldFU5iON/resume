import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: { jobApplication: { updateMany: vi.fn() } } }))
vi.mock('@/modules/llm/client', () => ({ assertLLMConfigured: vi.fn() }))
vi.mock('@/modules/jobs/extract-fetch', () => ({ fetchPageContent: vi.fn() }))
vi.mock('@/modules/jobs/extract-llm', () => ({ extractWithLLM: vi.fn() }))

import { prisma } from '@/lib/db'
import { assertLLMConfigured } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import { fetchPageContent } from '@/modules/jobs/extract-fetch'
import { extractWithLLM } from '@/modules/jobs/extract-llm'
import { enrichJob, isClearlyBetterDescription, missingFields, needsEnrichment, REPLACED_DESCRIPTION, type EnrichJob } from './enrich'

const mockUpdate = vi.mocked(prisma.jobApplication.updateMany)
const mockConfigured = vi.mocked(assertLLMConfigured)
const mockFetch = vi.mocked(fetchPageContent)
const mockExtract = vi.mocked(extractWithLLM)

const thin: EnrichJob = {
  id: 'job-1',
  url: 'https://jobs.example.com/1',
  title: '(untitled)',
  company: 'Acme (typed by user)',
  jobDescription: '',
  countries: [],
  salaryBand: null,
}

const extracted = {
  title: 'Programme Manager',
  company: 'Acme Corp',
  location: 'Paris, France',
  jobDescription: 'Full description.',
  salaryBand: '€90k–€110k',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConfigured.mockResolvedValue(undefined)
  mockFetch.mockResolvedValue({ ok: true, html: '<html></html>', via: 'raw' })
  mockExtract.mockResolvedValue({ ok: true, data: extracted })
  mockUpdate.mockResolvedValue({ count: 1 })
})

describe('missingFields', () => {
  it('treats placeholders and empties as missing', () => {
    expect(missingFields(thin)).toEqual(['title', 'jobDescription', 'countries', 'salaryBand'])
    expect(missingFields({ ...thin, company: '(unknown)' })).toContain('company')
    expect(missingFields({ ...thin, title: 'Real', jobDescription: 'x', countries: ['FR'], salaryBand: '£1' })).toEqual([])
  })
})

describe('enrichJob', () => {
  it('fills only missing fields and never overwrites user values', async () => {
    const res = await enrichJob('p1', thin)
    expect(res.filled).toEqual(['title', 'jobDescription', 'countries', 'salaryBand'])
    expect(res.job.company).toBe('Acme (typed by user)')
    expect(res.job.title).toBe('Programme Manager')
    expect(res.job.countries).toEqual(['Paris', 'France'])
    expect(mockUpdate).toHaveBeenCalledWith({
      where: {
        id: 'job-1', profileId: 'p1',
        title: '(untitled)', jobDescription: '', countries: { equals: [] }, salaryBand: null,
      },
      data: {
        title: 'Programme Manager',
        jobDescription: 'Full description.',
        countries: ['Paris', 'France'],
        salaryBand: '€90k–€110k',
      },
    })
  })

  it('uses the enrich feature tag, fetching once', async () => {
    await enrichJob('p1', thin)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('https://jobs.example.com/1')
    expect(mockExtract).toHaveBeenCalledWith('<html></html>', 'p1', expect.objectContaining({
      feature: 'job-assessment-enrich', timeoutMs: 30_000, redactInvalidOutput: true,
    }))
    expect(mockExtract.mock.calls[0][2]).not.toHaveProperty('model')
  })

  it('reports a timed-out extraction clearly', async () => {
    mockExtract.mockResolvedValueOnce({ ok: false, error: 'x', timedOut: true })
    const res = await enrichJob('p1', thin)
    expect(res).toMatchObject({ filled: [], error: 'Reading the job page timed out' })
  })

  it('never fetches just for missing countries or salary', async () => {
    const job = { ...thin, title: 'Programme Manager', jobDescription: 'Some description.' }
    expect(needsEnrichment(job)).toBe(false)
    const res = await enrichJob('p1', job)
    expect(res.filled).toEqual([])
    expect(mockConfigured).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fills countries and salary opportunistically when a fetch happens anyway', async () => {
    const res = await enrichJob('p1', { ...thin, title: 'Programme Manager' }) // description missing → fetch
    expect(res.filled).toEqual(['jobDescription', 'countries', 'salaryBand'])
  })

  it('fetches when only the description may be replaced', () => {
    const job = { ...thin, title: 'PM', jobDescription: 'Teaser.', countries: ['FR'], salaryBand: '€1' }
    expect(needsEnrichment(job)).toBe(false)
    expect(needsEnrichment(job, { replaceDescription: true })).toBe(true)
  })

  it('does nothing without a URL', async () => {
    const res = await enrichJob('p1', { ...thin, url: null })
    expect(res.filled).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws not_configured before fetching when the user has no key', async () => {
    mockConfigured.mockRejectedValueOnce(new LLMError('no key', 'not_configured'))
    await expect(enrichJob('p1', thin)).rejects.toMatchObject({ kind: 'not_configured' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reports a failed fetch without writing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, error: 'blocked' })
    const res = await enrichJob('p1', thin)
    expect(res).toMatchObject({ filled: [], error: 'Could not fetch the job page' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('reports a failed extraction without writing', async () => {
    mockExtract.mockResolvedValueOnce({ ok: false, error: 'x' })
    const res = await enrichJob('p1', thin)
    expect(res.filled).toEqual([])
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('writes nothing when the user edited the job meanwhile', async () => {
    mockUpdate.mockResolvedValueOnce({ count: 0 })
    const res = await enrichJob('p1', thin)
    expect(res.filled).toEqual([])
    expect(res.job).toEqual(thin)
  })
})

describe('enrichJob — replacing an incomplete description', () => {
  const teaser = 'Exciting role at Acme! Apply on LinkedIn to see more.'
  const complete: EnrichJob = {
    id: 'job-2',
    url: 'https://jobs.example.com/2',
    title: 'Programme Manager (user title)',
    company: 'Acme (user company)',
    jobDescription: teaser,
    countries: ['FR'],
    salaryBand: '€90k',
  }
  const longPage = 'Full posting with responsibilities and requirements. '.repeat(20).trim()

  it('replaces a teaser with a longer page and records it as replaced', async () => {
    mockExtract.mockResolvedValueOnce({ ok: true, data: { ...extracted, jobDescription: longPage } })
    const res = await enrichJob('p1', complete, { replaceDescription: true })
    expect(res.filled).toEqual([REPLACED_DESCRIPTION])
    expect(res.job.jobDescription).toBe(longPage)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'job-2', profileId: 'p1', jobDescription: teaser },
      data: { jobDescription: longPage },
    })
  })

  it.each([
    ['shorter', 'Short.'],
    ['barely longer', 'x'.repeat(800)],
  ])('does not use a fetched description that is %s', async (_label, fetched) => {
    const current = 'y'.repeat(700)
    mockExtract.mockResolvedValueOnce({ ok: true, data: { jobDescription: fetched } })
    const res = await enrichJob('p1', { ...complete, jobDescription: current }, { replaceDescription: true })
    expect(res.filled).toEqual([])
    expect(res.job.jobDescription).toBe(current)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('does not use a fetched description that would still fail the length check', async () => {
    mockExtract.mockResolvedValueOnce({ ok: true, data: { jobDescription: 'z'.repeat(500) } })
    const res = await enrichJob('p1', { ...complete, jobDescription: 'short teaser' }, { replaceDescription: true })
    expect(res.filled).toEqual([])
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('never replaces a non-empty description unless asked to', async () => {
    mockExtract.mockResolvedValueOnce({ ok: true, data: { ...extracted, jobDescription: longPage } })
    const res = await enrichJob('p1', complete)
    expect(res.filled).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('lets a concurrent user edit win', async () => {
    mockExtract.mockResolvedValueOnce({ ok: true, data: { jobDescription: longPage } })
    mockUpdate.mockResolvedValueOnce({ count: 0 })
    const res = await enrichJob('p1', complete, { replaceDescription: true })
    expect(mockUpdate.mock.calls[0][0].where).toMatchObject({ jobDescription: teaser })
    expect(res.filled).toEqual([])
    expect(res.job).toEqual(complete)
  })

  it('still never overwrites the title or company', async () => {
    mockExtract.mockResolvedValueOnce({
      ok: true,
      data: { title: 'Page title', company: 'Page company', jobDescription: longPage, location: 'Berlin', salaryBand: '€1' },
    })
    const res = await enrichJob('p1', complete, { replaceDescription: true })
    expect(res.filled).toEqual([REPLACED_DESCRIPTION])
    const { data } = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(Object.keys(data)).toEqual(['jobDescription'])
    expect(res.job.title).toBe('Programme Manager (user title)')
    expect(res.job.company).toBe('Acme (user company)')
  })

  it('fills an empty description as a plain fill, not a replacement', async () => {
    const res = await enrichJob('p1', { ...complete, jobDescription: '' }, { replaceDescription: true })
    expect(res.filled).toEqual(['jobDescription'])
  })
})

describe('isClearlyBetterDescription', () => {
  it('needs the length check and 1.5× the current length', () => {
    expect(isClearlyBetterDescription('a'.repeat(400), 'b'.repeat(600))).toBe(true)
    expect(isClearlyBetterDescription('a'.repeat(401), 'b'.repeat(600))).toBe(false)
    expect(isClearlyBetterDescription('a'.repeat(10), 'b'.repeat(599))).toBe(false)
  })
})
