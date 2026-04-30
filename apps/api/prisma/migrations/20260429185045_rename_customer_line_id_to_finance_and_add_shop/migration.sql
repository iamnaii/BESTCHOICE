-- Rename existing column (preserves data — current values assumed to be finance OA IDs)
ALTER TABLE "customers" RENAME COLUMN "line_id" TO "line_id_finance";

-- Add new column for shop OA
ALTER TABLE "customers" ADD COLUMN "line_id_shop" TEXT;
