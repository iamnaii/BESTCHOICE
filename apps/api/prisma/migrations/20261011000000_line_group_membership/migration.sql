-- ยื่น GFIN PR 2 — บอทส่งเข้ากลุ่ม (spec 2026-09-24 §4.1/§4.2). Additive only.
CREATE TABLE "line_group_memberships" (
  "id" TEXT NOT NULL, "channel" "LineChannelType" NOT NULL, "group_id" TEXT NOT NULL,
  "group_name" TEXT, "picture_url" TEXT, "member_count" INTEGER,
  "joined_at" TIMESTAMP(3) NOT NULL, "left_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, "deleted_at" TIMESTAMP(3),
  CONSTRAINT "line_group_memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "line_group_memberships_channel_group_id_key" ON "line_group_memberships"("channel", "group_id");
CREATE INDEX "line_group_memberships_channel_left_at_idx" ON "line_group_memberships"("channel", "left_at");

ALTER TABLE "external_finance_companies"
  ADD COLUMN "line_group_id" TEXT,
  ADD COLUMN "precheck_template" TEXT;
