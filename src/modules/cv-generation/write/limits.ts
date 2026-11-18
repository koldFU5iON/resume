/**
 * Hard limits on what the section writers may produce, in one place. The
 * prompts state them, but code enforces them after every answer (checks.ts):
 * a soft breach is retried once with feedback and then accepted and logged.
 */

/** Experience summary: one sentence. */
export const SUMMARY_MAX_WORDS = 40
/** One experience bullet. */
export const BULLET_MAX_WORDS = 25
/** The professional profile paragraph. */
export const PROFILE_MAX_WORDS = 80
/** The headline under the name: a descriptor, never a title. */
export const HEADLINE_MAX_WORDS = 12
/**
 * Core Competencies are short noun-phrase labels, not sentences: 2 to 5 words,
 * no numbers, at most COMPETENCY_MAX_LABELS of them (5-6 reads well and cannot
 * restate the experience's figures).
 */
export const COMPETENCY_LABEL_MIN_WORDS = 2
export const COMPETENCY_LABEL_MAX_WORDS = 5
export const COMPETENCY_MAX_LABELS = 6
/** The professional profile uses at most this many figures (and none already used in an experience bullet). */
export const PROFILE_MAX_FIGURES = 1
/** Group labels in Skills and Tools (per list). */
export const MAX_SKILL_GROUPS = 3
export const GROUP_LABEL_MAX_WORDS = 4
/** Skills and tools lists at or under this many names are not grouped: nothing to gain from a model call. */
export const MIN_NAMES_TO_GROUP = 5
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
