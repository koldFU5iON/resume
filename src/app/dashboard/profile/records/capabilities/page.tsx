import { getFullProfile } from '@/modules/profile/queries'
import { getLLMConfigStatus } from '@/modules/llm/client'
import { requireProfile } from '@/lib/session'
import { buildProfileSummary } from '@/lib/profile-summary'
import { notesOf } from '@/modules/profile-map/build'
import { loadVault } from '@/modules/profile-map/load'
import { listPendingSuggestions } from '@/modules/profile-map/link-store'
import { ProfileCoachContext } from '../../_components/ProfileCoachContext'
import { RecordsPage, careerYears } from '../../_components/RecordsPage'
import { EvidenceLinksSection, type EvidenceLinkStats } from '../../_components/EvidenceLinksSection'
import { LeftRail } from '../../_components/LeftRail'

export default async function CapabilitiesPage() {
  const { profile: session } = await requireProfile()
  const [profile, { configured: hasLLMKey }, vault, pending] = await Promise.all([
    getFullProfile(),
    getLLMConfigStatus(session.id),
    loadVault(session.id),
    listPendingSuggestions(session.id),
  ])
  const capabilities = notesOf(vault, 'capability')
  const stats: EvidenceLinkStats = {
    total: capabilities.length,
    proven: capabilities.filter(c => c.props.status === 'proven').length,
    certified: capabilities.filter(c => c.props.status === 'certified').length,
    claimed: capabilities.filter(c => c.props.status === 'claimed').length,
  }
  return (
    <>
      <ProfileCoachContext profileSummary={buildProfileSummary(profile)} />
      <RecordsPage title="Capabilities">
        <EvidenceLinksSection stats={stats} pending={pending} hasLLMKey={hasLLMKey} />
        <LeftRail
          show="capabilities"
          skills={profile.skills}
          tools={profile.tools}
          languages={profile.languages}
          competencies={profile.competencies}
          educations={profile.educations}
          certifications={profile.certifications}
          careerYears={careerYears(profile)}
        />
      </RecordsPage>
    </>
  )
}
