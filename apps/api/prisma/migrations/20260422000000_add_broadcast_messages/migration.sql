-- Broadcast Messages table
CREATE TABLE IF NOT EXISTS "broadcast_messages" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "audience" TEXT NOT NULL,
    "audience_count" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "broadcast_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "broadcast_messages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "broadcast_messages_status_scheduled_at_idx" ON "broadcast_messages"("status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "broadcast_messages_created_at_idx" ON "broadcast_messages"("created_at");

-- Warranty fields (if not already applied by db push)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "shop_warranty_days" INTEGER;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "shop_warranty_start_date" TIMESTAMP(3);
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "shop_warranty_end_date" TIMESTAMP(3);
