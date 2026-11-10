import { ContentContainer } from '@/app/components/ContentContainer'
import { requireProfile, isAdminUser } from '@/lib/session'
import { getUserUsageSummary, getAdminUsageSummary } from '@/modules/llm/usage'
import { UsageLog } from './_components/usage-log'
import { UsageAdmin } from './_components/usage-admin'

export default async function Page() {
  const { session, profile } = await requireProfile()
  const [stats, admin] = await Promise.all([
    getUserUsageSummary(profile.id),
    isAdminUser(session.user.id).then(isAdmin => isAdmin ? getAdminUsageSummary() : null),
  ])

  return (
    <ContentContainer
      title="AI Usage"
      description="Token consumption on your own API key. Included early job assessments are run by the app and not billed to your key."
    >
      <UsageLog stats={stats} />
      {admin && <UsageAdmin stats={admin} />}
    </ContentContainer>
  )
}
