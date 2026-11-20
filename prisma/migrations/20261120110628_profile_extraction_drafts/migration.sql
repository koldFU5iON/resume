-- CreateTable
CREATE TABLE "ProfileExtractionDraft" (
    "id" TEXT NOT NULL,
    "experienceId" TEXT,
    "projectId" TEXT,
    "sourceVersion" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,

    CONSTRAINT "ProfileExtractionDraft_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProfileExtractionDraft_one_source" CHECK (num_nonnulls("experienceId", "projectId") = 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfileExtractionDraft_experienceId_key" ON "ProfileExtractionDraft"("experienceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileExtractionDraft_projectId_key" ON "ProfileExtractionDraft"("projectId");

-- AddForeignKey
ALTER TABLE "ProfileExtractionDraft" ADD CONSTRAINT "ProfileExtractionDraft_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileExtractionDraft" ADD CONSTRAINT "ProfileExtractionDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
