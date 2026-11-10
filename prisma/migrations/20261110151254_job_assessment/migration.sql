-- CreateTable
CREATE TABLE "JobAssessment" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "jobApplicationId" TEXT NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failureKind" TEXT,
    "failureReasons" TEXT[],
    "enrichedFields" TEXT[],
    "factsHash" TEXT,
    "facts" JSONB,
    "signals" JSONB,
    "request" JSONB,
    "jevModel" TEXT,
    "score" INTEGER,
    "level" TEXT,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockers" JSONB,
    "strengths" TEXT[],
    "gaps" TEXT[],
    "unsettled" TEXT[],
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "queueTimeMs" INTEGER,
    "processTimeMs" INTEGER,
    "stageTimings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobAssessment_jobApplicationId_createdAt_idx" ON "JobAssessment"("jobApplicationId", "createdAt");

-- CreateIndex
CREATE INDEX "JobAssessment_profileId_status_idx" ON "JobAssessment"("profileId", "status");

-- CreateIndex
CREATE INDEX "JobAssessment_profileId_createdAt_idx" ON "JobAssessment"("profileId", "createdAt");

-- AddForeignKey
ALTER TABLE "JobAssessment" ADD CONSTRAINT "JobAssessment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAssessment" ADD CONSTRAINT "JobAssessment_jobApplicationId_fkey" FOREIGN KEY ("jobApplicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
