-- T2-C4 ext: Merkle hash chain over AuditLog rows. Each row computes
-- rowHash = SHA-256(sequenceNumber || id || userId || action || entity
--                  || entityId || oldValue || newValue || createdAt
--                  || prevRowHash)
-- Tampering with any middle row breaks every row after it. A nightly cron
-- walks the chain and Sentry-alerts on mismatch.
--
-- sequenceNumber is a dedicated bigint instead of createdAt-ordering because
-- two inserts in the same ms would otherwise be ambiguous under ORDER BY
-- createdAt. We use a Postgres sequence so it's monotonic + gap-free.

ALTER TABLE "audit_logs"
  ADD COLUMN "sequence_number" BIGINT,
  ADD COLUMN "row_hash"        TEXT,
  ADD COLUMN "prev_row_hash"   TEXT;

CREATE INDEX "audit_logs_sequence_number_idx" ON "audit_logs"("sequence_number");

-- Dedicated sequence (not SERIAL PK) — PK stays uuid for code compatibility.
CREATE SEQUENCE IF NOT EXISTS "audit_logs_seq" START 1;

-- Backfill existing rows: assign sequence in createdAt,id order. Hash is
-- left NULL for historical rows — verification skips NULL hashes, so the
-- chain is defined from the first row with a hash forward. New rows
-- (written by AuditService after this migration) get both.
UPDATE "audit_logs"
SET "sequence_number" = subquery.seq
FROM (
  SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS seq
  FROM "audit_logs"
) AS subquery
WHERE "audit_logs".id = subquery.id;

-- Advance the sequence to sit above backfilled rows.
SELECT setval('audit_logs_seq', COALESCE((SELECT MAX(sequence_number) FROM "audit_logs"), 0) + 1, false);
