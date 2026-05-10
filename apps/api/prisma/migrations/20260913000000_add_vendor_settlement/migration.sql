-- CreateTable
CREATE TABLE "vendor_settlement_details" (
    "document_id" TEXT NOT NULL,

    CONSTRAINT "vendor_settlement_details_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "settlement_lines" (
    "id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "cleared_document_id" TEXT NOT NULL,
    "amount_settled" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlement_lines_settlement_id_idx" ON "settlement_lines"("settlement_id");
CREATE INDEX "settlement_lines_cleared_document_id_idx" ON "settlement_lines"("cleared_document_id");

-- AddForeignKey
ALTER TABLE "vendor_settlement_details" ADD CONSTRAINT "vendor_settlement_details_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "expense_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "vendor_settlement_details"("document_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_cleared_document_id_fkey" FOREIGN KEY ("cleared_document_id") REFERENCES "expense_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
