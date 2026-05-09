-- Rename ContractStatus enum value LEGAL → TERMINATED to align with
-- termination_policy.docx (the canonical CPA-provided document). The PDF
-- spec used 'LEGAL' but the manual uses 'TERMINATED'; mismatch caused
-- 2A cron filter and JP5 strict guard to bypass on contracts that were
-- legally terminated, violating ป.36 ข้อ 2(6).
--
-- Postgres ALTER TYPE ... RENAME VALUE is atomic + preserves all rows that
-- already use the old value (they automatically reflect the new name).
-- Available on Postgres 10+.
ALTER TYPE "ContractStatus" RENAME VALUE 'LEGAL' TO 'TERMINATED';

-- Rename the JP5 strict-mode SystemConfig key to match. Idempotent: only
-- updates if the legacy key exists; new installs never had the old key.
UPDATE "system_config"
SET "key" = 'jp5_require_terminated_status'
WHERE "key" = 'jp5_require_legal_status';
