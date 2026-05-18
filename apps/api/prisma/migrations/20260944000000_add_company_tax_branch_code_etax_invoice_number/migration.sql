-- P2-SP5 follow-ups for the 10-Critical fix pass
--
-- C6 — Per-company RD branch code (5 digits) so e-Tax XML can emit
--      `<cbc:CompanyID schemeID="TXID">{taxId}-{branchCode}</cbc:CompanyID>`
--      with the correct branch instead of a hardcoded '00000'.
--
-- C7 — Sequential invoice number on ETaxSubmission per ป.รัษฎากร ม.86/4
--      (`ET-YYYYMMDD-NNNN`). One number per submission row, idempotent on
--      retry. UNIQUE index enforces no duplicates.

ALTER TABLE "company_info"
  ADD COLUMN "tax_branch_code" VARCHAR(5) NOT NULL DEFAULT '00000';

ALTER TABLE "etax_submissions"
  ADD COLUMN "invoice_number" TEXT;

CREATE UNIQUE INDEX "etax_submissions_invoice_number_key"
  ON "etax_submissions"("invoice_number");
