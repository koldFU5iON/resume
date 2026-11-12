-- Multiple named Writing Desk documents per job (#370).
--
-- Data-safe by construction: no row is inserted, deleted or rewritten except
-- to fill the new "name" column. Every existing desk keeps its id, content,
-- type, revisions, source link, pending draft and draft events, and becomes
-- its job's first (and so primary) document. Job-scoped links resolve to the
-- oldest document by ("createdAt", "id"), which for migrated jobs is the desk
-- they already had.
--
-- Order matters: the column is added nullable and backfilled before it is
-- made NOT NULL, and the replacement job index exists before the unique index
-- is dropped, so the jobApplicationId foreign key is never left unindexed.

-- 1. Name every existing desk after its document type (labels match
--    WRITING_DESK_DOCUMENT_TYPE_LABEL in src/modules/writing-desk/schema.ts).
ALTER TABLE "WritingDeskDocument" ADD COLUMN "name" TEXT;

UPDATE "WritingDeskDocument"
SET "name" = CASE "documentType"
  WHEN 'cv' THEN 'CV'
  WHEN 'cover-letter' THEN 'Cover letter'
  WHEN 'interview-prep' THEN 'Interview prep'
  ELSE 'Untitled document'
END
WHERE "name" IS NULL;

ALTER TABLE "WritingDeskDocument" ALTER COLUMN "name" SET NOT NULL;

-- A default keeps the previous deployment's inserts (which don't send a name)
-- working while this migration is live ahead of the new build, and after an
-- instant rollback. New code always passes a name.
ALTER TABLE "WritingDeskDocument" ALTER COLUMN "name" SET DEFAULT 'Untitled document';

-- 2. One job, many documents: index the job lookup (and the primary-document
--    order), then drop the one-desk-per-job unique constraint.
CREATE INDEX "WritingDeskDocument_jobApplicationId_createdAt_idx" ON "WritingDeskDocument"("jobApplicationId", "createdAt");

DROP INDEX "WritingDeskDocument_jobApplicationId_key";
