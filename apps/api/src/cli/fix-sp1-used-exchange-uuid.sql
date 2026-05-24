-- Fix-up: convert SP1 used-exchange seed string IDs → UUIDs + populate installment_price
-- so SubmitExchangeRequestDto (@IsUUID) passes + same-price check finds a price.
--
-- Prisma onUpdate defaults to CASCADE so sales.contract_id / contract_exchange_requests
-- references auto-follow. Safe to re-run (UPDATEs are idempotent).
--
-- Run:
--   psql "postgresql://iamnaii@localhost:5432/bestchoice" \
--     -f apps/api/src/cli/fix-sp1-used-exchange-uuid.sql

BEGIN;

-- 1. Contract: sp1-ctr-used → UUID
UPDATE contracts
   SET id = '11111111-1111-4111-a111-000000000007'
 WHERE id = 'sp1-ctr-used';

-- 2. Products: convert IDs + populate installment_price so same-price filter works
UPDATE products SET id = '22222222-2222-4222-a222-000000000007', installment_price = 22000.00
 WHERE id = 'sp1-prod-used-old';

UPDATE products SET id = '22222222-2222-4222-a222-000000000012', installment_price = 22000.00
 WHERE id = 'sp1-prod-used-rep-1';

UPDATE products SET id = '22222222-2222-4222-a222-000000000013', installment_price = 22000.00
 WHERE id = 'sp1-prod-used-rep-2';

UPDATE products SET id = '22222222-2222-4222-a222-000000000014', installment_price = 19000.00
 WHERE id = 'sp1-prod-used-rep-3';

-- 3. Customer + sale (not strictly required by DTO but keep consistent)
UPDATE customers SET id = '33333333-3333-4333-a333-000000000007'
 WHERE id = 'sp1-cust-used';

UPDATE sales SET id = '44444444-4444-4444-a444-000000000007'
 WHERE id = 'sp1-sale-used';

COMMIT;

-- Verify
SELECT id, contract_number, status FROM contracts WHERE id = '11111111-1111-4111-a111-000000000007';
SELECT id, name, installment_price, status FROM products
 WHERE id LIKE '22222222-2222-4222-a222-%' ORDER BY id;

\echo '────────────────────────────────────────────────────────────────────'
\echo 'Open this URL in browser to test exchange:'
\echo 'http://localhost:5173/insurance/exchange-request/new?contractId=11111111-1111-4111-a111-000000000007'
\echo '────────────────────────────────────────────────────────────────────'
