-- AlterTable: Add isMainWarehouse to branches
ALTER TABLE "branches" ADD COLUMN "is_main_warehouse" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum: TransferStatus
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum: ReceivingItemStatus
CREATE TYPE "ReceivingItemStatus" AS ENUM ('PASS', 'REJECT');

-- AlterEnum: Add PENDING to POStatus
ALTER TYPE "POStatus" ADD VALUE 'PENDING';

-- AlterTable: Add status, confirmed_by_id, confirmed_at to stock_transfers
ALTER TABLE "stock_transfers" ADD COLUMN "status" "TransferStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "stock_transfers" ADD COLUMN "confirmed_by_id" TEXT;
ALTER TABLE "stock_transfers" ADD COLUMN "confirmed_at" TIMESTAMP(3);

-- AddForeignKey for stock_transfers.product_id (was missing)
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey for stock_transfers.confirmed_by_id
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "stock_transfers_product_id_idx" ON "stock_transfers"("product_id");
CREATE INDEX "stock_transfers_status_idx" ON "stock_transfers"("status");

-- CreateTable: goods_receivings
CREATE TABLE "goods_receivings" (
    "id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "received_by_id" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receivings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goods_receivings_po_id_idx" ON "goods_receivings"("po_id");

-- AddForeignKey
ALTER TABLE "goods_receivings" ADD CONSTRAINT "goods_receivings_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receivings" ADD CONSTRAINT "goods_receivings_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: goods_receiving_items
CREATE TABLE "goods_receiving_items" (
    "id" TEXT NOT NULL,
    "receiving_id" TEXT NOT NULL,
    "po_item_id" TEXT NOT NULL,
    "imei_serial" TEXT,
    "serial_number" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ReceivingItemStatus" NOT NULL,
    "reject_reason" TEXT,
    "product_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receiving_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goods_receiving_items_product_id_key" ON "goods_receiving_items"("product_id");
CREATE INDEX "goods_receiving_items_receiving_id_idx" ON "goods_receiving_items"("receiving_id");
CREATE INDEX "goods_receiving_items_po_item_id_idx" ON "goods_receiving_items"("po_item_id");

-- AddForeignKey
ALTER TABLE "goods_receiving_items" ADD CONSTRAINT "goods_receiving_items_receiving_id_fkey" FOREIGN KEY ("receiving_id") REFERENCES "goods_receivings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receiving_items" ADD CONSTRAINT "goods_receiving_items_po_item_id_fkey" FOREIGN KEY ("po_item_id") REFERENCES "po_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receiving_items" ADD CONSTRAINT "goods_receiving_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
