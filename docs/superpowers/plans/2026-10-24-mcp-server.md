# MCP Server (Issue #323, first milestone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A remote MCP server inside the Next.js app that lets Claude web and Claude Code list jobs, read everything needed to draft a CV, and create and revise a draft CV in the Writing Desk that the owner reviews and accepts in the app.

**Architecture:** A stateless Streamable HTTP route at `/api/mcp` authenticates with existing `rsm_` bearer tokens extended with scopes and expiry. Tools are thin wrappers over session-free service functions in `src/modules/`. Agent output is stored as a per-job draft (columns on `WritingDeskDocument`), edited section by section with content-hash conflict checks, and only becomes live when the owner accepts it in the Writing Desk.

**Tech Stack:** Next.js 16 route handlers, Prisma 7 + Postgres, Zod 4, `@modelcontextprotocol/sdk` (new), vitest, existing `unified`/`remark` Writing Desk parser.

**Spec:** `docs/superpowers/specs/2026-10-24-mcp-server-design.md` (read it first; this plan only records decisions the spec leaves open).

## Global Constraints

- Branch is `feat/mcp-server-323`, already cut from `origin/main`. Do not branch from local `main`.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing route-handler code (this is not the Next.js you know; see `AGENTS.md`).
- Schema changes: edit `prisma/schema/*.prisma`, run `npm run db:migrate -- --name <short_description>`, commit the migration with the code. Never `db:push`.
- Every query filters by the token's `profileId`. `profileId` is never read from tool arguments.
- Business logic lives in `src/modules/`; the route handler only authenticates, dispatches and serialises. Writing Desk server actions use `requireProfile()`, so MCP calls session-free service functions instead.
- No LLM calls from the MCP server (no `feature` tag needed).
- Scopes are exactly `capture`, `mcp:read`, `mcp:write`. Existing tokens are backfilled with `capture` only. `/api/jobs/capture` must keep working for them.
- Job statuses come from `ApplicationStatus` in `src/app/types/job-application.ts` (note `"in-progress"` has a hyphen). Default job list = `archivedAt` null and status not `"rejected"`.
- Document content max length is `MAX_WRITING_DESK_CONTENT_LENGTH` (500,000) from `src/modules/writing-desk/schema.ts`.
- Tool response cap `MAX_TOOL_RESPONSE_CHARS = 60_000`; job description cap 20,000 characters. Both are this plan's values, truncated with a visible marker.
- No "AI generated" text in document content, preview or PDF. Provenance goes only in the change log.
- Tests: vitest, `*.test.ts` beside the module, prisma mocked with `vi.mock("@/lib/db", ...)` like `src/modules/writing-desk/actions.test.ts`.
- Commit messages end with the attribution trailers the session specifies.

## Review Focus

Failure modes the spec implies that are most likely to bite, most likely first. Each has a test in the task named.

1. Owner and agent both change the same section: the agent's edit is refused with the section's current content, never overwritten, and an edit to a different section still succeeds. (Tasks 3, 6)
2. Agent content with an unknown `:::block`, an unclosed `:::` fence, or nested blocks: rejected or reported with a line number, and the section splitter never swallows the rest of the document. (Tasks 3, 4)
3. Fenced code containing `#` or `:::` lines, and `\r\n` line endings: sections split correctly. (Task 3)
4. A read-only, expired or revoked token: write tools are absent from the tool list and refused if called by name. (Tasks 1, 2)
5. Oversized job description, oversized tool result or draft over 500,000 characters: truncated with a marker, or rejected, never silently cut. (Tasks 2, 6, 7)

---

### Task 1: Token scopes and expiry

**Files:**
- Modify: `prisma/schema/api-tokens.prisma`, `src/modules/api-tokens/service.ts`, `src/modules/api-tokens/actions.ts`, `src/app/api/jobs/capture/route.ts`
- Create: `prisma/migrations/<timestamp>_api_token_scopes_expiry/migration.sql` (via migrate), `src/modules/api-tokens/service.test.ts`, `src/app/api/jobs/capture/route.test.ts`

