-- P3-SP5 W8 — defense-in-depth: DB-level unique index on JE idempotency.
--
-- The 6 SHOP templates + several FINANCE templates use a paired
-- `metadata.flow` + `metadata.idempotencyKey` probe to detect re-posts.
-- The application-level probe inside `$transaction` already prevents
-- double-posts during normal operation. This index is the second line of
-- defense: even if two concurrent transactions race past the probe (e.g.
-- two callers stamp the same key in the same instant), the unique index
-- ensures only one insert wins and the other gets a P2002 error which
-- the caller can translate into the same "idempotency hit" return path.
--
-- Partial — only applies when BOTH `flow` and `idempotencyKey` are
-- non-null. Manual journals and other entries that don't use this
-- pattern are unaffected.
--
-- Idempotent: IF NOT EXISTS guards against re-run.
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_idempotency_idx"
  ON "journal_entries" ((metadata->>'flow'), (metadata->>'idempotencyKey'))
  WHERE metadata->>'flow' IS NOT NULL
    AND metadata->>'idempotencyKey' IS NOT NULL;
