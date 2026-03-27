-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ONLINE_GATEWAY';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "gateway_ref" TEXT,
ADD COLUMN     "gateway_response" JSONB,
ADD COLUMN     "gateway_status" TEXT,
ADD COLUMN     "paid_at" TIMESTAMP(3);
