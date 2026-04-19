-- T5-C12: partial-unique IMEI constraint on products.
--
-- Before: `imei_serial` had a plain UNIQUE constraint, which meant a
-- soft-deleted product permanently blocked the same IMEI from ever
-- re-entering the system. This is wrong for trade-ins where the same
-- physical phone legitimately comes back: write-off → customer brings in
-- the same device months later → accept() needed to create a new Product
-- row with the same IMEI.
--
-- After: the UNIQUE is enforced ONLY across active (non-soft-deleted)
-- rows. Prisma cannot express partial unique indexes natively, so the
-- constraint is maintained as a raw partial index. Prisma's
-- `@unique` on the `imeiSerial` field is NOT removed from schema.prisma;
-- that attribute keeps the generated TS type `imeiSerial?: string` but
-- at the DB level the constraint is swapped for the partial index.
--
-- Service-layer uniqueness check in trade-in.service.ts accept() is
-- updated in the same change to filter `deletedAt: null` — matching the
-- DB behaviour.

ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_imei_serial_key";
DROP INDEX IF EXISTS "products_imei_serial_key";

CREATE UNIQUE INDEX "products_imei_serial_active_unique"
  ON "products" ("imei_serial")
  WHERE "deleted_at" IS NULL;
