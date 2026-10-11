ALTER TABLE "appointment_confirmations" DROP CONSTRAINT "appointment_confirmations_status_check";
ALTER TABLE "appointment_confirmations" ADD CONSTRAINT "appointment_confirmations_status_check" CHECK ("status" IN ('PENDING','SENDING','SENT','FAILED','UNKNOWN','NO_CHANNEL','SUPERSEDED','BLOCKED'));
CREATE UNIQUE INDEX "appointment_confirmations_one_sending" ON "appointment_confirmations"("appointment_id") WHERE "status" = 'SENDING';
