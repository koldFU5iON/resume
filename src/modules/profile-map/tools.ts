// The internal profile tools, defined once and exposed twice: as AI SDK tools
// in chat (chat/tools.ts) and as read-only MCP tools (mcp/tools/profile.ts).
// Each takes an already-loaded vault, so the caller owns authorisation: the
// profileId always comes from the session or the verified token, never from
// tool arguments. Contact details are always scrubbed.

import * as z from 'zod'
import { getBacklinks, getGaps, getMap, getNote, listNotes, searchVault } from './query'
import type { NoteType, Vault } from './types'

const NOTE_TYPES = [
  'identity', 'preferences', 'experience', 'project', 'evidence',
  'capability', 'education', 'certification', 'language',
] as const satisfies readonly NoteType[]

const noteId = z.string().min(1).max(100).describe('A note id from profile_map, profile_list or profile_search.')

export type ProfileTool<S extends z.ZodObject = z.ZodObject> = {
  name: string
  description: string
  inputSchema: S
  run(vault: Vault, args: z.infer<S>): unknown
}

function define<S extends z.ZodObject>(t: ProfileTool<S>): ProfileTool {
  return t as unknown as ProfileTool
}

const NOT_FOUND = { error: 'No note has that id. Call profile_map to see the ids.' }

export const PROFILE_TOOLS: ProfileTool[] = [
  define({
    name: 'profile_map',
    description:
      "Read this first. The user's whole career profile as a compact index: one line per note (id · title — gist), " +
      'with achievements and projects nested under their role, plus completeness (0-100) and gaps phrased as questions. ' +
      'Open any note with profile_get_note.',
    inputSchema: z.object({}),
    run: (vault) => getMap(vault),
  }),
  define({
    name: 'profile_get_note',
    description:
      'One profile note in full, self-contained (an achievement names its role, company and dates), with typed links ' +
      'and backlinks you can follow by id. Experience notes include their full write-up and evidence.',
    inputSchema: z.object({ id: noteId }),
    run: (vault, { id }) => getNote(vault, id) ?? NOT_FOUND,
  }),
  define({
    name: 'profile_list',
    description:
      'List every note of one type, e.g. all certifications, all achievements, or capabilities of kind "tool". ' +
      'Capability status: proven (backed by evidence), certified, or claimed (listed only).',
    inputSchema: z.object({
      type: z.enum(NOTE_TYPES),
      kind: z.enum(['skill', 'tool', 'competency']).optional().describe('Capabilities only.'),
      status: z.enum(['proven', 'certified', 'claimed']).optional().describe('Capabilities only.'),
      evidenceKind: z.enum(['achievement', 'responsibility']).optional().describe('Evidence only.'),
    }),
    run: (vault, filter) => listNotes(vault, filter),
  }),
  define({
    name: 'profile_backlinks',
    description:
      'What points at a note: the evidence behind a capability, the role an achievement belongs to, the ' +
      'certification that covers a skill.',
    inputSchema: z.object({ id: noteId }),
    run: (vault, { id }) => getBacklinks(vault, id) ?? NOT_FOUND,
  }),
  define({
    name: 'profile_search',
    description:
      'Keyword search across the profile: titles, write-ups, achievements, projects and capabilities. ' +
      'Returns note ids with a snippet; open them with profile_get_note.',
    inputSchema: z.object({
      query: z.string().min(1).max(200),
      types: z.array(z.enum(NOTE_TYPES)).max(NOTE_TYPES.length).optional().describe('Only search these note types.'),
    }),
    run: (vault, { query, types }) => searchVault(vault, query, { types }),
  }),
  define({
    name: 'profile_gaps',
    description:
      'What is missing or weak in the profile, phrased as questions to ask the user, plus a completeness score. ' +
      'Use when helping the user strengthen their profile.',
    inputSchema: z.object({}),
    run: (vault) => getGaps(vault),
  }),
]
