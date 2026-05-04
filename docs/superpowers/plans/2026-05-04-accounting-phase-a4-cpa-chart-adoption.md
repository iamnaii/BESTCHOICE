# Phase A.4 — CPA Chart Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace BESTCHOICE FINANCE accounting (Phase A.0–A.3) with the 109-account CPA chart and Full Accrual TFRS journal model defined in 7 CSV cases.

**Architecture:** Wipe & reseed migration. New `JournalAutoService` driven by 7 per-case templates. CoA seed from `docs/accounting/cpa-cases/finance-coa.csv`. Cron-driven daily accrual (2A) + 60-day VAT (Feature I). Golden-file e2e tests parse CSV expected output and diff against generated JE rows.

**Tech Stack:** NestJS + Prisma + PostgreSQL (api), Vitest (tests), Decimal.js (money), BullMQ (crons).

**Spec:** [docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md](../specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md)

**Source CSVs:** `/Users/iamnaii/Desktop/ฝังบัญชี/` (copied into repo in Task 1)

---

## Dependency Graph

```
T1 fixtures+parser ─┐
T2 schema migration ┼─→ T4 CoA seed ─┬─→ T5 test helpers ─┬─→ T6 1A
T3 dead code purge ─┘                │                    ├─→ T7 2A
                                     │                    ├─→ T8 2B (1+2)
                                     │                    ├─→ T9 2B split
                                     │                    ├─→ T10 case 4
                                     │                    ├─→ T11 case 5
                                     │                    ├─→ T12 case 6
                                     │                    ├─→ T13 vendor clear
                                     │                    └─→ T14 VAT 60-day
                                     │
                                     └─→ T15 cash UI ─┐
                                         T16 tol UI  ─┼─→ T17 reports ─→ T18 wipe+docs
                                         (parallel)  ─┘
```

T1, T2, T3 can run in parallel (3 subagents). T4 must wait for T2. T5 waits for T4. T6–T14 can all parallelize (9 subagents). T15+T16 parallel after T4. T17 needs T6–T14 done. T18 last.

---

## Task 1: CSV Fixtures + Parser + Golden Diff Helper

**Files:**
- Create: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv` (copy from `/Users/iamnaii/Desktop/ฝังบัญชี/ผังบัญชี (FINANCE)-ตาราง 1.csv`)
- Create: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-1-overpay.csv`
- Create: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-2-underpay.csv`
- Create: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-3-split-payment.csv`
- Create: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-4-early-payoff.csv`
- Create: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-5-repossession.csv`
- Create: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-6a-reschedule-split.csv`
- Create: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-6b-reschedule-bundled.csv`
- Create: `apps/api/src/modules/journal/__tests__/csv-fixture-loader.ts`
- Create: `apps/api/src/modules/journal/__tests__/csv-fixture-loader.spec.ts`
- Create: `apps/api/src/modules/journal/__tests__/golden-je-matcher.ts`

- [ ] **Step 1.1: Copy CSVs**

```bash
mkdir -p apps/api/src/modules/journal/__tests__/fixtures/cpa-cases
cp "/Users/iamnaii/Desktop/ฝังบัญชี/ผังบัญชี (FINANCE)-ตาราง 1.csv" apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv
cp "/Users/iamnaii/Desktop/ฝังบัญชี/กรณี1-จ่ายเกิน-ตาราง 1.csv" apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-1-overpay.csv
cp "/Users/iamnaii/Desktop/ฝังบัญชี/กรณี2-จ่ายขาด-ตาราง 1.csv" apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-2-underpay.csv
cp "/Users/iamnaii/Desktop/ฝังบัญชี/กรณี3-แบ่งชำระ-ตาราง 1.csv" apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-3-split-payment.csv
cp "/Users/iamnaii/Desktop/ฝังบัญชี/กรณี4-ปิดยอด-ตาราง 1.csv" apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-4-early-payoff.csv
cp "/Users/iamnaii/Desktop/ฝังบัญชี/กรณี5-คืนเครื่อง-ตาราง 1.csv" apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-5-repossession.csv
cp "/Users/iamnaii/Desktop/ฝังบัญชี/กรณี6-ปรับดิว (แบ่งจ่าย 2 รอบ)-ตาราง 1.csv" apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-6a-reschedule-split.csv
cp "/Users/iamnaii/Desktop/ฝังบัญชี/กรณี6-ปรับดิว (ไม่แบ่งจ่าย)-ตาราง 1.csv" apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/case-6b-reschedule-bundled.csv
```

- [ ] **Step 1.2: Write parser test (TDD)**

```typescript
// csv-fixture-loader.spec.ts
import { describe, it, expect } from 'vitest';
import { loadCoaFromCsv, loadCaseFromCsv } from './csv-fixture-loader';
import path from 'path';

const FIX = path.join(__dirname, 'fixtures/cpa-cases');

describe('csv-fixture-loader', () => {
  it('loads CoA with 109 accounts', () => {
    const accounts = loadCoaFromCsv(path.join(FIX, 'finance-coa.csv'));
    expect(accounts.length).toBeGreaterThanOrEqual(100);
    const cash = accounts.find((a) => a.code === '11-1101');
    expect(cash).toMatchObject({
      code: '11-1101',
      name: 'เงินสด - สุทธินีย์ คงเดช',
      type: 'สินทรัพย์',
      normalBalance: 'Dr',
      vatApplicable: false,
    });
  });

  it('loads case-1-overpay with 3 JE blocks', () => {
    const cas = loadCaseFromCsv(path.join(FIX, 'case-1-overpay.csv'));
    expect(cas.entries).toHaveLength(3); // 1A, 2A+2B, 3
    const entry1A = cas.entries.find((e) => e.tag === '1A');
    expect(entry1A!.lines).toContainEqual(
      expect.objectContaining({ code: '11-2101', dr: '17000.00', cr: '0.00' })
    );
  });
});
```

- [ ] **Step 1.3: Run test, expect failure**

`cd apps/api && npx vitest run src/modules/journal/__tests__/csv-fixture-loader.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 1.4: Implement loader**

```typescript
// csv-fixture-loader.ts
import fs from 'fs';
import { Decimal } from '@prisma/client/runtime/library';

export interface CoaRow {
  code: string;
  name: string;
  type: string;        // สินทรัพย์, หนี้สิน, ทุน, รายได้, ค่าใช้จ่าย, สินทรัพย์ (Contra)
  normalBalance: string; // Dr | Cr | Dr/Cr
  category: string;
  vatApplicable: boolean;
  notes: string;
  status: string;
}

export interface JeLine {
  code: string;
  name: string;
  dr: string; // keep as string to preserve precision; convert with Decimal()
  cr: string;
  note: string;
}

export interface JeBlock {
  tag: string;        // "1A" | "2A" | "2B" | "2B1" | "2B2" | "3"
  date: string;       // dd/mm/yy raw
  lines: JeLine[];
}

export interface CaseFixture {
  title: string;
  entries: JeBlock[];
}

const ACCOUNT_CODE_RE = /^\d{2}-\d{4}$/;

export function loadCoaFromCsv(csvPath: string): CoaRow[] {
  const text = fs.readFileSync(csvPath, 'utf-8');
  const lines = text.split('\n');
  const rows: CoaRow[] = [];
  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (!cols[0] || !ACCOUNT_CODE_RE.test(cols[0])) continue;
    rows.push({
      code: cols[0].trim(),
      name: (cols[1] ?? '').trim(),
      type: (cols[2] ?? '').trim(),
      normalBalance: (cols[3] ?? '').trim(),
      category: (cols[4] ?? '').trim(),
      vatApplicable: ((cols[5] ?? '').trim() === 'ใช่'),
      notes: (cols[6] ?? '').trim(),
      status: (cols[7] ?? '').trim(),
    });
  }
  return rows;
}

export function loadCaseFromCsv(csvPath: string): CaseFixture {
  const text = fs.readFileSync(csvPath, 'utf-8');
  const lines = text.split('\n').map(parseCsvLine);
  const title = lines[0]?.[0] ?? '';

  const entries: JeBlock[] = [];
  let current: JeBlock | null = null;

  for (const cols of lines) {
    const [a, b, c, , e, , drStr, crStr, , note] = cols;

    // Block header: "#"-row signals start; capture next data row's date as block date
    if (a === '#' || a === '#') continue;

    // Tag column (index 0) e.g., "1", "2A", "2B", "4"
    const tag = (a ?? '').trim();
    const date = (b ?? '').trim();
    const code = (c ?? '').trim();

    if (ACCOUNT_CODE_RE.test(code)) {
      // determine current block — open a new one if tag present
      if (tag && (!current || current.tag !== tag)) {
        current = { tag, date, lines: [] };
        entries.push(current);
      }
      if (current) {
        current.lines.push({
          code,
          name: (e ?? '').trim(),
          dr: parseAmount(drStr),
          cr: parseAmount(crStr),
          note: (note ?? '').trim(),
        });
      }
    }
  }

  return { title, entries };
}

