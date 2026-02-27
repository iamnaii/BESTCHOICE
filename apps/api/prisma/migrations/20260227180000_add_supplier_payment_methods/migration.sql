-- CreateTable
CREATE TABLE "supplier_payment_methods" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "bank_name" TEXT,
    "bank_account_name" TEXT,
    "bank_account_number" TEXT,
    "credit_term_days" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_payment_methods_supplier_id_idx" ON "supplier_payment_methods"("supplier_id");

-- AddForeignKey
ALTER TABLE "supplier_payment_methods" ADD CONSTRAINT "supplier_payment_methods_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing data: move payment info from suppliers to payment_methods table
-- Only runs if old columns exist (fresh DB won't have them)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='payment_method') THEN
    INSERT INTO "supplier_payment_methods" ("id", "supplier_id", "payment_method", "bank_name", "bank_account_name", "bank_account_number", "credit_term_days", "is_default", "created_at", "updated_at")
    SELECT gen_random_uuid(), "id", "payment_method", "bank_name", "bank_account_name", "bank_account_number", "credit_term_days", true, NOW(), NOW()
    FROM "suppliers"
    WHERE "payment_method" IS NOT NULL;
  END IF;
END $$;

-- Drop old columns from suppliers (safe with IF EXISTS)
ALTER TABLE "suppliers" DROP COLUMN IF EXISTS "payment_method";
ALTER TABLE "suppliers" DROP COLUMN IF EXISTS "bank_name";
ALTER TABLE "suppliers" DROP COLUMN IF EXISTS "bank_account_name";
ALTER TABLE "suppliers" DROP COLUMN IF EXISTS "bank_account_number";
ALTER TABLE "suppliers" DROP COLUMN IF EXISTS "credit_term_days";
