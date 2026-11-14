'use client'

import { useWorkspaceContext } from '@/lib/context/page-context'

/** Tells the Career Coach which profile note is open. Renders nothing. */
export function ProfileCoachContext({ profileSummary, activeExperienceId, activeExperienceName }: {
  profileSummary: string
  activeExperienceId?: string
  activeExperienceName?: string
}) {
  useWorkspaceContext({ type: 'profile', profileSummary, activeExperienceId, activeExperienceName })
  return null
}
