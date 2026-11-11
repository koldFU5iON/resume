# Candidate Profile — Review & "Profile Map" Proposal

**Date:** 2026-11-11 · **Status:** Review / proposal (no code changes yet)
**Method:** three read-only audits (data model, UI, internal consumers) run on a lower-cost model, then spot-checked and synthesised.

---

## 1. Synopsis — where we are

The profile is **rich in places but fragmented**. The core tables are reasonable (Experience → RoleActivity, Skill, Tool, Competency, Education, Certification, Language, Project), but:

1. **Candidate facts live in five places.** Profile tables, `UserSettings.onboardingContext`, `UserSettings.searchProfile`, `UserSettings.jobHuntSearch`, and `CareerVertical`. `preferredName` / `currentRole` / target roles exist in 2–3 of them, and different features read different copies (`scoreDiscoveredJob` still reads the legacy `onboardingContext`; job-fit reads `searchProfile`).
2. **Skills / Tools / Competencies are three flat, overlapping lists** with no link to evidence. Extraction tells the LLM a Skill is *"technology, tool, methodology, or domain"*, so tools land in Skills anyway. The four skill↔evidence junction tables (`ExperienceSkill`, `RoleActivitySkill`, `ProjectSkill`, `CertificationSkill`) exist in the schema but are **never read or written**.
3. **Retrieval has one helper that almost everyone uses, but it's lossy.** `buildProfileSnapshot` + `serializeProfileForLLM` (`src/modules/profile/snapshot.ts`) is used by ~14 call sites, but omits `Profile.summary`, `github`, the entire `Tool` table, notes, tags, and **entity ids**. Consumers work around it: Jev does a second query for `summary` and has its own JSON serializer; chat has two of its own loaders; the CV generator has a `tools` section but can't see the user's tools.
4. **No shape options.** One markdown blob, no section selection, no budget, no PII control (Jev scrubs PII; MCP `get_job_context` ships email/phone and truncates from the end, dropping oldest roles/education first).
5. **Write paths are thinly validated.** No Zod anywhere in `profile/actions.ts`; imported payloads aren't re-validated on commit; free-text enums (`level`, `category`, `proficiency`) drift in casing between import and UI.
6. **No completeness signal.** Nothing tells the user (or the AI) what's missing.

The data captured *per role* is genuinely good (markdown notes → extracted responsibilities/achievements with impact). The problem is less "we don't collect enough" and more **"we don't organise, link, or expose what we collect consistently."**

---

## 2. Current inventory (abridged)

| Section | Storage | Notes |
|---|---|---|
| Identity / contact | `Profile` columns | `github` stored but **no UI field**; no format validation; name can be nulled |
| Summary / headline | `Profile` | Not in snapshot → most AI features never see `summary` |
| Experience | `Experience` + `RoleActivity` | Good. No employment type, seniority, industry; `remote` boolean only; achievements' metrics are free-text `impact` |
| Projects | `Project` (opt. linked to experience) | Experience-linked projects can't have description/URLs/dates edited in UI; import never creates projects |
| Skills | `Skill` (name, category, level, years) | Category required but never displayed; level casing mismatch (`'Intermediate'` vs `'intermediate'`) |
| Tools | `Tool` (name, category) | Overlaps Skills; **excluded from snapshot** |
| Competencies | `Competency` | Also duplicated in `CareerVertical.competencies` and CV sections; `origin:'derived'` never written |
| Education | `Education` | `startDate` required though imports often lack it; re-import duplicates |
| Certifications | `Certification` | No credential id; re-import duplicates |
| Languages | `Language` | Free-text proficiency, no CEFR |
| Preferences / eligibility | `UserSettings` JSON ×3 | salary, remote, countries, visas, dealbreakers, goals — split across `searchProfile` / `onboardingContext` / `jobHuntSearch` |
| Missing entirely | — | notice period / availability, seniority, industries (structured), employment type, awards, publications, volunteering, licences, talks, extra links |

Dead weight: `tags` String columns on 5 models (always `'[]'`), unused junction tables, `RoleActivity.highlighted` (read, never written), `/dashboard/cv-creator/profile` hardcoded mock, `ExperienceBlock`/`ExperienceCard` unused components.

---

## 3. Bugs & risks found (fix regardless of direction)

