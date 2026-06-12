# Extraction Engine Upgrade + Batch Job Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the short-circuit cascade in `extractJobFromUrl` with a completeness-aware merge, upgrade the LLM text input with `@mozilla/readability`, wire up Puppeteer for SPA fallback, and add a batch job capture dialog with real-time SSE progress.

**Architecture:** A new `extract-fetch.ts` owns all page fetching (raw HTTP → SPA detection → Puppeteer). `extract-utils.ts` gains `scoreCompleteness` and `mergeExtractedJob`. `extract.ts` is rewritten to cascade all tiers and merge results rather than short-circuiting on any partial hit. Batch capture is a new SSE route + dialog component built on top of the existing `captureJobFromUrl` orchestrator.

**Tech Stack:** `@mozilla/readability`, `linkedom`, `puppeteer-core` + `@sparticuz/chromium-min` (already installed), Server-Sent Events via Next.js Route Handler, Vitest.

---

## File map

| File | Action |
|------|--------|
| `src/modules/jobs/extract-fetch.ts` | Create — SSRF guard, raw fetch, SPA detection, Puppeteer |
| `src/modules/jobs/extract-fetch.test.ts` | Create — `looksLikeSpa` unit tests |
| `src/modules/jobs/extract-utils.ts` | Modify — add `scoreCompleteness`, `mergeExtractedJob`, `COMPLETE_THRESHOLD` |
| `src/modules/jobs/extract-utils.test.ts` | Modify — add tests for the above |
| `src/modules/jobs/extract-llm.ts` | Modify — add `extractReadableContent` using Readability, replace `stripHtmlToText` call in `extractWithLLM` |
| `src/modules/jobs/extract-llm.test.ts` | Modify — add `extractReadableContent` tests |
| `src/modules/jobs/extract.ts` | Rewrite — cascade + merge, import from `extract-fetch` and `extract-utils` |
| `src/modules/jobs/batch-capture.ts` | Create — `cleanJobUrl`, `parseUrlsFromText` |
| `src/modules/jobs/batch-capture.test.ts` | Create — URL parsing unit tests |
| `src/app/api/jobs/batch-capture/route.ts` | Create — SSE streaming endpoint |
| `src/app/dashboard/job-applications/_components/batch-capture-dialog.tsx` | Create — 3-step dialog UI |
| `src/app/dashboard/job-applications/_components/job-list.tsx` | Modify — add Batch Add button |
| `.env.example` | Modify — add `CHROMIUM_EXECUTABLE_PATH`, `CHROMIUM_PACK_URL` |

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json` (via npm)
- Modify: `.env.example`

- [ ] **Step 1: Install Readability and linkedom**

```bash
npm install @mozilla/readability linkedom
```

Expected output: packages added to `node_modules`, `package-lock.json` updated.

- [ ] **Step 2: Add Chromium env vars to .env.example**

In `.env.example`, add after the existing `ENCRYPTION_KEY` line:

```env
# Chromium for SPA rendering (Puppeteer). In development, puppeteer devDep provides the binary automatically.
# In production (Vercel), leave both blank to download from Sparticuz CDN, or set CHROMIUM_EXECUTABLE_PATH
# to a pre-cached binary path.
CHROMIUM_EXECUTABLE_PATH=
CHROMIUM_PACK_URL=
```

- [ ] **Step 3: Verify TypeScript resolves the new packages**

```bash
npm run typecheck
```

Expected: exits 0 with no errors (the new packages ship their own types).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add @mozilla/readability and linkedom for extraction upgrade"
```

---

## Task 2: Create `extract-fetch.ts` — SSRF guard + raw fetch + SPA detection + Puppeteer

**Files:**
- Create: `src/modules/jobs/extract-fetch.ts`
- Create: `src/modules/jobs/extract-fetch.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/jobs/extract-fetch.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { looksLikeSpa } from './extract-fetch'

describe('looksLikeSpa', () => {
  it('returns true for a React SPA shell with empty body', () => {
    const html = `
      <html>
        <head><script>/* bundled JS */</script><style>body{margin:0}</style></head>
        <body><div id="root"></div></body>
      </html>
    `
    expect(looksLikeSpa(html)).toBe(true)
  })

  it('returns true when only nav/footer content is present', () => {
    const html = `
      <html><body>
        <nav>Home About Jobs Contact</nav>
        <div id="app"></div>
        <footer>© 2024 Company Inc</footer>
      </body></html>
    `
    expect(looksLikeSpa(html)).toBe(true)
  })

  it('returns false for a content-rich job posting page', () => {
    const html = `
      <html><body><main>
        <h1>Senior Software Engineer at Acme</h1>
        <p>We are looking for a talented senior software engineer to join our growing team.
           You will work on challenging distributed systems problems and collaborate with
           passionate engineers committed to building excellent products users rely on daily.</p>
        <h2>Requirements</h2>
        <ul>
          <li>5+ years of software engineering experience with strong TypeScript skills</li>
          <li>Experience building and scaling distributed systems in production environments</li>
          <li>Strong understanding of data structures, algorithms, and system design principles</li>
        </ul>
      </main></body></html>
    `
    expect(looksLikeSpa(html)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/modules/jobs/extract-fetch.test.ts
```

