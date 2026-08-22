-- ยกเลิกใบขาย (void-sale, 2026-08-22) — additive 2 คอลัมน์บน `sales`
--
-- เวลาที่ยกเลิก = `deleted_at` ที่มีอยู่แล้ว (ผู้อ่านกรอง deleted_at IS NULL อยู่แล้ว
-- ⇒ ใบที่ยกเลิกหลุดจากรายงานเองโดยไม่ต้องเดินแก้ทีละจุด) — ไม่เพิ่มคอลัมน์เวลาซ้ำ
--
-- `voided_by_id` เป็น **TEXT** ไม่ใช่ UUID: `users.id` ในฐานข้อมูลนี้เป็น TEXT
-- (Prisma `String @id @default(uuid())` map เป็น TEXT) — ประกาศเป็น UUID จะทำให้
-- FK constraint สร้างไม่ผ่านเพราะชนิดไม่ตรง
--
-- onDelete: Restrict — ใบขายที่ถูกยกเลิกคือหลักฐานทางการเงิน ห้ามให้การลบผู้ใช้
-- ทำให้คนกดยกเลิกหายไปเงียบ ๆ

ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "void_reason" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "voided_by_id" TEXT;

-- Postgres ไม่มี `ADD CONSTRAINT IF NOT EXISTS` — ห่อด้วย DO block ให้รันซ้ำได้
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_voided_by_id_fkey'
  ) THEN
    ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_by_id_fkey"
      FOREIGN KEY ("voided_by_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "sales_voided_by_id_idx" ON "sales"("voided_by_id");
