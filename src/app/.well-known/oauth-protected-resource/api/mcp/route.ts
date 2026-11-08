import { getMcpResourceMetadata } from '@/modules/mcp/oauth-config'

export async function GET() {
  return Response.json(getMcpResourceMetadata(), {
    headers: { 'Access-Control-Allow-Origin': '*' },
  })
}
