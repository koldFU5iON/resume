import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn() } }))
import { prisma } from '@/lib/db'
import { enforceMcpRegistrationLimit } from './registration-limit'

beforeEach(() => vi.clearAllMocks())

it.each([undefined, new Headers(), new Headers({ 'x-forwarded-for': 'invalid' })])('refuses registration without a valid proxy IP', async headers => {
  await expect(enforceMcpRegistrationLimit(headers)).rejects.toMatchObject({ status: 'BAD_REQUEST' })
  expect(prisma.$queryRaw).not.toHaveBeenCalled()
})
it('normalizes the proxy IP before atomically counting registration', async () => {
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: 5 }])
  await enforceMcpRegistrationLimit(new Headers({ 'x-forwarded-for': '2001:db8::1, 192.0.2.1' }))
  expect(vi.mocked(prisma.$queryRaw).mock.calls[0][2]).toBe('2001:0db8:0000:0000:0000:0000:0000:0000|mcp-registration')
})
it('rejects the sixth attempt with a retry delay', async () => {
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ count: 6 }])
  await expect(enforceMcpRegistrationLimit(new Headers({ 'x-forwarded-for': '192.0.2.1' })))
    .rejects.toMatchObject({ status: 'TOO_MANY_REQUESTS', headers: { 'Retry-After': '60' } })
})
it('fails closed when the limiter database is unavailable', async () => {
  vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('Database unavailable'))
  await expect(enforceMcpRegistrationLimit(new Headers({ 'x-forwarded-for': '192.0.2.1' }))).rejects.toThrow('Database unavailable')
})
