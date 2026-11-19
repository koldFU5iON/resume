// The readiness checks. Each is a small pure function over the vault that
// returns findings; thresholds are named constants. Messages are plain and
// specific, never accusatory, and quote only the owner's own titles and
// figures, never contact details. Expect a few false positives on the
// "consider" checks: they are phrased as questions.

import { certificationStatus, educationStatus } from '@/modules/cv-generation/write/status'
import { projectEvidenceText } from '@/modules/cv-generation/project-evidence'
import { isThinProject, THIN_PROJECT_MIN_CHARS } from '@/modules/cv-generation/write/limits'
import { notesOf } from '@/modules/profile-map/build'
import { formatMonth, normalizeName, oneLine } from '@/modules/profile-map/format'
import type { EvidenceNote, ExperienceNote, Note, ProjectNote, Vault } from '@/modules/profile-map/types'
import { capabilitiesHref, overviewHref, vaultNoteHref } from '@/modules/profile/note-index'
import type { Candidate, ReadinessKind, ReadinessSeverity } from './schema'

// ── Thresholds ─────────────────────────────────────────────────────────
// A project or role with less text than THIN_PROJECT_MIN_CHARS is "thin":
// that number lives with the CV writer (cv-generation/write/limits.ts) so the
// panel and the generator never disagree about what counts as thin.
/** Names this similar (token Jaccard) are the same project. */
export const DUPLICATE_NAME_SIMILARITY = 0.8
/** Descriptions this similar (content-word Jaccard) are the same project. */
export const DUPLICATE_TEXT_SIMILARITY = 0.7
/** Descriptions shorter than this many words are too short to compare. */
export const DUPLICATE_TEXT_MIN_WORDS = 8
/** A role with no evidence is a 'fix' only if it is current or ended within this many years (older roles collapse into Earlier Experience)... */
export const EXPERIENCE_RECENT_YEARS = 5
/** ...and its summary is shorter than this many characters. */
export const EXPERIENCE_SHORT_BODY_CHARS = 120
/** Two roles at different employers must overlap this long to be mentioned. */
export const CONCURRENT_MIN_OVERLAP_MONTHS = 3
/** A longer stretch between employers is mentioned. */
export const EMPLOYMENT_GAP_MONTHS = 12
/** Achievements without a figure or outcome are raised when at least this many... */
export const UNMEASURED_MIN_COUNT = 3
/** ...and at least this share of all achievements. */
export const UNMEASURED_MIN_SHARE = 0.5
/** A responsibility of fewer words than this reads as filler. */
export const FILLER_RESPONSIBILITY_WORDS = 6
/** An activity of more words than this is several bullets in one. */
export const LONG_ACTIVITY_WORDS = 60
/** At most this many concurrent-role findings (one per role): four board seats must not crowd out everything else. */
export const CONCURRENT_MAX_FINDINGS = 3
/** Two items at one employer must share at least this share (Jaccard) of content words to be compared... */
export const CONFLICT_MIN_SIMILARITY = 0.5
/** ...and at least this many content words. */
export const CONFLICT_SHARED_WORDS = 3
/** At most this many possible conflicts are raised: the check is deliberately conservative. */
export const CONFLICT_MAX_FINDINGS = 3
/** Claimed-only capabilities are raised when there are at least this many. */
export const CLAIMED_ONLY_MIN = 3
/** Evidence with no capability link is raised when at least this many items, and this share of all evidence. */
export const UNLINKED_EVIDENCE_MIN = 3
export const UNLINKED_EVIDENCE_MIN_SHARE = 0.5
/** Items listed by name in an aggregate finding. */
export const LIST_LIMIT = 5
export const CAPABILITY_LIST_LIMIT = 10

// ── Helpers ────────────────────────────────────────────────────────────
const MONTH_MS = 30.4375 * 24 * 3600 * 1000
const monthsBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / MONTH_MS
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length
const quote = (s: string, max = 70) => `"${oneLine(s, max)}"`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

type Parts = Omit<Candidate, 'id' | 'impact' | 'noteId' | 'noteType' | 'editHref'> & { impact?: number }

