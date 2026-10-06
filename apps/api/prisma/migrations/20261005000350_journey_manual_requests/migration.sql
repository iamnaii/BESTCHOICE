ALTER TABLE "customer_journey_entries" ADD COLUMN "manual_request_key" TEXT;
CREATE UNIQUE INDEX "customer_journey_entries_manual_request_key_key" ON "customer_journey_entries"("manual_request_key");
