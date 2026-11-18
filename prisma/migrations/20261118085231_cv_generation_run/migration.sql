-- AlterTable
ALTER TABLE "LlmUsageLog" ADD COLUMN     "writingDeskDocumentId" TEXT;

-- CreateTable
CREATE TABLE "CvGeneration" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "jobApplicationId" TEXT NOT NULL,
    "writingDeskDocumentId" TEXT,
    "deepDiveId" TEXT,
    "status" TEXT NOT NULL,
    "failureKind" TEXT,
    "failureMessage" TEXT,
    "inputsHash" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "stageTimings" JSONB,
    "log" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CvGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CvGeneration_profileId_jobApplicationId_createdAt_idx" ON "CvGeneration"("profileId", "jobApplicationId", "createdAt");

-- CreateIndex
CREATE INDEX "CvGeneration_profileId_status_idx" ON "CvGeneration"("profileId", "status");

-- CreateIndex
CREATE INDEX "CvGeneration_writingDeskDocumentId_idx" ON "CvGeneration"("writingDeskDocumentId");

-- CreateIndex
CREATE INDEX "CvGeneration_deepDiveId_idx" ON "CvGeneration"("deepDiveId");

-- CreateIndex
CREATE INDEX "LlmUsageLog_writingDeskDocumentId_idx" ON "LlmUsageLog"("writingDeskDocumentId");

-- AddForeignKey
ALTER TABLE "CvGeneration" ADD CONSTRAINT "CvGeneration_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CvGeneration" ADD CONSTRAINT "CvGeneration_jobApplicationId_fkey" FOREIGN KEY ("jobApplicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CvGeneration" ADD CONSTRAINT "CvGeneration_writingDeskDocumentId_fkey" FOREIGN KEY ("writingDeskDocumentId") REFERENCES "WritingDeskDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CvGeneration" ADD CONSTRAINT "CvGeneration_deepDiveId_fkey" FOREIGN KEY ("deepDiveId") REFERENCES "JobDeepDive"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmUsageLog" ADD CONSTRAINT "LlmUsageLog_writingDeskDocumentId_fkey" FOREIGN KEY ("writingDeskDocumentId") REFERENCES "WritingDeskDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
