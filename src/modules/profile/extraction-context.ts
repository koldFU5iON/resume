import { experienceLabel, isEmployment } from '@/modules/profile/experience-type'
// What an extraction is told about the note it reads: the text, and the
// framing the model gets. Pure, so the wording is tested. Lives apart from
// extract.ts because that file is 'use server' and may only export async
// functions.

import { projectBody } from './project-merge'

export type ExtractionSubject = {
  /** The note text to extract from. */
  body: string
  /** "role" or "project", for the model and for the messages the person reads. */
  noun: 'role' | 'project'
  /** The structured facts the model must not re-extract. */
  facts: string
}

const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

export function roleSubject(role: { type?: string | null; role: string; company: string; summary: string | null; startDate: Date; endDate: Date | null }): ExtractionSubject {
  const end = role.endDate ? month(role.endDate) : 'Present'
  return {
    body: role.summary ?? '',
    noun: 'role',
    facts: isEmployment(role) ? `**${role.role}** at ${role.company} (${month(role.startDate)} → ${end})` : `**${role.role}** (personal projects, not a job)`,
  }
}

/** A project's description and notes read as one text, the way the profile vault does. */
export function projectSubject(project: { name: string; description: string; notes: string; role?: { type?: string | null; role: string; company: string } | null }): ExtractionSubject {
  const partOf = project.role ? ` (part of ${experienceLabel(project.role)})` : ''
  return {
    body: projectBody(project),
    noun: 'project',
    facts: `**${project.name}**${partOf}`,
  }
}

export const EXTRACTION_SYSTEM = (noun: ExtractionSubject['noun']) => `You are an experienced career writer extracting structured resume material from messy notes.

Be conservative — prefer fewer high-confidence items over many noisy ones. Only extract content that clearly came from the person's own work ${noun === 'role' ? 'at this role' : 'on this project'}. Do not fabricate metrics or outcomes. If a bullet is ambiguous between a responsibility and an achievement, classify it as a responsibility.

Output only the JSON schema — no prose, no commentary.`

export function extractionPrompt(subject: ExtractionSubject, unparsed: string): string {
  return `# ${subject.noun === 'role' ? 'Role' : 'Project'} context (already structured — do not re-extract these facts)

${subject.facts}

# Unstructured notes to extract from

${unparsed}

Extract activities (responsibilities and achievements) and skills from the notes above. Set source to "llm" for every item. Return a JSON object matching the schema.`
}

/** What to say when there is nothing to read yet. */
export const noNotesMessage = (noun: ExtractionSubject['noun']) =>
  `Add some notes first — paste anything about this ${noun} and click Extract.`
