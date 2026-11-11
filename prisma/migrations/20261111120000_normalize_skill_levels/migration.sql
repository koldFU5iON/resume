-- Data-only: canonicalise Skill.level to the lowercase set the UI and readers
-- use ('beginner' | 'intermediate' | 'advanced' | 'expert'). CV import and notes
-- extraction previously wrote capitalised values ('Intermediate', 'Expert'),
-- which chat/context.ts's lowercase filter silently ignored.
UPDATE "Skill"
SET "level" = CASE
  WHEN lower(trim("level")) IN ('beginner', 'intermediate', 'advanced', 'expert') THEN lower(trim("level"))
  ELSE 'intermediate'
END
WHERE "level" IS DISTINCT FROM lower(trim("level"))
   OR lower(trim("level")) NOT IN ('beginner', 'intermediate', 'advanced', 'expert');
