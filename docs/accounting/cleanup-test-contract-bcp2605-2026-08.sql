-- ============================================================================
-- ลบข้อมูลช่วงทดสอบระบบ: สัญญา BCP2605-00001 (คำสั่ง CPA/owner 2026-08-01)
-- mirror-reverse JE ทั้ง 3 ใบ (1A + 2A + JP4) → ทุกบัญชีของสัญญา net 0
-- ปลอดภัย: verify ใน transaction — ถ้าไม่ net 0 หรือ JE ใหม่ไม่บาลานซ์ จะ ROLLBACK เอง
--
-- วิธีรัน (ตาม runbook เดิม — ต้อง psql เท่านั้น):
--   1) cloud-sql-proxy --gcloud-auth --port 5544 bestchoice-prod:asia-southeast1:bestchoice-db
--   2) docker exec -i -e PGPASSWORD=<รหัสจาก Secret DATABASE_URL> installment-postgres \
--        psql -h host.docker.internal -p 5544 -U bestchoice -d bestchoice -f <ไฟล์นี้>
--
-- หมายเหตุ: JE ย้อนกลับลงวันที่ปัจจุบัน (convention เดียวกับ year-end reversal)
--           ตัวสัญญา (contracts row) ไม่ถูกแตะ — ลบเฉพาะผลทางบัญชี
-- ============================================================================
BEGIN;

CREATE TEMP TABLE _src AS
SELECT je.id AS src_id, je.entry_number AS src_no, je.company_id, je.created_by_id,
       row_number() OVER (ORDER BY je.entry_date) AS rn
FROM journal_entries je
WHERE je.metadata->>'contractId' = 'd5b6ca40-37d6-4edb-9ad4-81aa7d013077'
  AND je.deleted_at IS NULL AND je.status = 'POSTED'
  AND (je.metadata->>'tag' IS DISTINCT FROM 'REVERSAL')
  AND (je.metadata->>'flow' IS DISTINCT FROM 'test-era-cleanup');  -- กันรันซ้ำ

-- กันรันซ้ำชั้นสอง: ถ้าเคย cleanup แล้ว _src ต้องว่าง
DO $$
DECLARE done int;
BEGIN
  SELECT count(*) INTO done FROM journal_entries WHERE metadata->>'flow' = 'test-era-cleanup';
  IF done > 0 THEN RAISE EXCEPTION 'cleanup นี้เคยรันแล้ว (% JE) — ห้ามรันซ้ำ', done; END IF;
END $$;

CREATE TEMP TABLE _newje AS
SELECT gen_random_uuid() AS new_id, s.*,
       'JE-' || to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYYMM') || '-' ||
       lpad((COALESCE((SELECT max(substring(entry_number FROM 11)::int) FROM journal_entries
                       WHERE entry_number LIKE 'JE-' || to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYYMM') || '-%'), 0) + s.rn)::text, 5, '0') AS new_no
FROM _src s;

INSERT INTO journal_entries (id, entry_number, company_id, entry_date, description, status,
                             posted_at, posted_by_id, created_by_id, created_at, updated_at, metadata)
SELECT n.new_id, n.new_no, n.company_id, now(),
       'REVERSAL ' || n.src_no || ' — ลบข้อมูลช่วงทดสอบระบบ BCP2605-00001 (คำสั่ง CPA/owner 2026-08-01)',
       'POSTED', now(), n.created_by_id, n.created_by_id, now(), now(),
       jsonb_build_object('tag', 'REVERSAL', 'flow', 'test-era-cleanup',
                          'reversesEntryId', n.src_id,
                          'contractId', 'd5b6ca40-37d6-4edb-9ad4-81aa7d013077')
FROM _newje n;

INSERT INTO journal_lines (id, journal_entry_id, account_code, description, debit, credit, created_at, updated_at)
SELECT gen_random_uuid(), n.new_id, jl.account_code,
       'REVERSAL: ' || COALESCE(jl.description, ''), jl.credit, jl.debit, now(), now()
FROM _newje n
JOIN journal_lines jl ON jl.journal_entry_id = n.src_id AND jl.deleted_at IS NULL;

-- Verify: (1) ทุกบัญชีของสัญญานี้ net 0  (2) JE ใหม่ทุกใบ Dr=Cr — ไม่ผ่าน = ROLLBACK ทั้งหมด
DO $$
DECLARE bad int; unbal int; njes int;
BEGIN
  SELECT count(*) INTO njes FROM journal_entries WHERE metadata->>'flow' = 'test-era-cleanup';
  IF njes <> 3 THEN RAISE EXCEPTION 'คาด 3 reversal JEs ได้ % — ROLLBACK', njes; END IF;
  SELECT count(*) INTO bad FROM (
    SELECT jl.account_code
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.metadata->>'contractId' = 'd5b6ca40-37d6-4edb-9ad4-81aa7d013077'
      AND je.deleted_at IS NULL AND jl.deleted_at IS NULL AND je.status = 'POSTED'
    GROUP BY 1 HAVING abs(SUM(jl.debit - jl.credit)) > 0.001) x;
  SELECT count(*) INTO unbal FROM (
    SELECT jl.journal_entry_id
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.metadata->>'flow' = 'test-era-cleanup'
    GROUP BY 1 HAVING abs(SUM(jl.debit - jl.credit)) > 0.001) y;
  IF bad > 0 OR unbal > 0 THEN
    RAISE EXCEPTION 'verify ไม่ผ่าน: accounts_not_zero=% unbalanced_jes=% — ROLLBACK', bad, unbal;
  END IF;
  RAISE NOTICE '✔ verify ผ่าน: สัญญาทดสอบ net 0 ทุกบัญชี, reversal JEs บาลานซ์ครบ';
END $$;

COMMIT;

-- ดูผล
SELECT entry_number, entry_date::date, description FROM journal_entries
WHERE metadata->>'flow' = 'test-era-cleanup' ORDER BY entry_number;
SELECT to_char(COALESCE(SUM(jl.credit - jl.debit), 0), 'FM990.00') AS payable_remaining_should_be_0
FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
WHERE jl.account_code IN ('21-1101', '21-1102') AND jl.deleted_at IS NULL
  AND je.status = 'POSTED' AND je.deleted_at IS NULL;
