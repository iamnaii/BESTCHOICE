-- AlterTable
ALTER TABLE "customers" ADD COLUMN "prefix" TEXT;
ALTER TABLE "customers" ADD COLUMN "nickname" TEXT;
ALTER TABLE "customers" ADD COLUMN "is_foreigner" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customers" ADD COLUMN "birth_date" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "email" TEXT;
ALTER TABLE "customers" ADD COLUMN "facebook_link" TEXT;
ALTER TABLE "customers" ADD COLUMN "facebook_name" TEXT;
ALTER TABLE "customers" ADD COLUMN "facebook_friends" TEXT;
ALTER TABLE "customers" ADD COLUMN "google_map_link" TEXT;
ALTER TABLE "customers" ADD COLUMN "occupation_detail" TEXT;
ALTER TABLE "customers" ADD COLUMN "salary" DECIMAL(12,2);
ALTER TABLE "customers" ADD COLUMN "address_work" TEXT;
ALTER TABLE "customers" ADD COLUMN "references" JSONB;
