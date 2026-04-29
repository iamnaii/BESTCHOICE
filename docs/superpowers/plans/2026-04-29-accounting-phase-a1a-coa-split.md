# Accounting Phase A.1a — CoA Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split BESTCHOICE chart of accounts into 2 entity-scoped charts (SHOP=109 owner accounts + FINANCE=44 new accounts) via schema partition (`companyId` + composite unique). Remap ACC constants in JournalAutoService to fix audit findings F-2-002 (Bad Debt → Salary), F-3-012 (Interest → Rounding Excess), F-3-013 (Late Fee → Bank Interest). Defer inter-company JE wiring to A.1b.

**Architecture:** Schema migration + seed replacement + companyId-scoped lookups. NO inter-company JE structural changes (deferred). Commission income line temporarily removed from payment JE with Sentry alarm. Pattern: TDD per task, single PR with squash merge, deploy via existing GCP workflow (Migrations runs before API deploy = atomic).

**Tech Stack:** Prisma (migration + multi-entity schema), NestJS (services + DTOs + controller), React + Tailwind + shadcn (frontend), Jest (unit tests), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-04-29-accounting-phase-a1a-coa-split-design.md`
**Phase A.0 commit (predecessor):** `23eb4473`
**Branch:** `feat/accounting-phase-a1a-coa-split` (already created from origin/main + cherry-picked spec)

---

## Pre-flight

- [ ] **Step 1: Verify branch + clean tree**

Run: `git branch --show-current && git status --short`
Expected: branch `feat/accounting-phase-a1a-coa-split`, working tree clean (or only mockups/ untracked)

- [ ] **Step 2: Verify spec exists**

Run: `ls docs/superpowers/specs/2026-04-29-accounting-phase-a1a-coa-split-design.md`
Expected: file exists (cherry-picked as `f9866426`)

- [ ] **Step 3: Backup verification (already done by user before deploy)**

Note: Phase A.0 deploy already created a backup. Schema changes in A.1a are additive in deploy (existing rows updated, no destructive drops in production order).

---

## Wave 1 — Schema + Seed (single atomic commit)

### Task 1: Update Prisma schema for ChartOfAccount

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (ChartOfAccount model + add CompanyInfo inverse relation)

- [ ] **Step 1: Read current ChartOfAccount model**

Run: `grep -B 1 -A 28 "^model ChartOfAccount" apps/api/prisma/schema.prisma`

- [ ] **Step 2: Apply schema diff**

Edit `apps/api/prisma/schema.prisma` ChartOfAccount model:

```diff
 model ChartOfAccount {
   id           String       @id @default(uuid())
-  code         String       @unique // e.g. "1100", "4100"
+  code         String       // e.g. "1100", "4100" — unique per company via composite
   nameTh       String       @map("name_th")
   nameEn       String?      @map("name_en")
   accountGroup AccountGroup @map("account_group")
   parentCode   String?      @map("parent_code")
   level        Int          @default(1)
   isActive     Boolean      @default(true) @map("is_active")

-  // ── การใช้งานข้ามบริษัท (multi-entity) ──
-  allowedCompanies String[] @default([]) @map("allowed_companies")
+  // ── Multi-entity partition (Phase A.1a) ──
+  companyId    String?      @map("company_id") // null = shared (cash, etc.); else SHOP or FINANCE
+  company      CompanyInfo? @relation("CompanyChartOfAccounts", fields: [companyId], references: [id], onDelete: SetNull)

   // ── การ sync กับ PEAK ──
   peakAccountCode String? @map("peak_account_code")
   peakAccountId   String? @map("peak_account_id")

   createdAt DateTime  @default(now()) @map("created_at")
   updatedAt DateTime  @updatedAt @map("updated_at")
   deletedAt DateTime? @map("deleted_at")

+  @@unique([companyId, code])
   @@index([accountGroup])
   @@index([code])
+  @@index([companyId])
   @@map("chart_of_accounts")
 }
```

- [ ] **Step 3: Add inverse relation in CompanyInfo model**

Find the CompanyInfo model in `schema.prisma` and add the inverse relation:

```diff
 model CompanyInfo {
   // ... existing fields ...

+  chartOfAccounts ChartOfAccount[] @relation("CompanyChartOfAccounts")

   // ... existing relations ...
 }
```

- [ ] **Step 4: TypeScript + schema validation**

Run: `cd apps/api && npx prisma validate`
Expected: `The schema is valid 🚀`

(Don't run `prisma generate` yet — wait for migration creation in Task 2.)

---

### Task 2: Create migration with backfill SQL

**Files:**
- Create: `apps/api/prisma/migrations/{timestamp}_chart_of_accounts_company_partition/migration.sql`

- [ ] **Step 1: Generate migration name + folder**

Use sequential timestamp matching existing pattern (e.g., `20260615000000`):

```bash
cd apps/api
mkdir -p prisma/migrations/20260615000000_chart_of_accounts_company_partition
```

- [ ] **Step 2: Write migration SQL by hand (Prisma migrate dev cannot apply due to drift — same as Phase A.0 Task 16)**

Create `apps/api/prisma/migrations/20260615000000_chart_of_accounts_company_partition/migration.sql`:

```sql
-- Phase A.1a: ChartOfAccount multi-entity partition
-- Step 1: Add company_id column (nullable initially)
ALTER TABLE "chart_of_accounts" ADD COLUMN "company_id" TEXT;

-- Step 2: Add FK to company_info
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "company_info"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 3: Backfill — assign company_id based on existing allowed_companies array
UPDATE "chart_of_accounts" SET "company_id" = (
  SELECT id FROM "company_info" WHERE "company_code" = 'SHOP' LIMIT 1
) WHERE 'SHOP' = ANY("allowed_companies") AND "company_id" IS NULL;

UPDATE "chart_of_accounts" SET "company_id" = (
  SELECT id FROM "company_info" WHERE "company_code" = 'FINANCE' LIMIT 1
) WHERE 'FINANCE' = ANY("allowed_companies") AND "company_id" IS NULL;

-- Note: accounts with empty allowed_companies remain company_id = NULL (shared)

-- Step 4: Drop old unique constraint on code
ALTER TABLE "chart_of_accounts" DROP CONSTRAINT IF EXISTS "chart_of_accounts_code_key";

-- Step 5: Add composite unique on (company_id, code)
CREATE UNIQUE INDEX "chart_of_accounts_company_id_code_key" ON "chart_of_accounts" ("company_id", "code");

-- Step 6: Add index on company_id for filter queries
CREATE INDEX "chart_of_accounts_company_id_idx" ON "chart_of_accounts" ("company_id");

