-- ปรับคลังคำตอบ 8 แถวให้ตรง persona น้องช้อยส์ (2026-08-14):
-- ก้าวถัดไปท้ายข้อความ · emoji ประดับ ≤2 (คงตัวที่เป็น bullet รายการ) · ภาษาสั้นง่าย
BEGIN;

UPDATE chat_knowledge_base SET response_template = $KBX$ร้านอยู่เส้นหลัง บขส สระแก้วลพบุรี ที่เดียวกับร้านประกัน ตรงข้ามชาบูแม็คซิโกค่ะ

🗺️ แผนที่: https://maps.app.goo.gl/bqGcmr5FupWLw1378
⏰ เปิดทุกวัน 10:00 - 19:00 น.

แวะมาดูเครื่องจริงได้เลยนะคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:store_location_hours' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ร้านเรามีเรทผ่อน 2 แบบค่ะ

1️⃣ ดาวน์น้อย ผ่อน 10 เดือน — ใช้สลิปเงินเดือน 1 เดือน
2️⃣ ดาวน์สูงขึ้น ผ่อน 12 เดือน — บัตรประชาชนใบเดียว ไม่เช็คอะไรเลย

ลูกค้าสะดวกแบบไหนคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:installment_terms' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ไม่เช็คเครดิตบูโรค่ะ 😊

📄 ผ่อน 12 เดือน — บัตรประชาชนใบเดียวจบ
📄 ดาวน์น้อย ผ่อน 10 เดือน — บัตรประชาชน + สลิปเงินเดือน 1 เดือน

สะดวกแบบไหน ส่งเอกสารมาให้เช็คได้เลยนะคะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:documents_required' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เทิร์นเงินเหลือได้ค่ะ 😊 เอา iPhone เครื่องเดิมมาขายให้ร้าน แล้วผ่อนเครื่องใหม่กลับไปเลย

รับ iPhone 12 ถึง 17 Pro Max (ไม่รับรุ่น Mini) เครื่องศูนย์ไทย TH/A หรือ ZP/A เป็นของลูกค้าเอง ไม่ติด iCloud ไม่ติดสัญญาที่อื่น สภาพใช้งานปกติค่ะ

ลูกค้าใช้รุ่นไหนอยู่คะ เดี๋ยวประเมินราคาให้เลยค่ะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:trade_in' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เข้าใจค่ะ 😊 ที่ BESTCHOICE ต่างจากที่อื่น:

✅ ไม่เช็คเครดิตบูโร บัตรประชาชนใบเดียว
✅ อนุมัติไว รับเครื่องได้เลย
✅ ผ่อน 10 หรือ 12 เดือน เลือกได้
✅ เครื่องแท้ 100% มีหน้าร้านจริงที่ลพบุรี

สนใจรุ่นไหนคะ เดี๋ยวเทียบค่างวดให้ดูเลยค่ะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_competitor_finance' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ไม่เช็คเครดิตบูโรค่ะ ใช้บัตรประชาชนใบเดียวก็ผ่านได้ 😊 อนุมัติไวภายใน 5 นาที สะดวกส่งเอกสารให้เช็คเลยไหมคะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:approval_process' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$สนใจรุ่นไหน สีไหนคะ เดี๋ยวเช็คของให้ทันทีเลยค่ะ 😊 ถ้ารุ่นไหนหมด ของเข้าใหม่เรื่อย ๆ นะคะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:product_availability' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ได้เลยค่ะ วางดาวน์แล้วรับเครื่องกลับบ้านได้เลย ไม่ต้องรอค่ะ 😊 ลูกค้าสนใจรุ่นไหนอยู่คะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:down_payment_channel' AND deleted_at IS NULL;

COMMIT;

SELECT count(*) AS active_rows FROM chat_knowledge_base
WHERE category IN ('EXTRACTED','EXTRACTED_OBJECTION') AND active AND deleted_at IS NULL;
