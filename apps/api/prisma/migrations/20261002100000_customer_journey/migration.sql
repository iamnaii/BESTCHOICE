-- การเดินทางของลูกค้า (docs/superpowers/plans/2026-09-15-customer-journey.md · Task 1)
-- 1) customers.merged_into_id — ติดตัวตนข้ามการรวมผู้สนใจ (ตั้งใน tx ของ CustomerMergeService.absorbPlaceholder)
-- 2) customer_journey_entries — แถวต่อท้ายอย่างเดียว (SYSTEM + MANUAL) · dedupe_key unique กันเขียนซ้ำ
-- 3) customer_journey_states — แคชสรุป 1:1 ต่อลูกค้า คำนวณใหม่ได้ทั้งหมด
-- 4) เติม merged_into_id ย้อนหลังจาก audit CUSTOMER_PLACEHOLDER_MERGED แล้วยุบ chain — รันซ้ำได้

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "merged_into_id" TEXT;

-- CreateTable
CREATE TABLE "customer_journey_entries" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "origin_customer_id" TEXT NOT NULL,
    "origin" VARCHAR(8) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "actor_type" VARCHAR(10) NOT NULL,
    "actor_user_id" TEXT,
    "room_id" TEXT,
    "ref_type" VARCHAR(24),
    "ref_id" TEXT,
    "data" JSONB,
    "channel" VARCHAR(16),
    "outcome" VARCHAR(20),
    "lost_reason" VARCHAR(20),
    "heard_from" VARCHAR(16),
    "note" VARCHAR(140),
    "dedupe_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,

    CONSTRAINT "customer_journey_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_journey_states" (
    "customer_id" TEXT NOT NULL,
    "stage" VARCHAR(12) NOT NULL,
    "stage_entered_at" TIMESTAMP(3) NOT NULL,
    "path" VARCHAR(18) NOT NULL,
    "contacted_at" TIMESTAMP(3) NOT NULL,
    "identified_at" TIMESTAMP(3),
    "interested_at" TIMESTAMP(3),
    "credit_at" TIMESTAMP(3),
    "first_purchase_at" TIMESTAMP(3),
    "first_purchase_kind" VARCHAR(18),
    "first_staff_reply_at" TIMESTAMP(3),
    "first_channel" VARCHAR(20) NOT NULL,
    "first_source" VARCHAR(30) NOT NULL,
    "first_ad_campaign_id" TEXT,
    "heard_from" VARCHAR(16),
    "last_customer_at" TIMESTAMP(3),
    "last_touch_at" TIMESTAMP(3),
    "lost_at" TIMESTAMP(3),
    "lost_reason" VARCHAR(20),
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_journey_states_pkey" PRIMARY KEY ("customer_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_journey_entries_dedupe_key_key" ON "customer_journey_entries"("dedupe_key");

-- CreateIndex
CREATE INDEX "customer_journey_entries_customer_id_occurred_at_id_idx" ON "customer_journey_entries"("customer_id", "occurred_at" DESC, "id");

-- CreateIndex
CREATE INDEX "customer_journey_entries_kind_occurred_at_idx" ON "customer_journey_entries"("kind", "occurred_at");

-- CreateIndex
CREATE INDEX "customer_journey_states_stage_stage_entered_at_idx" ON "customer_journey_states"("stage", "stage_entered_at");

-- CreateIndex
CREATE INDEX "customer_journey_states_first_source_contacted_at_idx" ON "customer_journey_states"("first_source", "contacted_at");

-- CreateIndex
CREATE INDEX "customer_journey_states_first_channel_contacted_at_idx" ON "customer_journey_states"("first_channel", "contacted_at");

-- CreateIndex
CREATE INDEX "customers_merged_into_id_idx" ON "customers"("merged_into_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_journey_entries" ADD CONSTRAINT "customer_journey_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_journey_entries" ADD CONSTRAINT "customer_journey_entries_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_journey_states" ADD CONSTRAINT "customer_journey_states_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- journey-backfill:start
-- 4.1 audit ของ CustomerMergeService.absorbPlaceholder — entity 'customer' · entity_id = ลูกค้าปลายทาง
--     old_value = {"placeholderId": "<id>"} · แตะเฉพาะ placeholder ที่ถูก soft-delete แล้วและยังไม่มีค่า
--     ปลายทางต้องยังมีแถวอยู่ (กัน FK ข้างบนล้ม) · ไม่แตะ updated_at เพราะขั้นรู้ตัวตนย้อนหลังใช้ค่านั้น
UPDATE "customers" AS c
SET "merged_into_id" = m.target_id
FROM (
  SELECT DISTINCT ON (a."old_value"->>'placeholderId')
         a."old_value"->>'placeholderId' AS placeholder_id,
         a."entity_id" AS target_id
  FROM "audit_logs" AS a
  JOIN "customers" AS t ON t."id" = a."entity_id"
  WHERE a."action" = 'CUSTOMER_PLACEHOLDER_MERGED'
    AND a."entity" = 'customer'
    AND a."old_value"->>'placeholderId' IS NOT NULL
    AND a."old_value"->>'placeholderId' <> a."entity_id"
  ORDER BY a."old_value"->>'placeholderId', a."created_at" DESC
) AS m
WHERE c."id" = m.placeholder_id
  AND c."deleted_at" IS NOT NULL
  AND c."merged_into_id" IS NULL;

-- 4.2 ยุบ chain เหลือชั้นเดียว — A→B (รวมห้องแชทระหว่างผู้สนใจสองคน) แล้ว B→ลูกค้าจริง ⇒ A→ลูกค้าจริง
--     depth < 32 กันวนไม่รู้จบ (วงปิดเกิดไม่ได้เพราะรวมได้เฉพาะปลายทางที่ยังไม่ถูกลบ แต่กันไว้)
WITH RECURSIVE chain AS (
  SELECT c."id", c."merged_into_id" AS root_id, 1 AS depth
  FROM "customers" AS c
  WHERE c."merged_into_id" IS NOT NULL
  UNION ALL
  SELECT chain."id", p."merged_into_id", chain.depth + 1
  FROM chain
  JOIN "customers" AS p ON p."id" = chain.root_id
  WHERE p."merged_into_id" IS NOT NULL
    AND chain.depth < 32
)
UPDATE "customers" AS c
SET "merged_into_id" = f.root_id
FROM (
  SELECT DISTINCT ON (chain."id") chain."id", chain.root_id
  FROM chain
  ORDER BY chain."id", chain.depth DESC
) AS f
WHERE c."id" = f."id"
  AND c."merged_into_id" IS DISTINCT FROM f.root_id;
-- journey-backfill:end
