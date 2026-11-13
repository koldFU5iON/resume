import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/writing-desk/draft', () => ({ getDraft: vi.fn() }))

import { getDraft } from '@/modules/writing-desk/draft'
import { MAX_TOOL_RESPONSE_CHARS } from '../limits'
import { toolsForScopes } from '../registry'
import { ALL_MCP_TOOLS } from './index'
import { getDraftTool } from './get-draft'

const ctx = { profileId: 'p1', tokenId: 't1' }
const state = (over = {}) => ({
  deskId: 'd',
  jobId: 'j1',
  documentName: 'CV',
  content: '# A',
  draftRevision: 3,
  liveRevision: 1,
  sections: [{ id: 'a', hash: 'h1', text: '# A' }],
  warnings: [{ kind: 'employer', message: 'Unknown employer', excerpt: 'Acme' }],
  issues: [{ severity: 'warning', message: 'Long', line: 2 }],
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('get_draft tool', () => {
  it('is a read tool registered in ALL_MCP_TOOLS and listed for read-only tokens', () => {
    expect(getDraftTool.scope).toBe('mcp:read')
    expect(toolsForScopes(ALL_MCP_TOOLS, ['mcp:read']).map(t => t.name)).toContain('get_draft')
    expect(toolsForScopes(ALL_MCP_TOOLS, ['mcp:write']).map(t => t.name)).not.toContain('get_draft')
  })

  it('strips profileId and requires jobId', () => {
    expect(getDraftTool.inputSchema.safeParse({}).success).toBe(false)
    expect(getDraftTool.inputSchema.parse({ jobId: 'j', profileId: 'x' })).toEqual({ jobId: 'j' })
  })

  it('returns sections, revision, warnings and issues for the token profile', async () => {
    vi.mocked(getDraft).mockResolvedValue({ ok: true, value: state() } as never)
    const result = (await getDraftTool.handler(ctx, { jobId: 'j1' })) as Record<string, unknown>
    expect(getDraft).toHaveBeenCalledWith('p1', { jobId: 'j1' })
    expect(result.draftRevision).toBe(3)
    expect(result.sections).toEqual([{ id: 'a', hash: 'h1', text: '# A' }])
    expect(result.warnings).toHaveLength(1)
    expect(result.issues).toHaveLength(1)
    expect(result).not.toHaveProperty('truncated')
  })

  it('reports no_draft as a tool error', async () => {
    vi.mocked(getDraft).mockResolvedValue({ ok: false, reason: 'no_draft', message: 'This job has no draft.' } as never)
    await expect(getDraftTool.handler(ctx, { jobId: 'j1' })).rejects.toThrow(/no draft/)
  })

  it('keeps a maximum-size draft valid JSON under the response cap and flags truncation', async () => {
    const big = (i: number) => `## S${i}\n${'x "quoted"\n'.repeat(700)}`
    const sections = Array.from({ length: 70 }, (_, i) => ({ id: `s${i}`, hash: `hash${i}`, text: big(i) }))
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `t${i}`, hash: `th${i}`, text: 'y' }))
    const warnings = Array.from({ length: 200 }, () => ({ kind: 'dates', message: 'm'.repeat(2000), excerpt: 'e'.repeat(2000) }))
    const content = 'z'.repeat(500_000)
    vi.mocked(getDraft).mockResolvedValue({
      ok: true,
      value: state({ content, sections: [...sections, ...many], warnings }),
    } as never)
    const result = (await getDraftTool.handler(ctx, { jobId: 'j1' })) as {
      sections: Array<{ hash: string; text: string; truncated?: boolean; fullLength?: number }>
      truncated?: boolean
      notice?: string
    }
    const json = JSON.stringify(result)
    expect(json.length).toBeLessThan(MAX_TOOL_RESPONSE_CHARS)
    expect(JSON.parse(json)).toEqual(result)
    expect(result.truncated).toBe(true)
    expect(result.notice).toMatch(/truncated/)
    const first = result.sections[0]
    expect(first.truncated).toBe(true)
    expect(first.fullLength).toBe(sections[0].text.length)
    expect(first.hash).toBe('hash0')
  })
})
