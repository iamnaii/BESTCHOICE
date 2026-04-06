-- Credit Check AI analysis fields + Customer salaryPayDay

-- Customer: วันที่เงินเดือนออก
ALTER TABLE "customers" ADD COLUMN "salary_pay_day" INTEGER;

-- CreditCheck: Salary slip AI analysis
ALTER TABLE "credit_checks" ADD COLUMN "salary_verified" DECIMAL(12,2);
ALTER TABLE "credit_checks" ADD COLUMN "employer_name" TEXT;
ALTER TABLE "credit_checks" ADD COLUMN "salary_pay_day" INTEGER;
ALTER TABLE "credit_checks" ADD COLUMN "salary_slip_files" TEXT[] DEFAULT '{}';

-- CreditCheck: Bank statement AI analysis
ALTER TABLE "credit_checks" ADD COLUMN "statement_bank_name" TEXT;
ALTER TABLE "credit_checks" ADD COLUMN "statement_avg_income" DECIMAL(12,2);
ALTER TABLE "credit_checks" ADD COLUMN "statement_avg_expense" DECIMAL(12,2);
ALTER TABLE "credit_checks" ADD COLUMN "statement_avg_balance" DECIMAL(12,2);

-- CreditCheck: Risk assessment
ALTER TABLE "credit_checks" ADD COLUMN "risk_score" TEXT;
ALTER TABLE "credit_checks" ADD COLUMN "debt_to_income_ratio" DECIMAL(5,4);
ALTER TABLE "credit_checks" ADD COLUMN "risk_note" TEXT;
