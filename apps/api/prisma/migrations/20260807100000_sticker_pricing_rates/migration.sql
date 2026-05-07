-- Add rate1/rate2 sticker fields to pricing_templates
ALTER TABLE "pricing_templates"
  ADD COLUMN "rate1_down_payment" DECIMAL(12, 2),
  ADD COLUMN "rate1_term_months" INTEGER,
  ADD COLUMN "rate2_down_payment" DECIMAL(12, 2),
  ADD COLUMN "rate2_term_months" INTEGER;

-- Seed default sticker config (insert if not exists)
INSERT INTO "system_config" ("id", "key", "value", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'sticker.rate1.defaultDown', '0', NOW(), NOW()),
  (gen_random_uuid(), 'sticker.rate1.defaultTerm', '24', NOW(), NOW()),
  (gen_random_uuid(), 'sticker.rate2.defaultDown', '0', NOW(), NOW()),
  (gen_random_uuid(), 'sticker.rate2.defaultTerm', '12', NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
