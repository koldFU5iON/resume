-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "coverLetterPreferences" JSONB;

-- CreateTable
CREATE TABLE "CoverLetterGeneration" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "jobApplicationId" TEXT NOT NULL,
    "writingDeskDocumentId" TEXT,
    "deepDiveId" TEXT,
    "status" TEXT NOT NULL,
    "failureKind" TEXT,
    "failureMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "angles" JSONB,
    "choice" JSONB,
    "letter" JSONB,
    "review" JSONB,
    "log" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverLetterGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoverLetterGeneration_profileId_jobApplicationId_createdAt_idx" ON "CoverLetterGeneration"("profileId", "jobApplicationId", "createdAt");

-- CreateIndex
CREATE INDEX "CoverLetterGeneration_profileId_status_idx" ON "CoverLetterGeneration"("profileId", "status");

-- CreateIndex
CREATE INDEX "CoverLetterGeneration_writingDeskDocumentId_idx" ON "CoverLetterGeneration"("writingDeskDocumentId");

-- CreateIndex
CREATE INDEX "CoverLetterGeneration_deepDiveId_idx" ON "CoverLetterGeneration"("deepDiveId");

-- AddForeignKey
ALTER TABLE "CoverLetterGeneration" ADD CONSTRAINT "CoverLetterGeneration_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverLetterGeneration" ADD CONSTRAINT "CoverLetterGeneration_jobApplicationId_fkey" FOREIGN KEY ("jobApplicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverLetterGeneration" ADD CONSTRAINT "CoverLetterGeneration_writingDeskDocumentId_fkey" FOREIGN KEY ("writingDeskDocumentId") REFERENCES "WritingDeskDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverLetterGeneration" ADD CONSTRAINT "CoverLetterGeneration_deepDiveId_fkey" FOREIGN KEY ("deepDiveId") REFERENCES "JobDeepDive"("id") ON DELETE SET NULL ON UPDATE CASCADE;

