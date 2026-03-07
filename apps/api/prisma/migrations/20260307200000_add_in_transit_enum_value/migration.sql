-- Add IN_TRANSIT value to TransferStatus enum (safe: does nothing if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'IN_TRANSIT'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'TransferStatus')
  ) THEN
    ALTER TYPE "TransferStatus" ADD VALUE 'IN_TRANSIT';
  END IF;
END
$$;
