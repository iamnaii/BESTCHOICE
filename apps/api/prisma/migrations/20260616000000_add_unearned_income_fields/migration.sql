-- Phase A.2 — Deferred income tracking on Contract.
-- Stores the unrecognised portion of interest + commission per contract.
-- Activation: unearnedInterest = interestTotal, unearnedCommission = storeCommission.
-- Each payment moves the monthly slice from Unearned (Cr) to Earned (Cr Income).

ALTER TABLE "contracts"
  ADD COLUMN "unearned_interest"   DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "unearned_commission" DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- Backfill ACTIVE/OVERDUE/DEFAULT contracts: unearned = total - already-earned-portion.
-- "Already earned" approximated as (paid_count / total_months) * total. Pre-Phase-A.2
-- JEs were buggy (double-counted), so this is the cleanest heuristic for the new
-- per-payment recognition to take over from. Fully PAID/COMPLETED contracts get 0.
UPDATE "contracts" c
SET
  "unearned_interest"   = GREATEST(0, c."interest_total"   - COALESCE((
    SELECT SUM(p."monthly_interest") FROM "payments" p
    WHERE p."contract_id" = c."id" AND p."status" = 'PAID' AND p."deleted_at" IS NULL
  ), 0)),
  "unearned_commission" = GREATEST(0, COALESCE(c."store_commission", 0) - COALESCE((
    SELECT SUM(p."monthly_commission") FROM "payments" p
    WHERE p."contract_id" = c."id" AND p."status" = 'PAID' AND p."deleted_at" IS NULL
  ), 0))
WHERE c."status" IN ('ACTIVE', 'OVERDUE', 'DEFAULT')
  AND c."deleted_at" IS NULL;
