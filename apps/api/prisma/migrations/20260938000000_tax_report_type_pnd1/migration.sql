-- SP3 — Add PND1 to TaxReportType enum (Personal Income Tax / WHT on payroll)
-- ม.50(1), ม.52/53 — filed by 7th of next month
ALTER TYPE "TaxReportType" ADD VALUE IF NOT EXISTS 'PND1';
