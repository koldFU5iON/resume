import { requireProfile } from "@/lib/session"
import { masterCvPdfResponse } from "../../_lib/pdf-response"

export const maxDuration = 30

/** The signed-in profile's master CV (#469) as a PDF. */
export async function GET() {
  const { profile } = await requireProfile()
  return masterCvPdfResponse(profile.id)
}
