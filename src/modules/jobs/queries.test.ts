import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/session", () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: "profile-1" } }),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    jobApplication: { findMany: vi.fn() },
  },
}))

import { prisma } from "@/lib/db"
import { listJobsForAgent } from "./queries"

const mockFindMany = vi.mocked(prisma.jobApplication.findMany)

function lastWhere() {
  const call = mockFindMany.mock.calls.at(-1)
  return (call?.[0] as { where: Record<string, unknown> }).where
}

describe("listJobsForAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindMany.mockResolvedValue([] as never)
  })

  it("defaults to active jobs: not archived and not rejected", async () => {
    await listJobsForAgent("profile-1", {})
    expect(lastWhere()).toEqual({
      profileId: "profile-1",
      archivedAt: null,
      status: { not: "rejected" },
    })
  })

  it("include 'active' matches the default", async () => {
    await listJobsForAgent("profile-1", { include: "active" })
    expect(lastWhere()).toEqual({
      profileId: "profile-1",
      archivedAt: null,
      status: { not: "rejected" },
    })
  })

  it("include 'rejected' returns unarchived rejected jobs", async () => {
    await listJobsForAgent("profile-1", { include: "rejected" })
    expect(lastWhere()).toEqual({
      profileId: "profile-1",
      archivedAt: null,
      status: "rejected",
    })
  })

  it("include 'archived' returns archived jobs of any status", async () => {
    await listJobsForAgent("profile-1", { include: "archived" })
    expect(lastWhere()).toEqual({
      profileId: "profile-1",
      archivedAt: { not: null },
    })
  })

  it("include 'all' only filters by profile", async () => {
    await listJobsForAgent("profile-1", { include: "all" })
    expect(lastWhere()).toEqual({ profileId: "profile-1" })
  })

  it("adds a case-insensitive contains filter for company", async () => {
    await listJobsForAgent("profile-2", { include: "all", company: "Acme" })
    expect(lastWhere()).toEqual({
      profileId: "profile-2",
      company: { contains: "Acme", mode: "insensitive" },
    })
  })

  it("ignores a blank company filter", async () => {
    await listJobsForAgent("profile-1", { include: "all", company: "   " })
    expect(lastWhere()).toEqual({ profileId: "profile-1" })
  })

  it("selects only the summary fields and returns the rows", async () => {
    const row = {
      id: "job-1",
      title: "Engineer",
      company: "Acme",
      status: "applied",
      dateApplied: new Date("2026-10-01T00:00:00Z"),
      lastUpdated: new Date("2026-10-02T00:00:00Z"),
    }
    mockFindMany.mockResolvedValue([row] as never)

    await expect(listJobsForAgent("profile-1", {})).resolves.toEqual([row])
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          title: true,
          company: true,
          status: true,
          dateApplied: true,
          lastUpdated: true,
        },
        orderBy: { lastUpdated: "desc" },
      }),
    )
  })
})
