BEGIN;

-- Hold the ownership graph stable from validation through the constraint changes.
LOCK TABLE "Experience", "Project", "RoleActivity" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Project" p
    LEFT JOIN "Experience" e ON e."id" = p."experienceId"
    WHERE p."experienceId" IS NOT NULL AND e."profileId" IS DISTINCT FROM p."profileId"
  ) THEN
    RAISE EXCEPTION 'Cannot backfill profile roles: a project names a missing or foreign experience';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "RoleActivity" a
    LEFT JOIN "Project" p ON p."id" = a."projectId"
    LEFT JOIN "Experience" e ON e."id" = a."experienceId"
    WHERE (a."projectId" IS NOT NULL AND p."id" IS NULL)
      OR (a."experienceId" IS NOT NULL AND e."id" IS NULL)
      OR (a."experienceId" IS NULL AND p."id" IS NULL)
      OR (e."id" IS NOT NULL AND p."id" IS NOT NULL AND e."profileId" <> p."profileId")
  ) THEN
    RAISE EXCEPTION 'Cannot backfill profile roles: an activity has missing or cross-profile provenance';
  END IF;
END $$;

INSERT INTO "Experience" ("id", "profileId", "company", "role", "type", "startDate", "summary", "updatedAt")
SELECT gen_random_uuid()::text, p."profileId", 'Independent projects', 'Independent projects',
       'independent', TIMESTAMP '1970-01-01', '', CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "profileId" FROM "Project" WHERE "experienceId" IS NULL
) p
WHERE NOT EXISTS (
  SELECT 1 FROM "Experience" e WHERE e."profileId" = p."profileId" AND e."type" = 'independent'
);

WITH homes AS (
  SELECT DISTINCT ON ("profileId") "profileId", "id"
  FROM "Experience"
  WHERE "type" = 'independent'
  ORDER BY "profileId", "createdAt", "id"
)
UPDATE "Project" p
SET "experienceId" = homes."id"
FROM homes
WHERE p."experienceId" IS NULL AND p."profileId" = homes."profileId";

UPDATE "RoleActivity" a
SET "experienceId" = p."experienceId"
FROM "Project" p
WHERE a."experienceId" IS NULL AND a."projectId" = p."id";

-- NO ACTION blocks deleting a role with projects while allowing a whole-profile cascade.
ALTER TABLE "Project" DROP CONSTRAINT "Project_experienceId_fkey";
ALTER TABLE "Project" ALTER COLUMN "experienceId" SET NOT NULL;
ALTER TABLE "Project" ADD CONSTRAINT "Project_experienceId_fkey"
  FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "RoleActivity" ALTER COLUMN "experienceId" SET NOT NULL;
ALTER TABLE "RoleActivity" DROP CONSTRAINT "RoleActivity_at_least_one_owner_check";

COMMIT;
