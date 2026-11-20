// Synthetic profiles of different shapes, as loaded vaults. The start of a
// generality suite: any feature that must work for "any user's profile" (the
// readiness checks today, CV generation next) can run over these instead of
// one real person's data. Every person, employer and figure here is invented.
//
// - cleanProfile:    complete and consistent; must produce no 'fix' finding.
// - earlyCareer:     one role, two projects, one qualification.
// - longCareer:      many roles, one run concurrently, one gap.
// - careerChanger:   a different field, personal projects, study in progress.
// - messyImport:     duplicates, status typed into names, empty narratives.

import { buildVault } from '@/modules/profile-map/build'
import type { VaultSource } from '@/modules/profile-map/source'
import type { Vault } from '@/modules/profile-map/types'
import { d, t, vaultSource } from '@/modules/profile-map/__fixtures__/source'

export { d, t }
/** The clock every readiness fixture is judged against. */
export const NOW = new Date('2026-11-19T00:00:00Z')

type Rows = Pick<VaultSource, 'experiences' | 'projects' | 'skills' | 'educations' | 'certifications' | 'languages'>
type Over = Partial<VaultSource>

export function activity(id: string, owner: { experienceId?: string; projectId?: string }, kind: 'achievement' | 'responsibility', description: string, impact: string | null = null, skillIds: string[] = [], order = 0, result: Record<string, string> | null = null) {
  return {
    id, experienceId: owner.experienceId ?? null, projectId: owner.projectId ?? null, kind, description, impact, result,
    highlighted: false, order, tags: '[]', createdAt: t, updatedAt: t,
    skills: skillIds.map((skillId) => ({ skillId, status: 'confirmed' })),
  }
}

export function role(id: string, company: string, roleName: string, start: string, end: string | null, summary: string, activities: ReturnType<typeof activity>[] = []) {
  return {
    id, profileId: 'p1', company, role: roleName, startDate: d(start), endDate: end ? d(end) : null,
    location: null, remote: false, type: 'employment', summary, notesUpdatedAt: null, revision: 1, tags: '[]', createdAt: t, updatedAt: t,
    skills: [], activities,
  }
}

/** The timeless home for personal projects: a sentinel start date that no date check may read. */
export function independentRole(id: string, activities: ReturnType<typeof activity>[] = []) {
  return { ...role(id, 'Independent projects', 'Independent projects', '1970-01', null, '', activities), type: 'independent' }
}

export function project(id: string, name: string, description: string, over: { experienceId?: string | null; notes?: string; highlights?: string[]; activities?: ReturnType<typeof activity>[]; start?: string } = {}) {
  return {
    id, profileId: 'p1', experienceId: over.experienceId ?? null, name, description, notes: over.notes ?? '',
    revision: 1, url: null, repoUrl: null, startDate: over.start ? d(over.start) : null, endDate: null, status: 'active',
    highlights: JSON.stringify(over.highlights ?? []), tags: '[]', createdAt: t, updatedAt: t,
    skills: [], activities: over.activities ?? [],
  }
}

export const skill = (id: string, name: string, kind: 'skill' | 'tool' | 'competency' = 'skill') => ({
  id, profileId: 'p1', name, kind, category: null, level: null, order: 0, origin: null,
  yearsOfExperience: null, tags: '[]', notes: null, createdAt: t, updatedAt: t,
})

export const education = (id: string, qualification: string, start: string, end: string | null, institution = 'Example University') => ({
  id, profileId: 'p1', institution, qualification, field: null, startDate: d(start), endDate: end ? d(end) : null,
  grade: null, notes: null, tags: '[]', createdAt: t, updatedAt: t,
})

export const certification = (id: string, name: string, over: { issuer?: string | null; issued?: string | null; expires?: string | null } = {}) => ({
  id, profileId: 'p1', name, issuer: over.issuer === undefined ? 'Example Institute' : over.issuer,
  issueDate: over.issued ? d(over.issued) : null, expiryDate: over.expires ? d(over.expires) : null,
  credentialUrl: null, tags: '[]', createdAt: t, updatedAt: t, skills: [],
})

