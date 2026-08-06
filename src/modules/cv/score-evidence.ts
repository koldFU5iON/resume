import * as z from 'zod'
import { completeStructured } from '@/modules/llm/client'
import { loadEvidenceScoringPrompt, composeSystem } from '@/modules/llm/prompt-context'
import type { ProfileSnapshot } from '@/modules/profile/snapshot'
import type { JobAnalysis } from '@/modules/jobs/schema'

const ActivityScoreSchema = z.object({
  experienceIndex: z.number().int().min(0),
  activityIndex: z.number().int().min(0),
  score: z.number().int().min(1).max(10),
  tier: z.enum(['must-include', 'useful-context', 'cut']),
})

const EvidenceScoringResultSchema = z.object({
  scores: z.array(ActivityScoreSchema),
})

// Activities per role, indexed by recency: [current, previous, older]
const ROLE_BUDGETS = [5, 4, 3]

function getBudget(roleIndex: number): number {
  return ROLE_BUDGETS[Math.min(roleIndex, ROLE_BUDGETS.length - 1)]
}

export function applyRoleBudgets(snapshot: ProfileSnapshot): ProfileSnapshot {
  return {
    ...snapshot,
    experiences: snapshot.experiences.map((exp, ei) => ({
      ...exp,
      activities: exp.activities.slice(0, getBudget(ei)),
    })),
  }
}

export async function scoreEvidence(
  profileId: string,
  snapshot: ProfileSnapshot,
  analysis: JobAnalysis,
): Promise<ProfileSnapshot> {
  const activitiesText = snapshot.experiences
    .map((exp, ei) => {
      const header = `[Role ${ei}] ${exp.role} at ${exp.company}`
      const rows = exp.activities.map(
        (act, ai) =>
          `[${ei}.${ai}] ${act.kind}: ${act.description}${act.impact ? ' — ' + act.impact : ''}`,
      )
      return [header, ...rows].join('\n')
    })
    .join('\n\n')

  const risksText = analysis.risks
    .map(r => `  - [${r.severity.toUpperCase()}] ${r.risk} → ${r.recommendation}`)
    .join('\n')

  const userMessage = [
    '== JOB REQUIREMENTS ==',
    `Must-have: ${analysis.mustHave.join(', ')}`,
    `Nice-to-have: ${analysis.niceToHave.join(', ')}`,
    '',
    '== JOB INTELLIGENCE ==',
    `Positioning: ${analysis.positioningStrategy}`,
    analysis.risks.length > 0 ? `Risks:\n${risksText}` : null,
    '',
    '== CANDIDATE ACTIVITIES ==',
    activitiesText,
  ].filter((p): p is string => p !== null).join('\n')

  try {
    const systemPrompt = await loadEvidenceScoringPrompt(profileId)
    const result = await completeStructured(
      profileId,
      userMessage,
      EvidenceScoringResultSchema,
      {
        system: composeSystem(systemPrompt),
        feature: 'cv-evidence-score',
        maxOutputTokens: 1200,
        temperature: 0.1,
      },
    )
    return applyScores(snapshot, result.object.scores)
  } catch (err) {
    console.error('[scoreEvidence] LLM call failed, falling back to role budgets', err)
    return applyRoleBudgets(snapshot)
  }
}

type ActivityScore = z.infer<typeof ActivityScoreSchema>

function applyScores(
  snapshot: ProfileSnapshot,
  scores: ActivityScore[],
): ProfileSnapshot {
  return {
    ...snapshot,
    experiences: snapshot.experiences.map((exp, ei) => {
      const budget = getBudget(ei)

      const ranked = exp.activities
        .map((_, ai) => {
          const match = scores.find(
            s => s.experienceIndex === ei && s.activityIndex === ai,
          )
          return { index: ai, score: match?.score ?? 0, tier: match?.tier ?? 'cut' }
        })
        .filter(s => s.tier !== 'cut')
        .sort((a, b) => b.score - a.score)
        .slice(0, budget)

      // If LLM scored everything as 'cut', fall back to the budget slice rather
      // than returning an empty activities array.
      if (ranked.length === 0 && exp.activities.length > 0) {
        return { ...exp, activities: exp.activities.slice(0, budget) }
      }

      return { ...exp, activities: ranked.map(s => exp.activities[s.index]) }
    }),
  }
}