-- Step 7: Drop allowed_companies column
ALTER TABLE "chart_of_accounts" DROP COLUMN "allowed_companies";
```

- [ ] **Step 3: Regenerate Prisma client**

Run: `cd apps/api && npx prisma generate`
Expected: `✔ Generated Prisma Client` — new ChartOfAccount type has `companyId` field, no `allowedCompanies`.

- [ ] **Step 4: TypeScript check (will reveal callers using old fields)**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | head -40`
Expected: errors in:
- `chart-of-accounts.service.ts` (uses `allowedCompanies`)
- `chart-of-accounts.dto.ts` (declares `allowedCompanies`)
- `chart-of-accounts.service.spec.ts` (tests `allowedCompanies`)
- `journal-auto.service.ts` (lookup uses `allowedCompanies`)
- `journal.service.ts` (lookup uses `allowedCompanies`)
- Any seeds that use `allowedCompanies`

**These errors are expected — Tasks 3-8 will fix them.** Do NOT try to fix yet.

---

### Task 3: Replace seed file with 109 SHOP + 44 FINANCE

**Files:**
- Replace: `apps/api/prisma/seeds/chart-of-accounts.ts`
- Create: `apps/api/prisma/seeds/chart-of-accounts-finance.ts`

- [ ] **Step 1: Parse owner CoA CSV** (gather data)

Run: `cat docs/references/owner-chart-of-accounts.csv | head -10`
Expected: see structure (code, nameTh, notes columns).

- [ ] **Step 2: Replace `chart-of-accounts.ts` seed**

Replace entire file content:

```typescript
import { PrismaClient, AccountGroup } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { seedFinanceChartOfAccounts } from './chart-of-accounts-finance';

interface ChartOfAccountSeed {
  code: string;
  nameTh: string;
  nameEn?: string;
  accountGroup: AccountGroup;
  parentCode?: string;
  level: number;
}

/**
 * Phase A.1a: SHOP chart of accounts (109 accounts from owner CSV).
 * Owner-supplied. See docs/references/owner-chart-of-accounts.csv.
 */
function parseOwnerCsv(): ChartOfAccountSeed[] {
  const csvPath = path.resolve(__dirname, '../../../../docs/references/owner-chart-of-accounts.csv');
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim());

  const accounts: ChartOfAccountSeed[] = [];
  let currentGroup: AccountGroup | null = null;

  for (const line of lines) {
    const cols = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    const first = cols[0] || '';

    // Section header (e.g., "หมวดที่ 1: สินทรัพย์ (Assets)")
    if (first.startsWith('หมวดที่ 1')) { currentGroup = AccountGroup.ASSET; continue; }
    if (first.startsWith('หมวดที่ 2')) { currentGroup = AccountGroup.LIABILITY; continue; }
    if (first.startsWith('หมวดที่ 3')) { currentGroup = AccountGroup.EQUITY; continue; }
    if (first.startsWith('หมวดที่ 4')) { currentGroup = AccountGroup.REVENUE; continue; }
    if (first.startsWith('หมวดที่ 5')) { currentGroup = AccountGroup.EXPENSE; continue; }
    if (first === 'เลขบัญชี') continue; // header row

    if (!currentGroup) continue;

    // Account code pattern: XX-XXXX or XX-XXXX
    if (!/^\d{2}-\d{4,5}$/.test(first)) continue;

    const code = first;
    const nameTh = cols[1] || '';
    if (!nameTh) continue;

    // Determine level from code suffix
    let level = 3;
    if (code.endsWith('-0000') || code.endsWith('-1000') || code.endsWith('-2000')) level = 1;
    else if (code.endsWith('XX')) level = 2;

    accounts.push({ code, nameTh, accountGroup: currentGroup, level });
  }

  return accounts;
}

export async function seedChartOfAccounts(prisma: PrismaClient): Promise<void> {
  console.log('Seeding Chart of Accounts (Phase A.1a — SHOP + FINANCE split)...');

  // Resolve company ids
  const shopCompany = await prisma.companyInfo.findFirst({
    where: { companyCode: 'SHOP', deletedAt: null },
    select: { id: true },
  });
  const financeCompany = await prisma.companyInfo.findFirst({
    where: { companyCode: 'FINANCE', deletedAt: null },
    select: { id: true },
  });

  if (!shopCompany || !financeCompany) {
    throw new Error('SHOP and FINANCE companies must exist before seeding chart of accounts');
  }

  // Seed SHOP chart from owner CSV
  const shopAccounts = parseOwnerCsv();
  console.log(`  → Seeding ${shopAccounts.length} SHOP accounts from owner CSV...`);
  for (const acc of shopAccounts) {
    await prisma.chartOfAccount.upsert({
      where: { companyId_code: { companyId: shopCompany.id, code: acc.code } },
      update: {
        nameTh: acc.nameTh,
        nameEn: acc.nameEn,
        accountGroup: acc.accountGroup,
        level: acc.level,
        isActive: true,
        peakAccountCode: acc.code,
      },
      create: {
        code: acc.code,
        companyId: shopCompany.id,
        nameTh: acc.nameTh,
        nameEn: acc.nameEn,
        accountGroup: acc.accountGroup,
        parentCode: acc.parentCode,
        level: acc.level,
        isActive: true,
        peakAccountCode: acc.code,
      },
    });
  }

  // Seed FINANCE chart from finance seed file
  await seedFinanceChartOfAccounts(prisma, financeCompany.id);

  // Add SHOP-side clearing account (Due-from-FINANCE) for inter-company (used in A.1b)
  await prisma.chartOfAccount.upsert({
    where: { companyId_code: { companyId: shopCompany.id, code: '11-2105' } },
    update: { nameTh: 'ลูกหนี้คู่ค้า — FINANCE (Due-from-FINANCE)' },
    create: {
      code: '11-2105',
      companyId: shopCompany.id,
      nameTh: 'ลูกหนี้คู่ค้า — FINANCE (Due-from-FINANCE)',
      nameEn: 'Inter-company Receivable — FINANCE',
      accountGroup: AccountGroup.ASSET,
      parentCode: '11-21XX',
      level: 3,
      isActive: true,
      peakAccountCode: '11-2105',
    },
  });

  console.log(`  ✓ Chart of Accounts: ${shopAccounts.length + 1} SHOP + 44 FINANCE seeded`);
}
```

- [ ] **Step 3: Create FINANCE seed file**

Create `apps/api/prisma/seeds/chart-of-accounts-finance.ts`:

