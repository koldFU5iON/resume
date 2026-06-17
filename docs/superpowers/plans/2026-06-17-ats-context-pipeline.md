# ATS Context Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ATS keyword context stage to the CV generation pipeline that extracts ATS-parseable terms from the job description, cross-references them against the candidate's full profile, and injects a verified keyword uplift block into the generation prompt so the LLM uses the right vocabulary.

**Architecture:** A new `buildATSContext()` function runs after `analyseJob`/`scoreEvidence` and before the final generation LLM call. It makes a single cheap structured LLM call that classifies JD keywords as `supported` (in profile), `adjacent` (transferable), or `absent` (no basis). The result is formatted as an `== ATS KEYWORD UPLIFT ==` block injected into the user message. The call is non-fatal — if it throws, generation continues without it. The full unfiltered profile snapshot (not the evidence-scored one) is used for matching so all declared skills/tools are considered. `cv-generate.md` gains explicit `skills` vs `tools` routing rules.

**Tech Stack:** TypeScript strict, Zod v3, `completeStructured` from `@/modules/llm/client`, Vitest for tests. No DB migration required.

---

## File map

| File | Action | Purpose |
|------|--------|---------|
| `src/modules/cv/ats-context-schema.ts` | Create | Zod schema + TS types for the ATS context LLM output |
| `src/modules/cv/ats-context.ts` | Create | `buildATSContext()` LLM call + `formatATSContext()` pure helper |
| `src/modules/cv/ats-context.test.ts` | Create | Unit tests for schema parsing + `formatATSContext` |
| `src/lib/prompts/cv-ats-context.md` | Create | System prompt for the keyword classification call |
| `src/modules/llm/prompt-context.ts` | Modify | Add `loadATSContextPrompt()` loader |
| `src/modules/cv/generate.ts` | Modify | Wire `buildATSContext` into pipeline; inject formatted block |
| `src/lib/prompts/cv-generate.md` | Modify | Add `skills` vs `tools` rule + ATS Keyword Uplift instructions |
| `src/app/dashboard/settings/usage/_components/usage-log.tsx` | Modify | Register `'ats-context'` in `FEATURE_LABELS` |

---

## Task 1: ATS context schema and types

**Files:**
- Create: `src/modules/cv/ats-context-schema.ts`

- [ ] **Step 1: Create the schema file**

```typescript
// src/modules/cv/ats-context-schema.ts
import { z } from 'zod'

export const ATSKeywordSchema = z.object({
  term: z.string(),
  category: z.enum(['tool', 'skill', 'methodology', 'certification', 'role-title']),
  profileEvidence: z.string().nullable(),
})

export const ATSContextSchema = z.object({
  supported: z.array(ATSKeywordSchema).describe(
    'Keywords the candidate has direct profile evidence for — use these exact terms',
  ),
  adjacent: z.array(ATSKeywordSchema).describe(
    'Keywords the candidate can credibly claim via transferable experience',
  ),
  absent: z.array(z.string()).describe(
    'Keywords with no profile basis — never suggest these',
  ),
})

export type ATSKeyword = z.infer<typeof ATSKeywordSchema>
export type ATSContextResult = z.infer<typeof ATSContextSchema>
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/cv/ats-context-schema.ts
git commit -m "feat(ats-context): add ATSContextSchema and types"
```

---

## Task 2: Write tests for schema and format helper

**Files:**
- Create: `src/modules/cv/ats-context.test.ts`

These tests cover both `ATSContextSchema` (Task 1) and `formatATSContext` (Task 3). Write them all now so Task 3 has a clear green target.

- [ ] **Step 1: Write the test file**

