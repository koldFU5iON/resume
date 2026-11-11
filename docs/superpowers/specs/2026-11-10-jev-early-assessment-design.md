# Early Job Assessment (Jev) — Design Spec

**Plan:** `docs/superpowers/plans/2026-11-10-jev-early-assessment.md`
**Status:** Question wording tested against `jev-1.14.0` in three rounds on 12 real applications (anonymised below) plus synthetic probes. Reviewed against the TypeSafe skill (`typesafe@typesafe-ai` v0.6.2) and Jev's [jaggedness page](https://docs.typesafe.ai/go/jaggedness.md). This spec fixes the wording and the combination rules the plan leaves open. Where it differs from the plan, **the spec wins**.

---

## 1. What the prototype showed, and what changed

**Setup.**
- Verify + judge ran on the 12 most recent applications from one real account.
- A person did the facts step by hand, following §3's rules, because no cheap-model key was available locally. Everything else is real Jev output.
- The candidate was the account's master CV: its full dated history (8 roles, 2007–now), with the contact header removed.

| Finding | Evidence | Change |
|---|---|---|
| **The candidate state must include the full dated history** | A profile cut to 12k of 56k chars showed Jev only the latest role. Years fell to ~1.5 everywhere, and one role scored weak 2 instead of pursue 6. | §4.2 `buildCandidateState`: every role, dates always kept, each role's text capped. Never truncate the whole text from the end. |
| **Contact details don't belong in the state** | They're irrelevant to every question (extra detail lowers accuracy), and they're personal data | `buildCandidateState` drops name, email, phone, links and address. Only the country is kept, and only through `eligibility`. |
| Verify separates real postings from teasers cleanly | Full descriptions 0.86–0.97; a LinkedIn-style teaser 0.06 | None. Pass at ≥ 0.7. |
| **"Any must-have below 0.3 is a hard blocker" blocks far too much** | The first run marked 7 of 12 Blocked, mostly from "N+ years in X" or tool-skill lines | Only **credential** must-haves block outright. Years requirements use the **years rule** (§5). Other experience or skill must-haves below 0.3 are **major gaps**: −0.5 each, at most −2, shown red, no block. |
| **Years: Jev judges each role, code does the arithmetic** | Jev is documented as weak at date maths and counting. A single "how many years" bucket happened to land well (5–8 for PM), but it relies on exactly that weakness. | One **share question per role**: how much of the role was this work. Code adds up the dated months (§5). |
| **Use the probability spread, ask both option orders, count only roles where the work was at least about half** | Using only the top answer was unstable: PM came out 9.6 in one run and 5.9 in the next, and one area flipped warn → block when the options were reversed. The probability-weighted share, averaged over both orders, moved ≤ 0.5 yrs between orders. Giving every role partial credit gave ~9.8 yrs of PM, about 2× the account owner's own estimate (~5). Counting only roles where the work was at least about half gave **5.9**. | Share = probability-weighted, averaged over both orders. A role counts only when its share ≥ 0.5. |
| **A years block shouldn't ignore transferable experience** | The Brand Ops role came out at ~2.0 yrs vs 5 required, but the CV as a whole shows the core work done under other titles. A capability question scored brand/creative ops 0.82, biz ops 0.92, PM 0.98. Negative controls: auditing 0.02, paid UA 0.05, software engineering 0.50. | Every years requirement also gets a **capability** question over the whole CV. A years **block** with capability ≥ 0.7 becomes a **stretch** (amber), not Blocked (§5). |
| **Split bundled requirements** | "Hands-on across performance marketing, influencers, community, partnerships and brand/PR" scored 0.22 as one question. Split: brand/PR 0.96, partnerships 0.50, influencers 0.44, community 0.38, performance 0.16. | Facts lists `parts` for "all of these" lines. One question per part; code takes the mean. "Or" alternatives are **not** split. |
| **Split the sponsorship option that covered two statements** | `not_offered` and `right_to_work_required` are now separate options. All 4 synthetic cases were classified correctly in both option orders, and real "with the right to work there" lines → `right_to_work_required`. | Both options are hard blockers when the user isn't covered |
| Jev's confidence figure isn't a correctness gate | Per the TypeSafe skill: confidence measures how concentrated the answer is, not whether it's correct | The "low confidence" badge is dropped. Instead, **unsettled** = must-haves with `0.3 ≤ p < 0.7`, listed as "check these". |
| Credential checks work as intended (**Changed in early-v2:** education no longer hard-blocks; it is an amber "Education asked for" blocker plus a penalty item) | "BSc in Computer Science" vs a diploma: 0.06 → blocked. "…or equivalent practical experience": 0.73 → met | None |
| Relocation is a separate case from work rights | 3 of 12 roles must be *based in* IE or UK, or on-site in Dublin; the candidate lives in FR with full EU work rights | New check, `relocation`: **unconfirmed** unless the job's country is one of the user's target countries. Needs `eligibility.currentCountry`. |
| Availability lines can't be judged from a profile | "Availability to travel" can't be shown or disproved by a CV | Requirement kind `availability`: never asked as a requirement question, only matched against dealbreakers |
| The description often has no location | 6 of 12 gave no location | Facts falls back to the job row's `countries`. If still unknown, skip the work-rights and relocation checks and show "Location unknown". |
| Cost and latency are negligible | 6–10k input tokens per job (verify + judge, years included). Each call took 150–420 ms, and calls run in parallel. All three test rounds together cost < $0.02. | Budget ~$0.0005 per assessment |
| Contract roles need a flag | 1 of 12 was a 12-month contract | Facts adds `employmentType`; dealbreakers can match it |
| Results need to be replayable | The skill recommends keeping the exact payload | `JobAssessment.request` stores the Jev request bodies (Postgres compresses large JSON) |

