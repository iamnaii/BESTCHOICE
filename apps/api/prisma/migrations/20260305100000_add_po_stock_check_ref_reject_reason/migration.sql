-- AlterTable: Add missing columns to purchase_orders
ALTER TABLE "purchase_orders" ADD COLUMN "stock_check_ref" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "reject_reason" TEXT;
