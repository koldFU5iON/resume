import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

vi.mock("@/lib/session", () => ({ requireProfile: vi.fn() }))
vi.mock("@/modules/cv-generation/run-pipeline", () => ({ startCvGeneration: vi.fn() }))

import { requireProfile } from "@/lib/session"
import { startCvGeneration } from "@/modules/cv-generation/run-pipeline"
import { CV_GENERATION_ROUTE_MAX_DURATION_S } from "@/modules/cv-generation/schema"
import { POST, maxDuration } from "./route"

const mockProfile = vi.mocked(requireProfile)
const mockStart = vi.mocked(startCvGeneration)

const params = (id = "job-1") => ({ params: Promise.resolve({ id }) })
const req = () => new Request("http://localhost/api/jobs/job-1/cv-generation", { method: "POST" }) as unknown as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  mockProfile.mockResolvedValue({ profile: { id: "p1" }, session: {} } as never)
})

describe("POST /api/jobs/[id]/cv-generation", () => {
  it("401 when not signed in, and starts nothing", async () => {
    mockProfile.mockRejectedValue(new Error("Unauthorized"))
    const res = await POST(req(), params())
    expect(res.status).toBe(401)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it("starts a preview run for the signed-in profile: 202 with the run id", async () => {
    mockStart.mockResolvedValue({ kind: "started", runId: "run-1" })
    const res = await POST(req(), params())
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ runId: "run-1", existing: false })
    expect(mockStart).toHaveBeenCalledWith("p1", "job-1", { stopAfter: "assembling" })
  })

  it("200 with the running run when one is already active", async () => {
    mockStart.mockResolvedValue({ kind: "existing", runId: "run-0" })
    const res = await POST(req(), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ runId: "run-0", existing: true })
  })

  it("404 for a job that is not the caller's (the module queries by profile)", async () => {
    mockProfile.mockResolvedValue({ profile: { id: "p-other" }, session: {} } as never)
    mockStart.mockResolvedValue({ kind: "not_found" })
    const res = await POST(req(), params("someone-elses-job"))
    expect(res.status).toBe(404)
    expect(mockStart).toHaveBeenCalledWith("p-other", "someone-elses-job", { stopAfter: "assembling" })
  })

  it("429 at the per-profile limit", async () => {
    mockStart.mockResolvedValue({ kind: "limit" })
    const res = await POST(req(), params())
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe("limit")
  })

  it("runs within the platform's 300 s function limit", () => {
    expect(maxDuration).toBe(300)
    expect(CV_GENERATION_ROUTE_MAX_DURATION_S).toBe(maxDuration) // route config must be a literal: this keeps them in sync
  })
})
