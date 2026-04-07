-- Legacy migration tracking fields (จากโปรแกรมเขียว)
-- ใช้ trace ข้อมูลที่ import จากระบบเก่ากลับไปยังต้นทาง

ALTER TABLE "customers" ADD COLUMN "legacy_member_code" TEXT;
ALTER TABLE "contracts" ADD COLUMN "legacy_contract_code" TEXT;
ALTER TABLE "products" ADD COLUMN "legacy_product_code" TEXT;
ALTER TABLE "payments" ADD COLUMN "legacy_installment_code" TEXT;

CREATE UNIQUE INDEX "customers_legacy_member_code_key" ON "customers"("legacy_member_code");
CREATE UNIQUE INDEX "contracts_legacy_contract_code_key" ON "contracts"("legacy_contract_code");
CREATE UNIQUE INDEX "products_legacy_product_code_key" ON "products"("legacy_product_code");
CREATE UNIQUE INDEX "payments_legacy_installment_code_key" ON "payments"("legacy_installment_code");
