/**
 * The job header's Apply button (#383): where it goes, and whether to offer
 * marking the job Applied afterwards. Pure, so the client and tests share it.
 * Status only ever changes when the user picks "Mark as applied".
 */

import { ApplicationStatus, type ApplicationStatusType } from "@/app/types/job-application"

/**
 * The job's posting link as a safe http(s) URL to open in a new tab, or null
 * when there is none. A bare host ("acme.com/jobs/1") gets https; anything
 * else (javascript:, mailto:, unparseable) is refused.
 */
export function jobApplyHref(url: string | null | undefined): string | null {
  const trimmed = url?.trim()
  if (!trimmed) return null
  // "host:8080/…" is a bare host with a port, not a scheme.
  const hasScheme = /^[a-z][a-z\d+.-]*:(?!\d)/i.test(trimmed)
  try {
    const parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    if (!hasScheme && !parsed.hostname.includes(".")) return null
    return parsed.href
  } catch {
    return null
  }
}

/** Offer "Mark as applied" only before the job reaches Applied (never once it's Applied or later, or closed). */
export function canOfferMarkApplied(status: ApplicationStatusType): boolean {
  return status === ApplicationStatus.NotStarted || status === ApplicationStatus.InProgress
}
