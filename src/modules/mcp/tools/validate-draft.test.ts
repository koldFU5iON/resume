import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/writing-desk/draft', () => ({ getDraft: vi.fn() }))

import { getDraft } from '@/modules/writing-desk/draft'
import { toolsForScopes } from '../registry'
import { ALL_MCP_TOOLS } from './index'
import { validateDraftTool } from './validate-draft'

const ctx = { profileId: 'p1', tokenId: 't1' }
beforeEach(() => vi.clearAllMocks())

describe('validate_draft tool', () => {
  it('is a read tool listed for read-only tokens', () => {
    expect(validateDraftTool.scope).toBe('mcp:read')
    expect(toolsForScopes(ALL_MCP_TOOLS, ['mcp:read']).map(t => t.name)).toContain('validate_draft')
  })

  it('returns { ok, issues, warnings } without writing', async () => {
    vi.mocked(getDraft).mockResolvedValue({
      ok: true,
      value: {
        jobId: 'j1',
        deskId: 'd1',
        documentName: 'CV',
        content: '',
        draftRevision: 1,
        sections: [],
        issues: [],
        warnings: [{ kind: 'employer', message: 'Unknown employer', excerpt: 'Acme' }],
      },
    } as never)
    const result = (await validateDraftTool.handler(ctx, { jobId: 'j1' })) as Record<string, unknown>
    expect(getDraft).toHaveBeenCalledWith('p1', { jobId: 'j1' })
    expect(Object.keys(result).sort()).toEqual(['issues', 'ok', 'warnings'])
    expect(result.warnings).toHaveLength(1)
    expect(typeof result.ok).toBe('boolean')
  })

  it('propagates a missing draft as a tool error', async () => {
    vi.mocked(getDraft).mockResolvedValue({ ok: false, reason: 'no_draft', message: 'No draft.' } as never)
    await expect(validateDraftTool.handler(ctx, { jobId: 'j1' })).rejects.toThrow(/No draft/)
  })
})