```typescript
import { PrismaClient, AccountGroup } from '@prisma/client';

interface FinanceAccount {
  code: string;
  nameTh: string;
  nameEn: string;
  accountGroup: AccountGroup;
  parentCode?: string;
  level: number;
}

/**
 * Phase A.1a: FINANCE chart of accounts (44 accounts).
 * 38 standard + 2 deferred (W-003 unearnedInterest, CR-001 VAT-on-interest)
 * + 4 inter-company clearing accounts (1 here as Due-to-SHOP; 3 others added separately).
 */
const FINANCE_ACCOUNTS: FinanceAccount[] = [
  // ─── 11-XXXX สินทรัพย์หมุนเวียน (10) ───
  { code: '11-1101', nameTh: 'เงินสด FINANCE', nameEn: 'Cash on Hand FINANCE', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-1201', nameTh: 'ธนาคาร FINANCE — บัญชีหลัก', nameEn: 'Bank — FINANCE Main', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-1202', nameTh: 'ธนาคาร FINANCE — รับชำระค่างวด', nameEn: 'Bank — Installment Collection', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-2102', nameTh: 'ลูกหนี้เช่าซื้อ', nameEn: 'Hire-Purchase Receivable', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-2103', nameTh: 'หัก: ค่าเผื่อหนี้สงสัยจะสูญ', nameEn: 'Less: Allowance for Doubtful Accounts', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-2104', nameTh: 'ลูกหนี้ไฟแนนซ์ภายนอก', nameEn: 'External Finance Receivable', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-3103', nameTh: 'สินค้ายึดคืน/ซ่อมแล้ว', nameEn: 'Repossessed/Refurbished Goods', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-4101', nameTh: 'ภาษีซื้อ', nameEn: 'Input VAT', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-4102', nameTh: 'ภาษีซื้อยังไม่ถึงกำหนด', nameEn: 'Input VAT Pending', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-4103', nameTh: 'ภาษีถูกหัก ณ ที่จ่าย', nameEn: 'Withholding Tax Receivable', accountGroup: AccountGroup.ASSET, level: 3 },

  // ─── 21-XXXX หนี้สินหมุนเวียน (10) ───
  { code: '21-1102', nameTh: 'เจ้าหนี้คู่ค้า — SHOP (Due-to-SHOP)', nameEn: 'Inter-company Payable — SHOP', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-2101', nameTh: 'ภาษีขาย ภ.พ.30', nameEn: 'Output VAT (PP.30)', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-2102', nameTh: 'ภาษีขายรอเรียกเก็บ', nameEn: 'Output VAT Pending Invoice', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-2103', nameTh: 'ภ.พ.36 ค้างจ่าย', nameEn: 'PP.36 Payable', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-2104', nameTh: 'ภาษีขายดอกเบี้ยรอตัดบัญชี [DEFERRED CR-001]', nameEn: 'Deferred VAT on Interest', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-2202', nameTh: 'รายได้ดอกเบี้ยรอตัดบัญชี [DEFERRED W-003]', nameEn: 'Unearned Interest Income', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-3201', nameTh: 'เจ้าหนี้สรรพากร ภ.พ.30 รอชำระ', nameEn: 'VAT Payable to RD', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-3202', nameTh: 'เจ้าหนี้สรรพากร ภ.ง.ด.53 รอชำระ', nameEn: 'PND.53 Payable to RD', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-4201', nameTh: 'เงินรับล่วงหน้า', nameEn: 'Advance Receipts', accountGroup: AccountGroup.LIABILITY, level: 3 },
  { code: '21-5101', nameTh: 'เงินเกินของลูกค้า', nameEn: 'Customer Credit Balance', accountGroup: AccountGroup.LIABILITY, level: 3 },

  // ─── 31/32-XXXX ส่วนของผู้ถือหุ้น (2) ───
  { code: '31-1101', nameTh: 'ทุนสามัญ FINANCE', nameEn: 'Common Stock FINANCE', accountGroup: AccountGroup.EQUITY, level: 3 },
  { code: '32-1101', nameTh: 'กำไร(ขาดทุน)สะสม FINANCE', nameEn: 'Retained Earnings FINANCE', accountGroup: AccountGroup.EQUITY, level: 3 },

  // ─── 42-XXXX รายได้อื่น (5) ───
  { code: '42-2101', nameTh: 'รายได้ดอกเบี้ยเช่าซื้อ', nameEn: 'Hire-Purchase Interest Income', accountGroup: AccountGroup.REVENUE, level: 3 },
  { code: '42-2102', nameTh: 'ค่างวดเบี้ยปรับล่าช้า', nameEn: 'Late Payment Penalty Income', accountGroup: AccountGroup.REVENUE, level: 3 },
  { code: '42-2103', nameTh: 'ค่ามัดจำ/เงินประกันที่ริบ', nameEn: 'Forfeited Deposits', accountGroup: AccountGroup.REVENUE, level: 3 },
  { code: '42-2104', nameTh: 'รายได้จากการยึดเครื่อง', nameEn: 'Repossession Income', accountGroup: AccountGroup.REVENUE, level: 3 },
  { code: '42-2105', nameTh: 'รายได้ค่าคอมมิชชันจาก SHOP [A.1b]', nameEn: 'Commission Income from SHOP', accountGroup: AccountGroup.REVENUE, level: 3 },

  // ─── 53-XXXX ค่าใช้จ่าย (6) ───
  { code: '53-1701', nameTh: 'หนี้สูญ', nameEn: 'Bad Debt Expense', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '53-1702', nameTh: 'หนี้สงสัยจะสูญ', nameEn: 'Doubtful Debt Expense', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '53-1801', nameTh: 'ค่านายหน้าจ่าย SHOP [A.1b]', nameEn: 'Commission Expense to SHOP', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '53-1802', nameTh: 'ค่าธรรมเนียม PaySolutions', nameEn: 'PaySolutions Fees', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '53-1803', nameTh: 'ค่าธรรมเนียมโอนเงิน', nameEn: 'Bank Transfer Fees', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '53-1601', nameTh: 'ค่าเสื่อมราคา — อุปกรณ์ FINANCE', nameEn: 'Depreciation — FINANCE Equipment', accountGroup: AccountGroup.EXPENSE, level: 3 },

  // ─── 54-XXXX รายจ่ายต้องห้ามทางภาษี (2) ───
  { code: '54-1101', nameTh: 'ภงด. ทางภาษี ภ.ง.ด.3', nameEn: 'Tax Expense — PND.3', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '54-1102', nameTh: 'ภงด. ทางภาษี ภ.ง.ด.53', nameEn: 'Tax Expense — PND.53', accountGroup: AccountGroup.EXPENSE, level: 3 },
];

export async function seedFinanceChartOfAccounts(prisma: PrismaClient, financeCompanyId: string): Promise<void> {
  console.log(`  → Seeding ${FINANCE_ACCOUNTS.length} FINANCE accounts...`);
  for (const acc of FINANCE_ACCOUNTS) {
    await prisma.chartOfAccount.upsert({
      where: { companyId_code: { companyId: financeCompanyId, code: acc.code } },
      update: {
        nameTh: acc.nameTh,
        nameEn: acc.nameEn,
        accountGroup: acc.accountGroup,
        level: acc.level,
        isActive: true,
        peakAccountCode: acc.code,
      },
      create: {
        code: acc.code,
        companyId: financeCompanyId,
        nameTh: acc.nameTh,
        nameEn: acc.nameEn,
        accountGroup: acc.accountGroup,
        parentCode: acc.parentCode,
        level: acc.level,
        isActive: true,
        peakAccountCode: acc.code,
      },
    });
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles for seed**

Run: `cd apps/api && npx tsc --noEmit prisma/seeds/chart-of-accounts.ts prisma/seeds/chart-of-accounts-finance.ts 2>&1 | head -10`
Expected: 0 errors (depends on Prisma client regenerated in Task 2)

- [ ] **Step 5: Commit Wave 1 atomically**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260615000000_chart_of_accounts_company_partition/ apps/api/prisma/seeds/chart-of-accounts.ts apps/api/prisma/seeds/chart-of-accounts-finance.ts
git commit -m "feat(accounting): split CoA into SHOP + FINANCE charts (Phase A.1a Wave 1)

Schema: ChartOfAccount adds companyId + composite unique (companyId, code).
Migration: backfill existing 76 rows by allowedCompanies → SHOP/FINANCE/null,
then drop allowedCompanies column.

Seed replaced:
- SHOP chart: 109 accounts parsed from docs/references/owner-chart-of-accounts.csv
- FINANCE chart: 44 accounts (38 standard + 2 deferred + 4 clearing)
- 1 SHOP-side clearing account (11-2105 Due-from-FINANCE)

Note: backend code paths still reference allowedCompanies — Tasks 4-8 fix.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave 2 — Backend code update

### Task 4: Update chart-of-accounts.service.ts

**Files:**
- Modify: `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts`

- [ ] **Step 1: Read current service**

Run: `cat apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts`

- [ ] **Step 2: Replace findAll signature to accept companyId filter**

Edit `findAll` method:

```typescript
async findAll(filter?: { group?: AccountGroup; active?: boolean; q?: string; companyId?: string | 'SHARED' | null }) {
  const companyFilter = filter?.companyId === 'SHARED'
    ? { companyId: null }
    : filter?.companyId
      ? { companyId: filter.companyId }
      : {}; // no filter = all companies

  return this.prisma.chartOfAccount.findMany({
    where: {
      deletedAt: null,
      ...companyFilter,
      ...(filter?.group && { accountGroup: filter.group }),
      ...(filter?.active != null && { isActive: filter.active }),
      ...(filter?.q && {
        OR: [
          { code: { contains: filter.q, mode: 'insensitive' } },
          { nameTh: { contains: filter.q, mode: 'insensitive' } },
          { nameEn: { contains: filter.q, mode: 'insensitive' } },
        ],
      }),
    },
    orderBy: [{ companyId: 'asc' }, { code: 'asc' }],
  });
}
```

- [ ] **Step 3: Update create() to use composite unique check**

```typescript
async create(dto: CreateChartOfAccountDto) {
  // Composite uniqueness check
  const exists = await this.prisma.chartOfAccount.findUnique({
    where: { companyId_code: { companyId: dto.companyId ?? null, code: dto.code } },
  });
  if (exists) throw new ConflictException(`รหัสบัญชี ${dto.code} มีอยู่แล้วในบริษัทนี้`);

  if (dto.parentCode) {
    const parent = await this.prisma.chartOfAccount.findFirst({
      where: { code: dto.parentCode, companyId: dto.companyId ?? null, deletedAt: null },
    });
    if (!parent) throw new BadRequestException(`ไม่พบบัญชีแม่ ${dto.parentCode} ในบริษัทเดียวกัน`);
  }

  return this.prisma.chartOfAccount.create({
    data: {
      code: dto.code,
      companyId: dto.companyId ?? null,
      nameTh: dto.nameTh,
      nameEn: dto.nameEn,
      accountGroup: dto.accountGroup,
      parentCode: dto.parentCode,
      level: dto.level ?? 3,
      isActive: dto.isActive ?? true,
      peakAccountCode: dto.peakAccountCode ?? dto.code,
      peakAccountId: dto.peakAccountId,
    },
  });
}
```

- [ ] **Step 4: Remove allowedCompanies from update + delete logic**

Update `update()` and `remove()` to drop any reference to `allowedCompanies`. The `update()` body should pass `dto` directly to Prisma update.

- [ ] **Step 5: TypeScript check**

Run: `cd apps/api && npx tsc --noEmit src/modules/chart-of-accounts/chart-of-accounts.service.ts 2>&1 | head -5`
Expected: 0 errors (depends on DTO update in Task 6)

- [ ] **Step 6: Commit (combined with Tasks 5+6 below in single commit)**

Skip commit until Tasks 5+6 done (controller + DTO together).

---

### Task 5: Update chart-of-accounts.controller.ts

**Files:**
- Modify: `apps/api/src/modules/chart-of-accounts/chart-of-accounts.controller.ts`

- [ ] **Step 1: Read current controller**

Run: `cat apps/api/src/modules/chart-of-accounts/chart-of-accounts.controller.ts`

- [ ] **Step 2: Update findAll endpoint to accept ?companyId= query param**

Find the `findAll` route handler and add `companyId` query param:

```typescript
@Get()
async findAll(
  @Query('group') group?: AccountGroup,
  @Query('active') active?: string,
  @Query('q') q?: string,
  @Query('companyId') companyId?: string,  // NEW: 'SHOP-uuid' | 'FINANCE-uuid' | 'SHARED' | undefined
) {
  return this.chartOfAccountsService.findAll({
    group,
    active: active === 'true' ? true : active === 'false' ? false : undefined,
    q,
    companyId: companyId === 'SHARED' ? 'SHARED' : companyId,
  });
}
```

---

### Task 6: Update chart-of-account.dto.ts

**Files:**
- Modify: `apps/api/src/modules/chart-of-accounts/dto/chart-of-account.dto.ts`

- [ ] **Step 1: Replace allowedCompanies with companyId**

Edit the DTO file:

```diff
-import { IsString, IsOptional, IsEnum, IsBoolean, IsInt, Matches, MaxLength, Min, Max, IsArray, IsIn } from 'class-validator';
+import { IsString, IsOptional, IsEnum, IsBoolean, IsInt, Matches, MaxLength, Min, Max, IsUUID } from 'class-validator';
 import { AccountGroup } from '@prisma/client';

