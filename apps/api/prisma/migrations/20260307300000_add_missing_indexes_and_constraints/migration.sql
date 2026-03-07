-- Add unique constraint on payments (contract_id, installment_no) to prevent duplicate installments
CREATE UNIQUE INDEX "payments_contract_id_installment_no_key" ON "payments"("contract_id", "installment_no");

-- Add missing indexes on stock_transfers
CREATE INDEX "stock_transfers_from_branch_id_idx" ON "stock_transfers"("from_branch_id");
CREATE INDEX "stock_transfers_to_branch_id_idx" ON "stock_transfers"("to_branch_id");

-- Add missing indexes on sales
CREATE INDEX "sales_customer_id_idx" ON "sales"("customer_id");
CREATE INDEX "sales_salesperson_id_idx" ON "sales"("salesperson_id");
CREATE INDEX "sales_product_id_idx" ON "sales"("product_id");

-- Add missing index on po_items
CREATE INDEX "po_items_po_id_idx" ON "po_items"("po_id");

-- Add missing index on e_documents
CREATE INDEX "e_documents_created_by_id_idx" ON "e_documents"("created_by_id");

-- Add missing indexes on inspections
CREATE INDEX "inspections_template_id_idx" ON "inspections"("template_id");
CREATE INDEX "inspections_inspector_id_idx" ON "inspections"("inspector_id");

-- Add missing indexes on notification_logs
CREATE INDEX "notification_logs_channel_idx" ON "notification_logs"("channel");
CREATE INDEX "notification_logs_created_at_idx" ON "notification_logs"("created_at");

-- Add missing index on call_logs
CREATE INDEX "call_logs_caller_id_idx" ON "call_logs"("caller_id");
