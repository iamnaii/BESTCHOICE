-- Fix chat_rooms.status column type mismatch.
-- Prior migration (20260421_room_based_chat_and_warranty) intended to replace
-- the status column but used IF NOT EXISTS / IF EXISTS guards that were no-ops,
-- leaving the column as the legacy "ChatStatus" enum (ACTIVE/ARCHIVED/BLOCKED)
-- while the Prisma schema declares "ChatRoomStatus" (ACTIVE/IDLE).
-- The mismatch causes every query against chat_rooms.status to throw 500.

-- 1. Create the new enum if it does not yet exist
DO $$ BEGIN
    CREATE TYPE "ChatRoomStatus" AS ENUM ('ACTIVE', 'IDLE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 2. Normalize legacy values (ARCHIVED/BLOCKED → IDLE) before casting.
--    Only rows whose current text value is not in the new enum are touched.
UPDATE "chat_rooms"
   SET "status" = 'IDLE'
 WHERE "status"::text NOT IN ('ACTIVE', 'IDLE');

-- 3. Swap the column type from the legacy enum to the new one.
ALTER TABLE "chat_rooms"
    ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "chat_rooms"
    ALTER COLUMN "status" TYPE "ChatRoomStatus"
        USING ("status"::text::"ChatRoomStatus");

ALTER TABLE "chat_rooms"
    ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- 4. Drop the now-unused legacy enum (no other tables reference it).
DROP TYPE IF EXISTS "ChatStatus";
