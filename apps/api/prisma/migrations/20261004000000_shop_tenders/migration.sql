-- CreateEnum
CREATE TYPE "ShopTenderDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "ShopTenderKind" AS ENUM ('CASH_SALE', 'EXTERNAL_FINANCE_DOWN', 'CONTRACT_DOWN', 'BOOKING_DEPOSIT', 'TRADE_IN_PAYOUT', 'SALE_VOID_REFUND', 'CONTRACT_DOWN_REFUND', 'BOOKING_DEPOSIT_REFUND');

-- CreateTable
CREATE TABLE "shop_tenders" (
    "id" TEXT NOT NULL,
    "direction" "ShopTenderDirection" NOT NULL,
    "kind" "ShopTenderKind" NOT NULL,
    "branch_id" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "actor_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "seq_total" INTEGER NOT NULL DEFAULT 1,
    "sale_id" TEXT,
    "contract_id" TEXT,
    "booking_id" TEXT,
    "trade_in_id" TEXT,
    "reverses_tender_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_tenders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_tenders_branch_id_occurred_at_idx" ON "shop_tenders"("branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "shop_tenders_actor_id_occurred_at_idx" ON "shop_tenders"("actor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "shop_tenders_reference_idx" ON "shop_tenders"("reference");

-- CreateIndex
CREATE INDEX "shop_tenders_sale_id_idx" ON "shop_tenders"("sale_id");

-- CreateIndex
CREATE INDEX "shop_tenders_contract_id_idx" ON "shop_tenders"("contract_id");

-- CreateIndex
CREATE INDEX "shop_tenders_booking_id_idx" ON "shop_tenders"("booking_id");

-- CreateIndex
CREATE INDEX "shop_tenders_trade_in_id_idx" ON "shop_tenders"("trade_in_id");

-- AddForeignKey
ALTER TABLE "shop_tenders" ADD CONSTRAINT "shop_tenders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_tenders" ADD CONSTRAINT "shop_tenders_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_tenders" ADD CONSTRAINT "shop_tenders_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_tenders" ADD CONSTRAINT "shop_tenders_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_tenders" ADD CONSTRAINT "shop_tenders_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_tenders" ADD CONSTRAINT "shop_tenders_trade_in_id_fkey" FOREIGN KEY ("trade_in_id") REFERENCES "trade_ins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_tenders" ADD CONSTRAINT "shop_tenders_reverses_tender_id_fkey" FOREIGN KEY ("reverses_tender_id") REFERENCES "shop_tenders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

