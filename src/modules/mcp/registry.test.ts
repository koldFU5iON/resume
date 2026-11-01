import { describe, expect, it } from "vitest"
import * as z from "zod"
import { hasAnyMcpScope, toolsForScopes, type McpToolDefinition } from "./registry"

function tool(name: string, scope: McpToolDefinition["scope"]): McpToolDefinition {
  return { name, scope, description: name, inputSchema: z.object({}), handler: async () => null }
}

const TOOLS = [tool("reader", "mcp:read"), tool("writer", "mcp:write")]

describe("toolsForScopes", () => {
  it("returns only read tools for a read-only token", () => {
    expect(toolsForScopes(TOOLS, ["mcp:read"]).map(t => t.name)).toEqual(["reader"])
  })

  it("does not treat mcp:write as implying mcp:read", () => {
    expect(toolsForScopes(TOOLS, ["mcp:write"]).map(t => t.name)).toEqual(["writer"])
  })

  it("returns both when both scopes are present", () => {
    expect(toolsForScopes(TOOLS, ["mcp:read", "mcp:write"]).map(t => t.name)).toEqual([
      "reader",
      "writer",
    ])
  })

  it("returns nothing for a capture-only token", () => {
    expect(toolsForScopes(TOOLS, ["capture"])).toEqual([])
  })
})

describe("hasAnyMcpScope", () => {
  it("is true when either MCP scope is present", () => {
    expect(hasAnyMcpScope(["mcp:read"])).toBe(true)
    expect(hasAnyMcpScope(["capture", "mcp:write"])).toBe(true)
  })

  it("is false without an MCP scope", () => {
    expect(hasAnyMcpScope(["capture"])).toBe(false)
    expect(hasAnyMcpScope([])).toBe(false)
  })
})
