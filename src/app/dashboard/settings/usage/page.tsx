import { ContentContainer } from '@/app/components/ContentContainer'
import { requireProfile, isAdminUser } from '@/lib/session'
import { getUserUsageSummary, getAdminUsageSummary, getJevAdminSummary } from '@/modules/llm/usage'
import { UsageLog } from './_components/usage-log'
import { UsageAdmin } from './_components/usage-admin'
import { JevAdmin } from './_components/jev-admin'

export default async function Page() {
  const { session, profile } = await requireProfile()
  const [stats, adminData] = await Promise.all([
    getUserUsageSummary(profile.id),
    isAdminUser(session.user.id).then(isAdmin =>
      isAdmin ? Promise.all([getAdminUsageSummary(), getJevAdminSummary()]) : null,
    ),
  ])
  const [admin, jev] = adminData ?? [null, null]

  return (
    <ContentContainer
      title="AI Usage"
      description="Token consumption on your own API key. Included early job assessments are run by the app and not billed to your key."
    >
      <UsageLog stats={stats} />
      {admin && <UsageAdmin stats={admin} />}
      {jev && <JevAdmin stats={jev} />}
    </ContentContainer>
  )
}
