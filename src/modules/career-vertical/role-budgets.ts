import type { ProfileSnapshot } from '@/modules/profile/snapshot'

// Activities per role, indexed by recency: [current, previous, older]
const ROLE_BUDGETS = [5, 4, 3]

/** Recency rank among JOBS only: the independent experience has no recency, so it takes the smallest budget and does not push real jobs down. */
function budgetIndexes(experiences: ProfileSnapshot['experiences']): number[] {
  let jobs = 0
  return experiences.map((e) => (e.type === 'independent' ? ROLE_BUDGETS.length - 1 : jobs++))
}

function getBudget(roleIndex: number): number {
  return ROLE_BUDGETS[Math.min(roleIndex, ROLE_BUDGETS.length - 1)]
}

/** Trims each role's activities to its recency budget (5 / 4 / 3) for the master CV prompt. */
export function applyRoleBudgets(snapshot: ProfileSnapshot): ProfileSnapshot {
  return {
    ...snapshot,
    experiences: snapshot.experiences.map((exp, ei) => ({
      ...exp,
      activities: exp.activities.slice(0, getBudget(budgetIndexes(snapshot.experiences)[ei])),
    })),
  }
}
