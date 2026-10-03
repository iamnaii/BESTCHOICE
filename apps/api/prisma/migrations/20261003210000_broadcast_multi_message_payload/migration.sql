-- Reconcile the existing multi-message Prisma model with migration-built databases.
-- Keep legacy columns/data; only relax their requiredness for new multi-message rows.
-- Some installations already have `messages` from schema sync, so preserve it.
DO $$
BEGIN
  ALTER TABLE "broadcast_messages" ADD COLUMN IF NOT EXISTS "messages" JSONB;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'broadcast_messages' AND column_name = 'type'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'broadcast_messages' AND column_name = 'content'
  ) THEN
    UPDATE "broadcast_messages"
    SET "messages" = jsonb_build_array(jsonb_build_object('type', "type", 'content', "content"))
    WHERE "messages" IS NULL;
    ALTER TABLE "broadcast_messages" ALTER COLUMN "type" DROP NOT NULL;
    ALTER TABLE "broadcast_messages" ALTER COLUMN "content" DROP NOT NULL;
  END IF;
  ALTER TABLE "broadcast_messages" ALTER COLUMN "messages" SET NOT NULL;
END $$;
