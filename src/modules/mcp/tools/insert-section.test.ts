import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/writing-desk/draft', () => ({ editDraftSection: vi.fn() }))

import { editDraftSection } from '@/modules/writing-desk/draft'
import { toolsForScopes } from '../registry'
import { ALL_MCP_TOOLS } from './index'
import { insertSectionTool } from './insert-section'

const ctx = { profileId: 'p1', tokenId: 't1' }
beforeEach(() => vi.clearAllMocks())

describe('insert_section tool', () => {
  it('is write-only', () => {
    expect(insertSectionTool.scope).toBe('mcp:write')
    expect(toolsForScopes(ALL_MCP_TOOLS, ['mcp:read']).map(t => t.name)).not.toContain('insert_section')
  })

  it('rejects an invalid position', () => {
    expect(insertSectionTool.inputSchema.safeParse({ jobId: 'j', content: 'c', position: 'middle' }).success).toBe(false)
  })

  it('passes an insert op with profileId and the token actor', async () => {
    vi.mocked(editDraftSection).mockResolvedValue({
      ok: true,
      value: { jobId: 'j1', draftRevision: 2, sections: [], issues: [], warnings: [] },
    } as never)
    await insertSectionTool.handler(ctx, { jobId: 'j1', afterSectionId: 'a', content: '## New' })
    expect(editDraftSection).toHaveBeenCalledWith(
      'p1',
      'j1',
      { type: 'insert', afterSectionId: 'a', position: undefined, content: '## New' },
      { tokenId: 't1' },
    )
  })

  it('passes through the invalid_op message for a start insert before a preamble', async () => {
    vi.mocked(editDraftSection).mockResolvedValue({
      ok: false,
      reason: 'invalid',
      message: 'Cannot insert a heading at the start of a document with a preamble; use afterSectionId.',
    } as never)
    const err = await insertSectionTool.handler(ctx, { jobId: 'j1', position: 'start', content: '## New' }).catch((e: unknown) => e) as Error
    expect(err.message).toMatch(/with a preamble; use afterSectionId/)
  })
})

describe('insert_section input validation', () => {
  const msg = (input: object) => {
    const r = insertSectionTool.inputSchema.safeParse(input)
    return r.success ? null : r.error.issues.map(i => i.message).join(' | ')
  }

  it('rejects both afterSectionId and position', () => {
    expect(msg({ jobId: 'j', afterSectionId: 'a', position: 'end', content: 'c' })).toMatch(
      /Provide exactly one of afterSectionId or position \('start' \| 'end'\)/,
    )
  })

  it('rejects neither afterSectionId nor position', () => {
    expect(msg({ jobId: 'j', content: 'c' })).toMatch(/Provide exactly one of afterSectionId or position/)
  })

  it('accepts exactly one', () => {
    expect(msg({ jobId: 'j', position: 'end', content: 'c' })).toBeNull()
    expect(msg({ jobId: 'j', afterSectionId: 'a', content: 'c' })).toBeNull()
  })

  it('rejects blank content with an actionable message', () => {
    expect(msg({ jobId: 'j', position: 'end', content: '  \n ' })).toMatch(
      /content must not be empty; use remove_section to delete a section/,
    )
    expect(editDraftSection).not.toHaveBeenCalled()
  })
})
