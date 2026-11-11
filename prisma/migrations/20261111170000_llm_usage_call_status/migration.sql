-- AlterTable
ALTER TABLE "LlmUsageLog" ADD COLUMN     "errorKind" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ok';
