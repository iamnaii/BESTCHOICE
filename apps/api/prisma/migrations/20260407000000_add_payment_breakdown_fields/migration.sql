-- Phase 3: Payment & Accounting Structure
-- Add payment breakdown fields (principal, interest, commission, VAT)
-- Add contract VAT fields

-- Payment breakdown: เงินต้น + ค่าคอม + ดอกเบี้ย + VAT = amountDue
ALTER TABLE "payments" ADD COLUMN "monthly_principal" DECIMAL(12,2);
ALTER TABLE "payments" ADD COLUMN "monthly_interest" DECIMAL(12,2);
ALTER TABLE "payments" ADD COLUMN "monthly_commission" DECIMAL(12,2);
ALTER TABLE "payments" ADD COLUMN "vat_amount" DECIMAL(12,2);

-- Contract VAT snapshot at creation time
ALTER TABLE "contracts" ADD COLUMN "vat_amount" DECIMAL(12,2);
ALTER TABLE "contracts" ADD COLUMN "vat_pct" DECIMAL(5,4);