/** A vault from a base profile with complete contact details and no narrative rows, plus the given rows. */
export function vaultOf(rows: Partial<Rows> = {}, over: Over = {}): Vault {
  return buildVault(vaultSource({
    experiences: [], projects: [], skills: [], educations: [], certifications: [], languages: [],
    ...rows, ...over,
  } as Over))
}

const LONG_SUMMARY = 'Owned delivery for the regional rollout: scoped the work with the business, ran a team of eight across three sites and reported progress to the steering group every month.'

export function cleanProfile(): Vault {
  return vaultOf({
    experiences: [
      role('e1', 'Fictional Freight', 'Program Manager', '2022-09', null, LONG_SUMMARY, [
        activity('a1', { experienceId: 'e1' }, 'achievement', 'Cut the release cycle for the freight platform', 'From 6 weeks to 2 weeks across 14 teams', ['s1'], 0, { measure: 'release cycle', value: '2 weeks', baseline: '6 weeks' }),
        activity('a3', { experienceId: 'e1' }, 'responsibility', 'Run the monthly steering group and agree priorities with the business', null, ['s3']),
      ]),
      role('e2', 'Example Logistics', 'Delivery Lead', '2019-01', '2022-06', LONG_SUMMARY, [
        activity('a4', { experienceId: 'e2' }, 'achievement', 'Introduced a single intake process for all warehouse change requests', 'Backlog fell by 40%', ['s3'], 0, { measure: 'change-request backlog', value: '40% smaller' }),
        activity('a5', { experienceId: 'e2' }, 'responsibility', 'Coordinate vendors and internal teams through weekly planning sessions', null, ['s2']),
      ]),
    ],
    projects: [
      project('pr1', 'Tracking migration', 'Moved parcel tracking from a legacy system to a new platform for all depots, with a phased cut-over and daily reporting to operations.', {
        experienceId: 'e1', start: '2023-01',
        activities: [activity('a2', { projectId: 'pr1' }, 'achievement', 'Moved the migration to schedule after a late start', 'Delivered 3 weeks early', ['s2'], 0, { measure: 'delivery against plan', value: '3 weeks early' })],
      }),
    ],
    skills: [skill('s1', 'Release management'), skill('s2', 'Jira', 'tool'), skill('s3', 'Stakeholder management', 'competency')],
    educations: [education('ed1', 'MSc Supply Chain', '2012-09', '2014-06')],
    certifications: [certification('ce1', 'PMP', { issuer: 'PMI', issued: '2018-05', expires: '2029-05' })],
  })
}

export function earlyCareer(): Vault {
  return vaultOf({
    experiences: [
      role('e1', 'Example Studio', 'Junior Developer', '2025-06', null, 'Built features for the studio website and fixed bugs reported by clients, working with two senior developers and a designer on a small team.', [
        activity('a1', { experienceId: 'e1' }, 'achievement', 'Rebuilt the booking form in React', 'Completion rate rose from 61% to 78%', ['s1']),
        activity('a2', { experienceId: 'e1' }, 'responsibility', 'Fix bugs raised by clients and write tests for each fix', null, ['s1']),
      ]),
    ],
    projects: [
      project('pr1', 'Recipe planner', 'A weekly meal planner that builds a shopping list from chosen recipes, written in TypeScript with a small API and tests.', { start: '2024-09' }),
      project('pr2', 'Bike route finder', 'Maps quiet cycling routes between two points using open map data, and ranks them by traffic level and surface quality.', { start: '2025-02' }),
    ],
    skills: [skill('s1', 'React')],
    educations: [education('ed1', 'BSc Computer Science', '2021-09', '2024-06')],
  })
}

