-- T4-C2: auto-escalation can flip only up to NOTICE. FINAL_WARNING and
-- LEGAL_ACTION are parked on `pending_dunning_stage` waiting for a human
-- OWNER/FINANCE_MANAGER to approve. Cleared when approved (stage flips) or
-- rejected (pending fields blanked).

ALTER TABLE "contracts"
  ADD COLUMN "pending_dunning_stage" "DunningStage",
  ADD COLUMN "pending_dunning_since" TIMESTAMP(3);
