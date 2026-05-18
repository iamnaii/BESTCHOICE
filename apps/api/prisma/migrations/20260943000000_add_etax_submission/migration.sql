-- P2-SP5 — e-Tax XML submission scaffolding for Revenue Department (สรรพากร)
--
-- Implements ขมธอ.21-2562 (Thailand UBL 2.1) infrastructure per ป.รัษฎากร
-- ม.86/4 + ประกาศอธิบดี ฉ.48. The submission lifecycle is:
--
--   PENDING (XML generated) → SIGNED (PKCS#7) → SUBMITTED (sent to RD)
--                                              → ACCEPTED / REJECTED
--                                              → ERROR (retriable)
--
-- One row per Payment (unique on payment_id) — replaces the previous flat
-- "Payment with VAT" approach in Phase 1 (which was list+PDF+CSV only).
--
-- Cert + RD creds are PLUGGABLE — when ETAX_SUBMIT_MODE=disabled (default)
-- only XML generation runs; the "ส่งให้สรรพากร" UI button is gated and
-- the sign/submit endpoints reject with "e-Tax cert ไม่ได้ตั้งค่า".

CREATE TYPE "ETaxSubmissionStatus" AS ENUM (
  'PENDING',    -- XML generated, not signed
  'SIGNED',     -- PKCS#7 signed, ready to submit
  'SUBMITTED',  -- Sent to RD, awaiting response
  'ACCEPTED',   -- RD accepted (success)
  'REJECTED',   -- RD rejected (see reject_reason)
  'ERROR'       -- Transport / server error — eligible for retry
);

CREATE TABLE "etax_submissions" (
  "id"               TEXT PRIMARY KEY,
  "payment_id"       TEXT NOT NULL,
  -- Generated UBL 2.1 XML; large enough for nested invoice lines. TEXT (no
  -- length cap) since the spec allows multi-line item invoices.
  "xml_content"      TEXT NOT NULL,
  -- PKCS#7 detached signature bundle (CMS, base64-encoded). NULL until the
  -- signer runs. May be NULL forever if cert is not configured.
  "signed_xml"       TEXT,
  "status"           "ETaxSubmissionStatus" NOT NULL DEFAULT 'PENDING',
  "submitted_at"     TIMESTAMP(3),
  -- RD's own tracking ID (returned in their API response); used for status
  -- polling. NULL until a successful submit.
  "rd_submission_id" TEXT,
  -- Full RD response (status code + body) for forensics. JSONB for queryability.
  "rd_response"      JSONB,
  "accepted_at"      TIMESTAMP(3),
  "rejected_at"      TIMESTAMP(3),
  "reject_reason"    TEXT,
  "retry_count"      INTEGER NOT NULL DEFAULT 0,
  "last_retry_at"    TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  "deleted_at"       TIMESTAMP(3),

  -- Restrict — never hard-delete payments referenced by a submission row
  -- (legal evidence). Mirror Payment.contract on:delete pattern.
  CONSTRAINT "etax_submissions_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

-- One e-Tax submission per Payment (idempotency at DB level).
CREATE UNIQUE INDEX "etax_submissions_payment_id_key"
  ON "etax_submissions"("payment_id");

-- Status-bound queries (cron poller, list views) hit this.
CREATE INDEX "etax_submissions_status_idx" ON "etax_submissions"("status");

-- Soft-delete-aware lookup per payment.
CREATE INDEX "etax_submissions_payment_id_deleted_at_idx"
  ON "etax_submissions"("payment_id", "deleted_at");

-- For "recently submitted" admin views.
CREATE INDEX "etax_submissions_submitted_at_idx" ON "etax_submissions"("submitted_at");
