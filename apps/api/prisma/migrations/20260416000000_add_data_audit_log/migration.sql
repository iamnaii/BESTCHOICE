-- CreateTable
CREATE TABLE "data_audit_logs" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "check_name" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "details" JSONB,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_audit_logs_run_id_idx" ON "data_audit_logs"("run_id");

-- CreateIndex
CREATE INDEX "data_audit_logs_check_name_executed_at_idx" ON "data_audit_logs"("check_name", "executed_at");

-- CreateIndex
CREATE INDEX "data_audit_logs_status_idx" ON "data_audit_logs"("status");
