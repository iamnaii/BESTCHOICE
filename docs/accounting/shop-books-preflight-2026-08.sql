-- ============================================================================
-- ตรวจสถานะ "สมุดบัญชีฝั่ง SHOP" ก่อนให้ ADMIN หน้าร้านเริ่มใช้งานจริง
-- ============================================================================
-- วันที่เขียน: 2026-08-24
-- ขอบเขต:     ฝั่ง SHOP เท่านั้น (ฝั่ง FINANCE เทสไปแล้ว — คำสั่งเจ้าของ)
-- ความปลอดภัย: **SELECT อย่างเดียว** ไม่มี INSERT / UPDATE / DELETE / TRUNCATE
--              รันบน production ได้ ไม่เปลี่ยนแปลงข้อมูลใดๆ
--
-- วิธีรัน (ผ่าน cloud-sql-proxy ตาม runbook เดิม — ชื่อ DB จริงคือ "bestchoice"):
--   psql "postgresql://<user>@127.0.0.1:5432/bestchoice" -f docs/accounting/shop-books-preflight-2026-08.sql
--
-- แนะนำให้เก็บผลลัพธ์ไว้:
--   psql ... -f docs/accounting/shop-books-preflight-2026-08.sql > shop-preflight-$(date +%Y%m%d).txt
--
-- อ้างอิง pattern: docs/accounting/interco-preflight-2026-08.sql
-- ============================================================================

\pset pager off
\timing off

\echo ''
\echo '################################################################'
\echo '# 0. บริษัทในระบบ — ยืนยันว่ามี SHOP และ FINANCE แยกกันจริง'
\echo '################################################################'
SELECT
  company_code            AS "รหัส",
  name_th                 AS "ชื่อ",
  vat_registered          AS "จด VAT",
  is_active               AS "ใช้งาน",
  deleted_at              AS "ถูกลบเมื่อ",
  id                      AS "company_id"
FROM company_info
ORDER BY company_code NULLS LAST;

\echo ''
\echo '################################################################'
\echo '# 1. ผังบัญชี SHOP — มีครบไหม'
\echo '################################################################'
\echo '-- 1.1 จำนวนบัญชี แยก SHOP / FINANCE'
SELECT
  CASE WHEN code LIKE 'S%' THEN 'SHOP (S)' ELSE 'FINANCE' END AS "ฝั่ง",
  COUNT(*)                                                    AS "จำนวนบัญชี",
  COUNT(*) FILTER (WHERE status = 'ใช้งาน')                    AS "ใช้งานอยู่"
