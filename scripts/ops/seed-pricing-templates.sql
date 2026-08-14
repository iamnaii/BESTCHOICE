-- Seed เรทผ่อนมาตรฐานต่อรุ่นจากตารางเจ้าของ (PDF มือ1 + มือ2, 2026-08-14)
-- rate1 = BESTCHOICE (ดาวน์/ค่างวด/งวดสูงสุด) · rate2 = GFIN
-- installment_bestchoice_price / installment_finance_price = ค่างวดต่อเดือน (สติกเกอร์ parity)
-- cash_price = 0 ชั่วคราว (ตารางไม่มีราคาเงินสด — บอทไม่ใช้คอลัมน์นี้ แต่ห้ามพิมพ์สติกเกอร์จนกว่าจะเติม)
-- idempotent: update ตาม (model, storage, category) แล้ว insert เฉพาะที่ยังไม่มี
BEGIN;

CREATE TEMP TABLE seed_rates (
  model text, storage text, category text,
  r1_down numeric, r1_monthly numeric, r1_term int,
  r2_down numeric, r2_monthly numeric, r2_term int
) ON COMMIT DROP;

INSERT INTO seed_rates VALUES
-- ===== มือ 1 (PHONE_NEW) =====
('iPhone 15',         '128GB', 'PHONE_NEW',  1500, 3194, 12,  5200, 3288, 12),
('iPhone 16',         '128GB', 'PHONE_NEW',  4100, 3251, 12,  5900, 3181, 15),
('iPhone 16 Plus',    '128GB', 'PHONE_NEW',  4500, 3622, 12,  5900, 3621, 15),
('iPhone 17',         '256GB', 'PHONE_NEW',  4500, 3622, 12,  5900, 3621, 15),
('iPhone 17 Air',     '256GB', 'PHONE_NEW',  5000, 3978, 12,  5900, 4061, 15),
('iPhone 17 Pro',     '256GB', 'PHONE_NEW', 15000, 3978, 12,  8400, 5162, 15),
('iPhone 17 Pro Max', '256GB', 'PHONE_NEW',  7400, 5917, 12, 10700, 5712, 15),
-- ===== มือ 2 (PHONE_USED) =====
('iPhone 12',         '64GB',  'PHONE_USED',  900, 1147, 10,   900, 1457, 10),
('iPhone 12',         '128GB', 'PHONE_USED',  900, 1284, 10,   900, 1608, 10),
('iPhone 12',         '256GB', 'PHONE_USED',  900, 1403, 10,   900, 1759, 10),
('iPhone 12 Pro',     '128GB', 'PHONE_USED',  900, 1557, 10,  1800, 1759, 10),
('iPhone 12 Pro',     '256GB', 'PHONE_USED',  900, 1712, 10,  1900, 1909, 10),
('iPhone 12 Pro',     '512GB', 'PHONE_USED',  900, 1814, 10,  1800, 2060, 10),
('iPhone 12 Pro Max', '128GB', 'PHONE_USED',  900, 2054, 10,  3200, 2060, 10),
('iPhone 12 Pro Max', '256GB', 'PHONE_USED',  900, 2225, 10,  3400, 2211, 10),
('iPhone 13',         '128GB', 'PHONE_USED',  900, 1711, 12,  3200, 1758, 12),
('iPhone 13',         '256GB', 'PHONE_USED',  900, 1853, 12,  3400, 1885, 12),
('iPhone 13 Pro',     '128GB', 'PHONE_USED',  900, 1996, 12,  2900, 2140, 12),
('iPhone 13 Pro',     '256GB', 'PHONE_USED',  900, 2139, 12,  3200, 2268, 12),
('iPhone 13 Pro Max', '128GB', 'PHONE_USED',  900, 2281, 12,  3400, 2395, 12),
('iPhone 13 Pro Max', '256GB', 'PHONE_USED',  900, 2424, 12,  3700, 2523, 12),
('iPhone 13 Pro Max', '512GB', 'PHONE_USED',  900, 2566, 12,  3900, 2650, 12),
('iPhone 14',         '128GB', 'PHONE_USED',  900, 1711, 12,  1700, 2013, 12),
('iPhone 14',         '256GB', 'PHONE_USED',  900, 2139, 12,  3900, 2140, 12),
('iPhone 14 Plus',    '128GB', 'PHONE_USED',  900, 2139, 12,  2400, 2395, 12),
('iPhone 14 Plus',    '256GB', 'PHONE_USED',  900, 2224, 12,  2300, 2523, 12),
('iPhone 14 Pro',     '128GB', 'PHONE_USED', 1900, 2424, 12,  3200, 2778, 12),
('iPhone 14 Pro',     '256GB', 'PHONE_USED', 1900, 2566, 12,  3400, 2905, 12),
('iPhone 14 Pro',     '512GB', 'PHONE_USED', 1900, 2709, 12,  3700, 3033, 12),
('iPhone 14 Pro Max', '128GB', 'PHONE_USED', 1900, 2709, 12,  2900, 3160, 12),
('iPhone 14 Pro Max', '256GB', 'PHONE_USED', 1900, 2994, 12,  4200, 3288, 12),
('iPhone 15',         '128GB', 'PHONE_USED',  900, 2424, 12,  3700, 2523, 12),
('iPhone 15',         '256GB', 'PHONE_USED',  900, 2566, 12,  3900, 2650, 12),
('iPhone 15 Plus',    '128GB', 'PHONE_USED', 1900, 2566, 12,  3400, 2905, 12),
('iPhone 15 Plus',    '256GB', 'PHONE_USED', 1900, 2566, 12,  2700, 3033, 12),
('iPhone 15 Pro',     '128GB', 'PHONE_USED', 3500, 2766, 12,  3400, 3415, 12),
('iPhone 15 Pro',     '256GB', 'PHONE_USED', 3500, 2766, 12,  2700, 3543, 12),
('iPhone 15 Pro Max', '256GB', 'PHONE_USED', 3900, 3137, 12,  2700, 4053, 12),
('iPhone 15 Pro Max', '512GB', 'PHONE_USED', 4100, 3251, 12,  2900, 4180, 12),
('iPhone 16',         '128GB', 'PHONE_USED', 3300, 2652, 12,  3900, 2741, 15),
('iPhone 16 Plus',    '128GB', 'PHONE_USED', 3800, 3008, 12,  5400, 2961, 15),
('iPhone 16 Plus',    '256GB', 'PHONE_USED', 3900, 3137, 12,  5700, 3071, 15),
('iPhone 16 Pro',     '128GB', 'PHONE_USED', 3900, 3137, 12,  3400, 3401, 15),
('iPhone 16 Pro',     '256GB', 'PHONE_USED', 4100, 3251, 12,  3700, 3511, 15),
('iPhone 16 Pro Max', '256GB', 'PHONE_USED', 4800, 3793, 12,  3700, 4171, 15),
('iPhone 16 Pro Max', '512GB', 'PHONE_USED', 5100, 4106, 12,  4700, 4391, 15),
('iPhone 17',         '256GB', 'PHONE_USED', 4100, 3251, 12,  6700, 3071, 15),
('iPhone 17 Air',     '256GB', 'PHONE_USED', 4100, 3251, 12,  4400, 3401, 15),
('iPhone 17 Pro',     '256GB', 'PHONE_USED', 5400, 4292, 12,  4800, 4612, 15),
('iPhone 17 Pro Max', '256GB', 'PHONE_USED', 9900, 4577, 12,  7500, 5162, 15),
('iPhone 17 Pro Max', '512GB', 'PHONE_USED', 9900, 5133, 12,  5400, 6042, 15);

