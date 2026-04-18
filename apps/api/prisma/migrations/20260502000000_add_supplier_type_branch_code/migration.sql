-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('INDIVIDUAL', 'JURISTIC');

-- AlterTable: add new columns (all optional / with default so existing rows backfill safely)
ALTER TABLE "suppliers"
  ADD COLUMN "type" "SupplierType" NOT NULL DEFAULT 'JURISTIC',
  ADD COLUMN "title_name" TEXT,
  ADD COLUMN "branch_code" TEXT;
