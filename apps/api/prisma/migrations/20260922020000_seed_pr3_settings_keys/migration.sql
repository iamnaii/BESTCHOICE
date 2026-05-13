-- Seed PR-3 Other Income v2.2 settings keys (idempotent)

INSERT INTO system_config (id, key, value, label, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'VAT_RATE', '7', 'VAT rate (%)', NOW(), NOW()),
  (gen_random_uuid(), 'VAT_PRICE_TYPE_DEFAULT', 'exclusive', 'Default VAT price type (exclusive/inclusive)', NOW(), NOW()),
  (gen_random_uuid(), 'ATTACHMENT_REQUIRED_ABOVE_AMOUNT', '0', 'Attachment required for amounts above (0 = not required)', NOW(), NOW()),
  (gen_random_uuid(), 'ATTACHMENT_ALLOWED_TYPES', 'PDF, JPG, PNG', 'Allowed attachment file types', NOW(), NOW())
ON CONFLICT (key) DO NOTHING;
