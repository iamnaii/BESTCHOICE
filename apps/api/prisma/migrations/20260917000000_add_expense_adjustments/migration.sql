-- ExpenseAdjustment table — per-line breakdown of amount_paid vs amount_expected
-- diff (Fix Report P0-4). Each row carries its own Dr/Cr direction via `side`.

CREATE TYPE "ExpenseAdjustmentSide" AS ENUM ('DR', 'CR');

CREATE TABLE "expense_adjustments" (
  "id"           TEXT                    NOT NULL,
  "document_id"  TEXT                    NOT NULL,
  "line_no"      INTEGER                 NOT NULL,
  "account_code" TEXT                    NOT NULL,
  "side"         "ExpenseAdjustmentSide" NOT NULL,
  "amount"       DECIMAL(12, 2)          NOT NULL,
  "note"         TEXT,
  "created_at"   TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "expense_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expense_adjustments_document_id_line_no_key"
  ON "expense_adjustments"("document_id", "line_no");

CREATE INDEX "expense_adjustments_document_id_idx"
  ON "expense_adjustments"("document_id");

ALTER TABLE "expense_adjustments"
  ADD CONSTRAINT "expense_adjustments_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "expense_documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
