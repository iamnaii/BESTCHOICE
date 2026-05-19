-- SP7.4 — External finance companies + commission tracking (SHOP-side)

CREATE TYPE "ExternalCommissionStatus" AS ENUM ('PENDING', 'RECEIVED', 'CANCELLED');

CREATE TABLE "external_finance_companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "contact_phone" TEXT,
    "default_commission_rate" DECIMAL(5,4),
    "bank_account_info" JSONB,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "external_finance_companies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "external_finance_companies_name_key" ON "external_finance_companies"("name");

CREATE TABLE "external_finance_commissions" (
    "id" TEXT NOT NULL,
    "external_finance_company_id" TEXT NOT NULL,
    "sale_reference_id" TEXT,
    "customer_id" TEXT,
    "financed_amount" DECIMAL(12,2) NOT NULL,
    "commission_rate" DECIMAL(5,4) NOT NULL,
    "commission_amount" DECIMAL(12,2) NOT NULL,
    "received_at" TIMESTAMP(3),
    "bank_slip_url" TEXT,
    "journal_entry_id" TEXT,
    "status" "ExternalCommissionStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "external_finance_commissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_finance_commissions_external_finance_company_id_idx" ON "external_finance_commissions"("external_finance_company_id");
CREATE INDEX "external_finance_commissions_status_idx" ON "external_finance_commissions"("status");
CREATE INDEX "external_finance_commissions_received_at_idx" ON "external_finance_commissions"("received_at");

ALTER TABLE "external_finance_commissions" ADD CONSTRAINT "external_finance_commissions_external_finance_company_id_fkey" FOREIGN KEY ("external_finance_company_id") REFERENCES "external_finance_companies"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
