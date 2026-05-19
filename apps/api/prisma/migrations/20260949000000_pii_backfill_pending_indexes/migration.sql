-- Phase 3 SP4 — DEEP review W10
--
-- Partial indexes on the 4 high-cardinality PII columns the backfill
-- cursor scans. Each index covers rows where the plaintext column is
-- non-NULL but the encrypted counterpart is still NULL — i.e. exactly
-- the rows the backfill needs to find. Without them, the cursor query
-- table-scans `customers` on every batch (~100k rows in prod).
--
-- Partial index size scales with PENDING work, not total customers, so
-- it collapses to ~0 bytes once the backfill is complete (Postgres
-- doesn't index NULL columns under the WHERE predicate). Drop is not
-- required after Phase 6.6 plaintext-column removal — the predicate
-- becomes unsatisfiable and the index naturally goes empty.
--
-- IF NOT EXISTS keeps the migration idempotent — safe to re-apply
-- against environments that already have a partial set of indexes.
--
-- NOTE: not all 10 PII columns get an index. The 4 here cover the
-- common backfill-pending paths (national_id / phone are dedup-keyed;
-- email + address_id_card are the next-most-populated). The other 6
-- columns are guardian / secondary fields that are usually populated
-- only when nationalId or phone is — the OR clause in the cursor
-- planner will use one of these 4 indexes and filter the rest. Adding
-- 10 indexes wastes catalog space without measurable benefit.

CREATE INDEX IF NOT EXISTS customers_backfill_pending_national_id_idx
  ON customers (id)
  WHERE national_id_encrypted IS NULL
    AND national_id IS NOT NULL
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customers_backfill_pending_phone_idx
  ON customers (id)
  WHERE phone_encrypted IS NULL
    AND phone IS NOT NULL
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customers_backfill_pending_email_idx
  ON customers (id)
  WHERE email_encrypted IS NULL
    AND email IS NOT NULL
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customers_backfill_pending_address_id_card_idx
  ON customers (id)
  WHERE address_id_card_encrypted IS NULL
    AND address_id_card IS NOT NULL
    AND deleted_at IS NULL;
