<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md

This file is the source of truth for project conventions, shared by every coding agent that touches this repo (Claude Code, CODEX, Cursor, Aider, Continue, etc.). `CLAUDE.md` imports this file via `@AGENTS.md` so Claude Code reads the same content without duplication.

All commands run from the **project root** (not a subdirectory). API and integration specs are in `docs/`.

---

## Dev commands

```bash
npm run dev          # start dev server at localhost:3000
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # next lint

npm run db:migrate   # create + apply a named migration ← USE THIS for all schema changes
npm run db:seed      # seed default CV template + test user (test@example.com/password) + dummy jobs
npm run db:reset     # force-reset DB then re-seed (local dev only — never against production)
npm run db:studio    # open Prisma Studio in browser
npm run db:push      # ⚠ PROTOTYPE ONLY — skips migration files, never use for production schema changes

docker compose up -d   # start Postgres (port 5435)
docker compose down    # stop Postgres
```

---

## Stack

- **Next.js 16 App Router** — `src/` directory, `@/*` import alias resolves to `src/`
- **Prisma 7 + PostgreSQL** — Docker Compose for local dev (port 5435); `prisma.config.ts` handles CLI config
- **Tailwind CSS v4 + shadcn/ui** — neutral palette, `class` dark mode strategy
- **TypeScript strict** throughout
- **Provider-agnostic LLM layer** — Anthropic, OpenAI, Google; users bring their own API key

---

## Prisma 7 notes

Prisma 7 moved database connection config out of `schema.prisma` into `prisma.config.ts`.

- `prisma.config.ts` — configures CLI commands (db push, migrate); loads `.env.local` manually since Prisma doesn't load it by default. Pins `schema` to `prisma/schema/` (folder) and `migrations.path` to `prisma/migrations`.
- `prisma/schema/*.prisma` — multi-file schema split by domain (`main`, `auth`, `profile`, `cv`, `cover-letter`, `jobs`, `settings`). Prisma 7 auto-merges every `*.prisma` file in this folder at validate/generate time.
- `src/lib/db.ts` — PrismaClient singleton wired through the `PrismaPg` driver adapter with a `pg` connection pool; reads `DATABASE_URL` from environment at runtime (Next.js loads `.env.local` automatically)
- Do **not** put `url` back into the schema files — it's no longer valid in Prisma 7

### Schema change workflow — ALWAYS follow this

Every schema change, no exceptions:

1. **Edit** `prisma/schema/*.prisma`
2. **Create a migration**: `npm run db:migrate -- --name <short_description>` — this creates a timestamped SQL file in `prisma/migrations/` and applies it to the local Docker DB
3. **Commit the migration file** alongside the schema and code changes in the same PR/commit
4. **Push** — Vercel's build runs `prisma migrate deploy` automatically, applying the migration to the Neon production DB before `next build`

**Never use `db:push` for schema changes.** It applies changes without creating a migration file, causing the production DB to drift from the migration history. The next `migrate deploy` will then fail because it tries to re-create structures that already exist. `db:push` exists only for quick local prototyping where you don't care about data.

---

## Module architecture

```
src/
  modules/                  ← all domain/business logic lives here
    api-tokens/             ← bearer-token issuance + verification for /api/jobs/capture
    companies/              ← shared Company records, UK sponsor register import, job↔company matching
    deep-dive/              ← job deep dive: gather → research (no profile data) → synthesis; JobDeepDive runs
    mcp/                    ← MCP tools, OAuth verification/discovery, consent and connected apps
    jobs/                   ← job URL extraction, application records, AI job-fit scoring
    llm/                    ← provider-agnostic LLM layer (client.ts, actions.ts, errors.ts)
    onboarding/             ← lightweight job-search context captured in UserSettings
    profile/                ← career profile queries/mutations (read via parseJsonField for legacy tags)
  app/
    api/                    ← thin route handlers only: validate → call module → return JSON
    (auth)/                 ← sign-in / sign-up route group (skips dashboard chrome)
    dashboard/              ← authenticated app pages, gated by src/proxy.ts
  lib/
    db.ts                   ← PrismaClient singleton (PrismaPg adapter + pg Pool)
    auth.ts                 ← Better Auth server config; databaseHooks auto-create Profile rows
    auth-client.ts          ← client-side useSession() hook
    session.ts              ← requireProfile() — throws if not signed in
    utils.ts                ← cn(), formatDate(), parseJsonField(), slugify()
    encryption.ts           ← AES-GCM encryption for API keys stored in the DB
  components/
    ui/                     ← shadcn/ui components
```

