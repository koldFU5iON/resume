import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { DEFAULT_WRITING_DESK_DOCUMENT_NAME, WRITING_DESK_DOCUMENT_TYPE_LABEL } from "./schema"

// The named-documents migration (#370) must keep every existing desk intact.
// A real-database before/after check is described in the PR; this guards the
// SQL's shape so an edit can't quietly make it lossy.
const sql = readFileSync(
  join(process.cwd(), "prisma/migrations/20261112172709_writing_desk_named_documents/migration.sql"),
  "utf8",
)
const statements = sql
  .split("\n")
  .filter(line => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map(s => s.replace(/\s+/g, " ").trim())
  .filter(Boolean)

describe("writing_desk_named_documents migration", () => {
  it("never deletes, inserts or drops data", () => {
    for (const statement of statements) {
      expect(statement).not.toMatch(/\b(DELETE|INSERT|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i)
    }
  })

  it("updates nothing but the new name column, and only where it is unset", () => {
    const updates = statements.filter(s => /^UPDATE/i.test(s))
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatch(/^UPDATE "WritingDeskDocument" SET "name" = CASE "documentType" .* END WHERE "name" IS NULL$/)
  })

  it("adds the column nullable, backfills it, then makes it required", () => {
    const add = statements.findIndex(s => s === 'ALTER TABLE "WritingDeskDocument" ADD COLUMN "name" TEXT')
    const fill = statements.findIndex(s => /^UPDATE/i.test(s))
    const required = statements.findIndex(s => s === 'ALTER TABLE "WritingDeskDocument" ALTER COLUMN "name" SET NOT NULL')
    expect(add).toBeGreaterThanOrEqual(0)
    expect(fill).toBeGreaterThan(add)
    expect(required).toBeGreaterThan(fill)
  })

  it("names desks with the app's type labels, and the default name otherwise", () => {
    const update = statements.find(s => /^UPDATE/i.test(s))!
    for (const type of ["cv", "cover-letter", "interview-prep"] as const) {
      expect(update).toContain(`WHEN '${type}' THEN '${WRITING_DESK_DOCUMENT_TYPE_LABEL[type]}'`)
    }
    expect(update).toContain(`ELSE '${DEFAULT_WRITING_DESK_DOCUMENT_NAME}'`)
  })

  it("indexes the job lookup before dropping the one-desk-per-job unique index", () => {
    const create = statements.findIndex(s =>
      s === 'CREATE INDEX "WritingDeskDocument_jobApplicationId_createdAt_idx" ON "WritingDeskDocument"("jobApplicationId", "createdAt")')
    const drop = statements.findIndex(s => s === 'DROP INDEX "WritingDeskDocument_jobApplicationId_key"')
    expect(create).toBeGreaterThanOrEqual(0)
    expect(drop).toBeGreaterThan(create)
  })
})