FROM chart_of_accounts
WHERE "deletedAt" IS NULL
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '-- 1.2 บัญชี SHOP ที่ระบบ "ต้องใช้" ตอน admin ทำงาน — ตัวไหนหาย?'
\echo '--     (ขาดตัวใดตัวหนึ่ง = ท่านั้นโพสต์ JE ไม่ได้ ให้รัน seed:coa)'
WITH required(code, must, purpose) AS (
  VALUES
    ('S11-1101', 'ต้องมี', 'เงินสด/ลิ้นชักสาขา 1 — ขายสด, เงินดาวน์, จ่ายเทิร์น'),
    ('S11-1102', 'ต้องมี', 'เงินสด/ลิ้นชักสาขา 2'),
    ('S11-1103', 'ต้องมี', 'เงินสด/ลิ้นชักสาขา 3'),
    ('S11-1201', 'ต้องมี', 'ธนาคาร SHOP รับเงิน — ขายสด/ดาวน์ที่โอนมา + รับเงินจาก FINANCE'),
    ('S11-1202', 'ต้องมี', 'ธนาคาร SHOP จ่ายเงิน — จ่ายเทิร์น/ค่าใช้จ่ายสาขา'),
    ('S11-2001', 'ต้องมี', 'สินค้าคงเหลือ — มือถือใหม่'),
    ('S11-2002', 'ต้องมี', 'สินค้าคงเหลือ — มือถือมือสอง (รับเทิร์นเข้าตัวนี้)'),
    ('S11-2003', 'ต้องมี', 'สินค้าคงเหลือ — อุปกรณ์เสริม'),
    ('S11-3001', 'ต้องมี', 'ลูกหนี้ FINANCE — ยอดจัด (คู่กับ 21-1101 ฝั่ง FINANCE)'),
    ('S11-3002', 'ต้องมี', 'ลูกหนี้ FINANCE — ค่าคอม (คู่กับ 21-1102 ฝั่ง FINANCE)'),
    ('S21-2001', 'ต้องมี', 'เงินดาวน์รับล่วงหน้า — ล้างตอน activate สัญญา'),
    -- สองแถวนี้ "มีได้ทีละตัว" — คาดว่ามีตัวใดตัวหนึ่งเท่านั้น ไม่ใช่ทั้งคู่
    ('S21-1104', 'ทีละตัว', 'เจ้าหนี้ FINANCE (ใหม่) — หนี้ระหว่างกิจการทุกประเภท · คำวินิจฉัยผู้สอบ 2026-08-24 ข้อ A1+B4 · มี = branch cpa-answers ขึ้น prod แล้ว'),
    ('S21-3001', 'ทีละตัว', 'เจ้าหนี้ FINANCE (เดิม) — ตั้งตามวัตถุประสงค์ ผู้สอบวินิจฉัยว่าผิด · มี = prod ยังเป็นของเดิม (ปกติ ณ 2026-08-24)'),
    ('S31-1101', 'ต้องมี', 'ทุน SHOP'),
    ('S32-1101', 'ต้องมี', 'กำไรสะสม SHOP — ตัวปิดของ JE ยอดยกมา'),
    ('S41-1101', 'ต้องมี', 'รายได้ขาย — มือถือใหม่'),
    ('S41-1102', 'ต้องมี', 'รายได้ขาย — มือถือมือสอง'),
    ('S41-1103', 'ต้องมี', 'รายได้ขาย — อุปกรณ์เสริม'),
    ('S41-1201', 'ต้องมี', 'รายได้ค่าคอมจาก FINANCE'),
    ('S50-1101', 'ต้องมี', 'ต้นทุนขาย — มือถือใหม่'),
    ('S50-1102', 'ต้องมี', 'ต้นทุนขาย — มือถือมือสอง'),
    ('S50-1103', 'ต้องมี', 'ต้นทุนขาย — อุปกรณ์เสริม')
)
SELECT
  r.code                                              AS "รหัส",
  r.purpose                                           AS "ใช้ทำอะไร",
  CASE
    WHEN coa.code IS NOT NULL AND coa.status = 'ใช้งาน' THEN 'มี'
    WHEN coa.code IS NOT NULL                           THEN '!! มีแต่ปิดใช้งาน (' || coa.status || ')'
    WHEN r.must = 'ต้องมี'                               THEN '### ไม่มีในผัง — ต้องรัน seed:coa ###'
    ELSE 'ไม่มี (อาจปกติ — ดูคำอธิบาย)'
  END                                                 AS "สถานะ",
  coa.name                                            AS "ชื่อบัญชีในระบบ"
FROM required r
LEFT JOIN chart_of_accounts coa
       ON coa.code = r.code AND coa."deletedAt" IS NULL
ORDER BY
  CASE
    WHEN coa.code IS NULL AND r.must = 'ต้องมี'          THEN 0
    WHEN coa.code IS NOT NULL AND coa.status <> 'ใช้งาน' THEN 0
    ELSE 1
  END,
  r.code;

\echo ''
\echo '-- 1.3 เจ้าหนี้ FINANCE ฝั่ง SHOP — prod อยู่เวอร์ชันไหน'
\echo '--     ต้องมี "ตัวใดตัวหนึ่ง" เท่านั้น · ถ้ามีทั้งคู่ = seed แล้วแต่ยังไม่ย้ายรายการเก่า'
\echo '--     ถ้าไม่มีเลย = ยังไม่เคย seed ผัง SHOP (ต้องรัน seed:coa ก่อนทำอะไรทั้งสิ้น)'
SELECT
  COUNT(*) FILTER (WHERE code = 'S21-1104')  AS "S21-1104 (ใหม่)",
  COUNT(*) FILTER (WHERE code = 'S21-3001')  AS "S21-3001 (เดิม)",
  CASE
    WHEN COUNT(*) FILTER (WHERE code = 'S21-1104') > 0
     AND COUNT(*) FILTER (WHERE code = 'S21-3001') > 0
      THEN '!! มีทั้งคู่ — ต้องตัดสินว่าจะย้ายรายการเก่าไหม (คำถามค้างกับผู้สอบ)'
    WHEN COUNT(*) FILTER (WHERE code = 'S21-1104') > 0
      THEN 'prod = เวอร์ชันใหม่ (S21-1104) — ลง JE ระหว่างกิจการได้'
    WHEN COUNT(*) FILTER (WHERE code = 'S21-3001') > 0
      THEN 'prod = เวอร์ชันเดิม (S21-3001) — branch cpa-answers ยังไม่ขึ้น'
    ELSE '### ไม่มีทั้งคู่ — ผัง SHOP ยังไม่ถูก seed ###'
  END                                        AS "สรุป"
