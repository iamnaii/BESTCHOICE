-- Optimistic-send correlation token (frontend-generated). Nullable, no default,
-- no index → metadata-only change (instant on a populated table).
ALTER TABLE "chat_messages" ADD COLUMN "client_message_id" TEXT;
