-- AlterTable
ALTER TABLE "accounting_periods" ADD COLUMN     "reopened_at" TIMESTAMP(3),
ADD COLUMN     "reopened_by_id" TEXT,
ADD COLUMN     "board_resolution_id" TEXT;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_reopened_by_id_fkey" FOREIGN KEY ("reopened_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
