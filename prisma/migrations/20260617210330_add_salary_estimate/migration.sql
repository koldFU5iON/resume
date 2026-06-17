-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN     "salaryEstimate" JSONB,
ADD COLUMN     "salaryEstimatedAt" TIMESTAMP(3);
