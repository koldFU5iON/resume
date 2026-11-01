// POST /api/mcp
//
// Remote MCP server (Streamable HTTP, stateless, JSON responses). Authenticated
// by an `rsm_` bearer token carrying `mcp:read` and/or `mcp:write`. A fresh
// server and transport are built per request; no session id is issued.
//
//   claude mcp add --transport http currnt https://<host>/api/mcp \
//     --header "Authorization: Bearer rsm_xxx"
//
// This handler only authenticates, dispatches and serialises. Tools and their
// logic live in src/modules/mcp/.

import { NextResponse } from 'next/server'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { verifyBearerHeader } from '@/modules/api-tokens/service'
import { hasAnyMcpScope } from '@/modules/mcp/registry'
import { createMcpServer } from '@/modules/mcp/server'

export async function POST(request: Request) {
  const auth = await verifyBearerHeader(request.headers.get('authorization'))
  if (!auth) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Missing or invalid Bearer token' },
      { status: 401 },
    )
  }

  if (!hasAnyMcpScope(auth.scopes)) {
    return NextResponse.json(
      { error: 'forbidden', message: 'Token lacks an MCP scope (mcp:read or mcp:write)' },
      { status: 403 },
    )
  }

  const server = createMcpServer(auth)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  try {
    await server.connect(transport)
    return await transport.handleRequest(request)
  } finally {
    // JSON mode resolves with a fully built body, so closing here is safe.
    await server.close()
  }
}

// Stateless server: no standalone SSE stream (GET) and no session to end (DELETE).
function methodNotAllowed() {
  return NextResponse.json(
    { error: 'method_not_allowed', message: 'Use POST for MCP requests' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

export async function GET() {
  return methodNotAllowed()
}

export async function DELETE() {
  return methodNotAllowed()
}
