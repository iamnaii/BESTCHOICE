-- Split line-oa integration into 3 separate integrations:
--   line-shop   (ไลน์ร้าน — ลูกค้า)
--   line-finance (ไลน์การเงิน — น้องเบส)
--   line-staff   (ไลน์พนักงาน)
--
-- Old field names also simplified:
--   shopChannelToken  → channelToken   (under line-shop)
--   shopChannelSecret → channelSecret  (under line-shop)
--   financeChannelToken  → channelToken   (under line-finance)
--   financeChannelSecret → channelSecret  (under line-finance)
--   staffChannelToken    → channelToken   (under line-staff)
--   staffChannelSecret   → channelSecret  (under line-staff)
--   staffNotifyTargets   → notifyTargets  (under line-staff)
--   liffId               → liffId         (under line-shop)

-- ─── LINE SHOP ────────────────────────────────────────────────────────────
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.line-shop.channelToken', value,
       'LINE SHOP (ลูกค้า) — Channel Access Token', NOW(), NOW()
FROM system_config
WHERE key = 'integration.line-oa.shopChannelToken' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.line-shop.channelSecret', value,
       'LINE SHOP (ลูกค้า) — Channel Secret', NOW(), NOW()
FROM system_config
WHERE key = 'integration.line-oa.shopChannelSecret' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.line-shop.liffId', value,
       'LINE SHOP (ลูกค้า) — LIFF ID', NOW(), NOW()
FROM system_config
WHERE key = 'integration.line-oa.liffId' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

-- ─── LINE FINANCE ─────────────────────────────────────────────────────────
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.line-finance.channelToken', value,
       'LINE FINANCE (น้องเบส) — Channel Access Token', NOW(), NOW()
FROM system_config
WHERE key = 'integration.line-oa.financeChannelToken' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.line-finance.channelSecret', value,
       'LINE FINANCE (น้องเบส) — Channel Secret', NOW(), NOW()
FROM system_config
WHERE key = 'integration.line-oa.financeChannelSecret' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

-- ─── LINE STAFF ───────────────────────────────────────────────────────────
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.line-staff.channelToken', value,
       'LINE STAFF (พนักงาน) — Channel Access Token', NOW(), NOW()
FROM system_config
WHERE key = 'integration.line-oa.staffChannelToken' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.line-staff.channelSecret', value,
       'LINE STAFF (พนักงาน) — Channel Secret', NOW(), NOW()
FROM system_config
WHERE key = 'integration.line-oa.staffChannelSecret' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.line-staff.notifyTargets', value,
       'LINE STAFF (พนักงาน) — กลุ่มที่ต้องการแจ้งเตือน', NOW(), NOW()
FROM system_config
WHERE key = 'integration.line-oa.staffNotifyTargets' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

-- ─── Soft-delete old line-oa keys (keep for rollback safety) ──────────────
UPDATE system_config SET deleted_at = NOW()
WHERE key LIKE 'integration.line-oa.%' AND deleted_at IS NULL;
