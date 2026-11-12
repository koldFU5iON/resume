import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

vi.mock("@/lib/db", () => ({ prisma: { profile: { findUnique: vi.fn() } } }))
vi.mock("@/lib/session", () => ({ getSession: vi.fn() }))
vi.mock("@/modules/api-tokens/service", () => ({ verifyBearerHeader: vi.fn() }))
vi.mock("@/modules/deep-dive/run", () => ({ startDeepDive: vi.fn() }))
vi.mock("@/modules/deep-dive/queries", () => ({ getLatestDeepDive: vi.fn() }))

import { prisma } from "@/lib/db"
import { getSession } from "@/lib/session"
import { verifyBearerHeader } from "@/modules/api-tokens/service"
import { getLatestDeepDive } from "@/modules/deep-dive/queries"
import { startDeepDive } from "@/modules/deep-dive/run"
import { GET, POST } from "./route"

const mockVerify = vi.mocked(verifyBearerHeader)
const mockSession = vi.mocked(getSession)
const mockStart = vi.mocked(startDeepDive)
const mockLatest = vi.mocked(getLatestDeepDive)

const params = { params: Promise.resolve({ id: "job-1" }) }
function req(bearer?: string) {
  return new Request("http://localhost/api/jobs/job-1/deep-dive", {
    method: "POST",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  }) as unknown as NextRequest
}

beforeEach(() => vi.clearAllMocks())

describe("/api/jobs/[id]/deep-dive", () => {
  it("401 without a session or token", async () => {
    mockSession.mockResolvedValue(null)
    expect((await POST(req(), params)).status).toBe(401)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it("401 for an invalid token, without falling back to the session", async () => {
    mockVerify.mockResolvedValue(null)
    expect((await POST(req("rsm_bad"), params)).status).toBe(401)
    expect(mockSession).not.toHaveBeenCalled()
  })

  it("403 for a token without deep-dive:run", async () => {
    mockVerify.mockResolvedValue({ profileId: "p", tokenId: "t", scopes: ["capture"] })
    expect((await POST(req("rsm_x"), params)).status).toBe(403)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it("starts a run for a scoped token: 202 with the id", async () => {
    mockVerify.mockResolvedValue({ profileId: "p", tokenId: "t", scopes: ["deep-dive:run"] })
    mockStart.mockResolvedValue({ kind: "started", deepDiveId: "dd-1" })
    const res = await POST(req("rsm_x"), params)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ deepDiveId: "dd-1", existing: false })
    expect(mockStart).toHaveBeenCalledWith("p", "job-1")
  })

  it("uses the session's profile", async () => {
    mockSession.mockResolvedValue({ user: { id: "u1" } } as never)
    vi.mocked(prisma.profile.findUnique).mockResolvedValue({ id: "p-session" } as never)
    mockStart.mockResolvedValue({ kind: "existing", deepDiveId: "dd-0" })
    const res = await POST(req(), params)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ deepDiveId: "dd-0", existing: true })
    expect(mockStart).toHaveBeenCalledWith("p-session", "job-1")
  })

  it.each([
    ["not_found", 404],
    ["no_description", 422],
    ["no_llm_key", 422],
    ["limit", 429],
  ] as const)("maps %s to %i", async (kind, status) => {
    mockVerify.mockResolvedValue({ profileId: "p", tokenId: "t", scopes: ["deep-dive:run"] })
    mockStart.mockResolvedValue({ kind })
    const res = await POST(req("rsm_x"), params)
    expect(res.status).toBe(status)
    expect((await res.json()).error).toBe(kind)
  })

  it("GET returns the newest run, or 404", async () => {
    mockVerify.mockResolvedValue({ profileId: "p", tokenId: "t", scopes: ["deep-dive:run"] })
    mockLatest.mockResolvedValueOnce(null)
    expect((await GET(req("rsm_x"), params)).status).toBe(404)
    mockLatest.mockResolvedValueOnce({ id: "dd-1", status: "researching" } as never)
    const res = await GET(req("rsm_x"), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: "dd-1", status: "researching" })
    expect(mockLatest).toHaveBeenCalledWith("p", "job-1")
  })
})