export function longCareer(): Vault {
  const body = 'Led programmes of work across the business and reported to the executive team; hired and coached the delivery managers who ran each stream.'
  return vaultOf({
    experiences: [
      role('e1', 'Alpha Group', 'Director of Delivery', '2021-01', null, body, [
        activity('a1', { experienceId: 'e1' }, 'achievement', 'Consolidated four delivery teams into one operating model', 'Saved 1.2m per year', ['s1']),
      ]),
      // Runs alongside Alpha Group for over a year.
      role('e2', 'Beta Advisory', 'Associate Consultant', '2022-02', '2023-09', body, [
        activity('a2', { experienceId: 'e2' }, 'achievement', 'Advised two start-ups on setting up delivery governance', 'Both passed investor due diligence', ['s1']),
      ]),
      role('e3', 'Gamma Systems', 'Programme Manager', '2016-03', '2020-10', body, [
        activity('a3', { experienceId: 'e3' }, 'achievement', 'Delivered the payments replacement programme', 'On a 9m budget, 2 weeks early', ['s1']),
      ]),
      // 13 months before Gamma Systems starts.
      role('e4', 'Delta Retail', 'Project Manager', '2012-04', '2015-02', body, [
        activity('a4', { experienceId: 'e4' }, 'responsibility', 'Plan and track store refit projects across the northern region', null, ['s1']),
      ]),
      role('e5', 'Epsilon Retail', 'Project Coordinator', '2009-06', '2012-03', body, [
        activity('a5', { experienceId: 'e5' }, 'responsibility', 'Coordinate suppliers and store managers for each refit schedule', null, ['s1']),
      ]),
    ],
    skills: [skill('s1', 'Programme delivery')],
    educations: [education('ed1', 'BA Business', '2005-09', '2008-06')],
  })
}

export function careerChanger(): Vault {
  return vaultOf({
    experiences: [
      role('e1', 'Example School', 'Secondary Teacher', '2014-09', '2025-07', 'Taught mathematics to ages 11 to 18, led the department for four years and mentored new teachers through their first year in the school.', [
        activity('a1', { experienceId: 'e1' }, 'achievement', 'Raised the share of pupils reaching the top grades in the department', 'From 22% to 35% over four years', ['s1']),
        activity('a2', { experienceId: 'e1' }, 'responsibility', 'Plan lessons and mark work for six classes each week', null, ['s1']),
      ]),
    ],
    projects: [
      project('pr1', 'Timetable helper', 'A small web tool that builds a school timetable from teacher availability and room limits, written in Python after a bootcamp module.', { start: '2025-09' }),
    ],
    skills: [skill('s1', 'Teaching'), skill('s2', 'Python'), skill('s3', 'SQL')],
    educations: [
      education('ed1', 'BSc Mathematics', '2010-09', '2013-06'),
      education('ed2', 'Software Engineering Bootcamp', '2025-09', '2027-03', 'Example Bootcamp'),
    ],
    certifications: [certification('ce1', 'Cloud Practitioner', { issuer: 'Example Cloud', issued: '2027-01' })],
  })
}

export function messyImport(): Vault {
  return vaultOf({
    experiences: [
      role('e1', 'Acme Media', 'Producer', '2020-01', null, '', [
        activity('a1', { experienceId: 'e1' }, 'achievement', 'Grew the audience of the weekly show', 'Audience up 30% in a year', []),
        activity('a2', { experienceId: 'e1' }, 'achievement', 'Grew the audience of the weekly show through new formats', 'Audience up 55% in a year', []),
        activity('a3', { experienceId: 'e1' }, 'responsibility', 'Ran meetings', null, []),
        activity('a4', { experienceId: 'e1' }, 'achievement', 'Looked after the schedule', null, []),
        activity('a5', { experienceId: 'e1' }, 'responsibility', Array.from({ length: 68 }, (_, i) => `word${i}`).join(' ') + ' [[Obscure Tool]]', null, []),
      ]),
      // Ends before it starts, and has nothing under it.
      role('e2', 'Borrowed Ltd', 'Assistant', '2018-06', '2017-01', '', []),
    ],
    projects: [
      project('pr1', 'Enemies Demo Campaign', ''),
      project('pr2', 'enemies demo campaign', 'A demo campaign that introduced the enemy types to testers, with a short brief for each encounter and notes from three play sessions.'),
    ],
    skills: [skill('s1', 'Unity'), skill('s2', 'Photoshop', 'tool'), skill('s3', 'Scheduling', 'competency')],
    educations: [education('ed1', 'Diploma', '2011-09', '2010-06')],
    certifications: [
      certification('ce1', 'PMP (in progress)', { issuer: null }),
      certification('ce2', 'First Aid', { issuer: 'Example Institute', issued: '2016-01', expires: '2019-01' }),
      certification('ce3', 'Scrum Master', { issuer: null, issued: '2021-03' }),
    ],
  }, { email: null, phone: null, linkedIn: null, location: null })
}
