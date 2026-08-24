-- ============================================================================
-- ปลดระวาง S21-3001 → S21-1104 (คำวินิจฉัยผู้สอบบัญชี 2026-08-24 ข้อ A1 + B4)
-- ============================================================================
--   เดิม  S21-3001 "เจ้าหนี้ - FINANCE ค่าเครื่องรับคืน"  (ตั้งตาม *วัตถุประสงค์*)
--   ใหม่  S21-1104 "เจ้าหนี้ FINANCE"                     (ตั้งตาม *คู่สัญญา*)
--
--   ผู้สอบบัญชีตอบข้อ B4 ว่า "ผิด ใช้ S21-1104 เจ้าหนี้ FINANCE" และข้อ A1 ว่า
--   "ต้องมี ตั้งรหัส S21-1104" ⇒ บัญชีเดียวรับหนี้ที่ SHOP ติด FINANCE ทุกประเภท
--   (ราคารับซื้อเครื่อง / เงินเรียกคืนจากยกเลิกสัญญา / ปกส.-ภาษีจ่ายแทนกัน ข้อ C5)
--   บันทึกเต็ม: docs/accounting/cpa-answers-2026-08-24.md
--
-- ----------------------------------------------------------------------------
-- ⚠️  สคริปต์นี้ทำ "ปลดระวางแบบสะอาด" เท่านั้น — ไม่ย้ายรายการเก่า
-- ----------------------------------------------------------------------------
--   ถ้า S21-3001 **ไม่มี journal_lines เลย** → soft-delete ทิ้ง จบ (forward-only)
--   ถ้า S21-3001 **มี journal_lines** → RAISE EXCEPTION → ROLLBACK ทั้งหมด
--
--   เหตุผลที่ไม่ย้ายให้อัตโนมัติ: การย้าย account_code ของรายการที่ลงบัญชีไปแล้ว
--   = เขียนทับสมุดของงวดที่อาจปิดไปแล้ว ⇒ **เป็นคำตัดสินของผู้สอบบัญชี ไม่ใช่ของ
--   ทีมพัฒนา** และ ณ 2026-08-24 ผู้สอบ *ยังไม่ได้ตอบ* ว่าจะให้ย้ายหรือ forward-only
--   (เป็น 1 ใน 6 ข้อที่ต้องถามรอบ 2). แบบอย่างในโปรเจกต์มีทั้งสองทาง:
--     ย้าย        → apps/api/prisma/migrations-manual/2026-05-11-reclassify-sso-21-1104-to-21-3105.sql
--     ไม่ย้าย     → A.4 ตอนเปลี่ยนมาใช้ S21-3001 เมื่อ 2026-08-19 (forward-only)
--   ถ้าผู้สอบสั่งให้ย้าย → ใช้บล็อก (4) ท้ายไฟล์ที่คอมเมนต์ไว้ อย่าเขียนใหม่
--
-- ----------------------------------------------------------------------------
-- ลำดับการรันบน production (ห้ามสลับ)
-- ----------------------------------------------------------------------------
--   1) deploy โค้ด + CSV ชุดนี้ก่อน
--   2) `npm run seed:coa`  ← สร้าง S21-1104 (seeder เป็น upsert อ่านจาก CSV)
--   3) รันไฟล์นี้           ← ปลดระวาง S21-3001
--   4) รัน docs/accounting/shop-books-preflight-2026-08.sql ยืนยันผล
--
--   ถ้ารันไฟล์นี้ก่อนขั้น (2) จะ RAISE EXCEPTION เพราะ S21-1104 ยังไม่มีในผัง
--
-- วิธีรัน (ตาม runbook เดิม — ต้อง psql เท่านั้น):
--   1) cloud-sql-proxy --gcloud-auth --port 5544 bestchoice-prod:asia-southeast1:bestchoice-db
--   2) docker exec -i -e PGPASSWORD=<รหัสจาก Secret DATABASE_URL> installment-postgres \
--        psql -h host.docker.internal -p 5544 -U bestchoice -d bestchoice -f <ไฟล์นี้>
--
-- หมายเหตุคอลัมน์ (กับดักที่เคยทำ SQL รุ่นก่อนพัง):
--   `chart_of_accounts` ใช้ "deletedAt" (camelCase มี double quote) เพราะ Prisma
--   ไม่มี @map บนฟิลด์นี้ — migration 20260801100000 บรรทัด 47/58 drop "deleted_at"
--   แล้ว add "deletedAt". ส่วน journal_lines / journal_entries เป็น deleted_at
--   (snake_case) ตามปกติ. เขียนผิดตัว = column does not exist
--
-- นโยบายบ้าน: SOFT DELETE เท่านั้น (`.claude/rules/database.md` ห้าม hard delete)
--   + เซ็ต status='ไม่ใช้งาน' ควบคู่ เพราะบาง query กรอง deletedAt อย่างเดียว
--   บางอันกรอง status อย่างเดียว (findGrouped / getPeakMapping)
-- ============================================================================

