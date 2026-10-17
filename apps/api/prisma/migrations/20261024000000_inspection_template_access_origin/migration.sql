-- New managed templates carry authenticated origin. No historical ownership backfill.
ALTER TABLE "inspection_templates" ADD COLUMN "access_company_code" TEXT;
ALTER TABLE "inspection_templates" ADD CONSTRAINT "inspection_templates_access_company_code_fkey"
  FOREIGN KEY ("access_company_code") REFERENCES "company_info"("company_code") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "inspection_templates_access_company_code_idx" ON "inspection_templates"("access_company_code");