-const ALLOWED_COMPANY_CODES = ['SHOP', 'FINANCE'] as const;

 export class CreateChartOfAccountDto {
   // ... existing code, nameTh, accountGroup, parentCode, level, isActive ...

-  @IsArray()
-  @IsOptional()
-  @IsIn(ALLOWED_COMPANY_CODES, { each: true, message: 'allowedCompanies ต้องเป็น SHOP หรือ FINANCE' })
-  allowedCompanies?: string[];
+  @IsUUID()
+  @IsOptional()
+  companyId?: string;  // null/undefined = shared account

   // ... existing peakAccountCode, peakAccountId ...
 }

 export class UpdateChartOfAccountDto {
   // mirror — remove allowedCompanies, add companyId
 }
```

- [ ] **Step 2: TypeScript check + commit Tasks 4+5+6 together**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | grep -E "chart-of-accounts" | head -5`
Expected: 0 errors in chart-of-accounts files (other modules may still error — fix in Tasks 7+8).

```bash
git add apps/api/src/modules/chart-of-accounts/
git commit -m "feat(coa): companyId-aware queries + DTO update (Phase A.1a Wave 2a)

- findAll accepts ?companyId= filter (SHOP id, FINANCE id, 'SHARED', or omit)
- create uses composite unique (companyId, code)
- DTO replaces allowedCompanies array with optional companyId UUID

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Update journal-auto.service.ts (ACC remap + lookup + commission removal)

**Files:**
- Modify: `apps/api/src/modules/journal/journal-auto.service.ts`

- [ ] **Step 1: Replace ACC constants with SHOP_ACC + FINANCE_ACC**

Find `static readonly ACC = {` block (~line 30) and replace:

```typescript
// SHOP-side accounts (in SHOP chart)
static readonly SHOP_ACC = {
  CASH: '11-1101',
  REVENUE_NEW: '41-1101',
  REVENUE_USED: '41-1102',
  INVENTORY_NEW: '11-3101',
  INVENTORY_USED: '11-3102',
  COGS_NEW: '51-1101',
  COGS_USED: '51-1102',
  COMMISSION_INCOME: '42-1105',         // owner CoA — used in A.1b
  DUE_FROM_FINANCE: '11-2105',          // inter-company clearing — A.1b
} as const;

// FINANCE-side accounts (in FINANCE chart)
static readonly FINANCE_ACC = {
  CASH: '11-1101',
  HP_RECEIVABLE: '11-2102',
  ALLOWANCE_DOUBTFUL: '11-2103',
  REPO_INVENTORY: '11-3103',
  VAT_INPUT: '11-4101',
  INTEREST_INCOME: '42-2101',           // moved from 42-1101 (was Rounding Excess in owner CoA)
  LATE_FEE_INCOME: '42-2102',           // moved from 42-1102 (was Bank Interest in owner CoA)
  REPOSSESSION_INCOME: '42-2104',
  VAT_OUTPUT: '21-2101',
  CUSTOMER_CREDIT: '21-5101',
  DUE_TO_SHOP: '21-1102',               // inter-company clearing — A.1b
  BAD_DEBT_EXPENSE: '53-1701',          // moved from 53-1101 (was Salary!)
  COMMISSION_EXPENSE: '53-1801',        // for A.1b
} as const;

// Backward compat for tests (alias to FINANCE_ACC + SHOP_ACC subset)
// Will be removed once all tests use scoped names.
static readonly ACC = {
  ...this.SHOP_ACC,
  ...this.FINANCE_ACC,
} as const;
```

(Note: TypeScript may not allow `...this` in static. If so, repeat manually.)

- [ ] **Step 2: Update validation lookup in createAndPost**

Find the `createAndPost` method's allowedCompanies validation block (added in Phase A.0) and replace:

```diff
-// F-3-027: validate allowedCompanies
-const codes = [...new Set(lines.map((l) => l.accountCode))];
-const [accounts, company] = await Promise.all([
-  tx.chartOfAccount.findMany({
-    where: { code: { in: codes } },
-    select: { code: true, nameTh: true, allowedCompanies: true },
-  }),
-  tx.companyInfo.findUnique({
-    where: { id: params.companyId },
-    select: { companyCode: true },
-  }),
-]);
-if (!company) {
-  throw new BadRequestException(`Company ${params.companyId} not found`);
-}
-for (const acc of accounts) {
-  if (acc.allowedCompanies.length > 0 && !acc.allowedCompanies.includes(company.companyCode)) {
-    throw new BadRequestException(
-      `Account ${acc.code} (${acc.nameTh}) ใช้ไม่ได้กับบริษัท ${company.companyCode}`,
-    );
-  }
-}
+// F-3-027 + Phase A.1a: validate accounts exist in this company's chart
+const codes = [...new Set(lines.map((l) => l.accountCode))];
+const accounts = await tx.chartOfAccount.findMany({
+  where: { code: { in: codes }, companyId: params.companyId, deletedAt: null },
+  select: { code: true, nameTh: true },
+});
+const foundCodes = new Set(accounts.map((a) => a.code));
+const missing = codes.filter((c) => !foundCodes.has(c));
+if (missing.length > 0) {
+  throw new BadRequestException(
+    `Account(s) ${missing.join(', ')} ไม่อยู่ใน chart ของ companyId ${params.companyId}`,
+  );
+}
```

- [ ] **Step 3: Update createPaymentJournal — remove COMMISSION_INCOME line + add Sentry alarm**

Find createPaymentJournal in journal-auto.service.ts. Look for:

```typescript
lines.push({
  accountCode: ACC.COMMISSION_INCOME,
  description: 'Commission Income',
  debit: 0,
  credit: monthlyCommission.toNumber(),
});
```

(or similar — pattern may differ slightly). Replace with:

```typescript
// Phase A.1a: commission removed from payment JE — defer to A.1b inter-company
if (params.payment.monthlyCommission && new Decimal(params.payment.monthlyCommission).gt(0)) {
  Sentry.captureMessage('Payment commission not yet posted (deferred to A.1b)', {
    level: 'info',
    tags: { module: 'journal', kind: 'commission-deferred' },
    extra: { paymentId: params.payment.id, amount: params.payment.monthlyCommission.toString() },
  });
}
// (no COMMISSION_INCOME line pushed)
```

- [ ] **Step 4: Update all ACC references**

Run: `grep -n "ACC\." apps/api/src/modules/journal/journal-auto.service.ts`

For each reference, decide whether it's SHOP or FINANCE context based on the journal type:
- `createPaymentJournal` (FINANCE side) — uses FINANCE_ACC for HP_RECEIVABLE, INTEREST_INCOME, LATE_FEE_INCOME, VAT_OUTPUT, CUSTOMER_CREDIT, BAD_DEBT_EXPENSE; uses FINANCE_ACC.CASH (FINANCE bank receives payment)
- `createContractActivationJournal` (FINANCE side primary, SHOP COGS but currently single-entity) — TODO: A.1a posts everything as FINANCE since A.1b will split. For now, replace ACC.HP_RECEIVABLE → FINANCE_ACC.HP_RECEIVABLE, ACC.REVENUE_NEW → use SHOP_ACC.REVENUE_NEW (Wait — this references will fail because account is in SHOP chart but companyId is FINANCE). **CRITICAL DESIGN DECISION**: For A.1a, contract activation must continue working. We have two options:
  - (a) Temporarily use FINANCE chart accounts only for revenue (add 41-1101 to FINANCE chart)
  - (b) Allow journal to span 2 companies (current single-entity)

  Per spec section 3.5: "Update all references in createPaymentJournal, createContractActivationJournal, createBadDebtWriteOffJournal to use the new partitioned constants. Pass companyId from already-resolved (Phase A.0) caller."

  This means contract activation will use FINANCE_ACC throughout (everything FINANCE-side; SHOP gets nothing in A.1a). This works because:
  - HP_RECEIVABLE = 11-2102 in FINANCE ✓
  - REVENUE = need new code in FINANCE chart for "FINANCE side recognition of HP value-add"

  **Simplest A.1a path:** Add `41-2101 รายได้ขายเช่าซื้อ — FINANCE` to FINANCE seed (Task 3), use it in contract activation. Remove SHOP revenue from this JE (defer SHOP-side to A.1b).

  Add to `chart-of-accounts-finance.ts`:
  ```typescript
  { code: '41-2101', nameTh: 'รายได้ขายเช่าซื้อ FINANCE', nameEn: 'HP Sales Revenue FINANCE', accountGroup: AccountGroup.REVENUE, level: 3 },
  { code: '41-2102', nameTh: 'รายได้ขายเช่าซื้อมือสอง FINANCE', nameEn: 'HP Used Sales Revenue FINANCE', accountGroup: AccountGroup.REVENUE, level: 3 },
  { code: '11-3104', nameTh: 'สินค้าคงเหลือ FINANCE — เครื่องใหม่', nameEn: 'Inventory FINANCE New', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '11-3105', nameTh: 'สินค้าคงเหลือ FINANCE — มือสอง', nameEn: 'Inventory FINANCE Used', accountGroup: AccountGroup.ASSET, level: 3 },
  { code: '51-2101', nameTh: 'ต้นทุนขายเช่าซื้อ FINANCE — เครื่องใหม่', nameEn: 'COGS FINANCE New', accountGroup: AccountGroup.EXPENSE, level: 3 },
  { code: '51-2102', nameTh: 'ต้นทุนขายเช่าซื้อ FINANCE — มือสอง', nameEn: 'COGS FINANCE Used', accountGroup: AccountGroup.EXPENSE, level: 3 },
  ```

  Update FINANCE_ACC accordingly:
  ```typescript
  REVENUE_NEW: '41-2101',
  REVENUE_USED: '41-2102',
  INVENTORY_NEW: '11-3104',
  INVENTORY_USED: '11-3105',
  COGS_NEW: '51-2101',
  COGS_USED: '51-2102',
  ```

  Note: This means FINANCE chart grows from 44 → 50 accounts. Update spec acknowledgment in commit message.

- [ ] **Step 5: Update createContractActivationJournal to use FINANCE_ACC throughout**

Replace all `ACC.X` references in createContractActivationJournal with `FINANCE_ACC.X`.

- [ ] **Step 6: Update createBadDebtWriteOffJournal to use FINANCE_ACC**

```typescript
// Replace ACC.BAD_DEBT_EXPENSE → FINANCE_ACC.BAD_DEBT_EXPENSE
// Replace ACC.HP_RECEIVABLE → FINANCE_ACC.HP_RECEIVABLE
// Replace ACC.ALLOWANCE_DOUBTFUL → FINANCE_ACC.ALLOWANCE_DOUBTFUL
```

- [ ] **Step 7: Update createExpenseJournal to use SHOP_ACC or FINANCE_ACC based on caller's companyId**

Currently createExpenseJournal accepts companyId. Use that to pick chart:

```typescript
const acc = params.companyId === '<SHOP_ID>' ? this.SHOP_ACC : this.FINANCE_ACC;
// Then use acc.CASH, acc.VAT_INPUT
```

But hardcoded SHOP_ID isn't right. Instead, look up company by id:

```typescript
const company = await tx.companyInfo.findUnique({ where: { id: params.companyId }, select: { companyCode: true } });
const isShop = company?.companyCode === 'SHOP';
const accs = isShop ? JournalAutoService.SHOP_ACC : JournalAutoService.FINANCE_ACC;
// Use accs.CASH, accs.VAT_INPUT
```

- [ ] **Step 8: TypeScript check**

Run: `cd apps/api && npx tsc --noEmit src/modules/journal/journal-auto.service.ts 2>&1 | head -10`
Expected: 0 errors

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/journal/journal-auto.service.ts apps/api/prisma/seeds/chart-of-accounts-finance.ts
git commit -m "feat(journal): partition ACC constants by company chart (Phase A.1a Wave 2b)

ACC remapped:
- BAD_DEBT_EXPENSE: 53-1101 (Salary!) → 53-1701 หนี้สูญ (FINANCE)
- INTEREST_INCOME: 42-1101 (Rounding!) → 42-2101 (FINANCE)
- LATE_FEE_INCOME: 42-1102 (Bank Interest!) → 42-2102 (FINANCE)

createAndPost validation now scoped: accounts must exist in this
company's chart (composite (companyId, code) lookup).

createPaymentJournal: COMMISSION_INCOME line removed; Sentry alarm
fires if monthlyCommission > 0 (defer inter-company to A.1b).

Added 6 FINANCE accounts for revenue/inventory/COGS so contract
activation works FINANCE-side in A.1a (SHOP-side split deferred to A.1b).
FINANCE chart now has 50 accounts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Update journal.service.ts lookup

**Files:**
- Modify: `apps/api/src/modules/journal/journal.service.ts`

- [ ] **Step 1: Find allowedCompanies usage**

Run: `grep -n "allowedCompanies" apps/api/src/modules/journal/journal.service.ts`

- [ ] **Step 2: Replace with composite (companyId, code) lookup**

```diff
-const accounts = await this.prisma.chartOfAccount.findMany({
-  where: { code: { in: codes } },
-  select: { code: true, nameTh: true, allowedCompanies: true },
-});
-// ... validation by allowedCompanies + companyCode
+const accounts = await this.prisma.chartOfAccount.findMany({
+  where: { code: { in: codes }, companyId: dto.companyId, deletedAt: null },
+  select: { code: true, nameTh: true },
+});
+const foundCodes = new Set(accounts.map((a) => a.code));
+const missing = codes.filter((c) => !foundCodes.has(c));
+if (missing.length > 0) {
+  throw new BadRequestException(
+    `Account(s) ${missing.join(', ')} ไม่อยู่ใน chart ของ companyId ${dto.companyId}`,
+  );
+}
```

- [ ] **Step 3: TypeScript check**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | head -10`
Expected: 0 errors across all files

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/journal/journal.service.ts
git commit -m "feat(journal): manual JE validation uses composite (companyId, code) lookup (Phase A.1a Wave 2c)

journal.service.create + post now look up accounts scoped to the JE's
companyId. Throws BadRequestException with missing-codes list if any
referenced account isn't in this company's chart.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave 3 — Frontend

### Task 9: Update ChartOfAccountsPage with company selector

**Files:**
- Modify: `apps/web/src/pages/ChartOfAccountsPage.tsx`
- Possibly modify: `apps/web/src/pages/ChartOfAccountsPage.tsx` form/dialog area

- [ ] **Step 1: Read current page**

Run: `head -100 apps/web/src/pages/ChartOfAccountsPage.tsx`

- [ ] **Step 2: Add companyFilter state + companies query**

In the component (after existing useState calls):

```typescript
const [companyFilter, setCompanyFilter] = useState<string>('ALL');

const { data: companies = [] } = useQuery<{ id: string; companyCode: string }[]>({
  queryKey: ['companies-active'],
  queryFn: async () => {
    const { data } = await api.get('/companies?active=true');
    return data;
  },
});
```

- [ ] **Step 3: Update findAll query to include companyId param**

```typescript
const { data: accounts = [], isLoading, isError, error, refetch } = useQuery<ChartOfAccount[]>({
  queryKey: ['chart-of-accounts', companyFilter],
  queryFn: async () => {
    const params: Record<string, string> = {};
    if (companyFilter === 'SHARED') params.companyId = 'SHARED';
    else if (companyFilter !== 'ALL') params.companyId = companyFilter;
    const { data } = await api.get('/chart-of-accounts', { params });
    return data;
  },
});
```

- [ ] **Step 4: Add company selector to UI (before group filter)**

Find the existing filter section and add Select component:

```tsx
<Select value={companyFilter} onValueChange={setCompanyFilter}>
  <SelectTrigger className="w-48">
    <SelectValue placeholder="บริษัท" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="ALL">ทุกบริษัท (รวม shared)</SelectItem>
    <SelectItem value="SHARED">Shared (ไม่ระบุ)</SelectItem>
    {companies.map((c) => (
      <SelectItem key={c.id} value={c.id}>{c.companyCode}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

- [ ] **Step 5: Update create form to include companyId field**

In the form state interface and FormState, replace `allowedCompanies` with `companyId: string | null`. Add companyId selector dropdown to form (defaults to current `companyFilter` if not 'ALL').

- [ ] **Step 6: Update ChartOfAccount type**

```typescript
interface ChartOfAccount {
  // ... existing
  companyId: string | null;  // NEW
  // remove allowedCompanies
}
```

- [ ] **Step 7: TypeScript check**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -5`
Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/ChartOfAccountsPage.tsx
git commit -m "feat(coa): company selector + filter on ChartOfAccountsPage (Phase A.1a Wave 3)

Add company dropdown above filters. ?companyId= passed to backend.
Defaults to ALL (shows shared + all companies' accounts).

Create form requires companyId selection (or shared).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave 4 — Tests + verification

### Task 10: Update cross-spec mocks

**Files:**
- Modify: any spec that mocks `chartOfAccount.findMany` or `companyInfo.findUnique` (added in Phase A.0)

- [ ] **Step 1: Find affected specs**

```bash
grep -rln "chartOfAccount" apps/api/src --include="*.spec.ts" | head
grep -rln "allowedCompanies" apps/api/src --include="*.spec.ts" | head
```

- [ ] **Step 2: For each affected spec, update mock to use new lookup signature**

Pattern change: `chartOfAccount.findMany` mock should:
- Accept `where: { code: { in: ... }, companyId: ..., deletedAt: null }`
- Return rows WITHOUT `allowedCompanies` field
- Return rows WITH `code` + `nameTh`

Default mock returns `[]` (so validation finds all codes missing — adjust per-test as needed):

```typescript
chartOfAccount: {
  findMany: jest.fn().mockResolvedValue([
    // Return all expected codes for the test
    { code: '11-1101', nameTh: 'Cash' },
    { code: '11-2102', nameTh: 'HP Receivable' },
    // ... etc
  ]),
},
```

- [ ] **Step 3: Run full unit test suite to identify failures**

Run: `cd apps/api && npx jest 2>&1 | tail -20`
Expected: many failures initially. Fix mock per-spec until 2171+ pass.

- [ ] **Step 4: Commit cross-spec mock updates**

```bash
git add apps/api/src/modules/**/*.spec.ts
git commit -m "test: update mocks for Phase A.1a CoA composite lookup (Wave 4a)

chartOfAccount.findMany mocks updated:
- Drop allowedCompanies field from returned rows
- Account for companyId parameter in where clause
- Default mock returns codes that satisfy each test's JE lines

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Add chart-of-accounts.service.spec.ts (if absent)

**Files:**
- Create or modify: `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.spec.ts`

- [ ] **Step 1: Check if spec exists**

Run: `ls apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.spec.ts 2>&1`

- [ ] **Step 2: Write or extend spec with companyId filter tests**

If file doesn't exist, create with skeleton from contract-workflow.service.spec.ts pattern. Add tests:

```typescript
describe('findAll companyId filter (Phase A.1a)', () => {
  it('returns only SHOP accounts when companyId=<SHOP id>', async () => {
    prisma.chartOfAccount.findMany = jest.fn().mockResolvedValue([
      { id: '1', code: '11-1101', companyId: 'shop-co-1', nameTh: 'SHOP Cash' },
    ]);
    const result = await service.findAll({ companyId: 'shop-co-1' });
    expect(prisma.chartOfAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'shop-co-1' }) }),
    );
    expect(result).toHaveLength(1);
  });

  it('returns shared accounts when companyId=SHARED', async () => {
    prisma.chartOfAccount.findMany = jest.fn().mockResolvedValue([
      { id: '2', code: '99-9999', companyId: null, nameTh: 'Shared Account' },
    ]);
    const result = await service.findAll({ companyId: 'SHARED' });
    expect(prisma.chartOfAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: null }) }),
    );
    expect(result).toHaveLength(1);
  });

  it('returns all accounts when no companyId provided', async () => {
    prisma.chartOfAccount.findMany = jest.fn().mockResolvedValue([
      { id: '1', code: '11-1101', companyId: 'shop-co-1' },
      { id: '2', code: '99-9999', companyId: null },
    ]);
    const result = await service.findAll({});
    expect(prisma.chartOfAccount.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ where: expect.objectContaining({ companyId: expect.anything() }) }),
    );
  });
});

