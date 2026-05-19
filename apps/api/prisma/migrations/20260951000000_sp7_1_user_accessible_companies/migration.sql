-- SP7.1 — Add accessibleCompanies + primaryCompany to User
-- accessibleCompanies: array of company codes user can access. Default empty
--   array; backfill CLI assigns based on role (see src/cli/backfill-user-companies.cli.ts).
-- primaryCompany: default company context shown in UI pill switcher.

ALTER TABLE "users" ADD COLUMN "accessible_companies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD COLUMN "primary_company" TEXT;
