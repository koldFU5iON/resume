// Profile snapshot: the legacy flat view of the profile, kept as a thin
// adapter over the Profile Map vault (src/modules/profile-map) while callers
// migrate. Takes a profileId (no session lookup) so it's callable from server
// actions, API routes, background jobs, anywhere on the server side.
//
// Pattern: build once, format on demand. The vault is loaded once per request
// (React cache), so every feature in a request shares one query.

import { loadVault } from '@/modules/profile-map/load'
import { notesOf } from '@/modules/profile-map/build'
import { formatMonth as formatMonthUtc } from '@/modules/profile-map/format'
import { makeContactScrubber, type PiiMode } from '@/modules/profile-map/pii'
import type { Vault } from '@/modules/profile-map/types'

export type ProfileSnapshot = {
  name: string
  email: string | null
  phone: string | null
  website: string | null
  linkedin: string | null
  github: string | null
  location: string | null
  headline: string | null
  /** Profile.summary: the candidate's own professional summary. */
  summary: string | null

  experiences: Array<{
    role: string
    company: string
    startDate: Date
    endDate: Date | null   // null = current role
    location: string | null
    remote: boolean
    summary: string
    activities: Array<{
      kind: string         // 'responsibility' | 'achievement'
      description: string
      impact: string | null
      highlighted: boolean
    }>
  }>

  skills: Array<{
    name: string
    category: string
    level: string
    yearsOfExperience: number | null
  }>

  tools: Array<{ name: string; category: string | null }>

  educations: Array<{
    institution: string
    qualification: string
    field: string | null
    startDate: Date
    endDate: Date | null
    grade: string | null
  }>

  certifications: Array<{
    name: string
    issuer: string | null
    issueDate: Date | null
    expiryDate: Date | null
  }>

  competencies: Array<{ name: string }>

  languages: Array<{
    name: string
    proficiency: string | null
  }>

  projects: Array<{
    name: string
    description: string
    highlights: string[]
    status: string
    startDate: Date | null
    endDate: Date | null
    url: string | null
  }>
}

export async function buildProfileSnapshot(profileId: string): Promise<ProfileSnapshot> {
  return toProfileSnapshot(await loadVault(profileId))
}

export function toProfileSnapshot(vault: Vault): ProfileSnapshot {
  const id = vault.identity.props
  const capabilities = notesOf(vault, 'capability')
  return {
    name: id.name,
    email: id.contact.email,
    phone: id.contact.phone,
    website: id.contact.website,
    linkedin: id.contact.linkedIn,
    github: id.contact.github,
    location: id.location,
    headline: id.headline,
    summary: vault.identity.body ?? null,
    experiences: notesOf(vault, 'experience').map((e) => ({
      role: e.props.role,
      company: e.props.company,
      startDate: e.props.startDate,
      endDate: e.props.endDate,
      location: e.props.location,
      remote: e.props.remote,
      summary: e.body ?? '',
      activities: e.links
        .filter((l) => l.type === 'has')
        .map((l) => vault.notes.get(l.id))
        .flatMap((a) => (a?.type === 'evidence'
          ? [{ kind: a.props.kind, description: a.props.description, impact: a.props.impact, highlighted: a.props.highlighted }]
          : [])),
    })),
    skills: capabilities
      .filter((c) => c.props.kind === 'skill')
      .map((c) => ({
        name: c.props.name,
        category: c.props.category ?? 'General',
        level: c.props.level ?? '',
        yearsOfExperience: c.props.yearsOfExperience,
      })),
    tools: capabilities
      .filter((c) => c.props.kind === 'tool')
      .map((c) => ({ name: c.props.name, category: c.props.category })),
    educations: notesOf(vault, 'education').map((e) => ({ ...e.props })),
    certifications: notesOf(vault, 'certification').map((c) => ({
      name: c.props.name,
      issuer: c.props.issuer,
      issueDate: c.props.issueDate,
      expiryDate: c.props.expiryDate,
    })),
    competencies: capabilities.filter((c) => c.props.kind === 'competency').map((c) => ({ name: c.props.name })),
    languages: notesOf(vault, 'language').map((l) => ({ ...l.props })),
    projects: notesOf(vault, 'project').map((p) => ({
      name: p.props.name,
      description: p.props.description,
      highlights: p.props.highlights,
      status: p.props.status,
      startDate: p.props.startDate,
      endDate: p.props.endDate,
      url: p.props.url,
    })),
  }
}

