-- CreateEnum
CREATE TYPE "EquityTxnType" AS ENUM ('CAP_INIT', 'CAP_INC', 'CAP_DEC', 'DRAW', 'DIV_DEC', 'DIV_PAY', 'PRIOR_ADJ');

-- CreateEnum
CREATE TYPE "EquityDocStatus" AS ENUM ('DRAFT', 'READY', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ShareholderType" AS ENUM ('INDIVIDUAL', 'JURISTIC_TH', 'JURISTIC_FOREIGN');

-- CreateTable
CREATE TABLE "shareholders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "share_pct" DECIMAL(5,2),
    "type" "ShareholderType" NOT NULL DEFAULT 'INDIVIDUAL',
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "shareholders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equity_documents" (
    "id" TEXT NOT NULL,
    "doc_number" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "txn_type" "EquityTxnType" NOT NULL,
    "status" "EquityDocStatus" NOT NULL DEFAULT 'DRAFT',
    "txn_date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "resolution_no" TEXT,
    "resolution_date" TIMESTAMP(3),
    "payment_account_code" TEXT,
    "pa_account_code" TEXT,
    "pa_amount" DECIMAL(12,2),
    "pa_direction" TEXT,
    "maker_id" TEXT NOT NULL,
    "approver_id" TEXT,
    "journal_entry_id" TEXT,
    "reverse_journal_entry_id" TEXT,
    "reverse_reason" TEXT,
    "posted_at" TIMESTAMP(3),
    "reversed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "equity_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equity_shareholder_lines" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "shareholder_id" TEXT NOT NULL,
    "shareholder_name" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "premium" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "wht" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equity_shareholder_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equity_attachments" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equity_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shareholders_is_active_idx" ON "shareholders"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "equity_documents_doc_number_key" ON "equity_documents"("doc_number");

-- CreateIndex
CREATE UNIQUE INDEX "equity_documents_journal_entry_id_key" ON "equity_documents"("journal_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "equity_documents_reverse_journal_entry_id_key" ON "equity_documents"("reverse_journal_entry_id");

-- CreateIndex
CREATE INDEX "equity_documents_txn_type_status_idx" ON "equity_documents"("txn_type", "status");

-- CreateIndex
CREATE INDEX "equity_documents_status_created_at_idx" ON "equity_documents"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "equity_documents_txn_date_idx" ON "equity_documents"("txn_date");

-- CreateIndex
CREATE INDEX "equity_documents_deleted_at_idx" ON "equity_documents"("deleted_at");

-- CreateIndex
CREATE INDEX "equity_shareholder_lines_shareholder_id_idx" ON "equity_shareholder_lines"("shareholder_id");

-- CreateIndex
CREATE UNIQUE INDEX "equity_shareholder_lines_document_id_shareholder_id_key" ON "equity_shareholder_lines"("document_id", "shareholder_id");

-- CreateIndex
CREATE UNIQUE INDEX "equity_shareholder_lines_document_id_line_no_key" ON "equity_shareholder_lines"("document_id", "line_no");

-- CreateIndex
CREATE INDEX "equity_attachments_document_id_idx" ON "equity_attachments"("document_id");

-- AddForeignKey
ALTER TABLE "equity_documents" ADD CONSTRAINT "equity_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company_info"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_documents" ADD CONSTRAINT "equity_documents_maker_id_fkey" FOREIGN KEY ("maker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_documents" ADD CONSTRAINT "equity_documents_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_shareholder_lines" ADD CONSTRAINT "equity_shareholder_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "equity_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_shareholder_lines" ADD CONSTRAINT "equity_shareholder_lines_shareholder_id_fkey" FOREIGN KEY ("shareholder_id") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equity_attachments" ADD CONSTRAINT "equity_attachments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "equity_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
