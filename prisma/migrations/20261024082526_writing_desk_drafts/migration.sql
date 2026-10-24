-- AlterTable
ALTER TABLE "WritingDeskDocument" ADD COLUMN     "draftContent" TEXT,
ADD COLUMN     "draftRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "draftUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WritingDeskDraftEvent" (
    "id" TEXT NOT NULL,
    "writingDeskId" TEXT NOT NULL,
    "apiTokenId" TEXT,
    "tool" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WritingDeskDraftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WritingDeskDraftEvent_writingDeskId_createdAt_idx" ON "WritingDeskDraftEvent"("writingDeskId", "createdAt");

-- AddForeignKey
ALTER TABLE "WritingDeskDraftEvent" ADD CONSTRAINT "WritingDeskDraftEvent_writingDeskId_fkey" FOREIGN KEY ("writingDeskId") REFERENCES "WritingDeskDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
