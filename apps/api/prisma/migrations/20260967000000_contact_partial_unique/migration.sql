-- Replace full unique on contacts.tax_id with a PARTIAL unique index
-- (only non-null, non-soft-deleted rows must be unique). Add the same
-- partial unique on national_id_hash. Soft-deleted / keyless rows no
-- longer occupy the key — foundation for merge + race-safety tasks.

DROP INDEX IF EXISTS "contacts_tax_id_key";

CREATE UNIQUE INDEX IF NOT EXISTS "contacts_tax_id_active_key"
  ON "contacts"("tax_id")
  WHERE "deleted_at" IS NULL AND "tax_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "contacts_national_id_hash_active_key"
  ON "contacts"("national_id_hash")
  WHERE "deleted_at" IS NULL AND "national_id_hash" IS NOT NULL;
