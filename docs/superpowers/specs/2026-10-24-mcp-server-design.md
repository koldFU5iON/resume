# MCP Server — Controlled External AI Access (Issue #323)

Status: design, awaiting approval. Scope: first milestone only.

## Intent and why

The owner wants to work on their job search from an external AI chat instead of copy-pasting between apps. The motivating flow:

1. "Find my pending jobs." The agent lists them.
2. "Write me a CV for the HPE job." The agent finds HPE, reads the job description, the user's profile, and the master CV, then writes a CV that follows the master CV's content structure, adapting it where the job calls for it.
3. The CV lands in the Writing Desk for that job as a **draft**. The owner reviews it, may fix things by hand, and asks the agent for changes in chat until it is right. The owner then **accepts** the draft.

The thing that must not go wrong: false or incorrect claims in the CV, and a CV that ignores the master CV's content structure or the supported block formats without good reason. Currnt keeps authority over structure, validation and persistence. The agent controls content and permitted semantic structure only.

## Goals

- A remote MCP server, embedded in the existing Next.js app, usable from **Claude web and Claude Code** in the first milestone.
- Read tools: list jobs, read everything needed to draft a CV for one job.
- Draft tools: create a draft for a job, read it, edit it section by section, validate it.
- Draft-then-accept review: nothing agent-written becomes the live Writing Desk document until the owner accepts it in the app.
- The owner can edit the draft by hand while the agent is also editing it, without either overwriting the other.
- Content structure follows the owner's master CV by default, and the draft stays free to grow new sections (see "Content structure and templates").
- Block-level format enforcement comes from the existing semantic block registry, not from MCP-specific instructions.

## Non-goals (this milestone)

- ChatGPT support and OAuth. ChatGPT only offers OAuth or no-auth; it follows in a later milestone.
- Cover letters, interview prep, career profile editing, any document type other than CV.
- Changing job status, archiving, capturing new jobs, or triage actions over MCP.
- Deleting documents. Whole-document replacement is not exposed.
- Any control over fonts, margins, themes, CSS/HTML, or PDF rendering.
- A separate MCP-specific renderer or document model.
- Autonomous multi-step career agent behaviour.

## Anti-goals (a failure even if it technically works)

- An agent-written claim silently becomes live without the owner accepting it.
- An agent edit overwrites a section the owner changed by hand.
- The agent writes block syntax the registry does not support, or ignores the master CV's content structure without a reason (for example, drops the professional profile or reorders everything).
- The structure guide becomes a rigid template that stops a section being added or reshaped when the content calls for it.
- The CV or PDF carries any "AI generated" label. The owner explicitly does not want one.
- Domain logic duplicated inside MCP handlers.

## Decisions made by the owner

- **Which jobs:** from the job tracker (`JobApplication`), not Job Hunt or Scout discoveries. Default list is everything not archived (`archivedAt` null) and not rejected: not started, in progress, applied, interviewing, and accepted. Rejected and archived jobs are returned only when explicitly requested.
- **Review:** agent output lands as a draft; the owner reviews and accepts.
- **No AI label** in the document content.
- **Iteration:** the owner reviews, asks for changes in chat, and the agent revises the same draft until done.
- **Concurrent hand edits:** the owner will sometimes edit the draft themselves. The agent must work from the latest version and edit specific sections.
- **Clients:** Claude web and Claude Code first; ChatGPT later.
- **Template and structure:** the agent should follow the prescribed template when one exists. The master CV is that template, but it does not use the semantic block system; what it prescribes is **content structure**. If none exists, fall back to a typical CV format. The prescribed structure is the starting point, not a cage: the Writing Desk exists so new sections can be introduced, and the flow is template content flow, then flexibility, then new content forming naturally. Details in "Content structure and templates".

## Decisions made by me (the owner has not confirmed these)