/** A finding about a note, with its edit link; `salt` keeps ids unique when one note has several of a kind. */
function about(note: Note, p: Parts, salt = ''): Candidate {
  return {
    ...p, impact: p.impact ?? 1, id: `${p.kind}:${note.id}${salt}`, noteId: note.id, noteType: note.type, editHref: vaultNoteHref(note),
  }
}

/** A finding about the profile as a whole. */
function overall(p: Parts, href?: string, anchor?: Note): Candidate {
  return {
    ...p, impact: p.impact ?? 1, id: p.kind, editHref: href,
    ...(anchor ? { noteId: anchor.id, noteType: anchor.type } : {}),
  }
}

function evidenceOf(vault: Vault, narrative: Note): EvidenceNote[] {
  return narrative.links
    .filter((l) => l.type === 'has')
    .map((l) => vault.notes.get(l.id))
    .filter((n): n is EvidenceNote => n?.type === 'evidence')
}

function containedProjects(vault: Vault, exp: ExperienceNote): ProjectNote[] {
  return exp.links.filter((l) => l.type === 'contains').map((l) => vault.notes.get(l.id)).filter((n): n is ProjectNote => n?.type === 'project')
}

/** Evidence of a role, including that of the projects under it. */
function roleEvidence(vault: Vault, exp: ExperienceNote): EvidenceNote[] {
  return [...evidenceOf(vault, exp), ...containedProjects(vault, exp).flatMap((p) => evidenceOf(vault, p))]
}

const evidenceText = (e: EvidenceNote) => [e.props.description, e.props.impact ?? ''].filter(Boolean).join(' ')

/** The text a narrative gives a writer: its body, its highlights and its own evidence. */
function narrativeText(vault: Vault, note: ExperienceNote | ProjectNote): string {
  const own = evidenceOf(vault, note).map(evidenceText)
  const highlights = note.type === 'project' ? note.props.highlights.map(String) : []
  // A role's text includes what its projects say: that is where many people put it.
  const projects = note.type === 'experience' ? containedProjects(vault, note).map((p) => narrativeText(vault, p)) : []
  return [note.body ?? '', ...highlights, ...own, ...projects].join(' ')
}

const roleName = (e: ExperienceNote) => `${e.props.role} at ${e.props.company}`

function thinNotes(vault: Vault): (ExperienceNote | ProjectNote)[] {
  const thin: (ExperienceNote | ProjectNote)[] = []
  for (const p of notesOf(vault, 'project')) if (projectEvidenceText(p, vault).thin) thin.push(p)
  for (const e of notesOf(vault, 'experience')) if (isThinProject({ name: '', text: narrativeText(vault, e) })) thin.push(e)
  return thin
}

// ── Thin narratives ────────────────────────────────────────────────────
/** Current, or ended within EXPERIENCE_RECENT_YEARS: older roles collapse into Earlier Experience, so thin data there never earns a 'fix'. */
function isRecent(e: ExperienceNote, now: Date): boolean {
  const cutoff = new Date(now)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - EXPERIENCE_RECENT_YEARS)
  return !e.props.endDate || e.props.endDate.getTime() >= cutoff.getTime()
}

export function checkThinNarratives(vault: Vault, now: Date): Candidate[] {
  return thinNotes(vault).map((n) => about(n, n.type === 'project'
    ? {
        kind: 'thin_narrative', severity: 'fix', impact: 9, title: `${n.props.name}: only a title`,
        message: `Project "${n.props.name}" has only its title: add what you did and the result so the CV can use it.`,
        suggestion: 'Open the project and write two or three lines: what it was, what you did, and what came of it.',
      }
    : {
        kind: 'thin_narrative', severity: isRecent(n, now) ? 'fix' : 'consider', impact: 8, title: `${roleName(n)}: almost no text`,
        message: `Your role as ${roleName(n)} has almost no text: nothing to write the CV from.`,
        suggestion: 'Open the role and add the scope, your team and what you achieved, or add achievements under it.',
      }))
}

const STOPWORDS = new Set(['with', 'that', 'this', 'from', 'have', 'been', 'were', 'into', 'over', 'about', 'across', 'which', 'while', 'their', 'than', 'then', 'them', 'they', 'also', 'more', 'each', 'when', 'after', 'before'])

