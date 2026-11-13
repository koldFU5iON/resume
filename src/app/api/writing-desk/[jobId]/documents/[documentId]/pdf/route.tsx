import type { NextRequest } from "next/server"
import { requireProfile } from "@/lib/session"
import { writingDeskPdfResponse } from "../../../../_lib/pdf-response"

export const maxDuration = 30

/** One Writing Desk document as a PDF, addressed by id. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string; documentId: string }> },
) {
  const [{ jobId, documentId }, { profile }] = await Promise.all([params, requireProfile()])
  return writingDeskPdfResponse(profile.id, jobId, documentId)
}
