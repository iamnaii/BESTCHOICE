-- AlterTable: Add accessory fields to po_items
ALTER TABLE "po_items" ADD COLUMN "accessory_type" TEXT;
ALTER TABLE "po_items" ADD COLUMN "accessory_brand" TEXT;

-- AlterTable: Add accessory fields to products
ALTER TABLE "products" ADD COLUMN "accessory_type" TEXT;
ALTER TABLE "products" ADD COLUMN "accessory_brand" TEXT;
