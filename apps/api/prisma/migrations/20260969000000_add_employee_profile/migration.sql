-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('MONTHLY', 'DAILY', 'CONTRACT');

-- CreateTable
CREATE TABLE "employee_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "position" TEXT,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'MONTHLY',
    "base_salary" DECIMAL(12,2),
    "sso_eligible" BOOLEAN NOT NULL DEFAULT true,
    "bank_name" TEXT,
    "bank_account_no" TEXT,
    "tax_id_override" TEXT,
    "note" TEXT,
    "resigned_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_user_id_key" ON "employee_profiles"("user_id");

-- CreateIndex
CREATE INDEX "employee_profiles_deleted_at_idx" ON "employee_profiles"("deleted_at");

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
