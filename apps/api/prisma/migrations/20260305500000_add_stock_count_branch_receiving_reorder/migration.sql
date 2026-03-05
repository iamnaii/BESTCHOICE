-- CreateTable
CREATE TABLE "reorder_points" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "storage" TEXT,
    "category" "ProductCategory" NOT NULL,
    "branch_id" TEXT NOT NULL,
    "min_quantity" INTEGER NOT NULL,
    "reorder_quantity" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reorder_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_alerts" (
    "id" TEXT NOT NULL,
    "reorder_point_id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "storage" TEXT,
    "category" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "current_stock" INTEGER NOT NULL,
    "min_quantity" INTEGER NOT NULL,
    "reorder_quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "po_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_receivings" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "received_by_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_receivings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_receiving_items" (
    "id" TEXT NOT NULL,
    "receiving_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "imei_serial" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PASS',
    "condition_notes" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_receiving_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "count_number" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "counted_by_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_items" (
    "id" TEXT NOT NULL,
    "stock_count_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "expected_status" TEXT NOT NULL,
    "actual_found" BOOLEAN NOT NULL DEFAULT true,
    "condition_notes" TEXT,
    "scanned_imei" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reorder_points_branch_id_idx" ON "reorder_points"("branch_id");
CREATE INDEX "reorder_points_is_active_idx" ON "reorder_points"("is_active");
CREATE UNIQUE INDEX "reorder_points_brand_model_storage_category_branch_id_key" ON "reorder_points"("brand", "model", "storage", "category", "branch_id");

-- CreateIndex
CREATE INDEX "stock_alerts_status_idx" ON "stock_alerts"("status");
CREATE INDEX "stock_alerts_branch_id_idx" ON "stock_alerts"("branch_id");
CREATE INDEX "stock_alerts_reorder_point_id_idx" ON "stock_alerts"("reorder_point_id");
CREATE INDEX "stock_alerts_created_at_idx" ON "stock_alerts"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "branch_receivings_transfer_id_key" ON "branch_receivings"("transfer_id");
CREATE INDEX "branch_receivings_transfer_id_idx" ON "branch_receivings"("transfer_id");

-- CreateIndex
CREATE INDEX "branch_receiving_items_receiving_id_idx" ON "branch_receiving_items"("receiving_id");
CREATE INDEX "branch_receiving_items_product_id_idx" ON "branch_receiving_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_count_number_key" ON "stock_counts"("count_number");
CREATE INDEX "stock_counts_branch_id_idx" ON "stock_counts"("branch_id");
CREATE INDEX "stock_counts_status_idx" ON "stock_counts"("status");
CREATE INDEX "stock_counts_created_at_idx" ON "stock_counts"("created_at");

-- CreateIndex
CREATE INDEX "stock_count_items_stock_count_id_idx" ON "stock_count_items"("stock_count_id");
CREATE INDEX "stock_count_items_product_id_idx" ON "stock_count_items"("product_id");
CREATE UNIQUE INDEX "stock_count_items_stock_count_id_product_id_key" ON "stock_count_items"("stock_count_id", "product_id");

-- AddForeignKey
ALTER TABLE "reorder_points" ADD CONSTRAINT "reorder_points_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_reorder_point_id_fkey" FOREIGN KEY ("reorder_point_id") REFERENCES "reorder_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_receivings" ADD CONSTRAINT "branch_receivings_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_receivings" ADD CONSTRAINT "branch_receivings_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_receiving_items" ADD CONSTRAINT "branch_receiving_items_receiving_id_fkey" FOREIGN KEY ("receiving_id") REFERENCES "branch_receivings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_receiving_items" ADD CONSTRAINT "branch_receiving_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_counted_by_id_fkey" FOREIGN KEY ("counted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
