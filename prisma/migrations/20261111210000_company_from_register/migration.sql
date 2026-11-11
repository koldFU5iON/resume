-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "fromRegister" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Company_fromRegister_idx" ON "Company"("fromRegister");
