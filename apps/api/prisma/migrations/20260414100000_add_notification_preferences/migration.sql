-- AlterTable
ALTER TABLE "customers" ADD COLUMN "notif_payment_reminder" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "customers" ADD COLUMN "notif_overdue_notice" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "customers" ADD COLUMN "notif_receipt" BOOLEAN NOT NULL DEFAULT true;
