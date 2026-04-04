-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "referred_by_id" TEXT;

-- CreateIndex
CREATE INDEX "customers_referred_by_id_idx" ON "customers"("referred_by_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
