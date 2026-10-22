-- CreateTable
CREATE TABLE "WritingDeskDocument" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "jobApplicationId" TEXT NOT NULL,
    "documentType" TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "sourceType" TEXT,
    "sourceCvDocumentId" TEXT,
    "sourceLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WritingDeskDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WritingDeskDocument_jobApplicationId_key" ON "WritingDeskDocument"("jobApplicationId");

-- CreateIndex
CREATE INDEX "WritingDeskDocument_profileId_idx" ON "WritingDeskDocument"("profileId");

-- CreateIndex
CREATE INDEX "WritingDeskDocument_sourceCvDocumentId_idx" ON "WritingDeskDocument"("sourceCvDocumentId");

-- AddForeignKey
ALTER TABLE "WritingDeskDocument" ADD CONSTRAINT "WritingDeskDocument_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingDeskDocument" ADD CONSTRAINT "WritingDeskDocument_jobApplicationId_fkey" FOREIGN KEY ("jobApplicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingDeskDocument" ADD CONSTRAINT "WritingDeskDocument_sourceCvDocumentId_fkey" FOREIGN KEY ("sourceCvDocumentId") REFERENCES "CVDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
