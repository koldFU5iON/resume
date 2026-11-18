import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: { cvGeneration: { findFirst: vi.fn() }, writingDeskDocument: { count: vi.fn() } },
}))
vi.mock('@/modules/writing-desk/documents', () => ({ createWritingDeskDocument: vi.fn() }))
vi.mock('@/modules/writing-desk/draft', () => ({ createDraft: vi.fn() }))

import { prisma } from '@/lib/db'
import { createWritingDeskDocument } from '@/modules/writing-desk/documents'
import { createDraft } from '@/modules/writing-desk/draft'
import { MAX_WRITING_DESK_DOCUMENTS_PER_JOB } from '@/modules/writing-desk/schema'
import { checkLandingTarget, findLandingTarget, landCv, landingDocumentName } from './land'

const db = vi.mocked(prisma, { deep: true })
const mockCreateDoc = vi.mocked(createWritingDeskDocument)
const mockDraft = vi.mocked(createDraft)

const MD = ':::header\n# Robin\n{{contact}}\n:::\n\n## Professional Profile\n\nText.\n'
const job = { id: 'job-1', company: 'Acme', title: 'Head of Delivery' }

beforeEach(() => {
  vi.clearAllMocks()
  db.cvGeneration.findFirst.mockResolvedValue(null)
  db.writingDeskDocument.count.mockResolvedValue(0)
  mockCreateDoc.mockResolvedValue({ ok: true, id: 'doc-new' })
  mockDraft.mockResolvedValue({ ok: true, value: {} as never })
})

describe('findLandingTarget', () => {
  it('is the newest run of this profile’s job whose document still exists as a CV of the same job', async () => {
    db.cvGeneration.findFirst.mockResolvedValue({ writingDeskDocumentId: 'doc-old' } as never)
    expect(await findLandingTarget('p1', 'job-1')).toEqual({ documentId: 'doc-old' })
    expect(db.cvGeneration.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        profileId: 'p1', jobApplicationId: 'job-1', writingDeskDocumentId: { not: null },
        writingDeskDocument: { is: { profileId: 'p1', jobApplicationId: 'job-1', documentType: 'cv' } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }))
  })

  it('is null when no run has a surviving CV document', async () => {
    expect(await findLandingTarget('p1', 'job-1')).toBeNull()
  })

  it('another profile’s run or document is never found: the query is scoped by profile on the run AND the document', async () => {
    db.cvGeneration.findFirst.mockImplementation((async (a: { where: { profileId: string } }) => (a.where.profileId === 'p1' ? { writingDeskDocumentId: 'doc-1' } : null)) as never)
    expect(await findLandingTarget('p-other', 'job-1')).toBeNull()
  })
})

describe('checkLandingTarget (before any spend)', () => {
  it('draft_exists with the document id when the reusable document has a pending draft', async () => {
    db.cvGeneration.findFirst.mockResolvedValue({ writingDeskDocumentId: 'doc-1' } as never)
    db.writingDeskDocument.count.mockResolvedValue(1)
    expect(await checkLandingTarget('p1', 'job-1')).toEqual({ kind: 'draft_exists', documentId: 'doc-1' })
    expect(db.writingDeskDocument.count).toHaveBeenCalledWith({ where: { id: 'doc-1', profileId: 'p1', draftContent: { not: null } } })
  })

  it('ok with the document when it has no pending draft', async () => {
    db.cvGeneration.findFirst.mockResolvedValue({ writingDeskDocumentId: 'doc-1' } as never)
    expect(await checkLandingTarget('p1', 'job-1')).toEqual({ kind: 'ok', documentId: 'doc-1' })
  })

  it('ok with no document (one will be created) while the job has room', async () => {
    db.writingDeskDocument.count.mockResolvedValue(MAX_WRITING_DESK_DOCUMENTS_PER_JOB - 1)
    expect(await checkLandingTarget('p1', 'job-1')).toEqual({ kind: 'ok', documentId: null })
  })

  it('limit when the job holds the most documents and none is reusable', async () => {
    db.writingDeskDocument.count.mockResolvedValue(MAX_WRITING_DESK_DOCUMENTS_PER_JOB)
    expect(await checkLandingTarget('p1', 'job-1')).toEqual({ kind: 'limit' })
  })

  it('a reusable document is fine even when the job is at its limit (nothing new is created)', async () => {
    db.cvGeneration.findFirst.mockResolvedValue({ writingDeskDocumentId: 'doc-1' } as never)
    db.writingDeskDocument.count.mockResolvedValue(0) // the pending-draft count
    expect(await checkLandingTarget('p1', 'job-1')).toMatchObject({ kind: 'ok' })
  })
})

