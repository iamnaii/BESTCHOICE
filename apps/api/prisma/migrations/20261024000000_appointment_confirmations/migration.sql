ALTER TABLE "store_appointment_links" ADD COLUMN "source_room_id" TEXT;
ALTER TABLE "store_appointment_links" ADD CONSTRAINT "store_appointment_links_source_room_id_fkey" FOREIGN KEY ("source_room_id") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "appointment_confirmations" (
  "id" TEXT NOT NULL, "appointment_id" TEXT NOT NULL, "version" INTEGER NOT NULL, "kind" TEXT NOT NULL,
  "room_id" TEXT, "channel" "ChatChannel", "recipient_id" TEXT, "text" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "sent_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, "deleted_at" TIMESTAMP(3),
  CONSTRAINT "appointment_confirmations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_confirmations_status_check" CHECK ("status" IN ('PENDING','SENDING','SENT','FAILED','UNKNOWN','NO_CHANNEL','SUPERSEDED')),
  CONSTRAINT "appointment_confirmations_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "store_appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "appointment_confirmations_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "appointment_confirmations_appointment_id_version_key" ON "appointment_confirmations"("appointment_id", "version");
CREATE INDEX "appointment_confirmations_status_created_at_idx" ON "appointment_confirmations"("status", "created_at");
CREATE INDEX "appointment_confirmations_room_id_idx" ON "appointment_confirmations"("room_id");
CREATE INDEX "store_appointment_links_source_room_id_idx" ON "store_appointment_links"("source_room_id");
