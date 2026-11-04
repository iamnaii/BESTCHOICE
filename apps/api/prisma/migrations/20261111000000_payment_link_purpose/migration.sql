-- Task 39 — ลิงก์ชำระรู้ว่าเงินของมันจ่ายอะไร (หน้า /pay/:token ตัดสินจากข้อมูลแทนการเดาจากยอด) + ลิงก์ต้นทางของแถวติดตาม intent
--   INSTALLMENT = ยอดคงค้างของงวดที่ผูก → หน้าเว็บส่งเลขงวด · intent เทียบยอดกับงวดนั้น (พฤติกรรมเดิม)
--   PAYOFF      = ยอดปิดสัญญา → intent ใช้ยอดของลิงก์ · ด่านคำขอคืนเงินรอธนาคาร (#24) ใช้กับลิงก์นี้
--   AMOUNT      = ยอดที่ข้อความบอก (ยอดค้างรวมแจ้งล็อก · ยอดนัด) → intent ใช้ยอดของลิงก์ · ไม่ใช่การปิดยอด (ไม่ติดด่าน #24)
--   null        = ไม่ใช่เงินค่างวดของสัญญา (ออเดอร์ออนไลน์ · ออมเงิน) หรือแถวก่อน migration ที่ใช้ไม่ได้แล้ว
-- source_link_id: แถวติดตาม intent → ลิงก์ /pay/:token ต้นทาง · webhook สำเร็จตั้งลิงก์ต้นทางเป็น USED (จ่ายซ้ำไม่ได้)
-- additive · ไม่ rewrite ตาราง
CREATE TYPE "PaymentLinkPurpose" AS ENUM ('INSTALLMENT', 'PAYOFF', 'AMOUNT');

ALTER TABLE "payment_links"
  ADD COLUMN "purpose" "PaymentLinkPurpose",
  ADD COLUMN "source_link_id" TEXT;

CREATE INDEX "payment_links_source_link_id_idx" ON "payment_links"("source_link_id");

ALTER TABLE "payment_links"
  ADD CONSTRAINT "payment_links_source_link_id_fkey"
  FOREIGN KEY ("source_link_id") REFERENCES "payment_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ลิงก์ /pay/:token (token 64 hex ของ createPaymentLink) ที่ยังจ่ายได้ตอน deploy: ตั้ง purpose ด้วยเกณฑ์เดียวกับหน้าเว็บที่ deploy อยู่
-- (ยอด ≤ ค่างวด + ค่าปรับของงวดที่ผูก + 0.5 = งวดเดียว) ⇒ ลิงก์ที่ค้างตอน deploy ทำงานเหมือนก่อน deploy ทุกประการ · ที่เหลือบน main
-- มีผู้สร้างเดียวคือลิงก์ปิดยอด (POST liff/early-payoff) = PAYOFF · เกณฑ์นี้ถูกเฉพาะแถวก่อน deploy — ห้ามใช้กับแถวที่โค้ดใหม่สร้าง
-- (ลิงก์แจ้งล็อก 1,615.83 = ค่าปรับงวด 1 + งวด 2 จะถูกนับเป็นงวดเดียวผิด) · แถวที่หมดอายุ/ใช้แล้ว/แถวติดตามคง null (ไม่มีผู้อ่าน)
UPDATE "payment_links" pl
SET "purpose" = CASE
      WHEN pl."amount" <= p."amount_due" + p."late_fee" + 0.5 THEN 'INSTALLMENT'::"PaymentLinkPurpose"
      ELSE 'PAYOFF'::"PaymentLinkPurpose"
    END
FROM "payments" p
WHERE pl."payment_id" = p."id"
  AND pl."contract_id" IS NOT NULL
  AND pl."saving_plan_id" IS NULL
  AND pl."deleted_at" IS NULL
  AND pl."status" = 'ACTIVE'
  -- expires_at = timestamp (ไม่มีเขตเวลา) เก็บเวลา UTC ของ Prisma ⇒ เทียบกับ NOW() ในเวลา UTC (ไม่ขึ้นกับ TimeZone ของ session)
  AND pl."expires_at" > (NOW() AT TIME ZONE 'UTC')
  AND pl."token" ~ '^[0-9a-f]{64}$';
