-- CreateEnum
CREATE TYPE "AppointmentCreditDecision" AS ENUM ('NONE', 'APPROVED', 'REJECTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "StoreAppointmentStatus" AS ENUM ('BOOKED', 'CHECKED_IN', 'IN_SERVICE', 'COMPLETED', 'CANCELED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "credit_checks" ADD COLUMN     "appointment_decision_recorded_at" TIMESTAMP(3),
ADD COLUMN     "last_appointment_decision" "AppointmentCreditDecision" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "staff_appointment_windows" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "staff_appointment_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_appointments" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "window_id" TEXT NOT NULL,
    "source_room_id" TEXT,
    "credit_check_id" TEXT NOT NULL,
    "credit_check_type_at_booking" TEXT NOT NULL,
    "credit_decision_recorded_at_booking" TIMESTAMP(3),
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "StoreAppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "source" TEXT NOT NULL,
    "created_by_id" TEXT,
    "checked_in_at" TIMESTAMP(3),
    "service_started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "no_show_at" TIMESTAMP(3),
    "reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "store_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_appointment_links" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "allowed_branch_ids" TEXT[],
    "booking_expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "issued_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "store_appointment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_link_access" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "manage_expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "appointment_link_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_appointment_events" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_appointment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_requests" (
    "id" TEXT NOT NULL,
    "actor_key" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_appointment_windows_branch_id_starts_at_idx" ON "staff_appointment_windows"("branch_id", "starts_at");

-- CreateIndex
CREATE INDEX "staff_appointment_windows_staff_user_id_starts_at_idx" ON "staff_appointment_windows"("staff_user_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "store_appointments_reference_key" ON "store_appointments"("reference");

-- CreateIndex
CREATE INDEX "store_appointments_branch_id_starts_at_idx" ON "store_appointments"("branch_id", "starts_at");

-- CreateIndex
CREATE INDEX "store_appointments_customer_id_status_idx" ON "store_appointments"("customer_id", "status");

-- CreateIndex
CREATE INDEX "store_appointments_staff_user_id_starts_at_idx" ON "store_appointments"("staff_user_id", "starts_at");

-- CreateIndex
CREATE INDEX "store_appointments_source_room_id_idx" ON "store_appointments"("source_room_id");

-- CreateIndex
CREATE INDEX "store_appointments_credit_check_id_idx" ON "store_appointments"("credit_check_id");

-- CreateIndex
CREATE INDEX "store_appointments_window_id_idx" ON "store_appointments"("window_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_appointment_links_token_hash_key" ON "store_appointment_links"("token_hash");

-- CreateIndex
CREATE INDEX "store_appointment_links_customer_id_idx" ON "store_appointment_links"("customer_id");

-- CreateIndex
CREATE INDEX "appointment_link_access_appointment_id_idx" ON "appointment_link_access"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_link_access_link_id_appointment_id_key" ON "appointment_link_access"("link_id", "appointment_id");

-- CreateIndex
CREATE INDEX "store_appointment_events_appointment_id_created_at_idx" ON "store_appointment_events"("appointment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_requests_actor_key_request_id_key" ON "appointment_requests"("actor_key", "request_id");

-- AddForeignKey
ALTER TABLE "staff_appointment_windows" ADD CONSTRAINT "staff_appointment_windows_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_appointment_windows" ADD CONSTRAINT "staff_appointment_windows_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_appointments" ADD CONSTRAINT "store_appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_appointments" ADD CONSTRAINT "store_appointments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_appointments" ADD CONSTRAINT "store_appointments_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_appointments" ADD CONSTRAINT "store_appointments_window_id_fkey" FOREIGN KEY ("window_id") REFERENCES "staff_appointment_windows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_appointments" ADD CONSTRAINT "store_appointments_credit_check_id_fkey" FOREIGN KEY ("credit_check_id") REFERENCES "credit_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_appointments" ADD CONSTRAINT "store_appointments_source_room_id_fkey" FOREIGN KEY ("source_room_id") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_appointment_links" ADD CONSTRAINT "store_appointment_links_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_link_access" ADD CONSTRAINT "appointment_link_access_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "store_appointment_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_link_access" ADD CONSTRAINT "appointment_link_access_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "store_appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_appointment_events" ADD CONSTRAINT "store_appointment_events_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "store_appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Legacy pending rows have unknown decision history. Never infer approval from scores.
UPDATE "credit_checks" SET
  "last_appointment_decision" = CASE WHEN status::text IN ('APPROVED', 'REJECTED')
    THEN status::text::"AppointmentCreditDecision" ELSE 'UNKNOWN'::"AppointmentCreditDecision" END,
  "appointment_decision_recorded_at" = CURRENT_TIMESTAMP;

-- Atomic with EVERY existing writer, including older app instances during rollout.
CREATE FUNCTION preserve_appointment_credit_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.last_appointment_decision := CASE WHEN NEW.status::text IN ('APPROVED', 'REJECTED')
      THEN NEW.status::text::"AppointmentCreditDecision" ELSE 'NONE'::"AppointmentCreditDecision" END;
    NEW.appointment_decision_recorded_at := CASE WHEN NEW.status::text IN ('APPROVED', 'REJECTED') THEN CURRENT_TIMESTAMP ELSE NULL END;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text IN ('APPROVED', 'REJECTED') THEN
    NEW.last_appointment_decision := NEW.status::text::"AppointmentCreditDecision";
    NEW.appointment_decision_recorded_at := CURRENT_TIMESTAMP;
  ELSE
    NEW.last_appointment_decision := OLD.last_appointment_decision;
    NEW.appointment_decision_recorded_at := OLD.appointment_decision_recorded_at;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER credit_appointment_decision BEFORE INSERT OR UPDATE ON credit_checks
  FOR EACH ROW EXECUTE FUNCTION preserve_appointment_credit_decision();

CREATE UNIQUE INDEX store_appointment_one_open_per_customer ON store_appointments(customer_id)
  WHERE deleted_at IS NULL AND status IN ('BOOKED', 'CHECKED_IN', 'IN_SERVICE');
ALTER TABLE store_appointments ADD CONSTRAINT appointment_duration_45_minutes CHECK (ends_at = starts_at + interval '45 minutes');
ALTER TABLE staff_appointment_windows ADD CONSTRAINT appointment_window_valid CHECK
  (ends_at > starts_at AND ends_at <= starts_at + interval '24 hours');
ALTER TABLE staff_appointment_windows ADD CONSTRAINT appointment_window_creator_fk FOREIGN KEY(created_by_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE store_appointments ADD CONSTRAINT appointment_creator_fk FOREIGN KEY(created_by_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE store_appointment_links ADD CONSTRAINT appointment_link_issuer_fk FOREIGN KEY(issued_by_id) REFERENCES users(id) ON DELETE RESTRICT;