-- update แถวที่มีอยู่แล้ว
UPDATE pricing_templates pt SET
  installment_bestchoice_price = s.r1_monthly,
  installment_finance_price    = s.r2_monthly,
  rate1_down_payment = s.r1_down, rate1_term_months = s.r1_term,
  rate2_down_payment = s.r2_down, rate2_term_months = s.r2_term,
  is_active = TRUE, updated_at = NOW()
FROM seed_rates s
WHERE pt.model = s.model AND pt.storage = s.storage
  AND pt.category::text = s.category AND pt.deleted_at IS NULL;

-- insert แถวที่ยังไม่มี
INSERT INTO pricing_templates
  (id, brand, model, storage, category, has_warranty, cash_price,
   installment_bestchoice_price, installment_finance_price,
   rate1_down_payment, rate1_term_months, rate2_down_payment, rate2_term_months,
   is_active, created_at, updated_at)
SELECT gen_random_uuid()::text, 'Apple', s.model, s.storage,
       s.category::"ProductCategory", FALSE, 0,
       s.r1_monthly, s.r2_monthly,
       s.r1_down, s.r1_term, s.r2_down, s.r2_term,
       TRUE, NOW(), NOW()
FROM seed_rates s
WHERE NOT EXISTS (
  SELECT 1 FROM pricing_templates pt
  WHERE pt.model = s.model AND pt.storage = s.storage
    AND pt.category::text = s.category AND pt.deleted_at IS NULL
);

COMMIT;

SELECT category, count(*) FROM pricing_templates
WHERE is_active AND deleted_at IS NULL GROUP BY 1;
SELECT model, storage, rate1_down_payment AS bc_down, installment_bestchoice_price AS bc_m,
       rate1_term_months AS bc_term, rate2_down_payment AS gfin_down,
       installment_finance_price AS gfin_m, rate2_term_months AS gfin_term
FROM pricing_templates WHERE model = 'iPhone 15 Plus' AND deleted_at IS NULL;
