-- D1.2.4.3 — Template Sharing Rules (ACL)
--
-- Adds a visibility enum + per-user share list to ExpenseTemplate so users
-- can mark templates as PRIVATE (creator-only, current behaviour),
-- TEAM (creator + explicit user grants via user_expense_templates), or
-- PUBLIC (visible to every authenticated user).
--
-- Additive only — `visibility` defaults to PRIVATE so all existing rows
-- keep their pre-migration behaviour.

CREATE TYPE "TemplateVisibility" AS ENUM ('PRIVATE', 'TEAM', 'PUBLIC');

ALTER TABLE "expense_templates"
  ADD COLUMN "visibility" "TemplateVisibility" NOT NULL DEFAULT 'PRIVATE';

CREATE INDEX "expense_templates_visibility_deleted_at_idx"
  ON "expense_templates" ("visibility", "deleted_at");

-- Join table for TEAM-visibility ACL. Append-only (no updated_at/deleted_at).
-- Hard-deleting a row revokes the grant; the service layer logs that change
-- via AuditLog so we don't need a tombstone in this table.
CREATE TABLE "user_expense_templates" (
  "template_id" TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_expense_templates_pkey" PRIMARY KEY ("template_id", "user_id")
);

CREATE INDEX "user_expense_templates_user_id_idx"
  ON "user_expense_templates" ("user_id");

ALTER TABLE "user_expense_templates"
  ADD CONSTRAINT "user_expense_templates_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "expense_templates" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_expense_templates"
  ADD CONSTRAINT "user_expense_templates_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
