-- Promise-to-pay SLA tracking: call logs that were PROMISED but not honored
-- get flagged by a hourly cron so dunning can escalate automatically.

ALTER TABLE "call_logs" ADD COLUMN "broken_at" TIMESTAMP(3);

-- Index to make the cron scan cheap (PROMISED + settlementDate < now + brokenAt null).
CREATE INDEX "call_logs_result_settlement_date_broken_at_idx"
  ON "call_logs"("result", "settlement_date", "broken_at");