---

## 2. Eligibility profile (search-profile `eligibility`)

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

**Model:** `FAST_MODELS[provider]` (Anthropic: `claude-haiku-5-5`), `temperature: 0`, `maxOutputTokens: 1600`.

```ts
JobFactsSchema = z.object({
  requirements: z.array(z.object({
    text: z.string().max(220),
    kind: z.enum(['education','certification','licence','clearance','language','experience','skill','availability']),
    importance: z.enum(['must','nice']),
    years: z.object({ min: z.number().positive(), area: z.string().max(160) }).nullable(),
    parts: z.array(z.string().max(80)).max(6).nullable(),   // only for "all of these" lists
  })).max(14),
  location: z.object({
    countries: z.array(z.string().length(2)),
    mode: z.enum(['onsite','hybrid','remote_in_country','remote_region','remote_anywhere','unknown']),
    basedInRequired: z.boolean(),
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
  one per clause. If a line gives a total plus a specific ("8+ years of relevant experience, including 6+ in
  strategy…"), keep only the specific clause.
- parts: when a requirement asks for several distinct things that must ALL be present ("hands-on across A,
  B, C and D", "strong in A, B and C"), list each thing as a short noun phrase. Do not split alternatives
  joined by "or" ("consulting, strategy or operations"): those are one requirement with parts = null.
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

All wording lives in `src/modules/job-assessment/questions.ts`.

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

### 4.2 Judge — one request, state `{ candidate, job, preferences? }`

**`buildCandidateState(snapshot)`** builds this structure:

```ts
candidate: {
  summary: string,                        // headline + profile summary, ≤ 600 chars
  roles: {                                // newest first, stable keys
    role_1: { title, company, dates: 'Jul 2024 – present', description },   // description ≤ 1,200 chars, cut at a sentence end
    role_2: { … }, …
  },
  education: string[], certifications: string[], languages: string[],
  skills: Record<string, string[]>,       // grouped by category
}
```

- No name, email, phone, links or street address.
- `dates` is text, for people to read. Jev is never asked to do date maths on it.
- Structured roles let the years questions point at `` `candidate.roles.role_3` `` by path, so years questions and the other judge questions share one state and one request.
- **Target:** ≤ 8k tokens.

**Other state:**
- `job` = `{ title, company, description }`.
- `preferences` is included only when `direction_fit` or `remote_match` is asked, so it can't sway the other questions.

Requirements of kind `availability` are not asked.

**Requirement** (no `years`, no `parts`). Tested. Id `req_<i>`:

```json
{ "type": "noul",
  "instructions": "The candidate described in `candidate` meets this job requirement: \"<text>\"",
  "criteria": {
    "true": "The profile shows the requirement is met, directly or through an alternative the requirement itself allows (e.g. \"or equivalent experience\", \"or related field\", \"or similar\").",
    "false": "The profile does not show it, shows only a lower level (e.g. a diploma where a degree is required, fewer years than stated), or shows it only partially." } }
