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

export const WRITING_DESK_DOCUMENT_TYPE_LABEL: Record<WritingDeskDocumentType, string> = {
  cv: "CV",
  "cover-letter": "Cover letter",
  "interview-prep": "Interview prep",
  other: "Other",
}

/** Name of a document created without one (and of migrated desks that had no type). */
export const DEFAULT_WRITING_DESK_DOCUMENT_NAME = "Untitled document"

export const MAX_WRITING_DESK_DOCUMENT_NAME_LENGTH = 80

/**
 * Hard cap per job, checked under the job's document lock. Kept equal to what
 * MCP get_job_context lists, so an agent can always see every document's id.
 */
export const MAX_WRITING_DESK_DOCUMENTS_PER_JOB = 10

export const WritingDeskDocumentNameSchema = z
  .string()
  .trim()
  .min(1, "Name the document")
  .max(MAX_WRITING_DESK_DOCUMENT_NAME_LENGTH, `Keep the name under ${MAX_WRITING_DESK_DOCUMENT_NAME_LENGTH} characters`)
  .refine(name => !/\p{Cc}/u.test(name), "The name can't contain control characters")

/** Record ids (cuids) as they arrive from the client or an agent. */
export const WritingDeskIdSchema = z.string().min(1).max(100)

export const CreateWritingDeskDocumentSchema = z.object({
  jobId: WritingDeskIdSchema,
  name: WritingDeskDocumentNameSchema,
  documentType: WritingDeskDocumentTypeSchema.nullable().default(null),
  /** A CV of the same profile to start from; null starts blank. */
  sourceCvId: WritingDeskIdSchema.nullable().default(null),
})

export type CreateWritingDeskDocumentInput = z.input<typeof CreateWritingDeskDocumentSchema>

export type CreateWritingDeskDocumentResult =
  | { ok: true; id: string }
  | { ok: false; reason: "invalid" | "job_not_found" | "source_not_found" | "limit"; message: string }

/** A job's document as navigation and pickers list it. */
export type WritingDeskDocumentSummary = {
  id: string
  name: string
  documentType: WritingDeskDocumentType | null
  hasDraft: boolean
  createdAt: Date
  updatedAt: Date
}

/** Oldest first: the first document is the job's primary one. Ties break on id so the order is total. */
export const WRITING_DESK_DOCUMENT_ORDER: Array<{ createdAt: "asc" } | { id: "asc" }> = [{ createdAt: "asc" }, { id: "asc" }]

export function parseWritingDeskDocumentType(value: string | null): WritingDeskDocumentType | null {
  const parsed = WritingDeskDocumentTypeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
