/**
 * Stage 3, Write (docs/cv-generation.md). Two waves:
 *
 * Wave 1, in parallel (at most WRITE_CONCURRENCY calls at once): one experience
 * writer per employer that shows bullets, and the skills/tools grouping.
 * Employers listed without bullets are rendered entirely by code (no call), as
 * ONE "Earlier Experience" section: one line each, newest first.
 * Wave 2, after wave 1: the profile, headline and competencies, which read the
 * wave-1 text.
 *
 * Titles, companies, dates, progression lines, certifications, education and
 * languages are rendered by code from the profile. Every call carries the
 * run's attribution; nothing here names a model (roles choose it).
 *
 * Time: wave 1 has its own deadline, WAVE2_RESERVE_MS before the write
 * stage's, so wave 2 is never left with seconds; the cheap skills task starts
 * first. A call that times out (or a wave 2 that has no time to start) never
 * loses the wave-1 work: an employer falls back to its own activity text and
 * the profile section to a deterministic one (fallbackProfile), both logged.
 *
 * A writer that cannot produce usable output after its one retry fails the run
 * (LLMError invalid_output). The skills grouping falls back to code ordering.
 * A failure is thrown as WriteStageError, carrying the section rows and the
 * usage so far, so the runner can still log them.
 */

import { LLMError } from '@/modules/llm/errors'
import {
  loadCVWriteExperiencePrompt, loadCVWriteProfilePrompt, loadCVWriteSkillsPrompt, loadWritingContext,
} from '@/modules/llm/prompt-context'
import type { Vault } from '@/modules/profile-map/types'
import { addUsage, CutOffError, NO_USAGE, usageOfError, type CallUsage } from '../call'
import { MAX_CHECK_NOTES, WRITE_CONCURRENCY, type CvBrief, type CvSelection, type SectionLogEntry } from '../schema'
import type { Strategy } from '../strategy'
import { countOf } from '../text'
import { evidenceFromVault, type EmployerEvidence } from './evidence'
import { fallbackExperience, writeExperience } from './experience'
import { ASSEMBLE_RESERVE_MS, MIN_CALL_MS, WAVE2_MIN_START_MS, WAVE2_RESERVE_MS } from './limits'
import { runPool } from './pool'
import { experienceDigest, fallbackProfile, writeProfile } from './profile'
import { requirementText } from './prompt'
import { renderCertifications, renderEarlierExperience, renderEducation, renderLanguages } from './render'
import { writeSkills } from './skills'
import { CHECK_KIND_RANK, type CheckNote, type WriteContext, type WrittenSection } from './types'

export type WriteResult = {
  /** Every section written, in the order they finished (assemble.ts orders them). */
  sections: WrittenSection[]
  /** The headline for the header; null when none was written or it was dropped. */
  headline: string | null
  /** At most MAX_CHECK_NOTES "worth a quick check" notes, by priority (invented figures, claimed tools, credentials, education dates) then employer order. */
  checkNotes: string[]
  /** Stage-level notes (not tied to one section). */
  notes: string[]
  usage: CallUsage
  /** Distinct models the sections ran on. */
  models: string[]
}

/** A write failure, carrying the section rows logged so far so the run log can show them. */
export class WriteStageError extends Error {
  constructor(readonly original: unknown, readonly sectionLogs: SectionLogEntry[], readonly usage: CallUsage = NO_USAGE) {
    super(original instanceof Error ? original.message : 'The write stage failed.')
    this.name = 'WriteStageError'
  }
}

const tokensOf = (u: CallUsage) => ({ input: u.input, output: u.output })

function logOf(id: string, label: string, over: Partial<SectionLogEntry>): SectionLogEntry {
  return { id, label, status: 'ok', model: null, durationMs: 0, tokens: { input: 0, output: 0 }, costUsd: null, retries: 0, retryReasons: [], notes: [], ...over }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t = Date.now()
  const value = await fn()
  return { value, ms: Date.now() - t }
}

/** Throws a timeout when there is no time left to start another call. */
function ensureTime(deadline: number): void {
  if (deadline - Date.now() < MIN_CALL_MS) throw new LLMError('The run ran out of time before every section was written.', 'timeout')
}

