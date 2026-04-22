-- CreateEnum
CREATE TYPE "OnlineOrderStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PENDING_BANK_REVIEW', 'PAID', 'PACKING', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OnlinePaymentChannel" AS ENUM ('PROMPTPAY_QR', 'CREDIT_DEBIT_CARD', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "OnlineShippingMethod" AS ENUM ('BRANCH_PICKUP', 'KERRY', 'FLASH', 'JT_EXPRESS', 'THAILAND_POST');

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "online_order_id" TEXT,
ADD COLUMN     "sale_source" TEXT DEFAULT 'OFFLINE';

-- CreateTable
CREATE TABLE "online_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "product_price" DECIMAL(12,2) NOT NULL,
    "shipping_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "promo_code" TEXT,
    "promo_discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "promotion_usage_id" TEXT,
    "loyalty_points_used" INTEGER NOT NULL DEFAULT 0,
    "loyalty_discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "shipping_method" "OnlineShippingMethod" NOT NULL,
    "shipping_address" JSONB,
    "tracking_number" TEXT,
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "payment_channel" "OnlinePaymentChannel" NOT NULL,
    "payment_link_id" TEXT,
    "payment_ref" TEXT,
    "paid_at" TIMESTAMP(3),
    "bank_slip_url" TEXT,
    "bank_confirmed_by_id" TEXT,
    "status" "OnlineOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "sale_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "online_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "online_orders_order_number_key" ON "online_orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "online_orders_reservation_id_key" ON "online_orders"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "online_orders_sale_id_key" ON "online_orders"("sale_id");

-- CreateIndex
CREATE INDEX "online_orders_customer_id_idx" ON "online_orders"("customer_id");

-- CreateIndex
CREATE INDEX "online_orders_status_idx" ON "online_orders"("status");

-- CreateIndex
CREATE INDEX "online_orders_created_at_idx" ON "online_orders"("created_at");

-- CreateIndex
CREATE INDEX "online_orders_order_number_idx" ON "online_orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_online_order_id_key" ON "sales"("online_order_id");

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "product_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
