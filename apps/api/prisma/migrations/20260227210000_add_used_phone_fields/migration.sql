-- AlterTable: Add used phone fields to products
ALTER TABLE "products" ADD COLUMN "battery_health" INTEGER;
ALTER TABLE "products" ADD COLUMN "warranty_expired" BOOLEAN;
ALTER TABLE "products" ADD COLUMN "warranty_expire_date" TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN "has_box" BOOLEAN;

-- AlterTable: Add used phone fields to goods_receiving_items
ALTER TABLE "goods_receiving_items" ADD COLUMN "battery_health" INTEGER;
ALTER TABLE "goods_receiving_items" ADD COLUMN "warranty_expired" BOOLEAN;
ALTER TABLE "goods_receiving_items" ADD COLUMN "warranty_expire_date" TIMESTAMP(3);
ALTER TABLE "goods_receiving_items" ADD COLUMN "has_box" BOOLEAN;