describe('landingDocumentName', () => {
  it('is "CV - <Company>", cut to the name limit, falling back to the job title, with control characters removed', () => {
    expect(landingDocumentName({ company: 'Acme', title: 'x' })).toBe('CV - Acme')
    expect(landingDocumentName({ company: null, title: 'Head of Delivery' })).toBe('CV - Head of Delivery')
    expect(landingDocumentName({ company: '  ', title: 'Head\u0000 of\nDelivery' })).toBe('CV - Head of Delivery')
    expect(landingDocumentName({ company: 'A'.repeat(200), title: 'x' })).toHaveLength(80)
  })
})

describe('landCv', () => {
  it('creates a NEW cv document (named after the company) and a draft in it when the job has no generated CV document', async () => {
    const seen: string[] = []
    const r = await landCv('p1', job, MD, { onTarget: async (id) => { seen.push(id) } })
    expect(r).toEqual({ kind: 'landed', documentId: 'doc-new', created: true })
    expect(mockCreateDoc).toHaveBeenCalledWith('p1', { jobId: 'job-1', name: 'CV - Acme', documentType: 'cv' })
    expect(mockDraft).toHaveBeenCalledWith('p1', { jobId: 'job-1', documentId: 'doc-new' }, MD)
    expect(seen).toEqual(['doc-new'])
  })

  it('REUSES the previously generated CV document: no new document, the draft goes into it', async () => {
    db.cvGeneration.findFirst.mockResolvedValue({ writingDeskDocumentId: 'doc-old' } as never)
    const r = await landCv('p1', job, MD)
    expect(r).toEqual({ kind: 'landed', documentId: 'doc-old', created: false })
    expect(mockCreateDoc).not.toHaveBeenCalled()
    expect(mockDraft).toHaveBeenCalledWith('p1', { jobId: 'job-1', documentId: 'doc-old' }, MD)
  })

  it('writes the markdown exactly as given: {{contact}} stays a placeholder (acceptDraft fills it)', async () => {
    await landCv('p1', job, MD)
    expect(mockDraft.mock.calls[0][2]).toContain('{{contact}}')
  })

  it('reports the 10-document limit without creating a draft', async () => {
    mockCreateDoc.mockResolvedValue({ ok: false, reason: 'limit', message: 'A job can hold up to 10 documents.' })
    expect(await landCv('p1', job, MD)).toEqual({ kind: 'limit' })
    expect(mockDraft).not.toHaveBeenCalled()
  })

  it('reports a draft that appeared since the start check (the race), and has already told the run which document', async () => {
    db.cvGeneration.findFirst.mockResolvedValue({ writingDeskDocumentId: 'doc-old' } as never)
    mockDraft.mockResolvedValue({ ok: false, reason: 'draft_exists', message: 'exists' })
    const seen: string[] = []
    const r = await landCv('p1', job, MD, { onTarget: async (id) => { seen.push(id) } })
    expect(r).toEqual({ kind: 'draft_exists', documentId: 'doc-old' })
    expect(seen).toEqual(['doc-old'])
  })

  it('maps other failures to an error with the document id (a created document is still reported, so a later run reuses it)', async () => {
    mockDraft.mockResolvedValue({ ok: false, reason: 'invalid', message: 'The draft failed validation.' })
    expect(await landCv('p1', job, MD)).toEqual({ kind: 'error', message: 'The draft failed validation.', documentId: 'doc-new' })
    mockCreateDoc.mockResolvedValue({ ok: false, reason: 'job_not_found', message: 'Job not found.' })
    expect(await landCv('p1', job, MD)).toEqual({ kind: 'error', message: 'Job not found.', documentId: null })
  })

  it('never reaches another profile’s job or document: every call carries the caller’s profile id', async () => {
    mockCreateDoc.mockResolvedValue({ ok: false, reason: 'job_not_found', message: 'Job not found.' })
    await landCv('p-other', job, MD)
    expect(mockCreateDoc).toHaveBeenCalledWith('p-other', expect.anything())
    expect(db.cvGeneration.findFirst.mock.calls[0][0]!.where).toMatchObject({ profileId: 'p-other' })
  })
})
