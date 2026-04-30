-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('DUNNING', 'REMINDER', 'TRANSACTIONAL', 'STAFF', 'MARKETING');

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "channel_key" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'text',
    "subject" TEXT,
    "message_template" TEXT NOT NULL,
    "flex_template" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sample_data" JSONB,
    "last_edited_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_event_type_key" ON "notification_templates"("event_type");

-- CreateIndex
CREATE INDEX "notification_templates_event_type_idx" ON "notification_templates"("event_type");

-- CreateIndex
CREATE INDEX "notification_templates_category_idx" ON "notification_templates"("category");
