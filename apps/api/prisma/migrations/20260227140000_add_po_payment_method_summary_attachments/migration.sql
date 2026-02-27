-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN "discount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "purchase_orders" ADD COLUMN "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "purchase_orders" ADD COLUMN "net_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "purchase_orders" ADD COLUMN "payment_method" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[];
