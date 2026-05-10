-- CreateTable
CREATE TABLE "credit_note_details" (
    "document_id" TEXT NOT NULL,
    "original_document_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "credit_note_details_pkey" PRIMARY KEY ("document_id")
);

-- CreateIndex
CREATE INDEX "credit_note_details_original_document_id_idx" ON "credit_note_details"("original_document_id");

-- AddForeignKey
ALTER TABLE "credit_note_details" ADD CONSTRAINT "credit_note_details_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "expense_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
