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

  it.each(["constructor", "toString", "hasOwnProperty"])("treats :::%s as an unknown block without throwing", name => {
    const result = validateDraftMarkdown(`# Hi\n\n:::${name}\n- a\n:::\n`)
    expect(result.ok).toBe(false)
    expect(result.issues.filter(i => i.severity === "error")).toEqual([
      expect.objectContaining({ line: 3 }),
    ])
  })

  it("does not throw on :::__proto__ (not a valid directive name, parsed as plain text)", () => {
    expect(() => validateDraftMarkdown("# Hi\n\n:::__proto__\n- a\n:::\n")).not.toThrow()
  })

  it.each(["Skills", "FANCY"])("treats uppercase :::%s as an error", name => {
    expect(validateDraftMarkdown(`:::${name}\n- a\n:::\n`).ok).toBe(false)
  })

  it("reports an unknown block nested in a known block at its own line", () => {
    const result = validateDraftMarkdown(":::skills\n::::fancy\n- a\n::::\n:::\n")
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "error", line: 2 }))
  })

  it("ignores unknown blocks inside a code fence", () => {
    expect(validateDraftMarkdown("```\n:::fancy\n- a\n:::\n```\n")).toEqual({ ok: true, issues: [] })
  })

  it("errors on an unclosed known block with the opening line", () => {
    const result = validateDraftMarkdown("# Hi\n\n:::skills\n- a\n")
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      { severity: "error", message: "Block ':::skills' opened at line 3 is never closed with ':::'", line: 3 },
    ])
  })

  it("reports no fence issue for balanced blocks", () => {
    expect(validateDraftMarkdown(":::skills\n- a\n:::\n\n:::compact-list\n- b\n:::\n")).toEqual({ ok: true, issues: [] })
  })

  it("does not flag :::skills that only appears in a code fence", () => {
    expect(validateDraftMarkdown("~~~\n:::skills\n- a\n~~~\n")).toEqual({ ok: true, issues: [] })
  })
})
