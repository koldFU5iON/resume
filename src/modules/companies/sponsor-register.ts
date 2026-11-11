// The Home Office "Register of licensed sponsors: workers" (gov.uk): finding
// the current CSV and parsing it. Pure apart from the two fetch helpers. The import
// itself (database writes) is in ./import.ts.

export const REGISTER_PAGE_URL =
  'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers'

/** Columns of the register CSV, as published (checked 2026-11-11). */
export const REGISTER_COLUMNS = ['Organisation Name', 'Town/City', 'County', 'Type & Rating', 'Route'] as const

/** A real register has ~140k rows; far fewer means a broken download or a changed format. */
export const MIN_REGISTER_ROWS = 50_000

/** Refuse anything bigger (the Nov 2026 file is ~11 MB). */
export const MAX_REGISTER_BYTES = 60 * 1024 * 1024

export const SKILLED_WORKER_ROUTE = 'Skilled Worker'

export type RegisterRow = {
  orgName: string
  /** '' when blank. */
  townCity: string
  county: string | null
  typeRating: string
  route: string
}

export class RegisterFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RegisterFormatError'
  }
}

/** Trims and collapses inner whitespace ("Charity Worker " → "Charity Worker"). */
function clean(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

/** The worker register CSV link on the gov.uk publication page, or null. The URL changes with each publication. */
export function findRegisterCsvUrl(html: string): string | null {
  const links = html.match(/https:\/\/assets\.publishing\.service\.gov\.uk\/[^"'\s<>]+\.csv/g) ?? []
  return links.find((l) => /worker/i.test(l)) ?? links[0] ?? null
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }
  return rows
}

/** Unique key of a licence row within one register. */
export function registerRowKey(r: Pick<RegisterRow, 'orgName' | 'townCity' | 'route'>): string {
  return `${r.orgName}\u0000${r.townCity}\u0000${r.route}`
}

/**
 * Register rows from the CSV text: trimmed, rows without a name or route
 * dropped, exact duplicates removed. Throws RegisterFormatError when the
 * header doesn't match REGISTER_COLUMNS or there are fewer than `minRows`.
 */
export function parseRegisterCsv(text: string, minRows: number = MIN_REGISTER_ROWS): RegisterRow[] {
  const [header, ...body] = parseCsv(text)
  const columns = (header ?? []).map(clean)
  const index = REGISTER_COLUMNS.map((name) => columns.indexOf(name))
  if (index.some((i) => i < 0)) {
    throw new RegisterFormatError(`Unexpected register columns: ${JSON.stringify(columns)}`)
  }
  const [iName, iTown, iCounty, iType, iRoute] = index

  const seen = new Set<string>()
  const rows: RegisterRow[] = []
  for (const cells of body) {
    const row: RegisterRow = {
      orgName: clean(cells[iName]),
      townCity: clean(cells[iTown]),
      county: clean(cells[iCounty]) || null,
      typeRating: clean(cells[iType]),
      route: clean(cells[iRoute]),
    }
    if (!row.orgName || !row.route) continue
    const key = registerRowKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(row)
  }
  if (rows.length < minRows) {
    throw new RegisterFormatError(`Register has ${rows.length} rows, expected at least ${minRows}.`)
  }
  return rows
}

/** 'A', 'B', or the raw type & rating when it isn't a plain A/B rating (e.g. provisional). */
export function licenceRating(typeRating: string): string {
  const m = typeRating.match(/\(([AB])(?: rating|\b)/)
  return m ? m[1] : typeRating
}

type Fetch = typeof fetch

/** The register CSV text. Throws on a failed or oversized download. */
export async function fetchRegisterText(sourceUrl: string, fetchImpl: Fetch = fetch): Promise<string> {
  const res = await fetchImpl(sourceUrl, { signal: AbortSignal.timeout(90_000) })
  if (!res.ok) throw new Error(`Register CSV returned ${res.status}`)
  const length = Number(res.headers.get('content-length') ?? 0)
  if (length > MAX_REGISTER_BYTES) throw new RegisterFormatError(`Register CSV is ${length} bytes, over the limit.`)
  const text = await res.text()
  if (text.length > MAX_REGISTER_BYTES) throw new RegisterFormatError('Register CSV is over the size limit.')
  return text
}

/** The register CSV link only (no download), for "has it changed?" checks. */
export async function fetchRegisterCsvUrl(fetchImpl: Fetch = fetch): Promise<string> {
  const page = await fetchImpl(REGISTER_PAGE_URL, { signal: AbortSignal.timeout(30_000) })
  if (!page.ok) throw new Error(`Register page returned ${page.status}`)
  const sourceUrl = findRegisterCsvUrl(await page.text())
  if (!sourceUrl) throw new RegisterFormatError('No register CSV link on the gov.uk page.')
  return sourceUrl
}

