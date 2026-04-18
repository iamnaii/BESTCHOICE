-- AlterTable: make contact_name optional + add contact_phone + contact_position
ALTER TABLE "suppliers"
  ALTER COLUMN "contact_name" DROP NOT NULL,
  ADD COLUMN "contact_phone" TEXT,
  ADD COLUMN "contact_position" TEXT;
