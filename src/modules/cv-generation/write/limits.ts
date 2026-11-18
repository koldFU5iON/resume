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
/** One competency line. */
export const COMPETENCY_MAX_WORDS = 15
/** Group labels in Skills and Tools (per list). */
export const MAX_SKILL_GROUPS = 3
export const GROUP_LABEL_MAX_WORDS = 4
/** Skills and tools lists at or under this many names are not grouped: nothing to gain from a model call. */
export const MIN_NAMES_TO_GROUP = 5
/** Time kept back at the end of the run for Assemble and storing the result (ms). */
export const ASSEMBLE_RESERVE_MS = 8_000
