-- Tier-8 fraud heatmap — T3 batch
-- T3-C2: SlipFingerprint — cross-contract slip reuse detection.
-- T3-C4: FeeWaiverApproval — immutable approval evidence for late-fee waivers.
--
-- Both tables are append-only (no updated_at / deleted_at). A slip
-- fingerprint MUST NOT be mutated or erased, otherwise a fraudster could
-- reuse a receipt across contracts and delete the evidence afterwards. The
-- waiver approval row is the legal proof that a manager clicked "approve"
-- at a specific moment from a specific IP — destroying it would leave no
-- trace of the 4-eyes ceremony enforced in payments.service.waiveLateFee().

-- ─── T3-C2: SlipFingerprint ─────────────────────────────────────────────
CREATE TABLE "slip_fingerprints" (
  "id"          TEXT        NOT NULL,
  "hash"        TEXT        NOT NULL,
  "contract_id" TEXT        NOT NULL,
  "payment_id"  TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "slip_fingerprints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "slip_fingerprints_hash_key"       ON "slip_fingerprints"("hash");
CREATE INDEX        "slip_fingerprints_contract_id_idx" ON "slip_fingerprints"("contract_id");
CREATE INDEX        "slip_fingerprints_created_at_idx"  ON "slip_fingerprints"("created_at");

-- ─── T3-C4: FeeWaiverApproval ────────────────────────────────────────────
CREATE TABLE "fee_waiver_approvals" (
  "id"                TEXT        NOT NULL,
  "waiver_payment_id" TEXT        NOT NULL,
  "approver_id"       TEXT        NOT NULL,
  "approved_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip_address"        TEXT,
  "user_agent"        TEXT,

  CONSTRAINT "fee_waiver_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fee_waiver_approvals_waiver_payment_id_idx" ON "fee_waiver_approvals"("waiver_payment_id");
CREATE INDEX "fee_waiver_approvals_approver_id_idx"       ON "fee_waiver_approvals"("approver_id");
CREATE INDEX "fee_waiver_approvals_approved_at_idx"       ON "fee_waiver_approvals"("approved_at");
