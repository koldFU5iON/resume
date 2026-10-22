import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import React from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import { definePDFJSModule, getDocumentProxy, renderPageAsImage } from "unpdf"
import { WritingDeskPDFDocument } from "../src/app/components/writing-desk-pdf-document"

async function main() {
  await definePDFJSModule(() => import("pdfjs-dist/legacy/build/pdf.mjs"))

  const fixture = path.resolve("src/modules/writing-desk/__fixtures__/cv-regression.md")
  const snapshots = path.resolve("src/modules/writing-desk/__fixtures__/snapshots")
  const markdown = await readFile(fixture, "utf8")
  const buffer = await renderToBuffer(
    <WritingDeskPDFDocument markdown={markdown} documentType="cv" title="cv-regression" />,
  )
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  await mkdir(snapshots, { recursive: true })

  for (let page = 1; page <= pdf.numPages; page++) {
    const image = await renderPageAsImage(pdf, page, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale: 1,
    })
    await writeFile(path.join(snapshots, `cv-regression-${page}.png`), new Uint8Array(image))
  }

  console.log(`Wrote ${pdf.numPages} CV regression page(s) to ${path.relative(process.cwd(), snapshots)}`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
