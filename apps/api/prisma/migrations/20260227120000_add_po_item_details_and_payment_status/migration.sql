-- CreateEnum
CREATE TYPE "POPaymentStatus" AS ENUM ('UNPAID', 'DEPOSIT_PAID', 'PARTIALLY_PAID', 'FULLY_PAID');

-- AlterTable: Add color, storage, category to po_items
ALTER TABLE "po_items" ADD COLUMN "color" TEXT;
ALTER TABLE "po_items" ADD COLUMN "storage" TEXT;
ALTER TABLE "po_items" ADD COLUMN "category" TEXT;

-- AlterTable: Add payment fields to purchase_orders
ALTER TABLE "purchase_orders" ADD COLUMN "payment_status" "POPaymentStatus" NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "purchase_orders" ADD COLUMN "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "purchase_orders" ADD COLUMN "payment_notes" TEXT;
