-- The room refactor renamed related session_id columns but missed suggestions.
-- Rename in place so existing suggestion-to-room identifiers are preserved.
-- Also accept databases already repaired to the schema's room_id name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'chat_kb_suggestions' AND column_name = 'session_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'chat_kb_suggestions' AND column_name = 'room_id'
  ) THEN
    ALTER TABLE "chat_kb_suggestions" RENAME COLUMN "session_id" TO "room_id";
  END IF;
  IF to_regclass(format('%I.%I', current_schema(), 'chat_kb_suggestions_session_id_idx')) IS NOT NULL
     AND to_regclass(format('%I.%I', current_schema(), 'chat_kb_suggestions_room_id_idx')) IS NULL THEN
    ALTER INDEX "chat_kb_suggestions_session_id_idx" RENAME TO "chat_kb_suggestions_room_id_idx";
  END IF;
END $$;