**Rule**: business logic stays in `src/modules/`. API routes and Server Actions are thin wrappers — no domain logic there.

New domain features get their own `src/modules/<name>/` directory. The conventional file split is `queries.ts` (reads), `actions.ts` (Server Actions / mutations), `schema.ts` (Zod schemas + types) — see `src/modules/onboarding/` for the canonical small-module shape.

---

## Key conventions

### Storing structured data in Postgres

Two patterns coexist in the schema. **Prefer the native pattern for new fields**; the legacy pattern stays for existing profile columns.

**Native Postgres types (preferred for new schema fields)** — use `Json?` for arbitrary JSON objects and `String[]` for string arrays. Validate the shape at the boundary with Zod (see `src/modules/onboarding/schema.ts` for the canonical example) and use `Prisma.JsonNull` when clearing a `Json?` column:

```ts
// schema: onboardingContext Json?
import { Prisma } from "@prisma/client"
import { normalizeOnboardingContext } from "@/modules/onboarding/schema"

const context = normalizeOnboardingContext(row.onboardingContext) // Zod parse on read
await prisma.userSettings.update({
  where: { profileId },
  data: { onboardingContext: context },            // write the object directly
})
// to clear:
await prisma.userSettings.update({
  where: { profileId },
  data: { onboardingContext: Prisma.JsonNull },
})
```

**Stringified JSON (legacy — existing profile columns only)** — `Profile.experience.tags`, `Skill.tags`, etc. are typed as `String @default("[]")`. Read with `parseJsonField`, write with `JSON.stringify`. Do not introduce new fields in this pattern; migrate existing ones opportunistically only if you have a reason to touch them:

```ts
// read
const tags = parseJsonField<string[]>(row.tags, [])

// write
await prisma.skill.create({ data: { ...data, tags: JSON.stringify(data.tags) } })
```

### API key security

Keys are encrypted (AES-GCM via `src/lib/encryption.ts`) before DB storage. Never log or return raw keys. Return `hasApiKey: Boolean(llmApiKey)` from API routes instead.

---

## Authentication

Better Auth (`src/lib/auth.ts`) owns the user identity. Each user has exactly one `Profile` row via `Profile.userId` (1:1), auto-created by a `databaseHooks.user.create.after` hook in `auth.ts` on sign-up.

- **Email/password** sign-up is enabled; email verification is **off** for now (flip `requireEmailVerification: true` to enable once a mail provider is wired up)
- **Social providers** (Google, LinkedIn, X via the `twitter` provider key) are scaffolded but each only activates when its `*_CLIENT_ID` + `*_CLIENT_SECRET` env vars are present — see `getEnabledSocialProviders()` in `src/lib/auth.ts`
- **Proxy** (`src/proxy.ts`, formerly `middleware.ts` — renamed for the Next.js 16 convention) gates `/dashboard/:path*` — unauthenticated requests redirect to `/sign-in?callbackUrl=<original>`
- **Server-side session access**: import `requireProfile()` from `src/lib/session.ts` — throws if not signed in, returns `{ session, profile }`. All mutations and queries that touch user-owned data **must** filter by `profile.id`
- **Client-side session access**: `useSession()` from `src/lib/auth-client.ts`
- **Auth API route**: `src/app/api/auth/[...all]/route.ts` (Better Auth catch-all)
- **Auth pages**: `src/app/(auth)/sign-in` and `/sign-up` (route group so they skip dashboard chrome)

Dev login: `test@example.com` / `password` (created by `npm run db:reset`).

---

## Environment variables

```env
DATABASE_URL="postgresql://taiilrd:taiilrd@localhost:5435/taiilrd"

# Better Auth
BETTER_AUTH_SECRET=""              # openssl rand -base64 32
BETTER_AUTH_URL="http://localhost:3000"

# Social providers (each only enables if both ID + SECRET are set)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
LINKEDIN_CLIENT_ID=""
LINKEDIN_CLIENT_SECRET=""
TWITTER_CLIENT_ID=""               # X uses the "twitter" provider key in Better Auth
TWITTER_CLIENT_SECRET=""

ENCRYPTION_KEY="dev-encryption-key-32-bytes-long!!"  # AES-256-GCM key for at-rest secrets (LLM keys, etc.)

# Email (Resend) — required for password reset
RESEND_API_KEY=""
SENDER_EMAIL="no-reply@yourdomain.com"

# Jev (TypeSafe) — app-billed; blank key disables the early job assessment
TYPESAFE_API_KEY=""
JOB_ASSESSMENT_V2="admin"          # off | admin | all
JEV_DAILY_CALL_LIMIT="300"         # max Jev calls per profile per day

CRON_SECRET=""                     # Vercel Cron bearer token; blank = cron routes refuse (no sponsor register import)
```

