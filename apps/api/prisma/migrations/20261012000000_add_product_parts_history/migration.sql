-- ประวัติอะไหล่/การซ่อมที่แจ้งลูกค้า — เครื่องเดิมทั้งหมดเป็น "ยังไม่ระบุ" (NULL) จนพนักงานเช็คเครื่อง
CREATE TYPE "PartsHistory" AS ENUM ('ORIGINAL', 'GENUINE_REPLACED', 'BATTERY_NON_GENUINE', 'NON_GENUINE_PARTS');
ALTER TABLE "products" ADD COLUMN "parts_history" "PartsHistory";
ALTER TABLE "products" ADD COLUMN "parts_history_note" TEXT;
