-- Rename DailyAssignment table + indexes + constraints to snake_case to match
-- the rest of the project (users, contracts, chat_messages, etc.).
-- Original migration 20260610000000_add_daily_assignment created PascalCase
-- by oversight; this aligns it with @@map("daily_assignments") in
-- schema.prisma.
--
-- Idempotent (DO block + IF EXISTS check) so it is safe to run against:
--   1. Fresh CI test DB — runs after 20260610000000 creates PascalCase
--   2. Prod that already ran the now-removed 20260426000001 variant
--      (the rename has already happened — block becomes a no-op)
--   3. Prod that has not migrated yet — performs the rename in place

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'DailyAssignment') THEN
    ALTER TABLE "DailyAssignment" RENAME TO "daily_assignments";

    ALTER TABLE "daily_assignments" RENAME CONSTRAINT "DailyAssignment_pkey" TO "daily_assignments_pkey";
    ALTER TABLE "daily_assignments" RENAME CONSTRAINT "DailyAssignment_collectorId_fkey" TO "daily_assignments_collectorId_fkey";
    ALTER TABLE "daily_assignments" RENAME CONSTRAINT "DailyAssignment_contractId_fkey" TO "daily_assignments_contractId_fkey";

    ALTER INDEX "DailyAssignment_collectorId_date_idx" RENAME TO "daily_assignments_collectorId_date_idx";
    ALTER INDEX "DailyAssignment_date_status_idx" RENAME TO "daily_assignments_date_status_idx";
    ALTER INDEX "DailyAssignment_escalationFlag_date_idx" RENAME TO "daily_assignments_escalationFlag_date_idx";
    ALTER INDEX "DailyAssignment_date_contractId_key" RENAME TO "daily_assignments_date_contractId_key";
  END IF;
END $$;
