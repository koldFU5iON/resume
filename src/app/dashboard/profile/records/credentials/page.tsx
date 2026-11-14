import { getFullProfile } from '@/modules/profile/queries'
import { buildProfileSummary } from '@/lib/profile-summary'
import { ProfileCoachContext } from '../../_components/ProfileCoachContext'
import { RecordsPage, careerYears } from '../../_components/RecordsPage'
import { LeftRail } from '../../_components/LeftRail'

export default async function CredentialsPage() {
  const profile = await getFullProfile()
  return (
    <>
      <ProfileCoachContext profileSummary={buildProfileSummary(profile)} />
      <RecordsPage title="Credentials">
        <LeftRail
          show="credentials"
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
