-- Rename DailyAssignment table + indexes + constraints to snake_case to match
-- the rest of the project (users, contracts, chat_messages, etc.).
-- Original migration 20260610000000 created PascalCase by oversight; this
-- aligns it with @@map("daily_assignments") in schema.prisma.

ALTER TABLE "DailyAssignment" RENAME TO "daily_assignments";

ALTER TABLE "daily_assignments" RENAME CONSTRAINT "DailyAssignment_pkey" TO "daily_assignments_pkey";
ALTER TABLE "daily_assignments" RENAME CONSTRAINT "DailyAssignment_collectorId_fkey" TO "daily_assignments_collectorId_fkey";
ALTER TABLE "daily_assignments" RENAME CONSTRAINT "DailyAssignment_contractId_fkey" TO "daily_assignments_contractId_fkey";

ALTER INDEX "DailyAssignment_collectorId_date_idx" RENAME TO "daily_assignments_collectorId_date_idx";
ALTER INDEX "DailyAssignment_date_status_idx" RENAME TO "daily_assignments_date_status_idx";
ALTER INDEX "DailyAssignment_escalationFlag_date_idx" RENAME TO "daily_assignments_escalationFlag_date_idx";
ALTER INDEX "DailyAssignment_date_contractId_key" RENAME TO "daily_assignments_date_contractId_key";
