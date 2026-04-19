-- T3-C10: Late-fee waiver audit fields on Payment. Keeps a full record of
-- who waived a fee, when, why, and who approved — the SoD guard lives in
-- payments.service.waiveLateFee() (approver ≠ waiver enforced at service
-- layer). These columns give accountants and auditors a single row per
-- waiver to inspect.

ALTER TABLE "payments"
  ADD COLUMN "waived_by_id"            TEXT,
  ADD COLUMN "waived_at"               TIMESTAMP(3),
  ADD COLUMN "waived_reason"           TEXT,
  ADD COLUMN "waived_approved_by_id"   TEXT,
  ADD COLUMN "waived_amount"           DECIMAL(12,2);

CREATE INDEX "payments_waived_by_id_idx"           ON "payments"("waived_by_id");
CREATE INDEX "payments_waived_approved_by_id_idx"  ON "payments"("waived_approved_by_id");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_waived_by_id_fkey"
  FOREIGN KEY ("waived_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_waived_approved_by_id_fkey"
  FOREIGN KEY ("waived_approved_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
