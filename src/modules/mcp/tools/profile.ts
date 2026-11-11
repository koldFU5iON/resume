import { loadVault } from '@/modules/profile-map/load'
import { PROFILE_TOOLS } from '@/modules/profile-map/tools'
import type { McpToolDefinition } from '../registry'

// Read-only mirror of the chat profile tools (profile_map, profile_get_note,
// ...). Same definitions, same scrubbing: contact details never leave.
export const profileTools: McpToolDefinition[] = PROFILE_TOOLS.map(t => ({
  name: t.name,
  scope: 'mcp:read',
  description: t.description,
  inputSchema: t.inputSchema,
  async handler(ctx, args) {
    return t.run(await loadVault(ctx.profileId), args)
  },
}))
