-- Add the SHOP per-branch cash-till account code (S11-110x). Nullable: set per branch
-- in settings before SHOP cash-route JEs (down payment / cash sale / trade-in) post.
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "shop_cash_account_code" TEXT;
