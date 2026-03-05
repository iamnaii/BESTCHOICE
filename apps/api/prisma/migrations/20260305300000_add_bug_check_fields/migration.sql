-- AlterTable: Add bug check fields to products
ALTER TABLE "products" ADD COLUMN "has_bugs" BOOLEAN;
ALTER TABLE "products" ADD COLUMN "bug_details" TEXT;

-- AlterTable: Add bug check fields to goods_receiving_items
ALTER TABLE "goods_receiving_items" ADD COLUMN "has_bugs" BOOLEAN;
ALTER TABLE "goods_receiving_items" ADD COLUMN "bug_details" TEXT;
