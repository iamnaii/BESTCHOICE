-- Migrate old SystemConfig keys to integration format
-- SMS keys: sms_api_key → integration.sms.apiKey etc.
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.sms.apiKey', value, 'SMS Gateway — API Key', NOW(), NOW()
FROM system_config WHERE key = 'sms_api_key' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.sms.apiSecret', value, 'SMS Gateway — API Secret', NOW(), NOW()
FROM system_config WHERE key = 'sms_api_secret' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.sms.sender', value, 'SMS Gateway — Sender Name', NOW(), NOW()
FROM system_config WHERE key = 'sms_sender' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.sms.force', value, 'SMS Gateway — SMS Force Mode', NOW(), NOW()
FROM system_config WHERE key = 'sms_force' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

-- LINE OA key: line_channel_access_token → integration.line-oa.shopChannelToken
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.line-oa.shopChannelToken', value, 'LINE Official Account — Shop Channel Access Token', NOW(), NOW()
FROM system_config WHERE key = 'line_channel_access_token' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

-- LINE OA secret: line_channel_secret → integration.line-oa.shopChannelSecret
INSERT INTO system_config (id, key, value, label, created_at, updated_at)
SELECT gen_random_uuid(), 'integration.line-oa.shopChannelSecret', value, 'LINE Official Account — Shop Channel Secret', NOW(), NOW()
FROM system_config WHERE key = 'line_channel_secret' AND deleted_at IS NULL
ON CONFLICT (key) DO NOTHING;

-- Soft-delete old keys (keep data for rollback safety)
UPDATE system_config SET deleted_at = NOW()
WHERE key IN ('sms_api_key', 'sms_api_secret', 'sms_sender', 'sms_force', 'line_channel_access_token', 'line_channel_secret')
AND deleted_at IS NULL;