// Markdown is the friendliest format for LLMs — they're trained on tons of
// it and structure helps them attend to the right sections. Keep this lean
// (the model doesn't need timestamps, IDs, or system fields) so token cost
// stays reasonable.
//
// Contact details (email, phone, links) are personal data the model never
// needs: they are left out, and scrubbed from free text, unless a caller opts
// in with `pii: 'include'` (the user's own export). Generated CVs get their
// contact header filled in code (fillCVHeader), not by the model.
export function serializeProfileForLLM(snapshot: ProfileSnapshot, opts: { pii?: PiiMode } = {}): string {
  const pii = opts.pii ?? 'scrub'
  const scrub = pii === 'scrub'
    ? makeContactScrubber({
        email: snapshot.email, phone: snapshot.phone, linkedIn: snapshot.linkedin,
        github: snapshot.github, website: snapshot.website,
      })
    : (text: string) => text
  const lines: string[] = []

  // Header
  lines.push(`# ${snapshot.name}`)
  if (snapshot.headline) lines.push(snapshot.headline)
  if (pii === 'include') {
    const contactParts = [snapshot.email, snapshot.phone, snapshot.linkedin, snapshot.github, snapshot.website].filter(Boolean)
    if (contactParts.length > 0) lines.push(contactParts.join(' · '))
  }
  if (snapshot.location) lines.push(`\n**Location:** ${snapshot.location}`)
  if (snapshot.summary?.trim()) lines.push(`\n## Summary\n\n${scrub(snapshot.summary.trim())}`)

  // Experience
  if (snapshot.experiences.length > 0) {
    lines.push('\n## Experience\n')
    for (const exp of snapshot.experiences) {
      const dates = `${formatMonth(exp.startDate)} – ${exp.endDate ? formatMonth(exp.endDate) : 'present'}`
      const place = [exp.location, exp.remote ? 'Remote' : null].filter(Boolean).join(' · ')
      lines.push(`### ${exp.role} — ${exp.company}`)
      lines.push(`*${dates}${place ? ` · ${place}` : ''}*`)
      if (exp.summary) lines.push(`\n${scrub(exp.summary)}`)
      if (exp.activities.length > 0) {
        for (const act of exp.activities) {
          const star = act.highlighted ? '⭐ ' : ''
          const impact = act.impact ? ` — *${act.impact}*` : ''
          lines.push(`- ${star}**${act.kind}:** ${scrub(act.description)}${impact}`)
        }
      }
      lines.push('')
    }
  }

  // Skills — grouped by category for readability
  if (snapshot.skills.length > 0) {
    lines.push('## Skills\n')
    const byCategory = new Map<string, typeof snapshot.skills>()
    for (const s of snapshot.skills) {
      const arr = byCategory.get(s.category) ?? []
      arr.push(s)
      byCategory.set(s.category, arr)
    }
    for (const [category, items] of byCategory) {
      const parts = items.map(s => {
        const yrs = s.yearsOfExperience ? `${s.yearsOfExperience}y` : null
        const meta = [s.level, yrs].filter(Boolean).join(', ')
        return meta ? `${s.name} (${meta})` : s.name
      })
      lines.push(`- **${category}:** ${parts.join(', ')}`)
    }
    lines.push('')
  }

  // Tools
  if (snapshot.tools.length > 0) {
    lines.push('## Tools')
    lines.push(snapshot.tools.map(t => t.name).join(', '))
    lines.push('')
  }

  // Competencies
  if (snapshot.competencies.length > 0) {
    lines.push('## Competencies')
    lines.push(snapshot.competencies.map(c => c.name).join(', '))
    lines.push('')
  }

  // Education
  if (snapshot.educations.length > 0) {
    lines.push('## Education\n')
    for (const ed of snapshot.educations) {
      const dates = `${formatMonth(ed.startDate)} – ${ed.endDate ? formatMonth(ed.endDate) : 'present'}`
      const field = ed.field ? ` in ${ed.field}` : ''
      const grade = ed.grade ? ` · ${ed.grade}` : ''
      lines.push(`- **${ed.qualification}${field}** — ${ed.institution} (${dates}${grade})`)
    }
    lines.push('')
  }

  // Certifications
  if (snapshot.certifications.length > 0) {
    lines.push('## Certifications\n')
    for (const cert of snapshot.certifications) {
      const exp = cert.expiryDate ? ` (expires ${formatMonth(cert.expiryDate)})` : ''
      const issuer = cert.issuer ? ` — ${cert.issuer}` : ''
      const issued = cert.issueDate ? `, ${formatMonth(cert.issueDate)}` : ''
      lines.push(`- **${cert.name}**${issuer}${issued}${exp}`)
    }
    lines.push('')
  }

  // Languages
  if (snapshot.languages.length > 0) {
    lines.push('## Languages')
    lines.push(snapshot.languages.map(l => l.proficiency ? `${l.name} (${l.proficiency})` : l.name).join(', '))
    lines.push('')
  }

  // Projects — highlights are the primary signal; fall back to description if none
  const activeProjects = snapshot.projects.filter(p => p.status !== 'archived')
  if (activeProjects.length > 0) {
    lines.push('## Projects\n')
    for (const proj of activeProjects) {
      const dates =
        proj.startDate
          ? `${formatMonth(proj.startDate)} – ${proj.endDate ? formatMonth(proj.endDate) : 'present'}`
          : null
      const meta = [dates, proj.url].filter(Boolean).join(' · ')
      lines.push(`### ${proj.name}${meta ? ` *(${meta})*` : ''}`)
      if (proj.highlights.length > 0) {
        for (const h of proj.highlights) lines.push(`- ${scrub(h)}`)
      } else {
        lines.push(scrub(proj.description))
      }
      lines.push('')
    }
  }

  return lines.join('\n').trim()
}

// UTC, so calendar dates don't shift a month back west of UTC.
const formatMonth = formatMonthUtc