\pset pager off

BEGIN;

DO $$
DECLARE
  n_old_total  int;
  n_old_live   int;
  n_new_live   int;
  n_lines      int;
  n_updated    int;
BEGIN
  -- (0) กันรันผิดฐาน -------------------------------------------------------
  IF current_database() <> 'bestchoice' THEN
    RAISE EXCEPTION 'ผิดฐานข้อมูล: current_database()=% (คาดว่า bestchoice)',
      current_database();
  END IF;

  -- (1) บัญชีปลายทางต้องมีอยู่ก่อน — ไม่งั้นแปลว่ายังไม่ได้รัน seed:coa ------
  SELECT count(*) INTO n_new_live
  FROM chart_of_accounts
  WHERE code = 'S21-1104' AND "deletedAt" IS NULL;

  IF n_new_live = 0 THEN
    RAISE EXCEPTION
      'ยังไม่มีบัญชี S21-1104 ในผัง — ต้อง deploy โค้ดชุดนี้แล้วรัน `npm run seed:coa` ก่อน';
  END IF;

  -- (2) สถานะบัญชีเก่า -----------------------------------------------------
  SELECT count(*) INTO n_old_total FROM chart_of_accounts WHERE code = 'S21-3001';
  SELECT count(*) INTO n_old_live
  FROM chart_of_accounts WHERE code = 'S21-3001' AND "deletedAt" IS NULL;

  IF n_old_total = 0 THEN
    RAISE NOTICE '== ไม่มีบัญชี S21-3001 ในผังเลย — prod ยังไม่เคยรัน seed:coa หลัง 2026-08-19 ==';
    RAISE NOTICE '== ไม่ต้องทำอะไร (บัญชีใหม่ S21-1104 พร้อมใช้แล้ว) ==';
    RETURN;
  END IF;

  IF n_old_live = 0 THEN
    RAISE NOTICE '== S21-3001 ถูกปลดระวางไปแล้ว (deletedAt ไม่ว่าง) — รันซ้ำ ไม่ทำอะไร ==';
    RETURN;
  END IF;

  -- (3) ด่านสำคัญ: มีรายการลงบัญชีอยู่ไหม ----------------------------------
  SELECT count(*) INTO n_lines
  FROM journal_lines
  WHERE account_code = 'S21-3001' AND deleted_at IS NULL;

  IF n_lines > 0 THEN
    RAISE EXCEPTION E'\n'
      '========================================================================\n'
      'หยุด — S21-3001 มี journal_lines อยู่ % แถว จึงปลดระวางเฉยๆ ไม่ได้\n'
      '\n'
      'ต้องให้ผู้สอบบัญชีตัดสินก่อนว่าจะเอาอย่างไรกับรายการเดิม:\n'
      '  (ก) ย้ายมาที่ S21-1104  → เปิดใช้บล็อก (4) ท้ายไฟล์นี้\n'
      '  (ข) ปล่อยไว้ที่เดิม forward-only → S21-3001 ยังต้องคงสถานะใช้งาน\n'
      '      เพื่อให้รายงานย้อนหลังอ่านชื่อบัญชีได้ (อย่า soft-delete)\n'
      '\n'
      'คำถามนี้อยู่ในชุดคำถามรอบ 2 — ดู docs/accounting/cpa-answers-2026-08-24.md\n'
      'หัวข้อ "A1 + B4 + C5" ข้อ 1\n'
      '========================================================================',
      n_lines;
  END IF;

  -- (4) ไม่มีรายการ → ปลดระวางได้อย่างสะอาด --------------------------------
  UPDATE chart_of_accounts
     SET "deletedAt" = now(),
         status      = 'ไม่ใช้งาน'
   WHERE code = 'S21-3001' AND "deletedAt" IS NULL;

  GET DIAGNOSTICS n_updated = ROW_COUNT;

  IF n_updated <> 1 THEN
    RAISE EXCEPTION 'คาดว่าจะแก้ 1 แถว แต่แก้ไป % แถว — ยกเลิกทั้งหมด', n_updated;
  END IF;

  RAISE NOTICE '== ปลดระวาง S21-3001 เรียบร้อย (ไม่มี journal_lines) ==';
  RAISE NOTICE '== บัญชีที่ใช้งานต่อไปคือ S21-1104 เจ้าหนี้ FINANCE ==';
