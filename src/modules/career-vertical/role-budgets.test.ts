import { describe, it, expect } from 'vitest'
import { applyRoleBudgets } from './role-budgets'
import type { ProfileSnapshot } from '@/modules/profile/snapshot'

function makeActivity(kind: string, description: string, highlighted = false) {
  return { kind, description, impact: null, highlighted }
}

const MOCK_SNAPSHOT: ProfileSnapshot = {
  name: 'Test User',
  email: null,
  phone: null,
  website: null,
  linkedin: null,
  location: null,
  headline: null,
  github: null,
  summary: null,
  tools: [],
  experiences: [
    {
      type: 'employment',
      role: 'Director',
      company: 'Acme',
      startDate: new Date('2020-01-01'),
      endDate: null,
      location: null,
      remote: false,
      summary: 'Led EMEA.',
      activities: [
        makeActivity('achievement', 'Led 8 territories', true),
        makeActivity('achievement', 'Managed €500k budget', true),
        makeActivity('responsibility', 'Line managed 4 leads', false),
        makeActivity('responsibility', 'Generic admin work', false),
      ],
    },
    {
      type: 'employment',
      role: 'Manager',
      company: 'Beta',
      startDate: new Date('2016-01-01'),
      endDate: new Date('2019-12-31'),
      location: null,
      remote: false,
      summary: 'Agency lead.',
      activities: [
        makeActivity('achievement', 'Won 3 new accounts', true),
        makeActivity('achievement', 'Delivered 14,000 registrations', true),
        makeActivity('responsibility', 'Monthly client reports', false),
        makeActivity('responsibility', 'Team admin', false),
        makeActivity('responsibility', 'Event attendance', false),
      ],
    },
  ],
  skills: [],
  educations: [],
  certifications: [],
  competencies: [],
  languages: [],
  projects: [],
}

describe('applyRoleBudgets', () => {
  it('trims role 0 to 5 activities', () => {
    const snapshot: ProfileSnapshot = {
      ...MOCK_SNAPSHOT,
      experiences: [
        {
          ...MOCK_SNAPSHOT.experiences[0],
          activities: Array(7).fill(makeActivity('achievement', 'Activity')),
        },
      ],
    }
    const result = applyRoleBudgets(snapshot)
    expect(result.experiences[0].activities).toHaveLength(5)
  })

  it('trims role 1 to 4 activities', () => {
    const snapshot: ProfileSnapshot = {
      ...MOCK_SNAPSHOT,
      experiences: [
        MOCK_SNAPSHOT.experiences[0],
        {
          ...MOCK_SNAPSHOT.experiences[1],
          activities: Array(6).fill(makeActivity('achievement', 'Activity')),
        },
      ],
    }
    const result = applyRoleBudgets(snapshot)
    expect(result.experiences[1].activities).toHaveLength(4)
  })

  it('trims role 2+ to 3 activities', () => {
    const olderRole = {
      ...MOCK_SNAPSHOT.experiences[0],
      activities: Array(5).fill(makeActivity('achievement', 'Activity')),
    }
    const snapshot: ProfileSnapshot = {
      ...MOCK_SNAPSHOT,
      experiences: [
        MOCK_SNAPSHOT.experiences[0],
        MOCK_SNAPSHOT.experiences[1],
        olderRole,
      ],
    }
    const result = applyRoleBudgets(snapshot)
    expect(result.experiences[2].activities).toHaveLength(3)
  })

  it('does not trim roles already within budget', () => {
    const result = applyRoleBudgets(MOCK_SNAPSHOT)
    expect(result.experiences[0].activities).toHaveLength(4)
    expect(result.experiences[1].activities).toHaveLength(4)
  })

  it('does not mutate the original snapshot', () => {
    const original = MOCK_SNAPSHOT.experiences[0].activities.length
    applyRoleBudgets(MOCK_SNAPSHOT)
    expect(MOCK_SNAPSHOT.experiences[0].activities).toHaveLength(original)
  })
})

describe('applyRoleBudgets: the independent experience', () => {
  it('does not take a job\'s recency slot, so the real jobs keep their budgets', () => {
    const base = MOCK_SNAPSHOT.experiences[0]
    const many = Array.from({ length: 10 }, (_, i) => makeActivity('achievement', `Did thing ${i}`))
    const snapshot: ProfileSnapshot = {
      ...MOCK_SNAPSHOT,
      experiences: [
        { ...base, type: 'independent', role: 'Independent projects', company: 'Independent projects', activities: many },
        { ...base, activities: many },
      ],
    }
    const [independent, job] = applyRoleBudgets(snapshot).experiences
    expect(job.activities).toHaveLength(5)
    expect(independent.activities).toHaveLength(3)
  })
})

