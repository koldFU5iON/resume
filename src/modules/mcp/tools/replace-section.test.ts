import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/writing-desk/draft', () => ({ editDraftSection: vi.fn() }))

import { editDraftSection } from '@/modules/writing-desk/draft'
import { toolsForScopes } from '../registry'
import { ALL_MCP_TOOLS } from './index'
import { replaceSectionTool } from './replace-section'

const ctx = { profileId: 'p1', tokenId: 't1' }
const okState = {
  ok: true,
  value: { jobId: 'j1', draftRevision: 2, sections: [], issues: [], warnings: [{ kind: 'dates', message: 'Dates differ', excerpt: '2019' }] },
}
beforeEach(() => vi.clearAllMocks())

describe('replace_section tool', () => {
  it('is write-only and refused to read-only tokens', () => {
    expect(replaceSectionTool.scope).toBe('mcp:write')
    expect(toolsForScopes(ALL_MCP_TOOLS, ['mcp:read']).map(t => t.name)).not.toContain('replace_section')
    expect(replaceSectionTool.description).toMatch(/get_draft/)
    expect(replaceSectionTool.description).toMatch(/get_job_context/)
  })

  it('passes a replace op with profileId and the token actor, returns warnings', async () => {
    vi.mocked(editDraftSection).mockResolvedValue(okState as never)
    const args = replaceSectionTool.inputSchema.parse({ jobId: 'j1', sectionId: 's', expectedHash: 'h', content: 'new', profileId: 'evil' })
    const result = (await replaceSectionTool.handler(ctx, args)) as Record<string, unknown>
    expect(editDraftSection).toHaveBeenCalledWith(
      'p1',
      'j1',
      { type: 'replace', sectionId: 's', expectedHash: 'h', content: 'new' },
      { tokenId: 't1' },
    )
    expect(result.warnings).toHaveLength(1)
  })

  it('on hash_mismatch includes the current section text and says to re-read', async () => {
    vi.mocked(editDraftSection).mockResolvedValue({
      ok: false,
      reason: 'hash_mismatch',
      message: 'That section changed.',
      current: { id: 's', hash: 'h2', text: '## Summary\nOwner edited this' },
    } as never)
    const err = await replaceSectionTool.handler(ctx, { jobId: 'j1', sectionId: 's', expectedHash: 'h', content: 'x' }).catch((e: unknown) => e) as Error
    expect(err.message).toMatch(/Owner edited this/)
    expect(err.message).toMatch(/h2/)
    expect(err.message).toMatch(/get_draft/)
  })

  it('on section_not_found lists the current section ids', async () => {
    vi.mocked(editDraftSection).mockResolvedValue({
      ok: false,
      reason: 'section_not_found',
      message: 'No section has that id.',
      sections: [{ id: 'summary', hash: 'a', text: '' }, { id: 'skills', hash: 'b', text: '' }],
    } as never)
    const err = await replaceSectionTool.handler(ctx, { jobId: 'j1', sectionId: 'zzz', expectedHash: 'h', content: 'x' }).catch((e: unknown) => e) as Error
    expect(err.message).toMatch(/summary, skills/)
    expect(err.message).toMatch(/get_draft/)
  })
})