```

**Requirement part.** Tested. Id `req_<i>_part_<n>`:

```json
{ "type": "noul",
  "instructions": "The candidate described in `candidate` has hands-on experience with <part>.",
  "criteria": {
    "true": "The profile shows the candidate doing <part> themselves as part of a role.",
    "false": "The profile does not show the candidate doing <part>, or only mentions it in passing." } }
```

**Years: role share.** Tested.
- One question per role, per years requirement.
- Each is asked **twice**: id `req_<i>_<roleKey>_a` with the options in the order below, and `_b` with the order reversed.

```json
{ "type": "choice",
  "instructions": "How much of the role `candidate.roles.<roleKey>` was spent doing this kind of work: <area>?",
  "criteria": {
    "most_of_the_role": "This work was the main focus of the role, most of the time.",
    "about_half": "This work was a regular, major part of the role, roughly half of it.",
    "small_part": "This work came up occasionally or was a minor part of the role.",
    "none": "The role did not involve this work." } }
```

**Years: capability.** Tested.
- One per years requirement, id `req_<i>_capability`.
- It's always asked, in the same request; code reads it only when the years rule says block.

```json
{ "type": "noul",
  "instructions": "The person in `candidate` has done the core work of <area>, in any of their roles and under any job title.",
  "criteria": {
    "true": "The CV shows them regularly doing the main tasks of <area> themselves, even if it was part of a role with a different title.",
    "false": "The CV shows only related or adjacent work, or mentions <area> only in passing." } }
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
    "instructions": "What does `job.description` say about visa sponsorship or the right to work?",
    "criteria": {
      "offered": "The description says visa sponsorship or work-permit support is available.",
      "not_offered": "The description says visa sponsorship is not available.",
      "right_to_work_required": "The description says candidates must already have the right to work in the country.",
      "not_mentioned": "The description says nothing about sponsorship, visas or the right to work." } }
}
```

**Conditional questions.** Not yet tested; test in Phase 3:

```json
{
  "direction_fit": { "type": "score",
    "instructions": "How well does the role in `job` fit the direction in `preferences` (target roles, career goals, career-change context)?",
    "criteria": [ "The role moves away from the stated direction.", "The role is neutral: neither towards nor away from the stated direction.",
                  "The role is adjacent to a target role or goal.", "The role is a target role or directly serves a stated goal." ] },
  "remote_match": { "type": "noul",
    "instructions": "The working pattern of the role in `job` (onsite, hybrid or remote) fits `preferences.remotePreference`." },
  "dealbreaker_<i>": { "type": "noul",
    "instructions": "The role in `job` involves this: \"<dealbreaker>\"",
    "criteria": { "true": "The description states or clearly implies it.", "false": "The description does not mention it, and nothing in it implies it." } }
}
```

| Question | Asked when |
|---|---|
| `direction_fit` | The search profile has target roles, career goals or career-change context |
| `remote_match` | `remotePreference` is set |
| `sponsorship` | Always. It's cheap, and storing it lets coverage rules change later without re-running Jev. |
| `dealbreaker_<i>` | One per eligibility dealbreaker |

**Before launch,** re-run `seniority_fit` with its options reversed to check that the answer doesn't lean towards the first option (a known Jev weak spot). Sponsorship has already passed this check.

---

## 5. Combine rules (`combine.ts`)

### Years (all arithmetic in code)

```
w(option)      = { most_of_the_role: 1, about_half: 0.5, small_part: 0, none: 0 }
share(role)    = mean over orders a,b of  Σ p(option) · w(option)
counts(role)   = share(role) ≥ 0.5 ? share(role) : 0
yearsInArea    = Σ over months of max over roles covering that month of counts(role) / 12
                 (months come from Profile.experiences start/end; overlapping roles count once; "present" = today)
