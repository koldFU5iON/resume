import { BLOCK_LIST } from '@/modules/writing-desk/markdown'
import type { StructureGuide } from '@/modules/writing-desk/structure-guide'

// The writing contract an external agent follows when drafting a CV. Block
// details come from BLOCK_LIST and the structure from the guide, so neither
// can drift from what the app actually supports.
export function buildWritingContract(guide: StructureGuide): string {
  const blocks = BLOCK_LIST.map(block =>
    [
      `### ${block.id} (${block.label})`,
      block.description,
      'Example:',
      block.example,
    ].join('\n'),
  ).join('\n\n')

  const sections = guide.sections.map((s, i) => `${i + 1}. ${s.heading} (${s.key})`).join('\n')
  const origin =
    guide.source === 'master-cv'
      ? "the user's master CV"
      : 'the default CV structure (the user has no master CV yet)'

  return [
    '# CV writing contract',
    '',
    '## Content format',
    'Write the CV as Markdown. Wrap content in `:::` blocks only for the block ids below; ordinary Markdown outside blocks is fine.',
    'Unsupported `:::` blocks are rejected, so use only these ids:',
    '',
    blocks,
    '',
    '## Starting structure',
    `Start from this structure, taken from ${origin}:`,
    sections,
    '',
    'This is a starting point, not a fixed template. Adding, dropping and reordering sections is allowed when justified by the job and the profile.',
    '',
    '## Writing guidance',
    '- Professional profile: about 3 to 5 lines, tailored to the job.',
    '- Use conventional section headings that applicant tracking systems recognise.',
    '- Present skills as categorised skills (for example by theme), not one long list.',
    '- List experience in reverse-chronological order.',
    '',
    '## Factual integrity',
    "Use only claims supported by the profile and master CV returned by get_job_context. Do not invent employers, titles, dates, qualifications, metrics or skills. The job description tells you what to emphasise, never what to claim.",
  ].join('\n')
}