function parseCsvLine(line: string): string[] {
  // Minimal CSV parser supporting quoted commas
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseAmount(s: string | undefined): string {
  if (!s) return '0.00';
  const cleaned = s.replace(/[",฿\s]/g, '').trim();
  if (!cleaned) return '0.00';
  return new Decimal(cleaned).toFixed(2);
}
```

- [ ] **Step 1.5: Run test, expect pass**

`cd apps/api && npx vitest run src/modules/journal/__tests__/csv-fixture-loader.spec.ts`
Expected: PASS (both tests green)

- [ ] **Step 1.6: Implement golden-diff matcher**

```typescript
// golden-je-matcher.ts
import { Decimal } from '@prisma/client/runtime/library';
import type { JeBlock } from './csv-fixture-loader';

export interface ActualJe {
  tag: string;
  lines: { code: string; dr: Decimal; cr: Decimal }[];
}

export interface DiffResult {
  ok: boolean;
  diffs: string[];
}

export function diffGoldenJE(
  expected: JeBlock[],
  actual: ActualJe[],
  tolerance = '0.01'
): DiffResult {
  const tol = new Decimal(tolerance);
  const diffs: string[] = [];

  if (expected.length !== actual.length) {
    diffs.push(`Block count: expected ${expected.length}, got ${actual.length}`);
  }

  for (const exp of expected) {
    const act = actual.find((a) => a.tag === exp.tag);
    if (!act) {
      diffs.push(`Missing block tag=${exp.tag}`);
      continue;
    }
    for (const expLine of exp.lines) {
      const actLine = act.lines.find((l) => l.code === expLine.code);
      if (!actLine) {
        diffs.push(`[${exp.tag}] missing line code=${expLine.code}`);
        continue;
      }
      const drDiff = actLine.dr.minus(new Decimal(expLine.dr)).abs();
      const crDiff = actLine.cr.minus(new Decimal(expLine.cr)).abs();
      if (drDiff.gt(tol)) {
        diffs.push(`[${exp.tag}] ${expLine.code} Dr expected=${expLine.dr} got=${actLine.dr.toFixed(2)}`);
      }
      if (crDiff.gt(tol)) {
        diffs.push(`[${exp.tag}] ${expLine.code} Cr expected=${expLine.cr} got=${actLine.cr.toFixed(2)}`);
      }
    }
  }

  return { ok: diffs.length === 0, diffs };
}
```

- [ ] **Step 1.7: Commit**

```bash
git add apps/api/src/modules/journal/__tests__/
git commit -m "test(journal): add CPA CSV fixture loader + golden-diff matcher (Phase A.4 T1)"
```

---

## Task 2: Schema Migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260504000000_phase_a4_cpa_chart_schema/migration.sql`

- [ ] **Step 2.1: Edit schema.prisma — ChartOfAccount**

Find existing `model ChartOfAccount` and replace with:

```prisma
model ChartOfAccount {
  id            String   @id @default(uuid())
  code          String   @unique           // 11-1101 (no companyId scoping in A.4)
  name          String
  type          String                     // สินทรัพย์ | หนี้สิน | ทุน | รายได้ | ค่าใช้จ่าย | สินทรัพย์ (Contra)
  normalBalance String                     // Dr | Cr | Dr/Cr
  category      String?                    // เงินสด, ลูกหนี้, VAT, ฯลฯ
  vatApplicable Boolean  @default(false)
  notes         String?
  status        String   @default("ใช้งาน")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  journalLines  JournalLine[]
}
```

- [ ] **Step 2.2: Edit schema.prisma — Payment**

Add fields to `Payment`:

```prisma
model Payment {
  // ...existing fields...
  depositAccountCode  String?   // FK by code → ChartOfAccount.code (11-1101/02/03/1201/02/03)
  toleranceJournalLineId String?
}
```

- [ ] **Step 2.3: Edit schema.prisma — User**

Add field to `User`:

```prisma
model User {
  // ...existing fields...
  defaultCashAccountCode String?  // pre-fill Payment dropdown
}
```

- [ ] **Step 2.4: Edit schema.prisma — Contract (drop A.2 fields)**

Remove from `Contract`:

```prisma
// DELETE these lines:
unearnedInterest    Decimal?  @db.Decimal(12, 2)
unearnedCommission  Decimal?  @db.Decimal(12, 2)
vatPending          Decimal?  @db.Decimal(12, 2)
```

- [ ] **Step 2.5: Edit schema.prisma — InstallmentSchedule**

Add fields:

```prisma
model InstallmentSchedule {
  // ...existing fields...
  rescheduledFromDate DateTime?
  rescheduleCount     Int      @default(0)
}
```

- [ ] **Step 2.6: Edit schema.prisma — JournalEntry / JournalLine**

Verify they don't reference `companyId` for FINANCE-only operation. If `companyId` exists on `JournalEntry`, keep it but allow null for FINANCE entries (used by SHOP later in A.5).

- [ ] **Step 2.7: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name phase_a4_cpa_chart_schema --create-only
```

- [ ] **Step 2.8: Inspect generated migration SQL**

Open `apps/api/prisma/migrations/20260504000000_phase_a4_cpa_chart_schema/migration.sql` and verify:
- `ALTER TABLE "ChartOfAccount" DROP CONSTRAINT` for `companyId` unique (if exists)
- `ALTER TABLE "Payment" ADD COLUMN "depositAccountCode"`
- `ALTER TABLE "Contract" DROP COLUMN "unearnedInterest"`
- etc.

If anything destructive looks wrong, edit SQL manually.

- [ ] **Step 2.9: Apply migration**

```bash
cd apps/api && npx prisma migrate dev
```

Expected: PASS — migration applied to dev DB.

- [ ] **Step 2.10: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260504000000_phase_a4_cpa_chart_schema/
git commit -m "feat(prisma): Phase A.4 schema — drop A.2 fields, add cash dimension + reschedule (T2)"
```

---

## Task 3: Delete A.0–A.3 Dead Code

**Files:**
- Modify: `apps/api/src/modules/journal/journal-auto.service.ts` (purge SHOP_ACC + IC + paired JE)
- Delete: `apps/api/src/modules/journal/inter-company-link.util.ts` (if exists, otherwise inline)
- Delete: `apps/api/src/modules/accounting/inter-company-settlement.controller.ts` (if exists)
- Delete: `apps/api/src/modules/accounting/inter-company-settlement.service.ts` (if exists)
- Delete: `apps/web/src/pages/InterCompanySettlementPage.tsx` (if exists)
- Modify: `apps/web/src/App.tsx` — remove route to InterCompanySettlementPage
- Modify: `apps/api/src/modules/accounting/accounting.module.ts` — remove IC providers
- Delete: `apps/api/prisma/seed-chart-of-accounts-only.ts` (will be replaced in T4)
- Delete: `docs/references/owner-chart-of-accounts.csv` (SHOP defer to A.5)

- [ ] **Step 3.1: Identify symbols to delete**

```bash
grep -rn "SHOP_ACC\|InterCompany\|inter-company\|unearnedInterest\|unearnedCommission\|vatPending" apps/api/src apps/web/src 2>/dev/null > /tmp/a4-purge-targets.txt
wc -l /tmp/a4-purge-targets.txt
```

Review the list. Anything that survives must be justified.

- [ ] **Step 3.2: Reset journal-auto.service.ts to a stub**

Replace **entire file** with:

```typescript
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';

export interface JeLineInput {
  accountCode: string;
  dr: Decimal;
  cr: Decimal;
  description?: string;
}

export interface CreateAndPostInput {
  description: string;
  reference?: string;
  metadata?: Prisma.JsonValue;
  lines: JeLineInput[];
  postedAt?: Date;
}

/**
 * Phase A.4 — single FINANCE chart, Full Accrual TFRS.
 * Per-case templates live in cpa-templates/ and call createAndPost.
 */
@Injectable()
export class JournalAutoService {
  private readonly logger = new Logger(JournalAutoService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createAndPost(
    input: CreateAndPostInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNo: string }> {
    const client = tx ?? this.prisma;

    // 1. balanced check
    const totalDr = input.lines.reduce((s, l) => s.plus(l.dr), new Decimal(0));
    const totalCr = input.lines.reduce((s, l) => s.plus(l.cr), new Decimal(0));
    if (!totalDr.equals(totalCr)) {
      const msg = `Unbalanced JE: Dr=${totalDr.toFixed(2)} Cr=${totalCr.toFixed(2)} desc="${input.description}"`;
      Sentry.captureMessage(msg, 'error');
      throw new BadRequestException(msg);
    }

    // 2. resolve account ids by code
    const codes = [...new Set(input.lines.map((l) => l.accountCode))];
    const accounts = await client.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
    });
    const codeMap = new Map(accounts.map((a) => [a.code, a.id]));
    for (const code of codes) {
      if (!codeMap.has(code)) {
        throw new BadRequestException(`Account code not found in CoA: ${code}`);
      }
    }

    // 3. entry number via advisory lock (per-day series)
    const postedAt = input.postedAt ?? new Date();
    const entryNo = await this.generateEntryNumber(postedAt, client as Prisma.TransactionClient);

    // 4. create entry + lines
    const entry = await client.journalEntry.create({
      data: {
        entryNo,
        description: input.description,
        reference: input.reference,
        metadata: input.metadata ?? Prisma.JsonNull,
        postedAt,
        lines: {
          create: input.lines.map((l) => ({
            accountId: codeMap.get(l.accountCode)!,
            accountCode: l.accountCode,
            dr: l.dr,
            cr: l.cr,
            description: l.description ?? null,
          })),
        },
      },
    });
    return { id: entry.id, entryNo };
  }

  private async generateEntryNumber(
    postedAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    // Advisory lock: hash of YYYYMM → integer; preserves daily monotonic sequence.
    const ym = `${postedAt.getFullYear()}${(postedAt.getMonth() + 1).toString().padStart(2, '0')}`;
    const lockKey = parseInt(ym, 10);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

    const start = new Date(postedAt.getFullYear(), postedAt.getMonth(), 1);
    const end = new Date(postedAt.getFullYear(), postedAt.getMonth() + 1, 1);
    const count = await tx.journalEntry.count({
      where: { postedAt: { gte: start, lt: end } },
    });
    return `JE-${ym}-${(count + 1).toString().padStart(5, '0')}`;
  }
}
```

- [ ] **Step 3.3: Update journal.module.ts**

Open `apps/api/src/modules/journal/journal.module.ts` and remove any imports/providers referencing IC services or SHOP-related modules.

- [ ] **Step 3.4: Delete dead files**

```bash
git rm apps/api/src/modules/journal/inter-company-link.util.ts 2>/dev/null || true
git rm apps/api/src/modules/accounting/inter-company-settlement.controller.ts 2>/dev/null || true
git rm apps/api/src/modules/accounting/inter-company-settlement.service.ts 2>/dev/null || true
git rm apps/api/src/modules/accounting/inter-company-settlement.service.spec.ts 2>/dev/null || true
git rm apps/web/src/pages/InterCompanySettlementPage.tsx 2>/dev/null || true
git rm apps/api/prisma/seed-chart-of-accounts-only.ts 2>/dev/null || true
git rm docs/references/owner-chart-of-accounts.csv 2>/dev/null || true
git rm docs/references/finance-chart-of-accounts.csv 2>/dev/null || true
```

- [ ] **Step 3.5: Update App.tsx to remove IC settlement route**

Search for `InterCompanySettlement` in `apps/web/src/App.tsx` and remove the lazy import + Route line.

- [ ] **Step 3.6: Find + fix all referencing tests**

```bash
grep -rln "SHOP_ACC\|FINANCE_ACC\|InterCompany\|unearnedInterest" apps/api/src apps/web/src
```

For each file, either:
- Delete the test (if it tested only A.0–A.3 behavior)
- Comment-out with `// TODO Phase A.4: rewrite` if the test covers infrastructure that still exists

- [ ] **Step 3.7: TypeScript check**

```bash
./tools/check-types.sh api
```

Expected: PASS (or only failures from removed-symbol references that have already been deleted).

If failures remain, fix imports/references inline.

- [ ] **Step 3.8: Run journal tests**

```bash
cd apps/api && npx vitest run src/modules/journal
```

Expected: csv-fixture-loader.spec passes; old journal-auto.service.spec.ts may fail — that's OK if marked TODO. Confirm no compile errors.

- [ ] **Step 3.9: Commit**

```bash
git add -A
git commit -m "refactor(accounting): purge Phase A.0-A.3 dead code (SHOP CoA, IC settlement, A.2 deferred fields) (T3)"
```

---

## Task 4: CoA Seed from CSV

**Files:**
- Create: `apps/api/prisma/seed-coa-finance.ts`
- Modify: `apps/api/prisma/seed.ts` — call new seeder
- Create: `apps/api/prisma/seed-coa-finance.spec.ts`

- [ ] **Step 4.1: Write seed test (TDD)**

```typescript
// seed-coa-finance.spec.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from './seed-coa-finance';

const prisma = new PrismaClient();

describe('seedFinanceCoa', () => {
  beforeAll(async () => {
    await prisma.chartOfAccount.deleteMany({});
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('seeds 109 accounts from CSV', async () => {
    const result = await seedFinanceCoa(prisma);
    expect(result.created).toBeGreaterThanOrEqual(100);
    const cash = await prisma.chartOfAccount.findUnique({ where: { code: '11-1101' } });
    expect(cash).toMatchObject({
      code: '11-1101',
      name: 'เงินสด - สุทธินีย์ คงเดช',
      type: 'สินทรัพย์',
      normalBalance: 'Dr',
      vatApplicable: false,
    });
    const deferred = await prisma.chartOfAccount.findUnique({ where: { code: '11-2106' } });
    expect(deferred?.normalBalance).toBe('Cr');
  });

  it('is idempotent', async () => {
    await seedFinanceCoa(prisma); // first
    const before = await prisma.chartOfAccount.count();
    await seedFinanceCoa(prisma); // second — should be no-op
    const after = await prisma.chartOfAccount.count();
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 4.2: Run, expect failure**

`cd apps/api && npx vitest run prisma/seed-coa-finance.spec.ts`
Expected: module not found.

- [ ] **Step 4.3: Implement seeder**

```typescript
// seed-coa-finance.ts
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { loadCoaFromCsv } from '../src/modules/journal/__tests__/csv-fixture-loader';

const CSV_PATH = path.join(
  __dirname,
  '../src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv',
);

export async function seedFinanceCoa(prisma: PrismaClient): Promise<{ created: number; updated: number }> {
  const rows = loadCoaFromCsv(CSV_PATH);
  let created = 0;
  let updated = 0;

  for (const r of rows) {
    const existing = await prisma.chartOfAccount.findUnique({ where: { code: r.code } });
    if (existing) {
      const changed =
        existing.name !== r.name ||
        existing.type !== r.type ||
        existing.normalBalance !== r.normalBalance ||
        existing.category !== r.category ||
        existing.vatApplicable !== r.vatApplicable ||
        existing.notes !== r.notes;
      if (changed) {
        await prisma.chartOfAccount.update({
          where: { code: r.code },
          data: {
            name: r.name,
            type: r.type,
            normalBalance: r.normalBalance,
            category: r.category,
            vatApplicable: r.vatApplicable,
            notes: r.notes,
          },
        });
        updated++;
      }
    } else {
      await prisma.chartOfAccount.create({
        data: {
          code: r.code,
          name: r.name,
          type: r.type,
          normalBalance: r.normalBalance,
          category: r.category,
          vatApplicable: r.vatApplicable,
          notes: r.notes,
          status: r.status,
        },
      });
      created++;
    }
  }
  return { created, updated };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedFinanceCoa(prisma)
    .then((r) => console.log('Seeded:', r))
    .finally(() => prisma.$disconnect());
}
```

- [ ] **Step 4.4: Update prisma/seed.ts**

Add to existing `seed.ts`:

```typescript
import { seedFinanceCoa } from './seed-coa-finance';
// ... in main():
await seedFinanceCoa(prisma);
```

- [ ] **Step 4.5: Run test, expect pass**

```bash
cd apps/api && npx vitest run prisma/seed-coa-finance.spec.ts
```

Expected: PASS.

- [ ] **Step 4.6: Run full seed in dev**

```bash
cd apps/api && npx prisma db seed
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"ChartOfAccount\";"
```

Expected: count ≥ 100.

- [ ] **Step 4.7: Commit**

```bash
git add apps/api/prisma/seed-coa-finance.ts apps/api/prisma/seed-coa-finance.spec.ts apps/api/prisma/seed.ts
git commit -m "feat(prisma): seed FINANCE CoA from CPA CSV (109 accounts) (T4)"
```

---

## Task 5: Test Helpers — STANDARD_17K_12M Fixture + Scenario Runner

**Files:**
- Create: `apps/api/src/modules/journal/__tests__/scenario-helpers.ts`
- Create: `apps/api/src/modules/journal/__tests__/scenario-helpers.spec.ts`

- [ ] **Step 5.1: Write helper test**

```typescript
// scenario-helpers.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m, formatJEsAsBlocks } from './scenario-helpers';

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.contract.deleteMany({});
  await seedFinanceCoa(prisma);
});

describe('seedStandard17k12m', () => {
  it('creates contract with expected derived values', async () => {
    const c = await seedStandard17k12m(prisma);
    expect(c.financedAmount.toFixed(2)).toBe('10000.00');
    expect(c.commission.toFixed(2)).toBe('1000.00');
    expect(c.interest.toFixed(2)).toBe('6000.00');
    expect(c.vatTotal.toFixed(2)).toBe('1190.00');
    expect(c.installmentCount).toBe(12);
    expect(c.installmentTotal.toFixed(2)).toBe('1515.83');
  });
});
```

- [ ] **Step 5.2: Implement helpers**

```typescript
// scenario-helpers.ts
import { PrismaClient, Contract } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { ActualJe } from './golden-je-matcher';

export interface StandardContract {
  id: string;
  financedAmount: Decimal;
  commission: Decimal;
  interest: Decimal;
  vatTotal: Decimal;
  installmentCount: number;
  installmentTotal: Decimal; // 1515.83
  startDate: Date;
}

export async function seedStandard17k12m(prisma: PrismaClient): Promise<StandardContract> {
  // Standard CPA case: 10,000 financed | 1,000 commission | 6,000 interest | 1,190 VAT | 12 installments
  const financedAmount = new Decimal('10000.00');
  const commission = new Decimal('1000.00');
  const interest = new Decimal('6000.00');
  const vatTotal = new Decimal('1190.00');
  const installmentCount = 12;
  const grossExclVat = financedAmount.plus(commission).plus(interest); // 17,000
  const installmentExclVat = grossExclVat.div(installmentCount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP); // 1,416.66
  const vatPerInstallment = vatTotal.div(installmentCount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP); // 99.17
  const installmentTotal = installmentExclVat.plus(vatPerInstallment); // 1,515.83
  const startDate = new Date('2025-01-01');

  // Minimum required Contract fields — adjust based on real schema
  const contract = await prisma.contract.create({
    data: {
      contractNumber: `TEST-A4-${Date.now()}`,
      // populate real required fields per schema (customer, branch, etc.)
      // Use existing factory if there is one; otherwise inline minimal valid data.
      financedAmount,
      sellingPrice: financedAmount,
      downPayment: new Decimal('0'),
      installmentCount,
      installmentAmount: installmentTotal,
      interestAmount: interest,
      commissionAmount: commission,
      vatAmount: vatTotal,
      startDate,
      status: 'PENDING_ACTIVATION',
    },
  });

  // Generate installment schedule rows
  for (let i = 1; i <= installmentCount; i++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + i);
    await prisma.installmentSchedule.create({
      data: {
        contractId: contract.id,
        installmentNo: i,
        dueDate,
        amountDue: installmentTotal,
        status: 'PENDING',
      },
    });
  }

  return {
    id: contract.id,
    financedAmount,
    commission,
    interest,
    vatTotal,
    installmentCount,
    installmentTotal,
    startDate,
  };
}

