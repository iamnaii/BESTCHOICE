-- CreateTable
CREATE TABLE "payroll_details" (
    "document_id" TEXT NOT NULL,
    "payroll_period" TEXT NOT NULL,

    CONSTRAINT "payroll_details_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" TEXT NOT NULL,
    "payroll_id" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "employee_tax_id" TEXT,
    "base_salary" DECIMAL(12,2) NOT NULL,
    "sso_employee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "wht_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_paid" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_lines_payroll_id_idx" ON "payroll_lines"("payroll_id");

-- AddForeignKey
ALTER TABLE "payroll_details" ADD CONSTRAINT "payroll_details_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "expense_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_id_fkey" FOREIGN KEY ("payroll_id") REFERENCES "payroll_details"("document_id") ON DELETE CASCADE ON UPDATE CASCADE;
