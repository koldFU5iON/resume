# Early Job Assessment (Jev) — Design Spec

**Plan:** `docs/superpowers/plans/2026-11-10-jev-early-assessment.md`
**Status:** Question wording tested against `jev-1.14.0` on 12 real applications (anonymised below) plus synthetic probes. This spec fixes the wording and the combination rules the plan leaves open. Where it differs from the plan, **the spec wins**; the changes are listed in §1.

---

## 1. What the prototype showed, and what changed

A test run of verify + judge on the 12 most recent applications from one real account. A person did the facts step by hand, following §3's rules, because no cheap-model key was available locally. Everything else is real Jev output.

| Finding | Evidence | Change |
|---|---|---|
| Verify separates real postings from teasers cleanly | Full descriptions scored 0.86–0.97 on `is_full_description`; a LinkedIn-style teaser scored 0.06 | None. Pass at ≥ 0.7. |
| **"Every must-have below 0.3 is a hard blocker" blocks far too much** | 7 of 12 applications came out Blocked, almost all from "N+ years in X" or tool-skill must-haves | Only **credential** must-haves block (education, certification, licence, clearance, language). An experience or skill must-have below 0.3 is a **major gap**: −0.5 score each, at most −2. It shows red in the detail but doesn't block. |
| Credential checks work as intended | "BSc in Computer Science" vs a diploma: 0.06 → blocked. "…or equivalent practical experience": 0.73 → met | None |
| Relocation is a separate case from work rights | 3 of 12 roles must be *based in* IE or UK, or on-site in Dublin, but the candidate lives in FR with full EU work rights | New check, `relocation`: **unconfirmed** unless the job's country is one of the user's target countries. Needs `eligibility.currentCountry`. |
| Availability lines can't be judged from a profile | "Availability to travel" scored 0.33; the profile can't say either way | New requirement kind, `availability`. It's never asked as a requirement question; it's only matched against dealbreakers. |
| The description often has no location | 6 of 12 gave no location | Facts falls back to the job row's `countries`. If still unknown, skip the work-rights and relocation checks and show "Location unknown". |
| Sponsorship wording is read correctly | "Must have the right to work in the UK" → `explicitly_not_offered` 1.00; "we offer visa sponsorship" → `offered` 0.99; nothing said → `not_mentioned` 1.00 | None |
| Cost and latency are negligible | 5.7k–8.9k input tokens per job (verify + judge). Each call took 150–300 ms, and the two run in parallel | Budget about $0.0003 per assessment |
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

**Model:** `FAST_MODELS[provider]` (Anthropic: `claude-haiku-5-5`), `temperature: 0`, `maxOutputTokens: 1200`.

