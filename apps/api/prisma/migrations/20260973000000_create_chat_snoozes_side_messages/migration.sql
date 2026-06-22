-- Create the `chat_snoozes` and `chat_side_messages` tables.
--
-- These two models (ChatSnooze / ChatSideMessage) were originally created via `prisma db push`
-- (staff-chat "Batch 2 — snooze reminders", commit 2d0816e9) and never got a CREATE TABLE
-- migration. The only prior migration touching them
-- (20260421000000_room_based_chat_and_warranty) just RENAMEs a column with `IF EXISTS`, which
-- is a silent no-op on a DB built purely from migrations. As a result, any DB provisioned via
-- `prisma migrate deploy` (CI, a fresh/go-live DB, or a prod re-provision) was MISSING both
-- tables — making SnoozeCronService throw Prisma P2021 every minute and the staff-chat snooze /
-- side-conversation HTTP endpoints return 500.
--
-- This migration is fully idempotent (CREATE TABLE/INDEX IF NOT EXISTS + guarded FK adds) so it
-- is also safe to apply to environments where the tables already exist from an earlier
-- `db push` or hand-fix (local dev was hand-patched 2026-06-12).

-- CreateTable
CREATE TABLE IF NOT EXISTS "chat_snoozes" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "remind_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_snoozes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "chat_side_messages" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chat_side_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_snoozes_remind_at_completed_idx" ON "chat_snoozes"("remind_at", "completed");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_snoozes_staff_id_idx" ON "chat_snoozes"("staff_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_side_messages_room_id_idx" ON "chat_side_messages"("room_id");

-- AddForeignKey (guarded so re-applying on a db-push'd env is a no-op)
DO $$ BEGIN
  ALTER TABLE "chat_snoozes" ADD CONSTRAINT "chat_snoozes_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "chat_snoozes" ADD CONSTRAINT "chat_snoozes_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "chat_side_messages" ADD CONSTRAINT "chat_side_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "chat_side_messages" ADD CONSTRAINT "chat_side_messages_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
