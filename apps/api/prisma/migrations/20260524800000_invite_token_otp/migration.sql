-- T7-C6: invite flow hardening. Email carries only the link; a 6-digit OTP
-- is sent to the invited user's phone via SMS. Completing signup requires
-- both. If the email is forwarded or the mailbox is compromised, the
-- attacker is still missing the phone-side OTP.

ALTER TABLE "invite_tokens"
  ADD COLUMN "otp_hash"        TEXT,
  ADD COLUMN "otp_expires_at"  TIMESTAMP(3),
  ADD COLUMN "otp_attempts"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "phone"           TEXT;
