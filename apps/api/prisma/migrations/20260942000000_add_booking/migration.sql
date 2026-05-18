-- P2-SP4: Booking module (การจอง / มัดจำ) — SHOP-side pre-sale reservation.
-- Adds Booking + BookingItem tables and BookingStatus enum.
-- All statements are idempotent so the migration is safe to re-run after a
-- partial failure (matches the pattern from PR #828 + P2-SP3 quote module).

-- CreateEnum (idempotent — postgres enum CREATE TYPE has no IF NOT EXISTS)
DO $$ BEGIN
    CREATE TYPE "BookingStatus" AS ENUM ('PENDING_DEPOSIT', 'PAID', 'CANCELED', 'EXPIRED', 'CONVERTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "bookings" (
    "id" TEXT NOT NULL,
    "booking_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_DEPOSIT',
    "deposit_amount" DECIMAL(12,2) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "expire_date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "deposit_paid_at" TIMESTAMP(3),
    "deposit_method" "PaymentMethod",
    "deposit_account_code" TEXT,
    "deposit_received_by_id" TEXT,
    "canceled_at" TIMESTAMP(3),
    "canceled_by_id" TEXT,
    "cancel_reason" TEXT,
    "converted_to_sale_id" TEXT,
    "converted_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- Add column if table pre-existed without it (no-op when CREATE TABLE just
-- ran above with the column already inline).
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "deposit_account_code" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "booking_items" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "product_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_booking_number_key" ON "bookings"("booking_number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_converted_to_sale_id_key" ON "bookings"("converted_to_sale_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bookings_customer_id_deleted_at_idx" ON "bookings"("customer_id", "deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bookings_branch_id_status_deleted_at_idx" ON "bookings"("branch_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bookings_status_expire_date_idx" ON "bookings"("status", "expire_date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bookings_created_at_idx" ON "bookings"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "booking_items_booking_id_idx" ON "booking_items"("booking_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "booking_items_product_id_idx" ON "booking_items"("product_id");

-- AddForeignKey (idempotent via DO block — Postgres FKs have no IF NOT EXISTS)
DO $$ BEGIN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_canceled_by_id_fkey" FOREIGN KEY ("canceled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_converted_to_sale_id_fkey" FOREIGN KEY ("converted_to_sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
