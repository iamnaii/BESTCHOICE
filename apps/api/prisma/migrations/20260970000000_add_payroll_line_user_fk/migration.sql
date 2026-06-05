-- AlterTable
ALTER TABLE "payroll_lines" ADD COLUMN "user_id" TEXT;

-- CreateIndex
CREATE INDEX "payroll_lines_user_id_idx" ON "payroll_lines"("user_id");

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
