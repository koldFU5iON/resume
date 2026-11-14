-- Revision counters for profile notes (phase 1, PR 3): a save carries the
-- revision it was based on and is refused when the note has moved on, the
-- same check Writing Desk documents already use.
--
-- Additive and data-safe: existing rows get revision 1 from the default; no
-- row is rewritten beyond that and nothing is dropped.
ALTER TABLE "Experience" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Project" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