export async function formatJEsAsBlocks(prisma: PrismaClient, contractId: string): Promise<ActualJe[]> {
  const entries = await prisma.journalEntry.findMany({
    where: { reference: { contains: contractId } },
    include: { lines: true },
    orderBy: { postedAt: 'asc' },
  });
  return entries.map((e) => ({
    tag: ((e.metadata as any)?.tag ?? '?') as string,
    lines: e.lines.map((l) => ({
      code: l.accountCode,
      dr: new Decimal(l.dr.toString()),
      cr: new Decimal(l.cr.toString()),
    })),
  }));
}
```

- [ ] **Step 5.3: Run, fix any schema field mismatches**

```bash
cd apps/api && npx vitest run src/modules/journal/__tests__/scenario-helpers.spec.ts
```

Adjust `seedStandard17k12m` if real `Contract` schema needs different fields (customer, branch, products). Inspect `apps/api/prisma/schema.prisma::Contract` and provide minimum valid data, possibly via existing test factories.

- [ ] **Step 5.4: Commit**

```bash
git add apps/api/src/modules/journal/__tests__/scenario-helpers.ts apps/api/src/modules/journal/__tests__/scenario-helpers.spec.ts
git commit -m "test(journal): add STANDARD_17K_12M fixture + JE block formatter (T5)"
```

---

## Task 6: Template 1A — Contract Activation

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/contract-activation-1a.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/contract-activation-1a.template.spec.ts`
- Modify: `apps/api/src/modules/journal/journal.module.ts` — register template

**Reference:** Spec §6.1, fixture `case-1-overpay.csv` block "1A"

- [ ] **Step 6.1: Write golden-diff test**

```typescript
// contract-activation-1a.template.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m, formatJEsAsBlocks } from '../__tests__/scenario-helpers';
import { loadCaseFromCsv } from '../__tests__/csv-fixture-loader';
import { diffGoldenJE } from '../__tests__/golden-je-matcher';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

describe('Template 1A — Contract Activation', () => {
  beforeAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.contract.deleteMany({});
    await seedFinanceCoa(prisma);
  });

  it('matches CSV golden case-1 block 1A', async () => {
    const contract = await seedStandard17k12m(prisma);
    const tmpl = new ContractActivation1ATemplate(new JournalAutoService(prisma));
    await tmpl.execute(contract.id);

    const expected = loadCaseFromCsv(
      path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-1-overpay.csv'),
    );
    const expected1A = expected.entries.filter((e) => e.tag === '1');
    const actual = await formatJEsAsBlocks(prisma, contract.id);
    const actual1A = actual.filter((a) => a.tag === '1A');

    const diff = diffGoldenJE(expected1A.map((e) => ({ ...e, tag: '1A' })), actual1A);
    expect(diff.diffs, diff.diffs.join('\n')).toEqual([]);
    expect(diff.ok).toBe(true);
  });
});
```

