-- W5: drop OtherIncomeStatus.APPROVED — never persisted (transient inside approve() tx).
-- Postgres can't drop an enum value in place; recreate the enum and swap.

BEGIN;

-- W-R1: bound the ACCESS EXCLUSIVE LOCK wait — long-running reads during a
-- Cloud Run rolling deploy would otherwise queue requests indefinitely.
-- 5s is enough to grab the lock on a healthy connection pool, and fails fast
-- (causing the migration to abort + alert) when a stuck reader holds it.
SET LOCAL lock_timeout = '5s';

-- Safety: defend against any historical row stuck in APPROVED
-- (would only happen if a previous deploy crashed inside approve()).
-- Promote those rows to POSTED so the downstream NOT NULL check survives.
UPDATE "other_incomes"
SET "status" = 'POSTED'
WHERE "status" = 'APPROVED';

-- Create the new enum without APPROVED
CREATE TYPE "OtherIncomeStatus_new" AS ENUM ('DRAFT', 'READY', 'POSTED', 'REVERSED');

-- Swap the column over to the new enum
ALTER TABLE "other_incomes"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "OtherIncomeStatus_new"
    USING ("status"::text::"OtherIncomeStatus_new"),
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Replace the old type
DROP TYPE "OtherIncomeStatus";
ALTER TYPE "OtherIncomeStatus_new" RENAME TO "OtherIncomeStatus";

COMMIT;