- **Embedded, not a separate service.** A route handler at `/api/mcp` using Streamable HTTP, stateless. It uses the official `@modelcontextprotocol/sdk` (not currently installed). Verify the SDK's fit with Next.js 16 route handlers against `node_modules/next/dist/docs/` before writing code.
- **Auth: existing `rsm_` bearer tokens plus scopes.** Claude accepts static bearer headers. Add a `scopes String[]` column to `ApiToken` via a migration. Existing tokens are backfilled with the capture scope only so they gain no new power. New scopes: `mcp:read`, `mcp:write`. The token-creation UI lets the owner choose. `verifyBearerHeader` is reused and extended to return scopes. Tokens also get an optional `expiresAt` (null means no expiry, as today, so existing tokens are unaffected); an expired token fails verification like a revoked one. The token-creation UI offers expiry options, and the default for new write tokens is left to the builder.
- **Thin layer.** Tool handlers call profile-id-based service functions in `src/modules/`. The Writing Desk server actions use `requireProfile()` (browser session), so the shared logic is extracted into session-free service functions, the same split `api-tokens/service.ts` uses. Server actions and MCP both call them.
- **Section addressing by content hash.** `get_draft` returns the draft split into sections, each with an id (derived from the heading text or directive name plus occurrence index) and a hash of its current content. An edit carries the section id and the hash the agent last saw. The server applies it only if the section's current hash matches; otherwise it returns a conflict containing the section's current content so the agent can re-read and retry. No revision history is needed, and the owner's edits to other sections never block the agent.
- **Provenance kept internally.** Each MCP write records token id, tool and timestamp in a change log visible to the owner in settings or the draft history. It never appears in the document, preview, or PDF.
- **Draft storage shape is left to the builder** within the constraints below.
- **Tool descriptions plus an MCP resource carry the writing contract.** The contract combines the block catalogue (generated from `BLOCK_REGISTRY`) and the content structure guide (derived from the master CV, with a default fallback), never hand-maintained.

## First implementation step: verify the client assumption

The owner has seen the Request headers section in Claude web's custom connector dialog but has not used it. Before building tools, stand up a minimal authenticated `/api/mcp` endpoint exposing one read-only tool, and confirm both Claude Code and Claude web can connect with a bearer header and call it. If Claude web cannot, stop and re-scope (Claude Code only, or OAuth in this milestone).

## Tool catalogue (first milestone)

Read (scope `mcp:read`):

- `list_jobs({ include?: "active" | "rejected" | "archived" | "all", company?: string })` returns id, title, company, status, dates. Default `active`.
- `get_job_context({ jobId })` returns, in one call: job description (clearly marked as untrusted source text), the candidate profile, the master CV (as Markdown), the content structure guide, the block catalogue with examples, and the writing contract. Everything the agent needs to draft.
- `get_draft({ jobId })` returns the current draft as sections with ids and hashes, plus a draft revision.

Write (scope `mcp:write`):

- `create_draft({ jobId, content })` creates the draft from full Markdown, validated before it is stored.
- `replace_section({ jobId, sectionId, expectedHash, content })`.
- `insert_section({ jobId, afterSectionId | position, content })`.
- `remove_section({ jobId, sectionId, expectedHash })`.
- `validate_draft({ jobId })` returns diagnostics and fact-check warnings without changing anything.

Every write tool validates, and every validation failure returns actionable errors (what was wrong, which section, what is allowed). No tool accepts or returns theme or styling input. Accepting a draft is **not** an MCP tool; it happens only in the app.

**Tool visibility follows scope.** The tool list returned to a client is filtered by the token's scopes. A read-only token never sees the write tools, their descriptions or their parameters, and a call to a tool outside the token's scopes is refused even if the client guesses its name. Scopes are checked on every call, not once per session.

## Content structure and templates

The master CV is the prescribed template. It is stored as structured CV content, not in the semantic block system, so what it prescribes is **which sections exist and in what order**, plus its voice (headline, profile prose, competency and skill framing). The existing master-CV-to-Markdown conversion (the one `setWritingDeskSource` already uses) is how it reaches the agent.

**Rough guide** (the default when the master CV has nothing more specific, and the fallback when no master CV exists at all): header, professional profile, competencies, professional experience, tools, skills, certifications, education, languages. The master CV's own section list and order win over this default where they differ (for example, the master CV also has a capabilities section, which the owner confirmed stays included for now).

**Flow:**

1. **Start from the prescribed structure.** The agent drafts using the master CV's sections in its order, adapting content to the job. Tailoring the master's voice is expected; replacing it wholesale is not.
2. **Allow flexibility.** The agent may drop a section that has nothing relevant, reorder for emphasis, or add a section the job calls for (for example, publications, projects or a key-achievements summary). The Writing Desk is a freeform Markdown document so this is normal, not an exception.
3. **Let new content form naturally.** New sections are written as ordinary Markdown headings, optionally using supported blocks. They are validated like everything else (supported block names only) and are never rejected for being absent from the guide.

**How the guide is enforced:** it is not. It reaches the agent through `get_job_context` and the writing contract resource, as the starting structure with a plain statement that deviation is allowed when justified. `validate_draft` may report structural deviations (for example, no professional profile) as informational notes, never as errors or warnings that block anything. The owner is the judge of structure at review time.

**Writing guidance carried in the contract** (advice to the agent, never validated): keep the professional profile to about 3 to 5 lines; use conventional section headings (for example "Core Competencies", "Technical Skills", "Professional Experience") so the CV stays readable by applicant tracking systems; group skills into categories instead of one long list; keep experience in reverse chronological order. This follows common CV guidance from public careers sources and is a starting point the owner can override.

