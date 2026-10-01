-- ลงบัญชีรับสินค้าเข้าเฉพาะหน่วยที่รับเข้าคลังจริง (คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8):
-- เก็บต้นทุนของหน่วยตอนรับของ และรายการบัญชีที่ลงให้หน่วยนั้น — เครื่องที่รอถ่ายรูปลงบัญชีตอนผ่านเข้าคลัง
-- เพิ่มคอลัมน์ที่ว่างได้เท่านั้น ไม่เขียนแถวเดิมใหม่ (แถวเก่า = null = ไม่ลงย้อนหลัง)
ALTER TABLE "goods_receiving_items" ADD COLUMN IF NOT EXISTS "received_cost" DECIMAL(12,2);
ALTER TABLE "goods_receiving_items" ADD COLUMN IF NOT EXISTS "journal_entry_id" TEXT;
