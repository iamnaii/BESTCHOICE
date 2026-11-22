-- CreateEnum
CREATE TYPE "TooltifyImportKind" AS ENUM ('STOCK', 'SALES');

-- CreateEnum
CREATE TYPE "TooltifyImportStatus" AS ENUM ('APPLYING', 'APPLIED', 'FAILED', 'VERIFIED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "TooltifyDisposition" AS ENUM ('CREATE', 'MATCH', 'CONFLICT', 'EXCLUDE');

-- CreateEnum
CREATE TYPE "TooltifyTargetType" AS ENUM ('PRODUCT', 'IMPORTED_SALE');

-- CreateTable
CREATE TABLE "tooltify_import_batches" (
    "id" TEXT NOT NULL,
    "canonical_set_id" TEXT NOT NULL,
    "kind" "TooltifyImportKind" NOT NULL,
    "manifest_hash" TEXT NOT NULL,
    "plan_hash" TEXT NOT NULL,
    "reconciliation_snapshot" JSONB NOT NULL,
    "source_cutover_at" TIMESTAMP(3) NOT NULL,
    "status" "TooltifyImportStatus" NOT NULL,
    "code_revision" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tooltify_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tooltify_import_items" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "source_refs" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "dependency_fingerprint" TEXT NOT NULL,
    "stock_resolution" JSONB,
    "identity_hash" TEXT NOT NULL,
    "disposition" "TooltifyDisposition" NOT NULL,
    "target_type" "TooltifyTargetType" NOT NULL,
    "target_id" TEXT,
    "after_fingerprint" TEXT,
    "reversed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tooltify_import_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tooltify_import_status_events" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "status" "TooltifyImportStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tooltify_import_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tooltify_import_batches_canonical_set_id_kind_key" ON "tooltify_import_batches"("canonical_set_id", "kind");

-- CreateIndex
CREATE INDEX "tooltify_import_items_target_type_target_id_idx" ON "tooltify_import_items"("target_type", "target_id");
CREATE INDEX "tooltify_import_items_identity_hash_idx" ON "tooltify_import_items"("identity_hash");

-- CreateIndex
CREATE UNIQUE INDEX "tooltify_import_items_batch_id_source_key_key" ON "tooltify_import_items"("batch_id", "source_key");

-- CreateIndex
CREATE INDEX "tooltify_import_status_events_batch_id_created_at_idx" ON "tooltify_import_status_events"("batch_id", "created_at");

-- AddForeignKey
ALTER TABLE "tooltify_import_items" ADD CONSTRAINT "tooltify_import_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "tooltify_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tooltify_import_status_events" ADD CONSTRAINT "tooltify_import_status_events_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "tooltify_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tooltify_import_items" ADD CONSTRAINT "tooltify_import_item_target_check"
CHECK ((disposition IN ('CREATE','MATCH') AND target_id IS NOT NULL AND after_fingerprint IS NOT NULL)
    OR (disposition = 'EXCLUDE' AND target_id IS NULL AND after_fingerprint IS NULL));

CREATE FUNCTION tooltify_record_batch_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO tooltify_import_status_events (id, batch_id, status)
        VALUES (gen_random_uuid()::text, NEW.id, NEW.status);
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER tooltify_batch_status_history AFTER INSERT OR UPDATE OF status ON tooltify_import_batches
FOR EACH ROW EXECUTE FUNCTION tooltify_record_batch_status();

CREATE FUNCTION tooltify_protect_batch_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(OLD.canonical_set_id, OLD.kind, OLD.manifest_hash, OLD.plan_hash, OLD.code_revision, OLD.source_cutover_at, OLD.reconciliation_snapshot)
       IS DISTINCT FROM ROW(NEW.canonical_set_id, NEW.kind, NEW.manifest_hash, NEW.plan_hash, NEW.code_revision, NEW.source_cutover_at, NEW.reconciliation_snapshot) THEN
        RAISE EXCEPTION 'Tooltify batch input is immutable';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER tooltify_frozen_batch_input BEFORE UPDATE ON tooltify_import_batches
FOR EACH ROW EXECUTE FUNCTION tooltify_protect_batch_input();
ALTER TABLE tooltify_import_batches ADD CONSTRAINT tooltify_verified_requires_source_totals
CHECK (status <> 'VERIFIED' OR reconciliation_snapshot->'cannotVerifySource' IS NOT DISTINCT FROM 'false'::jsonb);
