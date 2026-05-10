-- Polymorphic expense-documents redesign (PR-1, EXPENSE type only).
-- Replaces the legacy "expenses" table with two new tables:
--   - "expense_documents" (header for any AP document)
--   - "expense_details"   (1:1 sub-table for documentType = EXPENSE)
-- Subsequent PRs will add CreditNoteDetail / PayrollDetail / VendorSettlementDetail.

-- ─── Drop legacy schema ────────────────────────────────────────────────
DROP TABLE IF EXISTS "expenses";
DROP TYPE  IF EXISTS "ExpenseStatus";
DROP TYPE  IF EXISTS "ExpenseAccountType";
DROP TYPE  IF EXISTS "ExpenseCategory";

-- ─── New enums ─────────────────────────────────────────────────────────
CREATE TYPE "DocumentType" AS ENUM (
  'EXPENSE',
  'CREDIT_NOTE',
  'PAYROLL',
  'VENDOR_SETTLEMENT'
);

CREATE TYPE "DocumentStatus" AS ENUM (
  'DRAFT',
  'ACCRUAL',
  'POSTED',
  'VOIDED'
);

-- ─── expense_documents (header) ────────────────────────────────────────
CREATE TABLE "expense_documents" (
  "id"                    TEXT            NOT NULL,
  "number"                TEXT            NOT NULL,
  "document_type"         "DocumentType"  NOT NULL,
  "branch_id"             TEXT            NOT NULL,
  "document_date"         TIMESTAMP(3)    NOT NULL,
  "vendor_name"           TEXT,
  "vendor_tax_id"         TEXT,
  "tax_invoice_no"        TEXT,
  "description"           TEXT,

  "subtotal"              DECIMAL(12, 2)  NOT NULL,
  "vat_amount"            DECIMAL(12, 2)  NOT NULL DEFAULT 0,
  "withholding_tax"       DECIMAL(12, 2)  NOT NULL DEFAULT 0,
  "wht_form_type"         TEXT,
  "total_amount"          DECIMAL(12, 2)  NOT NULL,
  "net_payment"           DECIMAL(12, 2),

  "status"                "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "paid_at"               TIMESTAMP(3),
  "payment_method"        "PaymentMethod",
  "deposit_account_code"  TEXT,

  "journal_entry_id"      TEXT,

  "receipt_image_url"     TEXT,
  "reference"             TEXT,
  "note"                  TEXT,

  "from_template_id"      TEXT,

  "created_by_id"         TEXT            NOT NULL,
  "approved_by_id"        TEXT,
  "created_at"            TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3)    NOT NULL,
  "deleted_at"            TIMESTAMP(3),

  CONSTRAINT "expense_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expense_documents_number_key"
  ON "expense_documents" ("number");

CREATE INDEX "expense_documents_branch_id_document_date_idx"
  ON "expense_documents" ("branch_id", "document_date");

CREATE INDEX "expense_documents_document_type_status_idx"
  ON "expense_documents" ("document_type", "status");

CREATE INDEX "expense_documents_status_paid_at_idx"
  ON "expense_documents" ("status", "paid_at");

CREATE UNIQUE INDEX "expense_documents_journal_entry_id_key"
  ON "expense_documents" ("journal_entry_id");

CREATE INDEX "expense_documents_created_by_id_idx"
  ON "expense_documents" ("created_by_id");

CREATE INDEX "expense_documents_approved_by_id_idx"
  ON "expense_documents" ("approved_by_id");

ALTER TABLE "expense_documents"
  ADD CONSTRAINT "expense_documents_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expense_documents"
  ADD CONSTRAINT "expense_documents_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expense_documents"
  ADD CONSTRAINT "expense_documents_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── expense_details (1:1 for documentType = EXPENSE) ─────────────────
CREATE TABLE "expense_details" (
  "document_id" TEXT NOT NULL,
  "category"    TEXT NOT NULL,

  CONSTRAINT "expense_details_pkey" PRIMARY KEY ("document_id")
);

ALTER TABLE "expense_details"
  ADD CONSTRAINT "expense_details_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "expense_documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