// ── Duplicate projects ─────────────────────────────────────────────────
const SMALL_WORDS = new Set(['the', 'and', 'for', 'of', 'to', 'in', 'on', 'at', 'an'])
/** Lowercase words without stopwords or one-letter tokens: the "content words" the similarity tests use. */
const contentTokens = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOPWORDS.has(w) && !SMALL_WORDS.has(w)))
const numberTokens = (s: string) => (s.match(/\d+/g) ?? []).sort().join(',')
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / (a.size + b.size - shared)
}

export function checkDuplicateProjects(vault: Vault): Candidate[] {
  const info = notesOf(vault, 'project').map((p) => ({
    note: p,
    name: contentTokens(p.props.name),
    text: contentTokens(narrativeText(vault, p).toLowerCase().split(p.props.name.toLowerCase()).join(' ')),
  }))
  const out: Candidate[] = []
  info.forEach((b, j) => {
    const a = info.slice(0, j).find((x) => {
      // "Awards 2024" and "Awards 2025" are recurring projects, not copies.
      if (numberTokens(x.note.props.name) !== numberTokens(b.note.props.name)) return false
      const sameText = x.text.size >= DUPLICATE_TEXT_MIN_WORDS && b.text.size >= DUPLICATE_TEXT_MIN_WORDS && jaccard(x.text, b.text) >= DUPLICATE_TEXT_SIMILARITY
      const sameName = normalizeName(x.note.props.name) === normalizeName(b.note.props.name) || jaccard(x.name, b.name) >= DUPLICATE_NAME_SIMILARITY
      // One name under two different roles is a different piece of work, unless the text says it is the same.
      return sameText || (sameName && x.note.props.experienceId === b.note.props.experienceId)
    })
    if (!a) return
    out.push(about(b.note, {
      kind: 'duplicate_project', severity: 'consider', impact: 5, title: `${b.note.props.name}: possible duplicate`,
      message: `Projects "${a.note.props.name}" and "${b.note.props.name}" look like the same project entered twice.`,
      suggestion: 'If so, keep the one with more detail and delete the other, so the CV does not repeat it or split its evidence. If they are different pieces of work, tell them apart in the name.',
    }))
  })
  return out
}

// ── Certifications ─────────────────────────────────────────────────────
// The generator reads "in progress" from a future issue date OR in-progress wording in the name
// (write/status.ts), on purpose: "AWS SA (in progress)" with a future date is fine. Only bracketed or
// suffix wording counts as typed status; "Ongoing Professional Development" and "Expected Credit Loss" are names.
const TYPED_STATUS = /\([^)]*\b(?:in[\s-]?progress|pending)\b[^)]*\)|[-–—,:]\s*(?:in[\s-]?progress|pending)\s*$/i

export function checkCertifications(vault: Vault, now: Date): Candidate[] {
  const out: Candidate[] = []
  for (const c of notesOf(vault, 'certification')) {
    const { name, issuer, issueDate } = c.props
    if (!issuer?.trim()) {
      out.push(about(c, {
        kind: 'cert_no_issuer', severity: 'consider', impact: 5, title: `${name}: no issuer`,
        message: `Certification "${name}" has no issuer.`,
        suggestion: 'Add who awards it (for example the institute or vendor); a certification without one is easy to doubt.',
      }))
    }
    const typedStatus = TYPED_STATUS.test(name) && !(issueDate && issueDate.getTime() > now.getTime())
    if (typedStatus) {
      out.push(about(c, {
        kind: 'cert_status_in_name', severity: 'consider', impact: 6, title: `${name}: status in the name`,
        message: `Certification "${name}" has its status typed into the name.`,
        suggestion: 'Keep the name to the credential itself and set the issue date to the expected date of completion: a future issue date marks it as in progress.',
      }))
      if (!issueDate) {
        out.push(about(c, {
          kind: 'cert_in_progress_no_date', severity: 'consider', impact: 3, title: `${name}: no expected date`,
          message: `"${name}" reads as in progress but has no expected date.`,
          suggestion: 'Add the date you expect to finish as the issue date.',
        }))
      }
    }
    if (certificationStatus(c.props, now) === 'expired') {
      out.push(about(c, {
        kind: 'cert_expired', severity: 'consider', impact: 3, title: `${name}: expired`,
        message: `Certification "${name}" expired${c.props.expiryDate ? ` in ${formatMonth(c.props.expiryDate)}` : ''} but is still listed.`,
        suggestion: 'If you renewed it, update the expiry date; if not, remove it or leave it, knowing the CV will not present it as current.',
      }))
    }
  }
  return out
}

