-- SP1 Test Data — IMEI wizard hotfix verification
-- Pure SQL (avoids Prisma schema-validation mismatch with local dev DB)
-- Idempotent: ON CONFLICT DO NOTHING for new rows; explicit UPDATEs for replays.
--
-- Run:
--   psql "$DATABASE_URL" -f apps/api/src/cli/seed-sp1-test-data.sql
--
-- Or:
--   psql "postgresql://iamnaii@localhost:5432/bestchoice" \
--     -f apps/api/src/cli/seed-sp1-test-data.sql

BEGIN;

-- ── 1. Customers ──────────────────────────────────────────────────────────
INSERT INTO customers (id, name, phone, updated_at) VALUES
  ('sp1-cust-cash',         'ทดสอบ CASH',         '0800000001', NOW()),
  ('sp1-cust-installment',  'ทดสอบ INSTALLMENT',  '0800000002', NOW()),
  ('sp1-cust-gfin',         'ทดสอบ GFIN',         '0800000003', NOW()),
  ('sp1-cust-cross-branch', 'ทดสอบ Cross-Branch', '0800000004', NOW()),
  ('sp1-cust-mfr',          'ทดสอบ Manufacturer', '0800000005', NOW())
ON CONFLICT (id) DO NOTHING;

-- ── 2. Products ───────────────────────────────────────────────────────────
-- IMEIs: 999900000000001-005 (easy to remember)
-- prod-cross-branch at branch-003 (other branch — for PDPA test)
-- prod-mfr has warranty_expire_date = 60 days future
INSERT INTO products
  (id, name, brand, model, imei_serial, category, cost_price,
   supplier_id, branch_id, status, warranty_expire_date, stock_in_date, updated_at)
VALUES
  ('sp1-prod-cash',         'iPhone Test (Cash)',         'Apple',   'iPhone 15',   '999900000000001', 'PHONE_NEW', 30000.00,
   'sup-001', 'branch-002', 'SOLD_CASH', NULL, NOW() - INTERVAL '365 days', NOW()),

  ('sp1-prod-installment',  'iPhone Test (Installment)',  'Apple',   'iPhone 15',   '999900000000002', 'PHONE_NEW', 30000.00,
   'sup-001', 'branch-002', 'SOLD_INSTALLMENT', NULL, NOW() - INTERVAL '7 days', NOW()),

  ('sp1-prod-gfin',         'Samsung Test (GFIN)',        'Samsung', 'Galaxy S24',  '999900000000003', 'PHONE_NEW', 30000.00,
   'sup-001', 'branch-002', 'SOLD_CASH', NULL, NOW() - INTERVAL '60 days', NOW()),

  ('sp1-prod-cross-branch', 'iPhone Test (Cross-Branch)', 'Apple',   'iPhone 15',   '999900000000004', 'PHONE_NEW', 30000.00,
   'sup-001', 'branch-003', 'SOLD_INSTALLMENT', NULL, NOW() - INTERVAL '30 days', NOW()),

  ('sp1-prod-mfr',          'iPhone Test (Manufacturer)', 'Apple',   'iPhone 14',   '999900000000005', 'PHONE_NEW', 25000.00,
   'sup-001', 'branch-002', 'SOLD_INSTALLMENT', NOW() + INTERVAL '60 days', NOW() - INTERVAL '365 days', NOW())
ON CONFLICT (id) DO UPDATE SET
  warranty_expire_date = EXCLUDED.warranty_expire_date,
  updated_at           = NOW();

-- ── 3. Contracts (INSTALLMENT + Cross-Branch + Manufacturer) ──────────────
INSERT INTO contracts
  (id, contract_number, customer_id, product_id, branch_id, salesperson_id,
   plan_type, selling_price, down_payment, interest_rate, total_months,
   interest_total, financed_amount, monthly_payment, status,
   device_received_at, shop_warranty_end_date, updated_at)
