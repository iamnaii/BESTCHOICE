-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED');

-- DropForeignKey
ALTER TABLE "branch_receiving_items" DROP CONSTRAINT "branch_receiving_items_receiving_id_fkey";

-- DropForeignKey
ALTER TABLE "call_logs" DROP CONSTRAINT "call_logs_contract_id_fkey";

-- DropForeignKey
ALTER TABLE "contract_documents" DROP CONSTRAINT "contract_documents_contract_id_fkey";

-- DropForeignKey
ALTER TABLE "e_documents" DROP CONSTRAINT "e_documents_contract_id_fkey";

-- DropForeignKey
ALTER TABLE "goods_receiving_items" DROP CONSTRAINT "goods_receiving_items_receiving_id_fkey";

-- DropForeignKey
ALTER TABLE "goods_receivings" DROP CONSTRAINT "goods_receivings_po_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_contract_id_fkey";

-- DropForeignKey
ALTER TABLE "po_items" DROP CONSTRAINT "po_items_po_id_fkey";

-- DropForeignKey
ALTER TABLE "product_photos" DROP CONSTRAINT "product_photos_product_id_fkey";

-- DropForeignKey
ALTER TABLE "product_prices" DROP CONSTRAINT "product_prices_product_id_fkey";

-- DropForeignKey
ALTER TABLE "signatures" DROP CONSTRAINT "signatures_contract_id_fkey";

-- AlterTable
ALTER TABLE "po_items" ALTER COLUMN "brand" DROP NOT NULL,
ALTER COLUMN "model" DROP NOT NULL;

-- AlterTable
ALTER TABLE "receipts" DROP COLUMN "receipt_type",
ADD COLUMN     "receiptType" TEXT NOT NULL DEFAULT 'PAYMENT';

-- CreateTable
CREATE TABLE "payment_links" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_token_key" ON "payment_links"("token");

-- CreateIndex
CREATE INDEX "payment_links_token_idx" ON "payment_links"("token");

-- CreateIndex
CREATE INDEX "payment_links_contract_id_idx" ON "payment_links"("contract_id");

-- CreateIndex
CREATE INDEX "payment_links_status_idx" ON "payment_links"("status");

-- CreateIndex
CREATE INDEX "contracts_parent_contract_id_idx" ON "contracts"("parent_contract_id");

-- CreateIndex
CREATE INDEX "notification_logs_status_channel_idx" ON "notification_logs"("status", "channel");

-- CreateIndex
CREATE INDEX "payments_recorded_by_id_idx" ON "payments"("recorded_by_id");

-- CreateIndex
CREATE INDEX "products_branch_id_status_idx" ON "products"("branch_id", "status");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_items" ADD CONSTRAINT "po_items_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receivings" ADD CONSTRAINT "goods_receivings_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receiving_items" ADD CONSTRAINT "goods_receiving_items_receiving_id_fkey" FOREIGN KEY ("receiving_id") REFERENCES "goods_receivings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e_documents" ADD CONSTRAINT "e_documents_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_receiving_items" ADD CONSTRAINT "branch_receiving_items_receiving_id_fkey" FOREIGN KEY ("receiving_id") REFERENCES "branch_receivings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "contract_documents_contract_type_latest_idx" RENAME TO "contract_documents_contract_id_document_type_is_latest_idx";

