/**
 * Stage 3, Write (docs/cv-generation.md). Two waves:
 *
 * Wave 1, in parallel (at most WRITE_CONCURRENCY calls at once): one experience
 * writer per employer that shows bullets, and the skills/tools grouping.
 * Employers listed without bullets are rendered entirely by code (no call).
 * Wave 2, after wave 1: the profile, headline and competencies, which read the
 * wave-1 text.
 *
 * Titles, companies, dates, progression lines, certifications, education and
 * languages are rendered by code from the profile. Every call carries the
 * run's attribution; nothing here names a model (roles choose it).
 *
 * A writer that cannot produce usable output after its one retry fails the run
 * (LLMError invalid_output); a call that times out fails it as `timeout`. The
 * only best-effort fallback is the skills grouping (code ordering). A failure
 * is thrown as WriteStageError so the runner can still log the sections that
 * were written.
 */

import { LLMError } from '@/modules/llm/errors'
import {
  loadCVWriteExperiencePrompt, loadCVWriteProfilePrompt, loadCVWriteSkillsPrompt, loadWritingContext,
} from '@/modules/llm/prompt-context'
import type { Vault } from '@/modules/profile-map/types'
import { addUsage, NO_USAGE, type CallUsage } from '../call'
import { MAX_CHECK_NOTES, WRITE_CONCURRENCY, type CvBrief, type CvSelection, type SectionLogEntry } from '../schema'
import type { Strategy } from '../strategy'
import { evidenceFromVault, type EmployerEvidence } from './evidence'
import { writeExperience } from './experience'
import { ASSEMBLE_RESERVE_MS } from './limits'
import { runPool } from './pool'
import { experienceDigest, writeProfile } from './profile'
import { requirementText } from './prompt'
import { renderCertifications, renderEducation, renderEmployerHeader, renderLanguages } from './render'
import { writeSkills } from './skills'
import type { WriteContext, WrittenSection } from './types'

export type WriteResult = {
  /** Every section written, in the order they finished (assemble.ts orders them). */
  sections: WrittenSection[]
  /** The headline for the header; null when none was written or it was dropped. */
  headline: string | null
  /** At most MAX_CHECK_NOTES "worth a quick check" notes, in the order found. */
  checkNotes: string[]
  /** Stage-level notes (not tied to one section). */
  notes: string[]
  usage: CallUsage
  /** Distinct models the sections ran on. */
  models: string[]
}

/** A write failure, carrying the section rows logged so far so the run log can show them. */
export class WriteStageError extends Error {
  constructor(readonly original: unknown, readonly sectionLogs: SectionLogEntry[]) {
    super(original instanceof Error ? original.message : 'The write stage failed.')
    this.name = 'WriteStageError'
  }
}

const tokensOf = (u: CallUsage) => ({ input: u.input, output: u.output })

function logOf(id: string, label: string, over: Partial<SectionLogEntry>): SectionLogEntry {
  return { id, label, status: 'ok', model: null, durationMs: 0, tokens: { input: 0, output: 0 }, costUsd: null, retries: 0, notes: [], ...over }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t = Date.now()
  const value = await fn()
  return { value, ms: Date.now() - t }
}

/** Throws a timeout when there is no time left to start another call. */
function ensureTime(deadline: number): void {
  if (deadline - Date.now() < 5_000) throw new LLMError('The run ran out of time before every section was written.', 'timeout')
}

const experienceLabel = (e: EmployerEvidence['employer']) => `Experience: ${e.latestTitle} — ${e.company}`

