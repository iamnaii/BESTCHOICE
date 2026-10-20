-- Future-only authoritative cancellation evidence. No historical backfill.
ALTER TABLE contract_cancellations
  ADD COLUMN request_snapshot_version INTEGER,
  ADD COLUMN request_snapshot JSONB,
  ADD COLUMN request_fingerprint VARCHAR(64),
  ADD COLUMN rejection_reason VARCHAR(2000);
ALTER TABLE contract_cancellations ADD CONSTRAINT cancellation_snapshot_complete CHECK (
  (request_snapshot_version IS NULL AND request_snapshot IS NULL AND request_fingerprint IS NULL)
  OR ((request_snapshot_version = 1 AND request_snapshot IS NOT NULL AND request_fingerprint IS NOT NULL
    AND jsonb_typeof(request_snapshot) = 'object'
    AND request_fingerprint ~ '^[0-9a-f]{64}$'
    AND request_snapshot->'version' = '1'::jsonb
    AND jsonb_typeof(request_snapshot->'binding') = 'object'
    AND request_snapshot->'binding'->>'cancellationId' = id
    AND request_snapshot->'binding'->>'contractId' = contract_id
    AND request_snapshot->'binding'->>'requestedById' = requested_by_id
    AND request_snapshot->'binding'->>'reason' = reason
    AND request_snapshot->'binding'->>'refundAmount' = '0.00'
    AND refund_amount = 0
    AND deleted_at IS NULL
    AND char_length(btrim(reason)) BETWEEN 1 AND 2000) IS TRUE)
);
ALTER TABLE contract_cancellations ADD CONSTRAINT cancellation_rejection_reason_valid CHECK (
  rejection_reason IS NULL OR (char_length(btrim(rejection_reason)) BETWEEN 1 AND 2000 AND status = 'REJECTED')
);
CREATE FUNCTION guard_managed_contract_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.request_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'Managed cancellation evidence cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.request_snapshot IS NOT NULL OR NEW.request_snapshot IS NOT NULL THEN
    IF ROW(OLD.request_snapshot_version, OLD.request_snapshot, OLD.request_fingerprint,
      OLD.id, OLD.contract_id, OLD.requested_by_id, OLD.reason, OLD.refund_amount)
      IS DISTINCT FROM ROW(NEW.request_snapshot_version, NEW.request_snapshot, NEW.request_fingerprint,
      NEW.id, NEW.contract_id, NEW.requested_by_id, NEW.reason, NEW.refund_amount) THEN
      RAISE EXCEPTION 'Cancellation request binding is immutable; historical attachment is forbidden' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD.rejection_reason IS NOT NULL AND OLD.rejection_reason IS DISTINCT FROM NEW.rejection_reason THEN
    RAISE EXCEPTION 'Cancellation rejection reason is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.rejection_reason IS NULL AND NEW.rejection_reason IS NOT NULL
    AND NOT (OLD.status = 'PENDING' AND NEW.status = 'REJECTED') THEN
    RAISE EXCEPTION 'Rejection reason requires the pending to rejected transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER managed_contract_cancellation_immutable BEFORE UPDATE OR DELETE ON contract_cancellations
  FOR EACH ROW EXECUTE FUNCTION guard_managed_contract_cancellation();
