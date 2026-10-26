-- ใบเสร็จขายสด (ก้อน 4 · 2026-10-23): token ลิงก์สาธารณะบนใบขาย CASH/EXTERNAL_FINANCE
ALTER TABLE "sales" ADD COLUMN "receipt_token" TEXT,
                    ADD COLUMN "receipt_token_expires_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "sales_receipt_token_key" ON "sales"("receipt_token");
