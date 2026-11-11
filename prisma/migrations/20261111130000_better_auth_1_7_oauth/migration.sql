-- Better Auth / OAuth Provider 1.6.11 -> 1.7.20.
-- Additive only: new columns and tables 1.7 reads and writes. The 1.6
-- "public" and "type" client columns stay (1.7 ignores them) so a rollback
-- to 1.6 still works; drop them in a later cleanup.


-- AlterTable
ALTER TABLE "jwks" ADD COLUMN     "alg" TEXT,
ADD COLUMN     "crv" TEXT;

-- AlterTable
ALTER TABLE "oauthClient" ADD COLUMN     "applicationType" TEXT,
ADD COLUMN     "backchannelLogoutSessionRequired" BOOLEAN,
ADD COLUMN     "backchannelLogoutUri" TEXT,
ADD COLUMN     "clientCredentialsScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "clientDiscoveryId" TEXT,
ADD COLUMN     "dpopBoundAccessTokens" BOOLEAN DEFAULT false,
ADD COLUMN     "jwks" TEXT,
ADD COLUMN     "jwksUri" TEXT;

-- AlterTable
ALTER TABLE "oauthRefreshToken" ADD COLUMN     "authorizationCodeId" TEXT,
ADD COLUMN     "confirmation" JSONB,
ADD COLUMN     "requestedUserInfoClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rotatedAt" TIMESTAMP(3),
ADD COLUMN     "rotationReplayExpiresAt" TIMESTAMP(3),
ADD COLUMN     "rotationReplayResponse" TEXT;

-- AlterTable
ALTER TABLE "oauthAccessToken" ADD COLUMN     "authorizationCodeId" TEXT,
ADD COLUMN     "confirmation" JSONB,
ADD COLUMN     "requestedUserInfoClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "revoked" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "oauthConsent" ADD COLUMN     "requestedUserInfoClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resources" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "oauthResource" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessTokenTtl" INTEGER,
    "refreshTokenTtl" INTEGER,
    "signingAlgorithm" TEXT,
    "signingKeyId" TEXT,
    "allowedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customClaims" JSONB,
    "dpopBoundAccessTokensRequired" BOOLEAN DEFAULT false,
    "disabled" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "policyVersion" INTEGER DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "oauthResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauthClientResource" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "oauthClientResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauthClientAssertion" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauthClientAssertion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauthResource_identifier_key" ON "oauthResource"("identifier");

-- CreateIndex
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauthClientResource"("clientId");

-- CreateIndex
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauthClientResource"("resourceId");

-- CreateIndex
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken"("authorizationCodeId");

-- CreateIndex
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken"("authorizationCodeId");

-- AddForeignKey
ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "oauthResource"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;


-- 1.7 replaces the client "type" with "applicationType" (web | native) and
-- validates redirect URIs by it. Carry existing values over; anything else
-- (null or "user-agent-based") stays null, which 1.7 treats as "web".
UPDATE "oauthClient" SET "applicationType" = "type" WHERE "type" IN ('web', 'native');
