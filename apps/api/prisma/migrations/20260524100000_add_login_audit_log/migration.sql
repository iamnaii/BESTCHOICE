-- LoginAuditLog — every auth attempt (success + failure). Retention: 90 days
-- via dedicated cron. Keep immutable; don't hard-delete here (soft-delete is
-- not appropriate — the whole point is drop-old).

CREATE TABLE "login_audit_logs" (
  "id"              TEXT NOT NULL,
  "user_id"         TEXT,
  "email_tried"     TEXT NOT NULL,
  "success"         BOOLEAN NOT NULL,
  "failure_kind"    TEXT,
  "ip_address"      TEXT,
  "user_agent"      TEXT,
  "two_factor_used" BOOLEAN NOT NULL DEFAULT false,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "login_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_audit_logs_user_id_created_at_idx"     ON "login_audit_logs"("user_id", "created_at");
CREATE INDEX "login_audit_logs_email_tried_created_at_idx" ON "login_audit_logs"("email_tried", "created_at");
CREATE INDEX "login_audit_logs_success_created_at_idx"     ON "login_audit_logs"("success", "created_at");
CREATE INDEX "login_audit_logs_created_at_idx"             ON "login_audit_logs"("created_at");

ALTER TABLE "login_audit_logs"
  ADD CONSTRAINT "login_audit_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
