/**
 * Verify stage pass rule (spec §4.1, plan §1 Verify).
 *
 * Code checks run first, so Jev is never called on an empty job:
 *   - the title isn't empty or "(untitled)"
 *   - the company isn't empty or "(unknown)"
 *   - the description is at least ASSESSMENT_CONFIG.verify.minDescriptionChars after trimming
 * Then the Jev answers (questions from buildVerifyQuestions):
 *   - pass needs is_full_description ≥ 0.7 and has_requirements ≥ 0.5
 *
 * Reasons are plain words for the row tooltip. Pure module.
 */

import type { NoulResponse } from '@typesafe-ai/sdk'
import { ASSESSMENT_CONFIG } from './schema'

/** Placeholders written by job capture when a field couldn't be read (see jobs/capture.ts). */
export const PLACEHOLDER_TITLE = '(untitled)'
export const PLACEHOLDER_COMPANY = '(unknown)'

export interface VerifyJob {
  title: string | null | undefined
  company: string | null | undefined
  description: string | null | undefined
}

/** Answers to buildVerifyQuestions(); only the noul value is read. */
export interface VerifyAnswers {
  is_full_description: Pick<NoulResponse, 'noul'>
  has_requirements: Pick<NoulResponse, 'noul'>
  has_responsibilities?: Pick<NoulResponse, 'noul'>
}

export interface VerifyResult {
  pass: boolean
  reasons: string[]
}

export const VERIFY_REASONS = {
  titleMissing: 'Job title is missing',
  companyMissing: 'Company is missing',
  descriptionMissing: 'Job description is missing',
  descriptionShort: (chars: number) =>
    `Description is too short (${chars} characters; at least ${ASSESSMENT_CONFIG.verify.minDescriptionChars} needed)`,
  incomplete: 'Description looks incomplete or truncated',
  noRequirements: 'No candidate requirements found',
} as const

function isPlaceholder(value: string | null | undefined, placeholder: string): boolean {
  const v = value?.trim() ?? ''
  return v === '' || v.toLowerCase() === placeholder
}

/** Code-only checks; an empty array means Jev may be called. */
export function codeChecks(job: VerifyJob): string[] {
  const reasons: string[] = []
  if (isPlaceholder(job.title, PLACEHOLDER_TITLE)) reasons.push(VERIFY_REASONS.titleMissing)
  if (isPlaceholder(job.company, PLACEHOLDER_COMPANY)) reasons.push(VERIFY_REASONS.companyMissing)
  const chars = job.description?.trim().length ?? 0
  if (chars === 0) reasons.push(VERIFY_REASONS.descriptionMissing)
  else if (chars < ASSESSMENT_CONFIG.verify.minDescriptionChars) reasons.push(VERIFY_REASONS.descriptionShort(chars))
  return reasons
}

/**
 * Full pass rule. When the code checks fail, `answers` is ignored (pass null:
 * Jev shouldn't have been called). When they pass, `answers` is required.
 */
export function evaluateVerify(job: VerifyJob, answers: VerifyAnswers | null): VerifyResult {
  const reasons = codeChecks(job)
  if (reasons.length > 0) return { pass: false, reasons }
  if (!answers) throw new Error('evaluateVerify: Jev answers are required when the code checks pass')

  const { isFullDescription, hasRequirements } = ASSESSMENT_CONFIG.verify
  if (answers.is_full_description.noul < isFullDescription) reasons.push(VERIFY_REASONS.incomplete)
  if (answers.has_requirements.noul < hasRequirements) reasons.push(VERIFY_REASONS.noRequirements)
  return { pass: reasons.length === 0, reasons }
}
