import { afterEach, describe, expect, it, vi } from "vitest"
import { copyText } from "./copy-text"

const fakeDocument = (execResult: boolean | Error) => {
  const area = { value: "", setAttribute: vi.fn(), select: vi.fn(), style: { cssText: "" } }
  const doc = {
    createElement: vi.fn(() => area),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
    execCommand: vi.fn(() => { if (execResult instanceof Error) throw execResult; return execResult }),
  }
  return { area, doc }
}

afterEach(() => vi.unstubAllGlobals())

describe("copyText", () => {
  it("uses the clipboard API when there is one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    expect(await copyText("hello")).toBe(true)
    expect(writeText).toHaveBeenCalledWith("hello")
  })

  it("falls back to a hidden textarea when the clipboard API is missing", async () => {
    const { area, doc } = fakeDocument(true)
    vi.stubGlobal("navigator", {})
    vi.stubGlobal("document", doc)
    expect(await copyText("hello")).toBe(true)
    expect(area.value).toBe("hello")
    expect(doc.execCommand).toHaveBeenCalledWith("copy")
    expect(doc.body.removeChild).toHaveBeenCalledWith(area) // cleaned up
  })

  it("falls back when the clipboard API refuses (permissions, insecure context)", async () => {
    const { doc } = fakeDocument(true)
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } })
    vi.stubGlobal("document", doc)
    expect(await copyText("hello")).toBe(true)
    expect(doc.execCommand).toHaveBeenCalled()
  })

  it("reports failure when neither works, and never throws", async () => {
    vi.stubGlobal("navigator", {})
    vi.stubGlobal("document", fakeDocument(false).doc)
    expect(await copyText("hello")).toBe(false)
    vi.stubGlobal("document", fakeDocument(new Error("blocked")).doc)
    expect(await copyText("hello")).toBe(false)
  })
})
