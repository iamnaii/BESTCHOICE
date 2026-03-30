-- CreateIndex
CREATE INDEX "contracts_deleted_at_status_idx" ON "contracts"("deleted_at", "status");

-- CreateIndex
CREATE INDEX "contracts_branch_id_status_deleted_at_idx" ON "contracts"("branch_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "customers_deleted_at_phone_idx" ON "customers"("deleted_at", "phone");

-- CreateIndex
CREATE INDEX "customers_deleted_at_name_idx" ON "customers"("deleted_at", "name");

-- CreateIndex
CREATE INDEX "payments_contract_id_status_due_date_idx" ON "payments"("contract_id", "status", "due_date");
