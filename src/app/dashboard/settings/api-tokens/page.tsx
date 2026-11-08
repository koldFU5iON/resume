import { listApiTokensAction } from '@/modules/api-tokens/actions'
import { ContentContainer } from '@/app/components/ContentContainer'
import { Separator } from '@/components/ui/separator'
import { TokensManager } from './_components/tokens-manager'
import { IntegrationsList } from './_components/integrations-list'
import { requireSession } from '@/lib/session'
import { listMcpConnections } from '@/modules/mcp/connections'
import { getMcpUrls } from '@/modules/mcp/oauth-config'
import { McpConnections } from './_components/mcp-connections'

export default async function Page() {
  const session = await requireSession()
  const [tokens, connections] = await Promise.all([
    listApiTokensAction(),
    listMcpConnections(session.user.id),
  ])

  return (
    <ContentContainer
      title="Settings"
      description="Manage how external tools and agents talk to your account."
    >
      <div className="space-y-10">
        <McpConnections endpoint={getMcpUrls().resource} connections={connections} />
        <Separator />
        <TokensManager tokens={tokens} />
        <Separator />
        <IntegrationsList />
      </div>
    </ContentContainer>
  )
}
