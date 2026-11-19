/**
 * The facts of the CV header that are not contact details: where the candidate
 * is based and where they may work. Built in code from the profile (never by a
 * model), like the contact line, and only from what the owner entered: the
 * location on the profile and the work rights in the search preferences
 * (citizenships and visas). Nothing is inferred (a citizenship is listed for its
 * own country only), and a visa that has expired is left out.
 *
 * Pure: no database, no network.
 */

import { countryName } from '@/modules/job-assessment/countries'
import type { Vault } from '@/modules/profile-map/types'

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** "United Kingdom (citizen); Germany (Skilled Worker visa)", or null when there is none. */
export function rightToWorkText(vault: Vault, now: Date): string | null {
  const eligibility = vault.preferences.props.eligibility
  if (!eligibility) return null
  const today = now.toISOString().slice(0, 10)
  const byCountry = new Map<string, string[]>()
  const add = (code: string, what: string) => byCountry.set(code, [...(byCountry.get(code) ?? []), what])
  for (const code of eligibility.citizenships) add(code, 'citizen')
  for (const v of eligibility.visas) {
    if (v.expiresOn && v.expiresOn < today) continue
    const type = oneLine(v.type)
    // The type is free text: "Blue Card" gets " visa", "H-1B visa" and "Settled status" do not.
    add(v.country, !type ? 'visa' : /\b(?:visa|permit|card|status)$/i.test(type) ? type : `${type} visa`)
  }
  if (byCountry.size === 0) return null
  return [...byCountry].map(([code, what]) => `${countryName(code)} (${[...new Set(what)].join(', ')})`).join('; ')
}

/** "London, UK · Right to work: United Kingdom (citizen)": the line under the headline; null when there is nothing to show. */
export function headerFacts(vault: Vault, now: Date): string | null {
  const location = vault.identity.props.location ? oneLine(vault.identity.props.location) : ''
  const rights = rightToWorkText(vault, now)
  const line = [location, rights ? `Right to work: ${rights}` : ''].filter(Boolean).join(' · ')
  return line || null
}
