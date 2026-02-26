-- Add user_agent and duration columns to audit_logs
ALTER TABLE "audit_logs" ADD COLUMN "user_agent" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "duration" INTEGER;

-- Add index on created_at for efficient date range queries
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
