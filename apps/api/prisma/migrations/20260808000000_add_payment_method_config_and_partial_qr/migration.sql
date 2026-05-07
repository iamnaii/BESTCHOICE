-- Phase: Payment Method Config + Partial Payment QR
-- Adds:
--   1. payment_method_configs — maps CASH/TRANSFER/QR to CoA codes (cashier wizard filter)
--   2. partial_payment_links  — tracks active QR sent to customers via LINE OA

-- ─── 1. payment_method_configs ───────────────────────────────────
CREATE TABLE "payment_method_configs" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payment_method_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_method_configs_method_account_code_key"
    ON "payment_method_configs"("method", "account_code");

CREATE INDEX "payment_method_configs_method_enabled_idx"
    ON "payment_method_configs"("method", "enabled");


-- ─── 2. partial_payment_links ────────────────────────────────────
CREATE TABLE "partial_payment_links" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "gateway_ref" TEXT,
    "payment_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partial_payment_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partial_payment_links_token_key"
    ON "partial_payment_links"("token");

CREATE INDEX "partial_payment_links_payment_id_idx"
    ON "partial_payment_links"("payment_id");

CREATE INDEX "partial_payment_links_contract_id_idx"
    ON "partial_payment_links"("contract_id");

CREATE INDEX "partial_payment_links_status_expires_at_idx"
    ON "partial_payment_links"("status", "expires_at");

ALTER TABLE "partial_payment_links"
    ADD CONSTRAINT "partial_payment_links_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "partial_payment_links"
    ADD CONSTRAINT "partial_payment_links_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "partial_payment_links"
    ADD CONSTRAINT "partial_payment_links_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── 3. Seed default mappings ────────────────────────────────────
-- CASH method → 3 personal cash accounts (sort by name)
INSERT INTO "payment_method_configs" ("id", "method", "account_code", "is_default", "enabled", "sort_order", "created_at", "updated_at") VALUES
    (gen_random_uuid(), 'CASH', '11-1101', true,  true, 1, NOW(), NOW()),
    (gen_random_uuid(), 'CASH', '11-1102', false, true, 2, NOW(), NOW()),
    (gen_random_uuid(), 'CASH', '11-1103', false, true, 3, NOW(), NOW());

-- TRANSFER method → 3 bank accounts (KBank default)
INSERT INTO "payment_method_configs" ("id", "method", "account_code", "is_default", "enabled", "sort_order", "created_at", "updated_at") VALUES
    (gen_random_uuid(), 'TRANSFER', '11-1201', true,  true, 1, NOW(), NOW()),
    (gen_random_uuid(), 'TRANSFER', '11-1202', false, true, 2, NOW(), NOW()),
    (gen_random_uuid(), 'TRANSFER', '11-1203', false, true, 3, NOW(), NOW());

-- QR method → KBank only (PaySolutions deposits here)
INSERT INTO "payment_method_configs" ("id", "method", "account_code", "is_default", "enabled", "sort_order", "created_at", "updated_at") VALUES
    (gen_random_uuid(), 'QR', '11-1201', true, true, 1, NOW(), NOW());
