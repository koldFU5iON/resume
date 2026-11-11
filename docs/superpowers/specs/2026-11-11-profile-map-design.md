# Profile Map: the profile as a linked vault of atomic notes

**Date:** 2026-11-11 · **Status:** Approved; steps 1–2 shipped, step 3 in progress
**Builds on:** `2026-11-11-profile-review-and-profile-map.md` (review, decisions, phasing)

## 1. The idea

Treat the candidate profile like an Obsidian vault:

- **Every item is a note.** It has a stable id, a type, a title, typed properties (the "frontmatter") and an optional markdown body.
- **Notes are self-contained.** Any single note, rendered alone, carries enough context to be understood. An achievement says which role, company and dates it belongs to, so an AI can use it without loading the rest of the profile.
- **Notes link to each other.** Links are typed, and backlinks are computed. A capability's backlinks are the evidence for it.
- **The Profile Map is the vault's index.** It is a cheap manifest of every note (id, type, title, one-line gist, link counts) that an AI reads first to decide what to open.

This is what the current design was reaching for. Experience already has frontmatter (company, role, dates) plus a markdown body with `## Overview` / `## Achievements` headings, and the four skill junction tables were meant to be the links. The pattern was applied only halfway, which is why it feels messy.

## 2. Two families of notes: records vs narratives

Some things are inherently structured; others are inherently stories. The model should treat them differently instead of forcing one shape on both.

