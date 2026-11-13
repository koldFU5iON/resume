-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN     "companyId" TEXT;

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "aliases" TEXT[],
    "domain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorLicence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "townCity" TEXT NOT NULL DEFAULT '',
    "county" TEXT,
    "typeRating" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SponsorLicence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsorRegisterImport" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'GB',
    "sourceUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rows" INTEGER,
    "added" INTEGER,
    "removed" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SponsorRegisterImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_normalizedName_key" ON "Company"("normalizedName");

-- CreateIndex
CREATE INDEX "Company_aliases_idx" ON "Company" USING GIN ("aliases");

-- CreateIndex
CREATE INDEX "SponsorLicence_companyId_idx" ON "SponsorLicence"("companyId");

-- CreateIndex
CREATE INDEX "SponsorLicence_lastSeenAt_idx" ON "SponsorLicence"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SponsorLicence_country_orgName_townCity_route_key" ON "SponsorLicence"("country", "orgName", "townCity", "route");

-- CreateIndex
CREATE INDEX "SponsorRegisterImport_country_status_startedAt_idx" ON "SponsorRegisterImport"("country", "status", "startedAt");

-- CreateIndex
CREATE INDEX "JobApplication_companyId_idx" ON "JobApplication"("companyId");

-- AddForeignKey
ALTER TABLE "SponsorLicence" ADD CONSTRAINT "SponsorLicence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
