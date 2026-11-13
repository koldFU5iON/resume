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
  .max(MAX_WRITING_DESK_DOCUMENT_NAME_LENGTH, `Keep the name to ${MAX_WRITING_DESK_DOCUMENT_NAME_LENGTH} characters or fewer`)
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

export const RenameWritingDeskDocumentSchema = z.object({
  documentId: WritingDeskIdSchema,
  name: WritingDeskDocumentNameSchema,
})

export const DeleteWritingDeskDocumentSchema = z.object({
  jobId: WritingDeskIdSchema,
  documentId: WritingDeskIdSchema,
})

export type DeleteWritingDeskDocumentResult =
  /** nextDocumentId: the document to open instead (the next one, else the previous), or null when none remain. */
  | { ok: true; nextDocumentId: string | null }
  | { ok: false; reason: "invalid" | "not_found"; message: string }

export type RenameWritingDeskDocumentResult =
  | { ok: true; name: string }
  | { ok: false; reason: "invalid" | "not_found"; message: string }

/**
 * The name the "+" dialog suggests for a new document of this type: the
 * type's label ("CV"), numbered when the job already has one by that name
 * ("CV 2", "CV 3", ...). Compared case-insensitively, ignoring surrounding
 * space. The user can change it before creating, and rename it later.
 */
export function suggestWritingDeskDocumentName(
  documentType: WritingDeskDocumentType,
  existingNames: readonly string[],
): string {
  const base = documentType === "other" ? "Notes" : WRITING_DESK_DOCUMENT_TYPE_LABEL[documentType]
  const taken = new Set(existingNames.map(name => name.trim().toLocaleLowerCase()))
  if (!taken.has(base.toLocaleLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate
  }
}

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