| # | Issue | Where |
|---|---|---|
| B1 | **Onboarding LinkedIn mode can never succeed** — accepts `.zip`, passes it to a PDF-only extractor which rejects non-PDF | `app/(onboarding)/onboarding/_components/steps/Step2Profile.tsx:204` → `modules/profile-import/extract.ts:32` |
| B2 | `commitImportedProfile` trusts a client-supplied `ExtractedProfile` without re-parsing (server action is directly callable) | `modules/profile-import/commit.ts:16` |
| B3 | `updateProject` spreads `experienceId` without verifying ownership → can link to another tenant's experience id | `modules/profile/actions.ts:372` |
| B4 | `acceptSuggestion` writes `z.unknown()` into `searchProfile[field]` without schema validation | `modules/search-profile/actions.ts:63` |
| B5 | `saveOnboardingContextData` stores unvalidated partial input; `normalizeOnboardingContext` falls back to `{}` on parse failure → silent wipe on next write | `modules/onboarding/actions.ts:101`, `schema.ts` |
| B6 | `updateContactField('name', '')` writes `null` to a non-null column | `modules/profile/actions.ts:9` |
| B7 | Chat `get_profile_section` sorts skills by `level asc` (string sort: advanced, beginner, expert…) | `modules/chat/tools.ts` |
| B8 | Two date formatters (local-time `toLocaleDateString` vs UTC) → month drift across features | `profile/snapshot.ts:268` vs `job-assessment/candidate-state.ts` |

---

## 4. Quick wins (≤ ½ day each, no schema change)

1. **Fix B1–B6.** Highest value per line of code. For B1: either restrict LinkedIn mode to the LinkedIn "Save to PDF" export (copy change + `accept='.pdf'`) or drop the mode until a zip/CSV parser exists.
2. **Widen the snapshot**: add `summary`, `github`, `tools`, `credentialUrl`, `repoUrl`, and **ids** to `ProfileSnapshot`. Immediately improves job-fit, CV (tools section), cover letters, MCP — and removes Jev's extra query.
3. **One `searchProfile` → text formatter** replacing the five hand-rolled variants (`llm/prompt-context.ts`, `chat/context.ts`, `jobs/job-fit.ts`, `scout-inbox/triage.ts`, Jev `buildJudgePreferences`). Migrate `scoreDiscoveredJob` off `onboardingContext` at the same time.
4. **Request-level dedupe**: wrap `buildProfileSnapshot` in React `cache()` — CV generation, cover-letter stages and writing-desk rebuild it several times per request.
5. **Normalise enums at the boundary**: Zod schemas for skill `level` (lowercase enum), language proficiency (CEFR + Native), and lower-case import/extraction defaults.
6. **Show `github`** in Contact; **show skill category** (group skills by category in the rail).
7. **Import dedupe** for education (institution+qualification) and certifications (name+issuer).
8. **Rule-based completeness meter** (contact complete, summary present, ≥1 role with achievements, skills ≥ N, education/certs present, preferences set). Surface on the profile header *and* expose it to AI (see §5) so the assistant knows what to ask for.
9. **Delete dead code** (`cv-creator/profile` mock, unused experience components).

---

## 5. The "Profile Map" — a single retrieval layer for internal AI

### Idea

Instead of each feature loading and stringifying the profile its own way, introduce **`src/modules/profile-map/`**: one loader, one canonical typed shape, many renderers, plus a lightweight **manifest** an AI reads first to decide what to pull.

```
                ┌──────────────────────────┐
  Prisma ─────► │ loadProfileMap(profileId)│  (cache()-wrapped, ids, parsed tags,
                │   → ProfileMap (typed)   │   derived facts, provenance)
                └────────────┬─────────────┘
          ┌──────────────────┼────────────────────┬──────────────────┐
          ▼                  ▼                    ▼                  ▼
   renderMarkdown()   renderJevState()     renderJSON(sections)  manifest()
   (job-fit, CV,      (PII-scrubbed,       (chat tools, MCP)     (what exists,
    cover letter)      budgeted)                                  counts, gaps)
```

### Canonical shape (sections)

