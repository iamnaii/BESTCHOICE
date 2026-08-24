-- ============================================================================
-- CPA A2 = "ต้องตั้ง" — Enumerate the SHOP opening-balance population
-- ============================================================================
-- วันที่เขียน: 2026-08-24
-- ที่มา:  CPA ตอบคำถาม interco spec §11 ข้อ 1 (บรรทัด 154 ของ
--         docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md)
--         = "ต้องตั้ง" ยอดยกมาฝั่ง SHOP ย้อนหลัง
-- อ้างอิง pattern: docs/accounting/interco-preflight-2026-08.sql
--                  docs/accounting/shop-books-preflight-2026-08.sql
--
-- ความปลอดภัย: **SELECT อย่างเดียว** — ไม่มี INSERT / UPDATE / DELETE / TRUNCATE
--              (CREATE TEMP VIEW อยู่ใน session เท่านั้น หายเมื่อปิด psql)
--
-- วิธีรัน (ชื่อ DB จริงบน prod คือ "bestchoice"):
--   psql "postgresql://<user>@127.0.0.1:5432/bestchoice" \
--     -f docs/accounting/shop-opening-balance-enumerate-2026-08.sql \
--     > shop-opening-balance-$(date +%Y%m%d).txt
--
-- ----------------------------------------------------------------------------
-- นิยามประชากรที่กระทบ (ห้ามใช้วันที่เป็นตัวตัดสิน — ใช้ GL):
--   สัญญาที่ (ก) มีบรรทัด POSTED บน 21-1101/21-1102 ที่ stamp metadata.contractId
--            (= 1A ทำงานแล้ว FINANCE ตั้งเจ้าหนี้ไว้)
--     และ  (ข) **ไม่มี** บรรทัด POSTED บน S11-3001/S11-3002 ที่ stamp contractId เลย
--            (= ShopInventoryTransferTemplate JE B ไม่เคยทำงาน)
--   ตรงกับสูตร legacyNoShop ใน interco-pending.service.ts:309
--     (shopFinancedGl.eq(0) && shopCommissionGl.eq(0))
--
-- **ทำไมไม่ใช้ activated_at < DATE 2026-06-23** (แบบที่ interco-preflight #2 ทำ):
--   commit bbcfa7a3 (PR #1280) merge 2026-06-23 **16:08:40 +0700** แล้วดีพลอย
--   อัตโนมัติ (.github/workflows/deploy-gcp.yml push -> main) => สัญญาที่ activate
--   วันที่ 23 มิ.ย. ช่วงเช้าถึงบ่ายยังเป็น legacy อยู่ แต่เงื่อนไขวันที่แบบนั้น
--   จะจัดว่าไม่ legacy. GL เป็นตัวตัดสินที่ถูกต้องเสมอ — วันที่ใช้เพื่อ cross-check
--   เท่านั้น (ข้อ 2 ด้านล่างพิมพ์ให้ดูว่าเส้นแบ่งจริงตกตรงไหน)
--
-- **ทำไมไม่มี HAVING SUM(credit-debit) > 0** (แบบที่คิวรอจ่ายทำ):
--   สัญญา legacy ที่ถูกจ่ายผ่านรอบจ่ายไปแล้วคือ **แกนกลางของปัญหา A2**
--   (FINANCE โอนเงินจริง SHOP ไม่มีลูกหนี้มารับ) — ตัวกรองนั้นจะทำให้หายไปทั้งกลุ่ม.
--   หมายเหตุ: JE ของรอบจ่าย **ไม่ stamp** metadata.contractId โดยเจตนา
--   (interco-settlement.service.ts — เลนส์ต่อสัญญาจึงยังเห็นยอด gross ของ 1A เสมอ)
--   => ตัวเลขในข้อ 3 คือยอดที่ 1A ตั้งไว้ตอนแรก = ยอดที่ยอดยกมาต้องตั้งให้ตรง
-- ============================================================================

\pset pager off
\timing off

\echo ''
\echo '################################################################'
\echo '# 1. สรุปประชากร: สัญญาที่สมุด SHOP ไม่เคยตั้งลูกหนี้ Inter-co'
\echo '################################################################'
\echo '-- แยก "ยังไม่ถูกจ่าย" vs "จ่ายไปแล้ว" ด้วย settled gate ตัวเดียวกับ'
\echo '-- pending engine (item ใน batch PENDING_APPROVAL/POSTED).'
\echo '-- กลุ่ม "จ่ายไปแล้ว" = เงินออกจาก FINANCE เข้ากระเป๋า SHOP จริงโดยไม่มี'
\echo '-- รายการใดในสมุด SHOP เลย -- นี่คือแกนของคำถาม A2'

CREATE TEMP VIEW v_finance_lens AS
SELECT je.metadata->>'contractId'                                     AS contract_id,
       MIN(je.posted_at)                                              AS activated_at,
       SUM(CASE WHEN jl.account_code = '21-1101' THEN jl.credit - jl.debit ELSE 0 END) AS financed_gl,
       SUM(CASE WHEN jl.account_code = '21-1102' THEN jl.credit - jl.debit ELSE 0 END) AS commission_gl
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE jl.account_code IN ('21-1101', '21-1102')
  AND jl.deleted_at IS NULL
  AND je.status = 'POSTED'
  AND je.deleted_at IS NULL
  AND je.metadata->>'contractId' IS NOT NULL
GROUP BY 1;

CREATE TEMP VIEW v_shop_lens AS
SELECT je.metadata->>'contractId'                                     AS contract_id,
       SUM(CASE WHEN jl.account_code = 'S11-3001' THEN jl.debit - jl.credit ELSE 0 END) AS shop_financed_gl,
       SUM(CASE WHEN jl.account_code = 'S11-3002' THEN jl.debit - jl.credit ELSE 0 END) AS shop_commission_gl
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE jl.account_code IN ('S11-3001', 'S11-3002')
  AND jl.deleted_at IS NULL
  AND je.status = 'POSTED'
  AND je.deleted_at IS NULL
  AND je.metadata->>'contractId' IS NOT NULL
GROUP BY 1;

-- settled gate — นิยามเดียวกับ interco-pending.service.ts (OPEN_BATCH_STATUSES)
CREATE TEMP VIEW v_settled AS
SELECT i.contract_id,
       BOOL_OR(b.status = 'POSTED')           AS in_posted_batch,
       STRING_AGG(DISTINCT b.batch_number, ', ') AS batch_numbers
FROM inter_co_settlement_items i
JOIN inter_co_settlement_batches b ON b.id = i.batch_id
WHERE i.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND i.item_type = 'SETTLEMENT'
  AND b.status IN ('PENDING_APPROVAL', 'POSTED')
GROUP BY 1;

-- ประชากร A2 = FINANCE ตั้งเจ้าหนี้แล้ว แต่ SHOP ไม่มีลูกหนี้เลย
CREATE TEMP VIEW v_a2_population AS
SELECT f.contract_id,
       f.activated_at,
       f.financed_gl,
       f.commission_gl,
       COALESCE(s.in_posted_batch, false) AS already_paid_out,
       s.batch_numbers
FROM v_finance_lens f
LEFT JOIN v_shop_lens s2 ON s2.contract_id = f.contract_id
LEFT JOIN v_settled   s  ON s.contract_id  = f.contract_id
WHERE COALESCE(s2.shop_financed_gl, 0) = 0
  AND COALESCE(s2.shop_commission_gl, 0) = 0;

SELECT
  CASE WHEN already_paid_out
       THEN '1. จ่ายไปแล้ว (เงินออกจริง ไม่มีลูกหนี้ SHOP รองรับ)'
       ELSE '2. ยังไม่ถูกจ่าย (ยังอยู่คิว/ยังไม่เข้ารอบ)' END       AS "กลุ่ม",
  COUNT(*)                                                            AS "จำนวนสัญญา",
  MIN(activated_at)::date                                             AS "activate แรกสุด",
  MAX(activated_at)::date                                             AS "activate ล่าสุด",
  ROUND(SUM(financed_gl)::numeric, 2)                                 AS "ยอดจัดรวม 21-1101",
  ROUND(SUM(commission_gl)::numeric, 2)                               AS "ค่าคอมรวม 21-1102",
  ROUND(SUM(financed_gl + commission_gl)::numeric, 2)                 AS "รวมที่ต้องตั้งเป็นลูกหนี้ SHOP"
FROM v_a2_population
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '################################################################'
\echo '# 2. เส้นแบ่งจริงตกวันไหน (cross-check วันดีพลอย bbcfa7a3)'
\echo '################################################################'
\echo '-- คาดหวัง: legacy หยุดที่ 2026-06-23 (commit merge 16:08 +0700).'
\echo '-- ถ้ามีแถว legacy หลังจากนั้น = มีเส้นทาง activate ที่ยังไม่ wire'
\echo '-- (ต้องหาสาเหตุก่อน ไม่ใช่แค่ตั้งยอดยกมา)'

SELECT activated_at::date                                 AS "วัน activate",
       COUNT(*)                                           AS "สัญญา legacy",
       MIN(activated_at AT TIME ZONE 'Asia/Bangkok')      AS "เวลาแรก BKK",
       MAX(activated_at AT TIME ZONE 'Asia/Bangkok')      AS "เวลาสุดท้าย BKK"
FROM v_a2_population
GROUP BY 1
ORDER BY 1 DESC
LIMIT 30;

\echo ''
\echo '################################################################'
\echo '# 3. รายสัญญา + ขาที่หายไปทั้ง JE A (COGS) และ JE B (รายได้/ลูกหนี้)'
\echo '################################################################'
\echo '-- คอลัมน์ *_gl   = ยอดจาก GL (ใช้ตัวนี้ตั้งยอดยกมา — doctrine ของระบบ)'
\echo '-- คอลัมน์ *_field = ยอดจากตาราง contracts (ไว้เทียบว่าตรงกันไหม)'
\echo '-- ### commission_gap = ค่าคอมที่ 1A ตั้ง 10% เอง แต่ SHOP จะตั้ง 0 ###'
\echo '--   (contract-activation-1a.template.ts:47-50 vs'
\echo '--    contract-workflow.service.ts:570-572) — ต้องให้ CPA เคาะว่าจะตั้ง'
\echo '--   ยอดยกมาตาม GL (ผูกสองสมุดให้ตรง) หรือตาม field (คงช่องว่างไว้)'

SELECT
  c.contract_number                                          AS "เลขที่สัญญา",
  p.activated_at::date                                       AS "activate",
  c.status                                                   AS "สถานะสัญญา",
  p.already_paid_out                                         AS "จ่ายแล้ว",
  p.batch_numbers                                            AS "รอบจ่าย",
  pr.category                                                AS "หมวดสินค้า",
  CASE pr.category WHEN 'PHONE_USED' THEN 'S50-1102'
                   WHEN 'ACCESSORY'  THEN 'S50-1103'
                   ELSE 'S50-1101' END                       AS "Dr COGS (JE A)",
  CASE pr.category WHEN 'PHONE_USED' THEN 'S11-2002'
                   WHEN 'ACCESSORY'  THEN 'S11-2003'
                   ELSE 'S11-2001' END                       AS "Cr สินค้าคงเหลือ (JE A)",
  ROUND(pr.cost_price::numeric, 2)                           AS "ต้นทุน JE A",
  ROUND(p.financed_gl::numeric, 2)                           AS "Dr S11-3001 financed_gl",
  ROUND(p.commission_gl::numeric, 2)                         AS "Dr S11-3002 commission_gl",
  ROUND(c.down_payment::numeric, 2)                          AS "Dr S21-2001 เงินดาวน์",
  ROUND((c.down_payment + c.financed_amount)::numeric, 2)    AS "Cr รายได้ down+financed",
  ROUND(c.financed_amount::numeric, 2)                       AS "financed_field",
  ROUND(COALESCE(c.store_commission, 0)::numeric, 2)         AS "commission_field",
  ROUND((p.commission_gl - COALESCE(c.store_commission, 0))::numeric, 2) AS "### commission_gap ###",
  ROUND((p.financed_gl - c.financed_amount)::numeric, 2)     AS "financed_gap",
  ROUND(c.selling_price::numeric, 2)                         AS "selling_price เทียบ"
FROM v_a2_population p
JOIN contracts c  ON c.id = p.contract_id
JOIN products  pr ON pr.id = c.product_id
ORDER BY p.activated_at;

\echo ''
\echo '################################################################'
\echo '# 4. เงินที่ FINANCE โอนไปแล้วโดยสมุด SHOP ไม่มีลูกหนี้มารับ'
\echo '################################################################'
\echo '-- ต่อรอบจ่าย: total_amount - shop_posted_amount'
\echo '-- (schema.prisma:4507 / 4510 — shop_posted_amount รวมเฉพาะ item ที่'
\echo '--  legacy_no_shop = false => ส่วนต่างคือช่องว่าง A2 ของรอบนั้นพอดี)'
\echo '-- ยอดรวมคอลัมน์นี้ ต้องเท่ากับกลุ่ม "จ่ายไปแล้ว" ในข้อ 1'

SELECT
  b.batch_number                                                     AS "รอบจ่าย",
  b.status                                                           AS "สถานะ",
  b.transfer_date::date                                              AS "วันโอน",
  b.posted_at::date                                                  AS "วันลงบัญชี",
  ROUND(b.total_amount::numeric, 2)                                  AS "เจ้าหนี้รวม FINANCE",
  ROUND(b.shop_posted_amount::numeric, 2)                            AS "ลูกหนี้ที่ล้างได้ SHOP",
  ROUND((b.total_amount - b.shop_posted_amount)::numeric, 2)         AS "### ช่องว่าง A2 ###",
  COUNT(*) FILTER (WHERE i.legacy_no_shop)                           AS "สัญญา legacy ในรอบ",
  COUNT(*) FILTER (WHERE i.item_type = 'SETTLEMENT')                 AS "สัญญาทั้งหมดในรอบ",
  (b.shop_journal_entry_id IS NULL)                                  AS "ไม่มี JE ฝั่ง SHOP เลย"
FROM inter_co_settlement_batches b
LEFT JOIN inter_co_settlement_items i
       ON i.batch_id = b.id AND i.deleted_at IS NULL
WHERE b.deleted_at IS NULL
  AND b.status = 'POSTED'
GROUP BY b.id, b.batch_number, b.status, b.transfer_date, b.posted_at,
         b.total_amount, b.shop_posted_amount, b.shop_journal_entry_id
ORDER BY b.transfer_date;

\echo ''
\echo '-- 4.1 ยอดรวม (ต้องตรงกับกลุ่ม "จ่ายไปแล้ว" ในข้อ 1)'
SELECT ROUND(SUM(b.total_amount - b.shop_posted_amount)::numeric, 2) AS "ช่องว่าง A2 รวมทุกรอบ POSTED"
FROM inter_co_settlement_batches b
WHERE b.deleted_at IS NULL AND b.status = 'POSTED';

\echo ''
\echo '################################################################'
\echo '# 5. *** ขอบเขตที่ใหญ่กว่าที่ A2 ถาม *** สินค้าคงเหลือ SHOP'
\echo '################################################################'
\echo '-- S11-2001/2002/2003 **ไม่เคยถูกเดบิตตอนซื้อเข้า** — โมดูล'
\echo '-- purchase-orders ไม่โพสต์ JE เลย (ตรวจแล้ว 2026-08-24) และบัญชี'
\echo '-- เจ้าหนี้ผู้ขาย S21-1101/S21-1102 ไม่มีผู้เรียกใช้ในโค้ดแม้แถวเดียว.'
\echo '-- ขาเดบิตที่มีจริงมีแค่ รับเทิร์น + เปลี่ยนเครื่อง (S11-2002 เท่านั้น).'
\echo '-- => ถ้ายอดติดลบ (Cr) แปลว่าตัดสต็อกออกโดยไม่เคยรับเข้า — ยอดยกมา'
\echo '--   ต้องครอบสินค้าคงเหลือด้วย ไม่ใช่แค่ลูกหนี้ Inter-co'

SELECT
  jl.account_code                                    AS "บัญชี",
  coa.name                                           AS "ชื่อ",
  ROUND(SUM(jl.debit)::numeric, 2)                   AS "เดบิตรวม",
  ROUND(SUM(jl.credit)::numeric, 2)                  AS "เครดิตรวม",
  ROUND(SUM(jl.debit - jl.credit)::numeric, 2)       AS "คงเหลือ Dr-Cr",
  CASE WHEN SUM(jl.debit - jl.credit) < 0
       THEN '### ติดลบ — สินทรัพย์มียอดเครดิต ###' ELSE 'OK' END AS "สถานะ"
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
LEFT JOIN chart_of_accounts coa ON coa.code = jl.account_code AND coa."deletedAt" IS NULL
WHERE jl.account_code IN ('S11-2001','S11-2002','S11-2003','S11-2004')
  AND jl.deleted_at IS NULL
  AND je.status = 'POSTED'
  AND je.deleted_at IS NULL
GROUP BY jl.account_code, coa.name
ORDER BY jl.account_code;

\echo ''
\echo '-- 5.1 มูลค่าสินค้าคงคลังจริงที่ควรเป็นยอดยกมาฝั่งเดบิต (ของที่ยังอยู่ในมือ)'
SELECT
  p.category                                          AS "หมวด",
  CASE p.category WHEN 'PHONE_USED' THEN 'S11-2002'
                  WHEN 'ACCESSORY'  THEN 'S11-2003'
                  ELSE 'S11-2001' END                 AS "บัญชีปลายทาง",
  COUNT(*)                                            AS "จำนวนเครื่อง",
  ROUND(SUM(p.cost_price)::numeric, 2)                AS "ต้นทุนรวม",
  COUNT(*) FILTER (WHERE p.cost_price = 0)            AS "ต้นทุน 0 (ต้องตามเก็บ)"
FROM products p
WHERE p.deleted_at IS NULL
  AND p.status = 'IN_STOCK'
GROUP BY 1, 2
ORDER BY 1;

\echo ''
\echo '################################################################'
\echo '# 6. งวดบัญชีฝั่ง SHOP: ลง JE ยอดยกมาย้อนหลังได้หรือไม่'
\echo '################################################################'
\echo '-- "ไม่มีแถว" = งวดยังเปิด (period-lock.util.ts — no row = no-op)'
\echo '-- ถ้างวดเป้าหมาย CLOSED/SYNCED ต้องให้ OWNER เปิดงวดก่อน'
\echo '-- (POST /expenses/periods/reopen) หรือลงวันที่ในงวดที่ยังเปิด'

SELECT ci.company_code    AS "บริษัท",
       ap.year            AS "ปี",
       ap.month           AS "เดือน",
       ap.status          AS "สถานะ",
       ap.closed_at::date AS "ปิดเมื่อ",
       ap.tax_filed       AS "ยื่นภาษีแล้ว"
FROM accounting_periods ap
JOIN company_info ci ON ci.id = ap.company_id
ORDER BY ci.company_code, ap.year DESC, ap.month DESC;

\echo ''
\echo '################################################################'
\echo '# 7. JV มือที่มีอยู่แล้ว (ตรวจว่ายังไม่มีใครตั้งยอดยกมาไปแล้ว)'
\echo '################################################################'
\echo '-- ตัวแยก "JV มือ" vs "JE อัตโนมัติ" ที่ถูกต้อง:'
\echo '--   auto (journal-auto.service.ts:101-114) => metadata != NULL เสมอ'
\echo '--        + reference_type = AUTO (เมื่อส่ง reference) + status POSTED ทันที'
\echo '--   manual (journal.service.ts:77-96)      => metadata = NULL (ไม่เคยเซ็ต)'
\echo '--        + status เริ่มที่ DRAFT'
\echo '-- ***ห้ามใช้ created_by_id เป็นตัวแยก***: schema.prisma:3848 บังคับ NOT NULL'
\echo '-- และ resolveSystemUserId (journal-auto.service.ts:153-160) ใช้บัญชี'
\echo '-- admin@bestchoice.com ซึ่งเป็น OWNER จริง ไม่ใช่ system user แยกต่างหาก'
\echo '-- (คอมเมนต์ journal.service.ts:186 ที่เขียนว่า auto มี createdById = null'
\echo '--  เป็นคอมเมนต์เก่าที่ไม่ตรงกับ schema แล้ว)'

SELECT
  ci.company_code                    AS "บริษัท",
  je.entry_number                    AS "เลขที่",
  je.entry_date::date                AS "วันที่เอกสาร",
  je.posted_at::date                 AS "วันที่โพสต์",
  je.status                          AS "สถานะ",
  LEFT(je.description, 70)           AS "รายละเอียด",
  ROUND(SUM(jl.debit)::numeric, 2)   AS "เดบิตรวม"
FROM journal_entries je
JOIN company_info  ci ON ci.id = je.company_id
JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.deleted_at IS NULL
WHERE je.deleted_at IS NULL
  AND je.metadata IS NULL
  AND (je.reference_type IS NULL OR je.reference_type <> 'AUTO')
GROUP BY ci.company_code, je.id, je.entry_number, je.entry_date, je.posted_at, je.status, je.description
ORDER BY je.entry_date;

\echo ''
\echo '################################################################'
\echo '# จบ — ส่งผลลัพธ์ทั้ง 7 ชุดให้ CPA เคาะ 3 เรื่อง:'
\echo '#  (1) ตั้งยอดยกมาเฉพาะงบดุล (ลูกหนี้/สินค้า vs S32-1101) หรือ'
\echo '#      ปรับปรุงงบกำไรขาดทุนย้อนหลังด้วย (S41-11xx / S50-11xx)'
\echo '#  (2) ค่าคอมใช้ยอดตาม GL (10% fallback) หรือตาม field (0)'
\echo '#  (3) ลงวันที่เอกสารเป็นวันไหน (วัน activate เดิม / วันเปิดสมุด SHOP)'
\echo '################################################################'
\echo ''