VALUES
  ('sp1-ctr-installment',  'SP1-2026-001', 'sp1-cust-installment',  'sp1-prod-installment',  'branch-002', 'user-004',
   'STORE_DIRECT', 35000.00, 5000.00, 0.1600, 12,
   5000.00, 30000.00, 2916.67, 'ACTIVE',
   NOW() - INTERVAL '1 day', NOW() + INTERVAL '30 days', NOW()),

  ('sp1-ctr-cross-branch', 'SP1-2026-002', 'sp1-cust-cross-branch', 'sp1-prod-cross-branch', 'branch-003', 'user-005',
   'STORE_DIRECT', 35000.00, 5000.00, 0.1600, 12,
   5000.00, 30000.00, 2916.67, 'ACTIVE',
   NOW() - INTERVAL '3 days', NOW() + INTERVAL '30 days', NOW()),

  ('sp1-ctr-mfr',          'SP1-2026-003', 'sp1-cust-mfr',          'sp1-prod-mfr',          'branch-002', 'user-004',
   'STORE_DIRECT', 30000.00, 5000.00, 0.1600, 12,
   5000.00, 25000.00, 2500.00,  'ACTIVE',
   NOW() - INTERVAL '365 days', NOW() - INTERVAL '300 days', NOW())
ON CONFLICT (id) DO UPDATE SET
  device_received_at     = EXCLUDED.device_received_at,
  shop_warranty_end_date = EXCLUDED.shop_warranty_end_date,
  updated_at             = NOW();

-- ── 4. Sales ──────────────────────────────────────────────────────────────
INSERT INTO sales
  (id, sale_number, sale_type, customer_id, product_id, branch_id, salesperson_id,
   selling_price, net_amount, contract_id, payment_method, amount_received,
   finance_company, finance_ref_number, finance_amount, down_payment_amount, updated_at)
VALUES
  ('sp1-sale-cash',         'SP1-SL-001', 'CASH',             'sp1-cust-cash',         'sp1-prod-cash',         'branch-002', 'user-004',
   35000.00, 35000.00, NULL, 'CASH', 35000.00, NULL, NULL, NULL, NULL, NOW()),

  ('sp1-sale-installment',  'SP1-SL-002', 'INSTALLMENT',      'sp1-cust-installment',  'sp1-prod-installment',  'branch-002', 'user-004',
   35000.00, 35000.00, 'sp1-ctr-installment',  NULL, NULL, NULL, NULL, NULL, 5000.00, NOW()),

  ('sp1-sale-gfin',         'SP1-SL-003', 'EXTERNAL_FINANCE', 'sp1-cust-gfin',         'sp1-prod-gfin',         'branch-002', 'user-004',
   35000.00, 35000.00, NULL, NULL, NULL, 'GFIN', 'GFIN-2026-SP1-001', 30000.00, 5000.00, NOW()),

  ('sp1-sale-cross-branch', 'SP1-SL-004', 'INSTALLMENT',      'sp1-cust-cross-branch', 'sp1-prod-cross-branch', 'branch-003', 'user-005',
   35000.00, 35000.00, 'sp1-ctr-cross-branch', NULL, NULL, NULL, NULL, NULL, 5000.00, NOW()),

  ('sp1-sale-mfr',          'SP1-SL-005', 'INSTALLMENT',      'sp1-cust-mfr',          'sp1-prod-mfr',          'branch-002', 'user-004',
   30000.00, 30000.00, 'sp1-ctr-mfr',          NULL, NULL, NULL, NULL, NULL, 5000.00, NOW())
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Verification queries
SELECT 'Customers' AS table_name, COUNT(*) AS count FROM customers WHERE id LIKE 'sp1-%'
UNION ALL
SELECT 'Products',              COUNT(*) FROM products  WHERE id LIKE 'sp1-%'
UNION ALL
SELECT 'Contracts',             COUNT(*) FROM contracts WHERE id LIKE 'sp1-%'
UNION ALL
SELECT 'Sales',                 COUNT(*) FROM sales     WHERE id LIKE 'sp1-%';
