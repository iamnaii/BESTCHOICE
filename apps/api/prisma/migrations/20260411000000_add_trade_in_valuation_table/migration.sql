-- CreateTable
CREATE TABLE "trade_in_valuations" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "storage" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "base_price" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "trade_in_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trade_in_valuations_brand_model_storage_condition_key" ON "trade_in_valuations"("brand", "model", "storage", "condition");

-- CreateIndex
CREATE INDEX "trade_in_valuations_brand_idx" ON "trade_in_valuations"("brand");

-- CreateIndex
CREATE INDEX "trade_in_valuations_model_idx" ON "trade_in_valuations"("model");

-- CreateIndex
CREATE INDEX "trade_in_valuations_condition_idx" ON "trade_in_valuations"("condition");

-- CreateIndex
CREATE INDEX "trade_in_valuations_deleted_at_idx" ON "trade_in_valuations"("deleted_at");
