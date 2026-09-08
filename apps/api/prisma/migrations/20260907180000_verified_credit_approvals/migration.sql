CREATE TABLE "credit_approvals" (
  "id" TEXT NOT NULL,
  "credit_check_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "approved_by_id" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "verified_monthly_income" DECIMAL(12,2) NOT NULL,
  "living_expenses" DECIMAL(12,2) NOT NULL,
  "external_monthly_debt" DECIMAL(12,2) NOT NULL,
  "internal_monthly_debt" DECIMAL(12,2) NOT NULL,
  "remaining_income" DECIMAL(12,2) NOT NULL,
  "maximum_monthly_payment" DECIMAL(12,2) NOT NULL,
  "approved_monthly_payment" DECIMAL(12,2) NOT NULL,
  "salary_pay_day" INTEGER NOT NULL,
  "evidence_notes" TEXT NOT NULL,
  "source_financial_hash" TEXT NOT NULL,
  "customer_financial_hash" TEXT NOT NULL,
  "commitments" JSONB NOT NULL,
  "used_by_contract_id" TEXT,
  "used_at" TIMESTAMP(3),
  "used_first_payment_due" TIMESTAMP(3),
  "superseded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "credit_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credit_approvals_credit_check_id_fkey" FOREIGN KEY ("credit_check_id") REFERENCES "credit_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "credit_approvals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "credit_approvals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "credit_approvals_used_by_contract_id_fkey" FOREIGN KEY ("used_by_contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "credit_approvals_valid_amounts" CHECK (
    "verified_monthly_income" >= 0 AND "living_expenses" >= 0 AND
    "external_monthly_debt" >= 0 AND "internal_monthly_debt" >= 0 AND
    "approved_monthly_payment" > 0 AND "approved_monthly_payment" <= "maximum_monthly_payment"
    AND "salary_pay_day" BETWEEN 1 AND 31
  )
);
CREATE INDEX "credit_approvals_customer_id_created_at_idx" ON "credit_approvals"("customer_id", "created_at");
CREATE INDEX "credit_approvals_credit_check_id_created_at_idx" ON "credit_approvals"("credit_check_id", "created_at");
CREATE INDEX "credit_approvals_used_by_contract_id_idx" ON "credit_approvals"("used_by_contract_id");
-- One pending offer per customer; a review replaces that offer atomically.
CREATE UNIQUE INDEX "credit_approvals_one_pending_customer" ON "credit_approvals"("customer_id")
  WHERE "used_by_contract_id" IS NULL AND "superseded_at" IS NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "credit_approvals_one_current_contract" ON "credit_approvals"("used_by_contract_id")
  WHERE "used_by_contract_id" IS NOT NULL AND "superseded_at" IS NULL AND "deleted_at" IS NULL;
