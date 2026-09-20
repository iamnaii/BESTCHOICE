-- Shop cash close (day-close count) — additive only.
-- shop_cash_float: fixed change float left in the drawer after each close (owner decision 2026-09-20).
CREATE TYPE "ShopCashCloseStatus" AS ENUM ('PENDING_CONFIRM', 'CONFIRMED', 'SENT_BACK');
CREATE TYPE "ShopCashDestination" AS ENUM ('OWNER_HOLD', 'BANK_DEPOSIT', 'BRANCH_SAFE');

ALTER TABLE "branches" ADD COLUMN "shop_cash_float" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE TABLE "shop_cash_closes" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "status" "ShopCashCloseStatus" NOT NULL DEFAULT 'PENDING_CONFIRM',
    "attempt_no" INTEGER NOT NULL DEFAULT 1,
    "period_start" TIMESTAMP(3),
    "float_amount" DECIMAL(12,2) NOT NULL,
    "cash_in" DECIMAL(12,2) NOT NULL,
    "cash_out" DECIMAL(12,2) NOT NULL,
    "expected_amount" DECIMAL(12,2) NOT NULL,
    "counted_amount" DECIMAL(12,2) NOT NULL,
    "variance_amount" DECIMAL(12,2) NOT NULL,
    "variance_reason" TEXT,
    "send_amount" DECIMAL(12,2) NOT NULL,
    "counted_by_id" TEXT NOT NULL,
    "counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_amount" DECIMAL(12,2),
    "receive_variance" DECIMAL(12,2),
    "receive_note" TEXT,
    "destination" "ShopCashDestination",
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "sent_back_by_id" TEXT,
    "sent_back_at" TIMESTAMP(3),
    "sent_back_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_cash_closes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shop_cash_closes_branch_id_counted_at_idx" ON "shop_cash_closes"("branch_id", "counted_at");
CREATE INDEX "shop_cash_closes_status_idx" ON "shop_cash_closes"("status");

ALTER TABLE "shop_cash_closes" ADD CONSTRAINT "shop_cash_closes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shop_cash_closes" ADD CONSTRAINT "shop_cash_closes_counted_by_id_fkey" FOREIGN KEY ("counted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shop_cash_closes" ADD CONSTRAINT "shop_cash_closes_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shop_cash_closes" ADD CONSTRAINT "shop_cash_closes_sent_back_by_id_fkey" FOREIGN KEY ("sent_back_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