export async function runWrite(
  vault: Vault,
  brief: CvBrief,
  selection: CvSelection,
  strategy: Pick<Strategy, 'mustHave' | 'niceToHave'>,
  ctx: { profileId: string; jobApplicationId: string; runId: string; deadline: number },
): Promise<WriteResult> {
  const evidence = evidenceFromVault(vault, selection)
  const w: WriteContext = {
    ...ctx,
    deadline: ctx.deadline - ASSEMBLE_RESERVE_MS,
    brief,
    strategy,
    evidence,
    requirementText: requirementText(strategy),
  }
  const sections: WrittenSection[] = []
  const failedLogs: SectionLogEntry[] = []
  const checkNotes: string[] = []
  const notes: string[] = []
  const models = new Set<string>()
  let usage: CallUsage = NO_USAGE
  const keep = (s: WrittenSection) => {
    sections.push(s)
    if (s.model) models.add(s.model)
  }
  const addCost = (u: CallUsage) => { usage = addUsage(usage, u) }

  try {
    const [writing, expPrompt, skillsPrompt, profilePrompt] = await Promise.all([
      loadWritingContext(ctx.profileId),
      loadCVWriteExperiencePrompt(ctx.profileId),
      loadCVWriteSkillsPrompt(ctx.profileId),
      loadCVWriteProfilePrompt(ctx.profileId),
    ])
    const rules = { rules: writing.rules, brief: writing.brief }

    // Wave 1. Employers without bullets are rendered by code right away.
    const withBullets: EmployerEvidence[] = []
    for (const e of evidence.employers) {
      const id = `experience:${e.employer.key}`
      if (e.employer.headerOnly || e.activities.length === 0) {
        const why = e.employer.headerOnly
          ? 'Listed without bullets: rendered by code, no model call.'
          : 'None of its selected activities is still in the profile, so it is listed without bullets: rendered by code, no model call.'
        keep({ id, kind: 'experience', employerKey: e.employer.key, markdown: renderEmployerHeader(e.employer), log: logOf(id, experienceLabel(e.employer), { notes: [why] }) })
      } else {
        withBullets.push(e)
      }
    }

    const digests = new Map<string, { summary: string; bullets: string[] }>()
    type Task = { kind: 'experience'; emp: EmployerEvidence } | { kind: 'skills' }
    const tasks: Task[] = [...withBullets.map((emp): Task => ({ kind: 'experience', emp })), { kind: 'skills' }]
    const results = await runPool(tasks, WRITE_CONCURRENCY, async (task) => {
      const id = task.kind === 'experience' ? `experience:${task.emp.employer.key}` : 'skills'
      const label = task.kind === 'experience' ? experienceLabel(task.emp.employer) : 'Skills and tools'
      try {
        ensureTime(w.deadline)
        if (task.kind === 'experience') {
          const { value: out, ms } = await timed(() => writeExperience(w, task.emp, { ...rules, prompt: expPrompt }))
          digests.set(task.emp.employer.key, { summary: out.summary, bullets: out.bullets })
          addCost(out.usage)
          checkNotes.push(...out.checkNotes)
          keep({
            id, kind: 'experience', employerKey: task.emp.employer.key, markdown: out.markdown, model: out.model ?? undefined, tokens: tokensOf(out.usage),
            log: logOf(id, label, { model: out.model, durationMs: ms, tokens: tokensOf(out.usage), costUsd: out.usage.costUsd, retries: out.retries, notes: out.notes }),
          })
          return
        }
        const { value: s, ms } = await timed(() => writeSkills(w, { ...rules, prompt: skillsPrompt }))
        addCost(s.usage)
        // One call wrote both lists: its cost is on the first row that exists.
        const rows: Array<{ id: string; label: string; kind: string; markdown: string }> = [
          { id: 'tools', label: 'Tools', kind: 'tools', markdown: s.toolsMarkdown },
          { id: 'skills', label: 'Skills', kind: 'skills', markdown: s.skillsMarkdown },
        ].filter((r) => r.markdown)
        rows.forEach((r, i) => keep({
          id: r.id, kind: r.kind, markdown: r.markdown, model: s.model ?? undefined, tokens: tokensOf(i === 0 ? s.usage : NO_USAGE),
          log: logOf(r.id, r.label, {
            model: s.model, durationMs: i === 0 ? ms : 0, tokens: tokensOf(i === 0 ? s.usage : NO_USAGE), costUsd: s.model ? (i === 0 ? s.usage.costUsd : 0) : null,
            retries: i === 0 ? s.retries : 0, notes: i === 0 ? s.notes : ['Written by the same call as the other list.'],
          }),
        }))
      } catch (err) {
        failedLogs.push(logOf(id, label, { status: 'failed', notes: [err instanceof LLMError ? `${err.kind}: ${err.message}` : 'This section failed.'] }))
        throw err
      }
    })
    const failure = results.find((r) => r.status === 'rejected')
    if (failure && failure.status === 'rejected') throw failure.reason

    // Wave 2: sees the wave-1 text, in employer order.
    let headline: string | null = null
    try {
      ensureTime(w.deadline)
      const digest = experienceDigest(evidence.employers.flatMap((e) => digests.get(e.employer.key) ?? []))
      const { value: p, ms } = await timed(() => writeProfile(w, digest, { ...rules, prompt: profilePrompt }))
      addCost(p.usage)
      checkNotes.push(...p.checkNotes)
      keep({
        id: 'profile', kind: 'profile', markdown: p.profileMarkdown, model: p.model ?? undefined, tokens: tokensOf(p.usage),
        log: logOf('profile', 'Profile, headline and competencies', { model: p.model, durationMs: ms, tokens: tokensOf(p.usage), costUsd: p.usage.costUsd, retries: p.retries, notes: p.notes }),
      })
      if (p.competenciesMarkdown) {
        keep({ id: 'competencies', kind: 'competencies', markdown: p.competenciesMarkdown, log: logOf('competencies', 'Core competencies', { notes: ['Written by the profile call.'] }) })
      }
      headline = p.headline
    } catch (err) {
      failedLogs.push(logOf('profile', 'Profile, headline and competencies', { status: 'failed', notes: [err instanceof LLMError ? `${err.kind}: ${err.message}` : 'This section failed.'] }))
      throw err
    }

    // Rendered by code, from the profile as stored.
    const certs = renderCertifications(evidence.certifications)
    if (certs.markdown) keep({ id: 'certification', kind: 'certification', markdown: certs.markdown, log: logOf('certification', 'Certifications', { notes: ['Rendered by code from your profile, in relevance order, no model call.', ...certs.notes] }) })
    const edu = renderEducation(evidence.education)
    if (edu.markdown) keep({ id: 'education', kind: 'education', markdown: edu.markdown, log: logOf('education', 'Education', { notes: ['Rendered by code from your profile, in relevance order, no model call.', ...edu.notes] }) })
    const langs = renderLanguages(evidence.languages)
    if (langs) keep({ id: 'languages', kind: 'languages', markdown: langs, log: logOf('languages', 'Languages', { notes: ['Rendered by code from your profile, no model call.'] }) })

    if (selection.projects.length > 0) {
      notes.push(`${selection.projects.length === 1 ? '1 selected project is' : `${selection.projects.length} selected projects are`} not on the CV: the default CV structure has no projects section.`)
    }
    return { sections, headline, checkNotes: checkNotes.slice(0, MAX_CHECK_NOTES), notes, usage, models: [...models] }
  } catch (err) {
    throw new WriteStageError(err, [...sections.map((s) => s.log), ...failedLogs])
  }
}
