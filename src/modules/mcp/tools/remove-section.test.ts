import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/writing-desk/draft', () => ({ editDraftSection: vi.fn() }))

import { editDraftSection } from '@/modules/writing-desk/draft'
import { toolsForScopes } from '../registry'
import { ALL_MCP_TOOLS } from './index'
import { removeSectionTool } from './remove-section'

const ctx = { profileId: 'p1', tokenId: 't1' }
beforeEach(() => vi.clearAllMocks())

describe('remove_section tool', () => {
  it('is write-only', () => {
    expect(removeSectionTool.scope).toBe('mcp:write')
    expect(toolsForScopes(ALL_MCP_TOOLS, ['mcp:read']).map(t => t.name)).not.toContain('remove_section')
  })

  it('passes a remove op with profileId and the token actor', async () => {
    vi.mocked(editDraftSection).mockResolvedValue({
      ok: true,
      value: { jobId: 'j1', draftRevision: 2, sections: [], issues: [], warnings: [] },
    } as never)
    await removeSectionTool.handler(ctx, { jobId: 'j1', sectionId: 's', expectedHash: 'h' })
    expect(editDraftSection).toHaveBeenCalledWith('p1', 'j1', { type: 'remove', sectionId: 's', expectedHash: 'h' }, { tokenId: 't1' })
  })

  it('on hash_mismatch surfaces the current text', async () => {
    vi.mocked(editDraftSection).mockResolvedValue({
      ok: false,
      reason: 'hash_mismatch',
      message: 'changed',
      current: { id: 's', hash: 'h2', text: 'current text here' },
    } as never)
    const err = await removeSectionTool.handler(ctx, { jobId: 'j1', sectionId: 's', expectedHash: 'h' }).catch((e: unknown) => e) as Error
    expect(err.message).toMatch(/current text here/)
  })
})
