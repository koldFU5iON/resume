import { buildVault } from '@/modules/profile-map/build'
import { vaultSource, d } from '@/modules/profile-map/__fixtures__/source'
import type { Vault } from '@/modules/profile-map/types'
import { buildCandidates } from '../candidates'
import { enforceSelection, type SelectOutput } from '../select'
import type { CvSelection } from '../schema'
import { buildBriefFor } from './gathered'

/** Employer keys and activity ids of the fixture profile. */
export const UNITY = 'unity'
export const BLIZZARD = 'blizzard-entertainment'
export const OLD_CO = 'old'

/**
 * A profile with: Unity (two roles, current), Blizzard (finished), Old Co (old;
 * becomes a header-only entry), a claimed tool (Tableau: no evidence behind it),
 * evidence-backed skills, an in-progress certification and education.
 */
export function writeVaultSource(opts: { projects?: object[] } = {}) {
  const src = vaultSource()
  const base = src.experiences[0]
  const role = (id: string, company: string, title: string, start: string, end: string | null, acts: Array<[string, string, string | null]>) => ({
    ...base, id, company, role: title, startDate: d(start), endDate: end ? d(end) : null, summary: '',
    skills: [],
    activities: acts.map(([aid, desc, impact], i) => ({
      ...base.activities[0], id: aid, experienceId: id, description: desc, impact, highlighted: false, order: i, kind: 'achievement', skills: [],
    })),
  })
  src.experiences = [
    role('e-u2', 'Unity', 'Snr. Program Manager', '2023-07', null, [
      ['ua1', 'Cut platform release time by 40% across 8 teams', 'saved 2 weeks per release'],
      ['ua2', 'Ran the quarterly planning cycle for the platform org', null],
    ]),
    role('e-u1', 'Unity', 'Program Manager', '2019-01', '2023-06', [['ua3', 'Shipped 12 titles on schedule', null]]),
    role('e-b1', 'Blizzard Entertainment', 'Program Manager', '2015-01', '2018-12', [['ba1', 'Launched a live-service title for 2M players', null]]),
    role('e-o1', 'Old Co', 'Coordinator', '2010-01', '2014-12', [['oa1', 'Kept the release calendar', null]]),
  ] as never
  src.projects = (opts.projects ?? []) as never
  const cap = (id: string, name: string, kind: string, extra: object = {}) => ({
    id, profileId: 'p1', name, kind, category: null, level: null, order: 0, origin: null, yearsOfExperience: null, tags: '[]', notes: null, createdAt: new Date(0), updatedAt: new Date(0), ...extra,
  })
  src.skills = [
    cap('sk1', 'Release management', 'skill'),
    cap('sk2', 'Stakeholder management', 'skill'),
    cap('sk3', 'Roadmapping', 'skill'),
    cap('sk4', 'Risk management', 'skill'),
    cap('sk5', 'Budgeting', 'skill'),
    cap('sk6', 'Dependency mapping', 'skill', { name: 'Dependency mapping' }),
    cap('tl1', 'Jira', 'tool'),
    cap('tl2', 'Tableau', 'tool'),
    cap('cp1', 'Cross-functional leadership', 'competency'),
    cap('cp2', 'Change management', 'competency'),
  ] as never
  // Evidence links make skills proven; Tableau and Change management stay claimed.
  const act = src.experiences[0].activities as Array<{ skills: unknown[] }>
  act[0].skills = [{ skillId: 'sk1', status: 'confirmed' }, { skillId: 'cp1', status: 'confirmed' }, { skillId: 'tl1', status: 'confirmed' }]
  act[1].skills = [{ skillId: 'sk2', status: 'confirmed' }, { skillId: 'sk3', status: 'confirmed' }, { skillId: 'sk4', status: 'confirmed' }, { skillId: 'sk5', status: 'confirmed' }, { skillId: 'sk6', status: 'confirmed' }]
  src.educations = [
    { id: 'we1', profileId: 'p1', institution: 'Example University', qualification: 'MSc', field: 'Supply chain', startDate: d('2012-09'), endDate: d('2014-06'), grade: null, notes: null, tags: '[]', createdAt: new Date(0), updatedAt: new Date(0) },
    { id: 'we2', profileId: 'p1', institution: 'Open College', qualification: 'MBA', field: null, startDate: d('2025-09'), endDate: null, grade: null, notes: null, tags: '[]', createdAt: new Date(0), updatedAt: new Date(0) },
  ] as never
  src.certifications = [
    { id: 'wc1', profileId: 'p1', name: 'PMP', issuer: 'PMI', issueDate: d('2018-05'), expiryDate: null, credentialUrl: null, tags: '[]', createdAt: new Date(0), updatedAt: new Date(0), skills: [] },
    { id: 'wc2', profileId: 'p1', name: 'SAFe Program Consultant', issuer: 'Scaled Agile', issueDate: d('2099-01'), expiryDate: null, credentialUrl: null, tags: '[]', createdAt: new Date(0), updatedAt: new Date(0), skills: [] },
  ] as never
  return src
}

