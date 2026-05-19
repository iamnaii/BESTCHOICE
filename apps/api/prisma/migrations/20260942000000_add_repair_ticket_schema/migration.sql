-- SP5 Phase 2: Add RepairTicket + RepairStatusLog schema
-- Additive only: no DROP, no ALTER COLUMN NOT NULL on existing columns

-- CreateEnum
CREATE TYPE "RepairStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'CLOSED', 'REPLACED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WarrantyStatus" AS ENUM ('IN_7DAY_DEFECT', 'IN_SHOP_WARRANTY', 'IN_MANUFACTURER', 'OUT_OF_WARRANTY', 'WALK_IN');

-- CreateEnum
CREATE TYPE "RepairPayer" AS ENUM ('SHOP', 'CUSTOMER', 'SUPPLIER_CLAIM');

-- AlterEnum: Add REPAIR_SERVICE to DocumentType
ALTER TYPE "DocumentType" ADD VALUE 'REPAIR_SERVICE';

-- AlterTable: Add isRepairCenter to suppliers
ALTER TABLE "suppliers" ADD COLUMN "is_repair_center" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: repair_tickets
CREATE TABLE "repair_tickets" (
    "id" TEXT NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "status" "RepairStatus" NOT NULL DEFAULT 'OPEN',
    "customer_id" TEXT NOT NULL,
    "contract_id" TEXT,
    "product_id" TEXT,
    "device_brand" TEXT,
    "device_model" TEXT,
    "device_imei" TEXT,
    "device_serial" TEXT,
    "defect_description" TEXT NOT NULL,
    "warranty_status" "WarrantyStatus" NOT NULL DEFAULT 'WALK_IN',
    "repair_supplier_id" TEXT,
    "external_claim_no" TEXT,
    "sent_to_repair_at" TIMESTAMP(3),
    "repaired_at" TIMESTAMP(3),
    "returned_to_customer_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "replaced_at" TIMESTAMP(3),
    "estimated_cost" DECIMAL(12,2),
    "actual_cost" DECIMAL(12,2),
    "payer" "RepairPayer" NOT NULL DEFAULT 'SHOP',
    "expense_document_id" TEXT,
    "other_income_id" TEXT,
    "replacement_contract_id" TEXT,
    "notes" TEXT,
    "branch_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "repair_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable: repair_status_logs
CREATE TABLE "repair_status_logs" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "from_status" "RepairStatus" NOT NULL,
    "to_status" "RepairStatus" NOT NULL,
    "changed_by_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_status_logs_pkey" PRIMARY KEY ("id")
);

-- Unique indexes
CREATE UNIQUE INDEX "repair_tickets_ticket_number_key" ON "repair_tickets"("ticket_number");
CREATE UNIQUE INDEX "repair_tickets_expense_document_id_key" ON "repair_tickets"("expense_document_id");
CREATE UNIQUE INDEX "repair_tickets_other_income_id_key" ON "repair_tickets"("other_income_id");
CREATE UNIQUE INDEX "repair_tickets_replacement_contract_id_key" ON "repair_tickets"("replacement_contract_id");

-- Regular indexes
CREATE INDEX "repair_tickets_customer_id_deleted_at_idx" ON "repair_tickets"("customer_id", "deleted_at");
CREATE INDEX "repair_tickets_branch_id_status_deleted_at_idx" ON "repair_tickets"("branch_id", "status", "deleted_at");
CREATE INDEX "repair_tickets_status_idx" ON "repair_tickets"("status");
CREATE INDEX "repair_tickets_created_at_idx" ON "repair_tickets"("created_at");
CREATE INDEX "repair_tickets_contract_id_idx" ON "repair_tickets"("contract_id");
CREATE INDEX "repair_tickets_product_id_idx" ON "repair_tickets"("product_id");
CREATE INDEX "repair_tickets_repair_supplier_id_idx" ON "repair_tickets"("repair_supplier_id");
CREATE INDEX "repair_status_logs_ticket_id_created_at_idx" ON "repair_status_logs"("ticket_id", "created_at");

-- Foreign keys: repair_tickets
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_repair_supplier_id_fkey" FOREIGN KEY ("repair_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_expense_document_id_fkey" FOREIGN KEY ("expense_document_id") REFERENCES "expense_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_other_income_id_fkey" FOREIGN KEY ("other_income_id") REFERENCES "other_incomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "repair_tickets" ADD CONSTRAINT "repair_tickets_replacement_contract_id_fkey" FOREIGN KEY ("replacement_contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign keys: repair_status_logs
ALTER TABLE "repair_status_logs" ADD CONSTRAINT "repair_status_logs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "repair_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "repair_status_logs" ADD CONSTRAINT "repair_status_logs_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
