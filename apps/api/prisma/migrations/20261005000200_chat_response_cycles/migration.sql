-- CreateEnum
CREATE TYPE "ChatOutboundAttemptState" AS ENUM ('SENDING', 'FAILED', 'UNKNOWN', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ChatResponseOrigin" AS ENUM ('LIVE', 'LEGACY_OPEN');

-- CreateEnum
CREATE TYPE "ChatResponseEndReason" AS ENUM ('HUMAN_REPLY', 'RESOLVED', 'MERGED');

-- AlterTable
ALTER TABLE "chat_rooms" ADD COLUMN     "inbound_sequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "answered_through_message_id" TEXT,
ADD COLUMN     "answered_through_sequence" INTEGER,
ADD COLUMN     "cycle_id" TEXT,
ADD COLUMN     "inbound_sequence" INTEGER,
ADD COLUMN     "outbound_attempt_at" TIMESTAMP(3),
ADD COLUMN     "outbound_attempt_state" "ChatOutboundAttemptState";

-- CreateTable
CREATE TABLE "chat_response_cycles" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "first_customer_message_id" TEXT,
    "first_bot_sent_at" TIMESTAMP(3),
    "first_human_sent_at" TIMESTAMP(3),
    "first_human_staff_id" TEXT,
    "assigned_at_open_id" TEXT,
    "ended_at" TIMESTAMP(3),
    "end_reason" "ChatResponseEndReason",
    "origin" "ChatResponseOrigin" NOT NULL DEFAULT 'LIVE',
    "policy_version" TEXT NOT NULL,
    "alert_eligible_at" TIMESTAMP(3),
    "merged_into_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "chat_response_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_response_cycles_started_room" ON "chat_response_cycles"("started_at", "room_id");

-- CreateIndex
CREATE INDEX "chat_response_cycles_room_id_ended_at_idx" ON "chat_response_cycles"("room_id", "ended_at");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "chat_response_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_response_cycles" ADD CONSTRAINT "chat_response_cycles_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE UNIQUE INDEX chat_response_cycles_one_open ON chat_response_cycles (room_id) WHERE ended_at IS NULL;
