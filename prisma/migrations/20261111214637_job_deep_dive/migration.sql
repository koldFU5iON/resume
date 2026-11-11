-- CreateTable
CREATE TABLE "CompanyResearch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyResearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDeepDive" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "jobApplicationId" TEXT NOT NULL,
    "sourceAssessmentId" TEXT,
    "status" TEXT NOT NULL,
    "failureKind" TEXT,
    "failureMessage" TEXT,
    "inputsHash" TEXT,
    "researchModel" TEXT,
    "synthesisModel" TEXT,
    "research" JSONB,
    "report" JSONB,
    "verdict" TEXT,
    "worthTailoredCv" BOOLEAN,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "stageTimings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobDeepDive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyResearch_companyId_topic_createdAt_idx" ON "CompanyResearch"("companyId", "topic", "createdAt");

-- CreateIndex
CREATE INDEX "JobDeepDive_jobApplicationId_createdAt_idx" ON "JobDeepDive"("jobApplicationId", "createdAt");

-- CreateIndex
CREATE INDEX "JobDeepDive_profileId_status_idx" ON "JobDeepDive"("profileId", "status");

-- CreateIndex
CREATE INDEX "JobDeepDive_sourceAssessmentId_idx" ON "JobDeepDive"("sourceAssessmentId");

-- AddForeignKey
ALTER TABLE "CompanyResearch" ADD CONSTRAINT "CompanyResearch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDeepDive" ADD CONSTRAINT "JobDeepDive_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDeepDive" ADD CONSTRAINT "JobDeepDive_jobApplicationId_fkey" FOREIGN KEY ("jobApplicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDeepDive" ADD CONSTRAINT "JobDeepDive_sourceAssessmentId_fkey" FOREIGN KEY ("sourceAssessmentId") REFERENCES "JobAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
