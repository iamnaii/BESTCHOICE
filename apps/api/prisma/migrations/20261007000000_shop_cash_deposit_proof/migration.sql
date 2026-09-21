-- Shop cash close — proof that the money reached the company (owner decision 2026-09-21, mockup boards 10-11). Additive only.
-- 1) deposit slip + reference on a close confirmed with destination BANK_DEPOSIT
ALTER TABLE "shop_cash_closes" ADD COLUMN "deposit_slip_key" TEXT;
ALTER TABLE "shop_cash_closes" ADD COLUMN "deposit_reference" TEXT;

-- 2) later deposits of cash that was received but parked (branch safe / held by the owner)
CREATE TABLE "shop_cash_deposits" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "source" "ShopCashDestination" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "slip_key" TEXT NOT NULL,
    "note" TEXT,
    "deposited_by_id" TEXT NOT NULL,
    "deposited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_cash_deposits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shop_cash_deposits_branch_id_source_idx" ON "shop_cash_deposits"("branch_id", "source");

ALTER TABLE "shop_cash_deposits" ADD CONSTRAINT "shop_cash_deposits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shop_cash_deposits" ADD CONSTRAINT "shop_cash_deposits_deposited_by_id_fkey" FOREIGN KEY ("deposited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
