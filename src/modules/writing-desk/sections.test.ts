import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  applySectionOp,
  hashSectionText,
  joinSections,
  splitSections,
} from "./sections"

const SAMPLE = `Intro line

## Professional Experience

Did things.

:::skills
- A
- B
:::

## Education

BSc.
`

const ids = (md: string) => splitSections(md).map((s) => s.id)

describe("splitSections", () => {
  it("gives heading sections slug ids", () => {
    expect(ids("## Professional Experience\n\nText\n")).toEqual([
      "professional-experience",
    ])
  })

  it("treats a :::header block containing a heading as one section", () => {
    const md = ":::header\n# Morgan Ellis\n## PM\n:::\n\n## Profile\n\nHi\n"
    const sections = splitSections(md)
    expect(sections.map((s) => s.id)).toEqual(["header", "profile"])
    expect(sections[0].text).toBe(":::header\n# Morgan Ellis\n## PM\n:::")
  })

  it("suffixes duplicate ids by occurrence order", () => {
    expect(ids("## Education\n\na\n\n## Education\n\nb\n\n## Education\n\nc\n")).toEqual([
      "education",
      "education-2",
      "education-3",
    ])
  })

  it("puts text before the first boundary in a preamble section", () => {
    expect(ids("Hello\n\n## Skills\n\nx\n")).toEqual(["preamble", "skills"])
  })

  it("does not split on # or ::: inside fenced code", () => {
    const md = "## Notes\n\n```\n# not a heading\n:::skills\n```\n\nafter\n"
    const sections = splitSections(md)
    expect(sections.map((s) => s.id)).toEqual(["notes"])
    expect(sections[0].text).toContain(":::skills")
  })

  it("handles tilde fences", () => {
    expect(ids("## A\n\n~~~\n## B\n~~~\n")).toEqual(["a"])
  })

  it("splits CRLF input the same as LF", () => {
    expect(splitSections(SAMPLE.replace(/\n/g, "\r\n"))).toEqual(
      splitSections(SAMPLE),
    )
  })

  it("treats the remainder after an unclosed ::: fence as one section", () => {
    const md = "## A\n\nx\n\n:::skills\n- one\n\n## Not A Heading\n\nmore\n"
    const sections = splitSections(md)
    expect(sections.map((s) => s.id)).toEqual(["a", "skills"])
    expect(sections[1].text).toContain("## Not A Heading")
  })

  it("supports nested directives without ending early", () => {
    const md = ":::outer\n:::inner\nx\n:::\n## still inside\n:::\n\n## Next\n"
    expect(ids(md)).toEqual(["outer", "next"])
  })

  it("returns no sections for empty input", () => {
    expect(splitSections("")).toEqual([])
    expect(splitSections("\n\n")).toEqual([])
  })

  it("splits the realistic CV fixture sensibly and round-trips", () => {
    const md = readFileSync(
      join(__dirname, "__fixtures__", "cv-regression.md"),
      "utf8",
    )
    const sections = splitSections(md)
    const found = sections.map((s) => s.id)
    expect(found[0]).toBe("header")
    expect(found).toContain("professional-profile")
    expect(found).toContain("core-competencies")
    expect(found).toContain("professional-experience")
    expect(found).toContain("northstar-interactive")
    // Directive-contained lists never become their own heading sections.
    expect(new Set(found).size).toBe(found.length)
    // Re-splitting the joined output is stable.
    expect(splitSections(joinSections(sections))).toEqual(sections)
  })
})

describe("hashSectionText", () => {
  it("ignores surrounding whitespace", () => {
    expect(hashSectionText("  \nhello\n\n")).toBe(hashSectionText("hello"))
  })

  it("is 12 hex chars and changes with content", () => {
    expect(hashSectionText("a")).toMatch(/^[0-9a-f]{12}$/)
    expect(hashSectionText("a")).not.toBe(hashSectionText("b"))
  })
})

