import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/session", () => ({ requireProfile: vi.fn() }))
vi.mock("@/lib/db", () => ({ prisma: { jobApplication: { findFirst: vi.fn() } } }))
vi.mock("@/modules/job-assessment/queries", () => ({
  getEarlyAssessmentForJob: vi.fn().mockResolvedValue(null),
  getEarlyAssessmentsForJobs: vi.fn(),
  isEarlyAssessmentEnabled: vi.fn().mockResolvedValue(false),
}))
vi.mock("@/modules/deep-dive/queries", () => ({ getDeepDiveSummary: vi.fn().mockResolvedValue(null), getDeepDiveSummaries: vi.fn() }))
vi.mock("@/modules/deep-dive/access", () => ({ getDeepDiveAccess: vi.fn().mockResolvedValue({ enabled: false }) }))

import { prisma } from "@/lib/db"
import { getJobWorkspace } from "./queries"

const findFirst = vi.mocked(prisma.jobApplication.findFirst)
const row = (over: object = {}) => ({
  id: "job-1", title: "PM", company: "Acme", url: null, status: "saved", archivedAt: null,
  cvDocuments: [], coverLetters: [], interviewPrepSessions: [], writingDesks: [], cvGenerations: [], ...over,
})

describe("getJobWorkspace: hasCvGeneration (the CV generation entry in the job's documents menu)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("is false for a job with no CV generation run", async () => {
    findFirst.mockResolvedValue(row() as never)
    expect((await getJobWorkspace("profile-1", "job-1"))?.hasCvGeneration).toBe(false)
  })

  it("is true once the job has a run", async () => {
    findFirst.mockResolvedValue(row({ cvGenerations: [{ id: "run-1" }] }) as never)
    expect((await getJobWorkspace("profile-1", "job-2"))?.hasCvGeneration).toBe(true)
  })

  it("only counts the signed-in profile's runs (one cheap, profile-scoped query)", async () => {
    findFirst.mockResolvedValue(row() as never)
    await getJobWorkspace("profile-9", "job-3")
    const select = (findFirst.mock.calls.at(-1)?.[0] as { select: { cvGenerations: unknown } }).select
    expect(select.cvGenerations).toEqual({ where: { profileId: "profile-9" }, select: { id: true }, take: 1 })
  })
})
