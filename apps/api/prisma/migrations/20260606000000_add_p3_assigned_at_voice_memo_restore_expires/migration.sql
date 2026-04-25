-- ============================================================
-- P3 Cluster α (2026-04-25)
-- T2: contracts.assigned_at — track when collections agent was assigned
--     so auto-balance can apply a 24h "recently re-assigned" exclusion
--     and avoid thrashing collectors who just took the case.
-- ============================================================

ALTER TABLE "contracts" ADD COLUMN "assigned_at" TIMESTAMP(3);

-- Backfill: assume any contract that already has an assignee was assigned
-- at its last update. This is conservative — newly-imported assignments
-- will appear "old" and therefore eligible for rebalance, which matches
-- the desired behaviour (24h cool-down only protects recent reassignments).
UPDATE "contracts" SET "assigned_at" = "updated_at" WHERE "assigned_to_id" IS NOT NULL;