The LLM layer is bring-your-own-key — each user enters their own provider API key at `/dashboard/settings/llm`. No app-level LLM env vars; costs land on the user, not the app owner.

Copy `.env.example` → `.env.local`. Never commit `.env.local`.

### Production database SSL

The production `DATABASE_URL` on Vercel must include an **explicit `sslmode`** to suppress the upcoming `pg-connection-string` v3.0 / `pg` v9.0 deprecation warning (which currently emits `SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'` in runtime logs). When those libraries upgrade, the implicit aliasing drops and SSL semantics change unexpectedly unless we're explicit now.

Append one of these to the prod connection string:

- **`?sslmode=verify-full`** (preferred) — preserves current behavior with full cert chain + hostname validation. Works on Neon, Supabase, and most managed Postgres. Try this first.
- **`?uselibpqcompat=true&sslmode=require`** (fallback) — only if `verify-full` fails to connect because the provider's cert chain doesn't validate cleanly. Adopts standard libpq semantics, which are weaker; treat as a last resort.

Update the Vercel `DATABASE_URL` env var (Production scope) via dashboard or `vercel env`. Local Docker Postgres at `localhost:5435` does not enable SSL and is unaffected — the `.env.local` value stays as-is.

---

## External APIs

- `POST /api/mcp` — stateless Streamable HTTP MCP with scoped API tokens or Better Auth OAuth. OAuth uses `@better-auth/oauth-provider` (matching Better Auth 1.7.20; the MCP endpoint is its one `resources` entry), JWT keys, DCR, PKCE, and a local consent check on every call. Setup, tool list, and discovery paths: `docs/mcp-server.md`. Never expose draft acceptance as an MCP tool. Local protocol check: `npm run test:mcp-oauth`.

