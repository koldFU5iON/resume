# Early Job Assessment (Jev) — Design Spec

**Plan:** `docs/superpowers/plans/2026-11-10-jev-early-assessment.md`
**Status:** Question wording tested against `jev-1.14.0` on 12 real applications (anonymised below) plus synthetic probes. This spec fixes the wording and the combination rules the plan leaves open. Where it differs from the plan, **the spec wins**; the changes are listed in §1.

---

## 1. What the prototype showed, and what changed

**Setup.**
- Verify + judge ran on the 12 most recent applications from one real account.
- A person did the facts step by hand, following §3's rules, because no cheap-model key was available locally. Everything else is real Jev output.
- The candidate was the account's master CV: its full dated history, 8 roles from 2007 to now.

| Finding | Evidence | Change |
|---|---|---|
| **The candidate state must include the full dated history** | A first run used a profile cut to 12k of 56k chars, so Jev saw only the latest role. Years estimates fell to about 1.5y everywhere, and one role scored weak 2 instead of pursue 6. | §4.2: the candidate state is built in code from *every* experience, with dates always kept and each role's text capped. Never truncate the whole text from the end. |
| Verify separates real postings from teasers cleanly | Full descriptions scored 0.86–0.97 on `is_full_description`; a LinkedIn-style teaser scored 0.06 | None. Pass at ≥ 0.7. |
| **"Any must-have below 0.3 is a hard blocker" blocks far too much** | The first run marked 7 of 12 Blocked, mostly from "N+ years in X" or tool-skill lines | Only **credential** must-haves block outright. Years requirements use the **years rule** below. Other experience or skill must-haves below 0.3 are **major gaps**: −0.5 each, at most −2, shown red, no block. |
| **Years need their own rule, with a range estimate** | Jev placed program-management work at 5–8 years (the account owner's own estimate: about 5 in practice, 2.5 by title). Adding up per-role answers instead over-counted to 13 years: every comms role got partial PM credit. | Facts pulls `years: { min, area }` out of each years requirement. Jev answers a **years-bucket choice** for the area, and code compares the estimate with the requirement: met, **warn**, or **block** (§5). |
| Credential checks work as intended | "BSc in Computer Science" vs a diploma: 0.06 → blocked. "…or equivalent practical experience": 0.73 → met | None |
| Relocation is a separate case from work rights | 3 of 12 roles must be *based in* IE or UK, or on-site in Dublin; the candidate lives in FR with full EU work rights | New check, `relocation`: **unconfirmed** unless the job's country is one of the user's target countries. Needs `eligibility.currentCountry`. |
| Availability lines can't be judged from a profile | "Availability to travel" can't be shown or disproved by a CV | New requirement kind, `availability`. Never asked as a requirement question; only matched against dealbreakers. |
| The description often has no location | 6 of 12 gave no location | Facts falls back to the job row's `countries`. If still unknown, skip the work-rights and relocation checks and show "Location unknown". |
| Sponsorship wording is read correctly | "Must have the right to work in the UK" → `explicitly_not_offered` 1.00; "we offer visa sponsorship" → `offered` 0.99; nothing said → `not_mentioned` 1.00 | None |
| Cost and latency are negligible | 5.8k–9.1k input tokens per job (verify + judge). Each call took 150–250 ms, and the two run in parallel | Budget about $0.0003 per assessment |
| Contract roles need a flag | 1 of 12 was a 12-month contract | Facts adds `employmentType`; dealbreakers can match it, e.g. "no fixed-term contracts" |

---

## 2. Eligibility profile (search-profile `eligibility`)

The plan's schema, plus `currentCountry`:

```ts
eligibility: {
  currentCountry: 'FR',                 // ISO alpha-2; prefilled by parsing Profile.location, the user confirms
  citizenships: ['ES'],                 // illustrative: EU, not IE → covers EU/EEA/CH; GB needs sponsorship
  visas: [],                            // { country, type, expiresOn }
  salaryFloors: [
    { currency: 'EUR', floor: 90000, target: 100000 },
    { currency: 'GBP', floor: 85000, target: null },
  ],
  dealbreakers: [],                     // short lines, e.g. "Fixed-term contract", "Regular weekend on-call"
}
```

**Work-rights coverage table** (`eligibility.ts`):

| Basis | Covers |
|---|---|
| Citizenship of an EU/EEA country or CH | All EU + EEA (IS, LI, NO) + CH |
| Irish citizenship | The above + GB (Common Travel Area) |
| British citizenship | GB + IE (Common Travel Area) |
| Any other citizenship | That country |
| A visa | Its country, until `expiresOn` |

---

## 3. Facts extraction (cheap model, `feature: 'job-assessment-facts'`)

**Model:** `FAST_MODELS[provider]` (Anthropic: `claude-haiku-5-5`), `temperature: 0`, `maxOutputTokens: 1400`.

**Schema** (it replaces the plan's version):

```ts
JobFactsSchema = z.object({
  requirements: z.array(z.object({
    text: z.string().max(220),
    kind: z.enum(['education','certification','licence','clearance','language','experience','skill','availability']),
    importance: z.enum(['must','nice']),
    years: z.object({
      min: z.number().positive(),        // "5+ years", "5 to 8 years" → 5, "minimum of 8" → 8
      area: z.string().max(160),         // the kind of work, without the number
    }).nullable(),
  })).max(14),
  location: z.object({
    countries: z.array(z.string().length(2)),
    mode: z.enum(['onsite','hybrid','remote_in_country','remote_region','remote_anywhere','unknown']),
    basedInRequired: z.boolean(),        // "must be based in", "only open to candidates in", onsite
    remoteRegions: z.array(z.string()).default([]),
  }),
  salary: z.object({ min: z.number().nullable(), max: z.number().nullable(),
                     currency: z.string().length(3), period: z.enum(['year','month','day','hour']) }).nullable(),
  seniority: z.enum(['intern','junior','mid','senior','staff','principal','lead','manager','director','vp','exec','unknown']),
  employmentType: z.enum(['permanent','fixed_term','contract','internship','unknown']),
})
```

**System prompt:**

```
You extract structured facts from a job description for an automated screening step. Output only what the
description states. Do not guess, estimate or add anything.

Requirements
- One requirement per distinct line item. Keep the description's own wording, trimmed to one sentence.
- importance = "must" for required / minimum / essential items. Use "nice" for preferred, ideally, a plus,
  bonus, nice to have, or "we also consider candidates with fewer…".
- Skip personality traits and generic attitudes that no CV can show (e.g. "positive energy",
  "can-do attitude", "attention to detail", "passion for our mission").
- kind:
  education      degree or diploma requirements
  certification  named certifications (PMP, CISSP, Six Sigma…)
  licence        legal licences (driving, medical, bar…)
  clearance      security clearance
  language       a spoken or written language level
  experience     years or type of past work, track records, domain background
  skill          tools, methods, abilities
  availability   travel, on-call, shifts, start date, hours: things a CV can't show
- years: when a requirement names a number of years, set min to the lowest number accepted and area to the
  kind of work, without the number. Example: "5 to 8 years in business operations or chief of staff roles"
  → { min: 5, area: "business operations or chief of staff roles" }. Otherwise null.
- If one line has two year clauses ("8+ years in X, including 3+ years leading Y"), write two requirements,
  one per clause.
- If a line gives a total plus a specific ("8+ years of relevant experience, including 6+ in strategy…"),
  keep only the specific clause; "relevant experience" has no area to check.
- At most 8 must and 6 nice. If there are more, keep the ones most specific to this role.

Location
- countries: ISO 3166-1 alpha-2 codes for every country the role can be based in. Use the hints below if the
  description says nothing.
- basedInRequired: true when the description requires living or working in specific countries (onsite,
  "must be based in", "only open to candidates in…").

Salary: only a range or figure printed in the description. Otherwise null.
```

**User message:** the job title, company, and the description inside `<job_description>` tags. Hints: the job row's `countries` and `salaryBand`, each marked "may be empty or wrong".

---

## 4. Jev question set (`jev-1.14.0`)

### 4.1 Verify — state `{ description }`. Tested.

```json
{
  "is_full_description": { "type": "noul",
    "instructions": "`description` is a complete job posting for a single role.",
    "criteria": {
      "true": "It describes what the role involves and what is expected of candidates, in enough detail to judge fit.",
      "false": "It is a teaser, a truncated preview, a list of several jobs, a login/cookie/error page, or too short to judge fit." } },
  "has_requirements":     { "type": "noul", "instructions": "`description` lists requirements, qualifications or experience expected of candidates." },
  "has_responsibilities": { "type": "noul", "instructions": "`description` describes the responsibilities or day-to-day work of the role." }
}
```

**Pass rule:** `is_full_description ≥ 0.7` and `has_requirements ≥ 0.5`.

**Failure reasons:**

| Condition | Reason shown |
|---|---|
| `is_full_description < 0.7` | "Description looks incomplete or truncated" |
| `has_requirements < 0.5` | "No candidate requirements found" |

### 4.2 Judge — state `{ candidate, job: { title, company, description }, preferences }`

**`candidate` is built by `buildCandidateState(snapshot)`, not taken from `serializeProfileForLLM` unchanged.**
- **Every experience is included,** newest first. Each one gets a header line of title, company, start–end and location, which is never cut. Its body text (summary + achievements) is capped at about 1,200 chars, cutting at the end of a sentence.
- **Then** education, certifications, languages, and skills grouped by category.
- **Target:** at most about 8k tokens. The test candidate (8 roles) was about 4.7k.
- **Unit test:** a profile with one very long role still includes every other role's header line.

Requirements of kind `availability` are not asked.

**Requirement template** (requirements without `years`). Tested. Id `req_<i>`:

```json
{ "type": "noul",
  "instructions": "The candidate described in `candidate` meets this job requirement: \"<text>\"",
  "criteria": {
    "true": "The profile shows the requirement is met, directly or through an alternative the requirement itself allows (e.g. \"or equivalent experience\", \"or related field\", \"or similar\").",
    "false": "The profile does not show it, shows only a lower level (e.g. a diploma where a degree is required, fewer years than stated), or shows it only partially." } }
```

**Years template** (requirements with `years`). Tested. Id `req_<i>`, same id space:

```json
{ "type": "choice",
  "instructions": "How many years has the person in `candidate` spent doing this kind of work: \"<area>\"? Count every role where this work was a substantial part of the job, whatever the job title was. Count overlapping roles once. Use the dates in `candidate`.",
  "criteria": {
    "none": "No experience doing this kind of work.", "under_1": "Less than 1 year.",
    "y1_2": "1 to 2 years.", "y2_3": "2 to 3 years.", "y3_5": "3 to 5 years.",
    "y5_8": "5 to 8 years.", "y8_12": "8 to 12 years.", "y12_plus": "12 or more years." } }
```

**Rubrics.** Tested:

```json
{
  "skills_match": { "type": "score",
    "instructions": "How closely does the experience in `candidate` match the work the role in `job.description` actually involves day to day?",
    "criteria": [
      "Little overlap: the core work of the role is outside the candidate's experience.",
      "Some overlap: a few relevant skills, but most of the core work would be new to the candidate.",
      "Partial: about half of the core work matches work the candidate has done.",
      "Strong: most of the core work matches work the candidate has done, with minor gaps.",
      "Near-complete: the candidate has done essentially this job before." ] },
  "seniority_fit": { "type": "choice",
    "instructions": "How does the seniority of the role in `job` compare with the most recent level shown in `candidate`?",
    "criteria": {
      "well_below": "The role is two or more levels below the candidate's current level.",
      "below": "The role is one level below.",
      "match": "The role is at about the same level.",
      "above": "The role is one level above.",
      "well_above": "The role is two or more levels above." } },
  "domain_fit": { "type": "score",
    "instructions": "How familiar is `candidate` with the industry and domain of the role in `job` (the company's market, products and customers)?",
    "criteria": [ "Unfamiliar industry and domain.", "Adjacent: a related industry or transferable domain.",
                  "Same broad industry, different segment.", "Same industry and domain." ] },
  "sponsorship": { "type": "choice",
    "instructions": "What does `job.description` say about visa sponsorship or work authorisation for candidates who need it?",
    "criteria": {
      "offered": "States that visa sponsorship or relocation support with work permits is available.",
      "explicitly_not_offered": "States that sponsorship is not available, OR requires candidates to already have the right to work in the country.",
      "not_mentioned": "Says nothing about sponsorship, visas or right to work." } }
}
```

**Conditional questions.** Not yet tested; test before Phase 3 ships:

```json
{
  "direction_fit": { "type": "score",
    "instructions": "How well does the role in `job` fit the direction in `preferences` (target roles, career goals, career-change context)?",
    "criteria": [ "Moves away from the stated direction.", "Neutral: neither towards nor away.",
                  "Partly aligned: adjacent to a target role or goal.", "Directly aligned with a target role or goal." ] },
  "remote_match": { "type": "noul",
    "instructions": "The working pattern of the role in `job` (onsite, hybrid or remote) fits `preferences.remotePreference`." },
  "dealbreaker_<i>": { "type": "noul",
    "instructions": "The role in `job` involves this: \"<dealbreaker>\"",
    "criteria": { "true": "The description states or clearly implies it.", "false": "The description does not state or imply it." } }
}
```

| Question | Asked when |
|---|---|
| `direction_fit` | The search profile has target roles, career goals or career-change context |
| `remote_match` | `remotePreference` is set |
| `sponsorship` | Always. It's cheap, and storing it lets coverage rules change later without re-running Jev. |
| `dealbreaker_<i>` | One per eligibility dealbreaker |

---

## 5. Combine rules (`combine.ts`)

### Years rule

- Bucket ranges: `none 0–0 · under_1 0–1 · y1_2 1–2 · y2_3 2–3 · y3_5 3–5 · y5_8 5–8 · y8_12 8–12 · y12_plus 12–20`.
- **est** is the midpoint of the **median bucket**: the first bucket where the cumulative probability reaches 0.5.
- Shown to the user as the bucket's range, e.g. "~3–5 yrs", never as a precise number.

| Status | Condition |
|---|---|
| **met** | est ≥ required |
| **warn** | est ≥ 0.5 × required, or required − est ≤ 2 |
| **block** | anything else |

| Required | Candidate est | Result |
|---|---|---|
| 5 | 2.5 | warn (2.5 ≥ 0.5 × 5) |
| 10 | 2.5 | **block** (2.5 < 5 and a 7.5-year gap) |
| 8 | 6.5 | warn |
| 3 | 1.5 | warn (gap ≤ 2) |
| 12 | 4 | **block** |

For coverage, a years requirement counts `p = min(1, est / required)`.

### Blockers

| Kind | Hard (→ Blocked) | Unconfirmed / warn (amber) | Major gap (red, −0.5 each, at most −2) |
|---|---|---|---|
| Credential must-have (education, certification, licence, clearance, language) | `req < 0.3` | — | — |
| Years must-have | years rule = **block** | years rule = **warn** (also counts as a major gap for the score) | — |
| Other experience or skill must-have | — | — | `req < 0.3` |
| Work rights | Not covered and `sponsorship = explicitly_not_offered` | Not covered and `not_mentioned` | — |
| Relocation | — | `basedInRequired` / onsite, `currentCountry` not among the job's countries, and those countries not among the user's target countries | — |
| Pay | Stated `max` < floor (same currency) | `min` < floor ≤ `max` | — |
| Dealbreaker | `dealbreaker_i > 0.7` | 0.4–0.7 | — |

### Score

The `direction` weight applies only when `direction_fit` was asked. When it isn't, the four weights below are used as they are; these are the ones tested. When it is: coverage 0.34, skills 0.26, seniority 0.15, domain 0.10, direction 0.15.

```
coverage  = Σ w·p / Σ w            // w: must 2, nice 1; p = req noul, or min(1, est/required) for years
skills    = skills_match.score / 4
domain    = domain_fit.score / 3
seniority = Σ p(option) · {match 1, below/above 0.6, well_below/well_above 0.2}
composite = 0.40·coverage + 0.30·skills + 0.18·seniority + 0.12·domain
          − 0.05 if the stated max pay < target
raw       = 1 + 9·composite
penalty   = min(2, 0.5 · (major gaps + years warnings))
score     = clamp(round(raw − penalty), 1, 10)
level     = 1–2 weak · 3–4 consider · 5–7 pursue · 8–10 priority
display   = "Blocked · {score}/10" if any hard blocker, else the level
```

### Detail contents

| Section | What goes in it |
|---|---|
| Strengths | Up to 3 must-haves with `p ≥ 0.7`, highest first. Met years requirements show as "8+ yrs program management ✓ (~8–12)". |
| Gaps | Years warnings ("Needs 5+ yrs business ops — you have ~3–5"), major gaps (marked), then requirements with `0.3 ≤ p < 0.7` |
| Low confidence | Shown when the mean confidence of the rubric and choice answers is < 0.5 |

---

## 6. Worked examples (real runs, anonymised)

The test eligibility was an EU (non-Irish) citizen based in FR, with a EUR floor of 90k (target 100k) and a GBP floor of 85k. The candidate was the master CV (8 dated roles). Scores come from §5's formula applied to the stored Jev answers.

**Spread:** 2 consider · 8 pursue · 2 priority, and none Blocked: no job had a credential, pay-floor, sponsorship or years-block issue for this candidate.

| # | Role (sector) | Location / terms | Score | Level | Flags |
|---|---|---|---|---|---|
| 1 | Agency business-excellence manager (social platform) | not stated | 8 | **priority** | — |
| 2 | EMEA business manager (cloud infrastructure) | not stated | 8 | **priority** | — |
| 3 | Senior program manager (risk data) | Paris or London, €78k–129.8k | 7 | pursue | pay: range straddles floor |
| 4 | Senior manager, marketing operations Europe (streaming) | hybrid, not stated | 7 | pursue | — |
| 5 | Business manager, GTM (HR-tech) | remote anywhere | 7 | pursue | years warn: 5+ biz ops, ~3–5 |
| 6 | Strategy & ops lead, applied AI (US healthcare marketplace) | remote, US | 7 | pursue | work rights: US, not mentioned |
| 7 | Program manager, IP operations (social platform) | not stated | 6 | pursue | — |
| 8 | Director of corporate communications (streaming) | hybrid, not stated | 6 | pursue | — |
| 9 | Principal program manager, 12-month contract (games) | onsite Dublin | 6 | pursue | 1 major gap · relocation · contract |
| 10 | Program manager, marketing lead generation (building tech) | hybrid, not stated | 5 | pursue | 2 major gaps |
| 11 | Brand operations manager (salon SaaS) | IE, remote in country | 4 | consider | years warn: 5+ brand/creative ops, ~3–5 · 2 major gaps · relocation |
| 12 | Head of growth (browser games start-up) | UK/IE only, remote | 3 | consider | 4 major gaps · relocation |

**Example 5 → pursue 7/10, years warning.** "5 to 8 years in business operations, chief of staff, strategy consulting or similar" → Jev's estimate is `y3_5` (~3–5 yrs, midpoint 4). 4 ≥ 0.5 × 5 → **warn**: −0.5, shown as "Needs 5+ yrs — you have ~3–5". The other must-haves are met at 0.79–0.94, so it stays pursue.

**Example 8 → pursue 6/10.** "12+ years of hands-on leadership in corporate communications" → `y12_plus` → **met**. The candidate's history has 15+ years of PR and comms roles. With the cut-off profile (latest role only), this job scored weak 2. That's the clearest case for §4.2's rule on the candidate state.

**Example 12 → consider 3/10.** Both years requirements are met: games/consumer marketing ~12–20, leading a marketing function ~8–12. But 4 hands-on growth must-haves are major gaps: scaling track record 0.17, performance/creator/community mix 0.22, budget ownership 0.15, attribution/LTV analytics 0.23. Seniority is `well_above` 0.65. Relocation is flagged too. Meeting the years doesn't make it a fit; the detail lists the four gaps.

**Example 6 → pursue 7/10, amber work-rights flag.** A good functional match (0.73–0.93), but the company's remote roles are in effect US-based and the description says nothing about sponsorship. **This application was rejected.** The flag is exactly the early warning the pipeline should give. (Location was inferred by the person standing in for the facts step; the cheap model needs the row's `countries` hint to get this reliably.)

**Example 3 → pursue 7/10, amber pay flag.** Seniority `match` 1.00, must-haves 0.56–0.93. The salary range €78k–129.8k straddles the 90k floor: unconfirmed, so confirm the band early.

**Synthetic years cases** (the account owner's examples), from the rule table in §5:
- A job needs 5 years and the candidate has ~2.5 → **warn**.
- A job needs 10+ years and the candidate has ~2.5 → **Blocked**.

**Synthetic credential blocker.** "BSc in Computer Science" vs "Diploma in Multimedia Design": `req` 0.06 → **Blocked**. Against "…or equivalent practical experience": 0.73 → met.

**Synthetic verify failure.** A LinkedIn preview ("…See more. Sign in to view more jobs"): `is_full_description` 0.06 → **Needs attention: Description looks incomplete or truncated**.

---

## 7. Calibration notes and open items

- **Years estimates move with the wording of the area.** On the same CV, "program or project management" came out ~5–8 and "managing programs or projects" ~8–12. The rule's warn band absorbs most of this. If the side-by-side shows flip-flopping, normalise the `area` wording in the facts prompt.
- **Adding up per-role answers was tested and rejected.** It over-counted badly (13 years of PM), because adjacent roles each got partial credit. The single bucket question across the whole history matched the account owner's own estimate.
- **There's no manual override of years yet.** Jev reads the CV, so the fix for a wrong estimate is a clearer experience entry. If that proves too indirect, add per-area overrides to `eligibility` later.
- **Bundled requirements still score low when only partly met,** e.g. "hands-on across performance marketing, influencers, community, partnerships and brand/PR". Watch for false major gaps; splitting such lines is a possible v2 change.
- **Nice-to-have degrees never block.** They only lower coverage, as intended.
- **`direction_fit` and `remote_match` haven't been tested,** because the search profile wasn't available through the test path. Test both against real preferences in Phase 3.
- **The old `jobFit` scores aren't in this comparison.** The MCP read path doesn't return them. The in-app side-by-side (Phase 4) and `assess:compare` (Phase 5) cover that.
- **Thresholds and weights are first guesses.** All of them live in `ASSESSMENT_CONFIG`; bump `PIPELINE_VERSION` on any change.

---

## 8. Test fixtures

- **`combine.test.ts`** uses fixtures built from the §6 runs: signal values only, roles anonymised. It also covers:
  - one fixture per row of the blocker table
  - every row of the years-rule table
  - the ladder boundaries (2/3, 4/5, 7/8)
  - the penalty cap (6 gaps → −2)
  - direction absent vs present
- **`candidate-state.test.ts`:** every role's header line survives when one role is very long; dates are always present.
- **`verify.test.ts`:** the full-description and teaser examples.
- **`eligibility.test.ts`:**
  - an EU (non-IE) citizen: GB not covered
  - an IE citizen: GB covered
  - an expired visa
  - remote-anywhere
  - a pay range that straddles the floor
  - a currency with no floor
