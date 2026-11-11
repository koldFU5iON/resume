-- AlterTable
ALTER TABLE "LlmUsageLog" ADD COLUMN     "cacheReadTokens" INTEGER,
ADD COLUMN     "cacheWriteTokens" INTEGER,
ADD COLUMN     "cvDocumentId" TEXT,
ADD COLUMN     "jobApplicationId" TEXT,
ADD COLUMN     "runId" TEXT,
ADD COLUMN     "serverToolCalls" INTEGER,
ADD COLUMN     "usageKnown" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "LlmUsageLog_jobApplicationId_idx" ON "LlmUsageLog"("jobApplicationId");

-- CreateIndex
CREATE INDEX "LlmUsageLog_cvDocumentId_idx" ON "LlmUsageLog"("cvDocumentId");

-- CreateIndex
CREATE INDEX "LlmUsageLog_runId_idx" ON "LlmUsageLog"("runId");

-- AddForeignKey
ALTER TABLE "LlmUsageLog" ADD CONSTRAINT "LlmUsageLog_jobApplicationId_fkey" FOREIGN KEY ("jobApplicationId") REFERENCES "JobApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmUsageLog" ADD CONSTRAINT "LlmUsageLog_cvDocumentId_fkey" FOREIGN KEY ("cvDocumentId") REFERENCES "CVDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
