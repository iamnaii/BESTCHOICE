-- ============================================================
-- Collections Foundation: new enums, new tables, column adds
-- ============================================================

-- CreateEnum
CREATE TYPE "DunningEventTrigger" AS ENUM ('CALL_NO_ANSWER', 'CALL_ANSWERED_PROMISE', 'CALL_REFUSED', 'DEVICE_LOCKED', 'DEVICE_UNLOCKED', 'BROKEN_PROMISE', 'LETTER_DISPATCHED', 'CONTRACT_TERMINATED');

-- CreateEnum
CREATE TYPE "MdmLockTrigger" AS ENUM ('UNCONTACTABLE_3D', 'NO_PROMISE_3D', 'MANUAL_COLLECTOR', 'MANUAL_OWNER', 'BROKEN_PROMISE');

-- CreateEnum
CREATE TYPE "MdmLockStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED_MANUAL', 'EXECUTED_API', 'FAILED', 'UNLOCKED');

-- CreateEnum
CREATE TYPE "LetterType" AS ENUM ('RETURN_DEVICE_45D', 'CONTRACT_TERMINATION_60D');

-- CreateEnum
CREATE TYPE "LetterStatus" AS ENUM ('PENDING_DISPATCH', 'PDF_GENERATED', 'DISPATCHED', 'DELIVERED', 'UNDELIVERABLE', 'CANCELLED');

-- AlterTable: contracts — collections tracking columns
ALTER TABLE "contracts"
  ADD COLUMN "no_answer_count"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "needs_skip_tracing"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "device_locked"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "device_locked_at"     TIMESTAMP(3),
  ADD COLUMN "wallpaper_changed"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "wallpaper_changed_at" TIMESTAMP(3);

-- AlterTable: users — system user flag
ALTER TABLE "users"
  ADD COLUMN "is_system_user" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: dunning_rules — make trigger_day optional, add event_trigger
ALTER TABLE "dunning_rules"
  ADD COLUMN "event_trigger" "DunningEventTrigger",
  ALTER COLUMN "trigger_day" DROP NOT NULL;

-- CreateIndex on dunning_rules event_trigger
CREATE INDEX "dunning_rules_event_trigger_idx" ON "dunning_rules"("event_trigger");

-- CreateTable: mdm_lock_requests
CREATE TABLE "mdm_lock_requests" (
    "id"                TEXT NOT NULL,
    "contract_id"       TEXT NOT NULL,
    "status"            "MdmLockStatus" NOT NULL DEFAULT 'PENDING',
    "trigger"           "MdmLockTrigger" NOT NULL,
    "include_wallpaper" BOOLEAN NOT NULL DEFAULT true,
    "proposed_by_id"    TEXT NOT NULL,
    "proposed_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id"    TEXT,
    "approved_at"       TIMESTAMP(3),
    "rejected_by_id"    TEXT,
    "rejected_reason"   TEXT,
    "reason"            TEXT NOT NULL,
    "external_ref"      TEXT,
    "wallpaper_url_used" TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,
    "deleted_at"        TIMESTAMP(3),

    CONSTRAINT "mdm_lock_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on mdm_lock_requests
CREATE INDEX "mdm_lock_requests_contract_id_status_idx" ON "mdm_lock_requests"("contract_id", "status");
CREATE INDEX "mdm_lock_requests_status_proposed_at_idx"  ON "mdm_lock_requests"("status", "proposed_at");

-- AddForeignKey on mdm_lock_requests
ALTER TABLE "mdm_lock_requests"
  ADD CONSTRAINT "mdm_lock_requests_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mdm_lock_requests"
  ADD CONSTRAINT "mdm_lock_requests_proposed_by_id_fkey"
  FOREIGN KEY ("proposed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mdm_lock_requests"
  ADD CONSTRAINT "mdm_lock_requests_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: contract_letters
CREATE TABLE "contract_letters" (
    "id"                TEXT NOT NULL,
    "contract_id"       TEXT NOT NULL,
    "letter_type"       "LetterType" NOT NULL,
    "letter_number"     TEXT NOT NULL,
    "status"            "LetterStatus" NOT NULL DEFAULT 'PENDING_DISPATCH',
    "triggered_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdf_url"           TEXT,
    "pdf_generated_at"  TIMESTAMP(3),
    "dispatched_at"     TIMESTAMP(3),
    "dispatched_by_id"  TEXT,
    "tracking_number"   TEXT,
    "evidence_photo_url" TEXT,
    "delivered_at"      TIMESTAMP(3),
    "cancelled_at"      TIMESTAMP(3),
    "cancel_reason"     TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,
    "deleted_at"        TIMESTAMP(3),

    CONSTRAINT "contract_letters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on contract_letters
CREATE UNIQUE INDEX "contract_letters_letter_number_key"
  ON "contract_letters"("letter_number");

CREATE INDEX "contract_letters_status_triggered_at_idx"
  ON "contract_letters"("status", "triggered_at");

CREATE INDEX "contract_letters_dispatched_at_idx"
  ON "contract_letters"("dispatched_at");

CREATE UNIQUE INDEX "contract_letters_contract_id_letter_type_key"
  ON "contract_letters"("contract_id", "letter_type");

-- AddForeignKey on contract_letters
ALTER TABLE "contract_letters"
  ADD CONSTRAINT "contract_letters_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contract_letters"
  ADD CONSTRAINT "contract_letters_dispatched_by_id_fkey"
  FOREIGN KEY ("dispatched_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enforce exactly one of trigger_day / event_trigger is set on dunning_rules
ALTER TABLE "dunning_rules"
  ADD CONSTRAINT "dunning_rules_trigger_exclusive_chk"
  CHECK ((trigger_day IS NOT NULL)::int + (event_trigger IS NOT NULL)::int = 1);
