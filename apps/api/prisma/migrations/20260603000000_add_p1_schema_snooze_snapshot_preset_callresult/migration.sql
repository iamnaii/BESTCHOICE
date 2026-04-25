-- ============================================================
-- P1 Collections UI Enhancements (2026-04-25)
-- - ContractSnooze: per-user contract-card snooze
-- - ContractDailySnapshot: immutable daily aging rollup (trend arrow + analytics)
-- - FilterPreset: saved filter UI presets
-- - CallLog enums: callResult + negotiationResult quick-tags
-- ============================================================

-- CreateEnum
CREATE TYPE "FilterPresetScope" AS ENUM ('PRIVATE', 'SHARED_BRANCH', 'SHARED_ALL');

-- CreateEnum
CREATE TYPE "CallResult" AS ENUM ('ANSWERED', 'NO_ANSWER', 'BUSY', 'DEVICE_OFF', 'UNREACHABLE');

-- CreateEnum
CREATE TYPE "NegotiationResult" AS ENUM ('REQUESTED_EXTENSION', 'WILL_PAY', 'REFUSED', 'REQUESTED_RETURN', 'NEGOTIATING', 'NOT_APPLICABLE');

-- AlterTable: extend CallLog with structured quick-tag enums
ALTER TABLE "call_logs"
  ADD COLUMN "call_result" "CallResult",
  ADD COLUMN "negotiation_result" "NegotiationResult";

-- CreateTable: per-user contract-card snooze
CREATE TABLE "contract_snoozes" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "snoozed_until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contract_snoozes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: immutable daily snapshot of overdue state
CREATE TABLE "contract_daily_snapshots" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "days_overdue" INTEGER NOT NULL,
    "outstanding" DECIMAL(12,2) NOT NULL,
    "status" "ContractStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_daily_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable: saved filter UI presets
CREATE TABLE "filter_presets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "scope" "FilterPresetScope" NOT NULL DEFAULT 'PRIVATE',
    "branch_id" TEXT,
    "page" TEXT NOT NULL,
    "filter_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "filter_presets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_snoozes_user_id_snoozed_until_idx" ON "contract_snoozes"("user_id", "snoozed_until");
CREATE INDEX "contract_snoozes_contract_id_deleted_at_idx" ON "contract_snoozes"("contract_id", "deleted_at");

-- CreateIndex
CREATE INDEX "contract_daily_snapshots_date_idx" ON "contract_daily_snapshots"("date");
CREATE INDEX "contract_daily_snapshots_contract_id_date_idx" ON "contract_daily_snapshots"("contract_id", "date" DESC);
CREATE UNIQUE INDEX "contract_daily_snapshots_contract_id_date_key" ON "contract_daily_snapshots"("contract_id", "date");

-- CreateIndex
CREATE INDEX "filter_presets_owner_user_id_page_idx" ON "filter_presets"("owner_user_id", "page");
CREATE INDEX "filter_presets_scope_branch_id_idx" ON "filter_presets"("scope", "branch_id");

-- AddForeignKey
ALTER TABLE "contract_snoozes" ADD CONSTRAINT "contract_snoozes_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_snoozes" ADD CONSTRAINT "contract_snoozes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_daily_snapshots" ADD CONSTRAINT "contract_daily_snapshots_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filter_presets" ADD CONSTRAINT "filter_presets_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "filter_presets" ADD CONSTRAINT "filter_presets_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
