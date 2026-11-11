-- AlterTable
ALTER TABLE "CVDocument" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedVia" TEXT;

-- CreateIndex
CREATE INDEX "CVDocument_jobApplicationId_status_idx" ON "CVDocument"("jobApplicationId", "status");