FROM chart_of_accounts
WHERE code IN ('S21-1104', 'S21-3001')
  AND "deletedAt" IS NULL;

\echo ''
\echo '################################################################'
\echo '# 2. สมุด SHOP มียอดอะไรอยู่บ้าง (งบทดลอง scope=SHOP)'
\echo '################################################################'
\echo '-- 2.1 ยอดคงเหลือรายบัญชี (เฉพาะ JE ที่ POSTED และผูก company SHOP)'
SELECT
  jl.account_code                            AS "รหัส",
  COALESCE(coa.name, '(ไม่มีในผัง)')          AS "ชื่อบัญชี",
  COUNT(*)                                   AS "จำนวนบรรทัด",
  ROUND(SUM(jl.debit), 2)                    AS "เดบิตรวม",
  ROUND(SUM(jl.credit), 2)                   AS "เครดิตรวม",
  ROUND(COALESCE(SUM(jl.debit - jl.credit), 0), 2)        AS "คงเหลือ (Dr-Cr)"
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
JOIN company_info   ci ON ci.id = je.company_id
LEFT JOIN chart_of_accounts coa ON coa.code = jl.account_code AND coa."deletedAt" IS NULL
WHERE je.deleted_at IS NULL
  AND jl.deleted_at IS NULL
  AND je.status = 'POSTED'
  AND ci.company_code = 'SHOP'
GROUP BY jl.account_code, coa.name
ORDER BY jl.account_code;

\echo ''
\echo '-- 2.2 งบทดลอง SHOP สมดุลไหม (เดบิตรวม ต้องเท่ากับ เครดิตรวม)'
SELECT
  COUNT(*)                                                       AS "จำนวนบรรทัด",
  ROUND(COALESCE(SUM(jl.debit), 0), 2)                           AS "เดบิตรวม",
  ROUND(COALESCE(SUM(jl.credit), 0), 2)                          AS "เครดิตรวม",
  ROUND(COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0), 2) AS "ผลต่าง",
  CASE
    WHEN COUNT(*) = 0
      THEN 'สมุด SHOP ว่างเปล่า — ยอดยกมาลงเป็นยอดเต็มได้ ไม่ต้องหักส่วนต่าง'
    WHEN COALESCE(SUM(jl.debit), 0) = COALESCE(SUM(jl.credit), 0)
      THEN 'สมดุล OK — มีรายการอยู่แล้ว ยอดยกมาต้องลงเป็น *ส่วนต่าง* (ดูหมวด 2.1)'
    ELSE '### ไม่สมดุล — ต้องหาสาเหตุก่อนทำอย่างอื่น ###'
  END                                                            AS "สรุป"
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
JOIN company_info   ci ON ci.id = je.company_id
WHERE je.deleted_at IS NULL
  AND jl.deleted_at IS NULL
  AND je.status = 'POSTED'
  AND ci.company_code = 'SHOP';

\echo ''
\echo '-- 2.3 JE ฝั่ง SHOP มาจาก flow ไหนบ้าง + ช่วงวันที่'
SELECT
  COALESCE(je.metadata->>'flow', '(JV มือ / ไม่มี flow)')  AS "flow",
  je.status                                               AS "สถานะ",
  COUNT(*)                                                AS "จำนวนใบ",
  MIN(je.entry_date)::date                                AS "ใบแรก",
  MAX(je.entry_date)::date                                AS "ใบล่าสุด"
FROM journal_entries je
JOIN company_info ci ON ci.id = je.company_id
WHERE je.deleted_at IS NULL
  AND ci.company_code = 'SHOP'
GROUP BY 1, 2
ORDER BY 3 DESC;

