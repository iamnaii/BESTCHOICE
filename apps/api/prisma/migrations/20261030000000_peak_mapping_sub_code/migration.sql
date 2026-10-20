-- FINANCE mapping v5 (ฝ่ายบัญชี 19/10/2569 — "สิ่งที่ต้องแจ้งโปรแกรม MAPPING" 2026-10-20)
-- 1) ผังบัญชีรู้จัก "รหัสย่อย PEAK" + "แหล่งรหัสย่อย" (none|fixed|contact|bank|cashbox)
-- 2) บัญชีที่ไม่มีในระบบ เพิ่มตามไฟล์ (ON CONFLICT DO NOTHING — ไม่ทับแถวที่เจ้าของเพิ่มไว้แล้ว)
-- 3) 42-1107 เปิดใช้ใหม่ในชื่อ "ส่วนลดรับ" (prod มีแถวที่ soft-delete ไว้ตั้งแต่ 2026-08-03 ⇒ UPDATE ฟื้น · ไม่มีแถว ⇒ INSERT)
-- 4) ผูกทุกบัญชีกับรหัส PEAK + รหัสย่อยตามไฟล์ (แถวที่ไฟล์ไม่ให้รหัส เช่น 11-2106 / 41-1101 คงว่าง)
-- 5) ชื่อ/สถานะที่ไฟล์สั่ง: 53-1304 ค่าไปรษณีย์ · 53-1306 ค่าขนส่ง (เปิดใช้) · 55-1101..1105 ปิดใช้ (ย้ายไป 11-6101..6105 — ไม่มีโค้ดอ้างอิง · prod ไม่มีบรรทัดบัญชี)
-- Idempotent — รันซ้ำได้.

ALTER TABLE "chart_of_accounts"
  ADD COLUMN IF NOT EXISTS "peak_sub_code" TEXT;
ALTER TABLE "chart_of_accounts"
  ADD COLUMN IF NOT EXISTS "peak_sub_code_source" TEXT NOT NULL DEFAULT 'none';