**Schema** (it replaces the plan's version):

```ts
JobFactsSchema = z.object({
  requirements: z.array(z.object({
    text: z.string().max(220),
    kind: z.enum(['education','certification','licence','clearance','language','experience','skill','availability']),
    importance: z.enum(['must','nice']),
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

`candidate` is `serializeProfileForLLM(snapshot)` (about 3k tokens in the test). Requirements of kind `availability` are not asked.

**Requirement template.** Tested. One per requirement, id `req_<i>`:

```json
{ "type": "noul",
  "instructions": "The candidate described in `candidate` meets this job requirement: \"<text>\"",
  "criteria": {
    "true": "The profile shows the requirement is met, directly or through an alternative the requirement itself allows (e.g. \"or equivalent experience\", \"or related field\", \"or similar\").",
    "false": "The profile does not show it, shows only a lower level (e.g. a diploma where a degree is required, fewer years than stated), or shows it only partially." } }
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

### Blockers

| Kind | Hard (→ Blocked) | Unconfirmed (amber) | Major gap (red, −0.5 each, at most −2) |
|---|---|---|---|
| Credential must-have (education, certification, licence, clearance, language) | `req < 0.3` | — | — |
| Experience or skill must-have | — | — | `req < 0.3` |
| Work rights | Not covered and `sponsorship = explicitly_not_offered` | Not covered and `not_mentioned` | — |
| Relocation | — | `basedInRequired` / onsite, `currentCountry` not among the job's countries, and those countries not among the user's target countries | — |
| Pay | Stated `max` < floor (same currency) | `min` < floor ≤ `max` | — |
| Dealbreaker | `dealbreaker_i > 0.7` | 0.4–0.7 | — |

### Score

The `direction` weight applies only when `direction_fit` was asked. When it isn't, the four weights below are used as they are; these are the ones tested. When it is: coverage 0.34, skills 0.26, seniority 0.15, domain 0.10, direction 0.15.

```
coverage  = Σ w·req / Σ w          // w: must 2, nice 1 (availability excluded)
skills    = skills_match.score / 4
domain    = domain_fit.score / 3
seniority = Σ p(option) · {match 1, below/above 0.6, well_below/well_above 0.2}
composite = 0.40·coverage + 0.30·skills + 0.18·seniority + 0.12·domain
          − 0.05 if the stated max pay < target
raw       = 1 + 9·composite
score     = clamp(round(raw − min(2, 0.5 · majorGaps)), 1, 10)
level     = 1–2 weak · 3–4 consider · 5–7 pursue · 8–10 priority
display   = "Blocked · {score}/10" if any hard blocker, else the level
```

### Detail contents

| Section | What goes in it |
|---|---|
| Strengths | Up to 3 must-haves with `req ≥ 0.7`, highest first |
| Gaps | Requirements with `0.3 ≤ req < 0.7`, plus major gaps (marked) |
| Low confidence | Shown when the mean confidence of the rubric and choice answers is < 0.5 (1 of 12 in the test) |

---

## 6. Worked examples (real runs, anonymised)

The test eligibility was an EU (non-Irish) citizen based in FR, with a EUR floor of 90k (target 100k) and a GBP floor of 85k. Requirement scores are Jev's raw `req` values. "Major gap" uses §5's rules. Scores are recomputed with §5's exact formula from the stored Jev answers.

Spread: 2 weak · 2 consider · 7 pursue · 1 priority, and none Blocked: no job had a credential, pay-floor or sponsorship blocker.

| # | Role (sector) | Location / terms | Score | Level | Flags |
|---|---|---|---|---|---|
| 1 | Agency business-excellence manager (social platform) | not stated | 8 | **priority** | — |
| 2 | Senior program manager (risk data) | Paris or London, €78k–129.8k | 7 | pursue | pay: range straddles floor |
| 3 | EMEA business manager (cloud infrastructure) | not stated | 7 | pursue | — |
| 4 | Program manager, IP operations (social platform) | not stated | 6 | pursue | — |
| 5 | Business manager, GTM (HR-tech, remote anywhere) | remote anywhere | 6 | pursue | 1 major gap |
| 6 | Senior manager, marketing operations Europe (streaming) | hybrid, not stated | 6 | pursue | 1 major gap |
| 7 | Strategy & ops lead, applied AI (US healthcare marketplace) | remote, US | 6 | pursue | work rights: US, not mentioned |
| 8 | Brand operations manager (salon SaaS) | IE, remote in country | 5 | pursue | 2 major gaps · relocation |
| 9 | Program manager, marketing lead generation (building tech) | hybrid, not stated | 4 | consider | 3 major gaps |
| 10 | Principal program manager, 12-month contract (games) | onsite Dublin | 4 | consider | 2 major gaps · relocation · contract |
| 11 | Director of corporate communications (streaming) | hybrid, not stated | 2 | weak | 3 major gaps |
| 12 | Head of growth (browser games start-up) | UK/IE only, remote | 1 | weak | 6 major gaps · relocation |

**Example 1 → priority 8/10.** Four broad must-haves, all met: business/programme management 0.98, planning and risk 0.92, English communication 0.86, data reporting 0.83. Skills 2.40/4, seniority mostly `match`. A clean, high-coverage fit.

**Example 2 → pursue 7/10, amber pay flag.** Must-haves met at 0.64–0.87. Seniority `match` 0.99. The nice-to-have "8+ years of progressive PM experience" is 0.18, so it lowers coverage but isn't a gap, because the description says fewer years can be considered. The salary range €78k–129.8k straddles the 90k floor, so it's unconfirmed: worth applying, but confirm the band early.

**Example 7 → pursue 6/10, amber work-rights flag.** A good functional match: technical fluency 0.72, execution 0.90, systems thinking 0.93. The company is a US marketplace whose remote roles are in effect US-based, and the description says nothing about sponsorship. **This application was rejected.** The flag is exactly the early warning the pipeline should give. (Location was inferred by the person standing in for the facts step; the cheap model needs the row's `countries` hint to get this reliably.)

**Example 11 → weak 2/10.** "12+ years of hands-on leadership in corporate communications" 0.12, "existing book of media contacts" 0.14, "experience working closely with C-suite" 0.23. Those three major gaps take the raw 3.8 down to 2. Seniority is `above`/`well_above`. "Availability to travel" is kind `availability`, so it isn't asked. Under the plan's original rule it would have shown Blocked; now it's a clear "weak" with the reasons listed, not a blocker.

**Example 12 → weak 1/10.** 6 of 7 must-haves between 0.11 and 0.19 (growth/UA track record, budget ownership, attribution and LTV analytics), and seniority is `well_above` 0.79. Raw 3, minus the −2 cap. Relocation is also flagged: the role is UK/IE only and the candidate is in FR.

**Synthetic credential blocker:** "BSc in Computer Science" vs "Diploma in Multimedia Design": `req` 0.06 → **Blocked**. The same candidate against "BSc in CS *or equivalent practical experience*": 0.73 → met.

**Synthetic verify failure:** a LinkedIn preview ("…See more. Sign in to view more jobs"): `is_full_description` 0.06, `has_requirements` 0.24 → **Needs attention: Description looks incomplete or truncated**.

---

## 7. Calibration notes and open items

- **Years in a named function are read strictly.** "5+ years in consulting, strategy, operations or PM" scored 0.30 for a profile with about 2 years under a PM title and longer prior experience in adjacent work. That's how a recruiter screens, so it counts as a major gap, not a blocker. Watch this in the side-by-side; the lever is the −0.5 per gap.
- **Bundled requirements score low.** A line like "hands-on across performance marketing, influencers, community, partnerships and brand/PR" scores low when only some parts are met. The facts prompt keeps the description's wording; splitting compound lines is a possible v2 change. Check whether this causes false major gaps in practice.
- **Nice-to-have degrees never block.** They scored 0.10–0.32 in the test and only lowered coverage, as intended.
- **`direction_fit` and `remote_match` haven't been tested,** because the search profile wasn't available through the test path. Test both against real preferences in Phase 3.
- **The old `jobFit` scores aren't in this comparison.** The MCP read path doesn't return them. The in-app side-by-side (Phase 4) and `assess:compare` (Phase 5) cover that.
- **Thresholds and weights are first guesses.** All of them live in `ASSESSMENT_CONFIG`; bump `PIPELINE_VERSION` on any change.

---

## 8. Test fixtures

- `combine.test.ts` uses fixtures built from the §6 runs: the signal values only, with roles anonymised.
- One fixture per row of the blocker table.
- The ladder boundaries (2/3, 4/5, 7/8).
- The gap cap (6 gaps → −2).
- Direction absent vs present.
- `verify.test.ts` covers the full and teaser examples.
- `eligibility.test.ts` covers an IT citizen (GB not covered), an IE citizen (GB covered), an expired visa, remote-anywhere, a straddling pay range, and a currency with no floor.