\echo ''
\echo '################################################################'
\echo '# 3. *** สำคัญ *** JE ที่ลงผิดสมุด'
\echo '################################################################'
\echo '-- POST /journal ตรวจแค่ว่า "รหัสบัญชีมีอยู่จริง" แต่ไม่ตรวจว่า'
\echo '-- รหัสตรงกับบริษัทที่ผูกไว้ไหม (journal.service.ts:53 เขียนกำกับเองว่า'
\echo '-- "no companyId scoping") ⇒ ใบที่ใช้รหัส S แต่ผูก FINANCE จะหายจาก'
\echo '-- ทั้งสองรายงาน โดยงบทดลองยังสมดุลปกติ = ไม่มีสัญญาณเตือน'
\echo ''
\echo '-- 3.1 ใบที่ผูก FINANCE แต่มีบรรทัดรหัส S (ควรได้ 0 แถว)'
SELECT
  je.entry_number                                       AS "เลขที่",
  je.entry_date::date                                   AS "วันที่",
  je.status                                             AS "สถานะ",
  LEFT(je.description, 60)                              AS "รายละเอียด",
  COUNT(*) FILTER (WHERE jl.account_code LIKE 'S%')     AS "บรรทัด S",
  COUNT(*) FILTER (WHERE jl.account_code NOT LIKE 'S%') AS "บรรทัดเลขล้วน",
  ROUND(SUM(jl.debit), 2)                               AS "เดบิตรวม"
FROM journal_entries je
JOIN company_info ci ON ci.id = je.company_id
JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.deleted_at IS NULL
WHERE je.deleted_at IS NULL
  AND ci.company_code = 'FINANCE'
GROUP BY je.id, je.entry_number, je.entry_date, je.status, je.description
HAVING COUNT(*) FILTER (WHERE jl.account_code LIKE 'S%') > 0
ORDER BY je.entry_date;

\echo ''
\echo '-- 3.2 ใบที่ผูก SHOP แต่มีบรรทัดรหัสเลขล้วน (ควรได้ 0 แถว)'
SELECT
  je.entry_number                                       AS "เลขที่",
  je.entry_date::date                                   AS "วันที่",
  je.status                                             AS "สถานะ",
  LEFT(je.description, 60)                              AS "รายละเอียด",
  COUNT(*) FILTER (WHERE jl.account_code LIKE 'S%')     AS "บรรทัด S",
  COUNT(*) FILTER (WHERE jl.account_code NOT LIKE 'S%') AS "บรรทัดเลขล้วน",
  ROUND(SUM(jl.debit), 2)                               AS "เดบิตรวม"
FROM journal_entries je
JOIN company_info ci ON ci.id = je.company_id
JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.deleted_at IS NULL
WHERE je.deleted_at IS NULL
  AND ci.company_code = 'SHOP'
GROUP BY je.id, je.entry_number, je.entry_date, je.status, je.description
HAVING COUNT(*) FILTER (WHERE jl.account_code NOT LIKE 'S%') > 0
ORDER BY je.entry_date;

\echo ''
\echo '-- 3.3 บรรทัดที่อ้างรหัสบัญชีซึ่งไม่มีในผังเลย (ควรได้ 0 แถว)'
SELECT
  jl.account_code            AS "รหัสที่ไม่มีในผัง",
  ci.company_code            AS "บริษัทของใบ",
  COUNT(*)                   AS "จำนวนบรรทัด",
  ROUND(SUM(jl.debit), 2)    AS "เดบิตรวม",
  ROUND(SUM(jl.credit), 2)   AS "เครดิตรวม"
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
JOIN company_info   ci ON ci.id = je.company_id
LEFT JOIN chart_of_accounts coa ON coa.code = jl.account_code AND coa."deletedAt" IS NULL
WHERE je.deleted_at IS NULL
  AND jl.deleted_at IS NULL
  AND coa.code IS NULL
GROUP BY jl.account_code, ci.company_code
ORDER BY 3 DESC;

