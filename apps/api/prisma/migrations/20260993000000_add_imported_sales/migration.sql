-- CreateTable "imported_sales"
CREATE TABLE "imported_sales" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'TOOLTIFY',
    "barcode" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "buyer_label" TEXT NOT NULL,
    "shop_label" TEXT,
    "order_number" TEXT NOT NULL,
    "payment_type" TEXT NOT NULL,
    "price_group" TEXT NOT NULL,
    "sale_channel" TEXT NOT NULL,
    "cost_total" DECIMAL(12,2) NOT NULL,
    "list_price" DECIMAL(12,2) NOT NULL,
    "sale_price" DECIMAL(12,2) NOT NULL,
    "profit" DECIMAL(12,2) NOT NULL,
    "salesperson_name" TEXT NOT NULL,
    "sold_at" TIMESTAMP(3) NOT NULL,
    "import_batch" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "imported_sales_source_barcode_order_number_sold_at_key" ON "imported_sales"("source", "barcode", "order_number", "sold_at");

-- CreateIndex
CREATE INDEX "imported_sales_sold_at_idx" ON "imported_sales"("sold_at");

-- CreateIndex
CREATE INDEX "imported_sales_sale_channel_idx" ON "imported_sales"("sale_channel");

-- CreateIndex
CREATE INDEX "imported_sales_salesperson_name_idx" ON "imported_sales"("salesperson_name");

-- CreateIndex
CREATE INDEX "imported_sales_category_idx" ON "imported_sales"("category");

-- CreateIndex
CREATE INDEX "imported_sales_order_number_idx" ON "imported_sales"("order_number");