// ── Education ──────────────────────────────────────────────────────────
export function checkEducation(vault: Vault, now: Date): Candidate[] {
  const out: Candidate[] = []
  for (const e of notesOf(vault, 'education')) {
    const { qualification, institution, startDate, endDate } = e.props
    const label = `${qualification} at ${institution}`
    if (endDate && endDate.getTime() < startDate.getTime()) {
      out.push(about(e, {
        kind: 'education_dates_reversed', severity: 'fix', impact: 5, title: `${qualification}: dates reversed`,
        message: `${label} ends (${formatMonth(endDate)}) before it starts (${formatMonth(startDate)}).`,
        suggestion: 'Correct the start or end date.',
      }))
    } else if (educationStatus(e.props, now) === 'undated') {
      out.push(about(e, {
        kind: 'education_undated', severity: 'consider', impact: 2, title: `${qualification}: no end date`,
        message: `${label} started in ${formatMonth(startDate)} and has no end date. Did you finish it?`,
        suggestion: 'Add the end date. Without one the CV claims neither that you completed it nor that you are studying.',
      }))
    }
  }
  return out
}

// ── Experience dates ───────────────────────────────────────────────────
const span = (e: ExperienceNote) => `${formatMonth(e.props.startDate)} – ${e.props.endDate ? formatMonth(e.props.endDate) : 'present'}`

export function checkExperienceDates(vault: Vault, now: Date): Candidate[] {
  const out: Candidate[] = []
  const valid: ExperienceNote[] = []
  for (const e of notesOf(vault, 'experience')) {
    if (e.props.endDate && e.props.endDate.getTime() < e.props.startDate.getTime()) {
      out.push(about(e, {
        kind: 'experience_dates_reversed', severity: 'fix', impact: 8, title: `${roleName(e)}: dates reversed`,
        message: `${roleName(e)} ends (${formatMonth(e.props.endDate)}) before it starts (${formatMonth(e.props.startDate)}).`,
        suggestion: 'Correct the start or end date.',
      }))
    } else valid.push(e)
  }
  const endOf = (e: ExperienceNote) => e.props.endDate ?? now

  const overlaps = new Map<string, { note: ExperienceNote; with: { note: ExperienceNote; months: number }[] }>()
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const [a, b] = valid[i].props.startDate <= valid[j].props.startDate ? [valid[i], valid[j]] : [valid[j], valid[i]]
      if (normalizeName(a.props.company) === normalizeName(b.props.company)) continue
      const months = monthsBetween(b.props.startDate, endOf(a) < endOf(b) ? endOf(a) : endOf(b))
      if (months < CONCURRENT_MIN_OVERLAP_MONTHS) continue
      const entry = overlaps.get(b.id) ?? { note: b, with: [] }
      entry.with.push({ note: a, months })
      overlaps.set(b.id, entry)
    }
  }
  const concurrent = [...overlaps.values()]
    .map((o) => ({ ...o, longest: Math.max(...o.with.map((w) => w.months)) }))
    .sort((x, y) => y.longest - x.longest)
    .slice(0, CONCURRENT_MAX_FINDINGS)
  for (const { note: b, with: others, longest } of concurrent) {
    out.push(about(b, {
      kind: 'concurrent_roles', severity: 'consider', impact: 2 + Math.min(longest / 12, 2),
      title: `${b.props.company} alongside ${others.map((o) => o.note.props.company).join(', ')}`,
      message: `${roleName(b)} (${span(b)}) ran alongside ${others.map((o) => `${roleName(o.note)} (${span(o.note)})`).join(', ')}.`,
      suggestion: 'If that is right, say in the role that it was concurrent (a side engagement, part-time, a board seat) so the CV does not look like double-counting; if not, correct the dates.',
    }))
  }

  const byStart = [...valid].sort((a, b) => a.props.startDate.getTime() - b.props.startDate.getTime())
  let latest: ExperienceNote | null = null
  for (const e of byStart) {
    if (latest) {
      const gap = monthsBetween(endOf(latest), e.props.startDate)
      if (gap > EMPLOYMENT_GAP_MONTHS) {
        out.push(about(e, {
          kind: 'employment_gap', severity: 'consider', impact: 2,
          title: `About ${Math.round(gap)} months between ${latest.props.company} and ${e.props.company}`,
          message: `There are about ${Math.round(gap)} months between ${roleName(latest)} (ended ${formatMonth(endOf(latest))}) and ${roleName(e)} (started ${formatMonth(e.props.startDate)}).`,
          suggestion: 'Nothing is wrong with a gap, but a reader will ask. Add what you did (study, caring, a break, freelance work) or confirm the dates.',
        }, `:${latest.id}`))
      }
    }
    if (!latest || endOf(e) > endOf(latest)) latest = e
  }
  return out
}