Expected: FAIL — `extract-fetch.ts` does not exist yet.

- [ ] **Step 3: Create `extract-fetch.ts`**

Create `src/modules/jobs/extract-fetch.ts`:

```ts
import { lookup as dnsLookup } from 'dns/promises'
import chromium from '@sparticuz/chromium-min'
import puppeteer from 'puppeteer-core'

export type FetchResult =
  | { ok: true; html: string; via: 'raw' | 'puppeteer' }
  | { ok: false; error: string }

// ── SSRF guard ────────────────────────────────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const h = ip.toLowerCase()
    return (
      h === '::1' || h === '::' ||
      h.startsWith('fc') || h.startsWith('fd') ||
      h.startsWith('fe80') ||
      h.startsWith('::ffff:127.') ||
      h.startsWith('::ffff:10.') ||
      h.startsWith('::ffff:192.168.') ||
      /^::ffff:172\.(1[6-9]|2[0-9]|3[01])\./.test(h)
    )
  }
  return (
    ip === '0.0.0.0' ||
    /^127\./.test(ip) ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip)
  )
}

function isSafeHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  const bare = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h
  if (bare.includes(':')) return !isPrivateIp(bare)
  return !(
    h === 'localhost' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h === 'metadata.google.internal' ||
    isPrivateIp(h)
  )
}

export async function isSafeUrl(raw: string): Promise<boolean> {
  let parsed: URL
  try { parsed = new URL(raw) } catch { return false }
  if (parsed.protocol !== 'https:') return false
  if (!isSafeHostname(parsed.hostname)) return false
  try {
    const addrs = await dnsLookup(parsed.hostname, { all: true })
    return !addrs.some(a => isPrivateIp(a.address))
  } catch {
    return false
  }
}

// ── SPA detection ─────────────────────────────────────────────────────────────

const NOISE_TAGS_RE = /<(script|style|noscript|nav|header|footer|aside|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi
const ALL_TAGS_RE = /<[^>]+>/g

export function looksLikeSpa(html: string): boolean {
  const text = html
    .replace(NOISE_TAGS_RE, '')
    .replace(ALL_TAGS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length < 500
}

// ── Puppeteer ─────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

async function getChromiumPath(): Promise<string> {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    return process.env.CHROMIUM_EXECUTABLE_PATH
  }
  if (process.env.NODE_ENV === 'development') {
    const { executablePath } = await import('puppeteer')
    return executablePath()
  }
  return chromium.executablePath(
    process.env.CHROMIUM_PACK_URL ??
    'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar'
  )
}

async function renderWithPuppeteer(url: string): Promise<string> {
  const executablePath = await getChromiumPath()
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  })
  try {
    const page = await browser.newPage()
    await page.setUserAgent(UA)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20_000 })
    return await page.content()
  } finally {
    await browser.close()
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

const FETCH_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
}

export async function fetchPageContent(url: string): Promise<FetchResult> {
  let html: string
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(12_000),
    })
    try {
      if (!isSafeHostname(new URL(res.url).hostname)) {
        return { ok: false, error: 'Invalid URL — only public HTTPS job pages are supported.' }
      }
    } catch { /* unparseable final URL — proceed */ }
    if (!res.ok) {
      return {
        ok: false,
        error: `Could not reach that page — it may block automated access (${res.status}). Try pasting the details manually.`,
      }
    }
    html = await res.text()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error'
    return { ok: false, error: `Could not reach that URL: ${msg}` }
  }

  if (!looksLikeSpa(html)) {
    return { ok: true, html, via: 'raw' }
  }

  try {
    const rendered = await renderWithPuppeteer(url)
    return { ok: true, html: rendered, via: 'puppeteer' }
  } catch {
    return { ok: true, html, via: 'raw' }
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/modules/jobs/extract-fetch.test.ts
```

Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/jobs/extract-fetch.ts src/modules/jobs/extract-fetch.test.ts
git commit -m "feat: add extract-fetch — SSRF guard, SPA detection, Puppeteer fallback"
```

---

## Task 3: Add `scoreCompleteness`, `mergeExtractedJob`, `COMPLETE_THRESHOLD` to `extract-utils.ts`

> Note: these are sync utilities and cannot live in `extract.ts` — that file has `'use server'` which requires all exports to be async Server Actions.

**Files:**
- Modify: `src/modules/jobs/extract-utils.ts`
- Modify: `src/modules/jobs/extract-utils.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/jobs/extract-utils.test.ts`:

```ts
import { scoreCompleteness, mergeExtractedJob } from './extract-utils'

describe('scoreCompleteness', () => {
  it('returns 0 for an empty object', () => {
    expect(scoreCompleteness({})).toBe(0)
  })

  it('returns 0.25 for title only', () => {
    expect(scoreCompleteness({ title: 'Engineer' })).toBe(0.25)
  })

  it('returns 0.50 for title + company', () => {
    expect(scoreCompleteness({ title: 'Engineer', company: 'Acme' })).toBe(0.50)
  })

  it('returns 0.90 for title + company + description', () => {
    expect(scoreCompleteness({ title: 'Engineer', company: 'Acme', jobDescription: 'Build things.' })).toBe(0.90)
  })

  it('returns 1.0 for all key fields present', () => {
    expect(scoreCompleteness({
      title: 'Engineer', company: 'Acme', jobDescription: 'Build things.', location: 'Remote',
    })).toBe(1.0)
  })

  it('awards the extra 0.10 for salaryBand when title/company/description missing', () => {
    expect(scoreCompleteness({ salaryBand: '$100k' })).toBe(0.10)
  })
})

