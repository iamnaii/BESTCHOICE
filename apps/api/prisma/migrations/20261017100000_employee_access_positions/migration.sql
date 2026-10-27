-- CreateEnum
CREATE TYPE "EmployeeAccessScope" AS ENUM ('BRANCHES', 'ASSIGNED', 'COMPANY');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "access_managed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "access_revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "access_positions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "access_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_access_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "scope" "EmployeeAccessScope" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "employee_access_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_access_assignment_branches" (
    "assignment_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,

    CONSTRAINT "employee_access_assignment_branches_pkey" PRIMARY KEY ("assignment_id","branch_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_positions_code_key" ON "access_positions"("code");

-- CreateIndex
CREATE INDEX "employee_access_assignments_user_id_deleted_at_idx" ON "employee_access_assignments"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "employee_access_assignments_position_id_deleted_at_idx" ON "employee_access_assignments"("position_id", "deleted_at");

-- CreateIndex
CREATE INDEX "employee_access_assignments_company_code_idx" ON "employee_access_assignments"("company_code");

-- CreateIndex
CREATE INDEX "employee_access_assignment_branches_branch_id_idx" ON "employee_access_assignment_branches"("branch_id");

-- AddForeignKey
ALTER TABLE "employee_access_assignments" ADD CONSTRAINT "employee_access_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_access_assignments" ADD CONSTRAINT "employee_access_assignments_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "access_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_access_assignments" ADD CONSTRAINT "employee_access_assignments_company_code_fkey" FOREIGN KEY ("company_code") REFERENCES "company_info"("company_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_access_assignment_branches" ADD CONSTRAINT "employee_access_assignment_branches_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "employee_access_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_access_assignment_branches" ADD CONSTRAINT "employee_access_assignment_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

