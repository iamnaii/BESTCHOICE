-- AlterTable: Add due_date column to purchase_orders
ALTER TABLE "purchase_orders" ADD COLUMN "due_date" TIMESTAMP(3);
