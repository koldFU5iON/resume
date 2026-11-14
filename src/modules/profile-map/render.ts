// Self-contained note rendering: any single note, rendered alone, carries
// enough context to be understood (an achievement names its role, company and
// dates). Used by the internal profile tools and anywhere one note is enough.

import { formatSpan } from './format'
import { makeContactScrubber, type PiiMode } from './pii'
import type { ExperienceNote, Note, PreferencesNote, Vault } from './types'

export type RenderOptions = { pii?: PiiMode }

const REMOTE_TEXT: Record<string, string> = {
  remote: 'Fully remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  flexible: 'Flexible',
}

/**
 * The one search-preferences formatter. `brief` is the short block for prompts
 * that only need direction; `full` adds salary, eligibility and extra context.
 */
export function formatPreferences(prefs: PreferencesNote['props'], style: 'brief' | 'full' = 'brief'): string {
  const lines: string[] = []
  if (prefs.roles.length) lines.push(`- Target roles: ${prefs.roles.join(', ')}`)
  if (prefs.currentRole) lines.push(`- Current role: ${prefs.currentRole}`)
  if (prefs.remotePreference) lines.push(`- Remote preference: ${REMOTE_TEXT[prefs.remotePreference] ?? prefs.remotePreference}`)
  if (prefs.countries.length) lines.push(`- Countries: ${prefs.countries.join(', ')}`)
  if (prefs.careerGoals) lines.push(`- Career goals: ${prefs.careerGoals}`)
  if (prefs.pivotContext) lines.push(`- Career change context: ${prefs.pivotContext}`)
  if (style === 'full') {
    if (prefs.salaryBand) {
      const { min, max, currency } = prefs.salaryBand
      const range = [min, max].filter((n): n is number => n !== null).map((n) => `${currency} ${n.toLocaleString('en-US')}`).join('–')
      if (range) lines.push(`- Salary band: ${range}`)
    }
    const e = prefs.eligibility
    if (e.currentCountry) lines.push(`- Lives in: ${e.currentCountry}`)
    if (e.citizenships.length) lines.push(`- Citizenships: ${e.citizenships.join(', ')}`)
    if (e.visas.length) lines.push(`- Visas: ${e.visas.map((v) => v.country).join(', ')}`)
    if (e.dealbreakers.length) lines.push(`- Dealbreakers: ${e.dealbreakers.join('; ')}`)
    if (prefs.extraContext) lines.push(`- Other context: ${prefs.extraContext}`)
  }
  return lines.join('\n')
}

function titleOf(vault: Vault, id: string): string | null {
  return vault.notes.get(id)?.title ?? null
}

function linkedTitles(vault: Vault, note: Note, type: Note['links'][number]['type'], dir: 'links' | 'backlinks' = 'links'): string[] {
  return note[dir].filter((l) => l.type === type).map((l) => titleOf(vault, l.id)).filter((t): t is string => Boolean(t))
}

function roleContext(exp: ExperienceNote): string {
  const span = formatSpan(exp.props.startDate, exp.props.endDate)
  return `${exp.props.role} at ${exp.props.company}${span ? `, ${span}` : ''}`
}

/** Where an evidence or project note sits, e.g. "Snr PM at Unity, Jul 2024 – present". */
export function contextOf(vault: Vault, note: Note): string | null {
  const parentId =
    note.type === 'evidence' ? note.props.parentId
    : note.type === 'project' ? note.props.experienceId
    : null
  const parent = parentId ? vault.notes.get(parentId) : undefined
  if (parent?.type === 'experience') return roleContext(parent)
  if (parent?.type === 'project') {
    const role = parent.props.experienceId ? vault.notes.get(parent.props.experienceId) : undefined
    return role?.type === 'experience' ? `${parent.title} — ${roleContext(role)}` : parent.title
  }
  return null
}

