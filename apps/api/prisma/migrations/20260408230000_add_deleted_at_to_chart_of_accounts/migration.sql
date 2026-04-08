-- เพิ่ม soft delete support ใน chart_of_accounts
-- chart_of_accounts เป็น master data ที่ JournalLine และ Expense อ้างอิง
-- ต้องไม่ hard delete — ใช้ deletedAt แทน

ALTER TABLE "chart_of_accounts"
  ADD COLUMN "deleted_at" TIMESTAMP(3);
