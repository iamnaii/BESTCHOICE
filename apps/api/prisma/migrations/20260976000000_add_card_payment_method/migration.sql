-- T8: add CARD to the PaymentMethod enum (EDC channel — money lands in a bank account).
-- Additive + idempotent. Postgres 12+ allows ADD VALUE outside an explicit txn block;
-- IF NOT EXISTS makes a re-run a no-op.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CARD';