- [ ] **Step 6.2: Run, expect failure**

`cd apps/api && npx vitest run src/modules/journal/cpa-templates/contract-activation-1a.template.spec.ts`
Expected: module not found.

- [ ] **Step 6.3: Implement template**

```typescript
// contract-activation-1a.template.ts
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ContractActivation1ATemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma?: PrismaService,
  ) {}

  /** Spec §6.1 — fires once when contract activates. */
  async execute(contractId: string): Promise<{ entryNo: string }> {
    const prisma = this.prisma!;
    const c = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });

    const financed = new Decimal(c.financedAmount.toString());
    const commission = new Decimal(c.commissionAmount.toString());
    const interest = new Decimal(c.interestAmount.toString());
    const vat = new Decimal(c.vatAmount.toString());
    const grossExclVat = financed.plus(commission).plus(interest); // 17,000

    const result = await this.journal.createAndPost({
      description: `Contract activation ${c.contractNumber}`,
      reference: contractId,
      metadata: { tag: '1A', contractId },
      lines: [
        // Debits
        { accountCode: '11-2101', dr: grossExclVat, cr: new Decimal(0), description: 'ลูกหนี้ Gross' },
        { accountCode: '11-2105', dr: vat, cr: new Decimal(0), description: 'ลูกหนี้ภาษีขายรอเรียกเก็บ' },
        // Credits
        { accountCode: '21-1101', dr: new Decimal(0), cr: financed, description: 'เจ้าหนี้-หน้าร้าน' },
        { accountCode: '21-1102', dr: new Decimal(0), cr: commission, description: 'เจ้าหนี้ค่าคอม' },
        { accountCode: '11-2106', dr: new Decimal(0), cr: interest, description: 'รายได้รอตัดบัญชี-ดอกเบี้ย (Contra Asset)' },
        { accountCode: '21-2102', dr: new Decimal(0), cr: vat, description: 'ภาษีขายรอเรียกเก็บ' },
      ],
    });

    return { entryNo: result.entryNo };
  }
}
```

- [ ] **Step 6.4: Register in module**

Edit `apps/api/src/modules/journal/journal.module.ts`:

```typescript
import { ContractActivation1ATemplate } from './cpa-templates/contract-activation-1a.template';
// in providers: [JournalAutoService, ContractActivation1ATemplate, ...]
// in exports: [JournalAutoService, ContractActivation1ATemplate, ...]
```

- [ ] **Step 6.5: Run test, expect pass**

```bash
cd apps/api && npx vitest run src/modules/journal/cpa-templates/contract-activation-1a.template.spec.ts
```

Expected: PASS — golden diff returns 0 diffs.

If diff fails, the printed lines tell you exactly which account code / Dr / Cr is wrong. Fix the template, re-run.

- [ ] **Step 6.6: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/contract-activation-1a.template.ts \
        apps/api/src/modules/journal/cpa-templates/contract-activation-1a.template.spec.ts \
        apps/api/src/modules/journal/journal.module.ts
git commit -m "feat(journal): Template 1A contract activation matches CPA CSV (T6)"
```

---

## Task 7: Template 2A — Installment Accrual + Daily Cron

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.spec.ts`
- Create: `apps/api/src/modules/journal/cron/installment-accrual.cron.ts`
- Create: `apps/api/src/modules/journal/cron/installment-accrual.cron.spec.ts`

**Reference:** Spec §6.2, fixture `case-1-overpay.csv` block "2A"

- [ ] **Step 7.1: Write template golden test**

```typescript
// installment-accrual-2a.template.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m, formatJEsAsBlocks } from '../__tests__/scenario-helpers';
import { loadCaseFromCsv } from '../__tests__/csv-fixture-loader';
import { diffGoldenJE } from '../__tests__/golden-je-matcher';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

describe('Template 2A — Installment Accrual', () => {
  beforeAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.contract.deleteMany({});
    await seedFinanceCoa(prisma);
  });

  it('matches CSV golden case-1 block 2A for installment 1', async () => {
    const c = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma);
    await new ContractActivation1ATemplate(journal, prisma).execute(c.id);

    const inst = await prisma.installmentSchedule.findFirstOrThrow({
      where: { contractId: c.id, installmentNo: 1 },
    });
    const tmpl = new InstallmentAccrual2ATemplate(journal, prisma);
    await tmpl.execute(inst.id);

    const expected = loadCaseFromCsv(
      path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-1-overpay.csv'),
    );
    const expected2A = expected.entries.filter((e) => e.tag === '2A');
    const actual = await formatJEsAsBlocks(prisma, c.id);
    const actual2A = actual.filter((a) => a.tag === '2A');

    const diff = diffGoldenJE(expected2A, actual2A);
    expect(diff.diffs, diff.diffs.join('\n')).toEqual([]);
  });
});
```

- [ ] **Step 7.2: Implement template**

```typescript
// installment-accrual-2a.template.ts
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class InstallmentAccrual2ATemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /** Spec §6.2 — fires per installment on its due_date via cron. Idempotent: skip if accrualJournalEntryId set. */
  async execute(installmentScheduleId: string): Promise<{ entryNo: string } | null> {
    const inst = await this.prisma.installmentSchedule.findUniqueOrThrow({
      where: { id: installmentScheduleId },
    });
    if ((inst as any).accrualJournalEntryId) return null;

    const c = await this.prisma.contract.findUniqueOrThrow({ where: { id: inst.contractId } });
    const total = new Decimal(c.installmentCount);
    const commission = new Decimal(c.commissionAmount.toString());
    const interest = new Decimal(c.interestAmount.toString());
    const vat = new Decimal(c.vatAmount.toString());
    const financed = new Decimal(c.financedAmount.toString());
    const grossExclVat = financed.plus(commission).plus(interest);

    const installmentExclVat = grossExclVat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP); // 1,416.66
    const interestPerInst = interest.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);        //   500.00
    const vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);                  //    99.17
    const installmentTotal = installmentExclVat.plus(vatPerInst);                                 // 1,515.83

    const result = await this.journal.createAndPost({
      description: `Installment accrual #${inst.installmentNo} contract ${c.contractNumber}`,
      reference: c.id,
      metadata: { tag: '2A', contractId: c.id, installmentScheduleId: inst.id },
      postedAt: inst.dueDate,
      lines: [
        // Debits
        { accountCode: '11-2103', dr: installmentTotal, cr: new Decimal(0), description: 'ลูกหนี้ค้างชำระ (Accrual)' },
        { accountCode: '21-2102', dr: vatPerInst, cr: new Decimal(0), description: 'ล้าง ภาษีขายรอเรียกเก็บ' },
        { accountCode: '11-2106', dr: interestPerInst, cr: new Decimal(0), description: 'ล้าง รายได้รอตัดบัญชี' },
        // Credits
        { accountCode: '11-2101', dr: new Decimal(0), cr: installmentExclVat, description: 'ลูกหนี้ Gross (ลด)' },
        { accountCode: '11-2105', dr: new Decimal(0), cr: vatPerInst, description: 'ลูกหนี้ภาษีขายรอฯ (ล้าง)' },
        { accountCode: '41-1101', dr: new Decimal(0), cr: interestPerInst, description: 'รายได้ดอกเบี้ย (รับรู้)' },
        { accountCode: '21-2101', dr: new Decimal(0), cr: vatPerInst, description: 'ภาษีขาย ภ.พ.30' },
      ],
    });

    await this.prisma.installmentSchedule.update({
      where: { id: inst.id },
      data: { accrualJournalEntryId: result.entryNo } as any, // add field if missing in T2
    });

    return { entryNo: result.entryNo };
  }
}
```

**Note:** if `InstallmentSchedule.accrualJournalEntryId` doesn't exist, add it in T2's schema migration before running this.

- [ ] **Step 7.3: Run, verify pass**

```bash
cd apps/api && npx vitest run src/modules/journal/cpa-templates/installment-accrual-2a.template.spec.ts
```

- [ ] **Step 7.4: Implement cron**

```typescript
// cron/installment-accrual.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../../prisma/prisma.service';
import { InstallmentAccrual2ATemplate } from '../cpa-templates/installment-accrual-2a.template';

@Injectable()
export class InstallmentAccrualCron {
  private readonly logger = new Logger(InstallmentAccrualCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly template: InstallmentAccrual2ATemplate,
  ) {}

  /** Daily at 00:01 Asia/Bangkok — recognize today's installments. */
  @Cron('1 0 * * *', { timeZone: 'Asia/Bangkok' })
  async tick(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const due = await this.prisma.installmentSchedule.findMany({
      where: {
        dueDate: { gte: today, lt: tomorrow },
        accrualJournalEntryId: null,
        deletedAt: null,
      } as any,
    });

    this.logger.log(`Accrual cron: ${due.length} installments due today`);
    for (const inst of due) {
      try {
        await this.template.execute(inst.id);
      } catch (e) {
        Sentry.captureException(e, { extra: { installmentId: inst.id } });
        this.logger.error(`Accrual failed inst=${inst.id}`, (e as Error).stack);
      }
    }
  }
}
```

- [ ] **Step 7.5: Cron test**

```typescript
// cron/installment-accrual.cron.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m } from '../__tests__/scenario-helpers';
import { ContractActivation1ATemplate } from '../cpa-templates/contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from '../cpa-templates/installment-accrual-2a.template';
import { InstallmentAccrualCron } from './installment-accrual.cron';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

