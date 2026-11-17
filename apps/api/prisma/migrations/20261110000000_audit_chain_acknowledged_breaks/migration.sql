-- Audit chain: acknowledged ("known") break points.
--
-- AuditChainVerifyCron has reported `AuditLog chain broken at seq=3194` every
-- night since ~2026-09-05. Root cause (suspected): concurrent-write race in
-- AuditService.log() under READ COMMITTED — the row at seq 3194 was sealed
-- without seeing seq 3193, so it stored prev_row_hash that does not match
-- seq 3193's row_hash. The owner chose to ACKNOWLEDGE that one link instead of
-- recomputing hashes: audit_logs history is NOT modified by this migration.
--
-- verifyChain() skips the prev-link comparison ONLY for a row whose id,
-- row_hash, stored prev_row_hash and the previous row's row_hash all still
-- equal the values captured here. The row's own content hash is still
-- verified, and every other break (and any later change to this row) still
-- alerts. Plan: /shared/reports/dev/2026-11-03-audit-chain-known-break-plan.md
--
-- Rollback: `DELETE FROM audit_chain_acknowledged_breaks WHERE sequence_number = 3194;`
-- (DELETE is intentionally allowed — removing an acknowledgement only makes
-- the verifier stricter.) Full removal: DROP TABLE + DROP FUNCTION below.

-- 1. Append-only table
CREATE TABLE "audit_chain_acknowledged_breaks" (
    "id"                     TEXT NOT NULL,
    "sequence_number"        BIGINT NOT NULL,
    "audit_log_id"           TEXT NOT NULL,
    "break_type"             TEXT NOT NULL,
    "expected_prev_row_hash" TEXT NOT NULL,
    "actual_prev_row_hash"   TEXT,
    "row_hash_at_ack"        TEXT NOT NULL,
    "reason"                 TEXT NOT NULL,
    "acknowledged_by"        TEXT NOT NULL,
    "acknowledged_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_chain_acknowledged_breaks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_chain_acknowledged_breaks_break_type_check"
        CHECK ("break_type" = 'PREV_LINK_MISMATCH')
);

CREATE UNIQUE INDEX "audit_chain_acknowledged_breaks_sequence_number_key"
    ON "audit_chain_acknowledged_breaks"("sequence_number");

ALTER TABLE "audit_chain_acknowledged_breaks"
    ADD CONSTRAINT "audit_chain_acknowledged_breaks_audit_log_id_fkey"
    FOREIGN KEY ("audit_log_id") REFERENCES "audit_logs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Block UPDATE (an acknowledgement can never be rewritten after the fact).
CREATE OR REPLACE FUNCTION audit_chain_ack_block_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_chain_acknowledged_breaks is append-only — UPDATE is not allowed. DELETE the row (rollback) and INSERT a new one instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_chain_ack_no_update ON "audit_chain_acknowledged_breaks";
CREATE TRIGGER audit_chain_ack_no_update
BEFORE UPDATE ON "audit_chain_acknowledged_breaks"
FOR EACH ROW
EXECUTE FUNCTION audit_chain_ack_block_update();

-- 3. Acknowledge seq=3194 (prod). Guarded INSERT … SELECT: hashes are read
--    from the DB at migrate time. Inserts 0 rows (no-op, alert keeps firing)
--    unless the row is exactly the expected v2 prev-link break. On any other
--    database (CI, local, staging) this is a no-op.
INSERT INTO "audit_chain_acknowledged_breaks"
    ("id", "sequence_number", "audit_log_id", "break_type",
     "expected_prev_row_hash", "actual_prev_row_hash", "row_hash_at_ack",
     "reason", "acknowledged_by")
SELECT gen_random_uuid()::text,
       cur."sequence_number",
       cur."id",
       'PREV_LINK_MISMATCH',
       prev."row_hash",
       cur."prev_row_hash",
       cur."row_hash",
       'Known break from concurrent-write race, acknowledged 2026-11; history not modified',
       'Akenarin (พี่นาย)'
FROM "audit_logs" cur
JOIN "audit_logs" prev ON prev."sequence_number" = cur."sequence_number" - 1
WHERE cur."sequence_number" = 3194
  AND cur."id" = 'fde6aa60-1abf-4623-8399-6ad536759761'
  AND cur."row_hash" LIKE 'v2:%'
  AND prev."row_hash" IS NOT NULL
  AND cur."prev_row_hash" IS DISTINCT FROM prev."row_hash"
ON CONFLICT ("sequence_number") DO NOTHING;