\echo ''
\echo '################################################################'
\echo '# 4. ความพร้อมตั้งค่า — ตัวที่ทำให้ "ขายไม่ได้" ถ้าไม่ตั้ง'
\echo '################################################################'
\echo '-- 4.1 สาขาที่ยังไม่ตั้งบัญชีเงินสด (shop_cash_account_code)'
\echo '--     ไม่ตั้ง = ขายสดเงินสดไม่ได้ / รับเทิร์นจ่ายสดไม่ได้ /'
\echo '--     activate สัญญาที่มีเงินดาวน์สดไม่ได้ (fail-closed โยน 400 ทั้งใบ)'
SELECT
  b.name                                    AS "สาขา",
  ci.company_code                           AS "สังกัดบริษัท",
  COALESCE(b.shop_cash_account_code, '### ยังไม่ตั้ง ###') AS "บัญชีเงินสดสาขา",
  coa.name                                  AS "ชื่อบัญชี",
  CASE
    WHEN b.shop_cash_account_code IS NULL          THEN '### ขายสดเงินสดไม่ได้ ###'
    WHEN b.shop_cash_account_code NOT LIKE 'S%'    THEN '### ตั้งเป็นบัญชี FINANCE — ผิดฝั่ง ###'
    WHEN coa.code IS NULL                          THEN '### รหัสไม่มีในผัง ###'
    ELSE 'OK'
  END                                       AS "สถานะ",
  b.is_main_warehouse                       AS "คลังหลัก"
FROM branches b
LEFT JOIN company_info      ci  ON ci.id  = b.company_id
LEFT JOIN chart_of_accounts coa ON coa.code = b.shop_cash_account_code AND coa."deletedAt" IS NULL
WHERE b.deleted_at IS NULL
  AND b.is_active = true
ORDER BY
  CASE WHEN b.shop_cash_account_code IS NULL THEN 0 ELSE 1 END,
  b.name;

\echo ''
\echo '-- 4.2 ผู้ใช้ที่ยังไม่ตั้งบัญชีเงินสดประจำตัว (default_cash_account_code)'
\echo '--     ใช้ตอนรับค่างวด (ฝั่ง FINANCE) — ไม่ตั้ง = ระบบถามทุกครั้ง เสี่ยงเลือกมั่ว'
SELECT
  u.name                                                   AS "ชื่อ",
  u.email                                                  AS "อีเมล",
  u.role                                                   AS "สิทธิ์",
  b.name                                                   AS "สาขา",
  COALESCE(u.default_cash_account_code, '(ยังไม่ตั้ง)')     AS "บัญชีเงินสดประจำตัว"
FROM users u
LEFT JOIN branches b ON b.id = u.branch_id
WHERE u.deleted_at IS NULL
  AND u.is_active = true
  AND u.is_system_user = false
  AND u.role IN ('OWNER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT', 'FINANCE_MANAGER')
ORDER BY
  CASE WHEN u.default_cash_account_code IS NULL THEN 0 ELSE 1 END,
  u.role, u.name;

\echo ''
\echo '################################################################'
\echo '# 5. ของจริงในคลัง เทียบกับ สมุด SHOP'
\echo '################################################################'
\echo '-- 5.1 สินค้าคงเหลือพร้อมขาย (IN_STOCK) — ยอดนี้ควรตรงกับ S11-2001/2002/2003'
SELECT
  p.category                                          AS "หมวด",
  CASE p.category
    WHEN 'PHONE_NEW'  THEN 'S11-2001'
    WHEN 'TABLET'     THEN 'S11-2001'
    WHEN 'PHONE_USED' THEN 'S11-2002'
    WHEN 'ACCESSORY'  THEN 'S11-2003'
    ELSE '(ไม่มีบัญชีรองรับ)'
  END                                                 AS "ควรอยู่บัญชี",
  COUNT(*)                                            AS "จำนวนเครื่อง",
  ROUND(COALESCE(SUM(p.cost_price), 0), 2)                         AS "ต้นทุนรวม",
  COUNT(*) FILTER (WHERE p.cost_price = 0)            AS "ต้นทุน = 0"
FROM products p
WHERE p.deleted_at IS NULL
  AND p.status = 'IN_STOCK'
GROUP BY p.category
ORDER BY p.category;

\echo ''
\echo '-- 5.2 สินค้าคงเหลือแยกตามสถานะทั้งหมด (ดูภาพรวมว่ามีอะไรค้างอยู่บ้าง)'
SELECT
  p.status                                   AS "สถานะ",
  COUNT(*)                                   AS "จำนวน",
  ROUND(COALESCE(SUM(p.cost_price), 0), 2)                AS "ต้นทุนรวม"
FROM products p
WHERE p.deleted_at IS NULL
GROUP BY p.status
ORDER BY 2 DESC;

