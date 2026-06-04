-- AlterTable
ALTER TABLE "expense_documents" ADD COLUMN     "vendor_supplier_id" TEXT;

-- AlterTable
ALTER TABLE "expense_lines" ADD COLUMN     "supplier_id" TEXT;

-- CreateIndex
CREATE INDEX "expense_documents_vendor_supplier_id_idx" ON "expense_documents"("vendor_supplier_id");

-- CreateIndex
CREATE INDEX "expense_lines_supplier_id_idx" ON "expense_lines"("supplier_id");

-- AddForeignKey
ALTER TABLE "expense_documents" ADD CONSTRAINT "expense_documents_vendor_supplier_id_fkey" FOREIGN KEY ("vendor_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