export function renderNote(vault: Vault, id: string, opts: RenderOptions = {}): string | null {
  const note = vault.notes.get(id)
  if (!note) return null
  const pii = opts.pii ?? 'scrub'
  const scrub = pii === 'scrub' ? makeContactScrubber(vault.identity.props.contact) : (s: string) => s
  const lines: string[] = []
  const pushEvidence = (heading: string, items: (Note | undefined)[]) => {
    const evidence = items.filter((e): e is Extract<Note, { type: 'evidence' }> => e?.type === 'evidence')
    if (!evidence.length) return
    lines.push('', heading)
    for (const e of evidence) {
      lines.push(`- [${e.props.kind}] ${scrub(e.props.description)}${e.props.impact ? ` (impact: ${scrub(e.props.impact)})` : ''}`)
    }
  }
  const list = (label: string, items: string[]) => {
    if (items.length) lines.push(`${label}: ${items.join(', ')}`)
  }

  switch (note.type) {
    case 'identity': {
      lines.push(`# ${note.props.name}`)
      if (note.props.headline) lines.push(note.props.headline)
      if (note.props.location) lines.push(`Location: ${note.props.location}`)
      if (pii === 'include') {
        const c = note.props.contact
        const parts = [c.email, c.phone, c.linkedIn, c.github, c.website].filter(Boolean)
        if (parts.length) lines.push(parts.join(' · '))
      }
      if (note.body) lines.push('', scrub(note.body))
      break
    }
    case 'preferences':
      lines.push('## Search preferences', formatPreferences(note.props, 'full') || 'Not set')
      break
    case 'experience': {
      const place = [note.props.location, note.props.remote ? 'Remote' : null].filter(Boolean).join(' · ')
      lines.push(`## ${note.title}`, `*${roleContext(note)}${place ? ` · ${place}` : ''}*`)
      if (note.body) lines.push('', scrub(note.body))
      pushEvidence('### Evidence', note.links.filter((l) => l.type === 'has').map((l) => vault.notes.get(l.id)))
      // Evidence owned by contained projects, so a role note stays self-contained.
      const projectEvidence = note.links
        .filter((l) => l.type === 'contains')
        .flatMap((l) => (vault.notes.get(l.id)?.links ?? []).filter((pl) => pl.type === 'has').map((pl) => vault.notes.get(pl.id)))
      pushEvidence('### Evidence from projects', projectEvidence)
      list('Projects', linkedTitles(vault, note, 'contains'))
      list('Uses', linkedTitles(vault, note, 'uses'))
      break
    }
    case 'evidence': {
      const ctx = contextOf(vault, note)
      lines.push(`**${note.props.kind === 'achievement' ? 'Achievement' : 'Responsibility'}**${ctx ? ` (${ctx})` : ''}: ${scrub(note.props.description)}`)
      if (note.props.impact) lines.push(`Impact: ${scrub(note.props.impact)}`)
      list('Demonstrates', linkedTitles(vault, note, 'demonstrates'))
      break
    }
    case 'project': {
      const span = formatSpan(note.props.startDate, note.props.endDate)
      const ctx = contextOf(vault, note)
      lines.push(`## ${note.title}`)
      const meta = [ctx, span, note.props.status !== 'active' ? note.props.status : null, note.props.url].filter(Boolean)
      if (meta.length) lines.push(`*${meta.join(' · ')}*`)
      if (note.body) lines.push('', scrub(note.body))
      const ownEvidence = note.links.filter((l) => l.type === 'has').map((l) => vault.notes.get(l.id))
      if (ownEvidence.length) pushEvidence('### Evidence', ownEvidence)
      else if (note.props.highlights.length) lines.push('', ...note.props.highlights.map((h) => `- ${scrub(h)}`))
      list('Uses', linkedTitles(vault, note, 'uses'))
      break
    }
    case 'capability': {
      lines.push(`## ${note.title}`, note.gist)
      const evidence = note.backlinks
        .filter((b) => b.type === 'demonstrates' || b.type === 'uses')
        .map((b) => vault.notes.get(b.id))
        .filter((n): n is Note => Boolean(n))
      if (evidence.length) {
        lines.push('', 'Evidence:')
        for (const n of evidence) {
          const ctx = contextOf(vault, n)
          lines.push(`- ${scrub(n.gist)}${ctx ? ` (${ctx})` : ''}`)
        }
      }
      list('Certified by', linkedTitles(vault, note, 'certifies', 'backlinks'))
      break
    }
    case 'education':
    case 'certification':
    case 'language':
      lines.push(note.gist)
      if (note.type === 'certification') list('Certifies', linkedTitles(vault, note, 'certifies'))
      break
  }
  // Scrub the whole render too: titles and linked names can hold contact values.
  return scrub(lines.join('\n')).trim()
}
