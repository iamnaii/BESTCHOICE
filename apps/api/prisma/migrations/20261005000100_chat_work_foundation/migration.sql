-- CreateEnum
CREATE TYPE "StaffInboxKind" AS ENUM ('CHAT_SLA', 'FOLLOW_UP', 'MENTION', 'HANDOFF', 'SERVICE_REQUEST');

-- CreateEnum
CREATE TYPE "ChatWorkTarget" AS ENUM ('ROOM', 'TODO', 'NOTE', 'FACEBOOK_COMMENT', 'SERVICE_REQUEST');

-- CreateTable
CREATE TABLE "staff_inbox_items" (
    "id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "kind" "StaffInboxKind" NOT NULL,
    "room_id" TEXT,
    "todo_id" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "target_type" "ChatWorkTarget" NOT NULL,
    "target_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "staff_inbox_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_inbox_items_dedupe_key_key" ON "staff_inbox_items"("dedupe_key");

-- CreateIndex
CREATE INDEX "staff_inbox_items_recipient_id_deleted_at_created_at_idx" ON "staff_inbox_items"("recipient_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "staff_inbox_items_room_id_idx" ON "staff_inbox_items"("room_id");

-- CreateIndex
CREATE INDEX "staff_inbox_items_todo_id_idx" ON "staff_inbox_items"("todo_id");

-- AddForeignKey
ALTER TABLE "staff_inbox_items" ADD CONSTRAINT "staff_inbox_items_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_inbox_items" ADD CONSTRAINT "staff_inbox_items_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_inbox_items" ADD CONSTRAINT "staff_inbox_items_todo_id_fkey" FOREIGN KEY ("todo_id") REFERENCES "todos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
