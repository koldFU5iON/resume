import { renderToBuffer } from "@react-pdf/renderer"
import { NextResponse } from "next/server"
import { WritingDeskPDFDocument } from "@/app/components/writing-desk-pdf-document"
import { getMasterCvDeskView, getWritingDeskDocument, type WritingDeskWithJob } from "@/modules/writing-desk/queries"

function filename(title: string): string {
  const slug = title.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return `${slug || "writing-desk-document"}.pdf`
}

/**
 * The document as a PDF download, or 404 when it isn't the profile's or
 * doesn't belong to the job. Named after the document and the job, so two
 * documents of one job export to different files.
 */
export async function writingDeskPdfResponse(profileId: string, jobId: string, documentId: string): Promise<NextResponse> {
  return pdfOf(await getWritingDeskDocument(profileId, jobId, documentId))
}

/** The master CV (#469) as a PDF download, or 404 when the profile has none. */
export async function masterCvPdfResponse(profileId: string): Promise<NextResponse> {
  return pdfOf(await getMasterCvDeskView(profileId))
}

async function pdfOf(desk: WritingDeskWithJob | null): Promise<NextResponse> {
  if (!desk) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const title = desk.jobApplication ? `${desk.name}-${desk.jobApplication.title}` : desk.name
  const buffer = await renderToBuffer(<WritingDeskPDFDocument markdown={desk.content} title={title} documentType={desk.documentType} />)

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename(title)}"`,
    },
  })
}
