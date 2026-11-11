import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    company: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    jobApplication: { findFirst: vi.fn(), findMany: vi.fn() },
    $executeRaw: vi.fn(),
  },
}))

import { prisma } from '@/lib/db'
import { findCompany, linkJobCompany, matchOrCreateCompany, sweepJobCompanyLinks } from './match'

const db = vi.mocked(prisma, true)

beforeEach(() => {
  vi.clearAllMocks()
  db.company.findUnique.mockResolvedValue(null)
  db.company.findMany.mockResolvedValue([])
  db.company.upsert.mockResolvedValue({ id: 'new' } as never)
  db.$executeRaw.mockResolvedValue(1 as never)
})

describe('findCompany', () => {
  it('matches a register company by exact name first', async () => {
    db.company.findUnique.mockResolvedValueOnce({ id: 'c1', fromRegister: true } as never)
    await expect(findCompany('ACME Limited')).resolves.toEqual({ kind: 'match', id: 'c1' })
    expect(db.company.findUnique).toHaveBeenCalledWith({ where: { normalizedName: 'acme' }, select: { id: true, fromRegister: true } })
    expect(db.company.findMany).not.toHaveBeenCalled()
  })

  it('then a register alias held by exactly one company', async () => {
    db.company.findMany.mockResolvedValueOnce([{ id: 'c2' }] as never)
    await expect(findCompany('Lilo')).resolves.toEqual({ kind: 'match', id: 'c2' })
    expect(db.company.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { fromRegister: true, aliases: { has: 'lilo' } },
    }))
  })

  it('reports a register alias held by several companies as ambiguous', async () => {
    db.company.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }] as never)
    await expect(findCompany('Subway')).resolves.toEqual({ kind: 'ambiguous' })
  })

  it('never lets a job-created company outrank a register alias', async () => {
    db.company.findUnique.mockResolvedValueOnce({ id: 'shadow', fromRegister: false } as never)
    db.company.findMany.mockResolvedValueOnce([{ id: 'register' }] as never)
    await expect(findCompany('Lilo')).resolves.toEqual({ kind: 'match', id: 'register' })
  })

  it('falls back to a job-created company with the exact name', async () => {
    db.company.findUnique.mockResolvedValueOnce({ id: 'jobco', fromRegister: false } as never)
    await expect(findCompany('Acme Labs')).resolves.toEqual({ kind: 'match', id: 'jobco' })
  })

  it('looks up only the legal name: a trading name typed in a job is ignored', async () => {
    await findCompany('Fake Holdings Ltd T/A Lilo')
    expect(db.company.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { normalizedName: 'fake holdings' } }))
  })
})

describe('matchOrCreateCompany', () => {
  it('creates a company without aliases, not marked as from the register', async () => {
    await expect(matchOrCreateCompany(' Fake Holdings Ltd T/A Lilo ')).resolves.toBe('new')
    expect(db.company.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { normalizedName: 'fake holdings' },
      create: { name: 'Fake Holdings Ltd T/A Lilo', normalizedName: 'fake holdings', aliases: [], fromRegister: false },
      update: {},
    }))
  })

  it('leaves the job unlinked for an ambiguous register alias instead of creating a shadow company', async () => {
    db.company.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }] as never)
    await expect(matchOrCreateCompany('Subway')).resolves.toBeNull()
    expect(db.company.upsert).not.toHaveBeenCalled()
  })

  it('never matches or creates placeholders', async () => {
    for (const p of ['(unknown)', 'Confidential', '', null]) {
      await expect(matchOrCreateCompany(p)).resolves.toBeNull()
    }
    expect(db.company.findUnique).not.toHaveBeenCalled()
    expect(db.company.upsert).not.toHaveBeenCalled()
  })
})

describe('linkJobCompany', () => {
  it('links the job only if its company is unchanged since it was read', async () => {
    db.jobApplication.findFirst.mockResolvedValueOnce({ company: 'Acme Ltd', companyId: null } as never)
    db.company.findUnique.mockResolvedValueOnce({ id: 'c1', fromRegister: true } as never)
    await expect(linkJobCompany('p1', 'j1')).resolves.toBe(true)
    const [sql, ...values] = db.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]]
    expect(sql.join('?')).toContain('"company" IS NOT DISTINCT FROM')
    expect(values).toEqual(['c1', 'j1', 'p1', 'Acme Ltd'])
  })

  it('does nothing when already linked to the same company', async () => {
    db.jobApplication.findFirst.mockResolvedValueOnce({ company: 'Acme', companyId: 'c1' } as never)
    db.company.findUnique.mockResolvedValueOnce({ id: 'c1', fromRegister: true } as never)
    await expect(linkJobCompany('p1', 'j1')).resolves.toBe(true)
    expect(db.$executeRaw).not.toHaveBeenCalled()
  })

  it('unlinks a job whose company became a placeholder', async () => {
    db.jobApplication.findFirst.mockResolvedValueOnce({ company: '(unknown)', companyId: 'c1' } as never)
    await expect(linkJobCompany('p1', 'j1')).resolves.toBe(false)
    expect((db.$executeRaw.mock.calls[0] as unknown[])[1]).toBeNull()
  })

  it('never throws', async () => {
    db.jobApplication.findFirst.mockRejectedValueOnce(new Error('db down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(linkJobCompany('p1', 'j1')).resolves.toBe(false)
    spy.mockRestore()
  })
})

describe('sweepJobCompanyLinks', () => {
  it('walks unlinked jobs by id, skipping placeholders', async () => {
    db.jobApplication.findMany
      .mockResolvedValueOnce([
        { id: 'a', profileId: 'p1', company: '(unknown)' },
        { id: 'b', profileId: 'p1', company: 'Acme' },
      ] as never)
      .mockResolvedValueOnce([])
    db.jobApplication.findFirst.mockResolvedValueOnce({ company: 'Acme', companyId: null } as never)
    db.company.findUnique.mockResolvedValueOnce({ id: 'c1', fromRegister: true } as never)
    await expect(sweepJobCompanyLinks({ deadline: Date.now() + 10_000 })).resolves.toEqual({ checked: 2, linked: 1 })
    const firstQuery = db.jobApplication.findMany.mock.calls[0][0]
    expect(firstQuery).toMatchObject({ where: { OR: [{ companyId: null }, { companyRef: { fromRegister: false } }] } })
    expect(db.jobApplication.findMany.mock.calls[1][0]).toMatchObject({ where: { id: { gt: 'b' } } })
  })

  it('stops at the deadline', async () => {
    await expect(sweepJobCompanyLinks({ deadline: Date.now() - 1 })).resolves.toEqual({ checked: 0, linked: 0 })
    expect(db.jobApplication.findMany).not.toHaveBeenCalled()
  })
})
