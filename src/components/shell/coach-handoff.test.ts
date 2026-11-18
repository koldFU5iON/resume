import { afterEach, describe, expect, it, vi } from "vitest"
import { COACH_DRAFT_EVENT, openCoachWithDraft } from "./coach-handoff"

describe("openCoachWithDraft", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("dispatches the draft as an event (the coach fills its input; nothing is sent)", () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal("window", { dispatchEvent })
    vi.stubGlobal("CustomEvent", class { constructor(public type: string, public init: { detail: unknown }) {} get detail() { return this.init.detail } })
    openCoachWithDraft("  Hello coach  ")
    const ev = dispatchEvent.mock.calls[0][0] as { type: string; detail: { text: string } }
    expect(ev.type).toBe(COACH_DRAFT_EVENT)
    expect(ev.detail).toEqual({ text: "Hello coach" })
  })

  it("does nothing for empty text or with no window", () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal("window", { dispatchEvent })
    openCoachWithDraft("   ")
    expect(dispatchEvent).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    expect(() => openCoachWithDraft("x")).not.toThrow()
  })

  it("ChatPanel fills its input from the event and never sends it", async () => {
    const { readFileSync } = await import("node:fs")
    const src = readFileSync("src/components/shell/chat-panel.tsx", "utf8")
    const block = src.slice(src.indexOf("function onDraft"), src.indexOf("window.removeEventListener(COACH_DRAFT_EVENT"))
    expect(block).toContain("setInput(text)")
    expect(block).toContain("openPanel()")
    expect(block).not.toMatch(/sendMessage|handleSend/)
  })
})
