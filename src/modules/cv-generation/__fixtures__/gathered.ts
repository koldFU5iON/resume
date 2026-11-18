import { bigCandidates, brief } from './candidates'
import { emptyStrategy } from '../strategy'
import type { GatherResult } from '../gather'
import type { CvBrief } from '../schema'

export function gathered(over: Partial<Extract<GatherResult, { ok: true }>> = {}): Extract<GatherResult, { ok: true }> {
  return {
    ok: true,
    job: { id: 'job-1', title: 'Head of Delivery', company: 'Acme', description: 'Run our delivery org.' },
    candidates: bigCandidates(),
    outline: 'Headline: Program manager\nRoles (most recent first):\n- Role 0 — Co 0',
    strategy: { ...emptyStrategy('job-analysis'), positioning: 'Delivery lead at scale.', mustHave: ['Delivery'] },
    deepDiveId: null,
    inputsHash: 'h'.repeat(64),
    notes: ['No complete deep dive: strategy from the job analysis (early assessment).'],
    ...over,
  }
}

export const buildBriefFor = (over: Partial<CvBrief> = {}): CvBrief => ({ ...brief, ...over })