## Validation and factual integrity

- Structure: parse with the existing `parseWritingDeskDocument`. Reject unknown block names and any diagnostic of severity `error`. Warnings are returned to the agent but do not block. Which sections a CV contains and in what order is guidance, not validation: it never causes a rejection (see "Content structure and templates").
- Facts: the server cross-checks structured facts in the draft (employers, titles, dates, qualifications) against the candidate profile and returns mismatches as warnings from every write and from `validate_draft`. They are also shown to the owner on the review screen. They do not block the write, because the owner may legitimately reword. Free-text claims (e.g. metrics) cannot be verified automatically; the tool descriptions instruct the agent to use only profile-supported claims, and the review step is the final check.
- Untrusted input: job descriptions and any retrieved document text are returned inside clearly delimited data fields with a notice that they are data, not instructions.

## Constraints

- Prisma 7: schema changes go through `npm run db:migrate -- --name <desc>`, never `db:push`, and the migration file is committed.
- Every query filters by the token's `profileId`. `profileId` is never taken from tool arguments.
- No LLM calls are made by the MCP server itself, so no `feature` tag is needed. Costs fall on the client side.
- Business logic stays in `src/modules/`; the route handler only authenticates, dispatches and serialises.
- Every tool response has a maximum size, not only the job description. Anything over the cap is truncated with a visible marker, or paged where the tool supports it. This limits the surface for injected instructions and respects client result limits.
- Tests with vitest alongside the modules, following existing `*.test.ts` conventions.
- Per `CLAUDE.md`, implementation work branches from `origin/main` (`git fetch origin`, then `git switch -c feat/<name> origin/main`).
- This depends on the semantic block work (#320/#322). The registry currently has `header`, `skills`, `inline-list`, `compact-list`; the CV contract must be built from whatever the registry contains at implementation time.

## Review experience

The draft appears in the existing Writing Desk for that job. The owner can edit it by hand, then accept it. Accepting replaces the live content and bumps the existing `revision`. If live content already exists, the owner must be able to see what accepting will replace (diff or side-by-side). The exact UI is left to the builder.

## Left to the builder

- Draft storage (columns on `WritingDeskDocument` vs a separate draft model), within: one active draft per job, hand edits and agent edits share it, accept is atomic and respects the existing revision check.
- Section id derivation details and hashing.
- SDK transport specifics, error shapes, and tool schema wording.
- The review UI and change-log UI.
- Scope-selection UI on the API tokens settings page.
- Exact fact-check heuristics, within the warning-not-block rule.

## Calls made after the builder check (mine, unconfirmed)

- **Hand edit vs agent edit in the same section.** The owner's editor saves the whole draft with the existing revision check, so a stale owner save gets the existing conflict result. Agent section operations apply atomically against the latest draft and bump its revision. If the owner has renamed or moved a section so the agent's section id no longer resolves, the server returns "section not found" together with the current section list. It never falls back to a guess, and it never targets a different section.
- **Accept.** Accept carries the live revision the diff was shown against. If live content changed since, accept fails and the owner sees a fresh diff. Fact-check warnings are displayed on the review screen but never block accept, since the owner is the authority. After accept the draft is cleared; the agent can create a new draft but cannot edit the accepted document.
- **Tokens.** The profile is the only boundary: any `mcp:write` token may draft for any of the owner's jobs. Scopes are not editable on an existing token; the owner mints a new one. The default selection is read-only, and choosing write shows a warning. Existing tokens are backfilled with the capture scope only, and `/api/jobs/capture` keeps working unchanged.
- **Fact-check scope.** Best effort for this milestone: match employer names, date ranges and qualifications found in the draft against the profile's experience and education. If the server cannot extract a fact, it raises no warning. Partial coverage is acceptable; deeper verification is a later milestone.
- **Blocks and templates.** Templates have no allowed-block concept today, and adding one is out of scope. Every block in `BLOCK_REGISTRY` is allowed for CVs. The section guide described below is separate from blocks and is advisory. (This replaces my earlier assumption that the contract was the registry plus the CV template's section list.)
- **Payload size.** `get_job_context` truncates an oversized job description with a visible marker. A missing description is returned as empty with a note. The block catalogue and contract are also exposed as an MCP resource so the agent can fetch them separately.

## Later milestones (follow-up issues)

1. OAuth via Better Auth's `mcp` plugin, enabling ChatGPT. Currnt signs users in with email/password and LinkedIn OAuth (no Google), so the connector's consent screen would sit on top of the existing sign-in, LinkedIn included. The owner's earlier OAuth connector experience was with a Google login elsewhere, which does not apply here.
2. Cover letters and other document types.
3. CV tailoring workflows and richer fact validation (claims requiring review).
4. Draft history and rollback.