// ── Experience with no evidence ────────────────────────────────────────
export function checkExperienceEvidence(vault: Vault, now: Date): Candidate[] {
  const thin = new Set(thinNotes(vault).map((n) => n.id))
  return notesOf(vault, 'experience')
    .filter((e) => !thin.has(e.id) && roleEvidence(vault, e).length === 0)
    .map((e) => {
      const recent = isRecent(e, now)
      return about(e, {
        kind: 'experience_no_evidence', severity: recent && (e.body?.length ?? 0) < EXPERIENCE_SHORT_BODY_CHARS && containedProjects(vault, e).length === 0 ? 'fix' : 'consider',
        impact: recent ? 6 : 2, title: `${roleName(e)}: no achievements or responsibilities`,
        message: `${roleName(e)} has no achievements or responsibilities listed, only its summary.`,
        suggestion: 'Add the two or three things you did there that you would want a reader to know, with a result where you have one.',
      })
    })
}

// ── Role overview ──────────────────────────────────────────────────────
/** A role with achievements but an overview under THIN_PROJECT_MIN_CHARS gives the CV writer nothing concrete for the summary line, so the summary is left out. */
export function checkRoleOverview(vault: Vault, now: Date): Candidate[] {
  const thin = new Set(thinNotes(vault).map((n) => n.id))
  return notesOf(vault, 'experience')
    .filter((e) => !thin.has(e.id) && roleEvidence(vault, e).length > 0 && (e.body ?? '').trim().length < THIN_PROJECT_MIN_CHARS)
    .map((e) => about(e, {
      kind: 'role_overview_thin', severity: 'consider', impact: isRecent(e, now) ? 3 : 1, title: `${roleName(e)}: no overview`,
      message: `${roleName(e)} has achievements but almost no overview, so the CV cannot say what ${e.props.company} is or what your remit was.`,
      suggestion: 'Add a line or two to the role: what the employer is (size, market, products), your team or region and your remit.',
    }))
}

// ── Evidence quality ───────────────────────────────────────────────────
const HAS_FIGURE = /\d/

