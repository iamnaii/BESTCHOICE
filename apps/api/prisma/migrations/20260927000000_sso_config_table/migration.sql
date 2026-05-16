-- SSO config table — replaces hardcoded 750/15000 with stepped ceilings per Thai กฎกระทรวง.
-- Seeds 3 known periods: 2569+ (current), 2572+, 2575+. Each row stores the salary ceiling
-- and the resulting max contribution (= 5% × ceiling). Lookup by payroll documentDate.

CREATE TABLE "sso_config" (
    "id" TEXT NOT NULL,
    "salary_ceiling" DECIMAL(12,2) NOT NULL,
    "max_contribution" DECIMAL(12,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "note" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sso_config_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sso_config_effective_from_effective_to_idx"
    ON "sso_config"("effective_from", "effective_to");

-- Seed 3 rows per Settings Audit Core §1.4.4 (stepped ceiling support).
-- Years are Buddhist Era; in Gregorian: 2569=2026, 2572=2029, 2575=2032.
-- updated_at is set explicitly because @updatedAt is only auto-set on application-layer
-- updates, not on the initial migration insert.
INSERT INTO "sso_config" ("id", "salary_ceiling", "max_contribution", "effective_from", "effective_to", "note", "is_active", "created_at", "updated_at")
VALUES
    (gen_random_uuid()::text, 17500, 875, '2026-01-01', '2028-12-31',
     'พ.ศ. 2569–2571: เพดาน 17,500 ฿/เดือน — max 875 ฿/คน/เดือน (5% × 17,500). กฎกระทรวง 1 ม.ค. 2569',
     true, NOW(), NOW()),
    (gen_random_uuid()::text, 20000, 1000, '2029-01-01', '2031-12-31',
     'พ.ศ. 2572–2574: เพดาน 20,000 ฿/เดือน — max 1,000 ฿/คน/เดือน (5% × 20,000)',
     true, NOW(), NOW()),
    (gen_random_uuid()::text, 23000, 1150, '2032-01-01', NULL,
     'พ.ศ. 2575+ : เพดาน 23,000 ฿/เดือน — max 1,150 ฿/คน/เดือน (5% × 23,000). open-ended จนกว่ามีประกาศใหม่',
     true, NOW(), NOW());
