-- สรุปรายวัน (GET /payments/daily-summary) reads Receipt by `paid_date` range
-- as of 2026-08-18 (was: Payment by paid_date). `receipts` had indexes on
-- contract_id / receipt_number / payment_id / created_at only, so the daily
-- report filtered `paid_date` with a sequential scan.
--
-- Compound (paid_date, is_voided): the query always pairs the range with
-- `isVoided = false`, so both predicates are satisfied from the index instead of
-- re-checking is_voided on every heap row. Additive + IF NOT EXISTS — safe to
-- re-run and safe on a non-empty table.
CREATE INDEX IF NOT EXISTS "receipts_paid_date_is_voided_idx" ON "receipts"("paid_date", "is_voided");
