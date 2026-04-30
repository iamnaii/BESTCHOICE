-- AlterTable
ALTER TABLE "notification_logs" ADD COLUMN "customer_id" TEXT;
ALTER TABLE "notification_logs" ADD COLUMN "category" TEXT;
ALTER TABLE "notification_logs" ADD COLUMN "block_reason" TEXT;

-- CreateIndex
CREATE INDEX "notification_logs_customer_id_related_id_category_sent_at_idx" ON "notification_logs"("customer_id", "related_id", "category", "sent_at");

-- CreateIndex
CREATE INDEX "notification_logs_category_sent_at_idx" ON "notification_logs"("category", "sent_at");
