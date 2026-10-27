-- ลงเวลาทำงานผ่านเครื่องประจำสาขา (ก้อน 10 D3) — spec docs/superpowers/specs/2026-10-27-attendance-kiosk-design.md §9
-- สร้างจาก prisma migrate diff แล้วคัดเฉพาะส่วน attendance (drift เดิมของตารางอื่นไม่รวม)

CREATE TYPE "AttendanceDayKind" AS ENUM ('WORK', 'DAY_OFF', 'LEAVE_SICK', 'LEAVE_PERSONAL', 'LEAVE_OTHER', 'SHOP_CLOSED');

CREATE TYPE "AttendanceDeviceStatus" AS ENUM ('ACTIVE', 'REVOKED', 'LOCKED');

CREATE TYPE "AttendancePunchKind" AS ENUM ('IN', 'OUT');

CREATE TYPE "AttendanceDeviceEventKind" AS ENUM ('REGISTERED', 'TOKEN_CONFLICT', 'PIN_LOCKOUT', 'REVOKED', 'UNLOCKED', 'OFFLINE');

ALTER TABLE "users" ADD COLUMN     "attendance_pin_hash" TEXT;

ALTER TABLE "branches" ADD COLUMN     "work_end" TEXT,
ADD COLUMN     "work_start" TEXT;

CREATE TABLE "attendance_devices" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AttendanceDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_generation" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMP(3),
    "last_clean_heartbeat_at" TIMESTAMP(3),
    "last_ip" TEXT,
    "last_user_agent" TEXT,
    "pin_fail_count" INTEGER NOT NULL DEFAULT 0,
    "pin_locked_until" TIMESTAMP(3),
    "registered_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "attendance_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_device_tokens" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "attendance_device_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_device_requests" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "response_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_device_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_registration_codes" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_registration_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_device_events" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "kind" "AttendanceDeviceEventKind" NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_device_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_punches" (
    "id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "kind" "AttendancePunchKind" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "photo_key" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "geo_lat" DECIMAL(9,6),
    "geo_lng" DECIMAL(9,6),
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_days" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "day_kind" "AttendanceDayKind" NOT NULL DEFAULT 'WORK',
    "clock_in" TIMESTAMP(3),
    "clock_out" TIMESTAMP(3),
    "clock_in_punch_id" TEXT,
    "clock_out_punch_id" TEXT,
    "worked_minutes" INTEGER NOT NULL DEFAULT 0,
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "early_leave_minutes" INTEGER NOT NULL DEFAULT 0,
    "ot_hours" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "corrected_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_corrections" (
    "id" TEXT NOT NULL,
    "day_id" TEXT NOT NULL,
    "changed_by_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_devices_branch_id_status_idx" ON "attendance_devices"("branch_id", "status");

CREATE UNIQUE INDEX "attendance_device_tokens_token_hash_key" ON "attendance_device_tokens"("token_hash");

CREATE UNIQUE INDEX "attendance_device_tokens_device_id_generation_key" ON "attendance_device_tokens"("device_id", "generation");

CREATE INDEX "attendance_device_requests_created_at_idx" ON "attendance_device_requests"("created_at");

CREATE UNIQUE INDEX "attendance_device_requests_device_id_request_id_key" ON "attendance_device_requests"("device_id", "request_id");

CREATE UNIQUE INDEX "attendance_registration_codes_code_hash_key" ON "attendance_registration_codes"("code_hash");

CREATE INDEX "attendance_device_events_device_id_created_at_idx" ON "attendance_device_events"("device_id", "created_at");

CREATE INDEX "attendance_punches_user_id_at_idx" ON "attendance_punches"("user_id", "at");

CREATE INDEX "attendance_punches_device_id_at_idx" ON "attendance_punches"("device_id", "at");

CREATE INDEX "attendance_punches_branch_id_at_idx" ON "attendance_punches"("branch_id", "at");

CREATE INDEX "attendance_days_branch_id_work_date_idx" ON "attendance_days"("branch_id", "work_date");

CREATE UNIQUE INDEX "attendance_days_user_id_work_date_key" ON "attendance_days"("user_id", "work_date");

CREATE INDEX "attendance_corrections_day_id_created_at_idx" ON "attendance_corrections"("day_id", "created_at");

CREATE UNIQUE INDEX "users_attendance_pin_hash_key" ON "users"("attendance_pin_hash");

ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_registered_by_id_fkey" FOREIGN KEY ("registered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_device_tokens" ADD CONSTRAINT "attendance_device_tokens_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "attendance_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_device_requests" ADD CONSTRAINT "attendance_device_requests_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "attendance_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_registration_codes" ADD CONSTRAINT "attendance_registration_codes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_registration_codes" ADD CONSTRAINT "attendance_registration_codes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_device_events" ADD CONSTRAINT "attendance_device_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "attendance_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "attendance_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_clock_in_punch_id_fkey" FOREIGN KEY ("clock_in_punch_id") REFERENCES "attendance_punches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_clock_out_punch_id_fkey" FOREIGN KEY ("clock_out_punch_id") REFERENCES "attendance_punches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_day_id_fkey" FOREIGN KEY ("day_id") REFERENCES "attendance_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
