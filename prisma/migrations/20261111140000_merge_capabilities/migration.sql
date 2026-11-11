-- One capability table: tools and competencies move into "Skill" with a kind,
-- so evidence, projects and certifications can link to any capability
-- (the link tables all reference Skill). Rows keep their ids. The "Tool" and
-- "Competency" tables are left in place, unused, for a later cleanup.

-- AlterTable
ALTER TABLE "Skill" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'skill',
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "origin" TEXT,
ALTER COLUMN "category" DROP NOT NULL,
ALTER COLUMN "level" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Skill_profileId_kind_idx" ON "Skill"("profileId", "kind");

-- Copy tools and competencies. ON CONFLICT keeps a re-run harmless.
INSERT INTO "Skill" ("id", "profileId", "name", "kind", "category", "level", "order", "tags", "createdAt", "updatedAt")
SELECT "id", "profileId", "name", 'tool', "category", NULL, "order", '[]', "createdAt", "updatedAt"
FROM "Tool"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Skill" ("id", "profileId", "name", "kind", "category", "level", "order", "origin", "tags", "createdAt", "updatedAt")
SELECT "id", "profileId", "name", 'competency', NULL, NULL, "order", "origin", '[]', "createdAt", "updatedAt"
FROM "Competency"
ON CONFLICT ("id") DO NOTHING;
