import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { newRunId, resolveAttribution, type AttributionDb } from './attribution'

// p1 owns job-a (with cv-a1) and job-b; p2 owns job-x and a standalone cv-free.
const jobs = [
  { id: 'job-a', profileId: 'p1' },
  { id: 'job-b', profileId: 'p1' },
  { id: 'job-x', profileId: 'p2' },
]
const cvs = [
  { id: 'cv-a1', profileId: 'p1', jobApplicationId: 'job-a' },
  { id: 'cv-generic', profileId: 'p1', jobApplicationId: null },
  { id: 'cv-x', profileId: 'p2', jobApplicationId: 'job-x' },
]

const desks = [
  { id: 'desk-a1', profileId: 'p1', jobApplicationId: 'job-a' },
  { id: 'desk-b1', profileId: 'p1', jobApplicationId: 'job-b' },
  { id: 'desk-x', profileId: 'p2', jobApplicationId: 'job-x' },
]

const db = {
  jobApplication: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; profileId: string } }) =>
      jobs.find((j) => j.id === where.id && j.profileId === where.profileId) ? { id: where.id } : null),
  },
  cVDocument: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; profileId: string } }) => {
      const cv = cvs.find((c) => c.id === where.id && c.profileId === where.profileId)
      return cv ? { jobApplicationId: cv.jobApplicationId } : null
    }),
  },
  writingDeskDocument: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; profileId: string } }) => {
      const d = desks.find((x) => x.id === where.id && x.profileId === where.profileId)
      return d ? { jobApplicationId: d.jobApplicationId } : null
    }),
  },
}
const fakeDb = db as unknown as AttributionDb

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('resolveAttribution', () => {
  it('returns no attribution and makes no queries when none is given', async () => {
    expect(await resolveAttribution('p1', undefined, fakeDb)).toEqual({ jobApplicationId: null, cvDocumentId: null, writingDeskDocumentId: null, runId: null })
    expect(await resolveAttribution('p1', { runId: 'run-1' }, fakeDb)).toEqual({ jobApplicationId: null, cvDocumentId: null, writingDeskDocumentId: null, runId: 'run-1' })
    expect(db.jobApplication.findFirst).not.toHaveBeenCalled()
    expect(db.cVDocument.findFirst).not.toHaveBeenCalled()
    expect(db.writingDeskDocument.findFirst).not.toHaveBeenCalled()
  })

  it('keeps a job the profile owns and filters every lookup by profile', async () => {
    expect(await resolveAttribution('p1', { jobApplicationId: 'job-a' }, fakeDb))
      .toEqual({ jobApplicationId: 'job-a', cvDocumentId: null, writingDeskDocumentId: null, runId: null })
    expect(db.jobApplication.findFirst).toHaveBeenCalledWith({ where: { id: 'job-a', profileId: 'p1' }, select: { id: true } })
  })

  it("drops another profile's job and CV", async () => {
    expect(await resolveAttribution('p1', { jobApplicationId: 'job-x', cvDocumentId: 'cv-x' }, fakeDb))
      .toEqual({ jobApplicationId: null, cvDocumentId: null, writingDeskDocumentId: null, runId: null })
  })

  it('keeps a CV that belongs to the given job', async () => {
    expect(await resolveAttribution('p1', { jobApplicationId: 'job-a', cvDocumentId: 'cv-a1', writingDeskDocumentId: null, runId: 'r' }, fakeDb))
      .toEqual({ jobApplicationId: 'job-a', cvDocumentId: 'cv-a1', writingDeskDocumentId: null, runId: 'r' })
  })

  it('drops a CV that belongs to a different job but keeps the job', async () => {
    expect(await resolveAttribution('p1', { jobApplicationId: 'job-b', cvDocumentId: 'cv-a1' }, fakeDb))
      .toEqual({ jobApplicationId: 'job-b', cvDocumentId: null, writingDeskDocumentId: null, runId: null })
  })

  it("takes the job from the CV's own link when only the CV is given", async () => {
    expect(await resolveAttribution('p1', { cvDocumentId: 'cv-a1' }, fakeDb))
      .toEqual({ jobApplicationId: 'job-a', cvDocumentId: 'cv-a1', writingDeskDocumentId: null, runId: null })
    expect(await resolveAttribution('p1', { cvDocumentId: 'cv-generic' }, fakeDb))
      .toEqual({ jobApplicationId: null, cvDocumentId: 'cv-generic', writingDeskDocumentId: null, runId: null })
  })

  it('drops a CV with no job when a job is given', async () => {
    expect(await resolveAttribution('p1', { jobApplicationId: 'job-a', cvDocumentId: 'cv-generic' }, fakeDb))
      .toEqual({ jobApplicationId: 'job-a', cvDocumentId: null, writingDeskDocumentId: null, runId: null })
  })

  describe('writingDeskDocumentId', () => {
    it('keeps a desk document that belongs to the profile and the given job, filtering the lookup by profile', async () => {
      expect(await resolveAttribution('p1', { jobApplicationId: 'job-a', writingDeskDocumentId: 'desk-a1', runId: 'r' }, fakeDb))
        .toEqual({ jobApplicationId: 'job-a', cvDocumentId: null, writingDeskDocumentId: 'desk-a1', runId: 'r' })
      expect(db.writingDeskDocument.findFirst).toHaveBeenCalledWith({ where: { id: 'desk-a1', profileId: 'p1' }, select: { jobApplicationId: true } })
    })

    it("takes the job from the document's own link when only the document is given", async () => {
      expect(await resolveAttribution('p1', { writingDeskDocumentId: 'desk-b1' }, fakeDb))
        .toEqual({ jobApplicationId: 'job-b', cvDocumentId: null, writingDeskDocumentId: 'desk-b1', runId: null })
    })

    it("drops another profile's document, and an unknown one", async () => {
      expect(await resolveAttribution('p1', { writingDeskDocumentId: 'desk-x' }, fakeDb))
        .toEqual({ jobApplicationId: null, cvDocumentId: null, writingDeskDocumentId: null, runId: null })
      expect(await resolveAttribution('p1', { jobApplicationId: 'job-a', writingDeskDocumentId: 'nope' }, fakeDb))
        .toEqual({ jobApplicationId: 'job-a', cvDocumentId: null, writingDeskDocumentId: null, runId: null })
    })

    it('drops a document that belongs to a different job but keeps the job', async () => {
      expect(await resolveAttribution('p1', { jobApplicationId: 'job-a', writingDeskDocumentId: 'desk-b1' }, fakeDb))
        .toEqual({ jobApplicationId: 'job-a', cvDocumentId: null, writingDeskDocumentId: null, runId: null })
    })

    it("drops a document whose job differs from the job implied by the CV", async () => {
      expect(await resolveAttribution('p1', { cvDocumentId: 'cv-a1', writingDeskDocumentId: 'desk-b1' }, fakeDb))
        .toEqual({ jobApplicationId: 'job-a', cvDocumentId: 'cv-a1', writingDeskDocumentId: null, runId: null })
    })

    it('drops a document whose given job is not the profile\'s (no cross-profile leak)', async () => {
      expect(await resolveAttribution('p1', { jobApplicationId: 'job-x', writingDeskDocumentId: 'desk-a1' }, fakeDb))
        .toEqual({ jobApplicationId: null, cvDocumentId: null, writingDeskDocumentId: null, runId: null })
    })
  })

  it('drops a malformed runId and treats blank ids as absent', async () => {
    expect(await resolveAttribution('p1', { jobApplicationId: '  ', runId: 'has spaces!' }, fakeDb))
      .toEqual({ jobApplicationId: null, cvDocumentId: null, writingDeskDocumentId: null, runId: null })
    expect(await resolveAttribution('p1', { runId: 'x'.repeat(65) }, fakeDb)).toMatchObject({ runId: null })
  })

  it('newRunId makes distinct ids that pass validation', async () => {
    const a = newRunId()
    expect(a).not.toBe(newRunId())
    expect(await resolveAttribution('p1', { runId: a }, fakeDb)).toMatchObject({ runId: a })
  })
})
