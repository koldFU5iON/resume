import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { WritingDeskPreview } from "./writing-desk-preview"

const markdown = "Led the team. ![pixel](https://evil.test/p.png) See [the report](https://evil.test/r).\n\n:::compact-list\n- Shipped 12 titles.\n:::"
const html = (props: { blockRemoteContent?: boolean }) =>
  renderToStaticMarkup(<WritingDeskPreview markdown={markdown} documentType="cv" {...props} />)

describe("WritingDeskPreview", () => {
  it("renders images and links as before by default (the writing desk editor is unchanged)", () => {
    const out = html({})
    expect(out).toContain("<img")
    expect(out).toContain('href="https://evil.test/r"')
  })

  it("blockRemoteContent renders no image and no link, only the link text, and keeps the blocks", () => {
    const out = html({ blockRemoteContent: true })
    expect(out).not.toContain("<img")
    expect(out).not.toContain("evil.test")
    expect(out).toContain("the report")
    expect(out).toContain("Shipped 12 titles.")
  })
})
