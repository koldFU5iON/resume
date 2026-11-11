# Companies and the UK sponsor register

Shared, public-facts-only tables that link jobs to employers (spec: `docs/superpowers/specs/2026-11-11-job-deep-dive-design.md` §4.2, §5; issue #356). Per-user history never goes in them.

## Tables (`prisma/schema/company.prisma`)

| Table | What |
|---|---|
| `Company` | One per normalised legal name. `aliases` holds register trading names ("X LTD T/A Y" → `y`); `fromRegister` marks names the register has listed. |
| `SponsorLicence` | One row of the Home Office register. Unique on `(country, orgName, townCity, route)`: the register repeats an org + route in different towns. |
| `SponsorRegisterImport` | One row per import run: `running`, `complete`, `failed` or `skipped`. |

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
- **Skip:** if the CSV link is the same as the last complete import's, nothing is downloaded (`skipped`). `POST …?force=1` re-imports anyway.
- **Safety:** a file with different columns or fewer than 50,000 rows is refused before any write, so a bad download can't mark every licence as lost.
- **Writes:** one transaction under `pg_try_advisory_xact_lock`. Companies and licences are upserted in batches of 5,000 via `unnest()` arrays. Locally, a full import (~142k licences, ~127k companies) takes about 12s.
- **Current vs lost:** a licence is current when `lastSeenAt` ≥ the start of the newest complete import. `removed` counts licences seen in the previous import but not this one.

## Cron

`vercel.json` runs `GET /api/internal/sponsor-register/import` daily at 05:30 UTC. Auth is `Authorization: Bearer $CRON_SECRET`; Vercel sends this automatically when the `CRON_SECRET` env var is set. **Without `CRON_SECRET` the route returns 401 and nothing is imported.** Manual run:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/internal/sponsor-register/import?force=1"
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