describe("joinSections", () => {
  it("round-trips a canonically formatted sample", () => {
    expect(joinSections(splitSections(SAMPLE))).toBe(SAMPLE)
  })

  it("returns an empty string for no sections", () => {
    expect(joinSections([])).toBe("")
  })
})

describe("applySectionOp", () => {
  const sections = splitSections(SAMPLE)
  const byId = (id: string) => sections.find((s) => s.id === id)!

  it("replaces with a correct hash and leaves other sections byte-identical", () => {
    const target = byId("education")
    const result = applySectionOp(SAMPLE, {
      type: "replace",
      sectionId: "education",
      expectedHash: target.hash,
      content: "## Education\n\nMSc.",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const after = splitSections(result.markdown)
    expect(after.find((s) => s.id === "education")!.text).toBe(
      "## Education\n\nMSc.",
    )
    for (const s of sections.filter((x) => x.id !== "education")) {
      expect(after.find((a) => a.id === s.id)!.text).toBe(s.text)
    }
  })

  it("returns hash_mismatch with the live section on a stale hash", () => {
    const result = applySectionOp(SAMPLE, {
      type: "replace",
      sectionId: "education",
      expectedHash: "000000000000",
      content: "x",
    })
    expect(result).toMatchObject({ ok: false, reason: "hash_mismatch" })
    if (result.ok) return
    expect(result.current).toEqual(byId("education"))
    expect(result.sections).toEqual(sections)
  })

  it("returns section_not_found with the current section list", () => {
    const result = applySectionOp(SAMPLE, {
      type: "remove",
      sectionId: "nope",
      expectedHash: "x",
    })
    expect(result).toMatchObject({ ok: false, reason: "section_not_found" })
    if (result.ok) return
    expect(result.sections).toEqual(sections)
    expect(result.current).toBeUndefined()
  })

  it("inserts after a section", () => {
    const result = applySectionOp(SAMPLE, {
      type: "insert",
      afterSectionId: "preamble",
      content: "## Awards\n\nWon.",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(ids(result.markdown)).toEqual([
      "preamble",
      "awards",
      "professional-experience",
      "skills",
      "education",
    ])
  })

  it("inserts at start and end", () => {
    const start = applySectionOp(SAMPLE, {
      type: "insert",
      position: "start",
      content: "## First\n\n1",
    })
    const end = applySectionOp(SAMPLE, {
      type: "insert",
      position: "end",
      content: "## Last\n\n2",
    })
    expect(start.ok && ids(start.markdown)[0]).toBe("first")
    expect(end.ok && ids(end.markdown).at(-1)).toBe("last")
  })

  it("rejects insert without exactly one anchor", () => {
    expect(
      applySectionOp(SAMPLE, { type: "insert", content: "x" }),
    ).toMatchObject({ ok: false, reason: "invalid_op" })
    expect(
      applySectionOp(SAMPLE, {
        type: "insert",
        afterSectionId: "education",
        position: "end",
        content: "x",
      }),
    ).toMatchObject({ ok: false, reason: "invalid_op" })
  })

  it("reports section_not_found for an unknown insert anchor", () => {
    expect(
      applySectionOp(SAMPLE, {
        type: "insert",
        afterSectionId: "nope",
        content: "x",
      }),
    ).toMatchObject({ ok: false, reason: "section_not_found" })
  })

  it("removes a section with a correct hash", () => {
    const result = applySectionOp(SAMPLE, {
      type: "remove",
      sectionId: "skills",
      expectedHash: byId("skills").hash,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(ids(result.markdown)).toEqual([
      "preamble",
      "professional-experience",
      "education",
    ])
  })

  it("still succeeds when a different section was changed by hand", () => {
    const hash = byId("education").hash
    const edited = SAMPLE.replace("Did things.", "Did other things by hand.")
    const result = applySectionOp(edited, {
      type: "replace",
      sectionId: "education",
      expectedHash: hash,
      content: "## Education\n\nPhD.",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.markdown).toContain("Did other things by hand.")
    expect(result.markdown).toContain("PhD.")
  })
})
