-- CreateEnum
CREATE TYPE "ExchangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: contracts — add SP2 same-price exchange self-relation fields
ALTER TABLE "contracts"
  ADD COLUMN "exchanged_from_contract_id" TEXT,
  ADD COLUMN "exchanged_at"               TIMESTAMP(3);

-- UniqueConstraint: one-to-one self-relation (new contract ↔ old contract)
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_exchanged_from_contract_id_key" UNIQUE ("exchanged_from_contract_id");

-- CreateTable
CREATE TABLE "contract_exchange_requests" (
    "id"               TEXT NOT NULL,
    "old_contract_id"  TEXT NOT NULL,
    "old_product_id"   TEXT NOT NULL,
    "new_product_id"   TEXT NOT NULL,
    "condition_note"   TEXT,
    "condition_photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status"           "ExchangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "requested_by_id"  TEXT NOT NULL,
    "approved_by_id"   TEXT,
    "approved_at"      TIMESTAMP(3),
    "new_contract_id"  TEXT,
    "je_1a_id"         TEXT,
    "je_2_id"          TEXT,
    "je_3_id"          TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,
    "deleted_at"       TIMESTAMP(3),

    CONSTRAINT "contract_exchange_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique new_contract_id (one request produces one new contract)
CREATE UNIQUE INDEX "contract_exchange_requests_new_contract_id_key"
  ON "contract_exchange_requests"("new_contract_id");

-- CreateIndex: composite for status-based queue listing
CREATE INDEX "contract_exchange_requests_status_created_at_idx"
  ON "contract_exchange_requests"("status", "created_at");

-- CreateIndex: FK lookups
CREATE INDEX "contract_exchange_requests_old_contract_id_idx"
  ON "contract_exchange_requests"("old_contract_id");

CREATE INDEX "contract_exchange_requests_old_product_id_idx"
  ON "contract_exchange_requests"("old_product_id");

-- AddForeignKey: contracts self-relation (new → old via exchanged_from_contract_id)
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_exchanged_from_contract_id_fkey"
  FOREIGN KEY ("exchanged_from_contract_id")
  REFERENCES "contracts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: contract_exchange_requests → contracts (old)
ALTER TABLE "contract_exchange_requests"
  ADD CONSTRAINT "contract_exchange_requests_old_contract_id_fkey"
  FOREIGN KEY ("old_contract_id")
  REFERENCES "contracts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: contract_exchange_requests → products (old)
ALTER TABLE "contract_exchange_requests"
  ADD CONSTRAINT "contract_exchange_requests_old_product_id_fkey"
  FOREIGN KEY ("old_product_id")
  REFERENCES "products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: contract_exchange_requests → products (new)
ALTER TABLE "contract_exchange_requests"
  ADD CONSTRAINT "contract_exchange_requests_new_product_id_fkey"
  FOREIGN KEY ("new_product_id")
  REFERENCES "products"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: contract_exchange_requests → users (requester)
ALTER TABLE "contract_exchange_requests"
  ADD CONSTRAINT "contract_exchange_requests_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id")
  REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: contract_exchange_requests → users (approver, nullable)
ALTER TABLE "contract_exchange_requests"
  ADD CONSTRAINT "contract_exchange_requests_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: contract_exchange_requests → contracts (new, nullable 1:1)
ALTER TABLE "contract_exchange_requests"
  ADD CONSTRAINT "contract_exchange_requests_new_contract_id_fkey"
  FOREIGN KEY ("new_contract_id")
  REFERENCES "contracts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
