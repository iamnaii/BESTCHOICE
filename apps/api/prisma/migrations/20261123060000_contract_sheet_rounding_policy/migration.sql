-- Forward-only: existing contracts retain NULL and their original accounting basis.
ALTER TABLE "contracts" ADD COLUMN "installment_rounding_policy" TEXT;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_installment_rounding_policy_check"
  CHECK ("installment_rounding_policy" IS NULL OR "installment_rounding_policy" = 'SHEET_WHOLE_BAHT');
