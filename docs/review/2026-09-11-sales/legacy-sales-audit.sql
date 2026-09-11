-- Read-only diagnostics after the sale_cost_snapshot migration.
-- IDs/document numbers only; no customer PII. These are review candidates, not corrections.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';

SELECT COUNT(*) AS completed_sales_without_cost_snapshot
FROM sales s LEFT JOIN sale_cost_snapshots c ON c.sale_id = s.id
LEFT JOIN contracts ct ON ct.id = s.contract_id
WHERE s.deleted_at IS NULL AND c.sale_id IS NULL
  AND (s.contract_id IS NULL OR (ct.status <> 'DRAFT' AND ct.deleted_at IS NULL));

SELECT s.id, s.sale_number, b.booking_number,
  b.deposit_amount, b.deposit_method, b.deposit_paid_at, b.converted_at,
  s.down_payment_amount, s.amount_received, s.net_amount, s.payment_method
FROM sales s JOIN bookings b ON b.converted_to_sale_id = s.id
WHERE b.deposit_paid_at IS NULL OR b.deposit_method IS NULL OR b.converted_at IS NULL
  OR s.amount_received IS NULL OR s.down_payment_amount IS NULL
  OR s.amount_received <> s.net_amount OR b.deposit_amount <> s.down_payment_amount
  OR b.deposit_amount > s.net_amount OR b.deposit_amount < 0
  OR b.deposit_method::text NOT IN ('CASH', 'BANK_TRANSFER', 'QR_EWALLET')
  OR (b.deposit_amount < s.net_amount AND (s.payment_method IS NULL
    OR s.payment_method::text NOT IN ('CASH', 'BANK_TRANSFER', 'QR_EWALLET')))
ORDER BY s.created_at, s.id;

-- Candidate legacy external-finance receipts: inspect source evidence before changing anything.
SELECT id, sale_number, amount_received, down_payment_amount, finance_amount
FROM sales WHERE deleted_at IS NULL AND sale_type = 'EXTERNAL_FINANCE'
  AND (amount_received IS NULL OR amount_received IS DISTINCT FROM down_payment_amount)
ORDER BY created_at, id;

-- Cost drift is informational: a current product cost difference must NOT rewrite history.
SELECT s.id, s.sale_number, c.main_product_cost, p.cost_price AS current_product_cost
FROM sales s JOIN sale_cost_snapshots c ON c.sale_id = s.id JOIN products p ON p.id = s.product_id
WHERE c.main_product_cost <> p.cost_price ORDER BY s.created_at, s.id;
ROLLBACK;