```

| Status | Condition |
|---|---|
| **met** | est ≥ required |
| **warn** | est ≥ 0.5 × required, or required − est ≤ 2 |
| **stretch** | would be block, but `capability ≥ 0.7` |
| **block** | anything else (`capability < 0.7`: an unclear 0.3–0.7 also stays block) |

A **stretch** is amber, counts toward the penalty like a warn, and reads: "Short on years (~2.0 of 5) — strong transferable experience across your CV".

| Required | est | Result |
|---|---|---|
| 5 | 2.5 | warn |
| 10 | 2.5 | **block** |
| 8 | 6.5 | warn |
| 3 | 1.5 | warn |
| 5 | 2.0 | **block** (2.0 < 2.5 and a 3-year gap) |

- In coverage, a years requirement counts `p = min(1, est / required)`.
- The detail shows how the estimate was built, e.g. "~3.7 yrs: Senior Program Manager 2.3 + Communications Lead 0.7 + PR Manager ½ × 1.4".

### Parts

`p(requirement) = mean(p(part))`. A requirement with parts is a major gap when the mean is < 0.3.

### Blockers

| Kind | Hard (→ Blocked) | Unconfirmed / warn (amber) | Major gap (red, −0.5 each, at most −2) |
|---|---|---|---|
| Credential must-have (education, certification, licence, clearance, language) | `p < 0.3` (**Changed in early-v2:** not for education, which is amber and counts toward the penalty; work-rights lines are skipped) | — | — |
| Years must-have | years rule = **block** | years rule = **warn** or **stretch** (both count toward the penalty) | — |
| Other experience or skill must-have | — | — | `p < 0.3` |
| Work rights | Not covered and `sponsorship ∈ {not_offered, right_to_work_required}` | Not covered and `not_mentioned` | — |
| Relocation | — | `basedInRequired` / onsite, `currentCountry` not among the job's countries, and those countries not among the user's target countries | — |
| Pay | Stated `max` < floor (same currency) | `min` < floor ≤ `max` (**Changed:** only when the range's midpoint is below the floor; a single stated figure is compared as-is, and a lone `min` below the floor stays amber) | — |
| Dealbreaker | `dealbreaker_i > 0.7` | 0.3–0.7 | — |

### Score

The `direction` weight applies only when `direction_fit` was asked. When it isn't, the four weights below are used as they are; these are the ones tested. When it is: coverage 0.34, skills 0.26, seniority 0.15, domain 0.10, direction 0.15.

```
coverage  = Σ w·p / Σ w            // w: must 2, nice 1
skills    = skills_match.score / 4
domain    = domain_fit.score / 3
seniority = Σ p(option) · {match 1, below/above 0.6, well_below/well_above 0.2}
composite = 0.40·coverage + 0.30·skills + 0.18·seniority + 0.12·domain
          − 0.05 if the stated max pay < target
