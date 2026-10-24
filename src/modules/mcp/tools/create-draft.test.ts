import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/writing-desk/draft', () => ({ createDraft: vi.fn() }))

import { createDraft } from '@/modules/writing-desk/draft'
import { toolsForScopes } from '../registry'
import { ALL_MCP_TOOLS } from './index'
import { createDraftTool } from './create-draft'

const ctx = { profileId: 'p1', tokenId: 't1' }
beforeEach(() => vi.clearAllMocks())

describe('create_draft tool', () => {
  it('is a write tool, absent for read-only tokens, with agent guidance in its description', () => {
    expect(createDraftTool.scope).toBe('mcp:write')
    expect(toolsForScopes(ALL_MCP_TOOLS, ['mcp:read']).map(t => t.name)).not.toContain('create_draft')
    expect(toolsForScopes(ALL_MCP_TOOLS, ['mcp:write']).map(t => t.name)).toContain('create_draft')
    expect(createDraftTool.description).toMatch(/get_job_context/)
    expect(createDraftTool.description).toMatch(/profile-supported/)
    expect(createDraftTool.description).toMatch(/owner/)
  })

  it('drops unknown keys such as profileId, theme and accept', () => {
    const parsed = createDraftTool.inputSchema.parse({ jobId: 'j', content: 'c', profileId: 'x', theme: 'dark', accept: true })
    expect(parsed).toEqual({ jobId: 'j', content: 'c' })
  })

  it('passes profileId and the token id as actor, returns warnings', async () => {
    vi.mocked(createDraft).mockResolvedValue({
      ok: true,
      value: {
        jobId: 'j1',
        draftRevision: 1,
        sections: [{ id: 'a', hash: 'h', text: '# A' }],
        warnings: [{ kind: 'employer', message: 'Unknown employer', excerpt: 'Acme' }],
        issues: [],
      },
    } as never)
    const result = (await createDraftTool.handler(ctx, { jobId: 'j1', content: '# A' })) as Record<string, unknown>
    expect(createDraft).toHaveBeenCalledWith('p1', 'j1', '# A', { tokenId: 't1' })
    expect(result.ok).toBe(true)
    expect(result.warnings).toHaveLength(1)
  })

  it('on draft_exists says to edit sections or ask the owner to discard', async () => {
    vi.mocked(createDraft).mockResolvedValue({ ok: false, reason: 'draft_exists', message: 'exists' } as never)
    const err = await createDraftTool.handler(ctx, { jobId: 'j1', content: 'c' }).catch((e: unknown) => e) as Error
    expect(err.message).toMatch(/replace_section/)
    expect(err.message).toMatch(/owner to discard/)
  })

  it('on invalid lists each issue with its line', async () => {
    vi.mocked(createDraft).mockResolvedValue({
      ok: false,
      reason: 'invalid',
      message: 'The draft failed validation.',
      issues: [
        { severity: 'error', message: 'Unknown block', line: 4 },
        { severity: 'error', message: 'Unclosed directive', line: 9 },
      ],
    } as never)
    const err = await createDraftTool.handler(ctx, { jobId: 'j1', content: 'c' }).catch((e: unknown) => e) as Error
    expect(err.message).toMatch(/line 4: error: Unknown block/)
    expect(err.message).toMatch(/line 9: error: Unclosed directive/)
  })
})

describe('create_draft input validation', () => {
  it('rejects blank content with an actionable message', () => {
    const r = createDraftTool.inputSchema.safeParse({ jobId: 'j', content: '   ' })
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error?.issues)).toMatch(/content must not be empty/)
    expect(createDraft).not.toHaveBeenCalled()
  })

  it('on invalid with no issues and the generic message says what is likely wrong', async () => {
    vi.mocked(createDraft).mockResolvedValue({
      ok: false,
      reason: 'invalid',
      message: 'The draft failed validation. Fix the listed errors and retry.',
    } as never)
    const err = (await createDraftTool.handler(ctx, { jobId: 'j1', content: 'c' }).catch((e: unknown) => e)) as Error
    expect(err.message).toMatch(/no specific error was reported/)
    expect(err.message).toMatch(/arguments/)
    expect(err.message).not.toMatch(/Fix the listed errors/)
  })
})
