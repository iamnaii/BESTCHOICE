ALTER TABLE "chat_notes" ADD COLUMN "request_key" TEXT;
CREATE UNIQUE INDEX "chat_notes_request_key_key" ON "chat_notes"("request_key");
CREATE TABLE "chat_note_mentions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "note_id" TEXT NOT NULL REFERENCES "chat_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "chat_note_mentions_note_id_user_id_key" ON "chat_note_mentions"("note_id", "user_id");
CREATE INDEX "chat_note_mentions_user_id_created_at_idx" ON "chat_note_mentions"("user_id", "created_at");
