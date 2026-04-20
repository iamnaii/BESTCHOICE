-- CreateEnum
CREATE TYPE "CustomerCreditCheckStatus" AS ENUM ('NONE', 'PRE_CHECK_PASSED', 'FULL_CHECK_PASSED', 'REJECTED', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "CreditCheckType" AS ENUM ('PRE', 'FULL');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "credit_check_status" "CustomerCreditCheckStatus" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "credit_checks" ADD COLUMN "check_type" "CreditCheckType" NOT NULL DEFAULT 'FULL';
