-- AlterEnum
ALTER TYPE "ContractStatus" ADD VALUE 'DEFECT_EXCHANGED';

-- AlterEnum
ALTER TYPE "ProductStatus" ADD VALUE 'DEFECT_RETURN';

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN "device_received_at" TIMESTAMP(3);
