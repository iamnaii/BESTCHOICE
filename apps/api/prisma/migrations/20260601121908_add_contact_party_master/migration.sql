-- CreateEnum
CREATE TYPE "ContactRole" AS ENUM ('CUSTOMER', 'SUPPLIER', 'TRADE_IN_SELLER', 'FINANCE_COMPANY');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "contact_code" TEXT NOT NULL,
    "peak_contact_code" TEXT,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "national_id_hash" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "line_id" TEXT,
    "roles" "ContactRole"[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_contact_code_key" ON "contacts"("contact_code");

-- CreateIndex
CREATE INDEX "contacts_national_id_hash_idx" ON "contacts"("national_id_hash");

-- CreateIndex
CREATE INDEX "contacts_deleted_at_idx" ON "contacts"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_tax_id_key" ON "contacts"("tax_id");

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "contact_id" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "contact_id" TEXT;

-- AlterTable
ALTER TABLE "trade_ins" ADD COLUMN     "seller_contact_id" TEXT;

-- AlterTable
ALTER TABLE "external_finance_companies" ADD COLUMN     "contact_id" TEXT;

-- CreateIndex
CREATE INDEX "customers_contact_id_idx" ON "customers"("contact_id");

-- CreateIndex
CREATE INDEX "suppliers_contact_id_idx" ON "suppliers"("contact_id");

-- CreateIndex
CREATE INDEX "trade_ins_seller_contact_id_idx" ON "trade_ins"("seller_contact_id");

-- CreateIndex
CREATE INDEX "external_finance_companies_contact_id_idx" ON "external_finance_companies"("contact_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_ins" ADD CONSTRAINT "trade_ins_seller_contact_id_fkey" FOREIGN KEY ("seller_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_finance_companies" ADD CONSTRAINT "external_finance_companies_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