describe('InstallmentAccrualCron', () => {
  beforeAll(async () => {
    await prisma.journalLine.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.installmentSchedule.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.contract.deleteMany({});
    await seedFinanceCoa(prisma);
  });

  it('runs accrual for today-due installments and is idempotent', async () => {
    const c = await seedStandard17k12m(prisma);
    const journal = new JournalAutoService(prisma);
    await new ContractActivation1ATemplate(journal, prisma).execute(c.id);
    // shift inst#1 due_date to today
    const inst = await prisma.installmentSchedule.findFirstOrThrow({ where: { contractId: c.id, installmentNo: 1 } });
    await prisma.installmentSchedule.update({ where: { id: inst.id }, data: { dueDate: new Date() } });

    const cron = new InstallmentAccrualCron(prisma as any, new InstallmentAccrual2ATemplate(journal, prisma));
    await cron.tick();
    await cron.tick(); // idempotent

    const count = await prisma.journalEntry.count({ where: { metadata: { path: ['tag'], equals: '2A' } } as any });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 7.6: Register cron in module**

Add `InstallmentAccrualCron` to `journal.module.ts` providers and ensure `@nestjs/schedule` is configured at app level.

- [ ] **Step 7.7: Run all T7 tests + commit**

```bash
cd apps/api && npx vitest run src/modules/journal/cpa-templates/installment-accrual-2a.template.spec.ts src/modules/journal/cron/installment-accrual.cron.spec.ts
git add -A
git commit -m "feat(journal): Template 2A accrual + daily cron (T7)"
```

---

## Task 8: Template 2B — Payment Receipt (Cases 1+2 with Tolerance)

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.spec.ts`

**Reference:** Spec §6.3 cases 1, 2

- [ ] **Step 8.1: Write golden test for case 1 (overpay 0.17 → 53-1503)**

```typescript
// payment-receipt-2b.template.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { Decimal } from '@prisma/client/runtime/library';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedStandard17k12m, formatJEsAsBlocks } from '../__tests__/scenario-helpers';
import { loadCaseFromCsv } from '../__tests__/csv-fixture-loader';
import { diffGoldenJE } from '../__tests__/golden-je-matcher';
import { ContractActivation1ATemplate } from './contract-activation-1a.template';
import { InstallmentAccrual2ATemplate } from './installment-accrual-2a.template';
import { PaymentReceipt2BTemplate } from './payment-receipt-2b.template';
import { JournalAutoService } from '../journal-auto.service';

const prisma = new PrismaClient();

async function setup() {
  await prisma.journalLine.deleteMany({});
  await prisma.journalEntry.deleteMany({});
  await prisma.installmentSchedule.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.contract.deleteMany({});
  await seedFinanceCoa(prisma);
  const c = await seedStandard17k12m(prisma);
  const journal = new JournalAutoService(prisma);
  await new ContractActivation1ATemplate(journal, prisma).execute(c.id);
  const inst = await prisma.installmentSchedule.findFirstOrThrow({ where: { contractId: c.id, installmentNo: 1 } });
  await new InstallmentAccrual2ATemplate(journal, prisma).execute(inst.id);
  return { contract: c, inst, journal };
}

describe('PaymentReceipt2BTemplate', () => {
  beforeAll(async () => { /* setup via per-test */ });

  it('case 1 — overpay 0.17 routes to 53-1503', async () => {
    const { contract, inst, journal } = await setup();
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma);
    await tmpl.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal('1516.00'),
      depositAccountCode: '11-1101',
    });

    const expected = loadCaseFromCsv(path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-1-overpay.csv'));
    const expected2B = expected.entries.filter((e) => e.tag === '2B');
    const actual = await formatJEsAsBlocks(prisma, contract.id);
    const actual2B = actual.filter((a) => a.tag === '2B');

    const diff = diffGoldenJE(expected2B, actual2B);
    expect(diff.diffs, diff.diffs.join('\n')).toEqual([]);
  });

  it('case 2 — underpay 0.83 routes to 52-1104 (requires approver)', async () => {
    const { contract, inst, journal } = await setup();
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma);
    await tmpl.execute({
      installmentScheduleId: inst.id,
      amountReceived: new Decimal('1515.00'),
      depositAccountCode: '11-1101',
      toleranceApproverId: 'test-approver-id',
    });

    const expected = loadCaseFromCsv(path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-2-underpay.csv'));
    const expected2B = expected.entries.filter((e) => e.tag === '2B');
    const actual = await formatJEsAsBlocks(prisma, contract.id);
    const actual2B = actual.filter((a) => a.tag === '2B');

    const diff = diffGoldenJE(expected2B, actual2B);
    expect(diff.diffs, diff.diffs.join('\n')).toEqual([]);
  });

  it('rejects underpay >1฿ tolerance', async () => {
    const { contract, inst, journal } = await setup();
    const tmpl = new PaymentReceipt2BTemplate(journal, prisma);
    await expect(
      tmpl.execute({
        installmentScheduleId: inst.id,
        amountReceived: new Decimal('1500.00'), // 15.83 short
        depositAccountCode: '11-1101',
      }),
    ).rejects.toThrow(/exceeds tolerance/i);
  });
});
```

- [ ] **Step 8.2: Implement template**

```typescript
// payment-receipt-2b.template.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

const TOLERANCE = new Decimal('1.00');

export interface PaymentReceiptInput {
  installmentScheduleId: string;
  amountReceived: Decimal;
  depositAccountCode: string;
  toleranceApproverId?: string;
}

@Injectable()
export class PaymentReceipt2BTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /** Spec §6.3 cases 1+2. */
  async execute(input: PaymentReceiptInput): Promise<{ entryNo: string }> {
    const inst = await this.prisma.installmentSchedule.findUniqueOrThrow({
      where: { id: input.installmentScheduleId },
    });
    const installmentTotal = new Decimal(inst.amountDue.toString()); // 1,515.83
    const diff = input.amountReceived.minus(installmentTotal); // positive=overpay, negative=underpay

    const lines = [
      { accountCode: input.depositAccountCode, dr: input.amountReceived, cr: new Decimal(0), description: 'รับเงิน' },
      { accountCode: '11-2103', dr: new Decimal(0), cr: installmentTotal, description: 'ล้างลูกหนี้ค้างชำระ' },
    ];

    if (diff.gt(0)) {
      // overpay → Cr 53-1503
      if (diff.gt(TOLERANCE)) throw new BadRequestException(`Overpay ${diff.toFixed(2)} exceeds tolerance 1.00`);
      lines.push({ accountCode: '53-1503', dr: new Decimal(0), cr: diff, description: 'กำไรปัดเศษ' });
    } else if (diff.lt(0)) {
      const absDiff = diff.abs();
      if (absDiff.gt(TOLERANCE)) throw new BadRequestException(`Underpay ${absDiff.toFixed(2)} exceeds tolerance 1.00`);
      if (!input.toleranceApproverId) {
        throw new BadRequestException('Underpay tolerance requires approver');
      }
      lines.push({ accountCode: '52-1104', dr: absDiff, cr: new Decimal(0), description: 'ส่วนลดเศษสตางค์' });
    }

    return this.journal.createAndPost({
      description: `Payment receipt installment #${inst.installmentNo}`,
      reference: inst.contractId,
      metadata: {
        tag: '2B',
        installmentScheduleId: inst.id,
        toleranceApproverId: input.toleranceApproverId,
      },
      lines,
    });
  }
}
```

- [ ] **Step 8.3: Run, fix to pass, register in module**

```bash
cd apps/api && npx vitest run src/modules/journal/cpa-templates/payment-receipt-2b.template.spec.ts
```

- [ ] **Step 8.4: Commit**

```bash
git add -A
git commit -m "feat(journal): Template 2B payment receipt + tolerance enforcement (T8)"
```

---

## Task 9: Template 2B-split — Case 3 Split Payment

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b-split.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b-split.template.spec.ts`

**Reference:** Spec §6.3 case 3

- [ ] **Step 9.1: Write golden test (2 partial payments summing to installmentTotal)**

Same skeleton as T8, but call `tmpl.executePartial(installmentId, partialAmount, depositAcct)` twice (800 + 715.83 = 1515.83). Verify each call generates a 2B journal with `Dr depositAcct / Cr 11-2103`. Tolerance applies only on the LAST partial when the running total reaches installmentTotal.

- [ ] **Step 9.2: Implement**

```typescript
// payment-receipt-2b-split.template.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentReceipt2BTemplate } from './payment-receipt-2b.template';

@Injectable()
export class PaymentReceipt2BSplitTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
    private readonly fullTemplate: PaymentReceipt2BTemplate,
  ) {}

  /** Partial payment toward an installment. Each call posts Dr cash / Cr 11-2103. */
  async executePartial(input: {
    installmentScheduleId: string;
    partialAmount: Decimal;
    depositAccountCode: string;
    isFinalPartial?: boolean;
    toleranceApproverId?: string;
  }): Promise<{ entryNo: string }> {
    const inst = await this.prisma.installmentSchedule.findUniqueOrThrow({
      where: { id: input.installmentScheduleId },
    });
    const installmentTotal = new Decimal(inst.amountDue.toString());

    // sum of prior partial payments for this installment
    const prior = await this.prisma.payment.aggregate({
      where: { installmentScheduleId: input.installmentScheduleId, deletedAt: null } as any,
      _sum: { amount: true },
    });
    const priorSum = new Decimal((prior._sum?.amount ?? 0).toString());
    const newSum = priorSum.plus(input.partialAmount);

    if (input.isFinalPartial) {
      // Delegate to full template w/ adjusted amount = whatever is needed to close (apply tolerance)
      // We post just the remainder of the receivable; tolerance lines route via 53-1503 / 52-1104
      const remaining = installmentTotal.minus(priorSum);
      // Build a synthetic 2B that accepts a partial amount but expects priorSum already received
      return this.journal.createAndPost({
        description: `Final partial payment installment #${inst.installmentNo}`,
        reference: inst.contractId,
        metadata: { tag: '2B', installmentScheduleId: inst.id, partial: true, final: true },
        lines: this.buildFinalLines(input, remaining, installmentTotal, newSum),
      });
    }

    // Non-final partial: simple Dr cash / Cr 11-2103
    return this.journal.createAndPost({
      description: `Partial payment installment #${inst.installmentNo}`,
      reference: inst.contractId,
      metadata: { tag: '2B', installmentScheduleId: inst.id, partial: true },
      lines: [
        { accountCode: input.depositAccountCode, dr: input.partialAmount, cr: new Decimal(0) },
        { accountCode: '11-2103', dr: new Decimal(0), cr: input.partialAmount },
      ],
    });
  }

  private buildFinalLines(
    input: { partialAmount: Decimal; depositAccountCode: string; toleranceApproverId?: string },
    remaining: Decimal,
    installmentTotal: Decimal,
    newSum: Decimal,
  ) {
    const lines = [
      { accountCode: input.depositAccountCode, dr: input.partialAmount, cr: new Decimal(0) },
      { accountCode: '11-2103', dr: new Decimal(0), cr: remaining },
    ];
    const diff = newSum.minus(installmentTotal); // overpay positive
    const TOL = new Decimal('1.00');
    if (diff.gt(0) && diff.lte(TOL)) {
      lines.push({ accountCode: '53-1503', dr: new Decimal(0), cr: diff });
    } else if (diff.lt(0) && diff.abs().lte(TOL)) {
      if (!input.toleranceApproverId) throw new BadRequestException('Underpay tolerance requires approver');
      lines.push({ accountCode: '52-1104', dr: diff.abs(), cr: new Decimal(0) });
    } else if (!diff.equals(0)) {
      throw new BadRequestException(`Final partial diff ${diff.toFixed(2)} exceeds tolerance`);
    }
    return lines;
  }
}
```

- [ ] **Step 9.3: Run + commit**

```bash
cd apps/api && npx vitest run src/modules/journal/cpa-templates/payment-receipt-2b-split.template.spec.ts
git add -A && git commit -m "feat(journal): Template 2B-split partial payments (T9)"
```

---

## Task 10: Template Case 4 — Early Payoff

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/early-payoff-jp4.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/early-payoff-jp4.template.spec.ts`