| Section key | Contents |
|---|---|
| `identity` | name, headline, summary, location, links (PII-flagged) |
| `experience` | roles → activities (kind, description, impact/metric), linked projects, linked skills |
| `capabilities` | skills **with `kind`** (`skill` / `tool` / `domain` / `competency`), level, years, evidence ids |
| `credentials` | education, certifications (later: licences) |
| `languages` | name, CEFR level |
| `projects` | standalone + role-linked |
| `preferences` | the *one* `searchProfile`: roles, locations, remote, salary, eligibility, dealbreakers, goals |
| `derived` | computed: total years, years per skill/area, current role, seniority estimate, completeness + gaps |

### API

```ts
loadProfileMap(profileId): Promise<ProfileMap>
profileManifest(map): { sections: { key, count, updatedAt, approxTokens }[], completeness, gaps: string[] }
selectSections(map, keys, { budgetChars?, pii?: 'include' | 'scrub', detail?: 'summary' | 'full' })
render.markdown(view) / render.jevState(view) / render.json(view)
formatPreferences(map.preferences, style)   // replaces the 5 variants
```

### Internal AI tool set ("internal MCP")

Exposed as AI SDK tools to chat/agents, and the read-only subset mirrored on the external MCP server (PII scrubbed by default):

| Tool | Purpose |
|---|---|
| `profile_manifest` | Cheap first call: which sections exist, sizes, completeness, gaps. Lets the model plan instead of pulling everything. |
| `profile_get_section(section, { ids?, detail })` | Section-addressable fetch with ids so answers can cite evidence. Replaces chat's `get_profile_section` and MCP's 12k-char blob. |
| `profile_find_evidence(query)` | "Where has the candidate used Kubernetes / led a team?" — searches activities, projects, skills; returns ids + snippets. |
| `profile_facts` | Derived facts (years per skill, current role, eligibility) — the deterministic numbers Jev already computes in `years.ts` / `eligibility.ts`, made shared. |
| `profile_gaps` | Completeness gaps phrased as questions the assistant can ask the user. |

**Why this scales:** new AI features ask for `selectSections(['experience','capabilities'], { budget })` rather than writing a new query + serializer; adding a field means touching the loader and renderers once; PII and budget policy live in one place.

---

## 6. Shaping the profile — simpler, more intuitive

### Data model direction (migrations, in order of value)

1. **Unify capabilities**: add `kind` to `Skill` (`skill | tool | domain | competency`) and migrate `Tool` + `Competency` rows into it. One list, faceted in the UI. (Alternatively keep tables but unify only in the Profile Map — cheaper, but the UI overlap remains.)
2. **Activate skill evidence**: start writing the existing junction tables from notes extraction and import ("this skill was demonstrated in role X / achievement Y"). This is what makes the profile *credible* to job-fit and Jev rather than a keyword list.
3. **Provenance**: `source` column (`manual | import | extracted | chat`) on profile rows; enables "AI-added, please confirm" UX and trust weighting.
4. **Structured achievements**: optional `metricValue` / `metricUnit` on `RoleActivity` alongside free-text `impact`.
5. **Experience fields**: `employmentType`, `workMode` (`onsite | hybrid | remote`, replaces boolean), `industry`.
6. **Consolidate preferences**: `searchProfile` becomes the only store; migrate and retire `onboardingContext` and `jobHuntSearch`. Add `availability` / `noticePeriod`.
7. **Accomplishments** (later): one table with `type` (`award | publication | talk | volunteering | licence`) rather than five new models.
8. **Cleanup**: drop dead `tags` columns (keep `Project.tags/highlights`, or convert to `String[]`), make `Education.startDate` optional, add `order` where reordering is wanted.

### UI direction

Today: a three-column page where the right rail stacks six sections, experience editing is split across three surfaces, and preferences live on a separate "Search context" page.

Proposed: **sectioned profile with a left section nav and a completeness header**:

- **Overview** — identity, summary, completeness meter with "next best thing to add" prompts
- **Experience** — current workspace (notes → extract) kept; one edit surface per role
- **Capabilities** — single faceted list (Skills / Tools / Domains / Competencies), each showing evidence count
- **Credentials** — education, certifications, languages
- **Preferences** — what's in Search Context today (moved here: it's part of the candidate)

Plus: drag reordering where `order` exists, toasts on failed optimistic deletes, and an "AI-suggested" badge driven by provenance.

---

## 7. Suggested phasing