/** Singular names of the flat sections, for log notes. */
const SECTION_WORD: Record<string, string> = { skills: 'skill', tools: 'tool', competencies: 'competency', certifications: 'certification', education: 'education', projects: 'project' }

const experienceLabel = (e: EmployerEvidence['employer']) => `Experience: ${e.latestTitle} — ${e.company}`

/** A "worth a quick check" note with where it came from, for a stable order. */
type RankedCheck = CheckNote & { order: number }

const isTimeout = (err: unknown) => err instanceof LLMError && err.kind === 'timeout'

export async function runWrite(
  vault: Vault,
  brief: CvBrief,
  selection: CvSelection,
  strategy: Pick<Strategy, 'mustHave' | 'niceToHave'>,
  ctx: { profileId: string; jobApplicationId: string; runId: string; deadline: number; writingDeskDocumentId?: string | null },
): Promise<WriteResult> {
  const evidence = evidenceFromVault(vault, selection)
  const writeDeadline = ctx.deadline - ASSEMBLE_RESERVE_MS
  const startedAt = Date.now()
  const w: WriteContext = {
    ...ctx,
    deadline: writeDeadline,
    brief,
    strategy,
    evidence,
    requirementText: requirementText(strategy),
  }
  // Wave 1 stops early enough to leave wave 2 its time (but never gets less than half of what there is).
  const w1: WriteContext = { ...w, deadline: Math.max(writeDeadline - WAVE2_RESERVE_MS, startedAt + (writeDeadline - startedAt) / 2) }
  const sections: WrittenSection[] = []
  const failedLogs: SectionLogEntry[] = []
  const checks: RankedCheck[] = []
  const notes: string[] = []
  const models = new Set<string>()
  let usage: CallUsage = NO_USAGE
  const keep = (s: WrittenSection) => {
    sections.push(s)
    if (s.model) models.add(s.model)
  }
  const addCost = (u: CallUsage) => { usage = addUsage(usage, u) }
  const employerIndex = new Map(evidence.employers.map((e, i) => [e.employer.key, i]))
  const note = (c: CheckNote, order: number) => checks.push({ ...c, order })
  /** The tokens of a failed section: whatever calls did answer before the failure. */
  const spent = (err: unknown) => {
    const u = usageOfError(err)
    addCost(u)
    return u
  }

  try {
    // Nothing written yet, so nothing to keep: a run with no time at all fails as a timeout.
    ensureTime(writeDeadline)
    const [writing, expPrompt, skillsPrompt, profilePrompt] = await Promise.all([
      loadWritingContext(ctx.profileId),
      loadCVWriteExperiencePrompt(ctx.profileId),
      loadCVWriteSkillsPrompt(ctx.profileId),
      loadCVWriteProfilePrompt(ctx.profileId),
    ])
    const rules = { rules: writing.rules, brief: writing.brief }

    // Wave 1. Employers without bullets are rendered by code right away, as one Earlier Experience list (newest first).
    const withBullets: EmployerEvidence[] = []
    const earlier: EmployerEvidence['employer'][] = []
    const earlierNotes: string[] = []
    for (const e of evidence.employers) {
      if (e.employer.headerOnly || (e.activities.length === 0 && e.projects.length === 0)) {
        earlier.push(e.employer)
        if (!e.employer.headerOnly) earlierNotes.push(`${e.employer.company}: none of its selected activities is still in the profile, so it is listed here without bullets.`)
      } else {
        withBullets.push(e)
      }
    }
    const earlierMarkdown = renderEarlierExperience(earlier)
    if (earlierMarkdown) {
      keep({
        id: 'earlier-experience', kind: 'earlier-experience', markdown: earlierMarkdown,
        log: logOf('earlier-experience', 'Earlier experience', { notes: [`${countOf(earlier.length, 'employer')} listed without bullets, one line each, newest first: rendered by code from your profile, no model call.`, ...earlierNotes] }),
      })
    }

    const digests = new Map<string, { summary: string; bullets: string[] }>()
    type Task = { kind: 'experience'; emp: EmployerEvidence } | { kind: 'skills' }
    // The cheap skills call first, so the employers (the long calls) start right after it.
    const tasks: Task[] = [{ kind: 'skills' }, ...withBullets.map((emp): Task => ({ kind: 'experience', emp }))]
    const results = await runPool(tasks, WRITE_CONCURRENCY, async (task) => {
      const id = task.kind === 'experience' ? `experience:${task.emp.employer.key}` : 'skills'
      const label = task.kind === 'experience' ? experienceLabel(task.emp.employer) : 'Skills and tools'
      const t0 = Date.now()
      try {
        if (task.kind === 'experience') {
          const key = task.emp.employer.key
          try {
            ensureTime(w1.deadline)
            const { value: out, ms } = await timed(() => writeExperience(w1, task.emp, { ...rules, prompt: expPrompt }))
            digests.set(key, { summary: out.summary, bullets: out.bullets })
            addCost(out.usage)
            out.checks.forEach((c) => note(c, employerIndex.get(key) ?? 0))
            keep({
              id, kind: 'experience', employerKey: key, markdown: out.markdown, bullets: out.provenance, model: out.model ?? undefined, tokens: tokensOf(out.usage),
              log: logOf(id, label, { model: out.model, durationMs: ms, tokens: tokensOf(out.usage), costUsd: out.usage.costUsd, retries: out.retries, retryReasons: out.retryReasons, notes: out.notes }),
            })
          } catch (err) {
            if (!isTimeout(err) && !(err instanceof CutOffError)) throw err
            // Out of time, or cut off at the largest output budget: the employer is listed with its own activity text instead of failing the run.
            const u = spent(err)
            const fb = fallbackExperience(task.emp)
            digests.set(key, { summary: fb.summary, bullets: fb.bullets })
            keep({
              id, kind: 'experience', employerKey: key, markdown: fb.markdown, bullets: fb.provenance, tokens: tokensOf(u),
              log: logOf(id, label, { durationMs: Date.now() - t0, tokens: tokensOf(u), costUsd: u.calls > 0 ? u.costUsd : null, notes: [err instanceof CutOffError ? 'The answer was cut off at the largest output budget, so the bullets are your own activity text from the profile, with no summary.' : 'The run ran out of time for this entry, so its bullets are your own activity text from the profile, with no summary.', ...fb.notes] }),
            })
          }
          return
        }
        const { value: s, ms } = await timed(() => writeSkills(w1, { ...rules, prompt: skillsPrompt }))
        addCost(s.usage)
        // One call wrote both lists: its cost is on the first row that exists.
        const rows: Array<{ id: string; label: string; kind: string; markdown: string }> = [
          { id: 'tools', label: 'Tools', kind: 'tools', markdown: s.toolsMarkdown },
          { id: 'skills', label: 'Skills', kind: 'skills', markdown: s.skillsMarkdown },
        ].filter((r) => r.markdown)
        rows.forEach((r, i) => keep({
          id: r.id, kind: r.kind, markdown: r.markdown, model: s.model ?? undefined, tokens: tokensOf(i === 0 ? s.usage : NO_USAGE),
          log: logOf(r.id, r.label, {
            model: s.model, durationMs: i === 0 ? ms : 0, tokens: tokensOf(i === 0 ? s.usage : NO_USAGE), costUsd: s.usage.calls > 0 ? (i === 0 ? s.usage.costUsd : 0) : null,
            retries: i === 0 ? s.retries : 0, retryReasons: i === 0 ? s.retryReasons : [], notes: i === 0 ? s.notes : ['Written by the same call as the other list.'],
          }),
        }))
      } catch (err) {
        const u = spent(err)
        failedLogs.push(logOf(id, label, { status: 'failed', durationMs: Date.now() - t0, tokens: tokensOf(u), costUsd: u.calls > 0 ? u.costUsd : null, notes: [err instanceof LLMError ? `${err.kind}: ${err.message}` : 'This section failed.'] }))
        throw err
      }
    })
    const failure = results.find((r) => r.status === 'rejected')
    if (failure && failure.status === 'rejected') throw failure.reason

    // Wave 2: sees the wave-1 text, in employer order.
    let headline: string | null = null
    const digest = experienceDigest(evidence.employers.flatMap((e) => digests.get(e.employer.key) ?? []))
    const t2 = Date.now()
    let profileOutcome: Awaited<ReturnType<typeof writeProfile>>
    if (w.deadline - Date.now() < WAVE2_MIN_START_MS) {
      profileOutcome = fallbackProfile(w, digest, 'There was not enough time left for the profile call.')
    } else {
      try {
        profileOutcome = await writeProfile(w, digest, { ...rules, prompt: profilePrompt })
      } catch (err) {
        if (!isTimeout(err)) {
          const u = spent(err)
          failedLogs.push(logOf('profile', 'Profile, headline and competencies', { status: 'failed', durationMs: Date.now() - t2, tokens: tokensOf(u), costUsd: u.calls > 0 ? u.costUsd : null, notes: [err instanceof LLMError ? `${err.kind}: ${err.message}` : 'This section failed.'] }))
          throw err
        }
        profileOutcome = { ...fallbackProfile(w, digest, 'The profile call ran out of time.'), usage: usageOfError(err) }
      }
    }
    const p = profileOutcome
    addCost(p.usage)
    p.checks.forEach((c) => note(c, evidence.employers.length))
    keep({
      id: 'profile', kind: 'profile', markdown: p.profileMarkdown, model: p.model ?? undefined, tokens: tokensOf(p.usage),
      log: logOf('profile', 'Profile, headline and competencies', { model: p.model, durationMs: Date.now() - t2, tokens: tokensOf(p.usage), costUsd: p.usage.calls > 0 ? p.usage.costUsd : null, retries: p.retries, retryReasons: p.retryReasons, notes: p.notes }),
    })
    if (p.competenciesMarkdown) {
      keep({ id: 'competencies', kind: 'competencies', markdown: p.competenciesMarkdown, log: logOf('competencies', 'Core competencies', { notes: [p.model ? 'Written by the profile call.' : 'Made by code from the selected competencies.'] }) })
    }
    headline = p.headline

    // Rendered by code, from the profile as stored.
    const certs = renderCertifications(evidence.certifications, new Date())
    if (certs.markdown) keep({ id: 'certification', kind: 'certification', markdown: certs.markdown, log: logOf('certification', 'Certifications', { notes: ['Rendered by code from your profile, in relevance order, no model call.', ...certs.notes] }) })
    else if (certs.notes.length > 0) notes.push(...certs.notes)
    const edu = renderEducation(evidence.education)
    if (edu.markdown) keep({ id: 'education', kind: 'education', markdown: edu.markdown, log: logOf('education', 'Education', { notes: ['Rendered by code from your profile, in relevance order, no model call.', ...edu.notes] }) })
    edu.checkNotes.forEach((text) => note({ kind: 'education', text }, evidence.employers.length + 1))
    const langs = renderLanguages(evidence.languages)
    if (langs) keep({ id: 'languages', kind: 'languages', markdown: langs, log: logOf('languages', 'Languages', { notes: ['Rendered by code from your profile, no model call.'] }) })

    // Nothing selected is dropped silently: a project no entry could carry, and an item no longer in the profile, are named.
    for (const p of evidence.unroutedProjects) notes.push(`Selected project "${p.name}" is not on the CV: ${p.why}.`)
    for (const u of evidence.unresolved) notes.push(`A selected ${SECTION_WORD[u.section] ?? u.section} item is no longer in your profile, so it is not on the CV.`)
    const checkNotes = [...checks]
      .sort((a, b) => CHECK_KIND_RANK[a.kind] - CHECK_KIND_RANK[b.kind] || a.order - b.order)
      .map((c) => c.text)
      .slice(0, MAX_CHECK_NOTES)
    return { sections, headline, checkNotes, notes, usage, models: [...models] }
  } catch (err) {
    throw new WriteStageError(err, [...sections.map((s) => s.log), ...failedLogs], usage)
  }
}