export function checkEvidenceQuality(vault: Vault): Candidate[] {
  const out: Candidate[] = []
  const evidence = notesOf(vault, 'evidence')

  const achievements = evidence.filter((e) => e.props.kind === 'achievement')
  const unmeasured = achievements.filter((e) => !e.props.impact?.trim() && !HAS_FIGURE.test(e.props.description))
  if (unmeasured.length >= UNMEASURED_MIN_COUNT && unmeasured.length / achievements.length >= UNMEASURED_MIN_SHARE) {
    const worst = [...unmeasured].sort((a, b) => a.props.description.length - b.props.description.length).slice(0, LIST_LIMIT)
    out.push(overall({
      kind: 'unmeasured_achievements', severity: 'consider', impact: 4, title: 'Achievements with no figure or outcome',
      message: `${unmeasured.length} of ${achievements.length} achievements have no figure or outcome. Weakest: ${worst.map((e) => quote(e.props.description)).join('; ')}.`,
      suggestion: 'Add what changed (a number, a time saved, a result someone noticed). Where you truly have none, the writer will use the claim without one.',
    }, vaultNoteHref(worst[0]), worst[0]))
  }

  const filler = evidence.filter((e) => e.props.kind === 'responsibility' && words(e.props.description) < FILLER_RESPONSIBILITY_WORDS)
  if (filler.length > 0) {
    out.push(overall({
      kind: 'filler_responsibility', severity: 'consider', impact: 2, title: 'Very short responsibilities',
      message: `${plural(filler.length, 'responsibility', 'responsibilities')} ${filler.length === 1 ? 'is' : 'are'} under ${FILLER_RESPONSIBILITY_WORDS} words, which reads as filler: ${filler.slice(0, LIST_LIMIT).map((e) => quote(e.props.description)).join('; ')}.`,
      suggestion: 'Say what you were responsible for and how far it reached, or remove the line.',
    }, vaultNoteHref(filler[0]), filler[0]))
  }

  const long = evidence.filter((e) => words(e.props.description) > LONG_ACTIVITY_WORDS)
  if (long.length > 0) {
    out.push(overall({
      kind: 'long_activity', severity: 'consider', impact: 2, title: 'Very long activities',
      message: `${plural(long.length, 'activity', 'activities')} ${long.length === 1 ? 'runs' : 'run'} past ${LONG_ACTIVITY_WORDS} words (${long.slice(0, LIST_LIMIT).map((e) => `${words(e.props.description)} words`).join(', ')}): ${quote(long[0].props.description, 60)}.`,
      suggestion: 'Split each into separate achievements, one claim each, so the CV can pick the strongest.',
    }, vaultNoteHref(long[0]), long[0]))
  }
  return out
}

// ── Possibly conflicting figures ───────────────────────────────────────
const NUMBER = /(?<![\p{L}\p{N}])[£$€]?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|bn|[km]\b|x\b))?/giu

/** Figures in a text, each with a unit class so 30% is never compared with 12 episodes. */
function figuresOf(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of text.match(NUMBER) ?? []) {
    const n = m.replace(/[,\s]/g, '').toLowerCase()
    if (/^(19|20)\d\d$/.test(n)) continue // a year, not a figure
    out.set(n, n.endsWith('%') ? 'percent' : /^[£$€]/.test(n) ? 'currency' : n.endsWith('x') ? 'multiple' : 'count')
  }
  return out
}
const contentWords = (text: string) => new Set((text.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !STOPWORDS.has(w)))

export function checkConflictingFigures(vault: Vault): Candidate[] {
  const out: Candidate[] = []
  for (const exp of notesOf(vault, 'experience')) {
    const items = roleEvidence(vault, exp)
      .map((e) => ({ e, text: evidenceText(e), figures: figuresOf(evidenceText(e)), words: contentWords(evidenceText(e)) }))
      .filter((i) => i.figures.size > 0)
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const [a, b] = [items[i], items[j]]
        if ([...a.figures.keys()].some((f) => b.figures.has(f))) continue
        if (![...a.figures.values()].some((u) => [...b.figures.values()].includes(u))) continue
        if (jaccard(a.words, b.words) < CONFLICT_MIN_SIMILARITY) continue
        if ([...a.words].filter((w) => b.words.has(w)).length < CONFLICT_SHARED_WORDS) continue
        out.push(about(b.e, {
          kind: 'conflicting_figures', severity: 'consider', impact: 3, title: `Two figures for similar work at ${exp.props.company}`,
          message: `At ${exp.props.company}, ${quote(a.e.props.description)} (${[...a.figures.keys()].join(', ')}) and ${quote(b.e.props.description)} (${[...b.figures.keys()].join(', ')}) look like the same work with different figures. Is one out of date?`,
          suggestion: 'If they are the same result, keep one figure; if they differ (two periods, two scopes), say so in the text so the CV does not pick the wrong one.',
        }, `:${a.e.id}`))
      }
    }
  }
  return out.slice(0, CONFLICT_MAX_FINDINGS)
}