END $$;

COMMIT;

-- ตรวจผลหลังรัน -------------------------------------------------------------
SELECT code, name, status, "deletedAt"
FROM chart_of_accounts
WHERE code IN ('S21-3001', 'S21-1104')
ORDER BY code;

SELECT 'journal_lines บน S21-3001' AS "รายการ", count(*) AS "จำนวน"
FROM journal_lines WHERE account_code = 'S21-3001' AND deleted_at IS NULL
UNION ALL
SELECT 'journal_lines บน S21-1104', count(*)
FROM journal_lines WHERE account_code = 'S21-1104' AND deleted_at IS NULL;


-- ============================================================================
-- บล็อก (4) — ย้ายรายการเก่า S21-3001 → S21-1104
-- ============================================================================
-- ⛔ **ห้ามรันจนกว่าผู้สอบบัญชีจะสั่งให้ย้าย (คำถามรอบ 2)**
--
-- โครงตาม apps/api/prisma/migrations-manual/2026-05-11-reclassify-sso-21-1104-to-21-3105.sql
-- จุดสำคัญ: ต่อท้าย description เป็นร่องรอย + ใช้ NOT ILIKE กันรันซ้ำ
--           + เขียน audit_logs สรุปหนึ่งแถว
--
-- BEGIN;
--
-- DO $$
-- DECLARE
--   n_moved int;
-- BEGIN
--   IF current_database() <> 'bestchoice' THEN
--     RAISE EXCEPTION 'ผิดฐานข้อมูล: %', current_database();
--   END IF;
--
--   IF NOT EXISTS (SELECT 1 FROM chart_of_accounts
--                   WHERE code = 'S21-1104' AND "deletedAt" IS NULL) THEN
--     RAISE EXCEPTION 'ยังไม่มี S21-1104 ในผัง — รัน seed:coa ก่อน';
--   END IF;
--
--   UPDATE journal_lines
--      SET account_code = 'S21-1104',
--          description  = COALESCE(description, '')
--                         || ' [ย้าย 2026-08-24 จาก S21-3001 ตามคำวินิจฉัยผู้สอบบัญชี ข้อ B4]'
--    WHERE account_code = 'S21-3001'
--      AND deleted_at IS NULL
--      AND COALESCE(description, '') NOT ILIKE '%[ย้าย 2026-08-24 จาก S21-3001%';
--
--   GET DIAGNOSTICS n_moved = ROW_COUNT;
--   RAISE NOTICE '== ย้าย journal_lines จำนวน % แถว ==', n_moved;
--
--   -- user_id เป็น NOT NULL — ต้องใส่ id ของผู้ใช้จริงที่รันงานนี้ (เช่น OWNER)
--   INSERT INTO audit_logs (id, user_id, action, entity, entity_id, new_value, created_at)
--   VALUES (
--     gen_random_uuid(),
--     '<ใส่ users.id ของคนที่รัน>',
--     'COA_RECLASSIFIED',
--     'chart_of_account',
--     'S21-3001->S21-1104',
--     jsonb_build_object(
--       'from_code', 'S21-3001',
--       'to_code',   'S21-1104',
--       'rows',      n_moved,
--       'ruling',    'CPA 2026-08-24 ข้อ A1+B4',
--       'doc',       'docs/accounting/cpa-answers-2026-08-24.md'
--     ),
--     now()
--   );
--
--   -- ย้ายครบแล้วจึงปลดระวางบัญชีเก่าได้
--   UPDATE chart_of_accounts
--      SET "deletedAt" = now(), status = 'ไม่ใช้งาน'
--    WHERE code = 'S21-3001' AND "deletedAt" IS NULL;
-- END $$;
--
-- COMMIT;
--
-- หมายเหตุคอลัมน์ (ตรวจกับ schema.prisma แล้ว 2026-08-24):
--   `user_id` NOT NULL — ต้องใส่ users.id จริง ไม่มี default
--   `entity_id` = @map ของ entityId, `new_value` = @map ของ newValue
--   audit_logs มี trigger กัน UPDATE/DELETE (immutable) — INSERT อย่างเดียวเท่านั้น
--   แถวที่ INSERT ตรงแบบนี้จะมี row_hash / sequence_number เป็น NULL ⇒ **หลุด Merkle chain**
--   (verifyChain กรองออก) ซึ่งยอมรับได้สำหรับงาน migration ครั้งเดียวที่มี SQL เป็นหลักฐานอยู่แล้ว
--   — ดู `.claude/rules/database.md` หัวข้อ "AuditLog — เขียนหลัง commit หรือใน tx"
-- ============================================================================
