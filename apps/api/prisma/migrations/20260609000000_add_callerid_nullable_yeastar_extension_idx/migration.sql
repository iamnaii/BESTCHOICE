-- Fix C1: Make caller_id nullable on call_logs (was causing FK violation when callerId='system')
ALTER TABLE "call_logs" ALTER COLUMN "caller_id" DROP NOT NULL;

-- Fix I7: Add index on yeastar_extension for fast agent lookup during inbound screen pop and CDR matching
CREATE INDEX "users_yeastar_extension_idx" ON "users"("yeastar_extension");