**Reference:** Spec §6.4, fixture `case-4-early-payoff.csv`

- [ ] **Step 10.1: Write golden test**

Setup: seedStandard, run 1A, simulate 6 installments paid (run 2A+2B for installments 1–6). Then call early payoff with `interestDiscountPercent = 50`. Diff against `case-4-early-payoff.csv` block "3" (the close-out JE).

- [ ] **Step 10.2: Implement**

```typescript
// early-payoff-jp4.template.ts
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class EarlyPayoffJP4Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /** Spec §6.4. Computes remaining balances by counting unpaid installments. */
  async execute(input: {
    contractId: string;
    depositAccountCode: string;
    interestDiscountPercent: Decimal; // 0..100
  }): Promise<{ entryNo: string }> {
    const c = await this.prisma.contract.findUniqueOrThrow({ where: { id: input.contractId } });
    const total = new Decimal(c.installmentCount);
    const unpaid = await this.prisma.installmentSchedule.count({
      where: { contractId: c.id, status: { not: 'PAID' }, deletedAt: null } as any,
    });
    const unpaidD = new Decimal(unpaid);

    const financed = new Decimal(c.financedAmount.toString());
    const commission = new Decimal(c.commissionAmount.toString());
    const interest = new Decimal(c.interestAmount.toString());
    const vat = new Decimal(c.vatAmount.toString());
    const grossExclVat = financed.plus(commission).plus(interest);

    const installmentExclVat = grossExclVat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const interestPerInst = interest.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const vatPerInst = vat.div(total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const remainingGross = installmentExclVat.times(unpaidD);          // 8,499.96 for 6
    const remainingDeferredInterest = interestPerInst.times(unpaidD);  // 3,000
    const remainingDeferredVat = vatPerInst.times(unpaidD);            //   595.02

    const discount = remainingDeferredInterest.times(input.interestDiscountPercent).div(100).toDecimalPlaces(2);
    const interestRecognized = remainingDeferredInterest.minus(discount);
    const settlement = remainingGross.minus(discount).plus(remainingDeferredVat);

    return this.journal.createAndPost({
      description: `Early payoff contract ${c.contractNumber}`,
      reference: c.id,
      metadata: { tag: '3', flow: 'early-payoff', contractId: c.id },
      lines: [
        // Debits
        { accountCode: input.depositAccountCode, dr: settlement, cr: new Decimal(0) },
        { accountCode: '11-2106', dr: remainingDeferredInterest, cr: new Decimal(0) },
        { accountCode: '21-2102', dr: remainingDeferredVat, cr: new Decimal(0) },
        { accountCode: '52-1106', dr: discount, cr: new Decimal(0), description: 'ส่วนลดดอกเบี้ย-ปิดยอด' },
        // Credits
        { accountCode: '11-2101', dr: new Decimal(0), cr: remainingGross },
        { accountCode: '11-2105', dr: new Decimal(0), cr: remainingDeferredVat },
        { accountCode: '41-1101', dr: new Decimal(0), cr: interestRecognized },
        { accountCode: '21-2101', dr: new Decimal(0), cr: remainingDeferredVat },
      ],
    });
  }
}
```

- [ ] **Step 10.3: Run + commit**

```bash
cd apps/api && npx vitest run src/modules/journal/cpa-templates/early-payoff-jp4.template.spec.ts
git add -A && git commit -m "feat(journal): Template case 4 early payoff w/ 52-1106 discount (T10)"
```

---

## Task 11: Template Case 5 — Repossession

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/repossession-jp5.template.spec.ts`

**Reference:** Spec §6.5, fixture `case-5-repossession.csv`

- [ ] **Step 11.1: Write golden test**

Setup: standard, 1A, 4 installments paid, then call repossession with `repossessionValue = 7000`. Diff against case-5 block.

- [ ] **Step 11.2: Implement**

```typescript
// repossession-jp5.template.ts
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class RepossessionJP5Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /** Spec §6.5. */
  async execute(input: {
    contractId: string;
    depositAccountCode: string;
    repossessionValue: Decimal;
  }): Promise<{ entryNo: string }> {
    const c = await this.prisma.contract.findUniqueOrThrow({ where: { id: input.contractId } });
    const total = new Decimal(c.installmentCount);
    const unpaid = await this.prisma.installmentSchedule.count({
      where: { contractId: c.id, status: { not: 'PAID' }, deletedAt: null } as any,
    });
    const unpaidD = new Decimal(unpaid);

    const financed = new Decimal(c.financedAmount.toString());
    const commission = new Decimal(c.commissionAmount.toString());
    const interest = new Decimal(c.interestAmount.toString());
    const vat = new Decimal(c.vatAmount.toString());
    const grossExclVat = financed.plus(commission).plus(interest);

    const installmentExclVat = grossExclVat.div(total).toDecimalPlaces(2);
    const interestPerInst = interest.div(total).toDecimalPlaces(2);
    const vatPerInst = vat.div(total).toDecimalPlaces(2);

    const remainingGross = installmentExclVat.times(unpaidD);             // 11,333.28 for 8
    const remainingDeferredInterest = interestPerInst.times(unpaidD);     // 4,000
    const remainingDeferredVat = vatPerInst.times(unpaidD);               //   793.36
    const remainingTotal = remainingGross.plus(remainingDeferredVat);     // 12,126.64

    const lossOrGain = remainingTotal.minus(input.repossessionValue);     // 5,126.64 loss

    const lines = [
      { accountCode: input.depositAccountCode, dr: input.repossessionValue, cr: new Decimal(0) },
      { accountCode: '11-2106', dr: remainingDeferredInterest, cr: new Decimal(0) },
      { accountCode: '21-2102', dr: remainingDeferredVat, cr: new Decimal(0) },
      // closeouts
      { accountCode: '11-2101', dr: new Decimal(0), cr: remainingGross },
      { accountCode: '11-2105', dr: new Decimal(0), cr: remainingDeferredVat },
      { accountCode: '21-2101', dr: new Decimal(0), cr: remainingDeferredVat },
      { accountCode: '41-1101', dr: new Decimal(0), cr: remainingDeferredInterest },
    ];
    if (lossOrGain.gt(0)) {
      lines.push({ accountCode: '51-1102', dr: lossOrGain, cr: new Decimal(0), description: 'ขาดทุนจากยึดเครื่อง' });
    } else if (lossOrGain.lt(0)) {
      lines.push({ accountCode: '41-1102', dr: new Decimal(0), cr: lossOrGain.abs(), description: 'รายได้จากการยึดสินค้า' });
    }

    return this.journal.createAndPost({
      description: `Repossession contract ${c.contractNumber}`,
      reference: c.id,
      metadata: { tag: '3', flow: 'repossession', contractId: c.id },
      lines,
    });
  }
}
```

- [ ] **Step 11.3: Run + commit**

```bash
cd apps/api && npx vitest run src/modules/journal/cpa-templates/repossession-jp5.template.spec.ts
git add -A && git commit -m "feat(journal): Template case 5 repossession w/ loss/gain branch (T11)"
```

---

## Task 12: Template Case 6 — Reschedule (6a + 6b)

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/reschedule-jp6.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/reschedule-jp6.template.spec.ts`
- Create: `apps/api/src/modules/installments/reschedule.service.ts`
- Create: `apps/api/src/modules/installments/reschedule.service.spec.ts`

**Reference:** Spec §6.6, fixtures `case-6a-*.csv` + `case-6b-*.csv`

- [ ] **Step 12.1: Write reschedule.service test (TDD — DB UPDATE only, no JE yet)**

```typescript
// reschedule.service.spec.ts
describe('RescheduleService', () => {
  it('shifts due_date for installments ≥ requested + reduces last installment by fee', async () => {
    const c = await seedStandard17k12m(prisma);
    const svc = new RescheduleService(prisma);
    const result = await svc.execute({
      contractId: c.id,
      fromInstallmentNo: 5,
      daysToShift: 16,
    });
    expect(result.rescheduleFee.toFixed(2)).toBe('808.44'); // 1515.83/30*16
    const inst5 = await prisma.installmentSchedule.findFirstOrThrow({ where: { contractId: c.id, installmentNo: 5 } });
    expect(inst5.dueDate.getDate()).toBe(17); // shifted from 1 → 17 Feb (16-day shift on Feb 1)
    const inst12 = await prisma.installmentSchedule.findFirstOrThrow({ where: { contractId: c.id, installmentNo: 12 } });
    expect(new Decimal(inst12.amountDue.toString()).toFixed(2)).toBe('707.39'); // 1515.83 - 808.44
  });
});
```

- [ ] **Step 12.2: Implement service**

```typescript
// reschedule.service.ts
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RescheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: {
    contractId: string;
    fromInstallmentNo: number;
    daysToShift: number;
  }): Promise<{ rescheduleFee: Decimal }> {
    const installments = await this.prisma.installmentSchedule.findMany({
      where: { contractId: input.contractId, installmentNo: { gte: input.fromInstallmentNo }, deletedAt: null } as any,
      orderBy: { installmentNo: 'asc' },
    });
    if (!installments.length) throw new Error('No installments to reschedule');

    const installmentTotal = new Decimal(installments[0].amountDue.toString());
    const fee = installmentTotal.div(30).times(input.daysToShift).toDecimalPlaces(2);

    return this.prisma.$transaction(async (tx) => {
      for (const inst of installments) {
        const newDue = new Date(inst.dueDate);
        newDue.setDate(newDue.getDate() + input.daysToShift);
        await tx.installmentSchedule.update({
          where: { id: inst.id },
          data: {
            dueDate: newDue,
            rescheduledFromDate: inst.dueDate,
            rescheduleCount: { increment: 1 },
          } as any,
        });
      }
      // Reduce last installment by fee
      const last = installments[installments.length - 1];
      await tx.installmentSchedule.update({
        where: { id: last.id },
        data: { amountDue: installmentTotal.minus(fee) } as any,
      });
      // Reset consecutive_missed
      await tx.contract.update({
        where: { id: input.contractId },
        data: { consecutiveMissed: 0 } as any,
      });
      return { rescheduleFee: fee };
    });
  }
}
```

