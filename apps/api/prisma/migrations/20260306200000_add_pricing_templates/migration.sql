-- CreateTable
CREATE TABLE "pricing_templates" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "storage" TEXT,
    "category" "ProductCategory" NOT NULL,
    "has_warranty" BOOLEAN,
    "cash_price" DECIMAL(12,2) NOT NULL,
    "installment_bestchoice_price" DECIMAL(12,2) NOT NULL,
    "installment_finance_price" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pricing_templates_brand_model_idx" ON "pricing_templates"("brand", "model");

-- CreateIndex
CREATE INDEX "pricing_templates_category_idx" ON "pricing_templates"("category");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_templates_brand_model_storage_category_has_warranty_key" ON "pricing_templates"("brand", "model", "storage", "category", "has_warranty");
