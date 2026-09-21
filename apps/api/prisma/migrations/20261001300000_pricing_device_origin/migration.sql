CREATE TYPE "PricingDeviceOrigin" AS ENUM ('UNSPECIFIED', 'THAI', 'IMPORTED');
ALTER TABLE "pricing_templates" ADD COLUMN "device_origin" "PricingDeviceOrigin" NOT NULL DEFAULT 'UNSPECIFIED';
DROP INDEX "pricing_templates_brand_model_storage_category_has_warranty_key";
CREATE UNIQUE INDEX "pricing_templates_market_key" ON "pricing_templates" ("brand", "model", "storage", "category", "has_warranty", "device_origin");
