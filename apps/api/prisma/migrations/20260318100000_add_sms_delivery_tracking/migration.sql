-- AlterTable
ALTER TABLE "notification_logs" ADD COLUMN "external_id" TEXT;
ALTER TABLE "notification_logs" ADD COLUMN "delivery_status" TEXT;
ALTER TABLE "notification_logs" ADD COLUMN "delivered_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "notification_logs_external_id_idx" ON "notification_logs"("external_id");
