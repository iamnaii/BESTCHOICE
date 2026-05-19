-- P4-SP4: ContractCancellation model + CANCELED enum value
-- Adds contract cancellation workflow with JE reversal support.

-- Add CANCELED to ContractStatus enum
ALTER TYPE "ContractStatus" ADD VALUE 'CANCELED';

-- Add ContractCancellationStatus enum
CREATE TYPE "ContractCancellationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- Create contract_cancellations table
CREATE TABLE "contract_cancellations" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refund_amount" DECIMAL(12,2) NOT NULL,
    "status" "ContractCancellationStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "reversal_journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contract_cancellations_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on reversal_journal_entry_id (1:1 with JournalEntry)
CREATE UNIQUE INDEX "contract_cancellations_reversal_journal_entry_id_key"
    ON "contract_cancellations"("reversal_journal_entry_id");

-- Indexes for common query patterns
CREATE INDEX "contract_cancellations_contract_id_idx"
    ON "contract_cancellations"("contract_id");

CREATE INDEX "contract_cancellations_status_idx"
    ON "contract_cancellations"("status");

-- Foreign keys
ALTER TABLE "contract_cancellations"
    ADD CONSTRAINT "contract_cancellations_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contract_cancellations"
    ADD CONSTRAINT "contract_cancellations_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contract_cancellations"
    ADD CONSTRAINT "contract_cancellations_approved_by_id_fkey"
    FOREIGN KEY ("approved_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contract_cancellations"
    ADD CONSTRAINT "contract_cancellations_reversal_journal_entry_id_fkey"
    FOREIGN KEY ("reversal_journal_entry_id") REFERENCES "journal_entries"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