> Superseded by the revised order in §9.

| Phase | Scope | Size |
|---|---|---|
| **0 — Fixes** | B1–B8 | S |
| **1 — Quick wins** | §4 items 2–9 (wider snapshot, shared prefs formatter, cache(), enum normalisation, completeness v1) | S–M |
| **2 — Profile Map** | `profile-map` module + renderers; migrate consumers one by one (Jev and MCP first: they have the most custom code) | M |
| **3 — Internal tools** | `profile_manifest` / `get_section` / `find_evidence` / `facts` / `gaps` in chat; read-only mirror on MCP | M |
| **4 — Model reshape** | Capabilities `kind`, evidence links, provenance, preference consolidation | M–L (migrations) |
| **5 — UI restructure** | Sectioned profile + Preferences move + faceted capabilities | L |

Phases 0–2 need no schema change and deliver most of the "easy to retrieve" goal. Phase 4 is what delivers "collect more, broken down logically".

---

## 8. Decisions (2026-11-11)

1. **Capabilities merge: yes.** Skills, tools and competencies become one grouped `capabilities` section (`Skill.kind`), with the migration in Phase 4.
2. **CareerVertical is a framing lens, not profile data.** It reads from the profile and reframes the same work (e.g. comms-forward vs programme manager vs product manager). In the Profile Map it is an optional `frame` input to renderers and selection, *not* a section. Its `competencies` list should reference capabilities rather than duplicate them.
3. **PII: contact details are out of AI prompts by default.** They go only into the deterministic CV header. Today the LLM copies email and phone from the profile text into `header` (`cv/generate.ts:17`). Instead the header is filled in code from `identity` after generation, and the LLM never sees contact details. The markdown and PDF exports render from the CV document as they do now, so a from-scratch CV still gets a complete header.
4. **LinkedIn importer: split out** as [#336](https://github.com/koldFU5iON/resume/issues/336), out of this scope.

## 9. Do the fixes and quick wins survive the rebuild?

Build order matters. **Do the Profile Map (read layer) before the schema reshape.** Every consumer then reads through one contract, and the capabilities merge or preferences consolidation only touch the loader, not 14 call sites.

| Item | Verdict | Why |
|---|---|---|
| B2 import re-validation | **Keep: do now** | The write path stays. Security. |
| B3 `updateProject` ownership | **Keep: do now** | The write path stays. Cross-tenant risk. |
| B4 `acceptSuggestion` validation | **Keep: do now** | `searchProfile` is the store that survives consolidation. |
| B5 onboarding silent wipe | **Keep (minimal)** | `onboardingContext` gets retired later, but a wipe before migration loses data we need to migrate. Make it non-destructive only. |
| B6 name → null | **Keep: do now** | Trivial, and identity survives. |
| B7 chat skill sort | **Skip** | Replaced by `profile_get_section`. |
| B8 date formatters | **Fold into Profile Map** | One formatter in the renderers. |
| QW2 widen snapshot | **Skip: superseded** | This *is* the Profile Map loader. Build that instead, and keep `buildProfileSnapshot` as a thin adapter during migration. |
| QW3 shared prefs formatter | **Fold into Profile Map** | Becomes `formatPreferences`. |
| QW4 `cache()` dedupe | **Fold into Profile Map** | It lives on the loader. |
| QW5 enum Zod schemas | **Keep: complementary** | The same enums carry into the capabilities merge (level, kind, CEFR). |
| QW6 show github / skill category | **github: keep. Category: skip** | Contact survives into Overview. The faceted capabilities UI replaces the rail. |
| QW7 import dedupe (edu/certs) | **Keep: complementary** | Independent of the reshape. |
| QW8 completeness meter | **Logic: fold into `derived.completeness`. UI: wait** | The logic lives in the map, and placement changes with the UI restructure. |
| QW9 dead code removal | **Keep: do now** | Less surface to migrate. |

**Revised order:**
- **0:** B2–B6, QW5, QW7, QW9, github field (one small PR).
- **1:** the Profile Map module plus migrating consumers (absorbs B8, QW2–4, QW8 logic; contact details out of prompts; deterministic CV header).
- **2:** internal tools.
- **3:** schema reshape (capabilities merge, evidence links, provenance, preference consolidation).
- **4:** UI restructure.
