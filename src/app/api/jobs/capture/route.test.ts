import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/modules/api-tokens/service", () => ({
  verifyBearerHeader: vi.fn(),
}))
vi.mock("@/modules/jobs/capture", () => ({
  captureJobFromUrl: vi.fn(),
}))

import { verifyBearerHeader } from "@/modules/api-tokens/service"
import { captureJobFromUrl } from "@/modules/jobs/capture"
import { POST } from "./route"

const mockVerify = vi.mocked(verifyBearerHeader)
const mockCapture = vi.mocked(captureJobFromUrl)

function req() {
  return new Request("http://localhost/api/jobs/capture", {
    method: "POST",
    headers: { authorization: "Bearer rsm_x", "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/job" }),
  })
}

beforeEach(() => vi.clearAllMocks())

describe("POST /api/jobs/capture", () => {
  it("returns 403 when the token lacks the capture scope", async () => {
    mockVerify.mockResolvedValue({ profileId: "p", tokenId: "t", scopes: ["mcp:read"] })
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: "forbidden",
      message: "Token lacks the capture scope",
    })
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it("proceeds when the token has the capture scope", async () => {
    mockVerify.mockResolvedValue({ profileId: "p", tokenId: "t", scopes: ["capture"] })
    mockCapture.mockResolvedValue({
      ok: true,
      created: true,
      duplicate: null,
      extraction: {},
      job: { id: "j1", title: "T", company: "C" },
    } as never)
    const res = await POST(req())
    expect(res.status).toBe(201)
    expect(mockCapture).toHaveBeenCalledWith(
      "p",
      expect.objectContaining({ url: "https://example.com/job" }),
      { requestStartedAt: expect.any(Number) },
    )
  })
})