```typescript
// src/modules/cv/ats-context.test.ts
import { describe, it, expect } from 'vitest'
import { ATSContextSchema } from './ats-context-schema'
import { formatATSContext } from './ats-context'

describe('ATSContextSchema', () => {
  it('parses a valid result with all three buckets', () => {
    const result = ATSContextSchema.parse({
      supported: [{ term: 'Salesforce', category: 'tool', profileEvidence: 'Salesforce (skill, expert)' }],
      adjacent: [{ term: 'HubSpot', category: 'tool', profileEvidence: 'Strong CRM background' }],
      absent: ['SAP'],
    })
    expect(result.supported[0].term).toBe('Salesforce')
    expect(result.adjacent[0].term).toBe('HubSpot')
    expect(result.absent[0]).toBe('SAP')
  })

  it('accepts null profileEvidence', () => {
    const result = ATSContextSchema.parse({
      supported: [{ term: 'Agile', category: 'methodology', profileEvidence: null }],
      adjacent: [],
      absent: [],
    })
    expect(result.supported[0].profileEvidence).toBeNull()
  })

  it('accepts empty arrays in all buckets', () => {
    const result = ATSContextSchema.parse({ supported: [], adjacent: [], absent: [] })
    expect(result.supported).toHaveLength(0)
    expect(result.adjacent).toHaveLength(0)
    expect(result.absent).toHaveLength(0)
  })

  it('rejects unknown category values', () => {
    expect(() =>
      ATSContextSchema.parse({
        supported: [{ term: 'X', category: 'unknown', profileEvidence: null }],
        adjacent: [],
        absent: [],
      }),
    ).toThrow()
  })
})

describe('formatATSContext', () => {
  it('always includes the ATS KEYWORD UPLIFT header', () => {
    const output = formatATSContext({ supported: [], adjacent: [], absent: [] })
    expect(output).toContain('== ATS KEYWORD UPLIFT ==')
  })

  it('lists supported terms with category and evidence', () => {
    const output = formatATSContext({
      supported: [{ term: 'Salesforce', category: 'tool', profileEvidence: 'CRM expert, 4y' }],
      adjacent: [],
      absent: [],
    })
    expect(output).toContain('SUPPORTED')
    expect(output).toContain('- Salesforce [tool] — CRM expert, 4y')
  })

  it('lists adjacent terms with evidence', () => {
    const output = formatATSContext({
      supported: [],
      adjacent: [{ term: 'HubSpot', category: 'tool', profileEvidence: 'Strong CRM background via Salesforce' }],
      absent: [],
    })
    expect(output).toContain('ADJACENT')
    expect(output).toContain('- HubSpot [tool] — Strong CRM background via Salesforce')
  })

  it('omits SUPPORTED section when supported is empty', () => {
    const output = formatATSContext({ supported: [], adjacent: [], absent: ['SAP'] })
    expect(output).not.toContain('SUPPORTED')
  })

  it('omits ADJACENT section when adjacent is empty', () => {
    const output = formatATSContext({
      supported: [{ term: 'Agile', category: 'methodology', profileEvidence: null }],
      adjacent: [],
      absent: [],
    })
    expect(output).not.toContain('ADJACENT')
  })

  it('handles null profileEvidence without printing "null"', () => {
    const output = formatATSContext({
      supported: [{ term: 'Agile', category: 'methodology', profileEvidence: null }],
      adjacent: [],
      absent: [],
    })
    expect(output).toContain('- Agile [methodology]')
    expect(output).not.toContain('null')
  })

  it('never mentions the absent list in the output', () => {
    const output = formatATSContext({
      supported: [],
      adjacent: [],
      absent: ['SAP', 'Oracle'],
    })
    expect(output).not.toContain('SAP')
    expect(output).not.toContain('Oracle')
  })
})
```

