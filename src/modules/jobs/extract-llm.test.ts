import { describe, it, expect, vi } from 'vitest'

vi.mock('@/modules/llm/client', () => ({ completeStructured: vi.fn() }))

import { stripHtmlToText, ExtractedJobLLMSchema, extractReadableContent, extractWithLLM } from './extract-llm'

describe('stripHtmlToText', () => {
  it('removes script and style tags and their content', () => {
    const html = '<p>Job title</p><script>alert("xss")</script><style>.btn{}</style>'
    const result = stripHtmlToText(html)
    expect(result).toContain('Job title')
    expect(result).not.toContain('alert')
    expect(result).not.toContain('.btn')
  })

  it('removes nav, header, footer, aside elements', () => {
    const html = '<nav>Menu</nav><main><p>Description</p></main><footer>© 2024</footer>'
    const result = stripHtmlToText(html)
    expect(result).toContain('Description')
    expect(result).not.toContain('Menu')
    expect(result).not.toContain('© 2024')
  })

  it('strips remaining HTML tags', () => {
    const html = '<h1 class="title">Senior Engineer</h1><p>Build things.</p>'
    expect(stripHtmlToText(html)).toContain('Senior Engineer')
    expect(stripHtmlToText(html)).not.toContain('<h1')
  })

  it('truncates to 12000 characters', () => {
    const html = '<p>' + 'a'.repeat(20_000) + '</p>'
    expect(stripHtmlToText(html).length).toBeLessThanOrEqual(12_000)
  })

  it('decodes common HTML entities', () => {
    const html = '<p>Salary: $120k &amp; benefits</p>'
    expect(stripHtmlToText(html)).toContain('$120k & benefits')
  })
})

describe('ExtractedJobLLMSchema', () => {
  it('accepts a fully populated object', () => {
    const result = ExtractedJobLLMSchema.safeParse({
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Remote',
      jobDescription: 'Build things.',
      jobNumber: 'REQ-123',
      salaryBand: '$120k–$160k',
      datePublished: '2024-01-15',
    })
    expect(result.success).toBe(true)
  })

  it('accepts an empty object (all fields optional)', () => {
    expect(ExtractedJobLLMSchema.safeParse({}).success).toBe(true)
  })
})

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

describe('extractWithLLM', () => {
  it('returns the add-a-key message without a profile and makes no call', async () => {
    const { completeStructured } = await import('@/modules/llm/client')
    const res = await extractWithLLM('<p>job</p>', null)
    expect(res).toEqual({ ok: false, error: expect.stringContaining('Add an LLM key') })
    expect(completeStructured).not.toHaveBeenCalled()
  })

  it('uses the job-extract defaults for existing callers', async () => {
    const { completeStructured } = await import('@/modules/llm/client')
    vi.mocked(completeStructured).mockResolvedValueOnce({ object: { title: 'PM' } } as never)
    const res = await extractWithLLM('<p>job</p>', 'p1')
    expect(res).toMatchObject({ ok: true, data: { title: 'PM' } })
    const opts = vi.mocked(completeStructured).mock.calls.at(-1)![3]
    expect(opts).toEqual({ maxOutputTokens: 400, temperature: 0, feature: 'job-extract', role: 'fast' })
  })

  it('forwards the timeout and redaction, and reports a timeout', async () => {
    const { completeStructured } = await import('@/modules/llm/client')
    const { LLMError } = await import('@/modules/llm/errors')
    vi.mocked(completeStructured).mockRejectedValueOnce(new LLMError('timed out', 'timeout'))
    const res = await extractWithLLM('<p>job</p>', 'p1', { timeoutMs: 30_000, redactInvalidOutput: true })
    expect(res).toMatchObject({ ok: false, timedOut: true })
    const opts = vi.mocked(completeStructured).mock.calls.at(-1)![3]
    expect(opts).toMatchObject({ timeoutMs: 30_000, redactInvalidOutput: true })
  })

  it('forwards feature and output cap overrides, always on the fast role', async () => {
    const { completeStructured } = await import('@/modules/llm/client')
    vi.mocked(completeStructured).mockResolvedValueOnce({ object: { title: 'PM' } } as never)
    await extractWithLLM('<p>job</p>', 'p1', { feature: 'job-assessment-enrich', maxOutputTokens: 4000 })
    const opts = vi.mocked(completeStructured).mock.calls.at(-1)![3]
    expect(opts).toEqual({ maxOutputTokens: 4000, temperature: 0, feature: 'job-assessment-enrich', role: 'fast' })
  })
})