describe('mergeExtractedJob', () => {
  it('base values are never overwritten by overlay', () => {
    const result = mergeExtractedJob(
      { title: 'Senior Engineer', company: 'Acme' },
      { title: 'Junior Engineer', company: 'Other', location: 'Remote' },
    )
    expect(result.title).toBe('Senior Engineer')
    expect(result.company).toBe('Acme')
    expect(result.location).toBe('Remote')
  })

  it('overlay fills undefined fields from base', () => {
    const result = mergeExtractedJob(
      { title: 'Engineer' },
      { company: 'Acme', jobDescription: 'Build things.' },
    )
    expect(result.company).toBe('Acme')
    expect(result.jobDescription).toBe('Build things.')
  })

  it('undefined overlay fields do not clobber defined base fields', () => {
    const result = mergeExtractedJob(
      { title: 'Engineer', company: 'Acme' },
      { title: undefined },
    )
    expect(result.title).toBe('Engineer')
  })

  it('merging two empty objects returns an empty object', () => {
    expect(mergeExtractedJob({}, {})).toEqual({
      title: undefined, company: undefined, location: undefined,
      jobDescription: undefined, jobNumber: undefined, datePublished: undefined, salaryBand: undefined,
    })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/modules/jobs/extract-utils.test.ts
```

Expected: FAIL — `scoreCompleteness` and `mergeExtractedJob` are not exported from `extract-utils`.

- [ ] **Step 3: Add the implementations to `extract-utils.ts`**

Append to the end of `src/modules/jobs/extract-utils.ts`:

```ts
export const COMPLETE_THRESHOLD = 0.65

export function scoreCompleteness(data: ExtractedJob): number {
  let score = 0
  if (data.title)          score += 0.25
  if (data.company)        score += 0.25
  if (data.jobDescription) score += 0.40
  if (data.location || data.salaryBand || data.datePublished || data.jobNumber) score += 0.10
  return score
}

export function mergeExtractedJob(base: ExtractedJob, overlay: ExtractedJob): ExtractedJob {
  return {
    title:          base.title          ?? overlay.title,
    company:        base.company        ?? overlay.company,
    location:       base.location       ?? overlay.location,
    jobDescription: base.jobDescription ?? overlay.jobDescription,
    jobNumber:      base.jobNumber      ?? overlay.jobNumber,
    datePublished:  base.datePublished  ?? overlay.datePublished,
    salaryBand:     base.salaryBand     ?? overlay.salaryBand,
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/modules/jobs/extract-utils.test.ts
```

Expected: PASS — all existing tests plus new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/jobs/extract-utils.ts src/modules/jobs/extract-utils.test.ts
git commit -m "feat: add scoreCompleteness, mergeExtractedJob, COMPLETE_THRESHOLD to extract-utils"
```

---

## Task 4: Upgrade `extract-llm.ts` with `@mozilla/readability`

**Files:**
- Modify: `src/modules/jobs/extract-llm.ts`
- Modify: `src/modules/jobs/extract-llm.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/jobs/extract-llm.test.ts`:

```ts
import { extractReadableContent } from './extract-llm'

describe('extractReadableContent', () => {
  it('returns text containing the main content', () => {
    const body = 'We are looking for a talented senior software engineer to join our growing team. ' +
      'You will work on challenging distributed systems problems and collaborate with passionate ' +
      'engineers committed to building excellent products that users love and rely on every day. ' +
      'Strong TypeScript and React skills are essential for success in this role.'
    const html = `
      <html><head><title>Engineer at Acme</title></head>
      <body>
        <nav>Home About Jobs Contact Blog Careers Press</nav>
        <main>
          <h1>Senior Software Engineer</h1>
          <p>${body}</p>
          <h2>Requirements</h2>
          <ul><li>5+ years TypeScript</li><li>React experience</li></ul>
        </main>
        <footer>© 2024 Acme Inc. All rights reserved. Privacy Policy Terms of Service.</footer>
      </body></html>
    `
    const result = extractReadableContent(html)
    expect(result).toContain('Senior Software Engineer')
    expect(result.length).toBeGreaterThan(50)
  })

  it('falls back gracefully when Readability cannot parse the page', () => {
    const html = '<html><body><div id="root"></div></body></html>'
    const result = extractReadableContent(html)
    expect(typeof result).toBe('string')
    expect(result.length).toBeLessThanOrEqual(12_000)
  })

  it('truncates output to 12000 characters', () => {
    const html = `<html><body><main><p>${'word '.repeat(5_000)}</p></main></body></html>`
    expect(extractReadableContent(html).length).toBeLessThanOrEqual(12_000)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/modules/jobs/extract-llm.test.ts
```

Expected: FAIL — `extractReadableContent` is not exported.

- [ ] **Step 3: Update `extract-llm.ts`**

Replace the entire contents of `src/modules/jobs/extract-llm.ts` with:

```ts
import * as z from 'zod'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { requireProfile } from '@/lib/session'
import { completeStructured } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import type { ExtractedJob, ExtractionResult } from './extract-utils'

export const ExtractedJobLLMSchema = z.object({
  title:          z.string().optional().describe('Job title exactly as written'),
  company:        z.string().optional().describe('Hiring company name'),
  location:       z.string().optional().describe('Office location or "Remote"'),
  jobDescription: z.string().optional().describe('Full job description text, preserve all detail'),
  jobNumber:      z.string().optional().describe('Job ID or requisition number visible on the page'),
  salaryBand:     z.string().optional().describe('Salary range as a short string, e.g. "$120k–$160k"'),
  datePublished:  z.string().optional().describe('ISO date string if a posting date is visible on the page'),
})

const NOISE_TAGS_RE = /<(script|style|noscript|nav|header|footer|aside|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi
const ALL_TAGS_RE = /<[^>]+>/g
const MAX_CHARS = 12_000

export function stripHtmlToText(html: string): string {
  return html
    .replace(NOISE_TAGS_RE, '')
    .replace(ALL_TAGS_RE, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS)
}

export function extractReadableContent(html: string): string {
  try {
    const { document } = parseHTML(html)
    const reader = new Readability(document as unknown as Document)
    const article = reader.parse()
    if (article?.textContent) {
      return article.textContent.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS)
    }
  } catch { /* fall through to regex stripper */ }
  return stripHtmlToText(html)
}

export async function extractWithLLM(html: string): Promise<ExtractionResult> {
  let profileId: string
  try {
    const { profile } = await requireProfile()
    profileId = profile.id
  } catch {
    return {
      ok: false,
      error: 'No job details found. Add an LLM key in Settings to enable AI extraction, or paste manually.',
    }
  }

  const text = extractReadableContent(html)
  const prompt = `Extract the job posting details from the following webpage text. Return only what is explicitly present — do not infer or invent values.\n\n${text}`

  try {
    const result = await completeStructured(profileId, prompt, ExtractedJobLLMSchema, {
      maxOutputTokens: 400,
      temperature: 0,
      feature: 'job-extract',
    })
    const raw = result.object
    const parsedDate = raw.datePublished ? new Date(raw.datePublished) : undefined
    const data: ExtractedJob = {
      title: raw.title,
      company: raw.company,
      location: raw.location,
      jobDescription: raw.jobDescription,
      jobNumber: raw.jobNumber,
      salaryBand: raw.salaryBand,
      datePublished: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : undefined,
    }
    if (!data.title && !data.company && !data.jobDescription) {
      return { ok: false, error: 'Could not extract details — try pasting manually.' }
    }
    return { ok: true, data }
  } catch (err) {
    if (err instanceof LLMError && err.kind === 'not_configured') {
      return {
        ok: false,
        error: 'No job details found. Add an LLM key in Settings to enable AI extraction, or paste manually.',
      }
    }
    return { ok: false, error: 'Could not extract details — try pasting manually.' }
  }
}
```

- [ ] **Step 4: Run tests to confirm all pass (including the existing `stripHtmlToText` tests)**

```bash
npx vitest run src/modules/jobs/extract-llm.test.ts
```

Expected: PASS — all 5 existing `stripHtmlToText` tests plus the 3 new `extractReadableContent` tests and 2 `ExtractedJobLLMSchema` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/jobs/extract-llm.ts src/modules/jobs/extract-llm.test.ts
git commit -m "feat: add extractReadableContent using @mozilla/readability for better LLM input quality"
```

---

## Task 5: Rewrite cascade in `extract.ts`

**Files:**
- Rewrite: `src/modules/jobs/extract.ts`

This task removes the SSRF guard (now in `extract-fetch.ts`), imports `scoreCompleteness`/`mergeExtractedJob`/`COMPLETE_THRESHOLD` from `extract-utils`, and rewrites the extraction cascade to merge across tiers rather than short-circuiting on any partial result.

- [ ] **Step 1: Replace `extract.ts` entirely**

Replace the entire contents of `src/modules/jobs/extract.ts` with:

```ts
'use server'

import type { ExtractionResult, ExtractedJob } from './extract-utils'
import { decode, td, formatSalaryBand, scoreCompleteness, mergeExtractedJob, COMPLETE_THRESHOLD } from './extract-utils'
import {
  linkedInJobId, extractLinkedIn,
  greenhouseFromUrl, greenhouseFromHtml, extractGreenhouse,
  matchSiteOverride,
  leverFromUrl, extractLever,
  ashbyFromUrl, extractAshby,
  workdayFromUrl, extractWorkday,
} from './extract-ats'
import { extractWithLLM } from './extract-llm'
import { isSafeUrl, fetchPageContent } from './extract-fetch'

// ── ATS tier ──────────────────────────────────────────────────────────────────
// Returns null if no ATS pattern matched. Returns ExtractionResult if a pattern
// matched (ok:true for success, ok:false if the ATS API failed — e.g. 404).
// Workday returning null from extractWorkday means "API unavailable" — treated
// as no match so the HTML tiers can still run.

async function tryAtsTier(url: string): Promise<ExtractionResult | null> {
  const linkedInId = linkedInJobId(url)
  if (linkedInId) return extractLinkedIn(linkedInId)

  const siteOverride = matchSiteOverride(url)
  if (siteOverride) return extractGreenhouse(siteOverride.board, siteOverride.jobId)

  const directGh = greenhouseFromUrl(url)
  if (directGh) return extractGreenhouse(directGh.board, directGh.jobId)

  const lever = leverFromUrl(url)
  if (lever) return extractLever(lever.company, lever.jobId)

  const ashby = ashbyFromUrl(url)
  if (ashby) return extractAshby(ashby.company, ashby.jobSlug)

  const workday = workdayFromUrl(url)
  if (workday) {
    const r = await extractWorkday(workday.subdomain, workday.tenant, workday.group, workday.jobId)
    if (r !== null) return r
    // null = API unavailable — fall through to HTML tiers
  }

  return null
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function extractJobFromUrl(url: string): Promise<ExtractionResult> {
  if (!(await isSafeUrl(url))) {
    return { ok: false, error: 'Invalid URL — only public HTTPS job pages are supported.' }
  }

  let accumulated: ExtractedJob = {}

  // ── Tier 1: ATS structured APIs ─────────────────────────────────────────
  const atsResult = await tryAtsTier(url)
  if (atsResult !== null) {
    if (!atsResult.ok) return atsResult                                      // ATS API failed — hard fail
    if (scoreCompleteness(atsResult.data) >= COMPLETE_THRESHOLD) return atsResult  // complete — fast path
    accumulated = atsResult.data                                             // partial — cascade continues
  }

  // ── Tier 2: HTML fetch + structural parse ────────────────────────────────
  const fetchResult = await fetchPageContent(url)
  if (!fetchResult.ok) {
    if (accumulated.title || accumulated.company || accumulated.jobDescription) {
      return { ok: true, data: accumulated }  // partial ATS data beats a fetch failure
    }
    return { ok: false, error: fetchResult.error }
  }
  const { html } = fetchResult

  const embeddedGh = greenhouseFromHtml(url, html)
  if (embeddedGh) {
    const ghResult = await extractGreenhouse(embeddedGh.board, embeddedGh.jobId)
    if (ghResult.ok) accumulated = mergeExtractedJob(accumulated, ghResult.data)
  }

  const jsonLd = fromJsonLd(html)
  if (jsonLd) accumulated = mergeExtractedJob(accumulated, jsonLd)

  accumulated = mergeExtractedJob(accumulated, fromMetaTags(html))

  if (scoreCompleteness(accumulated) >= COMPLETE_THRESHOLD) {
    return { ok: true, data: accumulated }
  }

  // ── Tier 3: LLM extraction ───────────────────────────────────────────────
  const llmResult = await extractWithLLM(html)
  if (llmResult.ok) {
    accumulated = mergeExtractedJob(accumulated, llmResult.data)
  }

  if (accumulated.title || accumulated.company || accumulated.jobDescription) {
    return { ok: true, data: accumulated }
  }

  return llmResult.ok
    ? { ok: false, error: 'Could not extract details — try pasting manually.' }
    : llmResult
}

// ── JSON-LD JobPosting ────────────────────────────────────────────────────────

function fromJsonLd(html: string): ExtractedJob | null {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]

  for (const block of blocks) {
    try {
      const raw = JSON.parse(block[1])
      const candidates: unknown[] = Array.isArray(raw?.['@graph']) ? raw['@graph'] : [raw]
      const job = candidates.find(
        (c): c is Record<string, unknown> =>
          typeof c === 'object' && c !== null && (c as Record<string, unknown>)['@type'] === 'JobPosting',
      )
      if (!job) continue

      const addr = (job.jobLocation as Record<string, unknown> | undefined)?.address as Record<string, unknown> | undefined
      const city = addr?.addressLocality as string | undefined
      const country = addr?.addressCountry as string | undefined
      const isRemote = job.jobLocationType === 'TELECOMMUTE'
      const locationParts = isRemote
        ? ['Remote', city, country].filter(Boolean)
        : [city, country].filter(Boolean)

      const descHtml = (job.description as string | undefined) ?? ''
      const jobDescription = descHtml ? td.turndown(descHtml) : undefined

      const rawDate = job.datePosted as string | undefined
      const parsed = rawDate ? new Date(rawDate) : undefined
      const datePublished = parsed && !isNaN(parsed.getTime()) ? parsed : undefined

      const org = job.hiringOrganization as Record<string, unknown> | undefined
      const identifier = job.identifier as Record<string, unknown> | undefined

      return {
        title:       decode((job.title as string | undefined)?.trim()),
        company:     decode((org?.name as string | undefined)?.trim()),
        location:    decode(locationParts.length > 0 ? (locationParts as string[]).join(', ') : undefined),
        jobDescription,
        jobNumber:   identifier?.value != null ? String(identifier.value) : undefined,
        datePublished,
        salaryBand:  formatSalaryBand(job.baseSalary),
      }
    } catch {
      // malformed block — try the next one
    }
  }
  return null
}

// ── OpenGraph / meta fallback ─────────────────────────────────────────────────

function fromMetaTags(html: string): ExtractedJob {
  const og = (prop: string) => {
    const a = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
    const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'))
    return decode((a?.[1] ?? b?.[1])?.trim())
  }

  const title =
    og('og:title') ??
    decode(html.match(/<h1[^>]*>([^<]{3,120})<\/h1>/i)?.[1]?.trim()) ??
    decode(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.replace(/\s*[\|\-–]\s*.+$/, '').trim())

  return {
    title:          title ?? undefined,
    jobDescription: og('og:description') ?? undefined,
  }
}
```

- [ ] **Step 2: Run the full test suite to confirm nothing is broken**

```bash
npx vitest run
```

Expected: all existing tests pass. The `quick-capture.test.ts` mocks `extractJobFromUrl` so it's unaffected by the cascade rewrite. No tests should regress.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/jobs/extract.ts
git commit -m "feat: rewrite extraction cascade — completeness-aware merge, Puppeteer SPA fallback"
```

---

## Task 6: Create `batch-capture.ts` — URL parsing utilities

**Files:**
- Create: `src/modules/jobs/batch-capture.ts`
- Create: `src/modules/jobs/batch-capture.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/jobs/batch-capture.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cleanJobUrl, parseUrlsFromText } from './batch-capture'

describe('cleanJobUrl', () => {
  it('strips utm_* tracking params', () => {
    expect(cleanJobUrl('https://example.com/job?utm_source=gh&utm_campaign=spring'))
      .toBe('https://example.com/job')
  })

  it('strips fbclid and gclid', () => {
    expect(cleanJobUrl('https://example.com/job?fbclid=abc123&gclid=xyz'))
      .toBe('https://example.com/job')
  })

  it('preserves gh_jid ATS param', () => {
    expect(cleanJobUrl('https://acme.com/careers?gh_jid=12345&utm_source=web'))
      .toBe('https://acme.com/careers?gh_jid=12345')
  })

  it('preserves lever-origin ATS param', () => {
    expect(cleanJobUrl('https://jobs.lever.co/acme/abc?lever-origin=applied&utm_medium=email'))
      .toBe('https://jobs.lever.co/acme/abc?lever-origin=applied')
  })

  it('returns the raw string unchanged for invalid URLs', () => {
    expect(cleanJobUrl('not-a-url')).toBe('not-a-url')
  })

  it('preserves non-tracking query params', () => {
    expect(cleanJobUrl('https://example.com/job?id=123&tab=overview'))
      .toBe('https://example.com/job?id=123&tab=overview')
  })
})

describe('parseUrlsFromText', () => {
  it('extracts newline-delimited URLs', () => {
    const text = 'https://jobs.lever.co/acme/abc\nhttps://boards.greenhouse.io/acme/jobs/123'
    expect(parseUrlsFromText(text)).toHaveLength(2)
  })

  it('extracts comma-delimited URLs', () => {
    const text = 'https://jobs.lever.co/acme/abc, https://boards.greenhouse.io/acme/jobs/123'
    expect(parseUrlsFromText(text)).toHaveLength(2)
  })

  it('extracts URLs embedded in surrounding text', () => {
    const text = 'Check this out: https://example.com/jobs/123. Looks good!'
    const result = parseUrlsFromText(text)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('https://example.com/jobs/123')
  })

  it('strips utm params from extracted URLs', () => {
    const result = parseUrlsFromText('https://jobs.lever.co/acme/abc?utm_source=linkedin')
    expect(result[0]).toBe('https://jobs.lever.co/acme/abc')
  })

  it('deduplicates identical cleaned URLs', () => {
    const text = 'https://example.com/jobs/1\nhttps://example.com/jobs/1?utm_source=a'
    expect(parseUrlsFromText(text)).toHaveLength(1)
  })

  it('caps results at 50 URLs', () => {
    const text = Array.from({ length: 60 }, (_, i) => `https://example.com/jobs/${i}`).join('\n')
    expect(parseUrlsFromText(text)).toHaveLength(50)
  })

  it('returns empty array for text with no URLs', () => {
    expect(parseUrlsFromText('No links here at all')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/modules/jobs/batch-capture.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `batch-capture.ts`**

Create `src/modules/jobs/batch-capture.ts`:

```ts
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'mc_cid', 'mc_eid', 'hsCtaTracking', '_hsenc', '_hsmi', 'mkt_tok',
])

const ATS_PARAMS = new Set(['gh_jid', 'lever-origin'])

export function cleanJobUrl(raw: string): string {
  let parsed: URL
  try { parsed = new URL(raw) } catch { return raw }

  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key) && !ATS_PARAMS.has(key)) {
      parsed.searchParams.delete(key)
    }
  }
  return parsed.toString()
}

export function parseUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s,\n"'<>]+/gi) ?? []
  const seen = new Set<string>()
  const result: string[] = []

  for (const raw of matches) {
    const cleaned = cleanJobUrl(raw.replace(/[.,;:)]+$/, ''))
    if (!seen.has(cleaned)) {
      seen.add(cleaned)
      result.push(cleaned)
    }
  }

  return result.slice(0, 50)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/modules/jobs/batch-capture.test.ts
```

Expected: PASS — all 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/jobs/batch-capture.ts src/modules/jobs/batch-capture.test.ts
git commit -m "feat: add batch-capture URL parsing utilities"
```

---

## Task 7: Create SSE route `/api/jobs/batch-capture`

**Files:**
- Create: `src/app/api/jobs/batch-capture/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/jobs/batch-capture/route.ts`:

```ts
import { type NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/session'
import { captureJobFromUrl } from '@/modules/jobs/capture'

const CONCURRENCY = 3

function makeSemaphore(limit: number) {
  let active = 0
  const queue: Array<() => void> = []
  return function throttle<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        active++
        try { resolve(await fn()) } catch (e) { reject(e) } finally {
          active--
          queue.shift()?.()
        }
      }
      if (active < limit) run()
      else queue.push(run)
    })
  }
}

export async function POST(req: NextRequest) {
  let profileId: string
  try {
    const { profile } = await requireProfile()
    profileId = profile.id
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const rawUrls: unknown = body?.urls
  if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
    return NextResponse.json({ error: 'urls array required' }, { status: 400 })
  }

  const urls = rawUrls
    .filter((u): u is string => typeof u === 'string')
    .slice(0, 50)

  const encoder = new TextEncoder()
  const throttle = makeSemaphore(CONCURRENCY)

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      let added = 0, existing = 0, failed = 0

      await Promise.all(
        urls.map((url, index) =>
          throttle(async () => {
            emit({ index, url, status: 'processing' })
            try {
              const result = await captureJobFromUrl(profileId, { url, dedupeStrategy: 'return_existing' })
              if (result.ok) {
                if (result.created) added++; else existing++
                emit({ index, url, status: 'success', job: result.job, created: result.created })
              } else {
                failed++
                emit({ index, url, status: 'failed', error: result.error })
              }
            } catch (e) {
              failed++
              emit({ index, url, status: 'failed', error: e instanceof Error ? e.message : 'Unexpected error' })
            }
          })
        )
      )

      emit({ type: 'done', added, existing, failed })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/jobs/batch-capture/route.ts
git commit -m "feat: add /api/jobs/batch-capture SSE endpoint for real-time batch import"
```

---

## Task 8: Create `batch-capture-dialog.tsx`

**Files:**
- Create: `src/app/dashboard/job-applications/_components/batch-capture-dialog.tsx`

- [ ] **Step 1: Create the dialog component**

Create `src/app/dashboard/job-applications/_components/batch-capture-dialog.tsx`:

```tsx
'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { parseUrlsFromText } from '@/modules/jobs/batch-capture'

type UrlStatus =
  | { status: 'pending' }
  | { status: 'processing' }
  | { status: 'success'; job: { id: string; title: string; company: string }; created: boolean }
  | { status: 'failed'; error: string }

type Step = 'input' | 'processing' | 'done'

type DoneSummary = { added: number; existing: number; failed: number }

export function BatchCaptureDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('input')
  const [text, setText] = useState('')
  const [urls, setUrls] = useState<string[]>([])
  const [statuses, setStatuses] = useState<Map<number, UrlStatus>>(new Map())
  const [summary, setSummary] = useState<DoneSummary | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const parsedCount = parseUrlsFromText(text).length
  const atCap = parsedCount >= 50

  function handleStart() {
    const parsed = parseUrlsFromText(text)
    if (parsed.length === 0) return
    setUrls(parsed)
    setStatuses(new Map(parsed.map((_, i) => [i, { status: 'pending' } as UrlStatus])))
    setStep('processing')
    runBatch(parsed)
  }

  async function runBatch(urlList: string[]) {
    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch('/api/jobs/batch-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urlList }),
        signal: abort.signal,
      })

      if (!res.ok || !res.body) {
        setSummary({ added: 0, existing: 0, failed: urlList.length })
        setStep('done')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) {
          const line = chunk.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'done') {
              setSummary({ added: event.added, existing: event.existing, failed: event.failed })
              setStep('done')
              router.refresh()
            } else if (typeof event.index === 'number') {
              setStatuses(prev => {
                const next = new Map(prev)
                if (event.status === 'success') {
                  next.set(event.index, { status: 'success', job: event.job, created: event.created })
                } else if (event.status === 'failed') {
                  next.set(event.index, { status: 'failed', error: event.error })
                } else {
                  next.set(event.index, { status: 'processing' })
                }
                return next
              })
            }
          } catch { /* malformed SSE chunk — skip */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setSummary({ added: 0, existing: 0, failed: urlList.length })
        setStep('done')
      }
    }
  }

  function handleClose() {
    if (step === 'processing') return
    abortRef.current?.abort()
    setStep('input')
    setText('')
    setUrls([])
    setStatuses(new Map())
    setSummary(null)
    onOpenChange(false)
  }

  const processedCount = [...statuses.values()].filter(
    s => s.status !== 'pending' && s.status !== 'processing',
  ).length

  const failedUrls = urls.filter((_, i) => statuses.get(i)?.status === 'failed')

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Batch Add Jobs</DialogTitle>
        </DialogHeader>

        {step === 'input' && (
          <div className="space-y-4">
            <Textarea
              placeholder="Paste job URLs, one per line or comma-separated"
              value={text}
              onChange={e => setText(e.target.value)}
              rows={8}
              className="font-mono text-xs resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {parsedCount === 0
                  ? 'No URLs detected'
                  : atCap
                    ? '50 URLs detected (maximum)'
                    : `${parsedCount} URL${parsedCount === 1 ? '' : 's'} detected`}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={parsedCount === 0} onClick={handleStart}>
                  Start Import
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="space-y-3">
            <Progress value={urls.length > 0 ? (processedCount / urls.length) * 100 : 0} />
            <p className="text-xs text-muted-foreground text-right">
              {processedCount} / {urls.length} processed
            </p>
            <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
              {urls.map((url, i) => {
                const s = statuses.get(i) ?? { status: 'pending' as const }
                return (
                  <div key={i} className="flex items-start gap-2 py-0.5 text-xs">
                    <StatusIcon status={s.status} />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-mono text-muted-foreground">{url}</p>
                      {s.status === 'success' && (
                        <p className="text-foreground">{s.job.title} — {s.job.company}</p>
                      )}
                      {s.status === 'failed' && (
                        <p className="text-destructive">{s.error}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {step === 'done' && summary && (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="font-medium">{summary.added} added</span>
              {summary.existing > 0 && (
                <span className="text-muted-foreground"> · {summary.existing} already existed</span>
              )}
              {summary.failed > 0 && (
                <span className="text-destructive"> · {summary.failed} failed</span>
              )}
            </p>
            {failedUrls.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Failed URLs</p>
                <Textarea
                  readOnly
                  value={failedUrls.join('\n')}
                  rows={Math.min(failedUrls.length + 1, 5)}
                  className="font-mono text-xs resize-none"
                />
              </div>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={handleClose}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StatusIcon({ status }: { status: UrlStatus['status'] }) {
  switch (status) {
    case 'pending':    return <Circle size={14} className="mt-0.5 shrink-0 text-muted-foreground/40" />
    case 'processing': return <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-muted-foreground" />
    case 'success':    return <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-green-500" />
    case 'failed':     return <XCircle size={14} className="mt-0.5 shrink-0 text-destructive" />
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/job-applications/_components/batch-capture-dialog.tsx
git commit -m "feat: add BatchCaptureDialog — 3-step SSE-driven batch import UI"
```

---

## Task 9: Wire batch button into `job-list.tsx`

**Files:**
- Modify: `src/app/dashboard/job-applications/_components/job-list.tsx`

- [ ] **Step 1: Add the import, state, and dialog to `JobList`**

At the top of `job-list.tsx`, add the import:

```ts
import { ListPlus } from "lucide-react"
import { BatchCaptureDialog } from "./batch-capture-dialog"
```

Inside the `JobList` function, add state after the existing `creating` state:

```ts
const [batching, setBatching] = useState(false)
```

Pass `onBatchOpen` to `ToolBar` — update the existing `<ToolBar ... />` call to add:

```tsx
onBatchOpen={() => setBatching(true)}
```

Add the dialog just before the closing `</div>` of `JobList` (after `<CreateJobSheet ...>`):

```tsx
<BatchCaptureDialog open={batching} onOpenChange={setBatching} />
```

- [ ] **Step 2: Update `ToolBarProps` to include `onBatchOpen`**

In the `ToolBarProps` type, add:

```ts
onBatchOpen: () => void
```

- [ ] **Step 3: Add the button to `ToolBar`**

In the `ToolBar` function, add `onBatchOpen` to the destructured props, then add the button immediately before the existing "Add Job" button:

```tsx
<Button variant="outline" size="sm" className="gap-1.5" onClick={onBatchOpen}>
  <ListPlus size={16} />
  Batch Add
</Button>
```

- [ ] **Step 4: Typecheck and confirm full test suite passes**

```bash
npm run typecheck && npx vitest run
```

Expected: typecheck exits 0, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/job-applications/_components/job-list.tsx
git commit -m "feat: add Batch Add button to job list toolbar"
```

---

## Task 10: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test single-URL extraction improvements**

Navigate to `/dashboard/job-applications`, open "Add Job" (⌘J), paste a job URL from a known-SPA site (e.g. a Workday or company career page). Verify fields populate more completely than before.

- [ ] **Step 3: Test batch import**

Click "Batch Add", paste 3–5 job URLs (mix of LinkedIn, Greenhouse, and a plain URL). Confirm:
- URL counter shows correct count in step 1
- Step 2 shows per-URL spinners resolving to green checks / red X in real time
- Step 3 shows the correct "added · existed · failed" summary
- Failed URLs appear in the copyable textarea
- After clicking Done, the new jobs appear in the job list

- [ ] **Step 4: Test non-dismissible processing step**

During processing, click the dialog backdrop or close button. Confirm the dialog does not close.

- [ ] **Step 5: Final commit if any tweaks were needed**

```bash
git add -p
git commit -m "fix: smoke test corrections for batch capture dialog"
```
