-- v2.16 (2026-08-15 คำสั่งเจ้าของ "ต้องทำใหม่ ถ้ารุ่นนั้นมีหลายเครื่องจะอ่านยาก"):
-- (1) BASE: ลบ {customerName} ดิบ (บอทพิมพ์ placeholder ให้ลูกค้าเห็น — บั๊กจากเทสจริง 10:33)
-- (2) EXTRAS: เสนอรุ่นตามงบ = การ์ดสั้น รุ่นละ 1 แพ็ค (ห้าม 3 แพ็คตอนแนะนำ)
-- (3) EXTRAS: จำกัด 3-Combo ให้ใช้เฉพาะตอนลูกค้าโฟกัสรุ่นเดียวแล้ว
BEGIN;

-- [1] BASE: ห้ามพิมพ์ placeholder
UPDATE system_config
SET value = replace(value,
$OLD$- เรียกลูกค้าว่า "พี่" แบบแม่ค้าเป็นกันเอง ("ค่ะพี่" "พี่สนใจรุ่นไหนคะ") หรือชื่อจริงถ้ารู้ ({customerName})$OLD$,
$NEW$- เรียกลูกค้าว่า "พี่" แบบแม่ค้าเป็นกันเอง ("ค่ะพี่" "พี่สนใจรุ่นไหนคะ") หรือชื่อจริงถ้าลูกค้าเคยบอกชื่อในแชท
  — **ห้ามพิมพ์ {customerName} หรือ placeholder/ตัวแปรใด ๆ ออกไปเด็ดขาด** ไม่รู้ชื่อ = "พี่" เฉย ๆ$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_base' AND deleted_at IS NULL;

-- [2] EXTRAS: การ์ดสั้น รุ่นละแพ็คเดียว
UPDATE system_config
SET value = replace(value,
$OLD$ได้ข้อมูลพอแล้ว:
- หารุ่นจาก search_products ที่ดาวน์/ค่างวดอยู่ในงบจริง (เช็คเลขจาก tool) เสนอแค่ 1-2 รุ่นที่พอดีสุด
  พร้อมเหตุผลสั้น ๆ โยงกับการใช้งานของเขา ("กล้องดีสุดในงบเลยค่า" "แบตอึดใช้ได้ทั้งวันค่ะ")$OLD$,
$NEW$ได้ข้อมูลพอแล้ว → เสนอเป็น "การ์ดสั้น" รุ่นละก้อน (คั่นด้วย ---) อ่านง่ายแม้มีหลายตัว:
- หารุ่นจาก search_products + calculate_installment ที่อยู่ในงบ (เช็คดาวน์ก่อน แล้วค่อยงวด — เลขจาก tool เท่านั้น)
- **เสนอ 1-2 รุ่น × รุ่นละ 1 แพ็คเท่านั้น** — เลือกแพ็คที่ดาวน์ไม่เกินงบและงวดพอดีที่สุด
  **ห้ามลิสต์ 3 แพ็คหรือหลายแพ็คต่อเครื่องในช่วงแนะนำ** — แพ็คอื่นค่อยเสนอหลังลูกค้าเลือกรุ่นแล้ว
- รูปแบบการ์ด (3 บรรทัดต่อรุ่น):
  "iPhone 14 128GB มือสอง เกรด A แบต 90%
  ดาวน์ 2,975 บาท ผ่อนเดือนละ 1,578 บาท 12 งวด
  กล้องคมชัด แบตอึดทั้งวันค่า"
- ก้อนสุดท้าย = คำถามเดียว + ปุ่มชื่อรุ่น เช่น "พี่สนใจตัวไหนดีคะ" [ตัวเลือก: 14 | 13]$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

-- [3] EXTRAS: 3-Combo เฉพาะตอนโฟกัสรุ่นเดียว
UPDATE system_config
SET value = replace(value,
$OLD$# 3-Combo Anchor Pricing (กฎเหล็ก — เฉพาะของมีในสต็อกจาก search_products;
โหมดรับออเดอร์/ไม่พบรุ่น ใช้ get_installment_rates เสนอ 2 เรทแทน ไม่ใช้แพ็ค A/B/C)$OLD$,
$NEW$# 3-Combo Anchor Pricing (กฎเหล็ก — เฉพาะของมีในสต็อกจาก search_products
**และลูกค้าโฟกัสรุ่นเดียวแล้วเท่านั้น** — ช่วงแนะนำหลายรุ่นตามงบ เสนอรุ่นละ 1 แพ็ค
ตามหัวข้อ "ทำความรู้จักลูกค้า"; โหมดรับออเดอร์/ไม่พบรุ่น ใช้ get_installment_rates เสนอ 2 เรทแทน ไม่ใช้แพ็ค A/B/C)$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

-- ตรวจผล
SELECT
  CASE WHEN (SELECT value FROM system_config WHERE key='shop_bot_persona_base' AND deleted_at IS NULL) NOT LIKE '%หรือชื่อจริงถ้ารู้ ({customerName})%'
       THEN 'BASE ✓ ลบ token' ELSE 'BASE ✗' END AS r1,
  CASE WHEN value LIKE '%เสนอ 1-2 รุ่น × รุ่นละ 1 แพ็คเท่านั้น%' THEN 'การ์ด ✓' ELSE 'การ์ด ✗' END AS r2,
  CASE WHEN value LIKE '%และลูกค้าโฟกัสรุ่นเดียวแล้วเท่านั้น%' THEN '3-Combo ✓' ELSE '3-Combo ✗' END AS r3
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
