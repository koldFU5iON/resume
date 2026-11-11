# Companies and the UK sponsor register

Shared, public-facts-only tables that link jobs to employers (spec: `docs/superpowers/specs/2026-11-11-job-deep-dive-design.md` §4.2, §5; issue #356). Per-user history never goes in them.

## Tables (`prisma/schema/company.prisma`)

| Table | What |
|---|---|
| `Company` | One per normalised legal name. `aliases` holds register trading names ("X LTD T/A Y" → `y`); `fromRegister` marks names the register has listed. |
| `SponsorLicence` | One row of the Home Office register. Unique on `(country, orgName, townCity, route)`: the register repeats an org + route in different towns. |
| `SponsorRegisterImport` | One row per import run: `running`, `complete` or `failed` (`skipped` only on early runs). `rows` is the size of the register file. |

`JobApplication.companyId` points at the matched `Company` (SetNull).

## Matching (`src/modules/companies/normalize.ts`, `match.ts`)

- `normalizeCompanyName`: lowercase, accents and punctuation removed, `&` → `and`, a leading "the" and trailing legal/country suffixes dropped (`ltd`, `limited`, `plc`, `llp`, `inc`, `gmbh`, `sa`, `uk`, …).
Company names are shared across users, so **only the register is trusted** to say what matches what. A job's name is reduced to its legal-name key (any "T/A …" the user typed is ignored), then looked up in this order:

1. A register company (`fromRegister = true`) with that exact name
2. A register trading-name alias held by **exactly one** company. If several companies hold it (franchise names), the job stays **unlinked** and nothing is created.
3. A company created earlier from a job with that exact name
4. Otherwise a new company is created from the job's name, with **no aliases** and `fromRegister = false`

So one user's typing can't add aliases, make a register alias ambiguous, or outrank a register name for another user. When the register later lists a job-created name, the import takes the company over (register name, `fromRegister = true`).

- Placeholders ("(unknown)", "Confidential", …) are never matched or created.
- `linkJobCompany(profileId, jobId)` runs on create, edit (when `company` changes), URL capture, quick capture, job-hunt import and assessment enrichment. It is best effort (never throws) and writes with raw SQL so `lastUpdated` doesn't change.
- The daily cron also calls `sweepJobCompanyLinks`, which links jobs with a name but no company (the backfill for older jobs) and re-checks jobs linked to job-created companies, so they move to a register company once one matches.

**Known limit:** exact names still merge different businesses with the same name. Franchises are the main case ("Subway", "Costcutter", "One Stop"; 960 keys in the Nov 2026 register cover several register names). The UI says the result is a name match and lists the matched register entries, so the user can check.

## Import (`src/modules/companies/sponsor-register.ts`, `import.ts`)

- **Source:** gov.uk *Register of licensed sponsors: workers*. The importer finds the current CSV link on the publication page; the link changes with each publication. Columns: `Organisation Name, Town/City, County, Type & Rating, Route`. Values are trimmed and whitespace collapsed.
- **Only job companies are stored.** The whole file is read, but only the entries of companies named in someone's job are kept: the exact legal name, or a trading name used by exactly one register company (the same trust rules as matching). The same run deletes stored entries no job names any more. This keeps the tables to a few hundred rows instead of ~190 MB (the full register as of Nov 2026).
- **Daily, no skip:** every run reads the register, even if gov.uk hasn't republished, so companies from newly captured jobs are checked by the next morning. A new job at a company nothing was stored for gets its chip after that run.
- **Safety:** a file with different columns or fewer than 50,000 rows is refused before any write, so a bad download can't mark every licence as lost.
- **Writes:** one transaction under `pg_try_advisory_xact_lock`: upserts in batches via `unnest()` arrays, then pruning.
- **Current vs lost:** a licence is current when `lastSeenAt` ≥ the start of the newest complete import. `removed` counts licences seen in the previous import but not this one.

## Cron

`vercel.json` runs `GET /api/internal/sponsor-register/import` daily at 05:30 UTC. Auth is `Authorization: Bearer $CRON_SECRET`; Vercel sends this automatically when the `CRON_SECRET` env var is set. **Without `CRON_SECRET` the route returns 401 and nothing is imported.** Manual run: Vercel → project → Settings → Cron Jobs → **Run**, or `vercel crons run /api/internal/sponsor-register/import`, or with a known secret:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/internal/sponsor-register/import"
```

## Status (`src/modules/companies/queries.ts`)

`getSponsorStatus(companyId)` returns:

| `result` | Meaning |
|---|---|
| `licensed` | Matched; holds a current Skilled Worker licence (`rating` = best of A/B) |
| `licensed_other_route` | Matched; current licences, none Skilled Worker |
| `not_listed` | Matched company, no current licence |
| `unknown` | No matched company, or no complete import yet |

The job page shows a **Licensed sponsor** chip (amber when B-rated) for `licensed` / `licensed_other_route` when the job is in the UK or has no recognisable country. `not_listed` is not shown: a company created from a job's own wording may simply not match the register's legal name.
