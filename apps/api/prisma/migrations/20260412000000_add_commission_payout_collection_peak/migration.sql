-- Commission Payout
CREATE TYPE "PayoutStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

CREATE TABLE "commission_payouts" (
    "id" TEXT NOT NULL,
    "salesperson_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "total_sales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commission_count" INTEGER NOT NULL DEFAULT 0,
    "status" "PayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "paid_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "commission_payouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commission_payouts_salesperson_id_period_key" ON "commission_payouts"("salesperson_id", "period");
CREATE INDEX "commission_payouts_status_idx" ON "commission_payouts"("status");
CREATE INDEX "commission_payouts_period_idx" ON "commission_payouts"("period");

ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Collection fields on Contract
ALTER TABLE "contracts" ADD COLUMN "collection_notes" TEXT;
ALTER TABLE "contracts" ADD COLUMN "last_contact_date" TIMESTAMP(3);

-- PEAK sync timestamp on JournalEntry
ALTER TABLE "journal_entries" ADD COLUMN "peak_synced_at" TIMESTAMP(3);
