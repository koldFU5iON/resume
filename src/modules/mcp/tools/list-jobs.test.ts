import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/modules/jobs/queries", () => ({
  listJobsForAgent: vi.fn(),
}))

import { listJobsForAgent } from "@/modules/jobs/queries"
import { listJobsTool } from "./list-jobs"

const mockList = vi.mocked(listJobsForAgent)
const ctx = { profileId: "profile-1", tokenId: "token-1" }

beforeEach(() => vi.clearAllMocks())

describe("list_jobs tool", () => {
  it("is a read tool named list_jobs", () => {
    expect(listJobsTool.name).toBe("list_jobs")
    expect(listJobsTool.scope).toBe("mcp:read")
  })

  it("defaults include to 'active'", () => {
    expect(listJobsTool.inputSchema.parse({})).toEqual({ include: "active" })
  })

  it("rejects an unknown include value", () => {
    expect(listJobsTool.inputSchema.safeParse({ include: "everything" }).success).toBe(false)
  })

  it("strips a profileId argument so it can never reach the query", () => {
    expect(listJobsTool.inputSchema.parse({ profileId: "other", include: "all" })).toEqual({
      include: "all",
    })
  })

  it("queries with the token's profileId and returns the jobs", async () => {
    const jobs = [{ id: "job-1", title: "Engineer", company: "Acme", status: "applied" }]
    mockList.mockResolvedValue(jobs as never)

    const result = await listJobsTool.handler(ctx, { include: "rejected", company: "Acme" })

    expect(mockList).toHaveBeenCalledWith("profile-1", { include: "rejected", company: "Acme" })
    expect(result).toEqual({ jobs })
  })
})
