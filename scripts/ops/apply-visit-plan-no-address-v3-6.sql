-- v3.6 (2026-08-15 คำสั่งเจ้าของจากเทสสด): ขั้น 7 ใหม่ —
--   (1) หลังรับเอกสาร ถาม "แผนเข้ามาที่ร้าน/ช่วงที่วางแผนซื้อ" ก่อน
--   (2) แล้วค่อยขอชื่อ+เบอร์
--   (3) ห้ามถามที่อยู่จัดส่งเด็ดขาด — ร้านไม่มีบริการจัดส่ง ลูกค้ารับเครื่องที่ร้าน
BEGIN;

UPDATE system_config
SET value = replace(value,
$OLD$## ขั้น 7 — ชื่อ + เบอร์ → capture_lead$OLD$,
$NEW$## ขั้น 7 — แผนเข้าร้าน → ชื่อ + เบอร์ → capture_lead$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE system_config
SET value = replace(value,
$OLD$- ลูกค้าส่งเอกสารมา → ตอบรับตามกฎความปลอดภัย ("ได้รับแล้ว เดี๋ยวทีมเช็คให้ไวเลยนะคะ" — ห้ามตัดสินผลเอกสาร) **แล้วขอชื่อ+เบอร์ต่อในเทิร์นเดียวกันได้เลย** — กฎความปลอดภัยห้ามเฉพาะการตัดสินผล ไม่ได้ห้ามเดินขั้นนี้ต่อ$OLD$,
$NEW$- ลูกค้าส่งเอกสารมา → ตอบรับตามกฎความปลอดภัย ("ได้รับแล้ว เดี๋ยวทีมเช็คให้ไวเลยนะคะ" — ห้ามตัดสินผลเอกสาร) **แล้วถามแผนเข้าร้านต่อในเทิร์นเดียวกันได้เลย** (คำถามเดียว เช่น "พี่วางแผนเข้ามารับเครื่องที่ร้านวันไหนคะ" / ลูกค้ายังไม่แน่ใจวัน → "ประมาณว่าวางแผนซื้อช่วงไหนคะ") — กฎความปลอดภัยห้ามเฉพาะการตัดสินผล ไม่ได้ห้ามเดินขั้นนี้ต่อ$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE system_config
SET value = replace(value,
$OLD$- ขอ ชื่อ + เบอร์ + ที่อยู่ส่ง (ที่อยู่ optional — ได้แค่ชื่อ+เบอร์ก็ยอม) → เรียก capture_lead ตาม signature ในหัวข้อความปลอดภัย (ทีมเช็คเอกสารแล้วติดต่อกลับ อนุมัติไวใน 5 นาที)$OLD$,
$NEW$- เทิร์นถัดไปขอ ชื่อ + เบอร์ (คำถามเดียว) → เรียก capture_lead ตาม signature ในหัวข้อความปลอดภัย (แผนเข้าร้านที่ลูกค้าบอกใส่ช่อง visitPlan; ทีมเช็คเอกสารแล้วติดต่อกลับ อนุมัติไวใน 5 นาที)
- **ห้ามถามที่อยู่จัดส่งเด็ดขาด — ร้านไม่มีบริการจัดส่ง ลูกค้าต้องเข้ามารับเครื่องที่ร้าน** (ลูกค้าถามเรื่องจัดส่ง/เก็บปลายทาง → ตอบตามคลังคำตอบในหัวข้อคำถามเชิงนโยบาย ห้ามตอบจากความจำ)$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE system_config
SET value = replace(value,
$OLD$แต่ยังต้องเดินขั้น 7 ต่อในเทิร์นเดียวกัน: ขอชื่อ+เบอร์ → capture_lead)$OLD$,
$NEW$แต่ยังต้องเดินขั้น 7 ต่อในเทิร์นเดียวกัน: ถามแผนเข้าร้าน → แล้วค่อยชื่อ+เบอร์ → capture_lead)$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

SELECT
  CASE WHEN value LIKE '%แผนเข้าร้าน → ชื่อ + เบอร์%' THEN '✓ หัวข้อขั้น 7' ELSE '✗ หัวข้อ' END AS h,
  CASE WHEN value LIKE '%แล้วถามแผนเข้าร้านต่อในเทิร์นเดียวกัน%' THEN '✓ ถามแผนก่อน' ELSE '✗ แผน' END AS plan,
  CASE WHEN value LIKE '%ห้ามถามที่อยู่จัดส่งเด็ดขาด%' THEN '✓ ห้ามถามที่อยู่' ELSE '✗ ที่อยู่' END AS addr,
  CASE WHEN value LIKE '%ถามแผนเข้าร้าน → แล้วค่อยชื่อ+เบอร์%' THEN '✓ กฎความปลอดภัย sync' ELSE '✗ safety' END AS safety,
  CASE WHEN value NOT LIKE '%ที่อยู่ส่ง (ที่อยู่ optional%' THEN '✓ ข้อความเก่าหายแล้ว' ELSE '✗ เก่ายังอยู่' END AS old_gone,
  length(value) AS len
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
