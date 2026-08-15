-- v3.7 (2026-08-15 คำสั่งเจ้าของ + audit ก่อนเปิดเพจ):
--   (1) ถอด "ส่งของ Kerry/Flash" ออกจาก Objection ข้อ 6 — ร้านไม่มีบริการจัดส่ง
--   (2) คำถามยอดฮิต "จัดส่ง/เก็บปลายทาง" → แจ้งรับที่ร้านเท่านั้น + ชวนนัดวันเข้าร้าน
--   (3) สอน marker "[ลูกค้าส่งรูปภาพมา ...]" = ลูกค้าส่งรูป/เอกสาร — ขั้นรอเอกสารให้ถือว่าส่งเอกสารแล้ว
-- + seed KB 2 แถวเรื่องจัดส่ง/มารับที่ร้าน (ที่อยู่จริงจากแถว store_location_hours)
BEGIN;

UPDATE system_config
SET value = replace(value,
$OLD$6. "เคยซื้อแล้วโดนโกง" → เสียดายแทน; ร้านมีสาขาจริงที่ลพบุรี (หน้า บขส. สระแก้ว) เปิดมาหลายปี ส่งของ Kerry/Flash เปิดกล่องถ่ายคลิป$OLD$,
$NEW$6. "เคยซื้อแล้วโดนโกง" → เสียดายแทน; ร้านมีสาขาจริงที่ลพบุรี (หน้า บขส. สระแก้ว) เปิดมาหลายปี ชวนเข้ามาดูเครื่องจริงที่ร้านก่อนตัดสินใจได้เลย$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE system_config
SET value = replace(value,
$OLD$- จัดส่ง/เก็บปลายทาง → บอกวิธีส่ง + ย้ำว่าเปิดกล่องถ่ายคลิปได้$OLD$,
$NEW$- จัดส่ง/เก็บปลายทาง → **ร้านไม่มีบริการจัดส่ง** ลูกค้าเข้ามารับเครื่องที่หน้าร้านลพบุรีเท่านั้น (ห้ามพูดว่าส่งได้/Kerry/Flash/เก็บปลายทาง) — แจ้งแล้วชวนนัดวันเข้าร้านต่อ$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE system_config
SET value = replace(value,
$OLD$- บรรทัดประวัติที่เป็น "[รูป ...]" = รูปเครื่องที่เราส่งให้ลูกค้าแล้ว — ลูกค้าเห็นรูปนั้นอยู่
  อ้างถึงต่อได้เลย ไม่ต้องส่งซ้ำ ไม่ต้องถามว่าเห็นรูปไหม$OLD$,
$NEW$- บรรทัดประวัติที่เป็น "[รูป ...]" = รูปเครื่องที่เราส่งให้ลูกค้าแล้ว — ลูกค้าเห็นรูปนั้นอยู่
  อ้างถึงต่อได้เลย ไม่ต้องส่งซ้ำ ไม่ต้องถามว่าเห็นรูปไหม
- ข้อความ "[ลูกค้าส่งรูปภาพมา ...]" = ลูกค้าส่งรูปมาหาเรา (บอทมองรูปไม่เห็น) —
  ถ้ากำลังรอเอกสารอยู่ (ขั้น 6-7) ให้ถือว่าลูกค้าส่งเอกสารแล้ว → ตอบรับ "ได้รับแล้ว เดี๋ยวทีมเช็คให้ไวเลยนะคะ"
  แล้วเดินขั้น 7 ต่อ (ห้ามตัดสินผลเอกสาร) · บริบทอื่น → ขอบคุณแล้วถามต่อว่ารูปนี้คือรุ่นที่สนใจ/สลิปอะไรคะ
- "[ลูกค้าส่งข้อความเสียงมา ...]" = บอทฟังไม่ได้จริง ๆ → ขอโทษ + ขอให้พิมพ์เป็นข้อความแทน$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- KB: จัดส่ง/เก็บปลายทาง → รับที่ร้านเท่านั้น (idempotent — ลบของเก่า intent เดียวกันก่อน)
UPDATE chat_knowledge_base SET deleted_at = NOW() WHERE intent IN ('faq_no_delivery_pickup_only') AND deleted_at IS NULL;
INSERT INTO chat_knowledge_base
  (id, channel, category, intent, trigger_keywords, example_questions, response_template, response_type, requires_auth, active, priority, created_at, updated_at)
VALUES
  ('faq:no-delivery-pickup-only', NULL, 'FAQ', 'faq_no_delivery_pickup_only',
   ARRAY['จัดส่ง','ส่งของ','ส่งได้ไหม','ส่งต่างจังหวัด','เก็บปลายทาง','ปลายทาง','ems','ไปรษณีย์','kerry','flash','มารับ','รับเครื่อง','รับของ'],
   ARRAY['ส่งของได้ไหม','เก็บเงินปลายทางได้ไหม','ส่งต่างจังหวัดไหม','ต้องไปรับที่ร้านไหม'],
   E'ตอนนี้ร้านยังไม่มีบริการจัดส่งนะคะ ลูกค้าเข้ามารับเครื่องที่หน้าร้านได้เลยค่า\n\nร้านอยู่เส้นหลัง บขส สระแก้วลพบุรี ตรงข้ามชาบูแม็คซิโกค่ะ\nแผนที่ 🗺️ https://maps.app.goo.gl/bqGcmr5FupWLw1378\nเปิดทุกวัน 10 โมงเช้าถึง 1 ทุ่มค่ะ\n\nรับเครื่องที่ร้านได้เช็คสภาพเครื่องต่อหน้าก่อนรับเลยนะคะ',
   'auto', false, true, 90, NOW(), NOW());

COMMIT;

SELECT
  CASE WHEN value NOT LIKE '%Kerry/Flash%' THEN '✓ Kerry/Flash หายแล้ว' ELSE '✗' END AS kerry,
  CASE WHEN value LIKE '%ร้านไม่มีบริการจัดส่ง** ลูกค้าเข้ามารับเครื่องที่หน้าร้านลพบุรีเท่านั้น%' THEN '✓ จัดส่ง=รับที่ร้าน' ELSE '✗' END AS deliver,
  CASE WHEN value LIKE '%[ลูกค้าส่งรูปภาพมา ...]%' THEN '✓ marker รูปลูกค้า' ELSE '✗' END AS img_marker,
  length(value) AS len
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
SELECT intent, active FROM chat_knowledge_base WHERE intent = 'faq_no_delivery_pickup_only' AND deleted_at IS NULL;
