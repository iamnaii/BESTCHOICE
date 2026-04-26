-- Task 2: Yeastar PBX CDR fields on CallLog + CallDirection enum
-- Adds structured PBX call metadata separate from agent voice memos.

-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- AlterTable
ALTER TABLE "call_logs"
  ADD COLUMN "yeastar_call_id"         TEXT,
  ADD COLUMN "call_direction"          "CallDirection",
  ADD COLUMN "duration"                INTEGER,
  ADD COLUMN "recording_url"           TEXT,
  ADD COLUMN "recording_storage_tier"  TEXT DEFAULT 'STANDARD',
  ADD COLUMN "recording_downloaded_at" TIMESTAMP(3),
  ADD COLUMN "yeastar_recording_path"  TEXT,
  ADD COLUMN "auto_logged"             BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "call_logs_yeastar_call_id_key" ON "call_logs"("yeastar_call_id");
