-- v3.8 (2026-08-16 เก็บงานก่อนเปิดเพจ — จาก launch audit):
--   (1) "พร้อมส่ง" ทุกจุด → "พร้อมรับที่ร้าน" (คำว่าพร้อมส่งชวนลูกค้าเปิดประเด็นจัดส่ง)
--   (2) Persona hook เลิกแนะ Android/Samsung/POCO — ร้านขายแต่ iPhone
--   (3) Objection 4 เลิกยืนยันเรื่อง "ดอก" + เลิกทวนชื่อไฟแนนซ์คู่แข่ง
--   (4) สคริปต์ "ฝ่ายไฟแนนซ์" → "ทีมงาน" (กันชนกฎห้ามเอ่ยไฟแนนซ์)
--   (5) ทางลงคำถาม "ผ่อนจบรวมเท่าไหร่" (เดิมไม่มีสคริปต์ = เงียบ/วน)
--   (6) ราคาในบันทึก/ประวัติเก่ากว่า 2 วัน ต้องเรียก tool ใหม่ก่อนทวน
BEGIN;

-- (1) พร้อมส่ง → พร้อมรับที่ร้าน (ครอบ "มีของพร้อมส่ง" ทุก occurrence: กฎเสนอ, กฎห้าม, ตัวอย่างการ์ด)
UPDATE system_config SET value = replace(value, $O$มีของพร้อมส่ง$O$, $N$มีของพร้อมรับที่ร้าน$N$), updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE system_config SET value = replace(value, $O$128GB พร้อมส่งค่า ผ่อนเดือนละ$O$, $N$128GB พร้อมรับที่ร้านเลยค่า ผ่อนเดือนละ$N$), updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

