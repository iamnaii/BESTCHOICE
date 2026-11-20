ALTER TABLE "chat_rooms" ADD COLUMN "dispatch_queued_at" TIMESTAMP(3);
CREATE INDEX "chat_rooms_dispatch_queued_at_assigned_to_id_deleted_at_idx" ON "chat_rooms"("dispatch_queued_at", "assigned_to_id", "deleted_at");
CREATE TABLE "chat_dispatch_members" (
  "id" TEXT NOT NULL,
  "staff_id" TEXT NOT NULL,
  "company" TEXT NOT NULL CHECK ("company" IN ('SHOP', 'FINANCE')),
  "position" BIGINT NOT NULL DEFAULT 0,
  "generation" TEXT NOT NULL,
  "ready_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "chat_dispatch_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chat_dispatch_members_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "chat_dispatch_members_staff_id_company_key" ON "chat_dispatch_members"("staff_id", "company");
CREATE INDEX "chat_dispatch_members_company_ready_until_position_idx" ON "chat_dispatch_members"("company", "ready_until", "position");
