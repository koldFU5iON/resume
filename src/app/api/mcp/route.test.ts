import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/modules/mcp/auth", () => ({
  authenticateMcp: vi.fn(),
}))
vi.mock("@/modules/jobs/queries", () => ({
  listJobsForAgent: vi.fn(),
}))

import { authenticateMcp } from "@/modules/mcp/auth"
import { listJobsForAgent } from "@/modules/jobs/queries"
import { DELETE, GET, POST } from "./route"

const mockVerify = vi.mocked(authenticateMcp)
const mockList = vi.mocked(listJobsForAgent)

function rpc(body: unknown, headers: Record<string, string> = { authorization: "Bearer rsm_x" }) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => vi.clearAllMocks())

describe("POST /api/mcp", () => {
  it("returns 401 when the Authorization header is missing", async () => {
    mockVerify.mockResolvedValue(null)
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {}))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/api/mcp')
    expect(res.headers.get('www-authenticate')).not.toContain('error=')
    expect(res.headers.get('www-authenticate')).not.toContain('scope=')
    expect(mockVerify).toHaveBeenCalledWith(null)
    expect(await res.json()).toEqual({
      error: "unauthorized",
      message: "Missing or invalid Bearer token",
    })
  })

  it('returns invalid_token only when credentials were supplied', async () => {
    mockVerify.mockResolvedValue(null)
    const res = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"')
    expect(res.headers.get('www-authenticate')).not.toContain('scope=')
  })

  it('refuses an authenticated offline-only token with insufficient_scope', async () => {
    mockVerify.mockResolvedValue({ profileId: 'p1', tokenId: 'oauth:c1', scopes: [] })
    const res = await POST(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))
    expect(res.status).toBe(403)
    expect(res.headers.get('www-authenticate')).toContain('error="insufficient_scope"')
    expect(res.headers.get('www-authenticate')).toContain('scope="mcp:read mcp:write"')
  })

  it("returns 403 for a valid token with only the capture scope", async () => {
    mockVerify.mockResolvedValue({ profileId: "p1", tokenId: "t1", scopes: ["capture"] })
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: "forbidden",
      message: "Token lacks an MCP scope (mcp:read or mcp:write)",
    })
  })

  it("lists list_jobs for a token with mcp:read", async () => {
    mockVerify.mockResolvedValue({ profileId: "p1", tokenId: "t1", scopes: ["mcp:read"] })
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(1)
    expect(body.result.tools.map((t: { name: string }) => t.name)).toContain("list_jobs")
  })

  it("answers initialize without issuing a session id", async () => {
    mockVerify.mockResolvedValue({ profileId: "p1", tokenId: "t1", scopes: ["mcp:read"] })
    const res = await POST(
      rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.0" },
        },
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("mcp-session-id")).toBeNull()
    const body = await res.json()
    expect(body.result.serverInfo.name).toBe("currnt")
    expect(body.result.capabilities.tools).toBeDefined()
  })

  it("calls list_jobs with the token's profileId, ignoring a profileId argument", async () => {
    mockVerify.mockResolvedValue({ profileId: "p1", tokenId: "t1", scopes: ["mcp:read"] })
    mockList.mockResolvedValue([{ id: "job-1", title: "Engineer" }] as never)
    const res = await POST(
      rpc({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_jobs", arguments: { profileId: "someone-else", include: "all" } },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(mockList).toHaveBeenCalledWith("p1", { include: "all", company: undefined })
    expect(JSON.parse(body.result.content[0].text)).toEqual({
      jobs: [{ id: "job-1", title: "Engineer" }],
    })
  })
})

describe("other methods", () => {
  it("returns 405 for GET", async () => {
    const res = await GET()
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
  })

  it("returns 405 for DELETE", async () => {
    const res = await DELETE()
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
  })
})
