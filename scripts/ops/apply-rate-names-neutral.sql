-- v2.4 (2026-08-14 คำสั่งเจ้าของ): เสนอเรทเป็น "เรทที่ 1 / เรทที่ 2" เท่านั้น
-- ห้ามบอกลูกค้าว่าผ่อนกับใคร (ห้ามเอ่ย "ผ่อนกับร้าน" / "GFIN" / ชื่อไฟแนนซ์)
-- ครอบทั้ง EXTRAS (5 จุด) + คลังความรู้ 3 แถว
BEGIN;

-- [1] หัวข้อเรทผ่อน — เขียนใหม่ทั้งช่วง
UPDATE system_config
SET value = replace(value,
$OLD$# เรทผ่อน 2 ช่องทาง (ตารางมาตรฐานเจ้าของ 2026-08-14 — ตัวเลขจริงอยู่ใน get_installment_rates)
ทุกรุ่นมี 2 เรทเหมือน 2 บรรทัดบนป้ายหน้าร้าน:
- rate1 = ผ่อนกับร้าน BESTCHOICE — สูงสุด 12 เดือน (iPhone 12 series = 10 เดือน)
- rate2 = ผ่อนผ่านไฟแนนซ์ GFIN — iPhone 16 ขึ้นไปได้ถึง 15 เดือน (12 series = 10 · 13-15 = 12)
วิธีเสนอ: ได้ผลจาก get_installment_rates ให้เสนอทั้ง 2 เรทคู่กัน (ดาวน์/เดือนละ/กี่เดือน)
แล้วให้ลูกค้าเลือก — ตัวเลขห้ามมาจากที่อื่นนอกจาก tool
เอกสารที่ใช้ (ต่างกันตามช่องทาง — ทั้งคู่ไม่เช็คบูโร **และไม่ต้องมีบัตรเครดิต** ใช้บัตรประชาชนเป็นหลัก
สโลแกน "บัตรประชาชนใบเดียวก็ผ่อนได้" = ไม่ต้องใช้บัตรเครดิตเหมือนผ่อนที่อื่น — อธิบายแบบนี้เมื่อลูกค้าสงสัย):
- ผ่อนกับร้าน BESTCHOICE: สเตทเม้นท์ย้อนหลัง 3 เดือน
- ผ่อนผ่าน GFIN: รูปตอนทำงาน (เช่น ใส่ยูนิฟอร์ม/หน้างาน)
- นักศึกษา: ผ่อนได้ทั้ง 2 ช่องทาง แต่ต้องมีผู้ปกครองค้ำประกัน
รายละเอียดเชิงลึกกว่านี้ → รับเรื่องส่งต่อทีม (handoff) ห้ามเดา$OLD$,
$NEW$# เรทผ่อน 2 แบบ (ตารางมาตรฐานเจ้าของ 2026-08-14 — ตัวเลขจริงอยู่ใน get_installment_rates)
ทุกรุ่นมี 2 เรทเหมือน 2 บรรทัดบนป้ายหน้าร้าน
**กับลูกค้าเรียกแค่ "เรทที่ 1" กับ "เรทที่ 2" เท่านั้น — ห้ามบอกว่าผ่อนกับใคร/ผ่านไฟแนนซ์ไหน
(ห้ามเอ่ยคำว่า "ผ่อนกับร้าน" / ชื่อไฟแนนซ์ / GFIN กับลูกค้าเด็ดขาด)**:
- rate1 = "เรทที่ 1" — สูงสุด 12 เดือน (iPhone 12 series = 10 เดือน)
- rate2 = "เรทที่ 2" — iPhone 16 ขึ้นไปได้ถึง 15 เดือน (12 series = 10 · 13-15 = 12)
วิธีเสนอ: ได้ผลจาก get_installment_rates ให้เสนอทั้ง 2 เรทคู่กัน (ดาวน์/เดือนละ/กี่เดือน)
เช่น "เรทที่ 1 ดาวน์ 1,900 ผ่อนเดือนละ 2,566 บาท 12 งวด
     เรทที่ 2 ดาวน์ 3,400 ผ่อนเดือนละ 2,905 บาท 12 งวด สนใจเรทไหนดีคะ"
แล้วให้ลูกค้าเลือก — ตัวเลขห้ามมาจากที่อื่นนอกจาก tool
เอกสารที่ใช้ (ต่างกันตามเรท — ทั้งคู่ไม่เช็คบูโร **และไม่ต้องมีบัตรเครดิต** ใช้บัตรประชาชนเป็นหลัก
สโลแกน "บัตรประชาชนใบเดียวก็ผ่อนได้" = ไม่ต้องใช้บัตรเครดิตเหมือนผ่อนที่อื่น — อธิบายแบบนี้เมื่อลูกค้าสงสัย):
- เรทที่ 1: สเตทเม้นท์ย้อนหลัง 3 เดือน
- เรทที่ 2: รูปตอนทำงาน (เช่น ใส่ยูนิฟอร์ม/หน้างาน)
- นักศึกษา: ผ่อนได้ทั้ง 2 เรท แต่ต้องมีผู้ปกครองค้ำประกัน
รายละเอียดเชิงลึกกว่านี้ → รับเรื่องส่งต่อทีม (handoff) ห้ามเดา$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- [2] คำถามยอดฮิตเรื่องเอกสาร
UPDATE system_config
SET value = replace(value,
$OLD$- เอกสาร → ย้ำ "ไม่เช็คบูโร" + บอกตามช่องทาง: ร้าน=สเตทเม้นท์ย้อนหลัง 3 เดือน /
  GFIN=รูปตอนทำงาน / นักศึกษาผ่อนได้ทั้งคู่ (ผู้ปกครองค้ำ)$OLD$,
$NEW$- เอกสาร → ย้ำ "ไม่เช็คบูโร" + บอกตามเรท: เรทที่ 1=สเตทเม้นท์ย้อนหลัง 3 เดือน /
  เรทที่ 2=รูปตอนทำงาน / นักศึกษาผ่อนได้ทั้งคู่ (ผู้ปกครองค้ำ) — ห้ามเอ่ยชื่อร้าน/ไฟแนนซ์$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- [3] ตัวอย่าง productNote
UPDATE system_config
SET value = replace(value,
$OLD$(เช่น "iPhone 15 Plus 128GB มือสอง สั่งเข้า เรทร้าน")$OLD$,
$NEW$(เช่น "iPhone 15 Plus 128GB มือสอง สั่งเข้า เรทที่ 1")$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- [4] ปุ่มตัวเลือกตายตัว
UPDATE system_config
SET value = replace(value,
$OLD$ตัวเลือกตายตัว (มือ 1/มือสอง · ใช่/ไม่ใช่ · เรทร้าน/เรท GFIN)$OLD$,
$NEW$ตัวเลือกตายตัว (มือ 1/มือสอง · ใช่/ไม่ใช่ · เรทที่ 1/เรทที่ 2)$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- [5] KB: เอกสาร
UPDATE chat_knowledge_base SET response_template = $KBX$ไม่ต้องมีบัตรเครดิต ไม่เช็คบูโรนะคะพี่ ใช้บัตรประชาชนเป็นหลักค่า 😊

เรทที่ 1 ใช้สเตทเม้นท์ย้อนหลัง 3 เดือน
เรทที่ 2 ใช้รูปตอนทำงานค่ะ

น้องนักศึกษาก็ผ่อนได้นะคะ แค่มีผู้ปกครองค้ำให้ค่า

สะดวกแบบไหนแจ้งได้เลยนะคะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:documents_required' AND deleted_at IS NULL;

-- [6] KB: ขอผ่อนนานขึ้น
UPDATE chat_knowledge_base SET response_template = $KBX$เรทที่ 1 ผ่อนได้สูงสุด 12 เดือนค่ะ
แต่ถ้าเป็นรุ่น iPhone 16 ขึ้นไป เรทที่ 2 ผ่อนได้ถึง 15 เดือนเลยนะคะ 😊

พี่สนใจรุ่นไหนอยู่คะ เดี๋ยวเทียบทั้ง 2 เรทให้ดูเลยค่า$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_longer_term' AND deleted_at IS NULL;

-- [7] KB: แพงไป
UPDATE chat_knowledge_base SET response_template = $KBX$เข้าใจค่า 😊 ผ่อนแบ่งจ่ายสบายกว่าซื้อสดเยอะเลยนะคะ
ดาวน์เริ่มเบา ๆ ไม่เช็คบูโรด้วยค่ะ

พี่สนใจรุ่นไหนคะ เดี๋ยวคิดค่างวดให้ดูก่อน ไม่ผูกมัดค่า$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_price_too_high' AND deleted_at IS NULL;

COMMIT;

-- ตรวจผล: EXTRAS ต้องไม่เหลือ GFIN/ผ่อนกับร้าน/เรทร้าน + KB สะอาด
SELECT
  CASE WHEN value NOT LIKE '%GFIN%' AND value NOT LIKE '%ผ่อนกับร้าน%' AND value NOT LIKE '%เรทร้าน%'
       THEN 'EXTRAS ✓ ไม่เหลือชื่อช่องทาง' ELSE 'EXTRAS ✗' END,
  CASE WHEN value LIKE '%เรทที่ 1%' AND value LIKE '%เรทที่ 2%' THEN 'เรทที่ 1/2 ✓' ELSE '✗' END,
  length(value) AS len
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
SELECT count(*) AS kb_still_naming FROM chat_knowledge_base
WHERE (response_template LIKE '%GFIN%' OR response_template LIKE '%ผ่อนกับร้าน%') AND deleted_at IS NULL;
