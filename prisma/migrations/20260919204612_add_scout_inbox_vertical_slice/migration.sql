-- CreateEnum
CREATE TYPE "ScoutTriageStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "ScoutVerdict" AS ENUM ('PRIORITY', 'REVIEW', 'PASS');

-- CreateEnum
CREATE TYPE "DiscoveredJobSource" AS ENUM ('COMPANY', 'BOARD', 'SCOUT');

-- AlterTable
ALTER TABLE "DiscoveredJob" ADD COLUMN     "scoutFeedback" TEXT,
ADD COLUMN     "scoutInviteId" TEXT,
ADD COLUMN     "scoutNote" TEXT,
ADD COLUMN     "scoutVerdict" "ScoutVerdict",
ADD COLUMN     "source" "DiscoveredJobSource" NOT NULL DEFAULT 'BOARD',
ADD COLUMN     "triageStatus" "ScoutTriageStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "triagedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ScoutInvite" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashedToken" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ScoutInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScoutInvite_hashedToken_key" ON "ScoutInvite"("hashedToken");

-- CreateIndex
CREATE INDEX "ScoutInvite_profileId_idx" ON "ScoutInvite"("profileId");

-- CreateIndex
CREATE INDEX "DiscoveredJob_profileId_source_idx" ON "DiscoveredJob"("profileId", "source");

-- CreateIndex
CREATE INDEX "DiscoveredJob_profileId_triageStatus_idx" ON "DiscoveredJob"("profileId", "triageStatus");

-- CreateIndex
CREATE INDEX "DiscoveredJob_scoutInviteId_idx" ON "DiscoveredJob"("scoutInviteId");

-- AddForeignKey
ALTER TABLE "ScoutInvite" ADD CONSTRAINT "ScoutInvite_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredJob" ADD CONSTRAINT "DiscoveredJob_scoutInviteId_fkey" FOREIGN KEY ("scoutInviteId") REFERENCES "ScoutInvite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
