-- Change ON DELETE CASCADE → RESTRICT for tables that hold legal/audit
-- evidence linked to a contract. Any accidental hard-delete of a contract
-- (which we already discourage in favor of soft-delete) would otherwise
-- erase payment history, signed PDFs, e-signatures, and call logs in one
-- shot. Restrict makes the database refuse the delete instead.
--
-- Soft-delete via the `deleted_at` column on Contract continues to work
-- exactly as before — it does not trigger cascade.

-- payments
ALTER TABLE "payments" DROP CONSTRAINT "payments_contract_id_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- e_documents
ALTER TABLE "e_documents" DROP CONSTRAINT "e_documents_contract_id_fkey";
ALTER TABLE "e_documents" ADD CONSTRAINT "e_documents_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- signatures
ALTER TABLE "signatures" DROP CONSTRAINT "signatures_contract_id_fkey";
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- call_logs
ALTER TABLE "call_logs" DROP CONSTRAINT "call_logs_contract_id_fkey";
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- contract_documents
ALTER TABLE "contract_documents" DROP CONSTRAINT "contract_documents_contract_id_fkey";
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
