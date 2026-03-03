-- AlterTable
ALTER TABLE "sales" ADD COLUMN "down_payment_amount" DECIMAL(12,2);
ALTER TABLE "sales" ADD COLUMN "bundle_product_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
