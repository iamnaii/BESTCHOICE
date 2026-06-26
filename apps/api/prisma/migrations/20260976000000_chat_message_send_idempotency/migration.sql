-- Outbound delivery flag (our adapter confirmed send to the customer).
ALTER TABLE "chat_messages" ADD COLUMN "outbound_sent_at" TIMESTAMP(3);

-- Idempotency key: at most one message per (room, clientMessageId). Existing
-- rows have NULL client_message_id; Postgres treats NULLs as distinct, so the
-- many historical NULLs per room do not collide.
CREATE UNIQUE INDEX "chat_messages_room_id_client_message_id_key"
  ON "chat_messages" ("room_id", "client_message_id");
