-- สมุดสถานะการขายของบอท (slot memory — SalesStateService)
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "ai_sales_state" JSONB;
