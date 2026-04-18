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

-- 2. Drop default so the column type can be changed
ALTER TABLE "chat_rooms"
    ALTER COLUMN "status" DROP DEFAULT;

-- 3. Cast column to TEXT first, so we can freely rewrite values
--    (UPDATE cannot set 'IDLE' while the column is still the legacy enum).
ALTER TABLE "chat_rooms"
    ALTER COLUMN "status" TYPE TEXT USING "status"::text;

-- 4. Normalize legacy values (ARCHIVED/BLOCKED/anything else → IDLE)
UPDATE "chat_rooms"
   SET "status" = 'IDLE'
 WHERE "status" NOT IN ('ACTIVE', 'IDLE');

-- 5. Swap TEXT → new enum
ALTER TABLE "chat_rooms"
    ALTER COLUMN "status" TYPE "ChatRoomStatus"
        USING "status"::"ChatRoomStatus";

-- 6. Restore default
ALTER TABLE "chat_rooms"
    ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- 7. Drop the now-unused legacy enum (no other tables reference it).
DROP TYPE IF EXISTS "ChatStatus";
