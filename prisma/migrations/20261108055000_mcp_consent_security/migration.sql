-- Retain the most recently updated consent if an older deployment created duplicates.
DELETE FROM "oauthConsent" AS older USING "oauthConsent" AS newer
WHERE older."clientId" = newer."clientId" AND older."userId" = newer."userId"
  AND (older."updatedAt", older."createdAt", older.id) < (newer."updatedAt", newer."createdAt", newer.id);

-- CreateTable
CREATE TABLE "rateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rateLimit_key_key" ON "rateLimit"("key");

-- CreateIndex
CREATE UNIQUE INDEX "oauthConsent_clientId_userId_key" ON "oauthConsent"("clientId", "userId");
