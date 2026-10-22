import { z } from "zod"

export const WritingDeskDocumentTypeSchema = z.enum([
  "cv",
  "cover-letter",
  "interview-prep",
  "other",
])

export type WritingDeskDocumentType = z.infer<typeof WritingDeskDocumentTypeSchema>

export const WritingDeskSourceTypeSchema = z.enum(["blank", "previous-cv", "master-cv"])
export type WritingDeskSourceType = z.infer<typeof WritingDeskSourceTypeSchema>

export const MAX_WRITING_DESK_CONTENT_LENGTH = 500_000

export const WritingDeskContentSchema = z.string().max(MAX_WRITING_DESK_CONTENT_LENGTH)

export type WritingDeskSaveResult =
  | { ok: true; revision: number }
  | { ok: false; reason: "conflict"; revision: number; content: string }
