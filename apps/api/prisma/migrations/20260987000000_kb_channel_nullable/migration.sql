-- B3 §5 — KB ข้ามช่อง: channel = NULL แปลว่า "ใช้ได้ทุกช่องทาง"
-- คอลัมน์นี้มีอยู่แล้ว (default LINE_FINANCE) — งานเดียวคือปลด NOT NULL
-- แถวเดิมไม่ถูกแตะ: ทุกแถวยังเป็น LINE_FINANCE เหมือนเดิม (forward-fix only)
ALTER TABLE "chat_knowledge_base" ALTER COLUMN "channel" DROP NOT NULL;
