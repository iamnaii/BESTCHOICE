-- T6-C2: Add an atomic idempotency marker for referral point awards.
--
-- Background: awardReferralPoints() previously checked LoyaltyPoint rows that
-- are never created for referrals, so retries or concurrent calls could award
-- points more than once (race condition flagged during the fraud audit).
--
-- Fix: move the idempotency check into a single atomic UPDATE on the
-- referred customer's row. The point-credit transaction is guarded by
-- `referralAwardedAt IS NULL`; only the first caller wins.

ALTER TABLE "customers"
ADD COLUMN "referral_awarded_at" TIMESTAMP(3);

-- Backfill: for any referred customer who already has at least one contract
-- in the system, assume the referral was already awarded and mark it using
-- the first contract's created_at so a new call cannot double-credit.
-- Contract has no dedicated activation timestamp, so created_at is the
-- closest proxy available in the schema.
UPDATE "customers" c
SET "referral_awarded_at" = sub.created_at
FROM (
  SELECT DISTINCT ON (co.customer_id)
    co.customer_id,
    co.created_at
  FROM "contracts" co
  WHERE co.deleted_at IS NULL
  ORDER BY co.customer_id, co.created_at ASC
) sub
WHERE c.id = sub.customer_id
  AND c.referred_by_id IS NOT NULL
  AND c.deleted_at IS NULL;
