-- AlterTable
ALTER TABLE "users" ADD COLUMN "employee_id" TEXT,
ADD COLUMN "nickname" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "line_id" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "avatar_url" TEXT,
ADD COLUMN "start_date" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");