| | **Record notes** ("static") | **Narrative notes** ("ambiguous") |
|---|---|---|
| Types | Education, Certification, Language, Capability (skill / tool / domain / competency) | Experience, Project (later: Story / Accomplishment) |
| Shape | All meaning lives in fixed, validated properties | Small fixed frontmatter + free markdown body, which is the source of truth |
| Body | None, or a short optional note | Expected; variance is the point |
| Validation | Strict: enums, dates, required fields (e.g. CEFR level, skill level, issuer) | Frontmatter strict; body free (headings are *conventions*, never required) |
| Editing UI | Compact forms and lists | Note editor (today's experience workspace) |
| AI use | Filter and match ("has PMP?", "Python ≥ 3y?") | Read and reason ("how did they lead the migration?") |

Between them sit **evidence atoms**: the responsibilities and achievements (`RoleActivity`). They are small, self-contained claims extracted from a narrative body. Each belongs to exactly one narrative (an experience or a project) and links to the capabilities it demonstrates. They are the most valuable unit for job matching, because they are what proves a capability.

```
            Identity (hub note)                  Preferences (searchProfile)
                   │
   ┌───────────────┼──────────────────────┐
Experience ──contains──► Project           Education / Certification / Language
   │ body (md)            │ body (md)            │ certifies / studied
   │                      │                      ▼
   └─has──► Evidence ◄─has┘             Capability (skill | tool | domain | competency)
             (achievement /  ──demonstrates──►    ▲ backlinks = evidence count,
              responsibility)                      │ derived years, "proven" vs "claimed"
```

## 3. Rules that tighten it up

1. **One body per narrative.** Experience keeps `summary` as its body. Project collapses `description` + `notes` into one body; `description` becomes a derived one-line gist.
2. **Evidence comes from the body; edits stay explicit.** Extraction proposes evidence atoms from the body, and the user accepts them (today's flow). Each atom keeps a pointer back to the narrative it came from. Re-extraction diffs against the existing atoms instead of duplicating them. A body edit never silently deletes accepted evidence.
3. **Links are explicit and typed.** Link types: `contains` (experience→project), `demonstrates` (evidence→capability), `uses` (project→capability), `certifies` (certification→capability). They are stored in the existing junction tables; the four tables already cover all of these.
4. **Optional `[[wikilinks]]` in bodies.** Writing `[[Kubernetes]]` in an experience or project body links to (or proposes) that capability. It is the Obsidian-native way to create links while writing. The existing `## Skills` heading parse keeps working as the other way in.
5. **Capability status is derived from links, not typed by hand.**
   - **Proven:** at least one `demonstrates` or `uses` backlink.
   - **Certified:** has a certification link.
   - **Claimed:** listed with no evidence.
   - This replaces arbitrary self-rated meaning, while keeping the self-rated level as one input.
6. **Provenance on every note:** `manual | import | extracted | chat`, plus `updatedAt`. AI-added notes can then be shown as "suggested, confirm?".
7. **Records are strict at the boundary.** Every write goes through a Zod schema per note type (the pattern started in PR #337).

## 4. Storage: hybrid (recommended)

**Keep typed tables as storage, and make the vault a read/write layer on top.** We are not moving to a generic `Note` table with JSON frontmatter.

- Records need typed, queryable columns (dates, enums, years); a JSON blob loses that and Prisma typing.
- Narratives already have a markdown body column, so nothing is lost.
- Links already have tables.
- The vault shape (id, type, title, props, body, links, provenance) is produced by the loader, so consumers never see table differences.

Schema changes this implies, all in the later reshape phase and none needed to start:

- **Capabilities merge:** add `Skill.kind`; migrate `Tool` and `Competency` rows into it.
- **Project body:** merge `notes` into the body; `description` becomes a derived gist.
- **Provenance:** a `source` column on note tables.
- **Evidence ownership:** `RoleActivity` gains an optional `projectId`, so projects can own evidence too.
- **Cleanup:** drop the dead `tags` string columns.

## 5. The Profile Map module (`src/modules/profile-map/`)

```ts
// One loader, cached per request (React cache()), scoped by profileId.
loadVault(profileId): Promise<Vault>

type Note = {
  id: string
  type: 'identity' | 'experience' | 'project' | 'evidence' | 'capability'
      | 'education' | 'certification' | 'language' | 'preferences'
  title: string                 // "Snr Program Manager — Unity"
  gist: string                  // one line, for the map
  props: Record<string, unknown> // typed per note type (discriminated union in code)
  body?: string                 // narratives only
  links: { type: LinkType; to: string }[]
  backlinks: { type: LinkType; from: string }[]   // computed
  source: 'manual' | 'import' | 'extracted' | 'chat'
  updatedAt: Date
  pii?: true                    // identity contact fields
}

profileMap(vault)          // the index: notes without bodies + counts + completeness gaps
getNote(vault, id, { withContext })  // self-contained render: includes parent role/company for evidence
selectNotes(vault, { types, ids, budgetChars, pii: 'scrub' | 'include', frame? })
render.markdown(notes) | render.jevState(notes) | render.json(notes)
formatPreferences(prefs, style)       // replaces the 5 hand-rolled variants
```

- **`frame`** is the CareerVertical lens. It doesn't change the notes; it changes selection and ordering (which evidence leads, which capabilities surface) for comms-forward vs programme vs product framing.
- **`pii: 'scrub'` is the default.** Contact details are filled into the CV header in code, never via the prompt.

**Internal AI tools.** These are AI SDK tools for chat and agents, with a read-only mirror on the external MCP:

| Tool | What it does |
|---|---|
| `profile_map` | Read first: every note's id, type, title and gist, plus link counts and gaps |
| `profile_get_note(id)` | One self-contained note, with its links |
| `profile_list(type, filter?)` | e.g. all certifications, or capabilities of kind `tool` |
| `profile_backlinks(id)` | Evidence for a capability; projects in a role |
| `profile_search(query)` | Across titles, gists, bodies and evidence; returns note ids + snippets |
| `profile_gaps` | Missing or weak areas, phrased as questions to ask the user |

## 6. Build order

1. **Read layer (no migration):**
   - Build `loadVault` over today's tables. Tools and competencies appear as capability notes.
   - Links come from what exists today: experience→project and experience→evidence. Skill links come from the junction tables, which are empty for now.
   - Renderers, PII scrub, and the deterministic CV header.
   - Migrate consumers one by one, starting with Jev (`candidate-state.ts`) and MCP `get_job_context`. `buildProfileSnapshot` becomes a thin adapter until all callers move.
2. **Internal tools:** `profile_map`, `get_note`, `list`, `backlinks`, `search`, `gaps`, in chat, then MCP read-only.
3. **Write links:**
   - Extraction and import write `demonstrates` links.
   - `[[wikilink]]` parsing in bodies.
   - Re-extraction diffs instead of duplicating.
4. **Reshape (migrations):** capability `kind`, project body merge, provenance, evidence `projectId`, drop `tags`.
5. **UI:**
   - Records as compact lists.
   - Narratives as the note editor.
   - Capability chips showing proven / certified / claimed.
   - A backlinks panel on each note.

## 7. Decisions (2026-11-11)

1. **Storage:** hybrid. Typed tables stay; the vault is the read/write layer on top.
2. **Wikilinks:** yes, `[[Capability]]` in narrative bodies (step 3).
3. **Evidence ownership:** an evidence atom can belong to an experience or a project (step 4 adds `RoleActivity.projectId`).

## 8. Step 1 status

Shipped in `feat/profile-map`:
- **Vault module** in `src/modules/profile-map/`:
  - `loadVault`: React `cache()`, so one query per request.
  - `buildVault`: pure.
  - `profileMap`: index, gaps and completeness.
  - `renderNote`: self-contained note render.
  - `formatPreferences`.
  - Contact scrubbing.
- **`buildProfileSnapshot` is now a thin adapter over the vault.** Every existing consumer gets the cached loader, plus the fields the review found missing: `summary`, `github` and tools.
- **Contact details are out of every LLM prompt by default** (`serializeProfileForLLM`).
  - Exceptions: the user's own export, and MCP `get_job_context`, where writing-desk drafts still carry an agent-written header.
  - Next for MCP: a server-filled `{{contact}}` placeholder, after which MCP scrubs too.
- **Generated CVs (job and master) get name, location and contact filled in code** (`cv/header.ts`).
- **Jev reads `summary` from the snapshot.** Its extra query is gone.
- **Dates format in UTC everywhere**, so they no longer shift a month back west of UTC.

Not yet:
- Migrating the remaining `searchProfile` text variants to `formatPreferences` (chat is done, in step 2).
- Writing links (step 3).

Smoke test on local data: no contact values in the prompt markdown, and 54% completeness. All 10 capabilities are "claimed", because no evidence links have been written yet. That makes step 3 (writing links) the biggest quality lever.

## 9. Step 2 status

Shipped in `feat/profile-tools`:
- **Six profile tools, defined once** (`profile-map/tools.ts`, over the pure `query.ts`): `profile_map`, `profile_get_note`, `profile_list`, `profile_backlinks`, `profile_search`, `profile_gaps`.
  - **Chat** gets them in place of `get_profile_section`. Its always-on overview is now built from the vault (fixing the capitalised-level filter) and tells the model to call `profile_map` first.
  - **MCP** mirrors them read-only (`mcp:read`).
  - `profile_map` returns text, one line per note (`id · title — gist`) with evidence and projects nested under their role, because it is cheaper for a model to read than JSON.
- **Contact details are out of MCP too.**
  - `get_job_context` sends the scrubbed profile. The master CV's header contact line becomes `{{contact}}`, and the rest of it is scrubbed.
  - The writing contract tells agents to write `{{contact}}` in the header.
  - `acceptDraft` replaces it with the profile's contact line (`profile-map/contact.ts`). Drafts keep the placeholder until then, so agents never read contact details back through `get_draft`.
  - The review screen explains the placeholder.
- Every tool scrubs contact details, and search never matches them.

## 10. Step 3, part 1: capability merge

The link tables (`RoleActivitySkill`, `ProjectSkill`, `ExperienceSkill`, `CertificationSkill`) reference `Skill` only, so evidence could not be linked to a tool or a competency. Step 4's capability merge therefore moves ahead of the links:
- `Skill` gains `kind` (`skill` | `tool` | `competency`), `order` and `origin`. `level` and `category` become optional, because tools have no level.
- Migration `20261111140000_merge_capabilities` copies `Tool` and `Competency` rows into `Skill`, keeping their ids. The old tables stay in place, unread, for a later cleanup.
- The tool and competency actions write `Skill` rows and return the legacy shapes, so the profile UI is unchanged.
- The vault reads every capability from `Skill`. A skill still wins a name clash with a tool or competency.