- [ ] **Step 2: Run tests — expect failures for `formatATSContext` (module doesn't exist yet)**

```bash
npx vitest run src/modules/cv/ats-context.test.ts
```

Expected: `ATSContextSchema` tests pass; `formatATSContext` tests fail with `Cannot find module './ats-context'`.

- [ ] **Step 3: Commit the test file**

```bash
git add src/modules/cv/ats-context.test.ts
git commit -m "test(ats-context): add schema and formatATSContext tests"
```

---

## Task 3: System prompt + prompt loader

**Files:**
- Create: `src/lib/prompts/cv-ats-context.md`
- Modify: `src/modules/llm/prompt-context.ts`

The `src/lib/prompts/*.md` glob is already registered in `outputFileTracingIncludes` in `next.config.ts` — no config change needed.

- [ ] **Step 1: Create the system prompt**

```markdown
<!-- src/lib/prompts/cv-ats-context.md -->
# ATS Keyword Context Analysis

You are an ATS (Applicant Tracking System) keyword analyst.

Given a job description and a candidate profile, extract the terms that ATS systems scan for and classify each against the candidate's profile.

## ATS-parseable terms to extract
Focus on terms that appear verbatim in ATS databases:
- Named tools and platforms (Salesforce, Jira, Python, AWS, HubSpot, Figma, Tableau)
- Role titles and seniority signals (Senior Manager, Head of Product, VP Engineering)
- Methodologies and frameworks (Agile, Scrum, OKR, PRINCE2, Six Sigma, Kanban)
- Certifications and accreditations (PMP, AWS Solutions Architect, CFA, CIPP, SHRM)
- Hard technical skills stated explicitly in the job requirements

## Do NOT extract
- Generic adjectives (strategic, collaborative, results-driven, innovative)
- Soft-skill phrases (communication skills, team player, fast learner)
- Company-specific jargon unlikely to appear on a candidate's profile
- Paraphrased requirements — extract the specific term, not descriptions of it

## Classification rules
- **supported**: The exact term or a widely-recognised synonym appears in the candidate's profile with real experience behind it. Quote the specific profile evidence (e.g. "Salesforce (skill, expert, 4y)").
- **adjacent**: The candidate has closely related experience that makes the term credibly transferable. Example: Salesforce expert → HubSpot adjacent. Explain the connection briefly in profileEvidence.
- **absent**: Term has no basis in the candidate's profile. Do not suggest its use — dishonest keyword stuffing backfires at interview.

Limit output to 25 terms total across all three categories. Prioritise terms that appear in must-have requirements or appear multiple times in the JD.
```

- [ ] **Step 2: Add the prompt loader to `src/modules/llm/prompt-context.ts`**

Open the file and add this function after `loadCVPrompt` (around line 24):

```typescript
export async function loadATSContextPrompt(): Promise<string> {
  const promptPath = path.join(process.cwd(), 'src/lib/prompts/cv-ats-context.md')
  return readFile(promptPath, 'utf-8').catch(() => {
    throw new Error('cv-ats-context.md missing from bundle — check outputFileTracingIncludes in next.config.ts')
  })
}
```

- [ ] **Step 3: Run typecheck to confirm no errors**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/prompts/cv-ats-context.md src/modules/llm/prompt-context.ts
git commit -m "feat(ats-context): add ATS context system prompt and loader"
```

---

## Task 4: `buildATSContext` and `formatATSContext`

**Files:**
- Create: `src/modules/cv/ats-context.ts`

- [ ] **Step 1: Create the module**

```typescript
// src/modules/cv/ats-context.ts
import { completeStructured } from '@/modules/llm/client'
import { loadATSContextPrompt } from '@/modules/llm/prompt-context'
import { ATSContextSchema, type ATSContextResult } from './ats-context-schema'

export async function buildATSContext(
  profileId: string,
  jobDescription: string,
  profileText: string,
): Promise<ATSContextResult> {
  const systemPrompt = await loadATSContextPrompt()

  const userMessage = [
    '== JOB DESCRIPTION ==',
    jobDescription,
    '',
    '== CANDIDATE PROFILE ==',
    profileText,
  ].join('\n')

  const result = await completeStructured(profileId, userMessage, ATSContextSchema, {
    system: systemPrompt,
    feature: 'ats-context',
    maxOutputTokens: 600,
    temperature: 0.1,
  })

  return result.object
}

export function formatATSContext(ctx: ATSContextResult): string {
  const lines: string[] = ['== ATS KEYWORD UPLIFT ==']
  lines.push('Weave SUPPORTED terms into the CV where the underlying experience justifies them.')
  lines.push('Use ADJACENT terms only where the profile evidence makes it genuinely credible.')
  lines.push('Never use ABSENT terms — they have no profile basis.\n')

  if (ctx.supported.length > 0) {
    lines.push('SUPPORTED (use these exact terms):')
    for (const kw of ctx.supported) {
      lines.push(`- ${kw.term} [${kw.category}]${kw.profileEvidence ? ` — ${kw.profileEvidence}` : ''}`)
    }
    lines.push('')
  }

  if (ctx.adjacent.length > 0) {
    lines.push('ADJACENT (use with care):')
    for (const kw of ctx.adjacent) {
      lines.push(`- ${kw.term} [${kw.category}]${kw.profileEvidence ? ` — ${kw.profileEvidence}` : ''}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
```

- [ ] **Step 2: Run the tests — all should pass now**

```bash
npx vitest run src/modules/cv/ats-context.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Run full suite to confirm no regressions**

```bash
npx vitest run
```

Expected: all 544+ tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/cv/ats-context.ts
git commit -m "feat(ats-context): buildATSContext LLM call and formatATSContext helper"
```

---

## Task 5: Wire ATS context into the generation pipeline

**Files:**
- Modify: `src/modules/cv/generate.ts`

The key design decisions:
- Use the **full unfiltered `snapshot`** (not `filteredSnapshot`) for ATS keyword matching — all declared skills/tools are valid credentials even if specific activities were de-prioritised by evidence scoring.
- Call is **non-fatal**: wrapped in `try/catch`, generation proceeds without ATS context if it fails.
- ATS context block appears **between** `== JOB INTELLIGENCE ==` and `== CANDIDATE PROFILE ==` in the user message.

- [ ] **Step 1: Add imports at the top of `generate.ts`**

After line 9 (`import { JobAnalysisSchema, type JobAnalysis } from '@/modules/jobs/schema'`), add:

```typescript
import { buildATSContext, formatATSContext } from './ats-context'
import type { ATSContextResult } from './ats-context-schema'
```

- [ ] **Step 2: Replace the pipeline section (lines 74–90) with the updated version**

Replace this block:

```typescript
  // Pre-filter the snapshot before it reaches the generation prompt.
  // Job-targeted: LLM scores and ranks activities by relevance, then applies role budgets.
  // Generic: role budgets applied deterministically (no LLM call).
  const filteredSnapshot = analysis
    ? await scoreEvidence(profileId, snapshot, analysis)
    : applyRoleBudgets(snapshot)

  const userMessage = [
    jobContext,
    analysis ? formatAnalysisContext(analysis) : null,
    '',
    '== CANDIDATE PROFILE ==',
    serializeProfileForLLM(filteredSnapshot),
    '',
    '== OUTPUT SCHEMA ==',
    SCHEMA_HINT,
  ].filter((p): p is string => p !== null).join('\n')
```

With:

```typescript
  // Pre-filter the snapshot before it reaches the generation prompt.
  // Job-targeted: LLM scores and ranks activities by relevance, then applies role budgets.
  // Generic: role budgets applied deterministically (no LLM call).
  const filteredSnapshot = analysis
    ? await scoreEvidence(profileId, snapshot, analysis)
    : applyRoleBudgets(snapshot)

  // Serialize both snapshots:
  // fullProfileText — used for ATS keyword matching (all skills/tools considered)
  // profileText — used in the generation prompt (evidence-scored, filtered for this role)
  const fullProfileText = serializeProfileForLLM(snapshot)
  const profileText = serializeProfileForLLM(filteredSnapshot)

  // ATS keyword context: extract JD terms and match against full profile.
  // Non-fatal — if the call throws, generation continues without keyword uplift.
  let atsContext: ATSContextResult | null = null
  if (jobApp?.jobDescription) {
    try {
      atsContext = await buildATSContext(profileId, jobApp.jobDescription, fullProfileText)
    } catch {
      // continue without ATS context
    }
  }

  const userMessage = [
    jobContext,
    analysis ? formatAnalysisContext(analysis) : null,
    atsContext ? formatATSContext(atsContext) : null,
    '',
    '== CANDIDATE PROFILE ==',
    profileText,
    '',
    '== OUTPUT SCHEMA ==',
    SCHEMA_HINT,
  ].filter((p): p is string => p !== null).join('\n')
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/cv/generate.ts
git commit -m "feat(ats-context): wire ATS keyword context into CV generation pipeline"
```

---

## Task 6: Update `cv-generate.md` + register feature label

**Files:**
- Modify: `src/lib/prompts/cv-generate.md`
- Modify: `src/app/dashboard/settings/usage/_components/usage-log.tsx`

- [ ] **Step 1: Add two new sections to `cv-generate.md`**

Append the following two sections after the existing `## Generic CV mode` section (before `## Output contract`):

```markdown
## Skills vs Tools sections
- Use `tools` for specific named software, platforms, and technologies (Salesforce, Jira, Python, AWS, Figma, HubSpot, Tableau, Excel)
- Use `skills` for functional competencies, methodologies, and leadership capabilities (Stakeholder Management, OKR Setting, P&L Ownership, Agile Delivery)
- A single item should never appear in both sections

## ATS Keyword Uplift
When a `== ATS KEYWORD UPLIFT ==` block appears in the input:
- **SUPPORTED terms**: weave these into the CV using the exact terminology — ATS systems match strings, not synonyms. Where a term fits naturally in `skills` or `tools`, include it there explicitly.
- **ADJACENT terms**: include where the profile evidence makes it genuinely credible. Do not stretch beyond what the profile supports.
- **ABSENT terms**: never include — keyword stuffing without evidence backfires at interview.
```

- [ ] **Step 2: Register the feature label in `usage-log.tsx`**

Open `src/app/dashboard/settings/usage/_components/usage-log.tsx` and add to the `FEATURE_LABELS` object (around line 37, after the existing `ats-interpret` entry):

```typescript
  'ats-context':                          'ATS — keyword context',
```

- [ ] **Step 3: Run typecheck + full suite**

```bash
npm run typecheck && npx vitest run
```

Expected: clean typecheck, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/prompts/cv-generate.md src/app/dashboard/settings/usage/_components/usage-log.tsx
git commit -m "feat(ats-context): add skills/tools routing rule and ATS uplift instructions to generation prompt"
```

---

## Self-review

**Spec coverage:**
- ✅ Extract ATS keywords from JD → Task 3 (`buildATSContext` calls LLM with JD)
- ✅ Cross-reference against profile → Task 3 (passes `fullProfileText` to LLM for classification)
- ✅ Supported / adjacent / absent classification → Task 1 (`ATSContextSchema`)
- ✅ Inject into generation prompt → Task 5 (`formatATSContext` block in `userMessage`)
- ✅ Non-fatal if LLM errors → Task 5 (`try/catch`)
- ✅ `tools` vs `skills` guidance for LLM → Task 6 (`cv-generate.md`)
- ✅ Feature visible in usage log → Task 6 (`FEATURE_LABELS`)
- ✅ Tests for schema + pure logic → Task 2 & 4

**Placeholder scan:** None found.

**Type consistency:** `ATSContextResult` is defined in `ats-context-schema.ts` and imported in both `ats-context.ts` and `generate.ts`. `formatATSContext` takes `ATSContextResult` and is exported from `ats-context.ts`. All consistent.
