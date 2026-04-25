-- ============================================================
-- P3 Cluster ε / Task 12 (2026-04-25)
-- E2: SmsTemplate management — DunningRule may now reference an
--     SmsTemplate by name. When `template_name` is set the dunning
--     engine prefers the template body from sms_templates;
--     otherwise the inline `message_template` column is used.
--     This is purely additive — no backfill required.
-- ============================================================

ALTER TABLE "dunning_rules" ADD COLUMN "template_name" TEXT;
