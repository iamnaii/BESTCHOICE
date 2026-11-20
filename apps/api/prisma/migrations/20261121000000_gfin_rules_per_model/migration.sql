-- ตัวคำนวณไม่เคยใช้กติการายรุ่นที่ปิดใช้ (is_active = false) — ลบแบบกู้คืนได้ก่อน ค่าที่ใช้จริงจึงไม่เปลี่ยน
-- (ไม่งั้น NOT EXISTS ด้านล่างเห็นแถวปิดแล้วข้ามการสร้าง แล้วกลุ่มถูกลบ ⇒ คู่นั้นเสียกติกา และ unique index จะชน)
-- Engine never uses inactive rules: soft-deleting them keeps effective values unchanged and avoids unique-index conflicts.
UPDATE gfin_overprice_rules
SET deleted_at = now(), updated_at = now()
WHERE deleted_at IS NULL AND is_active = false AND series_pattern NOT LIKE '%|%';
-- statement-break
-- สเปก 2026-11-20 §3.2 — แปลงกติกา GFIN แบบกลุ่ม (series_pattern มี '|') เป็นหนึ่งแถวต่อ (รุ่น, สภาพ)
-- เลือกกติกาด้วยวิธีเดียวกับ findGfinOverpriceRule: เปิดใช้ · ไม่ถูกลบ · สภาพตรง · มีรุ่นนี้ในรายการ · รุ่นน้อยสุดชนะ (เท่ากัน = สร้างก่อน)
-- สร้างเฉพาะคู่ที่มีแถวราคา (gfin_variant IS NULL ไม่ถูกลบ) · คู่ที่มีกติการายรุ่นอยู่แล้วไม่แตะ · รันซ้ำได้
WITH pairs AS (
  SELECT DISTINCT m.gfin_series AS series, m.condition
  FROM gfin_model_mappings m
  WHERE m.deleted_at IS NULL AND m.gfin_variant IS NULL
),
candidates AS (
  SELECT p.series, p.condition, r.allowance, r.max_months, r.min_down_pct, r.created_at,
         cardinality(string_to_array(r.series_pattern, '|')) AS size
  FROM pairs p
  JOIN gfin_overprice_rules r
    ON r.condition = p.condition
   AND r.deleted_at IS NULL
   AND r.is_active = true
   AND p.series IN (SELECT btrim(s) FROM unnest(string_to_array(r.series_pattern, '|')) AS s)
),
best AS (
  SELECT DISTINCT ON (series, condition) *
  FROM candidates
  ORDER BY series, condition, size ASC, created_at ASC
)
INSERT INTO gfin_overprice_rules
  (id, label, series_pattern, condition, allowance, max_months, min_down_pct, is_active, created_at, updated_at)
SELECT gen_random_uuid()::text,
       b.series || CASE WHEN b.condition = 'HAND_1' THEN ' มือ 1' ELSE ' มือ 2' END,
       b.series, b.condition, b.allowance, b.max_months, b.min_down_pct, true, now(), now()
FROM best b
WHERE b.size > 1
  AND NOT EXISTS (
    SELECT 1 FROM gfin_overprice_rules x
    WHERE x.deleted_at IS NULL AND x.series_pattern = b.series AND x.condition = b.condition
  );
-- statement-break
-- กติกากลุ่มเดิมลบแบบกู้คืนได้ (ถังขยะจะไม่ให้กู้กลับ — trash-registry ด่าน '|')
UPDATE gfin_overprice_rules
SET deleted_at = now(), updated_at = now()
WHERE deleted_at IS NULL AND series_pattern LIKE '%|%';
-- statement-break
-- หนึ่งกติกาที่ยังไม่ลบต่อ (รุ่น, สภาพ) — Prisma เขียน partial unique ไม่ได้ (precedent products_imei_serial_active_unique)
CREATE UNIQUE INDEX IF NOT EXISTS "gfin_overprice_rules_one_per_series"
  ON "gfin_overprice_rules" ("series_pattern", "condition")
  WHERE "deleted_at" IS NULL;
