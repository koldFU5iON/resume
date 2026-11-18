import { describe, expect, it, vi } from "vitest"
import { discardDraftThenStart, requestCvGeneration } from "./cv-generation-start"

const reply = (status: number, body: unknown = {}) => vi.fn().mockResolvedValue({ status, json: async () => body })

describe("requestCvGeneration (the writing desk entry point's POST)", () => {
  it("POSTs /api/jobs/[id]/cv-generation with no body by default (reuse)", async () => {
    const f = reply(202, { runId: "r1", existing: false })
    await expect(requestCvGeneration("job 1", {}, f)).resolves.toEqual({ kind: "started", existing: false })
    expect(f).toHaveBeenCalledWith("/api/jobs/job%201/cv-generation", { method: "POST" })
  })

  it("sends { fresh: true } for the Fresh option", async () => {
    const f = reply(202)
    await requestCvGeneration("j", { fresh: true }, f)
    const init = f.mock.calls[0][1] as RequestInit
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ fresh: true })
  })

  it("200 means a run was already going", async () => {
    await expect(requestCvGeneration("j", {}, reply(200))).resolves.toEqual({ kind: "started", existing: true })
  })

  it("409 is draft_exists with the document id", async () => {
    await expect(requestCvGeneration("j", {}, reply(409, { code: "draft_exists", documentId: "d1" }))).resolves.toEqual({ kind: "draft_exists", documentId: "d1" })
  })

  it("other statuses and a network failure are errors with a message", async () => {
    expect((await requestCvGeneration("j", {}, reply(429))).kind).toBe("error")
    expect((await requestCvGeneration("j", {}, vi.fn().mockRejectedValue(new Error("x")))).kind).toBe("error")
  })
})

describe("discardDraftThenStart (the Discard draft choice)", () => {
  it("discards the waiting draft, then starts the run", async () => {
    const order: string[] = []
    const discard = vi.fn(async () => { order.push("discard"); return { ok: true } })
    const f = vi.fn(async () => { order.push("post"); return { status: 202, json: async () => ({}) } })
    await expect(discardDraftThenStart("j", "d1", { fresh: true }, { discard, fetch: f })).resolves.toEqual({ kind: "started", existing: false })
    expect(discard).toHaveBeenCalledWith("d1")
    expect(order).toEqual(["discard", "post"])
  })

  it("starts nothing when the discard fails", async () => {
    const f = reply(202)
    const out = await discardDraftThenStart("j", "d1", {}, { discard: async () => ({ ok: false, message: "Draft not found" }), fetch: f })
    expect(out).toEqual({ kind: "error", message: "Draft not found" })
    expect(f).not.toHaveBeenCalled()
  })

  it("starts nothing when the discard throws", async () => {
    const f = reply(202)
    const out = await discardDraftThenStart("j", "d1", {}, { discard: async () => { throw new Error("boom") }, fetch: f })
    expect(out.kind).toBe("error")
    expect(f).not.toHaveBeenCalled()
  })

  it("treats an already-gone draft (no_draft) as discarded and starts the run", async () => {
    const f = reply(202)
    const out = await discardDraftThenStart("j", "d1", {}, { discard: async () => ({ ok: false, reason: "no_draft", message: "gone" }), fetch: f })
    expect(out).toEqual({ kind: "started", existing: false })
    expect(f).toHaveBeenCalledTimes(1)
  })
})
