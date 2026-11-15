import { getFullProfile } from '@/modules/profile/queries'
import { requireProfile } from '@/lib/session'
import { loadVault } from '@/modules/profile-map/load'
import { capabilityMeta } from '@/modules/profile-map/capability-meta'
import { buildProfileSummary } from '@/lib/profile-summary'
import { ProfileCoachContext } from '../../_components/ProfileCoachContext'
import { RecordsPage, careerYears } from '../../_components/RecordsPage'
import { LeftRail } from '../../_components/LeftRail'

export default async function CapabilitiesPage() {
  const { profile: session } = await requireProfile()
  // The whole vault is loaded only for each capability's status and counts. Status is derived there
  // (confirmed links plus mentions parsed from note text), so a count query cannot reproduce it.
  // loadVault and getFullProfile are request-cached, so anything else in this request shares the load.
  const [profile, vault] = await Promise.all([getFullProfile(), loadVault(session.id)])
  return (
    <>
      <ProfileCoachContext profileSummary={buildProfileSummary(profile)} />
      <RecordsPage title="Capabilities">
        <LeftRail
          show="capabilities"
          capabilityMeta={capabilityMeta(vault)}
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
