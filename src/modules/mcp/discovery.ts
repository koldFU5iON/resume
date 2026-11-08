export const MCP_DISCOVERY_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version',
}

export function discoveryOptions() {
  return new Response(null, { status: 204, headers: MCP_DISCOVERY_HEADERS })
}
