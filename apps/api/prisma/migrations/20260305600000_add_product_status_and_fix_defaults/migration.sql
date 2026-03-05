-- Add new ProductStatus enum values for stock adjustments
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'DAMAGED';
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'LOST';
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'WRITTEN_OFF';

-- Fix StockCountItem actualFound default from true to false
ALTER TABLE "stock_count_items" ALTER COLUMN "actual_found" SET DEFAULT false;