**Interfaces:**
- Produces (in `service.ts`):
  - `API_TOKEN_SCOPES = ['capture', 'mcp:read', 'mcp:write'] as const`; `type ApiTokenScope`
  - `type VerifiedToken = { profileId: string; tokenId: string; scopes: ApiTokenScope[] }`
  - `createApiToken(profileId: string, name: string, opts?: { scopes?: ApiTokenScope[]; expiresAt?: Date | null }): Promise<CreatedToken>` (default scopes `['capture']`)
  - `verifyApiToken(raw: string): Promise<VerifiedToken | null>`, `verifyBearerHeader(authHeader: string | null): Promise<VerifiedToken | null>` (both return `null` for expired tokens)
  - `ApiTokenSummary` gains `scopes: ApiTokenScope[]` and `expiresAt: Date | null`
- `createApiTokenAction(name: string, scopes?: ApiTokenScope[], expiresInDays?: number | null)`

- [ ] **Step 1: Write failing tests** in `service.test.ts`: valid token returns `{profileId, tokenId, scopes}`; `expiresAt` in the past returns `null`; future and `null` `expiresAt` pass; revoked returns `null`; `createApiToken` calls `prisma.apiToken.create` with `scopes: ['capture']` by default and with the given scopes and `expiresAt`. In `route.test.ts`: a token without `capture` gets 403 `{ error: 'forbidden' }` and `captureJobFromUrl` is not called; a token with `capture` proceeds.
- [ ] **Step 2: Run** `npx vitest run src/modules/api-tokens src/app/api/jobs/capture` and confirm they fail.
- [ ] **Step 3: Schema.** Add to `ApiToken`: `scopes String[] @default(["capture"])` and `expiresAt DateTime?`. Run `npm run db:migrate -- --name api_token_scopes_expiry`. Open the generated SQL and confirm the column default is `ARRAY['capture']`, so existing rows are backfilled.
- [ ] **Step 4: Implement** the service changes (select `scopes`/`expiresAt` in `verifyApiToken`, treat `expiresAt <= now` as invalid), the action signature, and the capture route scope check (403 body `{ error: 'forbidden', message: 'Token lacks the capture scope' }`).
- [ ] **Step 5: Run** the same vitest command plus `npm run typecheck`; expect PASS.
- [ ] **Step 6: Commit** `feat(api-tokens): add scopes and optional expiry`.

### Task 2: MCP endpoint skeleton, `list_jobs`, and client verification gate

**Files:**
- Create: `src/modules/mcp/errors.ts`, `src/modules/mcp/limits.ts`, `src/modules/mcp/registry.ts`, `src/modules/mcp/server.ts`, `src/modules/mcp/tools/index.ts`, `src/modules/mcp/tools/list-jobs.ts`, `src/app/api/mcp/route.ts`, tests beside each
- Modify: `src/modules/jobs/queries.ts`, `package.json`

**Interfaces:**
- Produces:
  - `errors.ts`: `class McpToolError extends Error` (message is safe to show the client)
  - `limits.ts`: `MAX_TOOL_RESPONSE_CHARS`, `capText(text: string, max?: number): string` (appends `\n[truncated: N characters omitted]`)
  - `registry.ts`: `type McpToolScope = 'mcp:read' | 'mcp:write'`; `type McpToolContext = { profileId: string; tokenId: string }`; `type McpToolDefinition = { name: string; scope: McpToolScope; description: string; inputSchema: z.ZodObject; handler(ctx: McpToolContext, args: any): Promise<unknown> }`; `toolsForScopes(tools: McpToolDefinition[], scopes: ApiTokenScope[]): McpToolDefinition[]` (scopes are independent: `mcp:write` does not imply `mcp:read`)
  - `tools/index.ts`: `ALL_MCP_TOOLS: McpToolDefinition[]` (later tasks append here)
  - `server.ts`: `createMcpServer(auth: VerifiedToken, tools?: McpToolDefinition[]): McpServer` registering only tools allowed by `toolsForScopes`; each handler re-checks scope, calls the tool, returns one text content item of `capText(JSON.stringify(result))`; a thrown `McpToolError` becomes `isError: true` with its message; any other error becomes `isError: true` with `"Internal error"` and is logged
  - `jobs/queries.ts`: `listJobsForAgent(profileId: string, opts: { include?: 'active' | 'rejected' | 'archived' | 'all'; company?: string }): Promise<Array<{ id; title; company; status; dateApplied; lastUpdated }>>` (`active` = `archivedAt: null` and status not rejected; `rejected` = status rejected and `archivedAt: null`; `archived` = `archivedAt` not null; `company` is a case-insensitive contains)
  - `tools/list-jobs.ts`: tool `list_jobs`, scope `mcp:read`, input `{ include?: enum (default 'active'), company?: string }`

