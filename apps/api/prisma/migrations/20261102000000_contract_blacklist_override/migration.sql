-- ก้อน 5 C3 — ด่าน blacklist: เก็บการปลดระดับ SOFT ลงแถวสัญญา (ใคร/เมื่อไร/เหตุผล) ให้ activate ตรวจซ้ำได้
-- Idempotent — รันซ้ำได้.
ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "blacklist_override_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "blacklist_overridden_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "blacklist_overridden_at" TIMESTAMP(3);
DO $$ BEGIN
  ALTER TABLE "contracts" ADD CONSTRAINT "contracts_blacklist_overridden_by_id_fkey"
    FOREIGN KEY ("blacklist_overridden_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
