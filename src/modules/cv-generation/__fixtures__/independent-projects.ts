import { buildVault } from '@/modules/profile-map/build'
import { d } from '@/modules/profile-map/__fixtures__/source'
import { atomRow, NOTES_ONLY } from './projects'
import { projectRow, writeSelection, writeVaultSource } from './write'

const INDEPENDENT = 'independent-role'
export const INDEPENDENT_CLAIM = 'Built billing exports for the community'
export const INDEPENDENT_RESULT = 'Export latency: 4 seconds (from 12 seconds), Q4 2025'

export function independentProjectsFixture(only = false) {
  const owned = { experienceId: INDEPENDENT, projectId: 'workshop', tags: '[]', result: null }
  const result = { measure: 'Export latency', value: '4 seconds', baseline: '12 seconds', period: 'Q4 2025' }
  const activity = { ...atomRow('workshop-atom', 'I built [[Billing Exports|billing exports]] for the community', 'Export latency is 4 seconds.'), ...owned, result }
  const duplicate = { ...activity, id: 'workshop-duplicate' }
  const privateActivity = { ...atomRow('workshop-docs', 'Documented Atlas Toolkit setup for the pilot group at contributor@example.test', 'https://preview.example.test/private/export?key=secret'), ...owned }
  const people = [activity, duplicate, privateActivity]
  const src = writeVaultSource({ projects: [
    projectRow('workshop', 'Workshop Campaign [[Atlas|18]]', 'A campaign for the separate Atlas Toolkit product.', {
      experienceId: INDEPENDENT, activities: people, startDate: d('2022-10'),
      notes: `## Results\n\n- ${INDEPENDENT_RESULT}.\n- Unaccepted notes beside accepted bullets.`,
      url: 'https://project.example.test/private', repoUrl: 'https://repo.example.test/private',
      extractionDraft: { content: { items: [{ description: 'Pending extraction suggestion' }] } },
    }),
    projectRow('assistant', 'Support Assistant', '', {
      experienceId: INDEPENDENT,
      notes: `<!-- Hidden reminder -->\n\n## Instructions\n\nReplace this with the project's business impact.\n\n### Template example\n\nHandled 9,999 requests.\n\n${NOTES_ONLY}\n- Write a CV bullet here.\n- Contact robin@example.test or +33 6 12 34 56 78.\n\n> Private note to self.\n\n\`\`\`\nInternal command\n\`\`\`\n\nFor the pilot, the team used [a shared dashboard](https://preview.example.test/private) with support staff.\n`,
    }),
    projectRow('thin', 'Undeveloped Idea', 'Undeveloped Idea.', { experienceId: INDEPENDENT }),
    projectRow('archived', 'Archived Side Project', 'Retired pilot.', {
      experienceId: INDEPENDENT, status: 'archived',
      activities: [atomRow('archived-atom', 'Archive-only evidence', null, { experienceId: INDEPENDENT, projectId: 'archived' })],
    }),
    projectRow('unselected', 'Unselected Side Project', 'Off-menu output.', { experienceId: INDEPENDENT }),
  ] })
  if (only) src.experiences = []
  src.experiences.push({
    ...writeVaultSource().experiences[0], id: INDEPENDENT, type: 'independent', role: 'Independent projects',
    company: 'Independent sentinel company', startDate: new Date(0), endDate: null, summary: 'Independent role notes.',
    activities: [...people, { ...atomRow('no-label', 'Unlabelled independent achievement'), ...owned, projectId: null }],
  })
  const vault = buildVault(src)
  const selection = writeSelection(vault, { projects: [{ id: 'workshop', reason: '' }, { id: 'assistant', reason: '' }, { id: 'thin', reason: '' }] })
  return { vault, selection }
}
