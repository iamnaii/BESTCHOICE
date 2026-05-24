-- Issue #1086 item 6 — back-reference the SHOP re-intake JE
-- (ShopExchangeReturnTemplate, Dr S11-2002 / Cr S50-1102) on the exchange
-- request row so the audit trail can pin the inventory return to its
-- approval event. Nullable for backward compat with rows created before
-- PR #1088.
ALTER TABLE "contract_exchange_requests"
  ADD COLUMN "je_4_id" TEXT;
