import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as z from "zod"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { ApiTokenScope } from "@/modules/api-tokens/service"
import { McpToolError } from "./errors"
import { MAX_TOOL_RESPONSE_CHARS } from "./limits"
import type { McpToolDefinition } from "./registry"
import { createMcpServer } from "./server"

vi.mock("./context", () => ({
  getWritingContractForProfile: vi.fn(async () => "contract-stub"),
}))

const readHandler = vi.fn(async (ctx: unknown, args: unknown) => ({ ctx, args }))
const writeHandler = vi.fn(async () => ({ written: true }))

const FAKE_TOOLS: McpToolDefinition[] = [
  {
    name: "read_thing",
    scope: "mcp:read",
    description: "Reads a thing",
    inputSchema: z.object({ q: z.string().optional() }),
    handler: readHandler,
  },
  {
    name: "write_thing",
    scope: "mcp:write",
    description: "Writes a thing",
    inputSchema: z.object({}),
    handler: writeHandler,
  },
  {
    name: "safe_failure",
    scope: "mcp:read",
    description: "Throws a client-safe error",
    inputSchema: z.object({}),
    handler: async () => {
      throw new McpToolError("Job not found")
    },
  },
  {
    name: "unexpected_failure",
    scope: "mcp:read",
    description: "Throws an unexpected error",
    inputSchema: z.object({}),
    handler: async () => {
      throw new Error("connection string postgres://secret leaked")
    },
  },
  {
    name: "big_result",
    scope: "mcp:read",
    description: "Returns an oversized result",
    inputSchema: z.object({}),
    handler: async () => "x".repeat(MAX_TOOL_RESPONSE_CHARS + 100),
  },
]

const clients: Client[] = []

async function connect(scopes: ApiTokenScope[]) {
  const server = createMcpServer({ profileId: "profile-1", tokenId: "token-1", scopes }, FAKE_TOOLS)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test-client", version: "0.0.0" })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  clients.push(client)
  return client
}

function textOf(result: Record<string, unknown>): string {
  const content = result.content as Array<{ type: string; text: string }>
  expect(content).toHaveLength(1)
  expect(content[0].type).toBe("text")
  return content[0].text
}

beforeEach(() => vi.clearAllMocks())
afterEach(async () => {
  await Promise.all(clients.splice(0).map(c => c.close()))
})

describe("createMcpServer", () => {
  it("lists no write tool for a read-only token", async () => {
    const client = await connect(["mcp:read"])
    const { tools } = await client.listTools()
    const names = tools.map(t => t.name)
    expect(names).toContain("read_thing")
    expect(names).not.toContain("write_thing")
  })

  it("lists only write tools for a write-only token", async () => {
    const client = await connect(["mcp:write"])
    const { tools } = await client.listTools()
    expect(tools.map(t => t.name)).toEqual(["write_thing"])
  })

  it("refuses a write tool called by name with a read-only token", async () => {
    const client = await connect(["mcp:read"])
    const result = await client.callTool({ name: "write_thing", arguments: {} })
    expect(result.isError).toBe(true)
    expect(writeHandler).not.toHaveBeenCalled()
  })

  it("passes the token context and parsed args, returning one JSON text item", async () => {
    const client = await connect(["mcp:read"])
    const result = await client.callTool({ name: "read_thing", arguments: { q: "hi" } })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(textOf(result))).toEqual({
      ctx: { profileId: "profile-1", tokenId: "token-1" },
      args: { q: "hi" },
    })
  })

  it("maps McpToolError to isError with its message", async () => {
    const client = await connect(["mcp:read"])
    const result = await client.callTool({ name: "safe_failure", arguments: {} })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe("Job not found")
  })

  it("maps an unexpected error to 'Internal error' and logs it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const client = await connect(["mcp:read"])
    const result = await client.callTool({ name: "unexpected_failure", arguments: {} })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe("Internal error")
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("truncates a result over the cap with a visible marker", async () => {
    const client = await connect(["mcp:read"])
    const result = await client.callTool({ name: "big_result", arguments: {} })
    const text = textOf(result)
    // JSON.stringify adds two quote characters around the string.
    expect(text.length).toBeLessThan(MAX_TOOL_RESPONSE_CHARS + 50)
    expect(text.endsWith("\n[truncated: 102 characters omitted]")).toBe(true)
  })
})

describe("createMcpServer resources", () => {
  it("lists tools and resources, and reads the contract, for an mcp:read token", async () => {
    const client = await connect(["mcp:read"])
    const { tools } = await client.listTools()
    expect(tools.length).toBeGreaterThan(0)
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true)
      expect(tool._meta?.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['mcp:read'] }])
    }
    const { resources } = await client.listResources()
    expect(resources.map(r => r.uri)).toContain("currnt://writing-contract/cv")
    const read = await client.readResource({ uri: "currnt://writing-contract/cv" })
    expect(String((read.contents[0] as { text: string }).text)).toContain("contract-stub")
  })

  it("does not expose the contract resource to a write-only token", async () => {
    const client = await connect(["mcp:write"])
    // No resource is registered, so the SDK installs no resources capability.
    await expect(client.listResources()).rejects.toThrow(/Method not found/)
  })
})

describe("createMcpServer capture-only token", () => {
  it("gets neither tools nor the contract resource", async () => {
    const client = await connect(["capture"])
    const { tools } = await client.listTools()
    expect(tools).toEqual([])
    await expect(client.listResources()).rejects.toThrow(/Method not found/)
  })
})
