-- Evidence links become decisions: confirmed, AI-suggested or rejected.
-- Existing rows (none are written today) default to confirmed manual links.


-- AlterTable
ALTER TABLE "RoleActivitySkill" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'confirmed';

