import { beforeAll, describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { renderToBuffer } from "@react-pdf/renderer"
import { definePDFJSModule, getDocumentProxy, renderPageAsImage } from "unpdf"
import pixelmatch from "pixelmatch"
import { PNG } from "pngjs"
import { WritingDeskPDFDocument } from "./writing-desk-pdf-document"

const FIXTURE = path.resolve("src/modules/writing-desk/__fixtures__/cv-regression.md")
const SNAPSHOTS = path.resolve("src/modules/writing-desk/__fixtures__/snapshots")

async function renderFixture() {
  const markdown = await readFile(FIXTURE, "utf8")
  const buffer = await renderToBuffer(
    <WritingDeskPDFDocument markdown={markdown} documentType="cv" title="cv-regression" />,
  )
  return getDocumentProxy(new Uint8Array(buffer))
}

describe("WritingDeskPDFDocument visual regression", () => {
  beforeAll(async () => {
    await definePDFJSModule(() => import("pdfjs-dist/legacy/build/pdf.mjs"))
  })

  it("matches the committed four-page CV snapshots", async () => {
    const pdf = await renderFixture()
    expect(pdf.numPages).toBe(4)

    for (let page = 1; page <= pdf.numPages; page++) {
      const image = await renderPageAsImage(pdf, page, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: 1,
      })
      const actual = PNG.sync.read(Buffer.from(image))
      const baseline = PNG.sync.read(await readFile(path.join(SNAPSHOTS, `cv-regression-${page}.png`)))

      expect(actual.width).toBe(baseline.width)
      expect(actual.height).toBe(baseline.height)

      const diff = pixelmatch(actual.data, baseline.data, null, actual.width, actual.height, {
        threshold: 0.1,
      })
      expect(diff / (actual.width * actual.height)).toBeLessThan(0.001)
    }
  }, 30_000)
})
