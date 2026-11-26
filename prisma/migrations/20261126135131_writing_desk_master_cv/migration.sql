-- AlterTable
ALTER TABLE "WritingDeskDocument" ADD COLUMN     "masterOfProfileId" TEXT,
ALTER COLUMN "jobApplicationId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "WritingDeskDocument_masterOfProfileId_key" ON "WritingDeskDocument"("masterOfProfileId");