UPDATE system_config SET value = replace(value, $O$มีพร้อมส่งไหมดูจาก search_products$O$, $N$มีพร้อมรับที่ร้านไหมดูจาก search_products$N$), updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- (2) Persona hooks — iPhone เท่านั้น
UPDATE system_config SET value = replace(value,
$O$- A · ไรเดอร์/Gig Worker: พิมพ์สั้น มี slang ("งิ" "555") — เน้นแบต/GPS/ทนทาน → Android รุ่นประหยัด-รุ่นกลาง หรือ iPhone มือ 2
- B · แม่ค้าออนไลน์: สุภาพ ถามรายละเอียด — เน้นกล้อง/จอ/ความจุ → iPhone หรือ Samsung รุ่นกลาง-เรือธง
- C · นักศึกษา/First Jobber: emoji เยอะ ("5555" "ค้าบ") — เน้นเล่นเกม/ดูเท่ → iPhone ปีก่อน, POCO, Samsung มือ 2$O$,
$N$- A · ไรเดอร์/Gig Worker: พิมพ์สั้น มี slang ("งิ" "555") — เน้นแบต/ทนทาน → iPhone มือสองรุ่นแบตอึด (เช่น 13/14 มือสอง)
- B · แม่ค้าออนไลน์: สุภาพ ถามรายละเอียด — เน้นกล้อง/จอ/ความจุ → iPhone รุ่นกลางถึง Pro
- C · นักศึกษา/First Jobber: emoji เยอะ ("5555" "ค้าบ") — เน้นเล่นเกม/ดูเท่ → iPhone ปีก่อน/มือสองราคาเบา$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- (3) Objection 4 — ไม่ยืนยันเรื่องดอก ไม่ทวนชื่อคู่แข่ง
UPDATE system_config SET value = replace(value,
$O$4. "Samsung Finance+ ดอกถูกกว่า" → ใช่ แต่ต้องมีสลิป+เครดิตดี รออนุมัติ 1-3 วัน; ที่ร้านอนุมัติ 5 นาที$O$,
$N$4. ลูกค้าอ้างไฟแนนซ์อื่นถูกกว่า → ห้ามยืนยัน/ปฏิเสธเรื่องดอก และห้ามทวนชื่อเจ้านั้น — ชูจุดแข็งเรา: "ที่โน่นต้องมีสลิปเงินเดือน เครดิตดี รออนุมัติ 1-3 วันค่ะ ของเราบัตรประชาชนใบเดียว ไม่เช็คบูโร รู้ผลไวใน 5 นาทีค่า"$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- (4) ฝ่ายไฟแนนซ์ → ทีมงาน — string เดียวกันอยู่ทั้งใน BASE และ EXTRAS: ครอบทั้ง 2 แถว
UPDATE system_config SET value = replace(value,
$O$"เดี๋ยวส่งให้ฝ่ายไฟแนนซ์เช็คให้ก่อนนะคะ"$O$,
$N$"เดี๋ยวส่งให้ทีมงานเช็คให้ก่อนนะคะ"$N$),
    updated_at = NOW()
WHERE key IN ('shop_bot_persona_bot_extras', 'shop_bot_persona_base') AND deleted_at IS NULL;

-- (5) ทางลง "ผ่อนจบรวมเท่าไหร่" — ต่อท้าย Objection 7
UPDATE system_config SET value = replace(value,
$O$ยังไม่มีผล tool เลย → **ถามงบดาวน์ก่อน** (เส้นทางรอง) ไม่ใช่เด้งถามรุ่น$O$,
$N$ยังไม่มีผล tool เลย → **ถามงบดาวน์ก่อน** (เส้นทางรอง) ไม่ใช่เด้งถามรุ่น
   · ลูกค้าถาม "ผ่อนจบรวมทั้งหมดเท่าไหร่" → ทวนดาวน์+ค่างวด+จำนวนงวดจากผล tool แล้วปิดว่า "ยอดสรุปทั้งสัญญาเดี๋ยวทีมงานสรุปให้ตอนทำเรื่องที่ร้านเลยนะคะ ตัวเลขชัวร์กว่าค่า" — ห้ามคูณรวมเอง$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- (6) ราคาเก่าเกิน 2 วัน ต้องเรียก tool ใหม่ — ต่อท้าย section สมุดความจำ
UPDATE system_config SET value = replace(value,
$O$- บันทึกขัดกับข้อความล่าสุดของลูกค้า → เชื่อข้อความล่าสุดของลูกค้าเสมอ แล้วคุยตามนั้น$O$,
$N$- บันทึกขัดกับข้อความล่าสุดของลูกค้า → เชื่อข้อความล่าสุดของลูกค้าเสมอ แล้วคุยตามนั้น
- ราคา/เรท/ค่างวดที่อยู่ในบันทึกหรือบทสนทนาที่**เก่ากว่า 2 วัน** ห้ามทวนซ้ำตรง ๆ —
  เรียก get_installment_rates/calculate_installment ใหม่ก่อนเสมอ (เรทร้านเปลี่ยนได้)$N$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- config: ตัดช่องผี WEB + TIKTOK ออกจาก autoChannels · แคป 300→100 (เทสหนักสุดที่เห็นจริง
-- 40/คน/วัน ×2.5; worst case 10 ห้องลูป ≈ $11/วัน = ชน budget alarm พอดี ไม่บานปลาย)
UPDATE system_config SET value = '["LINE_SHOP","FACEBOOK"]', updated_at = NOW()
WHERE key = 'ai.autoChannels' AND deleted_at IS NULL;
UPDATE system_config SET value = '100', updated_at = NOW()
WHERE key = 'ai.autoMaxRepliesPerSession' AND deleted_at IS NULL;

COMMIT;

SELECT
  CASE WHEN value NOT LIKE '%มีของพร้อมส่ง%' AND value NOT LIKE '%พร้อมส่งค่า%' THEN '✓ พร้อมส่งหมด' ELSE '✗ ยังมีพร้อมส่ง' END AS ready_stock,
  CASE WHEN value NOT LIKE '%POCO%' AND value NOT LIKE '%Android รุ่นประหยัด%' AND value NOT LIKE '%Samsung รุ่นกลาง%' THEN '✓ iPhone-only' ELSE '✗' END AS persona,
  CASE WHEN value NOT LIKE '%Samsung Finance+ ดอกถูกกว่า%' THEN '✓ obj4 ใหม่' ELSE '✗' END AS obj4,
  CASE WHEN value NOT LIKE '%ฝ่ายไฟแนนซ์เช็คให้%' THEN '✓ ทีมงาน(extras)' ELSE '✗' END AS team,
  CASE WHEN value LIKE '%ผ่อนจบรวมทั้งหมดเท่าไหร่%' THEN '✓ ทางลงยอดรวม' ELSE '✗' END AS total_q,
  CASE WHEN value LIKE '%เก่ากว่า 2 วัน** ห้ามทวนซ้ำตรง ๆ%' THEN '✓ price-age' ELSE '✗' END AS price_age
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
SELECT key, value FROM system_config WHERE key IN ('ai.autoChannels','ai.autoMaxRepliesPerSession');
SELECT CASE WHEN value NOT LIKE '%ฝ่ายไฟแนนซ์เช็คให้%' THEN '✓ ทีมงาน(base)' ELSE '✗ base ยังมีฝ่ายไฟแนนซ์' END AS base_team
FROM system_config WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;
