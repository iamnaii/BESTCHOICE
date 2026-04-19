-- CRM lead assignment history (T5-C7). Prevents silent lead theft —
-- every reassignment writes one immutable row; UI surfaces the history.
-- Current owner remains on CrmLead.assignedToId for query speed.

CREATE TABLE "crm_lead_assignments" (
  "id"             TEXT NOT NULL,
  "lead_id"        TEXT NOT NULL,
  "from_user_id"   TEXT,
  "to_user_id"     TEXT NOT NULL,
  "changed_by_id"  TEXT NOT NULL,
  "reason"         TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_lead_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crm_lead_assignments_lead_id_created_at_idx"
  ON "crm_lead_assignments"("lead_id", "created_at");
CREATE INDEX "crm_lead_assignments_to_user_id_idx"
  ON "crm_lead_assignments"("to_user_id");
CREATE INDEX "crm_lead_assignments_changed_by_id_created_at_idx"
  ON "crm_lead_assignments"("changed_by_id", "created_at");

ALTER TABLE "crm_lead_assignments"
  ADD CONSTRAINT "crm_lead_assignments_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crm_lead_assignments"
  ADD CONSTRAINT "crm_lead_assignments_from_user_id_fkey"
  FOREIGN KEY ("from_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crm_lead_assignments"
  ADD CONSTRAINT "crm_lead_assignments_to_user_id_fkey"
  FOREIGN KEY ("to_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crm_lead_assignments"
  ADD CONSTRAINT "crm_lead_assignments_changed_by_id_fkey"
  FOREIGN KEY ("changed_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