\echo ''
\echo '-- 5.3 *** เครื่องที่ POS ขายไม่ได้ *** — IN_STOCK แต่ไม่มีราคาขายเลย'
SELECT
  COUNT(*)                                                                       AS "IN_STOCK ทั้งหมด",
  COUNT(*) FILTER (WHERE p.cash_price IS NULL AND p.installment_price IS NULL)    AS "### ไม่มีราคาเลย ###",
  COUNT(*) FILTER (WHERE p.cash_price IS NULL)                                   AS "ไม่มีราคาเงินสด",
  COUNT(*) FILTER (WHERE p.installment_price IS NULL)                            AS "ไม่มีราคาผ่อน"
FROM products p
WHERE p.deleted_at IS NULL
  AND p.status = 'IN_STOCK';

\echo ''
\echo '-- 5.4 ตัวอย่างเครื่องที่ไม่มีราคา 20 รายการแรก (ไว้ไล่เติม)'
SELECT
  p.imei_serial   AS "IMEI",
  p.name          AS "ชื่อ",
  p.category      AS "หมวด",
  p.cost_price    AS "ต้นทุน",
  b.name          AS "สาขา",
  p.stock_in_date::date AS "เข้าคลังเมื่อ"
FROM products p
LEFT JOIN branches b ON b.id = p.branch_id
WHERE p.deleted_at IS NULL
  AND p.status = 'IN_STOCK'
  AND p.cash_price IS NULL
  AND p.installment_price IS NULL
ORDER BY p.stock_in_date NULLS LAST
LIMIT 20;

\echo ''
\echo '-- 5.5 ใบขายที่มีในระบบ แยกชนิด (เทียบกับรายได้ S41-11xx ในข้อ 2.1)'
SELECT
  s.sale_type                                       AS "ชนิดการขาย",
  COUNT(*)                                          AS "จำนวนใบ",
  COUNT(*) FILTER (WHERE s.deleted_at IS NOT NULL)  AS "ที่ยกเลิกแล้ว",
  ROUND(COALESCE(SUM(s.net_amount) FILTER (WHERE s.deleted_at IS NULL), 0), 2) AS "ยอดรวม (ไม่นับที่ยกเลิก)",
  MIN(s.created_at)::date                           AS "ใบแรก",
  MAX(s.created_at)::date                           AS "ใบล่าสุด"
FROM sales s
GROUP BY s.sale_type
ORDER BY 2 DESC;

\echo ''
\echo '################################################################'
\echo '# 6. งวดบัญชี — ปิดไปถึงเดือนไหนแล้ว'
\echo '################################################################'
\echo '-- หมายเหตุ: "ไม่มีแถว" = งวดยังเปิด (validatePeriodOpen ปล่อยผ่าน)'
\echo '--          งวดมีผลเฉพาะตอนสั่งปิด ไม่ต้องสร้างล่วงหน้า'
SELECT
  ci.company_code                 AS "บริษัท",
  ap.year                         AS "ปี",
  ap.month                        AS "เดือน",
  ap.status                       AS "สถานะ",
  ap.closed_at::date              AS "ปิดเมื่อ",
  ap.reopened_at::date            AS "เปิดใหม่เมื่อ",
  ap.tax_filed                    AS "ยื่นภาษีแล้ว"
FROM accounting_periods ap
JOIN company_info ci ON ci.id = ap.company_id
ORDER BY ci.company_code, ap.year DESC, ap.month DESC;

\echo ''
\echo '################################################################'
\echo '# 7. ข้อมูลทดสอบที่ยังค้างอยู่ (ต้องล้างก่อนตั้งยอดยกมา)'
\echo '################################################################'
\echo '-- 7.1 นับตามเครื่องหมายที่ seed-test-contracts ใช้'
SELECT 'สัญญา TEST-'      AS "ชนิด",
       COUNT(*)           AS "ทั้งหมด",
       COUNT(*) FILTER (WHERE deleted_at IS NULL) AS "ยังไม่ถูกลบ"
FROM contracts WHERE contract_number LIKE 'TEST-%'
UNION ALL
SELECT 'เครื่อง IMEI TEST-',
       COUNT(*),
       COUNT(*) FILTER (WHERE deleted_at IS NULL)
FROM products WHERE imei_serial LIKE 'TEST-%'
UNION ALL
SELECT 'ลูกค้าทดสอบ (ที่อยู่ marker)',
       COUNT(*),
       COUNT(*) FILTER (WHERE deleted_at IS NULL)
FROM customers WHERE address_current = 'ข้อมูลทดสอบระบบ — ลบได้'
UNION ALL
SELECT 'เครื่องชื่อขึ้นต้น "ทดสอบระบบ"',
       COUNT(*),
       COUNT(*) FILTER (WHERE deleted_at IS NULL)