// ── Capabilities ───────────────────────────────────────────────────────
export function checkCapabilities(vault: Vault): Candidate[] {
  const out: Candidate[] = []
  const caps = notesOf(vault, 'capability')

  const claimed = caps.filter((c) => c.props.status === 'claimed')
  if (claimed.length >= CLAIMED_ONLY_MIN) {
    const listed = claimed.slice(0, CAPABILITY_LIST_LIMIT).map((c) => c.props.name)
    out.push(overall({
      kind: 'claimed_only_capabilities', severity: 'consider', impact: 3, title: 'Skills with no evidence',
      message: `${claimed.length} of ${caps.length} skills and tools are listed but nothing in your profile backs them: ${listed.join(', ')}${claimed.length > listed.length ? ` and ${claimed.length - listed.length} more` : ''}.`,
      suggestion: 'Link each to an achievement that shows it, or mention it in a role or project. The CV leans on skills with evidence behind them.',
    }, capabilitiesHref()))
  }

  const evidence = notesOf(vault, 'evidence')
  const unlinked = evidence.filter((e) => !e.links.some((l) => l.type === 'demonstrates'))
  if (caps.length > 0 && unlinked.length >= UNLINKED_EVIDENCE_MIN && unlinked.length / evidence.length >= UNLINKED_EVIDENCE_MIN_SHARE) {
    out.push(overall({
      kind: 'unlinked_evidence', severity: 'consider', impact: 3, title: 'Evidence not linked to a skill',
      message: `${unlinked.length} of ${evidence.length} achievements and responsibilities are not linked to any skill or tool.`,
      suggestion: 'Link each to the skills it shows. The "Suggest links" button on your profile overview asks AI to propose links for you to review.',
    }, overviewHref()))
  }

  const unresolved = [...new Map(vault.unresolved.map((u) => [normalizeName(u.name), u.name])).values()]
  if (unresolved.length > 0) {
    out.push(overall({
      kind: 'unlisted_capability', severity: 'consider', impact: 2, title: 'Skills named in text but not listed',
      message: `${unresolved.slice(0, LIST_LIMIT).map((n) => `"${n}"`).join(', ')} ${unresolved.length === 1 ? 'is' : 'are'} named in your notes but not in your skills and tools.`,
      suggestion: 'Add them to your skills and tools so they link up, or remove the double brackets.',
    }, capabilitiesHref()))
  }
  return out
}

// ── Contact and header ─────────────────────────────────────────────────
export function checkContact(vault: Vault): Candidate[] {
  const out: Candidate[] = []
  const { contact, location } = vault.identity.props
  const missing = ([['email', contact.email], ['phone', contact.phone], ['LinkedIn', contact.linkedIn]] as const)
    .filter(([, v]) => !v?.trim()).map(([k]) => k)
  const link = overviewHref()
  if (missing.length > 0) {
    const severity: ReadinessSeverity = missing.includes('email') ? 'fix' : 'consider'
    out.push(overall({
      kind: 'contact_missing', severity, impact: severity === 'fix' ? 9 : 2, title: 'Contact details missing from the CV header',
      message: `Your profile has no ${missing.join(', ')}; the CV header shows only what is filled in.`,
      suggestion: 'Add them to your profile overview. They go into the header in code and are never sent to the model.',
    }, link, vault.identity))
  }
  if (!location?.trim()) {
    out.push(overall({
      kind: 'location_missing', severity: 'consider', impact: 2, title: 'No location',
      message: 'Your profile has no location, so the CV header cannot show where you are based.',
      suggestion: 'Add your city or region to your profile overview.',
    }, link, vault.identity))
  }
  const eligibility = vault.preferences.props.eligibility
  if (eligibility && (eligibility.citizenships.length > 0 || eligibility.visas.length > 0)) {
    out.push(overall({
      kind: 'right_to_work_not_shown', severity: 'consider', impact: 1, title: 'Right to work is not shown on the CV',
      message: 'Your search preferences record where you can work, but the CV header cannot show right to work yet.',
      suggestion: 'If a job asks for it, add a line to the CV by hand after generating.',
    }, link, vault.identity))
  }
  return out
}

export type { ReadinessKind }
