/**
 * Guard for read-only scripts: is DATABASE_URL really a local database?
 * Uses pg-connection-string, the parser pg itself uses, so a `?host=` query
 * parameter (which overrides the URL's host) can't slip past a URL-hostname check.
 */

import { parse } from 'pg-connection-string'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** The host pg will connect to for this URL (null when none is set, i.e. the default socket). */
export function effectiveDbHost(databaseUrl: string): string | null {
  return parse(databaseUrl).host ?? null
}

/** True for localhost, 127.0.0.1, ::1 and unix socket paths (a leading `/`). Unparseable URLs are not local. */
export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  try {
    const host = effectiveDbHost(databaseUrl)
    return host !== null && (LOCAL_HOSTS.has(host) || host.startsWith('/'))
  } catch {
    return false
  }
}

/** Session option that makes Postgres reject every write on the connection. */
export const READ_ONLY_PG_OPTIONS = '-c default_transaction_read_only=on'
