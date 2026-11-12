import { describe, expect, it } from "vitest"
import { newerSavedVersion, planAcceptedUpdate, type EditorSnapshot } from "./accepted-update"

const clean: EditorSnapshot = { content: "Saved text", revision: 4, pending: null, conflict: null }
const accepted = { content: "Accepted draft", revision: 5 }

describe("planAcceptedUpdate", () => {
  it("applies the accepted text when nothing is unsaved", () => {
    expect(planAcceptedUpdate(clean, accepted)).toEqual({ kind: "apply" })
  })

  it("ignores a stale or repeated event when nothing is unsaved", () => {
    expect(planAcceptedUpdate({ ...clean, revision: 5 }, accepted)).toEqual({ kind: "ignore" })
    expect(planAcceptedUpdate({ ...clean, revision: 6 }, accepted)).toEqual({ kind: "ignore" })
  })

  it("keeps unsaved edits and compares them with the accepted text (#378)", () => {
    const typing: EditorSnapshot = { ...clean, content: "Saved text, plus what I typed", pending: "Saved text, plus what I typed" }
    expect(planAcceptedUpdate(typing, accepted)).toEqual({ kind: "conflict", compareWith: accepted })
  })

  it("keeps edits from a failed save the same way", () => {
    const failed: EditorSnapshot = { ...clean, content: "Edited offline", pending: "Edited offline" }
    expect(planAcceptedUpdate(failed, accepted)).toEqual({ kind: "conflict", compareWith: accepted })
  })

  it("stays in conflict when already in one, comparing with the newer saved version", () => {
    const older = { content: "Other tab", revision: 5 }
    const conflicted: EditorSnapshot = { ...clean, content: "Mine", pending: "Mine", conflict: older }
    expect(planAcceptedUpdate(conflicted, { content: "Accepted draft", revision: 6 }))
      .toEqual({ kind: "conflict", compareWith: { content: "Accepted draft", revision: 6 } })

    const newer = { content: "Saved after the accept", revision: 7 }
    expect(planAcceptedUpdate({ ...conflicted, conflict: newer }, { content: "Accepted draft", revision: 6 }))
      .toEqual({ kind: "conflict", compareWith: newer })
  })

  it("keeps a conflict with no pending text (edits kept, save refused)", () => {
    const conflicted: EditorSnapshot = { ...clean, content: "Mine", conflict: { content: "Accepted draft", revision: 5 } }
    expect(planAcceptedUpdate(conflicted, accepted)).toEqual({ kind: "conflict", compareWith: accepted })
  })

  it("applies when the unsaved text is exactly what was accepted: nothing would be lost", () => {
    const same: EditorSnapshot = { ...clean, content: "Accepted draft", pending: "Accepted draft" }
    expect(planAcceptedUpdate(same, accepted)).toEqual({ kind: "apply" })
  })

  it("leaves unsaved edits alone for a stale event: they already build on a newer revision", () => {
    const typing: EditorSnapshot = { ...clean, revision: 6, content: "Mine", pending: "Mine" }
    expect(planAcceptedUpdate(typing, accepted)).toEqual({ kind: "ignore" })
  })
})

describe("newerSavedVersion", () => {
  it("keeps the newer of the two", () => {
    const a = { content: "a", revision: 3 }
    const b = { content: "b", revision: 4 }
    expect(newerSavedVersion(null, a)).toBe(a)
    expect(newerSavedVersion(b, a)).toBe(b)
    expect(newerSavedVersion(a, b)).toBe(b)
  })
})
