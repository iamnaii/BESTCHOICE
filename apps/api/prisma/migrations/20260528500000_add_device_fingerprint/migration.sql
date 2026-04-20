-- Migration: add_device_fingerprint
-- Adds device fingerprint fields to LoginAuditLog and creates KnownDevice model
-- for trusted-device registry (admin hardening C1 - Task 2)

-- Add 3 new nullable columns to login_audit_logs
ALTER TABLE "login_audit_logs"
  ADD COLUMN "device_fingerprint" TEXT,
  ADD COLUMN "is_new_device"      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "two_factor_method"  TEXT;

-- Index for fingerprint-based queries (fraud analytics)
CREATE INDEX "login_audit_logs_device_fingerprint_created_at_idx"
  ON "login_audit_logs" ("device_fingerprint", "created_at");

-- Create known_devices table
CREATE TABLE "known_devices" (
  "id"           TEXT NOT NULL,
  "user_id"      TEXT NOT NULL,
  "fingerprint"  TEXT NOT NULL,
  "device_label" TEXT,
  "ip_address"   TEXT,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "login_count"  INTEGER NOT NULL DEFAULT 1,
  "revoked_at"   TIMESTAMP(3),

  CONSTRAINT "known_devices_pkey" PRIMARY KEY ("id")
);

-- FK to users (cascade delete: device records go away when user is deleted)
ALTER TABLE "known_devices"
  ADD CONSTRAINT "known_devices_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique: one fingerprint per user
CREATE UNIQUE INDEX "known_devices_user_id_fingerprint_key"
  ON "known_devices" ("user_id", "fingerprint");

-- Indexes
CREATE INDEX "known_devices_user_id_last_seen_at_idx"
  ON "known_devices" ("user_id", "last_seen_at");

CREATE INDEX "known_devices_fingerprint_idx"
  ON "known_devices" ("fingerprint");
