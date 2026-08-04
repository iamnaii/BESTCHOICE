-- ============================================================================
-- ลบบัญชี 42-1106 + 42-1107 ออกจากผังบัญชี FINANCE (คำสั่ง CPA/owner 2026-08-03)
--   42-1106 รายได้จากการโอนกลับค่าเผื่อหนี้สงสัยจะสูญ
--           → เลิกใช้ CPA เลือกมาตรฐานเดียว Cr 51-1103 ทุกเส้นทาง (ruling 2026-08-01)
--   42-1107 รายได้ค่าปรับยกเลิกเปลี่ยนเครื่อง
--           → เลิกใช้ owner ยกเลิกกติกาค่าปรับยกเลิก swap ทั้งชุด (2026-07-31)
-- ทั้งคู่เปิดไว้แต่ไม่เคยโพสต์จริง — CPA สั่งให้เอาออกจากผัง ไม่ใช่ปล่อยค้างไว้เฉยๆ
--
-- ปลอดภัย: verify ใน transaction — ถ้ามี journal_lines อ้างอิงแม้แถวเดียว
--          หรือจำนวนแถวที่แก้ไม่ใช่ 2 พอดี จะ RAISE EXCEPTION → ROLLBACK ทั้งหมด
--
-- วิธีรัน (ตาม runbook เดิม — ต้อง psql เท่านั้น):
--   1) cloud-sql-proxy --gcloud-auth --port 5544 bestchoice-prod:asia-southeast1:bestchoice-db
--   2) docker exec -i -e PGPASSWORD=<รหัสจาก Secret DATABASE_URL> installment-postgres \
--        psql -h host.docker.internal -p 5544 -U bestchoice -d bestchoice -f <ไฟล์นี้>
--
-- หมายเหตุ (นโยบายบ้าน): ใช้ SOFT DELETE (set "deletedAt") ไม่ hard delete —
--   chart_of_accounts เป็น master data ที่ journal_lines.account_code อ้างถึงแบบ
--   by-value (ไม่มี FK) การ DELETE จริงจะทำให้รายงานย้อนหลังหาชื่อบัญชีไม่เจอ
--   แบบเงียบๆ ถ้าวันหลังมีบรรทัดโผล่มา ตรงกับ ChartOfAccountsService.remove()
--   ที่ soft-delete เหมือนกัน และตรงกับกฎ "ห้าม hard delete" ใน .claude/rules/database.md
--   เซ็ต status='ไม่ใช้งาน' ควบคู่ด้วย เพราะบาง query กรองด้วย status อย่างเดียว
--   (เช่น findGrouped / getPeakMapping) บางอันกรองด้วย deletedAt อย่างเดียว
--
-- คู่กับ commit ที่ลบ 2 แถวนี้ออกจาก
--   apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv
-- (seeder อ่านจาก CSV → หลัง deploy การรัน `npm run seed:coa` จะไม่ปลุกบัญชีกลับมา
--  เพราะ seedFinanceCoa แตะเฉพาะ code ที่ยังอยู่ใน CSV — ไม่ undelete แถวเก่า)
-- ============================================================================
BEGIN;

DO $$
DECLARE
  n_total   int;
  n_live    int;
  n_lines   int;
  n_updated int;
BEGIN
  -- (0) กันรันผิดฐาน / กันรันซ้ำ -------------------------------------------
  SELECT count(*) INTO n_total
  FROM chart_of_accounts WHERE code IN ('42-1106', '42-1107');

  SELECT count(*) INTO n_live
  FROM chart_of_accounts WHERE code IN ('42-1106', '42-1107') AND "deletedAt" IS NULL;

  IF n_total = 0 THEN
    RAISE EXCEPTION 'ไม่พบบัญชี 42-1106/42-1107 ในฐานนี้เลย — อาจต่อผิดฐาน หรือยังไม่เคย seed ผัง CPA (ไม่ต้องรันสคริปต์นี้)';
  END IF;

  IF n_live = 0 THEN
    RAISE EXCEPTION 'สคริปต์นี้เคยรันแล้ว (42-1106/42-1107 ถูก soft-delete ไปแล้วทั้งคู่) — ห้ามรันซ้ำ';
  END IF;

  IF n_live <> 2 THEN
    RAISE EXCEPTION 'คาดว่าจะเจอบัญชีที่ยังไม่ถูกลบ 2 แถว แต่เจอ % แถว — หยุดเพื่อให้คนตรวจก่อน ROLLBACK', n_live;
  END IF;

  -- (1) ห้ามลบถ้ามีรายการบัญชีอ้างอิงอยู่ (นับทุกแถวรวมที่ soft-delete แล้ว) --
  SELECT count(*) INTO n_lines
  FROM journal_lines WHERE account_code IN ('42-1106', '42-1107');

  IF n_lines > 0 THEN
    RAISE EXCEPTION 'มี journal_lines อ้างถึง 42-1106/42-1107 อยู่ % แถว — ห้ามลบบัญชีทิ้ง ต้องให้ CPA ตรวจ/กลับรายการก่อน ROLLBACK', n_lines;
  END IF;

  -- (2) soft delete ทั้งสองบัญชี ---------------------------------------------
  UPDATE chart_of_accounts
     SET "deletedAt" = now(),
         "updatedAt" = now(),
         status      = 'ไม่ใช้งาน',
         notes       = COALESCE(notes || ' | ', '') ||
                       'ลบออกจากผังบัญชี 2026-08-03 (คำสั่ง CPA/owner) — soft delete, ไม่เคยมีรายการบัญชี'
   WHERE code IN ('42-1106', '42-1107')
     AND "deletedAt" IS NULL;
  GET DIAGNOSTICS n_updated = ROW_COUNT;

  -- (3) verify — ไม่ผ่าน = ROLLBACK ทั้งหมด ----------------------------------
  IF n_updated <> 2 THEN
    RAISE EXCEPTION 'คาดว่าจะแก้ 2 แถว แต่แก้ไป % แถว — ROLLBACK', n_updated;
  END IF;

  SELECT count(*) INTO n_live
  FROM chart_of_accounts WHERE code IN ('42-1106', '42-1107') AND "deletedAt" IS NULL;
  IF n_live <> 0 THEN
    RAISE EXCEPTION 'verify ไม่ผ่าน: ยังมีบัญชีที่ไม่ถูกลบเหลือ % แถว — ROLLBACK', n_live;
  END IF;

  SELECT count(*) INTO n_lines
  FROM journal_lines WHERE account_code IN ('42-1106', '42-1107');
  IF n_lines <> 0 THEN
    RAISE EXCEPTION 'verify ไม่ผ่าน: มี journal_lines โผล่มา % แถว — ROLLBACK', n_lines;
  END IF;

  RAISE NOTICE '✔ verify ผ่าน: soft-delete 42-1106 + 42-1107 ครบ 2 แถว, journal_lines อ้างถึง 0 แถว';
END $$;

COMMIT;

-- ดูผล
SELECT code, name, status, "deletedAt"
FROM chart_of_accounts
WHERE code IN ('42-1106', '42-1107')
ORDER BY code;

SELECT count(*) AS journal_lines_should_be_0
FROM journal_lines
WHERE account_code IN ('42-1106', '42-1107');

-- จำนวนบัญชี FINANCE ที่ใช้งานได้หลังลบ (ควรตรงกับจำนวนแถวใน finance-coa.csv)
SELECT count(*) AS finance_accounts_live
FROM chart_of_accounts
WHERE code NOT LIKE 'S%' AND "deletedAt" IS NULL;
