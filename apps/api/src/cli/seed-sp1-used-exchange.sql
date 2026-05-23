-- SP1 USED-phone exchange test set
-- Adds 1 customer + 4 products (1 sold + 3 replacements) + 1 contract + 1 sale
-- so the DefectExchangePage eligibility passes (PHONE_USED + within 7-day window).
-- Run: psql "postgresql://iamnaii@localhost:5432/bestchoice" -f /tmp/seed-sp1-used-exchange.sql

BEGIN;

-- ── 1. Customer ──────────────────────────────────────────────────────────
INSERT INTO customers (id, name, phone, updated_at) VALUES
  ('sp1-cust-used', 'ทดสอบ มือสองในประกัน 7 วัน', '0800000011', NOW())
ON CONFLICT (id) DO NOTHING;

-- ── 2. Products — 1 sold (the device being exchanged) + 3 replacements ──
INSERT INTO products
  (id, name, brand, model, imei_serial, color, category, cost_price,
   supplier_id, branch_id, status, warranty_expire_date, stock_in_date, updated_at)
VALUES
  -- The device being exchanged: PHONE_USED, SOLD via the contract below
  ('sp1-prod-used-old',   'iPhone 15 256GB (Used Sold)',     'Apple', 'iPhone 15', '999900000000011', 'Pink',  'PHONE_USED', 22000.00,
   'sup-001', 'branch-002', 'SOLD_INSTALLMENT', NULL, NOW() - INTERVAL '30 days', NOW()),

  -- Replacement 1: same brand+model+storage IN_STOCK (this will appear in step-2 dropdown)
  ('sp1-prod-used-rep-1', 'iPhone 15 256GB (Used Rep 1)',    'Apple', 'iPhone 15', '999900000000012', 'Black', 'PHONE_USED', 22000.00,
   'sup-001', 'branch-002', 'IN_STOCK',         NULL, NOW() - INTERVAL '20 days', NOW()),

  -- Replacement 2: same brand+model+storage IN_STOCK alt color
  ('sp1-prod-used-rep-2', 'iPhone 15 256GB (Used Rep 2)',    'Apple', 'iPhone 15', '999900000000013', 'Blue',  'PHONE_USED', 22000.00,
   'sup-001', 'branch-002', 'IN_STOCK',         NULL, NOW() - INTERVAL '10 days', NOW()),

  -- Replacement 3: iPhone 14 (different model — should NOT appear; here to verify filter)
  ('sp1-prod-used-rep-3', 'iPhone 14 256GB (Used Rep 3)',    'Apple', 'iPhone 14', '999900000000014', 'White', 'PHONE_USED', 19000.00,
   'sup-001', 'branch-002', 'IN_STOCK',         NULL, NOW() - INTERVAL '40 days', NOW())
ON CONFLICT (id) DO UPDATE SET
  category   = EXCLUDED.category,
  status     = EXCLUDED.status,
  updated_at = NOW();

-- ── 3. Contract for the old device — received TODAY (within 7-day window) ─
INSERT INTO contracts
  (id, contract_number, customer_id, product_id, branch_id, salesperson_id,
   plan_type, selling_price, down_payment, interest_rate, total_months,
   interest_total, financed_amount, monthly_payment, status,
   device_received_at, shop_warranty_end_date, updated_at)
VALUES
  ('sp1-ctr-used', 'SP1-2026-007', 'sp1-cust-used', 'sp1-prod-used-old', 'branch-002', 'user-004',
   'STORE_DIRECT', 28000.00, 4000.00, 0.1600, 12,
   4000.00, 24000.00, 2333.33, 'ACTIVE',
   NOW(), NOW() + INTERVAL '30 days', NOW())
ON CONFLICT (id) DO UPDATE SET
  device_received_at     = EXCLUDED.device_received_at,
  shop_warranty_end_date = EXCLUDED.shop_warranty_end_date,
  status                 = EXCLUDED.status,
  updated_at             = NOW();

-- ── 4. Sale ──────────────────────────────────────────────────────────────
INSERT INTO sales
  (id, sale_number, sale_type, customer_id, product_id, branch_id, salesperson_id,
   selling_price, net_amount, contract_id, down_payment_amount,
   created_at, updated_at)
VALUES
  ('sp1-sale-used', 'SP1-SL-011', 'INSTALLMENT', 'sp1-cust-used', 'sp1-prod-used-old', 'branch-002', 'user-004',
   28000.00, 28000.00, 'sp1-ctr-used', 4000.00,
   NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

COMMIT;

SELECT 'Total SP1 customers' AS metric, COUNT(*) AS n FROM customers WHERE id LIKE 'sp1-%'
UNION ALL SELECT 'Total SP1 products',  COUNT(*) FROM products  WHERE id LIKE 'sp1-%'
UNION ALL SELECT 'Total SP1 contracts', COUNT(*) FROM contracts WHERE id LIKE 'sp1-%'
UNION ALL SELECT 'Total SP1 sales',     COUNT(*) FROM sales     WHERE id LIKE 'sp1-%'
UNION ALL SELECT '  └─ PHONE_USED products', COUNT(*) FROM products WHERE id LIKE 'sp1-%' AND category = 'PHONE_USED'
UNION ALL SELECT '  └─ PHONE_USED IN_STOCK', COUNT(*) FROM products WHERE id LIKE 'sp1-%' AND category = 'PHONE_USED' AND status = 'IN_STOCK';
