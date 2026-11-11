import { describe, it, expect } from 'vitest'
import { isAuthorizedCronRequest } from './cron-auth'

const req = (auth?: string) => new Request('https://x.test/api/internal/x', { headers: auth ? { authorization: auth } : {} })

describe('isAuthorizedCronRequest', () => {
  it('accepts the CRON_SECRET bearer token', () => {
    expect(isAuthorizedCronRequest(req('Bearer s3cret'), 's3cret')).toBe(true)
  })

  it('rejects a wrong or missing token', () => {
    expect(isAuthorizedCronRequest(req('Bearer nope'), 's3cret')).toBe(false)
    expect(isAuthorizedCronRequest(req(), 's3cret')).toBe(false)
  })

  it('rejects everything when no secret is configured', () => {
    expect(isAuthorizedCronRequest(req('Bearer '), '')).toBe(false)
    expect(isAuthorizedCronRequest(req('Bearer undefined'), undefined)).toBe(false)
  })
})
