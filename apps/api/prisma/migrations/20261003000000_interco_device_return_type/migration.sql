-- ใบรับเครื่องคืน (docs/superpowers/specs/2026-09-20-device-return-intake-design.md §4.2, §6.3)
-- แถวหักประเภทที่ 3 ในรอบจ่าย INTER-CO — additive only, ไม่มี backfill
-- หมายเหตุ: ALTER TYPE ... ADD VALUE ถอยไม่ได้ (Postgres ไม่มี DROP VALUE) — precedent
-- 20260986000000_online_order_unfulfillable
ALTER TYPE "InterCoItemType" ADD VALUE IF NOT EXISTS 'DEVICE_RETURN';

ALTER TABLE "inter_co_settlement_items"
  ADD COLUMN IF NOT EXISTS "device_return_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;
