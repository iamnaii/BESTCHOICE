-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('AUTO_RELATIONSHIP', 'AUTO_RECENT', 'AUTO_BRANCH', 'AUTO_ROUNDROBIN', 'MANAGER_OVERRIDE', 'SELF_CLAIMED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentOutcome" AS ENUM ('CALL_CONNECTED', 'CALL_NO_ANSWER', 'LINE_SENT', 'SMS_SENT', 'PAYMENT_RECEIVED', 'PROMISE_MADE', 'REFUSED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SkipReason" AS ENUM ('BUSY', 'WRONG_QUEUE', 'PERSONAL_CONFLICT', 'OTHER');

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "collections_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "preferences" JSONB;

-- CreateTable
CREATE TABLE "DailyAssignment" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "collectorId" TEXT,
    "contractId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "AssignmentSource" NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "outcome" "AssignmentOutcome",
    "skipReason" "SkipReason",
    "skipNote" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockExpiresAt" TIMESTAMP(3),
    "escalationFlag" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "paymentId" TEXT,
    "lineMessageId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DailyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyAssignment_collectorId_date_idx" ON "DailyAssignment"("collectorId", "date");

-- CreateIndex
CREATE INDEX "DailyAssignment_date_status_idx" ON "DailyAssignment"("date", "status");

-- CreateIndex
CREATE INDEX "DailyAssignment_escalationFlag_date_idx" ON "DailyAssignment"("escalationFlag", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAssignment_date_contractId_key" ON "DailyAssignment"("date", "contractId");

-- AddForeignKey
ALTER TABLE "DailyAssignment" ADD CONSTRAINT "DailyAssignment_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAssignment" ADD CONSTRAINT "DailyAssignment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
