import { describe, expect, it } from 'vitest'
import { effectiveDbHost, isLocalDatabaseUrl } from './local-db-guard'

describe('isLocalDatabaseUrl', () => {
  it('accepts local hosts', () => {
    expect(isLocalDatabaseUrl('postgresql://u:p@localhost:5435/db')).toBe(true)
    expect(isLocalDatabaseUrl('postgresql://u:p@127.0.0.1:5432/db')).toBe(true)
    expect(isLocalDatabaseUrl('postgresql://u:p@[::1]:5432/db')).toBe(true)
    expect(isLocalDatabaseUrl('postgresql://u:p@%2Fvar%2Frun%2Fpostgresql/db')).toBe(true)
  })
  it('rejects remote hosts', () => {
    expect(isLocalDatabaseUrl('postgresql://u:p@db.example.com:5432/db')).toBe(false)
    expect(isLocalDatabaseUrl('postgresql://u:p@10.0.0.5/db')).toBe(false)
  })
  it('rejects a ?host= override that points elsewhere', () => {
    const url = 'postgresql://u:p@localhost:5435/db?host=remote.example'
    expect(effectiveDbHost(url)).toBe('remote.example')
    expect(isLocalDatabaseUrl(url)).toBe(false)
  })
  it('accepts a ?host= override that is local', () => {
    expect(isLocalDatabaseUrl('postgresql://u:p@remote.example/db?host=localhost')).toBe(true)
  })
  it('rejects a URL with no host and garbage', () => {
    expect(isLocalDatabaseUrl('postgresql:///db')).toBe(false)
    expect(isLocalDatabaseUrl('not a url')).toBe(false)
    expect(isLocalDatabaseUrl('')).toBe(false)
  })
})
