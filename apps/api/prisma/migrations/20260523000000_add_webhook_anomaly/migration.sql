-- Append-only log of suspicious webhook events (HMAC failures,
-- missing-signature attempts, merchantid mismatches). Feeds an hourly
-- observation cron that alerts on spikes.

CREATE TABLE "webhook_anomalies" (
  "id"         TEXT NOT NULL,
  "provider"   TEXT NOT NULL,
  "reason"     TEXT NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "meta"       JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_anomalies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_anomalies_provider_created_at_idx"
  ON "webhook_anomalies"("provider", "created_at");
CREATE INDEX "webhook_anomalies_created_at_idx"
  ON "webhook_anomalies"("created_at");