FROM products WHERE name LIKE 'ทดสอบระบบ%';

\echo ''
\echo '-- 7.2 JE ที่ผูกกับสัญญาทดสอบ (จะถูก hard-delete ตอน cleanup)'
SELECT
  ci.company_code                          AS "บริษัท",
  COALESCE(je.metadata->>'flow', '(JV มือ)') AS "flow",
  COUNT(*)                                 AS "จำนวนใบ"
FROM journal_entries je
JOIN company_info ci ON ci.id = je.company_id
JOIN contracts c ON c.id = je.metadata->>'contractId'
WHERE je.deleted_at IS NULL
  AND c.contract_number LIKE 'TEST-%'
GROUP BY 1, 2
ORDER BY 3 DESC;

\echo ''
\echo '################################################################'
\echo '# 8. inter-co — สองสมุดตรงกันไหม (ยอดจัด + ค่าคอม)'
\echo '################################################################'
\echo '-- 8.1 ยอดรวมทั้งบัญชี: FINANCE 21-1101/21-1102 ควรคู่กับ SHOP S11-3001/S11-3002'
SELECT
  'FINANCE 21-1101 เจ้าหนี้ยอดจัด'  AS "บัญชี",
  ROUND(COALESCE(SUM(jl.credit - jl.debit), 0), 2) AS "ยอดคงเหลือ"
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE je.deleted_at IS NULL AND jl.deleted_at IS NULL AND je.status = 'POSTED'
  AND jl.account_code = '21-1101'
UNION ALL
SELECT 'SHOP S11-3001 ลูกหนี้ยอดจัด',
       ROUND(COALESCE(SUM(jl.debit - jl.credit), 0), 2)
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE je.deleted_at IS NULL AND jl.deleted_at IS NULL AND je.status = 'POSTED'
  AND jl.account_code = 'S11-3001'
UNION ALL
SELECT 'FINANCE 21-1102 เจ้าหนี้ค่าคอม',
       ROUND(COALESCE(SUM(jl.credit - jl.debit), 0), 2)
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE je.deleted_at IS NULL AND jl.deleted_at IS NULL AND je.status = 'POSTED'
  AND jl.account_code = '21-1102'
UNION ALL
SELECT 'SHOP S11-3002 ลูกหนี้ค่าคอม',
       ROUND(COALESCE(SUM(jl.debit - jl.credit), 0), 2)
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE je.deleted_at IS NULL AND jl.deleted_at IS NULL AND je.status = 'POSTED'
  AND jl.account_code = 'S11-3002';

\echo ''
\echo '-- 8.2 สัญญาที่ยังเดินอยู่แต่ไม่ได้ระบุค่าคอม (store_commission = NULL)'
\echo '--     เคสนี้ฝั่ง FINANCE เติมค่าคอม 10% ให้เอง แต่ฝั่ง SHOP ลง 0'
\echo '--     ⇒ ค่าคอมโผล่สมุดเดียว = สองสมุดไม่ตรงกันถาวร'
SELECT
  COUNT(*)                                                  AS "สัญญาทั้งหมด (ยังไม่ถูกลบ)",
  COUNT(*) FILTER (WHERE store_commission IS NULL)          AS "### ค่าคอม NULL ###",
  COUNT(*) FILTER (WHERE store_commission = 0)              AS "ค่าคอม = 0 (ไม่เป็นไร)",
  COUNT(*) FILTER (WHERE status = 'ACTIVE')                 AS "สถานะ ACTIVE"
FROM contracts
WHERE deleted_at IS NULL;

\echo ''
\echo '-- 8.3 รายชื่อสัญญาที่ค่าคอมเป็น NULL (ถ้ามี)'
SELECT
  contract_number      AS "เลขที่สัญญา",
  status               AS "สถานะ",
  financed_amount      AS "ยอดจัด",
  created_at::date     AS "สร้างเมื่อ"
FROM contracts
WHERE deleted_at IS NULL
  AND store_commission IS NULL
ORDER BY created_at
LIMIT 50;

\echo ''
\echo '################################################################'
\echo '# จบการตรวจ — กรุณาส่งผลลัพธ์ทั้งหมดกลับมาเพื่อวางแผนยอดยกมา'
\echo '################################################################'
\echo ''