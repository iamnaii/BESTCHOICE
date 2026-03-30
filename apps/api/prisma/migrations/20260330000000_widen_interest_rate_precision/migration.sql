-- AlterTable: widen interest_rate from DECIMAL(5,4) to DECIMAL(6,4)
-- Supports interest rates >= 10% (e.g. 12.5000)

ALTER TABLE "contracts" ALTER COLUMN "interest_rate" TYPE DECIMAL(6,4);
ALTER TABLE "interest_configs" ALTER COLUMN "interest_rate" TYPE DECIMAL(6,4);
