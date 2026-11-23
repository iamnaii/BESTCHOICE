ALTER TABLE tooltify_import_batches
    ADD COLUMN rollback_plan_hash text,
    ADD COLUMN rollback_code_revision text,
    ADD CONSTRAINT tooltify_rollback_proof_pair CHECK (
        (rollback_plan_hash IS NULL AND rollback_code_revision IS NULL)
        OR (status = 'ROLLED_BACK' AND rollback_plan_hash IS NOT NULL
            AND rollback_code_revision IS NOT NULL
            AND rollback_plan_hash ~ '^[a-f0-9]{64}$'
            AND rollback_code_revision ~ '^[a-f0-9]{40}(-dirty)?$')
    );

-- Keep any historical reversed batch as-is. It has no reviewed-plan proof and
-- cannot acquire one retroactively. New transitions require proof atomically.
CREATE FUNCTION tooltify_guard_rollback_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status = 'ROLLED_BACK' THEN
        IF ROW(NEW.status, NEW.rollback_plan_hash, NEW.rollback_code_revision)
            IS DISTINCT FROM ROW(OLD.status, OLD.rollback_plan_hash, OLD.rollback_code_revision) THEN
            RAISE EXCEPTION 'Tooltify rollback proof is immutable';
        END IF;
    ELSIF NEW.status = 'ROLLED_BACK' AND NEW.rollback_plan_hash IS NULL THEN
        RAISE EXCEPTION 'Tooltify rollback proof is required';
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER tooltify_guard_rollback_proof
    BEFORE INSERT OR UPDATE OF status, rollback_plan_hash, rollback_code_revision
    ON tooltify_import_batches FOR EACH ROW EXECUTE FUNCTION tooltify_guard_rollback_proof();