- `POST /api/jobs/capture` — bearer-token-authed endpoint for agents/scripts/bookmarklets to submit a job URL. Tokens minted at `/dashboard/settings/api-tokens`. See `docs/api-jobs-capture.md` for the full spec, and `docs/api-integrations.md` for copy-pasteable recipes (curl shell function, Claude Code skill, Hermes skill, browser bookmarklet).
- `GET /api/integrations/skills/<agent>` — public endpoint that returns a templated SKILL.md for the given agent (`claude-code` or `hermes`). `{{RESUME_URL}}` placeholder in `src/lib/integrations/skills/<agent>.md` is substituted with `BETTER_AUTH_URL` (or the request origin as fallback) at request time. Whitelist + dashboard download UI live in `src/app/api/integrations/skills/[agent]/route.ts` and `src/app/dashboard/settings/api-tokens/_components/integrations-list.tsx`. Sources are kept in the function bundle via `outputFileTracingIncludes` in `next.config.ts`.
- `GET /api/internal/sponsor-register/import` — daily Vercel Cron (`vercel.json`), `CRON_SECRET` bearer. Reads the UK register of licensed sponsors, stores entries only for companies named in jobs, and links jobs to companies. Matching is exact only; see `docs/companies.md`.
- `POST`/`GET /api/jobs/[id]/deep-dive` — start a deep dive (202, runs in `after()`, user's own LLM key) or read the newest run. Session or bearer token with `deep-dive:run`. Researchers never get profile data; one `role: 'analysis'` synthesis call judges. See `docs/deep-dive.md`.
- `GET /api/llm/ping` — session-authed sanity check that runs a tiny `pong` round-trip using the signed-in user's saved LLM key. Useful right after wiring up their key in `/dashboard/settings/llm`.

## Jev (TypeSafe) — app-billed

Jev is the one exception to bring-your-own-key: the app pays for every call with `TYPESAFE_API_KEY` (server-side only). Calls go through `askJev()` in `src/modules/jev/client.ts`, which pins the model (`jev-1.14.0`), requires a `feature` tag like the LLM layer, and writes every call to `LlmUsageLog` with `provider: 'typesafe'` so usage is tracked per user (a failed call keeps a zero-token row with the feature suffixed `:failed`). A failed call throws `JevError` (with a `kind`) — never treat it as an answer. `JEV_DAILY_CALL_LIMIT` (default 300) is a hard cap on calls per profile per day: each call first reserves its usage row in a transaction holding a per-profile Postgres advisory lock, so concurrent calls can't overshoot it, and failed calls count too. The early-assessment queue also enforces a hard limit of 2 concurrent runs per profile (atomic admission under an advisory lock, `src/modules/job-assessment/queue.ts`). Question wording lives in `src/modules/job-assessment/questions.ts` (Phase 3), not in the client.

**Queue continuation:** a drain that stops on its deadline or run cap with rows still queued POSTs to `POST /api/internal/job-assessment/drain` on its own deployment (`https://$VERCEL_URL` on previews, else `BETTER_AUTH_URL`) with a 2-minute HMAC token bound to `VERCEL_DEPLOYMENT_ID` (key derived from `BETTER_AUTH_SECRET`; `VERCEL_AUTOMATION_BYPASS_SECRET` is sent as `x-vercel-protection-bypass` when set); the route answers 202 and drains in `after()`. At most 20 hops per chain; with no secret or base URL it's off and rows wait for the next trigger (`src/modules/job-assessment/continuation.ts`). `src/proxy.ts` must keep `/api/internal/*` ungated.

**Backfill:** Settings → "Early assessment" queues the newest non-archived "not started" jobs with no complete run for the current `PIPELINE_VERSION` (skipping jobs whose current-version runs failed with `verification`, `no_llm_key` or `error`; those need a manual Re-run), in batches of at most 20 and never past today's remaining Jev calls (about 3 per job). One batch at a time: refused while any run is pending, checked under a per-profile advisory lock (`src/modules/job-assessment/backfill.ts`).

## LLM layer

Bring-your-own-key — each user supplies their own provider API key. Server-side
abstraction in `src/modules/llm/`:

- `complete(profileId, prompt, opts)` — plain text generation
- `completeStructured(profileId, prompt, zodSchema, opts)` — typed JSON output via `Output.object`
- All errors normalize to `LLMError` with a `kind` field; product code branches on `kind` instead of provider-specific SDK errors
- `getLLMConfigStatus(profileId)` — cheap read-only check for "is this user set up?"
- `role: 'fast' | 'research' | 'analysis'` (default `'default'`) — feature code says what kind of work a call is; the user's "Models by task" settings pick the model. **No feature module names a model id**: only `ROLE_RECOMMENDATIONS` in `src/modules/llm/roles.ts` does. `opts.model` is for tests and admin tools only.
- `webSearch: { maxUses, allowedDomains? }` — provider-side web search (Anthropic, OpenAI, Google); a provider without one throws `LLMError` kind `unsupported`

Providers wired in: Anthropic, OpenAI, Google. Adding more is a single entry in
the `PROVIDERS` map in `client.ts`. See `docs/llm-layer.md` for usage examples.

### Rule: every LLM call must declare a `feature`

`feature` is a **required** field in `CompleteOptions` — TypeScript will refuse to compile any call that omits it. Use a short kebab-case string that describes the product operation:

```ts
// correct
await complete(profileId, prompt, { feature: 'job-fit' })
await completeStructured(profileId, prompt, schema, { feature: 'cv-import' })

// will not compile — feature is missing
await complete(profileId, prompt, {})
```

**Why:** every call is logged to `LlmUsageLog` with the feature tag. Users see this on their usage page; it also drives cost analysis by operation. A call without a feature tag is invisible in reporting.

When adding a new LLM-powered feature, also add its label to `FEATURE_LABELS` in `src/app/dashboard/settings/usage/_components/feature-labels.ts` so it displays cleanly in the UI. See `docs/llm-usage-tracking.md` for the full picture.

## Reference docs

- `docs/api-jobs-capture.md` — POST /api/jobs/capture spec
- `docs/api-integrations.md` — integration recipes for the capture endpoint (curl, Claude Code skill, bookmarklet)
- `docs/llm-layer.md` — LLM layer usage examples
- `docs/llm-usage-tracking.md` — usage logging system, feature registry, cost estimates
- `docs/deep-dive.md` — job deep dive backend: pipeline, code-side checks, limits, API, usage tags
- `docs/companies.md` — companies, job↔company matching, UK sponsor register import and cron
- `docs/job-assessment.md` — early job assessment (Jev): pipeline, scoring, queue, usage tracking, tuning, troubleshooting
- `src/lib/integrations/skills/claude-code.md` — canonical Claude Code skill source. Served by `GET /api/integrations/skills/claude-code`; downloaded SKILL.md goes in `~/.claude/skills/capture-job/`.
- `src/lib/integrations/skills/hermes.md` — canonical Hermes skill source. Served by `GET /api/integrations/skills/hermes`; downloaded SKILL.md goes in `~/.hermes/skills/job-search/capture-job/`.
