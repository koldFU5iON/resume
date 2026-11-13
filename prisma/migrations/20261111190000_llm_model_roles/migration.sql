-- AlterTable
ALTER TABLE "LlmUsageLog" ADD COLUMN     "role" TEXT;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "llmModelRoles" JSONB;
