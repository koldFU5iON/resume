import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    jobApplication: { findFirst: vi.fn() },
    cVDocument: { findFirst: vi.fn() },
  },
}))
vi.mock("@/modules/profile/snapshot", () => ({
  buildProfileSnapshot: vi.fn(),
  serializeProfileForLLM: vi.fn(),
}))

import { prisma } from "@/lib/db"
import { buildProfileSnapshot, serializeProfileForLLM } from "@/modules/profile/snapshot"
import { BLOCK_LIST } from "@/modules/writing-desk/markdown"
import { McpToolError } from "./errors"
import { getJobContext, getWritingContractForProfile } from "./context"
import { MAX_TOOL_RESPONSE_CHARS } from "./limits"

const mockJob = vi.mocked(prisma.jobApplication.findFirst)
const mockCv = vi.mocked(prisma.cVDocument.findFirst)
const mockSerialize = vi.mocked(serializeProfileForLLM)

const job = {
  id: "job-1",
  title: "Engineer",
  company: "Acme",
  status: "applied",
  jobDescription: "Build things",
}

function masterContent(sectionTypes: string[] = ["header", "capabilities"], extra = "") {
  return JSON.stringify({
    sections: sectionTypes.map((type, i) => ({
      id: String(i),
      type,
      visible: true,
      data:
        type === "header"
          ? { name: "Jane Doe" + extra, headline: "", subHeadline: "", location: "", contact: {} }
          : { items: ["Leadership"] },
    })),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(buildProfileSnapshot).mockResolvedValue({} as never)
  mockSerialize.mockReturnValue("# Jane Doe")
  mockCv.mockResolvedValue(null)
})

describe("getJobContext", () => {
  it("scopes the job lookup to the profile and throws for another profile's job", async () => {
    mockJob.mockResolvedValue(null)
    await expect(getJobContext("profile-2", "job-1")).rejects.toThrow(McpToolError)
    await expect(getJobContext("profile-2", "job-1")).rejects.toThrow("Job not found")
    expect(mockJob.mock.calls[0][0]).toMatchObject({ where: { id: "job-1", profileId: "profile-2" } })
    expect(buildProfileSnapshot).not.toHaveBeenCalled()
  })

  it("sends no contact details: scrubbed profile, {{contact}} in the master CV header", async () => {
    mockJob.mockResolvedValue(job as never)
    vi.mocked(buildProfileSnapshot).mockResolvedValue({ email: "jane@example.test", phone: "+44 7700 900123", linkedin: null, github: null, website: null } as never)
    mockCv.mockResolvedValue({
      generatedContent: JSON.stringify({
        sections: [
          { id: "h", type: "header", visible: true, data: { name: "Jane Doe", headline: "PM", contact: { email: "jane@example.test", phone: "+44 7700 900123" } } },
          { id: "p", type: "profile", visible: true, data: { content: "Reach me on +44 7700 900123." } },
        ],
      }),
    } as never)

    const result = await getJobContext("profile-1", "job-1")
    expect(mockSerialize).toHaveBeenCalledWith(expect.anything())
    expect(mockSerialize.mock.calls[0][1]).toBeUndefined()
    expect(result.masterCv).toContain("# Jane Doe\nPM\n{{contact}}")
    expect(result.masterCv).not.toMatch(/jane@example\.test|7700/)
    expect(result.contract).toContain("{{contact}}")
  })

  it("returns an empty description with a note when missing", async () => {
    mockJob.mockResolvedValue({ ...job, jobDescription: null } as never)
    const result = await getJobContext("profile-1", "job-1")
    expect(result.job.jobDescription).toBe("")
    expect(result.job.descriptionNote).toMatch(/no job description/i)
  })

  it("cuts a 25,000-character description at 20,000 with a marker", async () => {
    mockJob.mockResolvedValue({ ...job, jobDescription: "a".repeat(25_000) } as never)
    const result = await getJobContext("profile-1", "job-1")
    const d = result.job.jobDescription
    expect(d.startsWith("a".repeat(20_000))).toBe(true)
    expect(d.slice(20_000)).toContain("[truncated: 5000 characters omitted]")
    expect(d.length).toBeLessThan(20_100)
  })

  it("marks the job description as untrusted data", async () => {
    mockJob.mockResolvedValue(job as never)
    const result = await getJobContext("profile-1", "job-1")
    expect(result.untrustedFields).toEqual(["job.title", "job.company", "job.jobDescription"])
    expect(result.untrustedNotice).toMatch(/untrusted/i)
    expect(result.untrustedNotice).toMatch(/not instructions/i)
    for (const f of ["job.title", "job.company", "job.jobDescription"]) {
      expect(result.untrustedNotice).toContain(f)
    }
    expect(result.untrustedNotice).toMatch(/profile and masterCv are the user's own/i)
  })

  it("caps a 100,000-character title and company with a marker", async () => {
    mockJob.mockResolvedValue({ ...job, title: "t".repeat(100_000), company: "c".repeat(100_000) } as never)
    const result = await getJobContext("profile-1", "job-1")
    expect(result.job.title.length).toBeLessThan(400)
    expect(result.job.title).toContain("[truncated")
    expect(result.job.company!.length).toBeLessThan(400)
    expect(result.job.company).toContain("[truncated")
    const text = JSON.stringify(result)
    expect(() => JSON.parse(text)).not.toThrow()
    expect(text.length).toBeLessThan(MAX_TOOL_RESPONSE_CHARS)
  })

  it("returns masterCv null and the default guide without a master CV", async () => {
    mockJob.mockResolvedValue(job as never)
    const result = await getJobContext("profile-1", "job-1")
    expect(result.masterCv).toBeNull()
    expect(result.structureGuide.source).toBe("default")
    expect(result.profile).toBe("# Jane Doe")
    expect(result.blocks.map(b => b.id)).toEqual(BLOCK_LIST.map(b => b.id))
    expect(result.contract).toContain("header")
  })

  it("queries the latest master CV for the profile and uses it for markdown and guide", async () => {
    mockJob.mockResolvedValue(job as never)
    mockCv.mockResolvedValue({ generatedContent: masterContent() } as never)
    const result = await getJobContext("profile-1", "job-1")
    expect(mockCv.mock.calls[0][0]).toMatchObject({
      where: { profileId: "profile-1", jobApplicationId: null, careerVerticalId: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { generatedContent: true },
    })
    expect(result.masterCv).toContain("Jane Doe")
    expect(result.structureGuide.source).toBe("master-cv")
    expect(result.contract).toContain("Capabilities")
  })

  it("stays valid JSON under the response cap for worst-case field sizes", async () => {
    const nasty = '"\n'.repeat(60_000)
    const huge = "x".repeat(100_000)
    mockJob.mockResolvedValue({ ...job, title: huge, company: huge, jobDescription: nasty } as never)
    mockSerialize.mockReturnValue(nasty)
    mockCv.mockResolvedValue({ generatedContent: masterContent(["header"], nasty) } as never)
    const result = await getJobContext("profile-1", "job-1")
    const text = JSON.stringify(result)
    expect(text.length).toBeLessThan(MAX_TOOL_RESPONSE_CHARS)
    expect(text.length).toBeLessThan(MAX_TOOL_RESPONSE_CHARS - 2_000)
    expect(() => JSON.parse(text)).not.toThrow()
    expect(result.job.jobDescription).toContain("[truncated")
    expect(result.profile).toContain("[truncated")
    expect(result.masterCv).toContain("[truncated")
  })
})

describe("getWritingContractForProfile", () => {
  it("builds the contract from the owner's current master CV", async () => {
    mockCv.mockResolvedValue({ generatedContent: masterContent() } as never)
    const text = await getWritingContractForProfile("profile-1")
    expect(mockCv.mock.calls[0][0]).toMatchObject({ where: { profileId: "profile-1" } })
    expect(text).toContain("Capabilities")
  })
})
