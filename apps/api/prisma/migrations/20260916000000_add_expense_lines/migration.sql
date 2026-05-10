-- ExpenseLine table — multi-line expense items per ExpenseDetail
CREATE TABLE "expense_lines" (
  "id"                TEXT            NOT NULL,
  "expense_detail_id" TEXT            NOT NULL,
  "line_no"           INTEGER         NOT NULL,
  "category"          TEXT            NOT NULL,
  "description"       TEXT,
  "quantity"          DECIMAL(12, 2)  NOT NULL DEFAULT 1,
  "unit_price"        DECIMAL(12, 2)  NOT NULL,
  "discount"          DECIMAL(12, 2)  NOT NULL DEFAULT 0,
  "vat_percent"       DECIMAL(5, 2)   NOT NULL DEFAULT 0,
  "wht_percent"       DECIMAL(5, 2)   NOT NULL DEFAULT 0,
  "amount_before_vat" DECIMAL(12, 2)  NOT NULL,
  "vat_amount"        DECIMAL(12, 2)  NOT NULL DEFAULT 0,
  "wht_amount"        DECIMAL(12, 2)  NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "expense_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_lines_expense_detail_id_line_no_idx"
  ON "expense_lines"("expense_detail_id", "line_no");

ALTER TABLE "expense_lines"
  ADD CONSTRAINT "expense_lines_expense_detail_id_fkey"
  FOREIGN KEY ("expense_detail_id") REFERENCES "expense_details"("document_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop the legacy single-category column on ExpenseDetail
ALTER TABLE "expense_details" DROP COLUMN IF EXISTS "category";

-- Add priceType discriminator
ALTER TABLE "expense_details"
  ADD COLUMN "price_type" TEXT NOT NULL DEFAULT 'EXCLUSIVE';
