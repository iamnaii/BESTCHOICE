-- 4 แถวสุดท้าย — ตามคำตอบนโยบาย owner 2026-08-13:
-- เปิดทุกวัน 10:00-19:00 · อนุมัติใน 5 นาที ยืนยัน · เทิร์นรับถึง iPhone 17 Pro Max ·
-- เครื่องมือสองประกันร้าน 60 วัน (ใหม่ 12 เดือน)
BEGIN;

UPDATE chat_knowledge_base SET response_template = $KBX$แถวเส้นหลัง บขส สระแก้วลพบุรี ร้านอยู่ที่เดียวกับประกัน ตรงข้ามร้านชาบูแม็คซิโกค่ะ

🗺️ แผนที่ร้าน : https://maps.app.goo.gl/bqGcmr5FupWLw1378

📢 BestChoice เปิดให้บริการทุกวันค่ะ 🎉📱
⏰ 10:00 - 19:00 น.$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:store_location_hours' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ไม่เช็คเครดิตบูโรค่ะ ใช้บัตรประชาชนใบเดียวก็ผ่านได้ 😊 อนุมัติไวภายใน 5 นาทีค่ะ$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:approval_process' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$✨ BestChoice เทิร์นเงินเหลือ (ไอโฟนแลกเงิน) ✨

BestChoice ให้คุณเปลี่ยน iPhone เครื่องเดิมเป็นเงินสดได้ง่าย ๆ เพียงนำเครื่องมาขายกับทางร้านและซื้อกลับด้วยระบบผ่อนชำระ

📱 รุ่นที่รับทำรายการ: iPhone 12 ถึง iPhone 17 Pro Max
(ไม่รับรุ่น iPhone Mini)

📌 เงื่อนไข:
- เครื่องต้องเป็นของลูกค้าเอง
- โมเดลต้องเป็น TH/A หรือ ZP/A เท่านั้น
- ไม่มีติดสัญญาจากที่อื่น ไม่ติด iCloud ไม่ล็อคเครือข่าย
- สภาพเครื่องสมบูรณ์ ใช้งานปกติ$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:trade_in' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เครื่องใหม่มีประกัน 12 เดือน ส่วนเครื่องมือสองมีประกันร้าน 60 วันค่ะ 😊

ถ้ามีปัญหาในช่วงประกัน นำเครื่องเข้ามาให้ทีมที่ร้านเช็คได้เลยนะคะ$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:warranty_claim' AND deleted_at IS NULL;

COMMIT;

SELECT category, active, count(*)
FROM chat_knowledge_base
WHERE category IN ('EXTRACTED','EXTRACTED_OBJECTION') AND deleted_at IS NULL
GROUP BY 1,2 ORDER BY 1,2;
