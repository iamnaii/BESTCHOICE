-- CreateEnum
CREATE TYPE "ExchangeMode" AS ENUM ('MEMO', 'PRICED');

-- CreateEnum
CREATE TYPE "ExchangeApprovalTier" AS ENUM ('AUTO', 'REVIEW', 'ESCALATE');

-- AlterEnum
ALTER TYPE "ExchangeRequestStatus" ADD VALUE 'CANCELED';

-- AlterTable
ALTER TABLE "contract_exchange_requests" ADD COLUMN     "approval_tier" "ExchangeApprovalTier",
ADD COLUMN     "base_price_snapshot" DECIMAL(12,2),
ADD COLUMN     "buyback_price" DECIMAL(12,2),
ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancel_window" TEXT,
ADD COLUMN     "canceled_at" TIMESTAMP(3),
ADD COLUMN     "canceled_by_id" TEXT,
ADD COLUMN     "deposit_account_code" TEXT,
ADD COLUMN     "device_condition" TEXT,
ADD COLUMN     "ecl_reversal_je_id" TEXT,
ADD COLUMN     "memo_applied_at" TIMESTAMP(3),
ADD COLUMN     "mode" "ExchangeMode" NOT NULL DEFAULT 'PRICED',
ADD COLUMN     "ncv_snapshot" DECIMAL(12,2),
ADD COLUMN     "new_interest_rate" DECIMAL(5,4),
ADD COLUMN     "new_interest_total" DECIMAL(12,2),
ADD COLUMN     "new_monthly_payment" DECIMAL(12,2),
ADD COLUMN     "new_store_commission" DECIMAL(12,2),
ADD COLUMN     "new_total_months" INTEGER,
ADD COLUMN     "new_vat_amount" DECIMAL(12,2),
ADD COLUMN     "penalty_amount" DECIMAL(12,2),
ADD COLUMN     "penalty_je_id" TEXT,
ADD COLUMN     "reversal_je_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
