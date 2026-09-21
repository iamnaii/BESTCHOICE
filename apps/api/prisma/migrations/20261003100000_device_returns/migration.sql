-- ใบรับเครื่องคืน (spec docs/superpowers/specs/2026-09-20-device-return-intake-design.md §4.1) — additive only, ไม่มี backfill
-- ลำดับ: หลัง 20261003000000_interco_device_return_type (Phase 1)

-- CreateEnum
CREATE TYPE "DeviceReturnKind" AS ENUM ('VOLUNTARY', 'REPOSSESSION');
CREATE TYPE "DeviceReturnStatus" AS ENUM ('PENDING_CONFIRM', 'CONFIRMED', 'REJECTED', 'CANCELED');

-- AlterEnum — ADD VALUE ถอยไม่ได้ (precedent 20260986000000); ไฟล์นี้ไม่ใช้ค่าใหม่ในคำสั่งถัดไป จึงรันใน tx ได้
ALTER TYPE "CustomerTagType" ADD VALUE 'RETURNED_DEVICE';

-- CreateTable
CREATE TABLE "device_returns" (
    "id" TEXT NOT NULL,
    "doc_number" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "receiving_branch_id" TEXT NOT NULL,
    "received_by_id" TEXT NOT NULL,
    "return_kind" "DeviceReturnKind" NOT NULL,
    "return_reason" TEXT NOT NULL,
    "device_received_at" TIMESTAMP(3) NOT NULL,
    "condition_grade" "ConditionGrade" NOT NULL,
    "appraisal_price" DECIMAL(12,2) NOT NULL,
    "table_base_price" DECIMAL(12,2),
    "repair_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "previous_contract_status" "ContractStatus",
    "status" "DeviceReturnStatus" NOT NULL DEFAULT 'PENDING_CONFIRM',
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "repossession_id" TEXT,
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "canceled_by_id" TEXT,
    "canceled_at" TIMESTAMP(3),
    "line_notify_status" TEXT,
    "line_notified_at" TIMESTAMP(3),
    "line_notification_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "device_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_returns_doc_number_key" ON "device_returns"("doc_number");
CREATE UNIQUE INDEX "device_returns_repossession_id_key" ON "device_returns"("repossession_id");
CREATE INDEX "device_returns_contract_id_idx" ON "device_returns"("contract_id");
CREATE INDEX "device_returns_customer_id_idx" ON "device_returns"("customer_id");
CREATE INDEX "device_returns_status_idx" ON "device_returns"("status");
CREATE INDEX "device_returns_receiving_branch_id_idx" ON "device_returns"("receiving_branch_id");

-- AddForeignKey (onDelete: Restrict — ใบรับคืนเป็นหลักฐาน ห้ามหายไปเงียบ ๆ ใต้ parent)
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_receiving_branch_id_fkey" FOREIGN KEY ("receiving_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "device_returns" ADD CONSTRAINT "device_returns_repossession_id_fkey" FOREIGN KEY ("repossession_id") REFERENCES "repossessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique (spec §4.1) — หนึ่งสัญญามีใบรอยืนยันได้ใบเดียว; Prisma เขียน partial index ไม่ได้ (precedent products_imei_partial_unique)
CREATE UNIQUE INDEX "device_returns_one_open_per_contract"
  ON "device_returns" ("contract_id")
  WHERE "status" = 'PENDING_CONFIRM' AND "deleted_at" IS NULL;