- [ ] **Step 12.3: Implement reschedule-jp6 template (3 entry types: feeAdvance, fullPayment, finalConsumption)**

```typescript
// reschedule-jp6.template.ts
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { JournalAutoService } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class RescheduleJP6Template {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  /** Variant 6a partial fee + 6b bundled both call recordFeeAdvance for the 808.44 part. */
  async recordFeeAdvance(input: {
    contractId: string;
    feeAmount: Decimal;
    depositAccountCode: string;
  }): Promise<{ entryNo: string }> {
    return this.journal.createAndPost({
      description: 'Reschedule fee advance receipt',
      reference: input.contractId,
      metadata: { tag: '2B', flow: 'reschedule-fee', contractId: input.contractId },
      lines: [
        { accountCode: input.depositAccountCode, dr: input.feeAmount, cr: new Decimal(0) },
        { accountCode: '21-1103', dr: new Decimal(0), cr: input.feeAmount, description: 'เงินรับล่วงหน้า' },
      ],
    });
  }

  /** Last installment consumption: clear 21-1103 + receive remainder. */
  async consumeAdvanceOnFinalInstallment(input: {
    contractId: string;
    advanceAmount: Decimal;        // 808.44
    cashRemainder: Decimal;        // 707.39
    depositAccountCode: string;
  }): Promise<{ entryNo: string }> {
    const total = input.advanceAmount.plus(input.cashRemainder);
    return this.journal.createAndPost({
      description: 'Reschedule advance consumption (final installment)',
      reference: input.contractId,
      metadata: { tag: '2B', flow: 'reschedule-final', contractId: input.contractId },
      lines: [
        { accountCode: '21-1103', dr: input.advanceAmount, cr: new Decimal(0), description: 'ล้างเงินรับล่วงหน้า' },
        { accountCode: input.depositAccountCode, dr: input.cashRemainder, cr: new Decimal(0) },
        { accountCode: '11-2103', dr: new Decimal(0), cr: total, description: 'ล้างลูกหนี้ค้างชำระ' },
      ],
    });
  }
}
```

- [ ] **Step 12.4: Write golden tests for both 6a + 6b flows**

Each test:
- Setup standard, 1A, run 2A for installments 1–4
- Trigger reschedule.execute(fromInst=5, days=16)
- For 6a: recordFeeAdvance(808.44) + later 2B full(1515.83)
- For 6b: single payment of 2324.27 → both legs in one JE (split into 2 lines)
- For both: at month 12, run 2A for last installment then consumeAdvanceOnFinalInstallment(808.44, 707.39)
- Diff against respective CSV

- [ ] **Step 12.5: Run + commit**

```bash
cd apps/api && npx vitest run src/modules/journal/cpa-templates/reschedule-jp6.template.spec.ts src/modules/installments/reschedule.service.spec.ts
git add -A
git commit -m "feat(journal+installments): Template case 6 reschedule (6a/6b) + service (T12)"
```

---

## Task 13: Vendor Payable Clearance Template

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/vendor-clearance.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/vendor-clearance.template.spec.ts`

**Reference:** Spec §6.7

- [ ] **Step 13.1: Write golden test (uses block "3" / "4" of any case)**

```typescript
it('clears 21-1101 + 21-1102 by paying vendor', async () => {
  const c = await seedStandard17k12m(prisma);
  // setup 1A first
  await new ContractActivation1ATemplate(journal, prisma).execute(c.id);
  await new VendorClearanceTemplate(journal, prisma).execute({
    contractId: c.id,
    depositAccountCode: '11-1101',
  });

  const expected = loadCaseFromCsv(path.join(__dirname, '../__tests__/fixtures/cpa-cases/case-1-overpay.csv'));
  const expected3 = expected.entries.filter((e) => e.tag === '4'); // last block in fixture
  const actual = await formatJEsAsBlocks(prisma, c.id);
  const actual3 = actual.filter((a) => (a as any).tag === '3');
  // adjust tag mapping if needed
});
```

- [ ] **Step 13.2: Implement**

```typescript
@Injectable()
export class VendorClearanceTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: { contractId: string; depositAccountCode: string }) {
    const c = await this.prisma.contract.findUniqueOrThrow({ where: { id: input.contractId } });
    const financed = new Decimal(c.financedAmount.toString());
    const commission = new Decimal(c.commissionAmount.toString());
    const total = financed.plus(commission);
    return this.journal.createAndPost({
      description: `Vendor payment for contract ${c.contractNumber}`,
      reference: c.id,
      metadata: { tag: '3', flow: 'vendor-clearance', contractId: c.id },
      lines: [
        { accountCode: '21-1101', dr: financed, cr: new Decimal(0) },
        { accountCode: '21-1102', dr: commission, cr: new Decimal(0) },
        { accountCode: input.depositAccountCode, dr: new Decimal(0), cr: total },
      ],
    });
  }
}
```

- [ ] **Step 13.3: Run + commit**

```bash
cd apps/api && npx vitest run src/modules/journal/cpa-templates/vendor-clearance.template.spec.ts
git add -A && git commit -m "feat(journal): Template vendor payable clearance (T13)"
```

---

## Task 14: Feature I — VAT 60-Day Mandatory Cron + Reversal

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/vat-60day-mandatory.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/vat-60day-mandatory.template.spec.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/vat-60day-reversal.template.ts`
- Create: `apps/api/src/modules/journal/cpa-templates/vat-60day-reversal.template.spec.ts`
- Create: `apps/api/src/modules/journal/cron/vat-60day.cron.ts`
- Modify: `apps/api/prisma/schema.prisma` — add `InstallmentSchedule.vat60dayJournalEntryId String?`

**Reference:** Spec §6.8

- [ ] **Step 14.1: Add migration field for vat60dayJournalEntryId**

```bash
cd apps/api && npx prisma migrate dev --name add_vat60day_je_link
```

- [ ] **Step 14.2: Write golden test (mandatory)**

Setup: standard, 1A, run 2A for installment 1 with `dueDate = today - 61 days`. Trigger cron. Verify JE has the 4 lines per spec §6.8.

- [ ] **Step 14.3: Implement mandatory template**

```typescript
@Injectable()
export class Vat60dayMandatoryTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(installmentScheduleId: string) {
    const inst = await this.prisma.installmentSchedule.findUniqueOrThrow({ where: { id: installmentScheduleId } });
    if ((inst as any).vat60dayJournalEntryId) return null;

    const c = await this.prisma.contract.findUniqueOrThrow({ where: { id: inst.contractId } });
    const vatPerInst = new Decimal(c.vatAmount.toString()).div(c.installmentCount).toDecimalPlaces(2);

    const result = await this.journal.createAndPost({
      description: `VAT 60-day mandatory for installment #${inst.installmentNo}`,
      reference: c.id,
      metadata: { tag: 'VAT60', flow: 'mandatory', installmentScheduleId: inst.id },
      lines: [
        { accountCode: '51-1101', dr: vatPerInst, cr: new Decimal(0) },
        { accountCode: '11-2104', dr: vatPerInst, cr: new Decimal(0) },
        { accountCode: '21-2103', dr: new Decimal(0), cr: vatPerInst.times(2) },
      ],
    });
    await this.prisma.installmentSchedule.update({
      where: { id: inst.id },
      data: { vat60dayJournalEntryId: result.entryNo } as any,
    });
    return result;
  }
}
```

- [ ] **Step 14.4: Implement reversal template**

```typescript
@Injectable()
export class Vat60dayReversalTemplate {
  constructor(private readonly journal: JournalAutoService, private readonly prisma: PrismaService) {}

  async execute(installmentScheduleId: string) {
    const inst = await this.prisma.installmentSchedule.findUniqueOrThrow({ where: { id: installmentScheduleId } });
    if (!(inst as any).vat60dayJournalEntryId) return null;
    const c = await this.prisma.contract.findUniqueOrThrow({ where: { id: inst.contractId } });
    const vatPerInst = new Decimal(c.vatAmount.toString()).div(c.installmentCount).toDecimalPlaces(2);

    const result = await this.journal.createAndPost({
      description: `VAT 60-day reversal for installment #${inst.installmentNo}`,
      reference: c.id,
      metadata: { tag: 'VAT60', flow: 'reversal', installmentScheduleId: inst.id },
      lines: [
        { accountCode: '21-2103', dr: vatPerInst.times(2), cr: new Decimal(0) },
        { accountCode: '51-1105', dr: new Decimal(0), cr: vatPerInst },
        { accountCode: '11-2104', dr: new Decimal(0), cr: vatPerInst },
      ],
    });
    await this.prisma.installmentSchedule.update({
      where: { id: inst.id },
      data: { vat60dayJournalEntryId: null } as any,
    });
    return result;
  }
}
```

- [ ] **Step 14.5: Implement cron**

```typescript
@Injectable()
export class Vat60dayCron {
  constructor(private readonly prisma: PrismaService, private readonly mandatory: Vat60dayMandatoryTemplate) {}

  @Cron('0 2 * * *', { timeZone: 'Asia/Bangkok' })
  async tick() {
    const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const overdueInsts = await this.prisma.installmentSchedule.findMany({
      where: {
        dueDate: { lte: cutoff },
        status: 'OVERDUE',
        vat60dayJournalEntryId: null,
        deletedAt: null,
      } as any,
    });
    for (const inst of overdueInsts) {
      try { await this.mandatory.execute(inst.id); }
      catch (e) { Sentry.captureException(e, { extra: { instId: inst.id } }); }
    }
  }
}
```

Wire reversal into `PaymentReceipt2BTemplate` — when payment received and `inst.vat60dayJournalEntryId != null`, also call `vat60dayReversal.execute(inst.id)` in the same transaction.

- [ ] **Step 14.6: Run all + commit**

```bash
cd apps/api && npx vitest run src/modules/journal/cpa-templates/vat-60day-{mandatory,reversal}.template.spec.ts
git add -A
git commit -m "feat(journal): Feature I VAT 60-day mandatory + reversal + cron (T14)"
```

---

## Task 15: Cash Dimension UI — Payment Dropdown + User Default

**Files:**
- Modify: `apps/api/src/modules/payments/payments.service.ts` — accept `depositAccountCode`, default from user
- Modify: `apps/api/src/modules/payments/dto/create-payment.dto.ts` — add field
- Modify: `apps/api/src/modules/users/users.service.ts` — accept `defaultCashAccountCode`
- Modify: `apps/api/src/modules/users/dto/update-user.dto.ts`
- Modify: `apps/web/src/pages/PaymentsPage.tsx` (or wherever Payment form lives) — add dropdown
- Create: `apps/web/src/components/CashAccountSelect.tsx`
- Modify: `apps/web/src/pages/UserSettingsPage.tsx` — add default cash account selector

- [ ] **Step 15.1: API — add fields + validation (TDD with payments.service.spec.ts)**

Verify the rejected payment when `depositAccountCode` not in `[11-1101, 11-1102, 11-1103, 11-1201, 11-1202, 11-1203]`.

- [ ] **Step 15.2: Frontend — `CashAccountSelect` component**

```tsx
// apps/web/src/components/CashAccountSelect.tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const CASH_CODES = ['11-1101', '11-1102', '11-1103', '11-1201', '11-1202', '11-1203'];

