-- AlterTable
ALTER TABLE "CVDocument" ADD COLUMN     "careerVerticalId" TEXT;

-- CreateTable
CREATE TABLE "CareerVertical" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'none',
    "thesis" TEXT,
    "businessProblems" TEXT[],
    "responsibilities" TEXT[],
    "outcomes" TEXT[],
    "competencies" TEXT[],
    "sourceJobIds" TEXT[],
    "analysedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerVertical_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareerVertical_profileId_key" ON "CareerVertical"("profileId");

-- CreateIndex
CREATE INDEX "CareerVertical_profileId_idx" ON "CareerVertical"("profileId");

-- AddForeignKey
ALTER TABLE "CareerVertical" ADD CONSTRAINT "CareerVertical_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CVDocument" ADD CONSTRAINT "CVDocument_careerVerticalId_fkey" FOREIGN KEY ("careerVerticalId") REFERENCES "CareerVertical"("id") ON DELETE SET NULL ON UPDATE CASCADE;
