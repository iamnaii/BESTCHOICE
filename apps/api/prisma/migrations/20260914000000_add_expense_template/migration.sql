-- CreateTable
CREATE TABLE "expense_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "document_type" "DocumentType" NOT NULL,
  "branch_id" TEXT NOT NULL,
  "prefilled_data" JSONB NOT NULL,
  "is_recurring" BOOLEAN NOT NULL DEFAULT false,
  "recurring_day" INTEGER,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "expense_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_templates_branch_id_deleted_at_idx" ON "expense_templates"("branch_id", "deleted_at");
CREATE INDEX "expense_templates_is_recurring_recurring_day_idx" ON "expense_templates"("is_recurring", "recurring_day");

-- AddForeignKey
ALTER TABLE "expense_templates" ADD CONSTRAINT "expense_templates_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_templates" ADD CONSTRAINT "expense_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
