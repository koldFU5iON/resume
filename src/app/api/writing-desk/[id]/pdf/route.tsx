import { renderToBuffer } from "@react-pdf/renderer"
import { NextRequest, NextResponse } from "next/server"
import { WritingDeskPDFDocument } from "@/app/components/writing-desk-pdf-document"
import { requireProfile } from "@/lib/session"
import { getWritingDesk } from "@/modules/writing-desk/queries"

export const maxDuration = 30

function filename(title: string): string {
  const slug = title.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return `${slug || "writing-desk-document"}.pdf`
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ id }, { profile }] = await Promise.all([params, requireProfile()])
  const desk = await getWritingDesk(profile.id, id)
  if (!desk) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const title = `${desk.documentType ?? "writing-desk"}-${desk.jobApplication.title}`
  const buffer = await renderToBuffer(<WritingDeskPDFDocument markdown={desk.content} title={title} />)

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename(title)}"`,
    },
  })
}
