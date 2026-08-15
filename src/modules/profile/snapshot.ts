// Profile snapshot — the connective tissue between the relational profile
// store and any LLM feature. Takes a profileId (no session lookup) so it's
// callable from server actions, API routes, background jobs, anywhere on
// the server side.
//
// Pattern: build once, format on demand. Every AI feature gets the same
// shape; only the formatter changes for different prompt styles.

import { prisma } from '@/lib/db'
import { parseJsonField } from '@/lib/utils'

export type ProfileSnapshot = {
  name: string
  email: string | null
  phone: string | null
  website: string | null
  linkedin: string | null
  location: string | null
  headline: string | null

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
  const row = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: {
      experiences: {
        orderBy: { startDate: 'desc' },
        include: { activities: { orderBy: [{ highlighted: 'desc' }, { order: 'asc' }] } },
      },
      skills: { orderBy: [{ category: 'asc' }, { name: 'asc' }] },
      educations: { orderBy: { startDate: 'desc' } },
      certifications: { orderBy: { issueDate: 'desc' } },
      competencies: { orderBy: { order: 'asc' } },
      languages: { orderBy: { order: 'asc' } },
      projects: { orderBy: { startDate: 'desc' } },
    },
  })

  return {
    name: row.name,
    email: row.email,
    phone: row.phone,
    website: row.website,
    linkedin: row.linkedIn,
    location: row.location,
    headline: row.headline,
    experiences: row.experiences.map(e => ({
      role: e.role,
      company: e.company,
      startDate: e.startDate,
      endDate: e.endDate,
      location: e.location,
      remote: e.remote,
      summary: e.summary,
      activities: e.activities.map(a => ({
        kind: a.kind,
        description: a.description,
        impact: a.impact,
        highlighted: a.highlighted,
      })),
    })),
    skills: row.skills.map(s => ({
      name: s.name,
      category: s.category,
      level: s.level,
      yearsOfExperience: s.yearsOfExperience,
    })),
    educations: row.educations.map(e => ({
      institution: e.institution,
      qualification: e.qualification,
      field: e.field,
      startDate: e.startDate,
      endDate: e.endDate,
      grade: e.grade,
    })),
    certifications: row.certifications.map(c => ({
      name: c.name,
      issuer: c.issuer,
      issueDate: c.issueDate,
      expiryDate: c.expiryDate,
    })),
    competencies: row.competencies.map(c => ({ name: c.name })),
    languages: row.languages.map(l => ({ name: l.name, proficiency: l.proficiency })),
    projects: row.projects.map(p => ({
      name: p.name,
      description: p.description,
      highlights: parseJsonField<string[]>(p.highlights, []),
      status: p.status,
      startDate: p.startDate,
      endDate: p.endDate,
      url: p.url,
    })),
  }
}

// Markdown is the friendliest format for LLMs — they're trained on tons of
// it and structure helps them attend to the right sections. Keep this lean
// (the model doesn't need timestamps, IDs, or system fields) so token cost
// stays reasonable.
export function serializeProfileForLLM(snapshot: ProfileSnapshot): string {
  const lines: string[] = []

  // Header
  lines.push(`# ${snapshot.name}`)
  if (snapshot.headline) lines.push(snapshot.headline)
  const contactParts = [snapshot.email, snapshot.phone, snapshot.linkedin, snapshot.website].filter(Boolean)
  if (contactParts.length > 0) lines.push(contactParts.join(' · '))
  if (snapshot.location) lines.push(`\n**Location:** ${snapshot.location}`)

  // Experience
  if (snapshot.experiences.length > 0) {
    lines.push('\n## Experience\n')
    for (const exp of snapshot.experiences) {
      const dates = `${formatMonth(exp.startDate)} – ${exp.endDate ? formatMonth(exp.endDate) : 'present'}`
      const place = [exp.location, exp.remote ? 'Remote' : null].filter(Boolean).join(' · ')
      lines.push(`### ${exp.role} — ${exp.company}`)
      lines.push(`*${dates}${place ? ` · ${place}` : ''}*`)
      if (exp.summary) lines.push(`\n${exp.summary}`)
      if (exp.activities.length > 0) {
        for (const act of exp.activities) {
          const star = act.highlighted ? '⭐ ' : ''
          const impact = act.impact ? ` — *${act.impact}*` : ''
          lines.push(`- ${star}**${act.kind}:** ${act.description}${impact}`)
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
        for (const h of proj.highlights) lines.push(`- ${h}`)
      } else {
        lines.push(proj.description)
      }
      lines.push('')
    }
  }

  return lines.join('\n').trim()
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
}