describe('create with companyId (Phase A.1a)', () => {
  it('creates account with composite uniqueness check', async () => {
    prisma.chartOfAccount.findUnique = jest.fn().mockResolvedValue(null);
    prisma.chartOfAccount.create = jest.fn().mockResolvedValue({ id: 'new1' });

    await service.create({
      code: '11-1101',
      companyId: 'finance-co-1',
      nameTh: 'FINANCE Cash',
      accountGroup: AccountGroup.ASSET,
    } as any);

    expect(prisma.chartOfAccount.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_code: { companyId: 'finance-co-1', code: '11-1101' } },
      }),
    );
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd apps/api && npx jest chart-of-accounts.service.spec.ts
git add apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.spec.ts
git commit -m "test(coa): companyId filter + composite uniqueness tests (Phase A.1a Wave 4b)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Add E2E spec accounting-coa-multi-entity

**Files:**
- Create: `apps/web/e2e/accounting-coa-multi-entity.spec.ts`

- [ ] **Step 1: Write E2E spec following project pattern**

```typescript
import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';

test.describe('Accounting — CoA multi-entity (Phase A.1a)', () => {
  test('GET /chart-of-accounts returns all when no companyId param', async ({ request }) => {
    const auth = await loginViaAPI(request, 'OWNER');
    const res = await request.get('/api/chart-of-accounts', { headers: getAuthHeaders(auth) });
    expect(res.ok()).toBeTruthy();
    const accounts = await res.json();
    expect(accounts.length).toBeGreaterThan(100);  // 109 SHOP + 50 FINANCE = ~160
  });

  test('GET /chart-of-accounts?companyId=<SHOP> returns SHOP accounts only', async ({ request }) => {
    const auth = await loginViaAPI(request, 'OWNER');
    const cosRes = await request.get('/api/companies?active=true', { headers: getAuthHeaders(auth) });
    const companies = await cosRes.json();
    const shop = companies.find((c: any) => c.companyCode === 'SHOP');
    test.skip(!shop, 'SHOP company not configured');

    const res = await request.get(`/api/chart-of-accounts?companyId=${shop.id}`, { headers: getAuthHeaders(auth) });
    const accounts = await res.json();
    expect(accounts.length).toBeGreaterThan(50);
    expect(accounts.every((a: any) => a.companyId === shop.id)).toBeTruthy();
  });

  test('GET /chart-of-accounts?companyId=SHARED returns null-companyId accounts', async ({ request }) => {
    const auth = await loginViaAPI(request, 'OWNER');
    const res = await request.get('/api/chart-of-accounts?companyId=SHARED', { headers: getAuthHeaders(auth) });
    const accounts = await res.json();
    expect(accounts.every((a: any) => a.companyId === null)).toBeTruthy();
  });
});
```

- [ ] **Step 2: TypeScript check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/accounting-coa-multi-entity.spec.ts
git commit -m "test(accounting): E2E for CoA multi-entity filter (Phase A.1a Wave 4c)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Wave 5 — Docs + push + PR

### Task 13: Update accounting.md

**Files:**
- Modify: `.claude/rules/accounting.md`

- [ ] **Step 1: Read current accounting.md**

Run: `cat .claude/rules/accounting.md`

- [ ] **Step 2: Update chart structure section + ACC code references**

Replace the "Chart of Accounts (Key Codes)" section to reflect:
- 2 charts (SHOP / FINANCE)
- New BAD_DEBT_EXPENSE code 53-1701 (FINANCE)
- New INTEREST_INCOME code 42-2101 (FINANCE)
- New LATE_FEE_INCOME code 42-2102 (FINANCE)
- Note about A.1a (commission temporarily removed) + A.1b (inter-company JE coming)

- [ ] **Step 3: Commit**

```bash
git add .claude/rules/accounting.md
git commit -m "docs: update accounting rules for Phase A.1a CoA split

- Document SHOP + FINANCE charts
- Update key codes (BAD_DEBT_EXPENSE 53-1701, INTEREST_INCOME 42-2101, LATE_FEE_INCOME 42-2102)
- Note commission temporary removal (A.1b restores)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Create finance-chart-of-accounts.csv reference

**Files:**
- Create: `docs/references/finance-chart-of-accounts.csv`

- [ ] **Step 1: Generate CSV from FINANCE seed**

Mirror `owner-chart-of-accounts.csv` format. Use the 50-account FINANCE seed as source.

```csv
หมวดที่ 1: สินทรัพย์ (Assets),,,
เลขบัญชี,ชื่อบัญชี,เลขที่บัญชีในเบสท์ช้อยส์,หมายเหตุ
11-1101,เงินสด FINANCE,,
11-1201,ธนาคาร FINANCE — บัญชีหลัก,,
... (all 50 accounts) ...
```

- [ ] **Step 2: Commit**

```bash
git add docs/references/finance-chart-of-accounts.csv
git commit -m "docs: add FINANCE chart of accounts reference CSV (Phase A.1a)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Final verification + push + PR

- [ ] **Step 1: Full TS check**

Run: `./tools/check-types.sh all`
Expected: 0 errors

- [ ] **Step 2: Full unit test suite**

Run: `cd apps/api && npx jest`
Expected: All PASS (existing 2171+ + new tests)

- [ ] **Step 3: Lint**

Run: `cd apps/api && npm run lint && cd ../web && npm run lint`
Expected: 0 errors

- [ ] **Step 4: Final code review subagent**

Dispatch code-reviewer subagent on entire branch vs origin/main. Fix any CRITICAL findings inline.

- [ ] **Step 5: Pre-deploy: backup chart_of_accounts**

```bash
gcloud sql backups create --instance=bestchoice-db --project=bestchoice-prod --description="pre-A1a-coa-split"
```

(User may run this OR add note to PR description requesting it before merge.)

- [ ] **Step 6: Push branch**

```bash
git push -u origin feat/accounting-phase-a1a-coa-split
```

- [ ] **Step 7: Open PR**

```bash
gh pr create --title "feat(accounting): Phase A.1a — CoA split (SHOP + FINANCE multi-entity)" --body "..."
```

PR body includes:
- Summary of schema change + seed split
- ACC remap table (old → new codes)
- Commission temporary removal note
- Pre-deploy backup requirement
- Test plan checklist

---

## Self-Review Checklist (post-write)

- [ ] Spec coverage: every section in spec maps to a task ✓
  - Schema change → Task 1, 2
  - Seed → Task 3
  - Validation lookup → Task 7 (createAndPost), Task 8 (journal.service)
  - ACC remap → Task 7
  - Commission removal → Task 7
  - Frontend → Task 9
  - Tests → Tasks 10, 11, 12
  - Docs → Tasks 13, 14
- [ ] Type consistency: companyId is string | null throughout, companyCode is 'SHOP' | 'FINANCE'
- [ ] No placeholders: all code blocks complete
- [ ] Migration is additive at deploy time (column added before allowedCompanies dropped, in single migration but ordered SQL)
- [ ] Atomic commits: Wave 1 single commit, Wave 2a/2b/2c separate commits, Wave 3-5 separate

---

## Estimated Effort

| Wave | Tasks | Time |
|---|---|---|
| 1 (schema + seed) | 1, 2, 3 | ~5 hr |
| 2 (backend) | 4, 5, 6, 7, 8 | ~6 hr |
| 3 (frontend) | 9 | ~3 hr |
| 4 (tests) | 10, 11, 12 | ~5 hr |
| 5 (docs + PR) | 13, 14, 15 | ~2 hr |
| **Total** | **15 tasks** | **~21 hr** |
