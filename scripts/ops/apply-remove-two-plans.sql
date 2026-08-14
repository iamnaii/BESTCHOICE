-- ถอดโครง "2 แบบ (ดาวน์น้อย 10 เดือน+สลิป / ดาวน์สูง 12 เดือน)" ที่เลิกใช้แล้ว
-- ออกจากทุกคำตอบ (owner ยืนยัน 2026-08-14) — interim จนกว่าตารางเทอมมาตรฐานจะมา:
-- ไม่พูดโครงเทอมตายตัว ให้ชี้ไปที่ "คิดเรทตามรุ่น" แทน
BEGIN;

UPDATE chat_knowledge_base SET response_template = $KBX$ผ่อนสบาย ๆ ได้เลยค่ะพี่ ใช้บัตรประชาชนใบเดียว ไม่เช็คบูโรค่า
เทอมผ่อนขึ้นกับรุ่นนะคะ

พี่สนใจรุ่นไหนอยู่คะ เดี๋ยวคิดเรทให้ดูเลยค่า 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:installment_terms' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ใช้บัตรประชาชนใบเดียวเลยค่ะพี่ ไม่เช็คบูโรค่า 😊
สะดวกส่งเอกสารให้เช็คเลยมั้ยคะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:documents_required' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ดาวน์เริ่มได้เบา ๆ เลยค่ะพี่ 😊
เดี๋ยวเบสคิดให้ดูว่ารุ่นที่พี่สนใจ ดาวน์เท่าไหร่ ผ่อนเดือนละเท่าไหร่

พี่สนใจรุ่นไหนอยู่คะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_down_payment' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เข้าใจค่า 😊 ผ่อนกับร้านแบ่งจ่ายสบายกว่าซื้อสดเยอะเลยนะคะ
ดาวน์เริ่มเบา ๆ ไม่เช็คบูโรด้วยค่ะ

พี่สนใจรุ่นไหนคะ เดี๋ยวคิดค่างวดให้ดูก่อน ไม่ผูกมัดค่า$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_price_too_high' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เข้าใจค่า 😊 ที่ BESTCHOICE ต่างจากที่อื่นนะคะ

ไม่เช็คบูโร ใช้บัตรประชาชนใบเดียว
อนุมัติไว รับเครื่องได้เลย
เครื่องแท้ 100% ทุกเครื่อง มีหน้าร้านจริงที่ลพบุรีค่ะ

พี่สนใจรุ่นไหนคะ เดี๋ยวเทียบค่างวดให้ดูเลยค่า$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_competitor_finance' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เทอมผ่อนขึ้นกับรุ่นเลยค่ะพี่ 😊
พี่สนใจรุ่นไหนอยู่คะ เดี๋ยวเช็คเทอมยาวสุดของรุ่นนั้นให้ค่า$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_longer_term' AND deleted_at IS NULL;

-- ถอดโครง 2 แบบออกจาก BOT_EXTRAS (บล็อกลำดับถาม + qualification ที่ยกตัวอย่างแบบผ่อน)
UPDATE system_config
SET value = replace(value,
$OLD$  แบบผ่อน (ดาวน์น้อย 10 เดือน / ดาวน์สูง 12 เดือน) · คำถามใช่-ไม่ใช่$OLD$,
$NEW$  แบบผ่อน (ตามเรทของรุ่นนั้น) · คำถามใช่-ไม่ใช่$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

SELECT count(*) AS still_mention_old_plans FROM chat_knowledge_base
WHERE category IN ('EXTRACTED','EXTRACTED_OBJECTION') AND deleted_at IS NULL
  AND (response_template LIKE '%สลิปเงินเดือน%' OR response_template LIKE '%2 แบบ%'
       OR response_template LIKE '%10 เดือน%');