/** A project row of the fixture profile (no role, no dates by default). */
export const projectRow = (id: string, name: string, description: string, over: object = {}) => ({
  id, profileId: 'p1', experienceId: null, name, description, notes: '', url: null, repoUrl: null, startDate: null, endDate: null,
  status: 'active', highlights: '[]', tags: '[]', createdAt: new Date(0), updatedAt: new Date(0), skills: [], activities: [], ...over,
})

export const writeVault = (projects: object[] = []): Vault => buildVault(writeVaultSource({ projects }))

const pick = (...ids: string[]) => ids.map((id) => ({ id, reason: '' }))

/** The fixture profile's selection: Unity (4 bullets, relevance 5) and Blizzard (relevance 3) with bullets, Old Co header-only. */
export function writeSelection(vault: Vault = writeVault(), over: Partial<SelectOutput> = {}): CvSelection {
  const out: SelectOutput = {
    employers: [{ id: UNITY, relevance: 5, reason: 'current' }, { id: BLIZZARD, relevance: 3, reason: '' }],
    activities: pick('ua1', 'ua2', 'ua3', 'ba1'),
    skills: pick('sk1', 'sk2', 'sk3', 'sk4', 'sk5', 'sk6'),
    tools: pick('tl1', 'tl2'),
    competencies: pick('cp1', 'cp2'),
    certifications: pick('wc1', 'wc2'),
    education: pick('we1', 'we2'),
    projects: [],
    emphasise: [],
    ...over,
  }
  const brief = buildBriefFor({ budgets: { experiences: 2, skills: 12, tools: 10, competencies: 6, certifications: 4, education: 3, projects: 2 } })
  return enforceSelection(out, buildCandidates(vault), brief).selection
}

/** A completeJSON-shaped reply for a writer's mocked call. */
export function llmReply(extracted: unknown, over: Record<string, unknown> = {}) {
  return { extracted, finishReason: 'stop', rawText: '', model: 'claude-sonnet-5-5', provider: 'anthropic', usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: null, cacheWriteTokens: null }, ...over }
}

/** What a scripted completeJSON mock receives. */
type Call = { prompt: string; opts: Record<string, unknown> }

/**
 * A completeJSON mock implementation that answers from a script: an object is
 * the model's JSON answer (parsed with the real extractJSON and the call's
 * schema, so a schema mismatch fails like production); the string 'junk' is an
 * answer with no JSON. `calls` records every prompt and option set.
 */
export function scripted(extractJSON: (text: string, schema: unknown) => unknown, replies: Array<object | 'junk'>) {
  const calls: Call[] = []
  const impl = async (_profileId: string, prompt: string, schema: unknown, opts: Record<string, unknown>) => {
    calls.push({ prompt, opts })
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]
    const text = reply === 'junk' ? 'sorry, no json' : `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``
    return llmReply(extractJSON(text, schema))
  }
  return { impl, calls }
}

import type { WrittenSection } from '../write/types'
import type { WriteResult } from '../write/run-write'

const wsec = (id: string, kind: string, markdown: string, over: Partial<WrittenSection> = {}): WrittenSection => ({
  id, kind, markdown, log: { id, label: id, status: 'ok', model: null, durationMs: 0, tokens: { input: 0, output: 0 }, costUsd: null, retries: 0, retryReasons: [], notes: [] }, ...over,
})

/** Written sections of the fixture profile, deliberately out of CV order. */
export function writtenSections(): WrittenSection[] {
  return [
    wsec('education', 'education', '- **MSc in Supply chain** — Example University (2012 – 2014)'),
    wsec('skills', 'skills', ':::skills\n- Release management\n:::', { model: 'm', tokens: { input: 10, output: 5 } }),
    wsec(`experience:${BLIZZARD}`, 'experience', '### Blizzard Entertainment\n**Program Manager** · Jan 2015 – Dec 2018\n\nLaunched a title.\n\n:::compact-list\n- Launched a live-service title for 2M players.\n:::', { employerKey: BLIZZARD }),
    wsec(`experience:${UNITY}`, 'experience', '### Unity\n**Snr. Program Manager** · Jan 2019 – present\n\nRan the platform org.\n\n:::compact-list\n- Cut platform release time by 40% across 8 teams.\n:::', { employerKey: UNITY }),
    wsec(`experience:${OLD_CO}`, 'experience', '### Old Co\n**Coordinator** · Jan 2010 – Dec 2014', { employerKey: OLD_CO }),
    wsec('tools', 'tools', ':::inline-list\n- Jira\n:::'),
    wsec('profile', 'profile', 'Delivery leader.'),
    wsec('competencies', 'competencies', ':::skills\n- Cross-functional leadership\n:::'),
    wsec('certification', 'certification', '- **PMP** — PMI (2018)'),
    wsec('languages', 'languages', ':::inline-list\n- French (Native)\n:::'),
  ]
}

export function writtenResult(over: Partial<WriteResult> = {}): WriteResult {
  return {
    sections: writtenSections(), headline: 'Delivery and operations leader', checkNotes: [], notes: [],
    usage: { input: 4000, output: 800, costUsd: 0.02, calls: 4 }, models: ['m-sonnet'], ...over,
  }
}
