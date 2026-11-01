import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../context", () => ({ getJobContext: vi.fn() }))

import { getJobContext } from "../context"
import { getJobContextTool } from "./get-job-context"
import { ALL_MCP_TOOLS } from "./index"
import { toolsForScopes } from "../registry"

beforeEach(() => vi.clearAllMocks())

describe("get_job_context tool", () => {
  it("is a read tool registered in ALL_MCP_TOOLS", () => {
    expect(getJobContextTool.name).toBe("get_job_context")
    expect(getJobContextTool.scope).toBe("mcp:read")
    expect(ALL_MCP_TOOLS).toContain(getJobContextTool)
  })

  it("is absent for a token without mcp:read", () => {
    const names = toolsForScopes(ALL_MCP_TOOLS, ["mcp:write"]).map(t => t.name)
    expect(names).not.toContain("get_job_context")
  })

  it("requires jobId and strips a profileId argument", () => {
    expect(getJobContextTool.inputSchema.safeParse({}).success).toBe(false)
    expect(getJobContextTool.inputSchema.parse({ jobId: "j", profileId: "x" })).toEqual({ jobId: "j" })
  })

  it("calls getJobContext with the token's profileId", async () => {
    vi.mocked(getJobContext).mockResolvedValue({ ok: true } as never)
    const result = await getJobContextTool.handler({ profileId: "p1", tokenId: "t" }, { jobId: "j1" })
    expect(getJobContext).toHaveBeenCalledWith("p1", "j1")
    expect(result).toEqual({ ok: true })
  })
})
