-- AlterTable
ALTER TABLE "CvGeneration" ADD COLUMN     "review" JSONB,
ADD COLUMN     "selectionReusedFromRunId" TEXT;