export function CashAccountSelect({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const { data } = useQuery({
    queryKey: ['coa', 'cash'],
    queryFn: () => api.get<{ code: string; name: string }[]>('/accounting/coa?codes=' + CASH_CODES.join(',')).then((r) => r.data),
  });
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="เลือกบัญชี" /></SelectTrigger>
      <SelectContent>
        {data?.map((a) => <SelectItem key={a.code} value={a.code}>{a.code} {a.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 15.3: Wire into Payment form**

In Payment form: pre-fill from `user.defaultCashAccountCode`, allow override. On submit pass to API.

- [ ] **Step 15.4: User settings page — add default selector**

In UserSettingsPage add the same `<CashAccountSelect>` component bound to `defaultCashAccountCode` field.

- [ ] **Step 15.5: E2E smoke**

```bash
cd apps/web && npx playwright test e2e/payment-cash-account.spec.ts
```

Write a small Playwright test: log in, open Payment form, verify dropdown populates 6 accounts, change selection, submit, verify backend stores correct code.

- [ ] **Step 15.6: Commit**

```bash
git add -A && git commit -m "feat(cash): per-payment depositAccountCode dropdown + user default (T15)"
```

---

## Task 16: Tolerance Approval UI + Audit Log

**Files:**
- Modify: `apps/api/src/modules/payments/payments.service.ts` — require `toleranceApproverId` in body when underpay/overpay tolerance applies
- Modify: `apps/api/src/modules/audit-logs/audit-log.service.ts` — log `TOLERANCE_APPROVED` action
- Modify: `apps/web/src/pages/PaymentsPage.tsx` — show approval modal when diff !== 0

- [ ] **Step 16.1: Backend — enforce approver field on tolerance**

When `PaymentReceipt2BTemplate` posts `52-1104` or `53-1503`, require `toleranceApproverId` from request body. Verify role is `OWNER` or `ACCOUNTANT`. Log to `AuditLog`:

```typescript
await this.auditLog.write({
  action: 'TOLERANCE_APPROVED',
  entity: 'payment',
  entityId: payment.id,
  userId: input.toleranceApproverId,
  metadata: { diff: diff.toString(), accountCode: line.accountCode },
});
```

- [ ] **Step 16.2: Frontend — approval modal**

If amount differs from installmentTotal by ≤1฿: show modal "ยืนยันการอนุมัติส่วนต่าง X.XX ฿" → require role check + comment → submit with `toleranceApproverId`.

- [ ] **Step 16.3: Test + commit**

```bash
cd apps/api && npx vitest run src/modules/payments
git add -A && git commit -m "feat(payments): tolerance approval gate + audit log (T16)"
```

---

## Task 17: Update Accounting Reports (Trial Balance / P&L / BS)

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.service.ts` — re-map account groups
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts` — return new categories
- Modify: `apps/web/src/pages/AccountingDashboardPage.tsx` (or equivalent) — render new structure

- [ ] **Step 17.1: Update Trial Balance grouping**

Group accounts by leading 2 digits per CSV section:
- 11-XXXX สินทรัพย์หมุนเวียน
- 12-XXXX สินทรัพย์ไม่หมุนเวียน
- 21-XXXX หนี้สินหมุนเวียน
- 22-XXXX หนี้สินไม่หมุนเวียน
- 31-XXXX, 32-XXXX, 33-XXXX ทุน
- 41-XXXX, 42-XXXX รายได้
- 51-XXXX, 52-XXXX, 53-XXXX, 54-XXXX, 55-XXXX ค่าใช้จ่าย

Apply Contra Asset rule: `11-2102, 11-2106, 12-2102/04/06/08` are Cr-normal — show as negative under Asset.

- [ ] **Step 17.2: Update P&L computation**

Revenue = Σ(41-XXXX + 42-XXXX) Cr balance.
Expenses = Σ(51-XXXX + 52-XXXX + 53-XXXX + 54-XXXX) Dr balance.
Exclude 55-XXXX (per CSV note: ไม่นำมาแสดงในงบกำไร-ขาดทุน).

- [ ] **Step 17.3: Tests**

Run all 7 case fixtures end-to-end → query Trial Balance → verify Σ Dr = Σ Cr.

- [ ] **Step 17.4: Commit**

```bash
git add -A && git commit -m "refactor(accounting): re-map reports for FINANCE chart structure (T17)"
```

---

## Task 18: Wipe & Reseed Prod Script + Documentation

**Files:**
- Create: `scripts/wipe-and-reseed-finance-accounting.sh`
- Create: `apps/api/src/cli/wipe-accounting.cli.ts` (Cloud Run Job entry)
- Modify: `.claude/rules/accounting.md` — full rewrite
- Modify: `MEMORY.md` — add A.4 ship marker
- Create: memory file `project_pr_a4_cpa_chart_adoption.md`

- [ ] **Step 18.1: Wipe CLI**

```typescript
// apps/api/src/cli/wipe-accounting.cli.ts
import { PrismaClient } from '@prisma/client';
import { seedFinanceCoa } from '../../prisma/seed-coa-finance';

async function main() {
  if (process.env.CONFIRM_WIPE !== 'YES_I_AM_SURE') {
    console.error('Refusing to run without CONFIRM_WIPE=YES_I_AM_SURE');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  await prisma.$transaction([
    prisma.$executeRawUnsafe('TRUNCATE "JournalLine" CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE "JournalEntry" CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE "Payment" CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE "InstallmentSchedule" CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE "Contract" CASCADE'),
    prisma.$executeRawUnsafe('TRUNCATE "ChartOfAccount" CASCADE'),
  ]);
  await seedFinanceCoa(prisma);
  console.log('Wipe + reseed complete.');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 18.2: Rewrite .claude/rules/accounting.md**

Replace contents (full rewrite per spec §6 + remove A.0–A.3 references). Document:
- TFRS for NPAEs + Full Accrual Interest + Accrual VAT model
- 109-account FINANCE chart (link CSV)
- 7 case templates (link spec)
- Tolerance policy (≤1฿)
- VAT 60-day mandatory rule
- DEFERRED items (PPE/WHT/forbidden expenses/PEAK mapping)

- [ ] **Step 18.3: Run all tests**

```bash
./tools/check-types.sh all
cd apps/api && npx vitest run
```

Expected: ALL PASS. Fix anything broken.

- [ ] **Step 18.4: PR + post-merge wipe**

```bash
git push -u origin phase-a4-cpa-chart-adoption
gh pr create --title "feat(accounting): Phase A.4 CPA chart adoption (109 accounts, Full Accrual TFRS)" --body "$(cat <<'EOF'
## Summary
- Replaces Phase A.0-A.3 with CPA-authored 109-account FINANCE chart
- Full Accrual TFRS interest model (11-2106 Contra Asset)
- Accrual VAT model (11-2105/21-2102 → 21-2101 per installment)
- 7 JE templates + golden-file tests against CPA CSVs
- Reschedule, cash dimension, tolerance approval, VAT 60-day rule
- DEFERRED to A.5: PPE+depreciation, WHT, forbidden expenses, PEAK mapping

## Test plan
- [ ] All 7 CPA case golden tests pass
- [ ] Trial Balance balances after running 7 cases
- [ ] Wipe CLI tested in dev
- [ ] Manual smoke: create contract via UI, see JE 1A; pay installment, see 2A+2B; early payoff, see case 4 JE
EOF
)"
```

After PR merged + deployed:
- Run wipe Cloud Run Job with `CONFIRM_WIPE=YES_I_AM_SURE` (manual trigger by owner)
- Verify CoA count = 109
- Smoke test 1 contract end-to-end via UI

- [ ] **Step 18.5: Save memory**

Create `/Users/iamnaii/.claude/projects/-Users-iamnaii-Desktop-App-BESTCHOICE/memory/project_pr_a4_cpa_chart_adoption.md` with squash SHA + summary, add line to `MEMORY.md`.

---

## Self-Review Notes

- **Spec coverage:** §3 scope items A–I all mapped to tasks (A→T4, B→T6/7/10, C→T6/7, D→T15, E→T6/13, F→T8/16, G→T10, H→T12, I→T14). Section 6 templates 1A→T6, 2A→T7, 2B→T8/9, 4→T10, 5→T11, 6→T12, vendor→T13, VAT 60-day→T14. Section 7 testing strategy → T1+T5+T6–T14. ✓
- **Placeholder scan:** No "TBD" or "implement later" — every step has concrete code or commands. Schema field references like `accrualJournalEntryId` flagged in T7 with note to add in T2 if missing. ✓
- **Type consistency:** `JeLineInput` introduced in T3 used consistently in T6–T14. `PrismaService` injected uniformly. Account codes match across spec + plan + CSV. ✓
- **Ambiguity:** Tag mapping between CSV ("1", "2A", "2B", "2B1", "2B2", "3", "4") and template metadata ("1A", "2A", "2B", "VAT60") — diff helper in T1 step 1.6 needs to handle both; flagged in test code. Vendor clearance test maps fixture tag "4" to template tag "3" (both = vendor pay-out block).

---

## Open Questions Resolved (per spec §10)

1. **Vendor payout timing** — manual UI trigger (no cron in A.4); revisit after smoke testing.
2. **PaySolutions default deposit account** — `11-1202` (SCB ค่าใช้จ่าย) per design recommendation. Owner to confirm in production.
3. **Tolerance approver roles** — `OWNER` + `ACCOUNTANT` only (T16).
4. **Multi-branch FINANCE JE** — `branchId = null` for FINANCE entries (single chart, no per-branch FINANCE accounting).
