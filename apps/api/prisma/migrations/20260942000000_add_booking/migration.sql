-- P2-SP4: Booking module (การจอง / มัดจำ) — SHOP-side pre-sale reservation.
-- Adds Booking + BookingItem tables and BookingStatus enum.

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_DEPOSIT', 'PAID', 'CANCELED', 'EXPIRED', 'CONVERTED');

-- CreateTable
CREATE TABLE "bookings" (
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

-- CreateTable
CREATE TABLE "booking_items" (
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
CREATE UNIQUE INDEX "bookings_booking_number_key" ON "bookings"("booking_number");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_converted_to_sale_id_key" ON "bookings"("converted_to_sale_id");

-- CreateIndex
CREATE INDEX "bookings_customer_id_deleted_at_idx" ON "bookings"("customer_id", "deleted_at");

-- CreateIndex
CREATE INDEX "bookings_branch_id_status_deleted_at_idx" ON "bookings"("branch_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "bookings_status_expire_date_idx" ON "bookings"("status", "expire_date");

-- CreateIndex
CREATE INDEX "bookings_created_at_idx" ON "bookings"("created_at");

-- CreateIndex
CREATE INDEX "booking_items_booking_id_idx" ON "booking_items"("booking_id");

-- CreateIndex
CREATE INDEX "booking_items_product_id_idx" ON "booking_items"("product_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_canceled_by_id_fkey" FOREIGN KEY ("canceled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_converted_to_sale_id_fkey" FOREIGN KEY ("converted_to_sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
