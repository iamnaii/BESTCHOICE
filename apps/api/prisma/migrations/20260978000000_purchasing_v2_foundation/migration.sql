-- AlterEnum: add ORDERED to POStatus
ALTER TYPE "POStatus" ADD VALUE 'ORDERED';

-- CreateEnum: DefectReason
CREATE TYPE "DefectReason" AS ENUM ('SCREEN', 'BATTERY', 'IMEI_BLOCKED', 'BOX_MISSING', 'WRONG_MODEL', 'DOA', 'COSMETIC', 'OTHER');

-- AlterTable: PurchaseOrder additive columns
ALTER TABLE "purchase_orders" ADD COLUMN "ordered_at" TIMESTAMP(3);
ALTER TABLE "purchase_orders" ADD COLUMN "is_direct_receive" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: GoodsReceivingItem.defect_reason
ALTER TABLE "goods_receiving_items" ADD COLUMN "defect_reason" "DefectReason";

-- AlterTable: GoodsReceiving.gr_number — 2-step (add nullable, backfill, then NOT NULL + UNIQUE)
ALTER TABLE "goods_receivings" ADD COLUMN "gr_number" TEXT;

WITH seq AS (
  SELECT id,
         'GR-' || to_char("created_at", 'YYYY-MM') || '-' ||
         lpad(
           (row_number() OVER (PARTITION BY to_char("created_at", 'YYYY-MM')
                               ORDER BY "created_at", id))::text,
           3, '0'
         ) AS gr
  FROM "goods_receivings"
)
UPDATE "goods_receivings" g SET "gr_number" = seq.gr FROM seq WHERE g.id = seq.id;

ALTER TABLE "goods_receivings" ALTER COLUMN "gr_number" SET NOT NULL;
CREATE UNIQUE INDEX "goods_receivings_gr_number_key" ON "goods_receivings"("gr_number");
