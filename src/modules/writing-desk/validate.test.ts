import { describe, expect, it } from "vitest"
import { MAX_WRITING_DESK_CONTENT_LENGTH } from "./schema"
import { buildStructureGuide } from "./structure-guide"
import { validateDraftMarkdown } from "./validate"

describe("validateDraftMarkdown", () => {
  it("errors on an unknown block with its line", () => {
    const result = validateDraftMarkdown("# Hi\n\n:::fancy-grid\n- a\n:::\n")
    expect(result.ok).toBe(false)
    const errors = result.issues.filter(i => i.severity === "error")
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ line: 3 })
    expect(errors[0].message).toContain("fancy-grid")
    expect(result.issues.some(i => i.severity === "warning" && i.message.startsWith("Unknown block"))).toBe(false)
  })

  it("accepts known blocks", () => {
    const md = [
      ":::header\n# Name\n:::",
      ":::skills\n- A\n:::",
      ":::inline-list\n- A\n:::",
      ":::compact-list\n- A\n:::",
    ].join("\n\n")
    expect(validateDraftMarkdown(md)).toEqual({ ok: true, issues: [] })
  })

  it("passes nested block diagnostics through as warnings", () => {
    const md = ":::skills\n::::compact-list\n- A\n::::\n:::\n"
    const result = validateDraftMarkdown(md)
    expect(result.ok).toBe(true)
    expect(result.issues.some(i => i.severity === "warning" && /nested/i.test(i.message))).toBe(true)
  })

  it("errors on oversize content", () => {
    const result = validateDraftMarkdown("a".repeat(MAX_WRITING_DESK_CONTENT_LENGTH + 1))
    expect(result.ok).toBe(false)
    expect(result.issues[0].severity).toBe("error")
  })

  it("notes a missing guide section as info and stays ok", () => {
    const guide = buildStructureGuide(null)
    const result = validateDraftMarkdown("## Professional Experience\n\ntext\n", guide)
    expect(result.ok).toBe(true)
    expect(result.issues).toContainEqual({ severity: "info", message: "No Professional Profile section" })
    expect(result.issues.every(i => i.severity === "info")).toBe(true)
  })

  it("produces no issues for extra or reordered sections", () => {
    const guide = { source: "default" as const, sections: [{ key: "a", heading: "Alpha" }, { key: "b", heading: "Beta" }] }
    expect(validateDraftMarkdown("## Beta\n\nx\n\n## Gamma\n\ny\n\n## Alpha\n\nz\n", guide)).toEqual({ ok: true, issues: [] })
  })
})
