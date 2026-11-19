/**
 * Hard limits on what the section writers may produce, in one place. The
 * prompts state them, but code enforces them after every answer (checks.ts):
 * a soft breach is retried once with feedback and then accepted and logged.
 */

import { MAX_COMPETENCIES } from '../caps'

/** Experience summary: one sentence. */
export const SUMMARY_MAX_WORDS = 40
/** One experience bullet. */
export const BULLET_MAX_WORDS = 25
/** The professional profile paragraph: 4-6 sentences, first person, figure-led (raised from 80 after the owner's own CV profile ran about 110 words). A longer one is shortened at a clause boundary. */
export const PROFILE_MAX_WORDS = 110
/** The headline under the name: a descriptor, never a title. */
export const HEADLINE_MAX_WORDS = 12
/**
 * Core Competencies are short noun-phrase labels, not sentences: 2 to 5 words,
 * no numbers, at most COMPETENCY_MAX_LABELS of them (the ceiling of the
 * Brief's competency budget, caps.ts MAX_COMPETENCIES; the profile call writes
 * up to the budget, never padded to a count, labels that cannot restate the
 * experience's figures).
 */
export const COMPETENCY_LABEL_MIN_WORDS = 2
export const COMPETENCY_LABEL_MAX_WORDS = 5
export const COMPETENCY_MAX_LABELS = MAX_COMPETENCIES
/** No minimum number of competency labels: the call writes as many as the experience supports, up to the budget; code never tops up to reach a count. */
export const COMPETENCY_MIN_LABELS = 0
/** The professional profile uses at most this many figures (and none already used in an experience bullet). */
export const PROFILE_MAX_FIGURES = 1
/** Group labels in Skills and Tools (per list). */
export const MAX_SKILL_GROUPS = 3
export const GROUP_LABEL_MAX_WORDS = 4
/**
 * A skills or tools list is grouped only with at least this many names; a
 * shorter one is one ungrouped list (a first real run split 4 tools into three
 * groups of 1-2). No model call is made when neither list reaches it.
 */
export const MIN_NAMES_TO_GROUP = 6
/** A group with fewer names than this is never emitted: it is merged into a neighbour. */
export const MIN_GROUP_SIZE = 2
/** Time kept back at the end of the run for Assemble and storing the result (ms). */
export const ASSEMBLE_RESERVE_MS = 8_000
/** An education entry with no end date counts as in progress only when it started within this many years. */
export const EDUCATION_RECENT_START_YEARS = 6
/**
 * Time kept back for the wave-2 profile/competencies call: wave 1 gets its own
 * deadline this much earlier than the write stage's (ms).
 */
export const WAVE2_RESERVE_MS = 45_000
/** Wave 2 is not started with less time than this left; a deterministic profile is rendered instead (ms). */
export const WAVE2_MIN_START_MS = 12_000
/** A call is not started with less time than this left (ms). */
export const MIN_CALL_MS = 5_000

/**
 * Output tokens for one experience writer call, scaled to the bullets it may
 * write (a fixed small cap truncated a six-bullet entry on the first real run
 * and wasted the retry). The first attempt gets BASE + PER_BULLET * allowance;
 * the retry (after a bad answer or a cut-off) doubles it, never above MAX. An
 * employer with project evidence starts at the larger cap, since its entry is
 * the one that ran long. When the first attempt already used the larger cap a
 * cut-off is not retried (call.ts: the same budget would be sent again).
 */
export const EXPERIENCE_TOKENS = { base: 1_200, perBullet: 400, max: 8_000, retryFactor: 2 } as const

export function experienceTokenCaps(allowance: number, hasProjectEvidence: boolean): { first: number; retry: number } {
  const first = Math.min(EXPERIENCE_TOKENS.max, EXPERIENCE_TOKENS.base + EXPERIENCE_TOKENS.perBullet * Math.max(1, allowance))
  const retry = Math.min(EXPERIENCE_TOKENS.max, first * EXPERIENCE_TOKENS.retryFactor)
  return { first: hasProjectEvidence ? retry : first, retry }
}

/** The most characters of one project's text (description and highlights) sent to a writer. The numbers check still reads the full text. */
export const PROJECT_EVIDENCE_MAX_CHARS = 1_200

/** A project's text cut to PROJECT_EVIDENCE_MAX_CHARS at a word boundary, with an ellipsis; unchanged when it is short enough. */
export function capProjectText(text: string, max: number = PROJECT_EVIDENCE_MAX_CHARS): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const at = cut.search(/\s\S*$/)
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trimEnd()}…`
}

/**
 * A project whose text (description and highlights), once its own name and the
 * punctuation around it are taken away, is shorter than this has no evidence to
 * write from: only a title. Such a "thin" project never gets an own bullet, its
 * brief framing line is never shown to a writer, and the log asks the owner to
 * add detail to the project in the profile.
 */
export const THIN_PROJECT_MIN_CHARS = 80

/** Whether a project is thin (see THIN_PROJECT_MIN_CHARS): its text beyond its own name and punctuation is under the minimum. */
export function isThinProject(p: { name: string; text: string }): boolean {
  const name = p.name.trim().toLowerCase()
  const rest = (name ? p.text.toLowerCase().split(name).join(' ') : p.text.toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return rest.length < THIN_PROJECT_MIN_CHARS
}

/**
 * About how many words a CV body can hold on about two and a half pages (the
 * owner's own CV runs about 850). Assemble logs a soft note above this (nothing
 * is trimmed): the writers' limits should keep a CV under it, so a note means a
 * limit leaked. 1,000 because at the ceilings the body can legitimately pass
 * 900: 20 bullets x 25 words = 500, 4 summaries x 40 = 160, profile 110, 8
 * competency labels about 25, 22 skills and tools about 45, 6 certifications
 * about 40, education and Earlier Experience lines about 100: roughly 980.
 */
export const CV_BODY_WORDS_SOFT_LIMIT = 1_000
