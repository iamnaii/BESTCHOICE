-- M3 (final review PR5): อุปกรณ์ที่ส่งมอบของเคสขายสดเก็บแบบโครงสร้าง แทนการถอดจากข้อความ note ของ event DELIVERED. Additive only.
ALTER TABLE "after_sales_cases" ADD COLUMN "delivered_accessories" JSONB;
