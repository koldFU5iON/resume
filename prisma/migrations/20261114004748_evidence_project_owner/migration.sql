-- AlterTable
ALTER TABLE "RoleActivity" ADD COLUMN     "projectId" TEXT,
ALTER COLUMN "experienceId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "RoleActivity_projectId_idx" ON "RoleActivity"("projectId");

-- AddForeignKey
ALTER TABLE "RoleActivity" ADD CONSTRAINT "RoleActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one owner: a role or a project.
ALTER TABLE "RoleActivity" ADD CONSTRAINT "RoleActivity_exactly_one_owner_check"
  CHECK (("experienceId" IS NOT NULL) <> ("projectId" IS NOT NULL));

-- Copy legacy Project.highlights (JSON string arrays) into project-owned evidence.
-- Idempotent (skips projects that already own evidence) and malformed-safe
-- (a row whose highlights cannot be parsed is skipped, never aborts the migration).
-- Project.highlights is kept.
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT "id", "highlights" FROM "Project"
    WHERE "highlights" ~ '^\s*\['
      AND NOT EXISTS (SELECT 1 FROM "RoleActivity" ra WHERE ra."projectId" = "Project"."id")
  LOOP
    BEGIN
      INSERT INTO "RoleActivity" ("id", "projectId", "kind", "description", "impact", "order", "tags", "updatedAt")
      SELECT gen_random_uuid()::text, p."id", 'achievement', e.elem #>> '{}', NULL, (e.idx - 1)::int, '[]', CURRENT_TIMESTAMP
      FROM jsonb_array_elements(p."highlights"::jsonb) WITH ORDINALITY AS e(elem, idx)
      WHERE jsonb_typeof(e.elem) = 'string'
        AND (e.elem #>> '{}') !~ '^\s*$';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipping highlights copy for project %: %', p."id", SQLERRM;
    END;
  END LOOP;
END $$;