INSERT INTO "chart_of_accounts"
  ("id", "code", "name", "type", "normalBalance", "category", "vatApplicable", "notes", "status", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, '11-1401', 'เงินลงทุนชั่วคราว - ทองคำ', 'สินทรัพย์', 'Dr', 'เงินลงทุน', FALSE, 'เพิ่มตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 112202 ลงทุนทอง)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '11-4104', 'สำรองจ่ายภาษีหัก ณ ที่จ่าย รอหักคืน (LINE)', 'สินทรัพย์', 'Dr', 'ภาษี', FALSE, 'จ่ายล่วงหน้าแทน LINE แล้วรับคืนเป็นส่วนลดรอบถัดไป — เพิ่มตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 113105 รหัสย่อย = ผู้ติดต่อ)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '11-6101', 'ภาษีจ่ายแทน SHOP - ภ.พ.30', 'สินทรัพย์', 'Dr', 'สำรองจ่ายแทน SHOP', FALSE, 'สำรองจ่ายแทนกิจการที่ยังไม่ได้คืนเงิน — ย้ายจาก 55-1101 ตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 212203 รหัสย่อย ADV001)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '11-6102', 'ภาษีจ่ายแทน SHOP - ภ.พ.36', 'สินทรัพย์', 'Dr', 'สำรองจ่ายแทน SHOP', FALSE, 'สำรองจ่ายแทนกิจการที่ยังไม่ได้คืนเงิน — ย้ายจาก 55-1102 ตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 212203 รหัสย่อย ADV001 · เดิม 540109)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '11-6103', 'ภาษีจ่ายแทน SHOP - ภ.ง.ด.1', 'สินทรัพย์', 'Dr', 'สำรองจ่ายแทน SHOP', FALSE, 'สำรองจ่ายแทนกิจการที่ยังไม่ได้คืนเงิน — ย้ายจาก 55-1103 ตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 212203 รหัสย่อย ADV001)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '11-6104', 'ภาษีจ่ายแทน SHOP - ภ.ง.ด.3', 'สินทรัพย์', 'Dr', 'สำรองจ่ายแทน SHOP', FALSE, 'สำรองจ่ายแทนกิจการที่ยังไม่ได้คืนเงิน — ย้ายจาก 55-1104 ตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 212203 รหัสย่อย ADV001 · เดิม 540107)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '11-6105', 'ภาษีจ่ายแทน SHOP - ภ.ง.ด.53', 'สินทรัพย์', 'Dr', 'สำรองจ่ายแทน SHOP', FALSE, 'สำรองจ่ายแทนกิจการที่ยังไม่ได้คืนเงิน — ย้ายจาก 55-1105 ตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 212203 รหัสย่อย ADV001 · เดิม 540108)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '42-1107', 'ส่วนลดรับ', 'รายได้', 'Cr', 'รายได้อื่น', FALSE, 'ส่วนลดจากผู้ขาย — รหัสเปิดใช้ใหม่ตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 510301 เริ่ม ต.ค.) · คนละความหมายกับ "รายได้ค่าปรับยกเลิกเปลี่ยนเครื่อง" ที่ถูกลบ 2026-08-03', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '42-1109', 'รายได้ คชจ ทางภาษี (SHOP คืนเงิน)', 'รายได้', 'Cr', 'รายได้อื่น', FALSE, 'เพิ่มตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 420113)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '53-1307', 'อุปกรณ์ซ่อมบำรุง', 'ค่าใช้จ่าย', 'Dr', 'OpEx-สถานที่', TRUE, 'เพิ่มตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 530214)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '53-1407', 'ค่าโฆษณา Google Adwords', 'ค่าใช้จ่าย', 'Dr', 'OpEx-วิชาชีพ', FALSE, 'เพิ่มตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 520201)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '53-1408', 'ค่าบริการคลาวด์ / โฮสติ้ง', 'ค่าใช้จ่าย', 'Dr', 'OpEx-วิชาชีพ', FALSE, 'เพิ่มตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 530306 ค่าบริการคลาวด์เซอร์วิซ)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '53-1801', 'ค่าเช่าสำนักงาน', 'ค่าใช้จ่าย', 'Dr', 'OpEx-เช่าและประกัน', FALSE, 'เพิ่มตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 530201)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '53-1802', 'ค่าประกันภัย (รถ/ทรัพย์สิน)', 'ค่าใช้จ่าย', 'Dr', 'OpEx-เช่าและประกัน', TRUE, 'เพิ่มตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 530218 ค่าประกันภัยอุปกรณ์สำนักงาน)', 'ใช้งาน', NOW(), NOW()),
  (gen_random_uuid()::text, '54-1105', 'ภาษีซื้อไม่ขอคืน', 'ค่าใช้จ่าย', 'Dr', 'รายจ่ายต้องห้าม', FALSE, 'เพิ่มตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 540201)', 'ใช้งาน', NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;

-- 42-1107: แถวเดิม (ค่าปรับยกเลิกเปลี่ยนเครื่อง · soft-deleted 2026-08-03) ฟื้นเป็นบัญชีใหม่ "ส่วนลดรับ"
UPDATE "chart_of_accounts"
SET "deletedAt" = NULL,
    "status" = 'ใช้งาน',
    "name" = 'ส่วนลดรับ',
    "type" = 'รายได้',
    "normalBalance" = 'Cr',
    "category" = 'รายได้อื่น',
    "vatApplicable" = FALSE,
    "notes" = 'ส่วนลดจากผู้ขาย — รหัสเปิดใช้ใหม่ตามฝ่ายบัญชี FINANCE mapping v5 19/10/2569 (PEAK 510301 เริ่ม ต.ค.) · คนละความหมายกับ "รายได้ค่าปรับยกเลิกเปลี่ยนเครื่อง" ที่ถูกลบ 2026-08-03',
    "updatedAt" = NOW()
WHERE "code" = '42-1107';

UPDATE "chart_of_accounts"
SET "name" = 'ค่าไปรษณีย์', "updatedAt" = NOW()
WHERE "code" = '53-1304' AND "name" <> 'ค่าไปรษณีย์';

UPDATE "chart_of_accounts"
SET "name" = 'ค่าขนส่ง',
    "status" = 'ใช้งาน',
    "vatApplicable" = TRUE,
    "notes" = 'เปลี่ยนชื่อเป็น ค่าขนส่ง + เปิดใช้ใหม่ (ฝ่ายบัญชี FINANCE mapping v5 19/10/2569 PEAK 530215) — เดิม "ค่าซ่อมเครื่องลูกค้า" (SP5 ซ่อมลูกค้าใช้ S51-1105 แล้ว)',
    "updatedAt" = NOW()
WHERE "code" = '53-1306';

UPDATE "chart_of_accounts"
SET "status" = 'ไม่ใช้งาน',
    "notes" = COALESCE("notes" || ' · ', '') || 'ปิดใช้ 2026-10-20 — ย้ายไป ' || REPLACE("code", '55-11', '11-61') || ' (ฝ่ายบัญชี FINANCE mapping v5 19/10/2569)',
    "updatedAt" = NOW()
WHERE "code" IN ('55-1101', '55-1102', '55-1103', '55-1104', '55-1105')
  AND "status" <> 'ไม่ใช้งาน';

-- ผูกรหัส PEAK / รหัสย่อย / แหล่งรหัสย่อย
UPDATE "chart_of_accounts" AS c
SET "peak_code" = v.peak_code,
    "peak_sub_code" = v.peak_sub_code,
    "peak_sub_code_source" = v.peak_sub_code_source,
    "updatedAt" = NOW()
FROM (VALUES
  ('11-1101', '111101', 'CSH001', 'fixed'),
  ('11-1102', '111101', 'CSH002', 'fixed'),
  ('11-1103', '111101', 'CSH003', 'fixed'),
  ('11-1201', '111301', 'BSV001', 'fixed'),
  ('11-1202', '111301', 'BSV002', 'fixed'),
  ('11-1203', '111301', 'BSV003', 'fixed'),
  ('11-1310', '113107', NULL::text, 'none'),
  ('11-1401', '112202', NULL::text, 'none'),
  ('11-2101', '113101', NULL::text, 'contact'),
  ('11-2102', '113103', NULL::text, 'none'),
  ('11-2103', '113101', NULL::text, 'contact'),
  ('11-2104', '113101', NULL::text, 'contact'),
  ('11-2105', '113101', NULL::text, 'contact'),
  ('11-2107', '113106', NULL::text, 'contact'),
  ('11-4101', '115401', NULL::text, 'none'),
  ('11-4102', '115402', NULL::text, 'none'),
  ('11-4103', '115403', NULL::text, 'none'),
  ('11-4104', '113105', NULL::text, 'contact'),
  ('11-6101', '212203', 'ADV001', 'fixed'),
  ('11-6102', '212203', 'ADV001', 'fixed'),
  ('11-6103', '212203', 'ADV001', 'fixed'),
  ('11-6104', '212203', 'ADV001', 'fixed'),
  ('11-6105', '212203', 'ADV001', 'fixed'),
  ('12-2101', '124106', NULL::text, 'none'),
  ('12-2102', '124206', NULL::text, 'none'),
  ('12-2103', '124104', NULL::text, 'none'),
  ('12-2104', '124204', NULL::text, 'none'),
  ('12-2105', '124107', NULL::text, 'none'),
  ('12-2106', '124207', NULL::text, 'none'),
  ('12-2107', '124108', NULL::text, 'none'),
  ('12-2108', '124208', NULL::text, 'none'),
  ('21-1101', '212101', NULL::text, 'contact'),
  ('21-1102', '212101', NULL::text, 'contact'),
  ('21-1103', '212103', NULL::text, 'contact'),
  ('21-1104', '212311', NULL::text, 'contact'),
  ('21-1105', '212310', NULL::text, 'none'),
  ('21-2101', '215101', NULL::text, 'none'),
  ('21-2102', '215102', NULL::text, 'none'),
  ('21-2103', '215104', NULL::text, 'none'),
  ('21-2104', '215103', NULL::text, 'none'),
  ('21-3101', '215201', NULL::text, 'none'),
  ('21-3102', '215203', NULL::text, 'none'),
  ('21-3103', '215204', NULL::text, 'none'),
  ('21-3104', '215202', NULL::text, 'none'),
  ('21-3105', '215501', NULL::text, 'none'),
  ('21-3106', '215501', NULL::text, 'none'),
  ('21-3201', '215351', NULL::text, 'none'),
  ('21-3202', '215355', NULL::text, 'none'),
  ('21-4101', '212106', NULL::text, 'none'),
  ('21-4102', '212308', NULL::text, 'none'),
  ('21-4103', '215301', NULL::text, 'none'),
  ('21-4104', '212314', NULL::text, 'none'),
  ('22-1101', '216103', NULL::text, 'none'),
  ('22-1102', '113204', NULL::text, 'none'),
  ('31-1101', '311000', NULL::text, 'none'),
  ('31-1102', '312000', NULL::text, 'none'),
  ('32-1101', '330000', NULL::text, 'none'),
  ('42-1102', '420112', NULL::text, 'none'),
  ('42-1103', '420109', NULL::text, 'none'),
  ('42-1104', '520103', NULL::text, 'none'),
  ('42-1105', '420101', NULL::text, 'none'),
  ('42-1106', '420111', NULL::text, 'none'),
  ('42-1107', '510301', NULL::text, 'none'),
  ('42-1108', '420108', NULL::text, 'none'),
  ('42-1109', '420113', NULL::text, 'none'),
  ('51-1101', '540110', NULL::text, 'none'),
  ('51-1102', '520309', NULL::text, 'none'),
  ('51-1103', '520308', NULL::text, 'none'),
  ('51-1104', '540204', NULL::text, 'none'),
  ('52-1101', '510113', NULL::text, 'none'),
  ('52-1102', '520213', NULL::text, 'none'),
  ('52-1103', '520213', NULL::text, 'none'),
  ('52-1104', '510114', NULL::text, 'none'),
  ('52-1105', '410302', NULL::text, 'none'),
  ('52-1106', '410302', NULL::text, 'none'),
  ('53-1101', '530101', NULL::text, 'none'),
  ('53-1102', '530104', NULL::text, 'none'),
  ('53-1103', '530116', NULL::text, 'none'),
  ('53-1104', '530102', NULL::text, 'none'),
  ('53-1105', '530107', NULL::text, 'none'),
  ('53-1106', '530108', NULL::text, 'none'),
  ('53-1201', '530213', NULL::text, 'none'),
  ('53-1202', '530217', NULL::text, 'none'),
  ('53-1203', '530509', NULL::text, 'none'),
  ('53-1301', '530302', NULL::text, 'none'),
  ('53-1302', '530301', NULL::text, 'none'),
  ('53-1303', '530303', NULL::text, 'none'),
  ('53-1304', '530212', NULL::text, 'none'),
  ('53-1305', '530211', NULL::text, 'none'),
  ('53-1306', '530215', NULL::text, 'none'),
  ('53-1307', '530214', NULL::text, 'none'),
  ('53-1401', '530401', NULL::text, 'none'),
  ('53-1402', '520221', NULL::text, 'none'),
  ('53-1403', '530409', NULL::text, 'none'),
  ('53-1404', '530410', NULL::text, 'none'),
  ('53-1405', '520220', NULL::text, 'none'),
  ('53-1406', '530402', NULL::text, 'none'),
  ('53-1407', '520201', NULL::text, 'none'),
  ('53-1408', '530306', NULL::text, 'none'),
  ('53-1501', '530501', NULL::text, 'none'),
  ('53-1502', '530502', NULL::text, 'none'),
  ('53-1503', '540190', NULL::text, 'none'),
  ('53-1601', '530706', NULL::text, 'none'),
  ('53-1602', '530704', NULL::text, 'none'),
  ('53-1603', '530707', NULL::text, 'none'),
  ('53-1604', '530708', NULL::text, 'none'),
  ('53-1605', '540102', NULL::text, 'none'),
  ('53-1702', '530411', NULL::text, 'none'),
  ('53-1801', '530201', NULL::text, 'none'),
  ('53-1802', '530218', NULL::text, 'none'),
  ('54-1103', '540204', NULL::text, 'none'),
  ('54-1104', '540204', NULL::text, 'none'),
  ('54-1105', '540201', NULL::text, 'none')
) AS v("code", "peak_code", "peak_sub_code", "peak_sub_code_source")
WHERE c."code" = v."code"
  AND c."deletedAt" IS NULL
  AND (c."peak_code" IS DISTINCT FROM v.peak_code
    OR c."peak_sub_code" IS DISTINCT FROM v.peak_sub_code
    OR c."peak_sub_code_source" IS DISTINCT FROM v.peak_sub_code_source);
