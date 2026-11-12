import { NextRequest, NextResponse } from "next/server"
import { requireProfile } from "@/lib/session"
import { getPrimaryWritingDeskId } from "@/modules/writing-desk/documents"
import { writingDeskPdfResponse } from "../../_lib/pdf-response"

export const maxDuration = 30

/**
 * The job-scoped export URL, kept for old links (#370): exports the job's
 * primary document (the oldest, see writing-desk/documents.ts). Never creates
 * one. Documents export at /api/writing-desk/<jobId>/documents/<documentId>/pdf.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const [{ jobId }, { profile }] = await Promise.all([params, requireProfile()])
  const documentId = await getPrimaryWritingDeskId(profile.id, jobId)
  if (!documentId) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return writingDeskPdfResponse(profile.id, jobId, documentId)
}