raw       = 1 + 9·composite
penalty   = min(2, 0.5 · (major gaps + years warnings + years stretches))
score     = clamp(round(raw − penalty), 1, 10)
level     = 1–2 weak · 3–4 consider · 5–7 pursue · 8–10 priority
display   = "Blocked · {score}/10" if any hard blocker, else the level
```

### Detail contents

| Section | What goes in it |
|---|---|
| Blockers | Hard first, then unconfirmed |
| Strengths | Up to 3 must-haves with `p ≥ 0.7`, plus met years requirements with their estimate |
| Gaps | Years warnings with their breakdown, then major gaps |
| Check these | Unsettled must-haves (`0.3 ≤ p < 0.7`) |

---

## 6. Worked examples (round 3, anonymised)

The test eligibility was an EU (non-Irish) citizen based in FR, with a EUR floor of 90k (target 100k) and a GBP floor of 85k. The candidate was the master CV without its contact header.

**Spread:** 2 consider · 8 pursue · 2 priority, none Blocked.

| # | Role (sector) | Location / terms | Result | Flags |
|---|---|---|---|---|
| 1 | Agency business-excellence manager (social platform) | not stated | **priority 8** | — |
| 2 | EMEA business manager (cloud infrastructure) | not stated | **priority 8** | — |
| 3 | Senior program manager (risk data) | Paris or London, €78k–129.8k | pursue 7 | pay: range straddles floor (clear under the midpoint rule) · 1 unsettled |
| 4 | Senior manager, marketing operations Europe (streaming) | hybrid, not stated | pursue 7 | 2 unsettled |
| 5 | Business manager, GTM (HR-tech) | remote anywhere | pursue 7 | years warn: 5+ biz ops / chief of staff, ~3.7 |
| 6 | Strategy & ops lead, applied AI (US healthcare marketplace) | remote, US | pursue 7 | work rights: US, not mentioned |
| 7 | Program manager, IP operations (social platform) | not stated | pursue 7 | — |
| 8 | Director of corporate communications (streaming) | hybrid, not stated | pursue 6 | 3 unsettled |
| 9 | Program manager, marketing lead generation (building tech) | hybrid, not stated | pursue 6 | 1 major gap |
| 10 | Principal program manager, 12-month contract (games) | onsite Dublin | pursue 5 | years warn: 6+ strategy/biz ops, ~4.2 · 1 major gap · relocation · contract |
| 11 | Head of growth (browser games start-up) | UK/IE only, remote | consider 3 | 3 major gaps · 3 unsettled · relocation |
| 12 | Brand operations manager (salon SaaS) | IE, remote in country | consider 4 | years stretch: 5+ brand/creative ops/DAM, ~2.0, capability 0.82 · 2 major gaps · relocation |

**Example 5 → pursue 7, years warning.** For "5–8 years in business operations, chief of staff, strategy consulting or similar", only the two most recent roles count:

| Role | Share | Years counted |
|---|---|---|
| Senior Program Manager | most of the role | 2.3 |
| Communications Lead | most of the role | 0.7 |
| International PR Manager | about half | ½ × 1.4 = 0.7 |
| Earlier PR and comms roles | below half | 0 |
| **Total** | | **~3.7** |

3.7 ≥ 2.5, so **warn**. The other must-haves are met at 0.81–0.95.

**Example 12 → consider 4, years stretch.** "5+ years in brand operations, creative operations or DAM" → ~2.0 years: the latest two roles at about two-thirds each; the rest below half. 2.0 < 2.5 and the gap is 3 years, so the years rule says **block**. Capability across the whole CV is 0.82, so it becomes a **stretch**: amber, −0.5, "Short on years (~2.0 of 5) — strong transferable experience across your CV". The account owner agreed: short on brand-titled years, but has done the work. The detail also shows two major gaps: DAM system expertise 0.20, and Notion 0.08 / Looker 0.05. With capability below 0.7, the same job would show **Blocked · 4**.

**Example 11 → consider 3.** Both years requirements are met: games/consumer marketing ~17.9, leading a marketing function ~8.4. Three major gaps:

| Must-have | Score |
|---|---|
| Scaling track record | 0.18 |
| Budget ownership | 0.15 |
| Analytics (attribution 0.22 / incrementality 0.08 / cohorts 0.12 / LTV 0.10) | mean 0.13 |

The bundled "hands-on across…" line is now split. Brand/PR at 0.96 lifts its mean to 0.49, so it's "check these" rather than a false major gap.

**Example 6 → pursue 7, amber work-rights flag.** A strong functional match (0.72–0.93), but the role is US-based and the description says nothing on sponsorship. **This application was rejected.** The flag is the early warning the pipeline should give. (Location was inferred by the person standing in for the facts step; the cheap model needs the row's `countries` hint to get this reliably.)

**Synthetic cases:**

| Case | Result |
|---|---|
| A job needs 5 years, the candidate has ~2.5 | warn |
| A job needs 10+ years, the candidate has ~2.5, capability < 0.7 | **Blocked** |
| The same, capability ≥ 0.7 | stretch |
| "BSc in Computer Science" vs a diploma | 0.06 → **Blocked** |
| "…or equivalent practical experience" vs the same diploma | 0.73 → met |
| LinkedIn preview | `is_full_description` 0.06 → **Needs attention** |
| "Must have the right to work in the UK", "unable to offer visa sponsorship", "we offer visa sponsorship", nothing said | `right_to_work_required`, `not_offered`, `offered`, `not_mentioned`, the same in both option orders |

---

## 7. Calibration notes and open items

- **The "at least about half" counting rule is calibrated on one data point:** the account owner's ~5 yrs of PM vs 5.9 estimated. It's a defensible definition (roles where the work was a major part), but check it during the side-by-side. The alternative (every role gets its share) gave 4.8 / 6.5 / 7.1 instead of 2.0 / 3.7 / 4.2 on the three affected requirements, and no block.
- **Capability is a judgment, not a measurement.** It decides only whether a years block becomes a stretch; it never raises the score. Watch for adjacent areas reading as capable. Strategy/financial planning scored 0.78 while the CV's financial-modelling parts scored 0.10–0.23; the parts still show as a major gap. Software engineering at 0.50 correctly stays Blocked.
- **Broad "or" areas count almost everything,** e.g. "consulting, strategy, operations, or program management" → ~16 yrs. That's the description's own breadth, read literally. It's correct to count it as met.
- **There's no manual override of years yet.** The fix for a wrong estimate is a clearer experience entry. Add per-area overrides to `eligibility` later if needed.
- **Nice-to-have degrees never block.** They only lower coverage.
- **`direction_fit`, `remote_match` and dealbreakers haven't been tested.** Test them in Phase 3 against real preferences.
- **The old `jobFit` scores aren't in this comparison.** The in-app side-by-side (Phase 4) and `assess:compare` (Phase 5) cover that.
- **Thresholds and weights are first guesses.** All of them live in `ASSESSMENT_CONFIG`; bump `PIPELINE_VERSION` on any change. Per the TypeSafe skill, don't fit thresholds to individual cases, and don't write tests that assert exact probabilities from the live API.

---

## 8. Test fixtures

- **`combine.test.ts`** uses the round-3 signal values (anonymised). It also covers:
  - one fixture per row of the blocker table
  - every row of the years table, including block → stretch at capability 0.69 / 0.70
  - the ladder boundaries (2/3, 4/5, 7/8)
  - the penalty cap (6 → −2)
  - direction absent vs present
  - a parts mean below and above 0.3
- **`years.test.ts`:**
  - overlapping roles count once
  - "present" end dates
  - a share just under and just over 0.5
  - averaging across the two option orders
- **`candidate-state.test.ts`:**
  - every role is present even when one role is very long
  - dates are kept
  - no email, phone, URL or name appears
- **`verify.test.ts`:** the full-description and teaser examples.
- **`eligibility.test.ts`:**
  - an EU (non-IE) citizen: GB not covered
  - an IE citizen: GB covered
  - an expired visa
  - remote-anywhere
  - a pay range that straddles the floor (midpoint rule)
  - a currency with no floor
