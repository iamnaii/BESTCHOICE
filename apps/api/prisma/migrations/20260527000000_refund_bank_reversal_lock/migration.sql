-- T1-C8: bank-reversal write-once lock. Once bankReversalRef is first
-- written, this timestamp is set and the service layer blocks further
-- mutations to bankReversalRef / bankReversalAt. Keeps a clean, frozen
-- record of the bank evidence for audit.

ALTER TABLE "refunds"
  ADD COLUMN "bank_reversal_locked_at" TIMESTAMP(3);
