-- Tier-8: T5-C15 (CRM lead stage history) + T5-C19 (commission rule version snapshot)

-- T5-C15: immutable CRM lead stage transition history
CREATE TABLE "crm_lead_stage_history" (
  "id"            TEXT NOT NULL,
  "lead_id"       TEXT NOT NULL,
  "old_stage"     TEXT,
  "new_stage"     TEXT NOT NULL,
  "staged_by_id"  TEXT NOT NULL,
  "reason"        TEXT,
  "staged_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_lead_stage_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crm_lead_stage_history_lead_id_staged_at_idx"
  ON "crm_lead_stage_history"("lead_id", "staged_at");
CREATE INDEX "crm_lead_stage_history_new_stage_staged_at_idx"
  ON "crm_lead_stage_history"("new_stage", "staged_at");
CREATE INDEX "crm_lead_stage_history_staged_by_id_staged_at_idx"
  ON "crm_lead_stage_history"("staged_by_id", "staged_at");

ALTER TABLE "crm_lead_stage_history"
  ADD CONSTRAINT "crm_lead_stage_history_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crm_lead_stage_history"
  ADD CONSTRAINT "crm_lead_stage_history_staged_by_id_fkey"
  FOREIGN KEY ("staged_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- T5-C19: optional rule version snapshot on sales commission.
-- Captures the rule.updatedAt ISO timestamp at creation time so approve() can
-- detect rate drift and reject stale approvals.
ALTER TABLE "sales_commissions"
  ADD COLUMN "rule_version_id" TEXT;