- [ ] **Step 1: Install and read.** `npm install @modelcontextprotocol/sdk`. Read the installed SDK's Streamable HTTP server transport and find its web-standard (Request/Response) variant and how to run it stateless (no session id). Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`. Confirm the exact export names and that the SDK accepts Zod 4 schemas; if it does not, stop and report.
- [ ] **Step 2: Write failing tests.** `limits.test.ts`: text under the cap is unchanged; over the cap is cut and ends with the marker naming the omitted count. `queries` test: each `include` value produces the expected prisma `where` (assert the `status` and `archivedAt` clauses and that `profileId` is always present). `server.test.ts` with fake tools: a token with only `mcp:read` lists no write tool; calling a write tool by name is refused; `McpToolError` maps to `isError` with its message; an unexpected error maps to `"Internal error"`; a result over the cap is truncated. `route.test.ts`: no header gives 401; a valid token with only `capture` gives 403; a token with `mcp:read` gets a successful `tools/list` containing `list_jobs`.
- [ ] **Step 3: Run** `npx vitest run src/modules/mcp src/modules/jobs src/app/api/mcp`; confirm FAIL.
- [ ] **Step 4: Implement** the files above. The route exports `POST` (and returns 405 for `GET`/`DELETE`), builds a fresh server per request from `verifyBearerHeader`, and uses the stateless web-standard transport. Scope check: require at least one of `mcp:read`/`mcp:write`.
- [ ] **Step 5: Run** the same command plus `npm run typecheck`; expect PASS.
- [ ] **Step 6: Commit** `feat(mcp): authenticated MCP endpoint with list_jobs`.
- [ ] **Step 7: Verification gate (manual, owner involved).** Mint a token with `mcp:read` (temporary script or the Task 10 UI if already done; otherwise insert via `npm run db:studio` using a hashed token from the service's `createApiToken` in a one-off script). Confirm: (a) Claude Code connects: `claude mcp add --transport http currnt <url>/api/mcp --header "Authorization: Bearer <token>"`, then ask it to list jobs; (b) Claude web: Settings > Connectors > Add custom connector, put the bearer in Request headers, and ask it to list jobs. Claude web needs a publicly reachable URL (a Vercel preview or a tunnel; if preview deployment protection blocks it, use the protection bypass). **If Claude web cannot connect, stop and tell the owner; the spec says to re-scope (Claude Code only, or OAuth).**

### Task 3: Section splitting, hashing and section operations

**Files:**
- Create: `src/modules/writing-desk/sections.ts`, `src/modules/writing-desk/sections.test.ts`

**Interfaces:**
- Produces:
  - `type DraftSection = { id: string; hash: string; text: string }`
  - `splitSections(markdown: string): DraftSection[]`
  - `joinSections(sections: Array<{ text: string }>): string` (sections joined with a blank line, one trailing newline)
  - `hashSectionText(text: string): string` (first 12 hex chars of SHA-256 of the trimmed text)
  - `type SectionOp = { type: 'replace'; sectionId: string; expectedHash: string; content: string } | { type: 'insert'; afterSectionId?: string; position?: 'start' | 'end'; content: string } | { type: 'remove'; sectionId: string; expectedHash: string }`
  - `type SectionOpResult = { ok: true; markdown: string } | { ok: false; reason: 'section_not_found' | 'hash_mismatch' | 'invalid_op'; sections: DraftSection[]; current?: DraftSection }`
  - `applySectionOp(markdown: string, op: SectionOp): SectionOpResult` (insert needs exactly one of `afterSectionId` or `position`, otherwise `invalid_op`)

**Algorithm (not determined by the signatures).** Work line by line, normalising `\r\n` to `\n`. Track fenced code (a line starting with three backticks or tildes toggles it) and directive depth (a line matching `^:::[a-z0-9-]+` opens a block, a bare `:::` closes it). Outside code fences: a top-level `:::name` line starts a section with id `name` that runs to its closing `:::` (or to end of input if unclosed, so an unclosed fence never splits what follows incorrectly: treat the rest as that section); an ATX heading line (`#` to `######`) at directive depth 0 starts a section with id `slug(heading text)`; text before the first boundary is section `preamble`. Duplicate ids get `-2`, `-3` by occurrence order. Headings inside a directive block do not start sections.

- [ ] **Step 1: Write failing tests:** heading sections get slug ids (`"## Professional Experience"` gives `professional-experience`); a `:::header` block containing `# Morgan Ellis` is one section with id `header`; duplicate headings give `education` and `education-2`; preamble id; a fenced code block containing `# not a heading` and `:::skills` does not split; `\r\n` input splits the same as `\n`; an unclosed `:::skills` makes the remainder one section; `hashSectionText` ignores surrounding whitespace and changes when content changes; `joinSections(splitSections(x))` equals `x` for a canonically formatted sample; `replace` with a correct hash succeeds and leaves other sections' text byte-identical; `replace` with a stale hash returns `hash_mismatch` with `current` holding the live section; an unknown id returns `section_not_found` with the current section list; `insert` with `afterSectionId`, `'start'` and `'end'`; `remove`; a section edit when a different section was changed by hand still succeeds (Review Focus 1).
- [ ] **Step 2: Run** `npx vitest run src/modules/writing-desk/sections.test.ts`; confirm FAIL.
- [ ] **Step 3: Implement** `sections.ts` per the algorithm above.
- [ ] **Step 4: Run** the same command; expect PASS.
- [ ] **Step 5: Commit** `feat(writing-desk): section splitting and hash-checked section operations`.

### Task 4: Draft validation and structure guide

**Files:**
- Create: `src/modules/writing-desk/validate.ts`, `src/modules/writing-desk/structure-guide.ts`, tests beside each

**Interfaces:**
- Consumes: `parseWritingDeskMarkdown(markdown)`, `getBlockDefinition` from `src/modules/writing-desk/markdown.ts`; `WritingDeskContentSchema`; `CVDocumentContent` from `src/modules/cv/schema.ts`
- Produces:
  - `structure-guide.ts`: `type StructureGuide = { source: 'master-cv' | 'default'; sections: Array<{ key: string; heading: string }> }`; `DEFAULT_CV_STRUCTURE: StructureGuide['sections']` (header, Professional Profile, Core Competencies, Professional Experience, Tools, Skills, Certifications, Education, Languages); `buildStructureGuide(master: CVDocumentContent | null): StructureGuide` (visible sections in the master's order mapped from section type to heading: profile "Professional Profile", competencies "Core Competencies", capabilities "Capabilities", experience "Professional Experience", education "Education", certification "Certifications", skills "Skills", tools "Tools", languages "Languages", header "Header", custom uses its `data.heading`; null or empty master gives the default)
  - `validate.ts`: `type DraftIssue = { severity: 'error' | 'warning' | 'info'; message: string; line?: number }`; `type DraftValidation = { ok: boolean; issues: DraftIssue[] }`; `validateDraftMarkdown(markdown: string, guide?: StructureGuide): DraftValidation` (`ok` is true when there are no `error` issues)

**Rules.** Content over `MAX_WRITING_DESK_CONTENT_LENGTH` is an error. Any `writingDeskBlock` node whose `name` has no registry definition is an **error** (the existing parser only warns; this promotes it), with the block's line. Any parser diagnostic of severity `error` is an error; parser warnings pass through as `warning`. With a guide, a missing guide section produces an `info` note only (for example "No Professional Profile section"); order and extra sections never produce issues.

- [ ] **Step 1: Write failing tests:** unknown `:::fancy-grid` block is an error carrying its line number; known blocks (`header`, `skills`, `inline-list`, `compact-list`) pass; nested block diagnostic comes through as a warning; content of 500,001 characters is an error; a draft missing the profile gets an `info` note but `ok` stays true; extra sections and reordered sections produce no issues; `buildStructureGuide(null)` equals the default; a master with `capabilities` and a custom section yields them in master order with the custom heading.
- [ ] **Step 2: Run** `npx vitest run src/modules/writing-desk/validate.test.ts src/modules/writing-desk/structure-guide.test.ts`; confirm FAIL.
- [ ] **Step 3: Implement** both files. `validate.ts` walks the parsed tree for block nodes.
- [ ] **Step 4: Run** the same command; expect PASS.
- [ ] **Step 5: Commit** `feat(writing-desk): draft validation and CV structure guide`.

### Task 5: Fact check against the profile

**Files:**
- Create: `src/modules/writing-desk/fact-check.ts`, `src/modules/writing-desk/fact-check.test.ts`

**Interfaces:**
- Consumes: `ProfileSnapshot` from `src/modules/profile/snapshot.ts`
- Produces: `type FactWarning = { kind: 'employer' | 'dates' | 'qualification'; message: string; excerpt: string }`; `checkFacts(markdown: string, profile: ProfileSnapshot): FactWarning[]`

**Heuristics (best effort, warnings only, silent when nothing can be extracted).** A *date line* is any line containing a range like `Mar 2019 - Present`, `2016 – 2019` or `01/2018 - 06/2021` (hyphen or en dash). For each date line: if it names a profile employer (case-insensitive) or role, compare the range to that experience's start and end (month when the draft gives one, otherwise year; `Present` must match `endDate === null`) and emit `dates` on mismatch; if it names no profile employer or role, emit `employer`. In a section whose heading contains "Education", a line containing a degree keyword (`BSc`, `BA`, `MSc`, `MA`, `MBA`, `PhD`, `Bachelor`, `Master`, `Doctor`) that matches none of the profile's qualification or institution names emits `qualification`.

- [ ] **Step 1: Write failing tests** with a small profile fixture: matching employer and dates yields no warnings; a wrong start year yields one `dates` warning naming the profile's dates; `Present` against an ended role yields `dates`; an invented employer on a date line yields `employer`; a recognised degree yields nothing and an invented degree yields `qualification`; a draft with no date lines yields an empty array (silent); metrics and free text never warn.
- [ ] **Step 2: Run** `npx vitest run src/modules/writing-desk/fact-check.test.ts`; confirm FAIL.
- [ ] **Step 3: Implement** `checkFacts` per the heuristics.
- [ ] **Step 4: Run** the same command; expect PASS.
- [ ] **Step 5: Commit** `feat(writing-desk): profile fact-check warnings for drafts`.

### Task 6: Draft storage and service

**Files:**
- Modify: `prisma/schema/writing-desk.prisma`
- Create: `src/modules/writing-desk/draft.ts`, `src/modules/writing-desk/draft.test.ts`, migration via migrate

**Schema.** On `WritingDeskDocument` add `draftContent String?`, `draftRevision Int @default(0)`, `draftUpdatedAt DateTime?`. Add model `WritingDeskDraftEvent { id String @id @default(cuid()); writingDeskId String; apiTokenId String?; tool String; detail Json?; createdAt DateTime @default(now()); writingDesk WritingDeskDocument @relation(onDelete: Cascade); @@index([writingDeskId, createdAt]) }` (add the back-relation). Migration name `writing_desk_drafts`. One draft per job follows from one desk per job.

**Interfaces:**
- Consumes: `applySectionOp`, `splitSections` (Task 3); `validateDraftMarkdown` (Task 4); `checkFacts` (Task 5); `buildProfileSnapshot`
- Produces (all session-free, take `profileId` first):
  - `type DraftState = { deskId: string; jobId: string; content: string; draftRevision: number; liveRevision: number; sections: DraftSection[]; warnings: FactWarning[]; issues: DraftIssue[] }`
  - `type DraftResult<T = DraftState> = { ok: true; value: T } | { ok: false; reason: 'job_not_found' | 'no_draft' | 'draft_exists' | 'wrong_document_type' | 'invalid' | 'conflict' | 'section_not_found' | 'hash_mismatch' | 'live_changed'; message: string; issues?: DraftIssue[]; sections?: DraftSection[]; current?: DraftSection; draft?: { content: string; draftRevision: number } }`
  - `createDraft(profileId, jobId, content, actor?: { tokenId: string }): Promise<DraftResult>` (upserts the desk, sets `documentType` to `cv` if null, rejects `wrong_document_type` for any other type, rejects `draft_exists`, validates first)
  - `getDraft(profileId, jobId): Promise<DraftResult>`
  - `editDraftSection(profileId, jobId, op: SectionOp, actor?: { tokenId: string }): Promise<DraftResult>` (re-reads, applies `applySectionOp`, validates the whole result, writes with `updateMany where draftRevision = read value` and retries up to 3 times on a lost race; every successful agent write inserts a `WritingDeskDraftEvent`)
  - `saveDraftContent(profileId, deskId, content, expectedDraftRevision): Promise<DraftResult<{ draftRevision: number }>>` (owner hand edit, whole draft, `conflict` returns the current draft like `updateWritingDeskContent`; validation errors do **not** block an owner save)
  - `acceptDraft(profileId, deskId, expectedLiveRevision, expectedDraftRevision): Promise<DraftResult<{ revision: number }>>` (one `updateMany` guarded on both revisions; copies draft into `content`, increments `revision`, clears `draftContent`; `live_changed` or `conflict` otherwise)
  - `discardDraft(profileId, deskId): Promise<DraftResult<{}>>`
  - `listDraftEvents(profileId, deskId, limit = 20): Promise<Array<{ tool: string; createdAt: Date; apiTokenId: string | null }>>`

- [ ] **Step 1: Write failing tests** (prisma mocked): `createDraft` for another profile's job returns `job_not_found`; for a desk typed `cover-letter` returns `wrong_document_type`; with an existing draft returns `draft_exists`; with an unknown block returns `invalid` carrying the issues and writes nothing; success sets `documentType: 'cv'` when null and writes an event with the token id. `editDraftSection`: stale hash returns `hash_mismatch` with `current`; an unknown section returns `section_not_found` with the section list; a lost `updateMany` race retries and then succeeds, and after 3 failures returns `conflict`; a successful edit increments `draftRevision` and logs the tool name; content never contains any provenance text. `saveDraftContent` with a stale `expectedDraftRevision` returns `conflict` and the current draft; a draft over 500,000 characters is rejected. `acceptDraft`: success moves draft into live content, increments `revision` and clears the draft; changed live revision returns `live_changed`; stale draft revision returns `conflict`; no draft returns `no_draft`. `discardDraft` clears it. Every function filters by `profileId`.
- [ ] **Step 2: Run** `npx vitest run src/modules/writing-desk/draft.test.ts`; confirm FAIL.
- [ ] **Step 3: Migrate.** Edit the schema and run `npm run db:migrate -- --name writing_desk_drafts`.
- [ ] **Step 4: Implement** `draft.ts` as specified.
- [ ] **Step 5: Run** the same command plus `npm run typecheck`; expect PASS.
- [ ] **Step 6: Commit** `feat(writing-desk): per-job agent drafts with review lifecycle`.

### Task 7: Job context tool and writing contract

**Files:**
- Create: `src/modules/mcp/context.ts`, `src/modules/mcp/contract.ts`, `src/modules/mcp/tools/get-job-context.ts`, tests beside each
- Modify: `src/modules/mcp/tools/index.ts`, `src/modules/mcp/server.ts` (register resources)

**Interfaces:**
- Consumes: `buildProfileSnapshot`, `serializeProfileForLLM`; `parseCVContent`, `toMarkdown`; `buildStructureGuide`; `BLOCK_LIST`; `capText`
- Produces:
  - `contract.ts`: `buildWritingContract(guide: StructureGuide): string` (plain text: the block catalogue with each block's `label`, `description` and `example` generated from `BLOCK_LIST`; the structure guide as the starting structure with an explicit statement that adding, dropping and reordering sections is allowed when justified; the writing guidance (profile about 3 to 5 lines, conventional headings, categorised skills, reverse-chronological experience); the rule that only profile-supported claims may be used; and that unsupported `:::` blocks are rejected)
  - `context.ts`: `getJobContext(profileId: string, jobId: string): Promise<{ job: { id; title; company; status; jobDescription: string; descriptionNote?: string }; profile: string; masterCv: string | null; structureGuide: StructureGuide; blocks: Array<{ id; label; description; example }>; contract: string }>`; throws `McpToolError('Job not found')` for another profile's job. The master CV is the latest `CVDocument` with `jobApplicationId: null` and a `careerVerticalId`, selecting `generatedContent` (the existing `getLatestMasterCV` does not select it, so query directly), converted with `toMarkdown(parseCVContent(...))`. The job description is truncated to 20,000 characters with a marker, returned as `""` with `descriptionNote` when missing, and wrapped so it is clearly data (`jobDescription` field plus a top-level `untrustedFields: ['job.jobDescription']` marker and notice text).
  - `tools/get-job-context.ts`: tool `get_job_context`, scope `mcp:read`, input `{ jobId: string }`
  - `server.ts`: register an MCP resource `currnt://writing-contract/cv` (scope `mcp:read`) returning `buildWritingContract` for the owner's current guide

- [ ] **Step 1: Write failing tests:** contract text includes every block id from the registry and the sentence allowing deviation; the structure guide in the contract reflects a master with `capabilities`; `getJobContext` for another profile's job throws `Job not found`; a missing description yields `""` and a note; a 25,000-character description is cut at 20,000 with the marker; no master CV yields `masterCv: null` and the default guide; the tool is absent from the list for a token without `mcp:read`.
- [ ] **Step 2: Run** `npx vitest run src/modules/mcp`; confirm FAIL.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run** the same command plus `npm run typecheck`; expect PASS.
- [ ] **Step 5: Commit** `feat(mcp): job context tool and generated writing contract`.

### Task 8: Draft tools

**Files:**
- Create: `src/modules/mcp/tools/get-draft.ts`, `create-draft.ts`, `replace-section.ts`, `insert-section.ts`, `remove-section.ts`, `validate-draft.ts`, tests beside each
- Modify: `src/modules/mcp/tools/index.ts`

**Interfaces:**
- Consumes: the `draft.ts` functions (Task 6), `validateDraftMarkdown`, `checkFacts`, `McpToolError`
- Produces tools (scopes in brackets), each mapping a failed `DraftResult` to a `McpToolError` whose message states what was wrong, which section, and what to do next (for `hash_mismatch` and `section_not_found`, include the current section list or section text so the agent can retry; for `invalid`, list each issue with its line):
  - `get_draft` [`mcp:read`] `{ jobId }` returns sections (id, hash, text), `draftRevision`, warnings, issues
  - `create_draft` [`mcp:write`] `{ jobId, content }`
  - `replace_section` [`mcp:write`] `{ jobId, sectionId, expectedHash, content }`
  - `insert_section` [`mcp:write`] `{ jobId, afterSectionId?, position?: 'start' | 'end', content }`
  - `remove_section` [`mcp:write`] `{ jobId, sectionId, expectedHash }`
  - `validate_draft` [`mcp:read`] `{ jobId }` returns `{ ok, issues, warnings }` without writing

Descriptions must tell the agent to call `get_job_context` first, use only profile-supported claims, re-read with `get_draft` after a conflict, and that the owner accepts the draft in the app. No tool takes or returns theme or styling input and none can accept a draft.

- [ ] **Step 1: Write failing tests** (draft service mocked): each tool passes `ctx.profileId` and `{ tokenId: ctx.tokenId }`; `hash_mismatch` surfaces the current section text in the error message; `invalid` lists issue lines; `create_draft` on an existing draft says to edit sections or ask the owner to discard; the read-only token's tool list contains `get_draft` and `validate_draft` but none of the four write tools; write tools are refused for a read-only token; successful write results include warnings from `checkFacts`.
- [ ] **Step 2: Run** `npx vitest run src/modules/mcp/tools`; confirm FAIL.
- [ ] **Step 3: Implement** the tools and register them in `ALL_MCP_TOOLS`.
- [ ] **Step 4: Run** the same command plus `npm run typecheck`; expect PASS.
- [ ] **Step 5: Commit** `feat(mcp): draft read and section-edit tools`.

### Task 9: Draft review UI in the Writing Desk

**Files:**
- Create: `src/modules/writing-desk/draft-actions.ts` (`"use server"` wrappers), `src/modules/writing-desk/draft-actions.test.ts`, `src/app/dashboard/job-applications/view/[id]/writing/_components/draft-review.tsx`
- Modify: `src/modules/writing-desk/queries.ts`, `src/app/dashboard/job-applications/view/[id]/writing/page.tsx`, `src/app/dashboard/job-applications/view/[id]/writing/_components/writing-desk.tsx`

**Interfaces:**
- Consumes: `saveDraftContent`, `acceptDraft`, `discardDraft`, `listDraftEvents`, `checkFacts`, `validateDraftMarkdown`
- Produces:
  - `draft-actions.ts`: `saveDraftContentAction(deskId, content, expectedDraftRevision)`, `acceptDraftAction(deskId, expectedLiveRevision, expectedDraftRevision)`, `discardDraftAction(deskId)`, each calling `requireProfile()` and the service function, and `revalidatePath` for the writing page on success
  - `queries.ts`: `WritingDeskWithJob` gains `draft: { content: string; draftRevision: number; updatedAt: Date; warnings: FactWarning[]; issues: DraftIssue[]; events: Array<{ tool: string; createdAt: Date }> } | null`; `getWritingDesk` fills it (warnings via `checkFacts(draft, await buildProfileSnapshot(profileId))`)
  - `DraftReview` client component props `{ desk: WritingDeskWithJob }`

**Behaviour.** When `desk.draft` is non-null, render a banner above the editor ("Draft ready for review") and `DraftReview`: an editable draft textarea that autosaves through `saveDraftContentAction` using the draft revision, a read-only side-by-side of the live content and the draft, the fact-check warnings and structural notes as a list, a short change history, and Accept / Discard buttons. Accept calls `acceptDraftAction(desk.id, desk.revision, draftRevision)`; on success dispatch the existing `writing-desk-updated` window event (`{ deskId, proposedContent, revision }`, the same event `tool-confirmation-card.tsx` dispatches) so the live editor adopts the new content, then refresh. On `live_changed` or `conflict`, show a message and reload the page data so a fresh comparison appears. Warnings never disable Accept.

- [ ] **Step 1: Write failing tests** for `draft-actions.ts` (service mocked): each action resolves the profile through `requireProfile()` and never takes a profile id from its arguments; accept success calls `revalidatePath`; failures pass the service reason through unchanged.
- [ ] **Step 2: Run** `npx vitest run src/modules/writing-desk/draft-actions.test.ts`; confirm FAIL.
- [ ] **Step 3: Implement** the actions, the query extension and the components.
- [ ] **Step 4: Run** the same command plus `npm run typecheck` and `npm run lint`; expect PASS.
- [ ] **Step 5: Verify in the app** using the `run` skill: with the dev server and a token, create a draft via the MCP tools (Claude Code or a curl `tools/call`), open the job's Writing Desk, confirm the banner and side-by-side appear, edit the draft by hand, ask the agent to replace a different section (succeeds) and the same section (conflict with current text), then Accept and confirm the live editor updates and the draft disappears. Report any step that fails.
- [ ] **Step 6: Commit** `feat(writing-desk): draft review, accept and discard UI`.

### Task 10: Token UI for scopes and expiry, and docs

**Files:**
- Modify: `src/app/dashboard/settings/api-tokens/_components/tokens-manager.tsx`, `src/app/dashboard/settings/api-tokens/page.tsx` (if it lists tokens), `docs/api-integrations.md`, `AGENTS.md` (External APIs and Module architecture entries)
- Create: `docs/mcp-server.md`

**Behaviour.** The create-token dialog gains an access choice: "Capture jobs only" (`['capture']`, default), "MCP read-only" (`['mcp:read']`), "MCP read and write" (`['mcp:read', 'mcp:write']`, with a visible warning that the agent can create and edit drafts for any of your jobs), and an expiry choice (never, 30, 90 or 365 days). Token rows show scopes and expiry. Scopes cannot be edited on an existing token. `docs/mcp-server.md` covers the endpoint URL, token creation, connecting Claude Code (`claude mcp add --transport http ... --header ...`) and Claude web (custom connector with Request headers), the tool list, and the draft-then-accept flow. Add one line each to `AGENTS.md` for `POST /api/mcp` and `src/modules/mcp/`.

- [ ] **Step 1: Implement** the dialog, row display, docs and `AGENTS.md` entries, passing the chosen scopes and `expiresInDays` to `createApiTokenAction`.
- [ ] **Step 2: Run** `npm run typecheck`, `npm run lint` and `npx vitest run`; expect PASS across the whole suite.
- [ ] **Step 3: Verify in the app** with the `run` skill: create one token of each access type, confirm the read-only token's `tools/list` hides the write tools and the capture-only token is refused by `/api/mcp`, and an expired token (set `expiresAt` in the past via `npm run db:studio`) is refused.
- [ ] **Step 4: Commit** `feat(api-tokens): scope and expiry choices, MCP docs`.

### Task 11: Whole-flow verification

- [ ] **Step 1: Run** `npm run typecheck`, `npm run lint`, `npx vitest run`, and `npm run build`; expect all to pass.
- [ ] **Step 2: Walk the motivating flow** with Claude Code (and Claude web if the gate in Task 2 passed): list jobs, ask for a CV for one job, check the draft follows the master CV's structure and block syntax, ask for two section changes, edit another section by hand in the app between them, then accept. Confirm the accepted document has no AI label and the PDF route still renders it.
- [ ] **Step 3: Report** results to the owner, listing anything that did not match the spec. Do not push or open a PR until the owner asks.
