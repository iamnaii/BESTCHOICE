-- AiUsageLog — one row per Claude API call. Feeds the daily cost cron
-- which alerts on runaway usage. Decimal(12,6) so sub-cent calls
-- (common for haiku vision) stay precise.

CREATE TABLE "ai_usage_logs" (
  "id"            TEXT NOT NULL,
  "service"       TEXT NOT NULL,
  "method"        TEXT,
  "model"         TEXT NOT NULL,
  "input_tokens"  INTEGER NOT NULL,
  "output_tokens" INTEGER NOT NULL,
  "cost_usd"      DECIMAL(12,6) NOT NULL,
  "user_id"       TEXT,
  "status"        TEXT NOT NULL,
  "error_kind"    TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_usage_logs_service_created_at_idx" ON "ai_usage_logs"("service", "created_at");
CREATE INDEX "ai_usage_logs_created_at_idx" ON "ai_usage_logs"("created_at");
CREATE INDEX "ai_usage_logs_user_id_idx" ON "ai_usage_logs"("user_id");
