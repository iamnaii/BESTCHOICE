# Other Income Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a self-service Other Income (42-XXXX) data-entry module so finance can record bank-interest, gain-on-disposal, and other 42-XXXX entries directly into the BESTCHOICE ledger — eliminating paper-based recording and gaps in the trial balance.

**Architecture:** NestJS module mirrors the existing `accounting/expenses` pattern (controller → service → JE template via `JournalAutoService.createAndPost`). 4 new Prisma tables (`OtherIncome`, `OtherIncomeItem`, `OtherIncomeAdjustment`, `OtherIncomeAttachment`) — everything else is reused (User, Customer, ChartOfAccount, AccountingPeriod, JournalEntry/Line, AuditLog). Frontend mirrors `ExpensesPage` style: list + single-page entry form + view + receipt + daily sheet. Workflow is 3-state (DRAFT → POSTED → REVERSED) per design D1.

**Tech Stack:**
- Backend: NestJS, Prisma 6, PostgreSQL, class-validator, decimal.util, Jest
- Frontend: React 18, Vite 6, react-hook-form + zod, @tanstack/react-query, Tailwind, shadcn/ui, lucide-react
- E2E: Playwright

**Spec:** `docs/superpowers/specs/2026-05-06-other-income-module-design.md`

**Reference patterns to mirror (already in codebase):**
- `apps/api/src/modules/accounting/accounting.service.ts` — Expense CRUD + state transitions
- `apps/api/src/modules/accounting/accounting.controller.ts` — endpoint shape + guards
- `apps/api/src/modules/accounting/dto/expense.dto.ts` — DTO pattern
- `apps/api/src/modules/journal/journal-auto.service.ts` — `createAndPost(input, tx?)`
- `apps/api/src/modules/journal/cpa-templates/early-payoff-jp4.template.ts` — JE template class shape
- `apps/web/src/pages/ExpensesPage.tsx` — list + modal form + filters + actions
- `apps/web/src/hooks/useCoa.ts` — `useCoaGroups({ type })`
- `apps/web/src/lib/api.ts` — typed axios client

---

## File Inventory

**New backend files (`apps/api/src/modules/other-income/`):**
- `other-income.module.ts`
- `other-income.controller.ts`
- `other-income.service.ts`
- `services/auto-journal.service.ts`
- `services/validation.service.ts`
- `services/doc-number.service.ts`
- `templates/other-income.template.ts`
- `dto/create-other-income.dto.ts`
- `dto/update-other-income.dto.ts`
- `dto/post-other-income.dto.ts`
- `dto/reverse-other-income.dto.ts`
- `dto/copy-other-income.dto.ts`
- `dto/list-other-income-query.dto.ts`
- `dto/daily-sheet-query.dto.ts`
- `__tests__/validation.spec.ts`
- `__tests__/auto-journal.spec.ts`
- `__tests__/other-income.service.spec.ts`
- `__tests__/other-income.controller.spec.ts`
- `__tests__/fixtures/golden-cases.ts`

**Backend changes:**
- `apps/api/prisma/schema.prisma` — add 4 models + back-relations on `User`, `Customer`, `JournalEntry`
- `apps/api/prisma/migrations/<ts>_add_other_income_tables/migration.sql`
- `apps/api/src/app.module.ts` — register `OtherIncomeModule`

**New frontend files (`apps/web/src/`):**
- `pages/other-income/OtherIncomeListPage.tsx`
- `pages/other-income/OtherIncomeEntryPage.tsx`
- `pages/other-income/OtherIncomeViewPage.tsx`
- `pages/other-income/OtherIncomeReceiptPage.tsx`
- `pages/other-income/OtherIncomeDailySheetPage.tsx`
- `pages/other-income/components/ItemsTable.tsx`
- `pages/other-income/components/AdjustmentTable.tsx`
- `pages/other-income/components/AccountSearchDropdown.tsx`
- `pages/other-income/components/PaymentCompareCard.tsx`
- `pages/other-income/components/AutoJournalPreview.tsx`
- `pages/other-income/components/ReverseModal.tsx`
- `pages/other-income/components/CounterpartyPicker.tsx`
- `pages/accounting/PeriodClosePage.tsx`
- `lib/otherIncome.ts` (typed API client)
- `lib/otherIncome.types.ts`
- `lib/otherIncome.schema.ts` (zod schema)

**Frontend changes:**
- `apps/web/src/App.tsx` — register 5 lazy routes
- `apps/web/src/components/layout/Sidebar.tsx` (or equivalent) — add nav items

**Test files:**
- `apps/web/e2e/other-income-smoke.spec.ts`

---

## Phases

| Phase | Tasks | Focus |
|---|---|---|
| 1 | T1 | Prisma schema + migration (foundation) |
| 2 | T2-T6 | Backend service layer (TDD) |
| 3 | T7-T9 | Backend controller + DTOs + integration tests |
| 4 | T10-T11 | Frontend API client + reusable components |
| 5 | T12-T13 | Frontend list + entry pages |
| 6 | T14-T16 | Frontend view + receipt + daily sheet |
| 7 | T17-T18 | Period close UI + route registration |
| 8 | T19-T20 | E2E smoke test + final verification |

Tasks T2-T9 (backend) can be implemented sequentially or with subagents per task. Tasks T10-T18 (frontend) are best implemented sequentially due to shared component dependencies.

---

## Phase 1: Foundation

### Task 1: Prisma schema + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (add 4 models + back-relations on User/Customer/JournalEntry not needed — use `referenceType`/`referenceId`)
- Create: `apps/api/prisma/migrations/<timestamp>_add_other_income_tables/migration.sql` (auto-generated)

**Convention notes (read first):**
- Use `referenceType = 'OTHER_INCOME'` + `referenceId = otherIncome.id` on `JournalEntry` to link — do NOT add a direct FK on `OtherIncome` (matches existing Expense/Payment/Sale linkage convention).
- All money is `Decimal @db.Decimal(15, 2)` per `.claude/rules/database.md`.
- All models include `createdAt`, `updatedAt`, `deletedAt` per project convention.
- `companyId` is required (mirror Expense, JournalEntry); resolve to FINANCE entity at service layer.

- [ ] **Step 1.1: Add enums + main `OtherIncome` model**

Edit `apps/api/prisma/schema.prisma`. Append at the bottom of the file (after the last model):

```prisma
enum OtherIncomeStatus {
  DRAFT
  POSTED
  REVERSED
}

enum OtherIncomePriceType {
  EXCLUSIVE
  INCLUSIVE
}

enum OtherIncomeReverseReason {
  INPUT_ERROR
  CUSTOMER_REQUEST
  DUPLICATE
  WRONG_ACCOUNT
  WRONG_AMOUNT
  OTHER
}

model OtherIncome {
  id        String            @id @default(uuid())
  docNumber String            @unique @map("doc_number") // OI-YYYYMMDD-NNNN
  companyId String            @map("company_id")
  status    OtherIncomeStatus @default(DRAFT)

  issueDate   DateTime             @map("issue_date")
  dueDate     DateTime?            @map("due_date")
  paymentDate DateTime?            @map("payment_date")
  priceType   OtherIncomePriceType @default(EXCLUSIVE) @map("price_type")

  // Counterparty (all optional — ดอกเบี้ยฝากไม่มี Customer)
  customerId          String? @map("customer_id")
  counterpartyName    String? @map("counterparty_name")
  counterpartyTaxId   String? @map("counterparty_tax_id")
  counterpartyAddress String? @map("counterparty_address")
  counterpartyPhone   String? @map("counterparty_phone")

  // Payment
  paymentAccountCode String  @map("payment_account_code")
  amountReceived    Decimal @default(0) @map("amount_received") @db.Decimal(15, 2)

  // Cached totals (populated at post-time; used by reports)
  incomeGross  Decimal @default(0) @map("income_gross")  @db.Decimal(15, 2)
  vatAmount    Decimal @default(0) @map("vat_amount")    @db.Decimal(15, 2)
  whtAmount    Decimal @default(0) @map("wht_amount")    @db.Decimal(15, 2)
  netReceived  Decimal @default(0) @map("net_received")  @db.Decimal(15, 2)
  totalAmount  Decimal @default(0) @map("total_amount")  @db.Decimal(15, 2)

  // Output references
  receiptNo      String? @unique @map("receipt_no") // RC-YYYYMMDD-NNN
  journalEntryId String? @unique @map("journal_entry_id") // null until POSTED

  // Override JV (when user manually edits the auto-generated JE)
  isOverridden Boolean @default(false) @map("is_overridden")

  customerNote String? @map("customer_note")

  // Lifecycle
  createdById String    @map("created_by_id")
  postedAt    DateTime? @map("posted_at")

  // Reverse linkage (self-relation)
  // - on a -R doc:        reversesId points to the original
  // - on the original:    reversedById points to the -R doc (set when reversed)
  reversesId    String? @map("reverses_id")
  reversedById  String? @unique @map("reversed_by_id")
  reverseReason OtherIncomeReverseReason? @map("reverse_reason")
  reverseNote   String? @map("reverse_note")

  // Recurring
  copiedFromId String? @map("copied_from_id")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  // Relations
  company     CompanyInfo   @relation(fields: [companyId], references: [id])
  customer    Customer?     @relation("CustomerOtherIncome", fields: [customerId], references: [id])
  createdBy   User          @relation("OtherIncomeCreatedBy", fields: [createdById], references: [id])
  reverses    OtherIncome?  @relation("OtherIncomeReverse", fields: [reversesId], references: [id])
  reversedBy  OtherIncome?  @relation("OtherIncomeReverse")
  copiedFrom  OtherIncome?  @relation("OtherIncomeCopy", fields: [copiedFromId], references: [id])
  copies      OtherIncome[] @relation("OtherIncomeCopy")

  items       OtherIncomeItem[]
  adjustments OtherIncomeAdjustment[]
  attachments OtherIncomeAttachment[]

  @@index([companyId])
  @@index([status, issueDate])
  @@index([customerId])
  @@index([deletedAt])
  @@index([issueDate])
  @@map("other_incomes")
}
```

- [ ] **Step 1.2: Add child models**

Append to `schema.prisma` after the `OtherIncome` model:

```prisma
model OtherIncomeItem {
  id            String @id @default(uuid())
  otherIncomeId String @map("other_income_id")
  lineNo        Int    @map("line_no")

  accountCode String  @map("account_code") // 42-XXXX
  accountName String  @map("account_name") // snapshot
  description String?

  quantity        Decimal @default(1) @db.Decimal(15, 2)
  unitAmount      Decimal @default(0) @map("unit_amount")      @db.Decimal(15, 2)
  discountAmount  Decimal @default(0) @map("discount_amount")  @db.Decimal(15, 2)
  vatPct          Decimal @default(0) @map("vat_pct")          @db.Decimal(5, 2)
  whtPct          Decimal @default(0) @map("wht_pct")          @db.Decimal(5, 2)

  amountBeforeVat Decimal @default(0) @map("amount_before_vat") @db.Decimal(15, 2)
  vatAmount       Decimal @default(0) @map("vat_amount")        @db.Decimal(15, 2)
  whtAmount       Decimal @default(0) @map("wht_amount")        @db.Decimal(15, 2)

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  otherIncome OtherIncome @relation(fields: [otherIncomeId], references: [id], onDelete: Cascade)

  @@unique([otherIncomeId, lineNo])
  @@index([accountCode])
  @@map("other_income_items")
}

model OtherIncomeAdjustment {
  id            String @id @default(uuid())
  otherIncomeId String @map("other_income_id")
  lineNo        Int    @map("line_no")

  accountCode String  @map("account_code")
  amount      Decimal @db.Decimal(15, 2) // CHECK > 0 enforced via SQL in migration
  note        String?

  createdAt DateTime @default(now()) @map("created_at")

  otherIncome OtherIncome @relation(fields: [otherIncomeId], references: [id], onDelete: Cascade)

  @@unique([otherIncomeId, lineNo])
  @@map("other_income_adjustments")
}

model OtherIncomeAttachment {
  id            String @id @default(uuid())
  otherIncomeId String @map("other_income_id")

  s3Key    String @map("s3_key")
  filename String
  size     Int
  mimeType String @map("mime_type")

  uploadedById String   @map("uploaded_by_id")
  createdAt    DateTime @default(now()) @map("created_at")

  otherIncome OtherIncome @relation(fields: [otherIncomeId], references: [id], onDelete: Cascade)
  uploadedBy  User        @relation("OtherIncomeAttachmentUploader", fields: [uploadedById], references: [id])

  @@map("other_income_attachments")
}
```

- [ ] **Step 1.3: Add back-relations on existing `User`, `Customer`, `CompanyInfo`**

Find `model User` (around line 545). Add these relation fields inside the model (after existing relations, before the closing `}`):

```prisma
  // Other Income module
  otherIncomesCreated     OtherIncome[]            @relation("OtherIncomeCreatedBy")
  otherIncomeAttachments  OtherIncomeAttachment[]  @relation("OtherIncomeAttachmentUploader")
```

Find `model Customer` (around line 700). Add inside the model:

```prisma
  otherIncomes OtherIncome[] @relation("CustomerOtherIncome")
```

Find `model CompanyInfo` (search for `model CompanyInfo`). Add inside the model:

```prisma
  otherIncomes OtherIncome[]
```

- [ ] **Step 1.4: Verify schema compiles**

Run:

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx prisma format
```

Expected: completes without errors. Re-read `schema.prisma` and confirm formatting.

Then run:

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid 🚀`

If validation fails on duplicate relation names, the back-relation field name on the `User` side likely collides with another `OtherIncome` relation. Read the error and rename the field if needed.

- [ ] **Step 1.5: Generate the migration**

Run:

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx prisma migrate dev --name add_other_income_tables --create-only
```

Expected: a new directory `prisma/migrations/<timestamp>_add_other_income_tables/` with `migration.sql` inside. Do not apply yet.

- [ ] **Step 1.6: Add CHECK constraint for adjustment.amount > 0**

Open the generated `migration.sql`. At the very bottom append:

```sql
-- Enforce adjustment amount > 0 (V14 at DB level)
ALTER TABLE "other_income_adjustments"
  ADD CONSTRAINT "other_income_adjustments_amount_positive" CHECK ("amount" > 0);
```

- [ ] **Step 1.7: Apply the migration locally**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx prisma migrate dev
```

Expected: migration applies, Prisma Client regenerates, no errors. Confirm by running `npx prisma db pull --print | grep other_income | head -5` shows the new tables.

- [ ] **Step 1.8: Type-check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

Expected: 0 errors (Prisma Client picks up the new types).

- [ ] **Step 1.9: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(other-income): add Prisma schema + migration for 42-XXXX entries

- 4 new tables: other_incomes, other_income_items, other_income_adjustments, other_income_attachments
- 3 enums: OtherIncomeStatus (DRAFT/POSTED/REVERSED), OtherIncomePriceType, OtherIncomeReverseReason
- Back-relations added on User, Customer, CompanyInfo
- DB-level CHECK constraint: adjustment.amount > 0 (V14)
- JE linkage via JournalEntry.referenceType='OTHER_INCOME' + referenceId (no direct FK)

Spec: docs/superpowers/specs/2026-05-06-other-income-module-design.md"
```

---

## Phase 2: Backend service layer

### Task 2: Doc number service (TDD)

Generates atomic, monotonically-increasing document numbers per day for both `OtherIncome.docNumber` (`OI-YYYYMMDD-NNNN`) and `OtherIncome.receiptNo` (`RC-YYYYMMDD-NNN`). Mirrors the `pg_advisory_xact_lock` pattern used in `JournalAutoService.generateEntryNumber`.

**Files:**
- Create: `apps/api/src/modules/other-income/services/doc-number.service.ts`
- Create: `apps/api/src/modules/other-income/__tests__/doc-number.service.spec.ts`

- [ ] **Step 2.1: Write failing test**

Create `apps/api/src/modules/other-income/__tests__/doc-number.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { DocNumberService } from '../services/doc-number.service';

describe('DocNumberService', () => {
  let service: DocNumberService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [DocNumberService, PrismaService],
    }).compile();
    service = module.get(DocNumberService);
    prisma = module.get(PrismaService);
    await prisma.otherIncome.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('generates OI-YYYYMMDD-0001 when no doc exists for the date', async () => {
    const docNo = await service.nextDocNumber(prisma, new Date('2026-05-06'));
    expect(docNo).toBe('OI-20260506-0001');
  });

  it('increments sequence for same date', async () => {
    const date = new Date('2026-05-06');
    const a = await service.nextDocNumber(prisma, date);
    expect(a).toBe('OI-20260506-0001');
    // Simulate prior doc by inserting a row
    await prisma.otherIncome.create({
      data: { docNumber: a, companyId: 'co-1', issueDate: date, createdById: 'u-1', paymentAccountCode: '11-1101' },
    });
    const b = await service.nextDocNumber(prisma, date);
    expect(b).toBe('OI-20260506-0002');
  });

  it('resets sequence on new date', async () => {
    const a = await service.nextDocNumber(prisma, new Date('2026-05-06'));
    await prisma.otherIncome.create({
      data: { docNumber: a, companyId: 'co-1', issueDate: new Date('2026-05-06'), createdById: 'u-1', paymentAccountCode: '11-1101' },
    });
    const b = await service.nextDocNumber(prisma, new Date('2026-05-07'));
    expect(b).toBe('OI-20260507-0001');
  });

  it('generates RC-YYYYMMDD-001 receipt number', async () => {
    const rc = await service.nextReceiptNumber(prisma, new Date('2026-05-06'));
    expect(rc).toBe('RC-20260506-001');
  });
});
```

- [ ] **Step 2.2: Run the failing test**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/other-income/__tests__/doc-number.service.spec.ts
```

Expected: `Cannot find module '../services/doc-number.service'` → fail.

- [ ] **Step 2.3: Implement DocNumberService**

Create `apps/api/src/modules/other-income/services/doc-number.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class DocNumberService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate next OtherIncome doc number: OI-YYYYMMDD-NNNN.
   * Uses pg_advisory_xact_lock keyed by date to serialize concurrent generation.
   */
  async nextDocNumber(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date,
  ): Promise<string> {
    const yyyymmdd = this.formatYYYYMMDD(issueDate);
    const lockKey = this.hashLockKey(`oi:${yyyymmdd}`);

    // Take advisory lock for the date (released at end of transaction)
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const startOfDay = new Date(issueDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const count = await tx.otherIncome.count({
      where: {
        issueDate: { gte: startOfDay, lt: endOfDay },
      },
    });

    const seq = String(count + 1).padStart(4, '0');
    return `OI-${yyyymmdd}-${seq}`;
  }

  /** Generate next receipt number: RC-YYYYMMDD-NNN. */
  async nextReceiptNumber(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date,
  ): Promise<string> {
    const yyyymmdd = this.formatYYYYMMDD(issueDate);
    const lockKey = this.hashLockKey(`rc:${yyyymmdd}`);

    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const startOfDay = new Date(issueDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const count = await tx.otherIncome.count({
      where: {
        receiptNo: { not: null },
        issueDate: { gte: startOfDay, lt: endOfDay },
      },
    });

    const seq = String(count + 1).padStart(3, '0');
    return `RC-${yyyymmdd}-${seq}`;
  }

  private formatYYYYMMDD(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  /** Hash a string to int4 for pg_advisory_lock. */
  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
```

- [ ] **Step 2.4: Run tests until they pass**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/other-income/__tests__/doc-number.service.spec.ts
```

Expected: 4 tests pass. If a test fails because Prisma client wasn't regenerated after Task 1 step 1.7, run `npx prisma generate` and re-run.

- [ ] **Step 2.5: Commit**

```bash
git add apps/api/src/modules/other-income/
git commit -m "feat(other-income): add DocNumberService with advisory-lock per-day numbering

- nextDocNumber: OI-YYYYMMDD-NNNN
- nextReceiptNumber: RC-YYYYMMDD-NNN
- pg_advisory_xact_lock keyed by date to serialize concurrent insert
- 4 unit tests cover sequence/reset/receipt"
```

---

### Task 3: Validation service (V1-V14)

**Files:**
- Create: `apps/api/src/modules/other-income/services/validation.service.ts`
- Create: `apps/api/src/modules/other-income/__tests__/validation.spec.ts`
- Create: `apps/api/src/modules/other-income/__tests__/fixtures/golden-cases.ts`

**Behavioral spec for V1-V14:** see `docs/superpowers/specs/2026-05-06-other-income-module-design.md` §6.

- [ ] **Step 3.1: Define golden fixtures**

Create `apps/api/src/modules/other-income/__tests__/fixtures/golden-cases.ts`:

```typescript
import { Prisma } from '@prisma/client';

const D = (n: number | string) => new Prisma.Decimal(n);

/** Reusable doc factories used by validation + auto-journal tests. */
export const goldenCases = {
  /** ดอกเบี้ยฝาก KBank — ไม่มี VAT, มี WHT 15%. amountReceived = net (no adjustment) */
  bankInterest: {
    issueDate: new Date('2026-05-06'),
    paymentAccountCode: '11-1201',
    priceType: 'EXCLUSIVE' as const,
    counterpartyName: 'ธนาคารกสิกรไทย',
    items: [
      {
        lineNo: 1,
        accountCode: '42-1102',
        accountName: 'ดอกเบี้ยเงินฝาก',
        quantity: D(1),
        unitAmount: D(1000),
        discountAmount: D(0),
        vatPct: D(0),
        whtPct: D(15),
        amountBeforeVat: D(1000),
        vatAmount: D(0),
        whtAmount: D(150),
      },
    ],
    adjustments: [],
    amountReceived: D(850), // 1000 - 150 WHT
    incomeGross: D(1000),
    vatAmount: D(0),
    whtAmount: D(150),
    netReceived: D(850),
    totalAmount: D(1000),
  },

  /** กำไรขายโต๊ะให้ลูกค้านิติบุคคล — มี VAT 7%, WHT 1% */
  gainOnDisposal: {
    issueDate: new Date('2026-05-06'),
    paymentAccountCode: '11-1201',
    priceType: 'EXCLUSIVE' as const,
    customerId: 'cust-corp-1',
    items: [
      {
        lineNo: 1,
        accountCode: '42-1105',
        accountName: 'กำไรจากการจำหน่ายสินทรัพย์',
        quantity: D(1),
        unitAmount: D(10000),
        discountAmount: D(0),
        vatPct: D(7),
        whtPct: D(1),
        amountBeforeVat: D(10000),
        vatAmount: D(700),
        whtAmount: D(100),
      },
    ],
    adjustments: [],
    amountReceived: D(10600), // 10000 + 700 VAT - 100 WHT
    incomeGross: D(10000),
    vatAmount: D(700),
    whtAmount: D(100),
    netReceived: D(10600),
    totalAmount: D(10700),
  },

  /** ลูกค้าจ่ายขาด 10 บาท (bank fee) — adjustment 10 บาท ลง 53-1503 */
  bankInterestWithFee: {
    issueDate: new Date('2026-05-06'),
    paymentAccountCode: '11-1201',
    priceType: 'EXCLUSIVE' as const,
    counterpartyName: 'ธนาคารกสิกรไทย',
    items: [
      {
        lineNo: 1,
        accountCode: '42-1102',
        accountName: 'ดอกเบี้ยเงินฝาก',
        quantity: D(1),
        unitAmount: D(1000),
        discountAmount: D(0),
        vatPct: D(0),
        whtPct: D(15),
        amountBeforeVat: D(1000),
        vatAmount: D(0),
        whtAmount: D(150),
      },
    ],
    adjustments: [
      { lineNo: 1, accountCode: '53-1503', amount: D(10), note: 'ค่าธรรมเนียมแบงก์' },
    ],
    amountReceived: D(840), // 850 expected − 10 fee
    incomeGross: D(1000),
    vatAmount: D(0),
    whtAmount: D(150),
    netReceived: D(840),
    totalAmount: D(1000),
  },
};
```

- [ ] **Step 3.2: Write failing tests for V1-V14**

Create `apps/api/src/modules/other-income/__tests__/validation.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ValidationService, type ValidationContext } from '../services/validation.service';
import { goldenCases } from './fixtures/golden-cases';

const D = (n: number | string) => new Prisma.Decimal(n);

const baseCtx: ValidationContext = {
  isPeriodOpen: () => true,
  attachmentThreshold: 50000,
  hasAttachment: false,
};

describe('ValidationService', () => {
  let service: ValidationService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ValidationService],
    }).compile();
    service = module.get(ValidationService);
  });

  it('V1+V2+V5: passes a balanced minimal doc', () => {
    const result = service.validate(goldenCases.bankInterest, baseCtx);
    expect(result.errors).toEqual([]);
  });

  it('V1: detects unbalanced JE (Dr ≠ Cr)', () => {
    const doc = { ...goldenCases.bankInterest, amountReceived: D(800) }; // wrong cash
    const result = service.validate(doc, baseCtx);
    expect(result.errors.find((e) => e.rule === 'V1')).toBeDefined();
  });

  it('V3: requires issueDate + ≥1 item', () => {
    const doc = { ...goldenCases.bankInterest, items: [] };
    const result = service.validate(doc, baseCtx);
    expect(result.errors.find((e) => e.rule === 'V3')).toBeDefined();
  });

  it('V4: every item must use 42-XXXX account', () => {
    const doc = {
      ...goldenCases.bankInterest,
      items: [{ ...goldenCases.bankInterest.items[0], accountCode: '52-1104' }],
    };
    const result = service.validate(doc, baseCtx);
    expect(result.errors.find((e) => e.rule === 'V4')).toBeDefined();
  });

  it('V4: blocks 42-1103 (already auto-posted by PaymentReceipt2BTemplate)', () => {
    const doc = {
      ...goldenCases.bankInterest,
      items: [{ ...goldenCases.bankInterest.items[0], accountCode: '42-1103' }],
    };
    const result = service.validate(doc, baseCtx);
    const v4 = result.errors.find((e) => e.rule === 'V4');
    expect(v4?.msg).toMatch(/42-1103/);
  });

  it('V6: VAT% > 0 must coexist with VAT account on JE', () => {
    // ค่าเริ่มต้นของฟิกซ์เจอร์ gainOnDisposal มี VAT — สอดคล้องกัน → ผ่าน
    const ok = service.validate(goldenCases.gainOnDisposal, baseCtx);
    expect(ok.errors.find((e) => e.rule === 'V6')).toBeUndefined();
  });

  it('V7: warns on non-standard WHT% (does not block)', () => {
    const doc = {
      ...goldenCases.bankInterest,
      items: [{ ...goldenCases.bankInterest.items[0], whtPct: D(8) }],
    };
    const result = service.validate(doc, baseCtx);
    expect(result.warnings.find((w) => w.rule === 'V7')).toBeDefined();
    expect(result.errors.find((e) => e.rule === 'V7')).toBeUndefined();
  });

  it('V8: blocks when issueDate is in a closed period', () => {
    const result = service.validate(goldenCases.bankInterest, {
      ...baseCtx,
      isPeriodOpen: () => false,
    });
    expect(result.errors.find((e) => e.rule === 'V8')).toBeDefined();
  });

  it('V10+V12: blocks when adjustments do not cover diff', () => {
    const doc = {
      ...goldenCases.bankInterestWithFee,
      adjustments: [
        { ...goldenCases.bankInterestWithFee.adjustments[0], amount: D(5) }, // partial cover
      ],
    };
    const result = service.validate(doc, baseCtx);
    expect(result.errors.find((e) => e.rule === 'V12')).toBeDefined();
  });

  it('V11: blocks when amount ≥ threshold and no attachment', () => {
    const result = service.validate(goldenCases.gainOnDisposal, {
      ...baseCtx,
      attachmentThreshold: 5000,
      hasAttachment: false,
    });
    expect(result.errors.find((e) => e.rule === 'V11')).toBeDefined();
  });

  it('V13: blocks when adjustment row has no accountCode', () => {
    const doc = {
      ...goldenCases.bankInterestWithFee,
      adjustments: [{ ...goldenCases.bankInterestWithFee.adjustments[0], accountCode: '' }],
    };
    const result = service.validate(doc, baseCtx);
    expect(result.errors.find((e) => e.rule === 'V13')).toBeDefined();
  });
});
```

- [ ] **Step 3.3: Run failing tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/other-income/__tests__/validation.spec.ts
```

Expected: cannot find module — fail.

- [ ] **Step 3.4: Implement ValidationService**

Create `apps/api/src/modules/other-income/services/validation.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export interface ValidationItem {
  lineNo: number;
  accountCode: string;
  vatPct: Decimal;
  whtPct: Decimal;
  amountBeforeVat: Decimal;
  vatAmount: Decimal;
  whtAmount: Decimal;
}

export interface ValidationAdjustment {
  lineNo: number;
  accountCode: string;
  amount: Decimal;
}

export interface ValidationDoc {
  issueDate: Date | null | undefined;
  paymentAccountCode: string | null | undefined;
  amountReceived: Decimal;
  netReceived: Decimal;
  items: ValidationItem[];
  adjustments: ValidationAdjustment[];
}

export interface ValidationContext {
  /** Returns false if the issueDate falls in a closed accounting period (V8). */
  isPeriodOpen: (issueDate: Date) => boolean;
  /** Threshold above which an attachment is required (V11). */
  attachmentThreshold: number;
  /** True if at least one attachment is uploaded. */
  hasAttachment: boolean;
}

export interface ValidationIssue {
  rule: string; // 'V1'..'V14'
  msg: string;
  field?: string;
  lineNo?: number;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const VALID_WHT_PCT = [0, 1, 2, 3, 5, 7, 10, 15];
const BLOCKED_INCOME_CODES = new Set([
  '42-1103', // ค่าปรับ — already auto-posted by PaymentReceipt2BTemplate (see spec §2.2)
]);
const VAT_OUTPUT_CODES = new Set(['21-2101', '21-2102']);

@Injectable()
export class ValidationService {
  validate(doc: ValidationDoc, ctx: ValidationContext): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    // V3: header info
    if (!doc.issueDate) errors.push({ rule: 'V3', msg: 'กรุณาระบุวันที่ออกเอกสาร' });
    if (!doc.paymentAccountCode)
      errors.push({ rule: 'V3', msg: 'กรุณาเลือกช่องทางชำระเงิน' });

    // V2: at least 1 item (also covered partially by V3)
    if (!doc.items || doc.items.length === 0) {
      errors.push({ rule: 'V3', msg: 'ต้องมีรายการบัญชีอย่างน้อย 1 รายการ' });
    }

    // V4: every item is 42-XXXX, amount > 0, not in blocklist
    doc.items?.forEach((it) => {
      if (!it.accountCode || !it.accountCode.startsWith('42-')) {
        errors.push({
          rule: 'V4',
          lineNo: it.lineNo,
          msg: `รายการที่ ${it.lineNo}: ต้องเลือกบัญชีกลุ่ม 42-XXXX`,
        });
      } else if (BLOCKED_INCOME_CODES.has(it.accountCode)) {
        errors.push({
          rule: 'V4',
          lineNo: it.lineNo,
          msg: `บัญชี ${it.accountCode} ถูกบันทึกอัตโนมัติผ่านหน้ารับชำระค่างวดอยู่แล้ว — ไม่ต้องบันทึกซ้ำที่นี่`,
        });
      }
      if (it.amountBeforeVat.lte(0)) {
        errors.push({
          rule: 'V4',
          lineNo: it.lineNo,
          msg: `รายการที่ ${it.lineNo}: จำนวนเงินต้องมากกว่า 0`,
        });
      }
    });

    // V7: WHT% standard set (warning only)
    doc.items?.forEach((it) => {
      const pct = Number(it.whtPct);
      if (!VALID_WHT_PCT.includes(pct)) {
        warnings.push({
          rule: 'V7',
          lineNo: it.lineNo,
          msg: `WHT ${pct}% ไม่อยู่ในชุดมาตรฐาน {0,1,2,3,5,7,10,15}`,
        });
      }
    });

    // V6: VAT items must coexist with VAT account contributions
    const hasVatItem = doc.items?.some((it) => it.vatPct.gt(0)) ?? false;
    const requiresVatAccount = hasVatItem;
    if (requiresVatAccount) {
      // V6 cross-check vs JE happens at AutoJournalService — here we only flag missing setup
      const totalVat = (doc.items || []).reduce<Decimal>(
        (s, it) => s.plus(it.vatAmount),
        new D(0),
      );
      if (totalVat.lte(0)) {
        errors.push({
          rule: 'V6',
          msg: 'มีรายการ VAT% > 0 แต่ vat_amount = 0 — ตรวจสอบการคำนวณ',
        });
      }
    }

    // V8: period open
    if (doc.issueDate && !ctx.isPeriodOpen(doc.issueDate)) {
      const ym = `${doc.issueDate.getFullYear()}-${String(doc.issueDate.getMonth() + 1).padStart(2, '0')}`;
      errors.push({
        rule: 'V8',
        msg: `งวด ${ym} ปิดบัญชีแล้ว — ไม่สามารถบันทึกได้`,
      });
    }

    // V10+V12: amountReceived vs net + adjustment coverage
    const expectedNet = doc.netReceived;
    const diff = doc.amountReceived.minus(expectedNet); // signed
    if (!diff.eq(0)) {
      const adjSum = (doc.adjustments || []).reduce<Decimal>(
        (s, a) => s.plus(a.amount),
        new D(0),
      );
      if (doc.adjustments.length === 0) {
        errors.push({
          rule: 'V10',
          msg: `จำนวนรับ (${doc.amountReceived}) ไม่ตรงกับยอดสุทธิ (${expectedNet}) — ต้องระบุบัญชีปรับผลต่าง`,
        });
      } else if (!adjSum.eq(diff.abs())) {
        errors.push({
          rule: 'V12',
          msg: `ผลรวมบัญชีปรับ (${adjSum}) ไม่เท่ากับผลต่าง (${diff.abs()})`,
        });
      }
    }

    // V13+V14: each adjustment row sanity
    doc.adjustments?.forEach((adj) => {
      if (!adj.accountCode) {
        errors.push({
          rule: 'V13',
          lineNo: adj.lineNo,
          msg: `บัญชีปรับแถวที่ ${adj.lineNo} ยังไม่ได้เลือกบัญชี`,
        });
      }
      if (adj.amount.lte(0)) {
        errors.push({
          rule: 'V14',
          lineNo: adj.lineNo,
          msg: `บัญชีปรับแถวที่ ${adj.lineNo}: จำนวนต้องมากกว่า 0`,
        });
      }
    });

    // V11: attachment threshold
    if (
      doc.amountReceived.gte(ctx.attachmentThreshold) &&
      !ctx.hasAttachment
    ) {
      errors.push({
        rule: 'V11',
        msg: `ยอด ≥ ${ctx.attachmentThreshold} ฿ ต้องแนบไฟล์ประกอบอย่างน้อย 1 ไฟล์`,
      });
    }

    return { errors, warnings };
  }
}
```

- [ ] **Step 3.5: Run tests until they pass**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/other-income/__tests__/validation.spec.ts
```

Expected: 11 tests pass.

- [ ] **Step 3.6: Commit**

```bash
git add apps/api/src/modules/other-income/services/validation.service.ts apps/api/src/modules/other-income/__tests__/validation.spec.ts apps/api/src/modules/other-income/__tests__/fixtures/golden-cases.ts
git commit -m "feat(other-income): add ValidationService implementing V1-V14

- 11 unit tests cover each rule (golden cases for bank-interest, gain-on-disposal, with-bank-fee)
- V4 blocks 42-1103 with helpful message (already auto-posted via PaymentReceipt2BTemplate)
- V8 hooks via injected isPeriodOpen() callback (decoupled from AccountingPeriod model)
- V11 hooks via attachmentThreshold context"
```

---

### Task 4: Auto journal service (Pattern A)

Generates `JournalLineInput[]` from a doc + items + adjustments per spec §7.

**Files:**
- Create: `apps/api/src/modules/other-income/services/auto-journal.service.ts`
- Create: `apps/api/src/modules/other-income/__tests__/auto-journal.spec.ts`

- [ ] **Step 4.1: Write failing tests**

Create `apps/api/src/modules/other-income/__tests__/auto-journal.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AutoJournalService } from '../services/auto-journal.service';
import { goldenCases } from './fixtures/golden-cases';

const D = (n: number | string) => new Prisma.Decimal(n);

const sumDr = (lines: any[]) =>
  lines.reduce((s, l) => s.plus(l.debit), D(0));
const sumCr = (lines: any[]) =>
  lines.reduce((s, l) => s.plus(l.credit), D(0));

describe('AutoJournalService — Pattern A', () => {
  let service: AutoJournalService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AutoJournalService],
    }).compile();
    service = module.get(AutoJournalService);
  });

  it('bank interest (no VAT, with WHT 15%) — balanced', () => {
    const lines = service.generate(goldenCases.bankInterest);
    expect(sumDr(lines).eq(sumCr(lines))).toBe(true);
    // Dr 11-1201 850 + Dr 11-4103 150 / Cr 42-1102 1000
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: '11-1201', debit: D(850), credit: D(0) }),
        expect.objectContaining({ accountCode: '11-4103', debit: D(150), credit: D(0) }),
        expect.objectContaining({ accountCode: '42-1102', debit: D(0), credit: D(1000) }),
      ]),
    );
    expect(lines).toHaveLength(3);
  });

  it('gain on disposal (VAT 7%, WHT 1%) — balanced + VAT line', () => {
    const lines = service.generate(goldenCases.gainOnDisposal);
    expect(sumDr(lines).eq(sumCr(lines))).toBe(true);
    expect(
      lines.find((l) => l.accountCode === '21-2101' && l.credit.eq(700)),
    ).toBeDefined();
    expect(
      lines.find((l) => l.accountCode === '42-1105' && l.credit.eq(10000)),
    ).toBeDefined();
  });

  it('bank interest with bank fee — adjustment in Dr (ขาด)', () => {
    const lines = service.generate(goldenCases.bankInterestWithFee);
    expect(sumDr(lines).eq(sumCr(lines))).toBe(true);
    expect(
      lines.find(
        (l) => l.accountCode === '53-1503' && l.debit.eq(10),
      ),
    ).toBeDefined();
  });

  it('over-payment — adjustment in Cr (เกิน)', () => {
    const overpaid = {
      ...goldenCases.bankInterest,
      amountReceived: D(870), // 20 over the 850 net
      adjustments: [
        { lineNo: 1, accountCode: '53-1503', amount: D(20), note: 'roundup' },
      ],
    };
    const lines = service.generate(overpaid);
    expect(sumDr(lines).eq(sumCr(lines))).toBe(true);
    expect(
      lines.find(
        (l) => l.accountCode === '53-1503' && l.credit.eq(20),
      ),
    ).toBeDefined();
  });

  it('omits Dr cash line when amountReceived = 0 (rare edge)', () => {
    const noCash = { ...goldenCases.bankInterest, amountReceived: D(0) };
    const lines = service.generate(noCash);
    expect(lines.find((l) => l.accountCode === '11-1201')).toBeUndefined();
  });

  it('multi-item document — multiple Cr 42-XXXX lines', () => {
    const multi = {
      ...goldenCases.gainOnDisposal,
      items: [
        { ...goldenCases.gainOnDisposal.items[0] },
        {
          lineNo: 2,
          accountCode: '42-1105',
          accountName: 'กำไรจากการจำหน่ายสินทรัพย์',
          quantity: D(1),
          unitAmount: D(5000),
          discountAmount: D(0),
          vatPct: D(7),
          whtPct: D(1),
          amountBeforeVat: D(5000),
          vatAmount: D(350),
          whtAmount: D(50),
        },
      ],
      amountReceived: D(15900), // 15000 + 1050 VAT - 150 WHT
      incomeGross: D(15000),
      vatAmount: D(1050),
      whtAmount: D(150),
      netReceived: D(15900),
      totalAmount: D(16050),
    };
    const lines = service.generate(multi);
    expect(sumDr(lines).eq(sumCr(lines))).toBe(true);
    const incomeLines = lines.filter((l) => l.accountCode === '42-1105');
    expect(incomeLines).toHaveLength(2);
  });
});
```

- [ ] **Step 4.2: Run failing tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/other-income/__tests__/auto-journal.spec.ts
```

Expected: cannot find module → fail.

- [ ] **Step 4.3: Implement AutoJournalService**

Create `apps/api/src/modules/other-income/services/auto-journal.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export interface JeLineInput {
  accountCode: string;
  debit: Decimal;
  credit: Decimal;
  description?: string;
}

export interface AutoJournalItem {
  lineNo: number;
  accountCode: string;
  accountName: string;
  description?: string | null;
  amountBeforeVat: Decimal;
  vatAmount: Decimal;
  whtAmount: Decimal;
  whtPct: Decimal;
}

export interface AutoJournalAdjustment {
  lineNo: number;
  accountCode: string;
  amount: Decimal;
  note?: string | null;
}

export interface AutoJournalDoc {
  paymentAccountCode: string;
  amountReceived: Decimal;
  netReceived: Decimal;
  items: AutoJournalItem[];
  adjustments: AutoJournalAdjustment[];
}

const ZERO = new D(0);

/** Account code constants per design §7 */
const WHT_RECEIVABLE_CODE = '11-4103';
const VAT_OUTPUT_CODE = '21-2101'; // cash-basis settle

@Injectable()
export class AutoJournalService {
  /**
   * Generate balanced JE lines for an OtherIncome doc (Pattern A).
   * Caller is responsible for V1 (Dr=Cr) check via tests; this method is
   * mathematically guaranteed balanced when item totals are pre-computed correctly.
   */
  generate(doc: AutoJournalDoc): JeLineInput[] {
    const lines: JeLineInput[] = [];

    const totalVat = doc.items.reduce<Decimal>(
      (s, it) => s.plus(it.vatAmount),
      ZERO,
    );
    const totalWht = doc.items.reduce<Decimal>(
      (s, it) => s.plus(it.whtAmount),
      ZERO,
    );

    // 1. Cash/Bank in (Dr) — only when amountReceived > 0
    if (doc.amountReceived.gt(0)) {
      lines.push({
        accountCode: doc.paymentAccountCode,
        debit: doc.amountReceived,
        credit: ZERO,
        description: 'รับเงินจริง',
      });
    }

    // 2. WHT receivable (Dr) — when any item has WHT
    if (totalWht.gt(0)) {
      const firstWhtPct = doc.items.find((i) => i.whtAmount.gt(0))?.whtPct;
      lines.push({
        accountCode: WHT_RECEIVABLE_CODE,
        debit: totalWht,
        credit: ZERO,
        description: firstWhtPct
          ? `ภาษีหัก ณ ที่จ่าย ${firstWhtPct}%`
          : 'ภาษีหัก ณ ที่จ่าย',
      });
    }

    // 3. Adjustments — sign depends on direction of diff
    const diff = doc.amountReceived.minus(doc.netReceived); // signed
    for (const adj of doc.adjustments) {
      if (diff.lt(0)) {
        // received < net → Dr gap (e.g. fee/discount)
        lines.push({
          accountCode: adj.accountCode,
          debit: adj.amount,
          credit: ZERO,
          description: adj.note ?? 'ปรับผลต่าง (ขาด)',
        });
      } else {
        // received > net → Cr gap (e.g. gain/extra income)
        lines.push({
          accountCode: adj.accountCode,
          debit: ZERO,
          credit: adj.amount,
          description: adj.note ?? 'ปรับผลต่าง (เกิน)',
        });
      }
    }

    // 4. Income (Cr) — one line per item
    for (const item of doc.items) {
      lines.push({
        accountCode: item.accountCode,
        debit: ZERO,
        credit: item.amountBeforeVat,
        description: item.description ?? item.accountName,
      });
    }

    // 5. VAT Output (Cr) — direct to 21-2101 (cash-basis settlement)
    if (totalVat.gt(0)) {
      lines.push({
        accountCode: VAT_OUTPUT_CODE,
        debit: ZERO,
        credit: totalVat,
        description: 'ภาษีขาย ภ.พ.30',
      });
    }

    return lines;
  }
}
```

- [ ] **Step 4.4: Run tests until they pass**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/other-income/__tests__/auto-journal.spec.ts
```

Expected: 6 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/modules/other-income/services/auto-journal.service.ts apps/api/src/modules/other-income/__tests__/auto-journal.spec.ts
git commit -m "feat(other-income): add AutoJournalService Pattern A generator

- Balanced Dr/Cr generation: cash + WHT-receivable / income + VAT-output
- Multi-line adjustments: Dr when received<net, Cr when received>net
- Cash-basis VAT settles to 21-2101 directly (per spec §7 rationale)
- 6 golden-case tests cover no-VAT/with-VAT/with-fee/over-pay/no-cash/multi-item"
```

---

### Task 5: OtherIncomeService — CRUD (DRAFT lifecycle)

**Files:**
- Create: `apps/api/src/modules/other-income/other-income.service.ts`
- Create: `apps/api/src/modules/other-income/dto/create-other-income.dto.ts`
- Create: `apps/api/src/modules/other-income/dto/update-other-income.dto.ts`
- Create: `apps/api/src/modules/other-income/dto/list-other-income-query.dto.ts`
- Create: `apps/api/src/modules/other-income/__tests__/other-income.service.spec.ts`

**Helpers used (project conventions):**
- `apps/api/src/utils/decimal.util.ts` — `d`, `dAdd`, `dMul`, `dRound`
- `apps/api/src/utils/period-lock.util.ts` — `validatePeriodOpen`

- [ ] **Step 5.1: Create CreateOtherIncomeDto**

Create `apps/api/src/modules/other-income/dto/create-other-income.dto.ts`:

```typescript
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OtherIncomePriceType } from '@prisma/client';

export class OtherIncomeItemDto {
  @IsString()
  accountCode!: string; // 42-XXXX

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitAmount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  vatPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  whtPct?: number;
}

export class OtherIncomeAdjustmentDto {
  @IsString()
  accountCode!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateOtherIncomeDto {
  @IsDateString()
  issueDate!: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsEnum(OtherIncomePriceType)
  priceType!: OtherIncomePriceType;

  // Counterparty (all optional)
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  counterpartyName?: string;

  @IsOptional()
  @IsString()
  counterpartyTaxId?: string;

  @IsOptional()
  @IsString()
  counterpartyAddress?: string;

  @IsOptional()
  @IsString()
  counterpartyPhone?: string;

  @IsString()
  paymentAccountCode!: string; // 11-1101..11-1203

  @IsNumber()
  @Min(0)
  amountReceived!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OtherIncomeItemDto)
  items!: OtherIncomeItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OtherIncomeAdjustmentDto)
  adjustments?: OtherIncomeAdjustmentDto[];

  @IsOptional()
  @IsString()
  customerNote?: string;
}
```

- [ ] **Step 5.2: Create UpdateOtherIncomeDto**

Create `apps/api/src/modules/other-income/dto/update-other-income.dto.ts`:

```typescript
import { PartialType } from '@nestjs/mapped-types';
import { CreateOtherIncomeDto } from './create-other-income.dto';

export class UpdateOtherIncomeDto extends PartialType(CreateOtherIncomeDto) {}
```

- [ ] **Step 5.3: Create ListOtherIncomeQueryDto**

Create `apps/api/src/modules/other-income/dto/list-other-income-query.dto.ts`:

```typescript
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { OtherIncomeStatus } from '@prisma/client';

export class ListOtherIncomeQueryDto {
  @IsOptional()
  @IsEnum(OtherIncomeStatus)
  status?: OtherIncomeStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  q?: string; // searches docNumber, counterpartyName, customer.name

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
```

- [ ] **Step 5.4: Write failing service tests (CRUD)**

Create `apps/api/src/modules/other-income/__tests__/other-income.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { OtherIncomeService } from '../other-income.service';
import { DocNumberService } from '../services/doc-number.service';
import { ValidationService } from '../services/validation.service';
import { AutoJournalService } from '../services/auto-journal.service';
import { OtherIncomeTemplate } from '../templates/other-income.template';

const D = (n: number | string) => new Prisma.Decimal(n);

describe('OtherIncomeService — CRUD', () => {
  let service: OtherIncomeService;
  let prisma: PrismaService;
  let companyId: string;
  let userId: string;

  beforeAll(async () => {
    // Note: T5 only tests CRUD which doesn't call template.post().
    // Provide a stub OtherIncomeTemplate to satisfy DI (real one comes online in T6).
    const stubTemplate = { post: async () => ({ id: 'stub-je', entryNumber: 'JE-STUB' }) };

    const module = await Test.createTestingModule({
      providers: [
        OtherIncomeService,
        DocNumberService,
        ValidationService,
        AutoJournalService,
        PrismaService,
        { provide: OtherIncomeTemplate, useValue: stubTemplate },
      ],
    }).compile();
    service = module.get(OtherIncomeService);
    prisma = module.get(PrismaService);

    // Seed minimum required: a FINANCE company + a user
    const co = await prisma.companyInfo.upsert({
      where: { code: 'FINANCE' },
      update: {},
      create: {
        code: 'FINANCE',
        name: 'BESTCHOICE FINANCE',
        legalName: 'BESTCHOICE FINANCE',
        taxId: '0000000000001',
        address: 'TEST',
        isVatRegistered: true,
      },
    });
    companyId = co.id;

    const user = await prisma.user.create({
      data: {
        email: `oi-test+${Date.now()}@bestchoice.test`,
        password: 'x',
        name: 'OI Tester',
        role: 'ACCOUNTANT',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.otherIncome.deleteMany({});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('creates a DRAFT with items and computes totals', async () => {
    const draft = await service.create({
      issueDate: '2026-05-06',
      priceType: 'EXCLUSIVE',
      paymentAccountCode: '11-1201',
      amountReceived: 850,
      counterpartyName: 'KBank',
      items: [
        {
          accountCode: '42-1102',
          description: 'ดอกเบี้ยฝาก พ.ค. 69',
          quantity: 1,
          unitAmount: 1000,
          vatPct: 0,
          whtPct: 15,
        },
      ],
    }, userId);

    expect(draft.status).toBe('DRAFT');
    expect(draft.docNumber).toMatch(/^OI-20260506-\d{4}$/);
    expect(D(draft.incomeGross).eq(1000)).toBe(true);
    expect(D(draft.whtAmount).eq(150)).toBe(true);
    expect(D(draft.netReceived).eq(850)).toBe(true);
  });

  it('updates a DRAFT (replaces items wholesale)', async () => {
    const draft = await service.create({
      issueDate: '2026-05-06',
      priceType: 'EXCLUSIVE',
      paymentAccountCode: '11-1201',
      amountReceived: 850,
      items: [
        { accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 },
      ],
    }, userId);

    const updated = await service.update(draft.id, {
      amountReceived: 1700,
      items: [
        { accountCode: '42-1102', quantity: 1, unitAmount: 2000, whtPct: 15 },
      ],
    }, userId);

    expect(D(updated.incomeGross).eq(2000)).toBe(true);
    expect(D(updated.netReceived).eq(1700)).toBe(true);
  });

  it('refuses to update a POSTED doc (404)', async () => {
    // We'll mark a draft as POSTED directly for this test (post() flow tested separately)
    const draft = await service.create({
      issueDate: '2026-05-06',
      priceType: 'EXCLUSIVE',
      paymentAccountCode: '11-1201',
      amountReceived: 850,
      items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
    }, userId);
    await prisma.otherIncome.update({
      where: { id: draft.id },
      data: { status: 'POSTED', postedAt: new Date() },
    });

    await expect(
      service.update(draft.id, { amountReceived: 999 }, userId),
    ).rejects.toThrow(/POSTED/);
  });

  it('soft-deletes a DRAFT', async () => {
    const draft = await service.create({
      issueDate: '2026-05-06',
      priceType: 'EXCLUSIVE',
      paymentAccountCode: '11-1201',
      amountReceived: 850,
      items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
    }, userId);

    await service.softDelete(draft.id, userId);

    const found = await prisma.otherIncome.findUnique({ where: { id: draft.id } });
    expect(found?.deletedAt).not.toBeNull();
  });

  it('refuses to delete a POSTED doc', async () => {
    const draft = await service.create({
      issueDate: '2026-05-06',
      priceType: 'EXCLUSIVE',
      paymentAccountCode: '11-1201',
      amountReceived: 850,
      items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
    }, userId);
    await prisma.otherIncome.update({
      where: { id: draft.id },
      data: { status: 'POSTED', postedAt: new Date() },
    });

    await expect(service.softDelete(draft.id, userId)).rejects.toThrow();
  });
});
```

- [ ] **Step 5.5: Run failing tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/other-income/__tests__/other-income.service.spec.ts
```

Expected: cannot find `../other-income.service` → fail.

- [ ] **Step 5.6: Implement OtherIncomeService — CRUD methods**

Create `apps/api/src/modules/other-income/other-income.service.ts`:

```typescript
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { OtherIncomeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DocNumberService } from './services/doc-number.service';
import { ValidationService } from './services/validation.service';
import { AutoJournalService } from './services/auto-journal.service';
import { CreateOtherIncomeDto, OtherIncomeItemDto } from './dto/create-other-income.dto';
import { UpdateOtherIncomeDto } from './dto/update-other-income.dto';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

const ZERO = new D(0);

interface ComputedItem {
  amountBeforeVat: Decimal;
  vatAmount: Decimal;
  whtAmount: Decimal;
}

@Injectable()
export class OtherIncomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly validation: ValidationService,
    private readonly autoJournal: AutoJournalService,
  ) {}

  // -- Public API --------------------------------------------------------

  async create(dto: CreateOtherIncomeDto, userId: string) {
    const companyId = await this.resolveFinanceCompanyId();

    return this.prisma.$transaction(async (tx) => {
      const issueDate = new Date(dto.issueDate);
      const docNumber = await this.docNumber.nextDocNumber(tx, issueDate);
      const totals = this.computeTotals(dto);

      return tx.otherIncome.create({
        data: {
          docNumber,
          companyId,
          status: OtherIncomeStatus.DRAFT,
          issueDate,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : null,
          priceType: dto.priceType,
          customerId: dto.customerId ?? null,
          counterpartyName: dto.counterpartyName ?? null,
          counterpartyTaxId: dto.counterpartyTaxId ?? null,
          counterpartyAddress: dto.counterpartyAddress ?? null,
          counterpartyPhone: dto.counterpartyPhone ?? null,
          paymentAccountCode: dto.paymentAccountCode,
          amountReceived: new D(dto.amountReceived),
          incomeGross: totals.incomeGross,
          vatAmount: totals.vatAmount,
          whtAmount: totals.whtAmount,
          netReceived: totals.netReceived,
          totalAmount: totals.totalAmount,
          customerNote: dto.customerNote ?? null,
          createdById: userId,
          items: { create: totals.items },
          adjustments: dto.adjustments
            ? {
                create: dto.adjustments.map((a, i) => ({
                  lineNo: i + 1,
                  accountCode: a.accountCode,
                  amount: new D(a.amount),
                  note: a.note ?? null,
                })),
              }
            : undefined,
        },
        include: { items: true, adjustments: true },
      });
    });
  }

  async update(id: string, dto: UpdateOtherIncomeDto, userId: string) {
    const existing = await this.findOneOrFail(id);
    if (existing.status !== OtherIncomeStatus.DRAFT) {
      throw new ConflictException(
        `เอกสาร ${existing.docNumber} เป็น POSTED แล้ว ไม่สามารถแก้ไขได้ — ใช้ Reverse Entry`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Replace items + adjustments wholesale (simpler than diffing)
      if (dto.items) {
        await tx.otherIncomeItem.deleteMany({ where: { otherIncomeId: id } });
      }
      if (dto.adjustments !== undefined) {
        await tx.otherIncomeAdjustment.deleteMany({ where: { otherIncomeId: id } });
      }

      const merged: CreateOtherIncomeDto = {
        issueDate: dto.issueDate ?? existing.issueDate.toISOString(),
        dueDate: dto.dueDate ?? existing.dueDate?.toISOString(),
        paymentDate: dto.paymentDate ?? existing.paymentDate?.toISOString(),
        priceType: dto.priceType ?? existing.priceType,
        paymentAccountCode: dto.paymentAccountCode ?? existing.paymentAccountCode,
        amountReceived: dto.amountReceived ?? Number(existing.amountReceived),
        items: (dto.items ?? existing.items) as OtherIncomeItemDto[],
        adjustments: dto.adjustments ?? existing.adjustments?.map((a) => ({
          accountCode: a.accountCode,
          amount: Number(a.amount),
          note: a.note ?? undefined,
        })),
        customerId: dto.customerId ?? existing.customerId ?? undefined,
        counterpartyName: dto.counterpartyName ?? existing.counterpartyName ?? undefined,
        counterpartyTaxId: dto.counterpartyTaxId ?? existing.counterpartyTaxId ?? undefined,
        counterpartyAddress:
          dto.counterpartyAddress ?? existing.counterpartyAddress ?? undefined,
        counterpartyPhone: dto.counterpartyPhone ?? existing.counterpartyPhone ?? undefined,
        customerNote: dto.customerNote ?? existing.customerNote ?? undefined,
      };
      const totals = this.computeTotals(merged);

      return tx.otherIncome.update({
        where: { id },
        data: {
          issueDate: new Date(merged.issueDate),
          dueDate: merged.dueDate ? new Date(merged.dueDate) : null,
          paymentDate: merged.paymentDate ? new Date(merged.paymentDate) : null,
          priceType: merged.priceType,
          paymentAccountCode: merged.paymentAccountCode,
          amountReceived: new D(merged.amountReceived),
          incomeGross: totals.incomeGross,
          vatAmount: totals.vatAmount,
          whtAmount: totals.whtAmount,
          netReceived: totals.netReceived,
          totalAmount: totals.totalAmount,
          customerId: merged.customerId ?? null,
          counterpartyName: merged.counterpartyName ?? null,
          counterpartyTaxId: merged.counterpartyTaxId ?? null,
          counterpartyAddress: merged.counterpartyAddress ?? null,
          counterpartyPhone: merged.counterpartyPhone ?? null,
          customerNote: merged.customerNote ?? null,
          items: dto.items ? { create: totals.items } : undefined,
          adjustments:
            dto.adjustments !== undefined
              ? {
                  create: (dto.adjustments ?? []).map((a, i) => ({
                    lineNo: i + 1,
                    accountCode: a.accountCode,
                    amount: new D(a.amount),
                    note: a.note ?? null,
                  })),
                }
              : undefined,
        },
        include: { items: true, adjustments: true },
      });
    });
  }

  async softDelete(id: string, userId: string) {
    const existing = await this.findOneOrFail(id);
    if (existing.status !== OtherIncomeStatus.DRAFT) {
      throw new ConflictException(
        `เอกสาร POSTED/REVERSED ลบไม่ได้ — ใช้ Reverse Entry`,
      );
    }
    return this.prisma.otherIncome.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async findOneOrFail(id: string) {
    const doc = await this.prisma.otherIncome.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: { orderBy: { lineNo: 'asc' } },
        adjustments: { orderBy: { lineNo: 'asc' } },
        attachments: true,
        customer: true,
      },
    });
    if (!doc) throw new NotFoundException(`OtherIncome ${id} not found`);
    return doc;
  }

  // -- Helpers -----------------------------------------------------------

  /**
   * Resolves the FINANCE companyId. We always use FINANCE for 42-XXXX entries
   * (the SHOP entity does not appear in the chart-of-accounts for this module).
   */
  private async resolveFinanceCompanyId(): Promise<string> {
    const co = await this.prisma.companyInfo.findUnique({
      where: { code: 'FINANCE' },
      select: { id: true },
    });
    if (!co) {
      throw new BadRequestException(
        'CompanyInfo with code=FINANCE not found — seed accounting data first',
      );
    }
    return co.id;
  }

  /**
   * Compute per-item amounts and roll up totals.
   * Mirrors prototype `computeItem()` in the design.
   */
  private computeTotals(dto: CreateOtherIncomeDto) {
    const items = dto.items.map((it, i) => this.computeItem(it, dto.priceType, i + 1));
    const incomeGross = items.reduce<Decimal>((s, it) => s.plus(it.amountBeforeVat), ZERO);
    const vatAmount = items.reduce<Decimal>((s, it) => s.plus(it.vatAmount), ZERO);
    const whtAmount = items.reduce<Decimal>((s, it) => s.plus(it.whtAmount), ZERO);
    const totalAmount = incomeGross.plus(vatAmount);
    const netReceived = totalAmount.minus(whtAmount);

    return { items, incomeGross, vatAmount, whtAmount, totalAmount, netReceived };
  }

  private computeItem(
    it: OtherIncomeItemDto,
    priceType: 'EXCLUSIVE' | 'INCLUSIVE',
    lineNo: number,
  ): ComputedItem & {
    lineNo: number;
    accountCode: string;
    accountName: string;
    description: string | null;
    quantity: Decimal;
    unitAmount: Decimal;
    discountAmount: Decimal;
    vatPct: Decimal;
    whtPct: Decimal;
  } {
    const qty = new D(it.quantity);
    const unit = new D(it.unitAmount);
    const disc = new D(it.discountAmount ?? 0);
    const vatPct = new D(it.vatPct ?? 0);
    const whtPct = new D(it.whtPct ?? 0);

    const gross = qty.times(unit).minus(disc);
    let amountBeforeVat: Decimal;
    let vatAmount: Decimal;

    if (vatPct.gt(0)) {
      if (priceType === 'INCLUSIVE') {
        const factor = new D(1).plus(vatPct.div(100));
        amountBeforeVat = gross.div(factor).toDecimalPlaces(2);
        vatAmount = gross.minus(amountBeforeVat);
      } else {
        amountBeforeVat = gross;
        vatAmount = gross.times(vatPct).div(100).toDecimalPlaces(2);
      }
    } else {
      amountBeforeVat = gross;
      vatAmount = ZERO;
    }
    const whtAmount = amountBeforeVat.times(whtPct).div(100).toDecimalPlaces(2);

    return {
      lineNo,
      accountCode: it.accountCode,
      accountName: '', // filled by service caller using ChartOfAccount lookup before persist
      description: it.description ?? null,
      quantity: qty,
      unitAmount: unit,
      discountAmount: disc,
      vatPct,
      whtPct,
      amountBeforeVat,
      vatAmount,
      whtAmount,
    };
  }
}
```

**Note on `accountName` snapshot:** the snapshot is filled in `create()` by looking up `ChartOfAccount.findMany({ where: { code: { in: codes } } })` before `tx.otherIncome.create`. Add this lookup in step 5.7.

- [ ] **Step 5.7: Wire ChartOfAccount lookup for accountName snapshot**

Edit `apps/api/src/modules/other-income/other-income.service.ts`. In the `create()` method, **immediately before** `return tx.otherIncome.create({ ... })`, add:

```typescript
      // Snapshot accountName from ChartOfAccount
      const codes = totals.items.map((it) => it.accountCode);
      const coaRows = await tx.chartOfAccount.findMany({
        where: { code: { in: codes } },
        select: { code: true, name: true },
      });
      const nameByCode = Object.fromEntries(coaRows.map((r) => [r.code, r.name]));
      const itemsWithName = totals.items.map((it) => ({
        ...it,
        accountName: nameByCode[it.accountCode] ?? it.accountCode,
      }));
      const missingCoa = codes.filter((c) => !nameByCode[c]);
      if (missingCoa.length > 0) {
        throw new BadRequestException(
          `Account codes not found in ChartOfAccount: ${missingCoa.join(', ')}`,
        );
      }
```

Then change `items: { create: totals.items }` to `items: { create: itemsWithName }`.

Apply the same lookup-and-substitute logic to the `update()` method when `dto.items` is provided.

- [ ] **Step 5.8: Run tests until they pass**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/other-income/__tests__/other-income.service.spec.ts
```

Expected: 5 tests pass. If `companyInfo.upsert` fails because seed data is missing, ensure the test DB has the FINANCE company (or skip with `it.skip` and address in T8 integration).

- [ ] **Step 5.9: Commit**

```bash
git add apps/api/src/modules/other-income/
git commit -m "feat(other-income): add OtherIncomeService CRUD (DRAFT lifecycle)

- create/update/softDelete with DRAFT-only state guard
- Decimal-safe item totals (priceType-aware Exclusive/Inclusive)
- accountName snapshot via ChartOfAccount lookup
- 5 service tests cover create/update/post-locked/soft-delete/post-locked-delete"
```

---

### Task 6: OtherIncomeService — post, reverse, copy, dailySheet

**Files:**
- Modify: `apps/api/src/modules/other-income/other-income.service.ts`
- Create: `apps/api/src/modules/other-income/templates/other-income.template.ts`
- Create: `apps/api/src/modules/other-income/dto/post-other-income.dto.ts`
- Create: `apps/api/src/modules/other-income/dto/reverse-other-income.dto.ts`
- Create: `apps/api/src/modules/other-income/dto/daily-sheet-query.dto.ts`
- Modify: `apps/api/src/modules/other-income/__tests__/other-income.service.spec.ts`

- [ ] **Step 6.1: Create remaining DTOs**

Create `apps/api/src/modules/other-income/dto/post-other-income.dto.ts`:

```typescript
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class OverrideJournalLineDto {
  @IsString()
  accountCode!: string;

  @IsNumber()
  debit!: number;

  @IsNumber()
  credit!: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class PostOtherIncomeDto {
  @IsOptional()
  @IsBoolean()
  override?: boolean;

  /** Required when override === true. Auto-generated otherwise. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OverrideJournalLineDto)
  overrideLines?: OverrideJournalLineDto[];
}
```

Create `apps/api/src/modules/other-income/dto/reverse-other-income.dto.ts`:

```typescript
import { IsEnum, IsString, MinLength } from 'class-validator';
import { OtherIncomeReverseReason } from '@prisma/client';

export class ReverseOtherIncomeDto {
  @IsEnum(OtherIncomeReverseReason)
  reason!: OtherIncomeReverseReason;

  @IsString()
  @MinLength(5)
  note!: string;
}
```

Create `apps/api/src/modules/other-income/dto/daily-sheet-query.dto.ts`:

```typescript
import { IsDateString } from 'class-validator';

export class DailySheetQueryDto {
  @IsDateString()
  date!: string; // YYYY-MM-DD
}
```

- [ ] **Step 6.2: Create OtherIncomeTemplate (JE template)**

Create `apps/api/src/modules/other-income/templates/other-income.template.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JournalAutoService } from '../../journal/journal-auto.service';
import type { JeLineInput } from '../services/auto-journal.service';

interface OtherIncomeJeInput {
  docNumber: string;
  description: string; // shown in JE.description
  entryDate: Date;
  lines: JeLineInput[];
  otherIncomeId: string;
}

/**
 * Wrapper around JournalAutoService.createAndPost that tags the entry
 * with referenceType='OTHER_INCOME' and the OtherIncome.id as referenceId.
 *
 * Mirrors the existing cpa-templates pattern (e.g. EarlyPayoffJP4Template).
 */
@Injectable()
export class OtherIncomeTemplate {
  constructor(private readonly journal: JournalAutoService) {}

  async post(
    input: OtherIncomeJeInput,
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string; entryNumber: string }> {
    return this.journal.createAndPost(
      {
        description: input.description,
        entryDate: input.entryDate,
        referenceType: 'OTHER_INCOME',
        referenceId: input.otherIncomeId,
        lines: input.lines,
      },
      tx,
    );
  }
}
```

**Note:** confirm `JournalAutoService.createAndPost` accepts `referenceType`/`referenceId` in its input type. If it doesn't, this task adds those fields — see step 6.2.1.

- [ ] **Step 6.2.1: Verify/extend JournalAutoService.createAndPost signature**

Open `apps/api/src/modules/journal/journal-auto.service.ts`. Find `createAndPost` and check whether the input type already accepts `referenceType` and `referenceId`. If not, extend:

```typescript
// Inside the input type definition:
export interface CreateAndPostInput {
  description: string;
  entryDate?: Date;
  referenceType?: string; // e.g. 'OTHER_INCOME'
  referenceId?: string;
  metadata?: Prisma.InputJsonValue;
  lines: JeLineInput[];
}
```

And inside the implementation, ensure both fields are passed to `tx.journalEntry.create({ data: { ..., referenceType, referenceId, ... } })`. If the existing code already supports this (likely — `referenceType`/`referenceId` are columns on JournalEntry), no change needed.

If a change was made, run `./tools/check-types.sh api` and fix any compile errors before proceeding.

- [ ] **Step 6.3: Add post() / reverse() / copy() to OtherIncomeService**

Edit `apps/api/src/modules/other-income/other-income.service.ts`. Add these imports at the top:

```typescript
import { OtherIncomeTemplate } from './templates/other-income.template';
import { OtherIncomeReverseReason } from '@prisma/client';
import { PostOtherIncomeDto } from './dto/post-other-income.dto';
import { ReverseOtherIncomeDto } from './dto/reverse-other-income.dto';
import { validatePeriodOpen } from '../../utils/period-lock.util';
```

Update the constructor signature to inject `OtherIncomeTemplate`:

```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly validation: ValidationService,
    private readonly autoJournal: AutoJournalService,
    private readonly template: OtherIncomeTemplate,
  ) {}
``` Append these public methods (after `softDelete`, before private helpers):

```typescript
  /**
   * Post a DRAFT to ledger:
   * 1. Run V1-V14
   * 2. Generate JE lines (auto or override)
   * 3. Create+post JE via OtherIncomeTemplate
   * 4. Update OtherIncome → POSTED with receiptNo + journalEntryId
   * All within a single Prisma transaction.
   */
  async post(id: string, dto: PostOtherIncomeDto, userId: string) {
    const doc = await this.findOneOrFail(id);
    if (doc.status !== OtherIncomeStatus.DRAFT) {
      throw new ConflictException(
        `เอกสาร ${doc.docNumber} ไม่ใช่ DRAFT (สถานะปัจจุบัน: ${doc.status})`,
      );
    }

    // Read attachment threshold from settings (with fallback)
    const threshold = await this.getAttachmentThreshold();

    // V8 hook: query AccountingPeriod
    const isPeriodOpen = async (issueDate: Date) => {
      try {
        await validatePeriodOpen(this.prisma, issueDate);
        return true;
      } catch {
        return false;
      }
    };
    const periodOk = await isPeriodOpen(doc.issueDate);

    const validation = this.validation.validate(
      {
        issueDate: doc.issueDate,
        paymentAccountCode: doc.paymentAccountCode,
        amountReceived: doc.amountReceived,
        netReceived: doc.netReceived,
        items: doc.items.map((it) => ({
          lineNo: it.lineNo,
          accountCode: it.accountCode,
          vatPct: it.vatPct,
          whtPct: it.whtPct,
          amountBeforeVat: it.amountBeforeVat,
          vatAmount: it.vatAmount,
          whtAmount: it.whtAmount,
        })),
        adjustments: doc.adjustments.map((a) => ({
          lineNo: a.lineNo,
          accountCode: a.accountCode,
          amount: a.amount,
        })),
      },
      {
        isPeriodOpen: () => periodOk,
        attachmentThreshold: threshold,
        hasAttachment: doc.attachments.length > 0,
      },
    );

    if (validation.errors.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const lines = dto.override && dto.overrideLines
        ? dto.overrideLines.map((l) => ({
            accountCode: l.accountCode,
            debit: new D(l.debit),
            credit: new D(l.credit),
            description: l.description,
          }))
        : this.autoJournal.generate({
            paymentAccountCode: doc.paymentAccountCode,
            amountReceived: doc.amountReceived,
            netReceived: doc.netReceived,
            items: doc.items.map((it) => ({
              lineNo: it.lineNo,
              accountCode: it.accountCode,
              accountName: it.accountName,
              description: it.description,
              amountBeforeVat: it.amountBeforeVat,
              vatAmount: it.vatAmount,
              whtAmount: it.whtAmount,
              whtPct: it.whtPct,
            })),
            adjustments: doc.adjustments.map((a) => ({
              lineNo: a.lineNo,
              accountCode: a.accountCode,
              amount: a.amount,
              note: a.note,
            })),
          });

      // Final V1 sanity check
      const totalDr = lines.reduce<Decimal>((s, l) => s.plus(l.debit), ZERO);
      const totalCr = lines.reduce<Decimal>((s, l) => s.plus(l.credit), ZERO);
      if (!totalDr.eq(totalCr)) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: [{ rule: 'V1', msg: `Dr=${totalDr} ≠ Cr=${totalCr}` }],
        });
      }

      const je = await this.template.post(
        {
          docNumber: doc.docNumber,
          description: `บันทึกรายได้อื่น ${doc.docNumber}`,
          entryDate: doc.issueDate,
          lines,
          otherIncomeId: doc.id,
        },
        tx,
      );

      const receiptNo = await this.docNumber.nextReceiptNumber(tx, doc.issueDate);

      return tx.otherIncome.update({
        where: { id: doc.id },
        data: {
          status: OtherIncomeStatus.POSTED,
          postedAt: new Date(),
          journalEntryId: je.id,
          receiptNo,
          isOverridden: dto.override === true,
        },
        include: { items: true, adjustments: true, attachments: true, customer: true },
      });
    });
  }

  /**
   * Reverse a POSTED doc:
   * - Create a clone (-R) marked POSTED with reversesId pointing to the original
   * - Create a reversal JE (Dr↔Cr flipped)
   * - Mark original REVERSED + set reversedById + reverseReason/note
   */
  async reverse(id: string, dto: ReverseOtherIncomeDto, userId: string) {
    const original = await this.findOneOrFail(id);
    if (original.status !== OtherIncomeStatus.POSTED) {
      throw new ConflictException(
        `เอกสาร ${original.docNumber} ไม่ใช่ POSTED (สถานะปัจจุบัน: ${original.status})`,
      );
    }
    if (!original.journalEntryId) {
      throw new BadRequestException(
        `เอกสาร ${original.docNumber} ไม่มี journalEntryId — บันทึกผิดพลาด`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Load the original JE lines to flip
      const origJe = await tx.journalEntry.findUnique({
        where: { id: original.journalEntryId! },
        include: { lines: true },
      });
      if (!origJe) {
        throw new NotFoundException(
          `JournalEntry ${original.journalEntryId} not found`,
        );
      }

      const reversalLines = origJe.lines.map((l) => ({
        accountCode: l.accountCode,
        debit: l.credit, // flipped
        credit: l.debit,
        description: l.description ? `${l.description} (กลับรายการ)` : 'กลับรายการ',
      }));

      // Generate -R doc number + receipt
      const reversedDocNumber = `${original.docNumber}-R`;
      const newReceiptNo = await this.docNumber.nextReceiptNumber(tx, new Date());

      // Build reversal OtherIncome (clone)
      const reversal = await tx.otherIncome.create({
        data: {
          docNumber: reversedDocNumber,
          companyId: original.companyId,
          status: OtherIncomeStatus.POSTED,
          issueDate: new Date(),
          dueDate: null,
          paymentDate: new Date(),
          priceType: original.priceType,
          customerId: original.customerId,
          counterpartyName: original.counterpartyName,
          counterpartyTaxId: original.counterpartyTaxId,
          counterpartyAddress: original.counterpartyAddress,
          counterpartyPhone: original.counterpartyPhone,
          paymentAccountCode: original.paymentAccountCode,
          amountReceived: original.amountReceived.negated(),
          incomeGross: original.incomeGross.negated(),
          vatAmount: original.vatAmount.negated(),
          whtAmount: original.whtAmount.negated(),
          netReceived: original.netReceived.negated(),
          totalAmount: original.totalAmount.negated(),
          receiptNo: newReceiptNo,
          customerNote: `กลับรายการเอกสาร ${original.docNumber}`,
          createdById: userId,
          reversesId: original.id,
          reverseReason: dto.reason,
          reverseNote: dto.note,
          postedAt: new Date(),
          items: {
            create: original.items.map((it) => ({
              lineNo: it.lineNo,
              accountCode: it.accountCode,
              accountName: it.accountName,
              description: it.description,
              quantity: it.quantity,
              unitAmount: it.unitAmount,
              discountAmount: it.discountAmount,
              vatPct: it.vatPct,
              whtPct: it.whtPct,
              amountBeforeVat: it.amountBeforeVat.negated(),
              vatAmount: it.vatAmount.negated(),
              whtAmount: it.whtAmount.negated(),
            })),
          },
          adjustments: {
            create: original.adjustments.map((a) => ({
              lineNo: a.lineNo,
              accountCode: a.accountCode,
              amount: a.amount, // amount stays positive; sign comes from JE flip
              note: a.note ? `${a.note} (กลับรายการ)` : 'กลับรายการ',
            })),
          },
        },
      });

      // Post the reversal JE
      const reversalJe = await this.template.post(
        {
          docNumber: reversedDocNumber,
          description: `กลับรายการ ${original.docNumber}`,
          entryDate: new Date(),
          lines: reversalLines,
          otherIncomeId: reversal.id,
        },
        tx,
      );

      // Update reversal with JE id
      await tx.otherIncome.update({
        where: { id: reversal.id },
        data: { journalEntryId: reversalJe.id },
      });

      // Mark original REVERSED
      await tx.otherIncome.update({
        where: { id: original.id },
        data: {
          status: OtherIncomeStatus.REVERSED,
          reversedById: reversal.id,
          reverseReason: dto.reason,
          reverseNote: dto.note,
        },
      });

      return tx.otherIncome.findUnique({
        where: { id: reversal.id },
        include: { items: true, adjustments: true, customer: true },
      });
    });
  }

  /**
   * Clone a doc as a new DRAFT:
   * - Same items + counterparty
   * - Cleared: amountReceived, adjustments, attachments
   * - issueDate = today; dueDate = today + 7d
   */
  async copy(id: string, userId: string) {
    const src = await this.findOneOrFail(id);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(today);
    due.setDate(due.getDate() + 7);

    return this.prisma.$transaction(async (tx) => {
      const docNumber = await this.docNumber.nextDocNumber(tx, today);
      return tx.otherIncome.create({
        data: {
          docNumber,
          companyId: src.companyId,
          status: OtherIncomeStatus.DRAFT,
          issueDate: today,
          dueDate: due,
          paymentDate: today,
          priceType: src.priceType,
          customerId: src.customerId,
          counterpartyName: src.counterpartyName,
          counterpartyTaxId: src.counterpartyTaxId,
          counterpartyAddress: src.counterpartyAddress,
          counterpartyPhone: src.counterpartyPhone,
          paymentAccountCode: src.paymentAccountCode,
          amountReceived: ZERO,
          incomeGross: src.incomeGross,
          vatAmount: src.vatAmount,
          whtAmount: src.whtAmount,
          netReceived: src.netReceived,
          totalAmount: src.totalAmount,
          customerNote: src.customerNote,
          createdById: userId,
          copiedFromId: src.id,
          items: {
            create: src.items.map((it) => ({
              lineNo: it.lineNo,
              accountCode: it.accountCode,
              accountName: it.accountName,
              description: it.description,
              quantity: it.quantity,
              unitAmount: it.unitAmount,
              discountAmount: it.discountAmount,
              vatPct: it.vatPct,
              whtPct: it.whtPct,
              amountBeforeVat: it.amountBeforeVat,
              vatAmount: it.vatAmount,
              whtAmount: it.whtAmount,
            })),
          },
        },
        include: { items: true, adjustments: true },
      });
    });
  }

  /**
   * Daily sheet: aggregate POSTED docs for a single date.
   * Returns 4 summary boxes + 3 breakdown tables (docs, by-account, by-payment).
   */
  async dailySheet(date: string) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const docs = await this.prisma.otherIncome.findMany({
      where: {
        status: OtherIncomeStatus.POSTED,
        issueDate: { gte: start, lt: end },
        deletedAt: null,
      },
      include: { items: true, customer: true },
      orderBy: { docNumber: 'asc' },
    });

    const sum = (xs: Decimal[]) => xs.reduce<Decimal>((s, x) => s.plus(x), ZERO);

    const summary = {
      incomeGross: sum(docs.map((d) => d.incomeGross)),
      vat: sum(docs.map((d) => d.vatAmount)),
      wht: sum(docs.map((d) => d.whtAmount)),
      netReceived: sum(docs.map((d) => d.amountReceived)),
      docCount: docs.length,
    };

    const byAccount = new Map<string, { code: string; name: string; total: Decimal; count: number }>();
    for (const d of docs) {
      for (const it of d.items) {
        const cur = byAccount.get(it.accountCode) ?? {
          code: it.accountCode,
          name: it.accountName,
          total: ZERO,
          count: 0,
        };
        cur.total = cur.total.plus(it.amountBeforeVat);
        cur.count += 1;
        byAccount.set(it.accountCode, cur);
      }
    }

    const byPayment = new Map<string, { code: string; total: Decimal; count: number }>();
    for (const d of docs) {
      const cur = byPayment.get(d.paymentAccountCode) ?? {
        code: d.paymentAccountCode,
        total: ZERO,
        count: 0,
      };
      cur.total = cur.total.plus(d.amountReceived);
      cur.count += 1;
      byPayment.set(d.paymentAccountCode, cur);
    }

    return {
      date,
      summary,
      docs,
      byAccount: [...byAccount.values()].sort((a, b) => a.code.localeCompare(b.code)),
      byPayment: [...byPayment.values()].sort((a, b) => a.code.localeCompare(b.code)),
    };
  }

  async list(query: { status?: OtherIncomeStatus; startDate?: string; endDate?: string; q?: string; page: number; limit: number }) {
    const where: Prisma.OtherIncomeWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.startDate) where.issueDate = { gte: new Date(query.startDate) };
    if (query.endDate)
      where.issueDate = { ...(where.issueDate as object), lte: new Date(query.endDate) };
    if (query.q) {
      where.OR = [
        { docNumber: { contains: query.q, mode: 'insensitive' } },
        { counterpartyName: { contains: query.q, mode: 'insensitive' } },
        { receiptNo: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.otherIncome.findMany({
        where,
        include: { items: { take: 1, orderBy: { lineNo: 'asc' } }, customer: true },
        orderBy: { issueDate: 'desc' },
        take: query.limit,
        skip: (query.page - 1) * query.limit,
      }),
      this.prisma.otherIncome.count({ where }),
    ]);
    return { data, total, page: query.page, limit: query.limit };
  }

  /** Read attachment threshold from IntegrationConfig (default 50,000). */
  private async getAttachmentThreshold(): Promise<number> {
    const cfg = await this.prisma.integrationConfig.findUnique({
      where: { key: 'OTHER_INCOME_ATTACHMENT_THRESHOLD' as any },
    }).catch(() => null);
    if (!cfg) return 50000;
    const v = (cfg as any).value;
    const parsed = typeof v === 'string' ? Number(v) : Number(v?.threshold ?? v);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 50000;
  }
```

**Note:** `OtherIncomeTemplate` injects fine via constructor — there is no circular DI (template depends only on `JournalAutoService`, not on `OtherIncomeService`).

- [ ] **Step 6.4: Add post + reverse + copy + dailySheet tests**

Append to `apps/api/src/modules/other-income/__tests__/other-income.service.spec.ts`:

```typescript
describe('OtherIncomeService — post + reverse + copy', () => {
  // ... reuse beforeAll + afterAll setup from earlier ...

  it('post(): DRAFT → POSTED with JE reference + receiptNo', async () => {
    const draft = await service.create({
      issueDate: '2026-05-06',
      priceType: 'EXCLUSIVE',
      paymentAccountCode: '11-1201',
      amountReceived: 850,
      counterpartyName: 'KBank',
      items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
    }, userId);

    const posted = await service.post(draft.id, {}, userId);

    expect(posted.status).toBe('POSTED');
    expect(posted.journalEntryId).toBeTruthy();
    expect(posted.receiptNo).toMatch(/^RC-20260506-\d{3}$/);

    // Confirm JE created with referenceType='OTHER_INCOME'
    const je = await prisma.journalEntry.findUnique({
      where: { id: posted.journalEntryId! },
      include: { lines: true },
    });
    expect(je?.referenceType).toBe('OTHER_INCOME');
    expect(je?.referenceId).toBe(posted.id);
    expect(je?.lines.length).toBe(3); // cash + WHT-receivable + income
  });

  it('post(): rejects when V1-V14 fails (mismatched amount)', async () => {
    const draft = await service.create({
      issueDate: '2026-05-06',
      priceType: 'EXCLUSIVE',
      paymentAccountCode: '11-1201',
      amountReceived: 800, // wrong — net is 850
      items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
    }, userId);

    await expect(service.post(draft.id, {}, userId)).rejects.toMatchObject({
      response: expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({ rule: 'V10' }),
        ]),
      }),
    });
  });

  it('reverse(): creates -R doc, flips JE, marks original REVERSED', async () => {
    const draft = await service.create({
      issueDate: '2026-05-06',
      priceType: 'EXCLUSIVE',
      paymentAccountCode: '11-1201',
      amountReceived: 850,
      items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
    }, userId);
    const posted = await service.post(draft.id, {}, userId);

    const reversal = await service.reverse(posted.id, {
      reason: 'INPUT_ERROR',
      note: 'amount was wrong, redo',
    }, userId);

    expect(reversal!.docNumber).toBe(`${posted.docNumber}-R`);
    expect(reversal!.status).toBe('POSTED');
    expect(reversal!.reversesId).toBe(posted.id);

    const orig = await prisma.otherIncome.findUnique({ where: { id: posted.id } });
    expect(orig?.status).toBe('REVERSED');
    expect(orig?.reversedById).toBe(reversal!.id);

    // JE balance: original Dr lines should equal reversal Cr lines
    const reversalJe = await prisma.journalEntry.findUnique({
      where: { id: reversal!.journalEntryId! },
      include: { lines: true },
    });
    expect(reversalJe?.lines.length).toBe(3);
  });

  it('copy(): clones as new DRAFT with cleared amounts', async () => {
    const src = await service.create({
      issueDate: '2026-05-06',
      priceType: 'EXCLUSIVE',
      paymentAccountCode: '11-1201',
      amountReceived: 850,
      items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
    }, userId);

    const copy = await service.copy(src.id, userId);

    expect(copy.status).toBe('DRAFT');
    expect(copy.copiedFromId).toBe(src.id);
    expect(Number(copy.amountReceived)).toBe(0);
    expect(copy.items.length).toBe(1);
    expect(copy.items[0].accountCode).toBe('42-1102');
  });

  it('dailySheet(): aggregates POSTED docs for a date', async () => {
    const draft = await service.create({
      issueDate: '2026-05-07',
      priceType: 'EXCLUSIVE',
      paymentAccountCode: '11-1201',
      amountReceived: 850,
      items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
    }, userId);
    await service.post(draft.id, {}, userId);

    const sheet = await service.dailySheet('2026-05-07');
    expect(sheet.summary.docCount).toBeGreaterThanOrEqual(1);
    expect(sheet.byAccount.find((r) => r.code === '42-1102')).toBeDefined();
    expect(sheet.byPayment.find((r) => r.code === '11-1201')).toBeDefined();
  });
});
```

- [ ] **Step 6.5: Run all backend tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/other-income/
```

Expected: all unit + service tests pass. Fix any failures before continuing.

- [ ] **Step 6.6: Commit**

```bash
git add apps/api/src/modules/other-income/
git commit -m "feat(other-income): post + reverse + copy + dailySheet

- post(): atomic V1-V14 + JE create-and-post via OtherIncomeTemplate
- reverse(): creates -R doc with flipped Dr/Cr, marks original REVERSED
- copy(): clones DRAFT with cleared amounts (template for recurring entries)
- dailySheet(): 4-summary + by-account + by-payment breakdowns
- list(): paginated with status/date/q filters
- Attachment threshold from IntegrationConfig (fallback 50,000)
- 5 additional service tests"
```

---

## Phase 3: Controller + Module wiring

### Task 7: NestJS controller + module + app registration

**Files:**
- Create: `apps/api/src/modules/other-income/other-income.controller.ts`
- Create: `apps/api/src/modules/other-income/other-income.module.ts`
- Modify: `apps/api/src/app.module.ts` — import `OtherIncomeModule`

- [ ] **Step 7.1: Create the controller**

Create `apps/api/src/modules/other-income/other-income.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../guards/roles.guard';
import { Roles } from '../../decorators/roles.decorator';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { OtherIncomeService } from './other-income.service';
import { CreateOtherIncomeDto } from './dto/create-other-income.dto';
import { UpdateOtherIncomeDto } from './dto/update-other-income.dto';
import { PostOtherIncomeDto } from './dto/post-other-income.dto';
import { ReverseOtherIncomeDto } from './dto/reverse-other-income.dto';
import { ListOtherIncomeQueryDto } from './dto/list-other-income-query.dto';
import { DailySheetQueryDto } from './dto/daily-sheet-query.dto';

@Controller('other-income')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
export class OtherIncomeController {
  constructor(private readonly service: OtherIncomeService) {}

  /** Daily sheet — must be defined BEFORE :id route to avoid uuid parse on "daily-sheet" */
  @Get('daily-sheet')
  dailySheet(@Query() q: DailySheetQueryDto) {
    return this.service.dailySheet(q.date);
  }

  @Get()
  list(@Query() query: ListOtherIncomeQueryDto) {
    return this.service.list({
      status: query.status,
      startDate: query.startDate,
      endDate: query.endDate,
      q: query.q,
      page: query.page ?? 1,
      limit: query.limit ?? 50,
    });
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findOneOrFail(id);
  }

  @Post()
  create(
    @Body() dto: CreateOtherIncomeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.create(dto, userId);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOtherIncomeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.update(id, dto, userId);
  }

  @Delete(':id')
  softDelete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.softDelete(id, userId);
  }

  @Post(':id/post')
  post(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PostOtherIncomeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.post(id, dto, userId);
  }

  @Post(':id/reverse')
  @Roles('OWNER', 'FINANCE_MANAGER')
  reverse(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReverseOtherIncomeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.reverse(id, dto, userId);
  }

  @Post(':id/copy')
  copy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.copy(id, userId);
  }
}
```

**Note on decorator paths:** verify the actual import paths for `JwtAuthGuard`, `RolesGuard`, `Roles`, and `CurrentUser` by opening `apps/api/src/modules/accounting/accounting.controller.ts` and copying the exact same imports (paths may differ from what I wrote above). Don't proceed if paths are wrong — the build will fail.

- [ ] **Step 7.2: Create the module**

Create `apps/api/src/modules/other-income/other-income.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JournalModule } from '../journal/journal.module';
import { OtherIncomeService } from './other-income.service';
import { OtherIncomeController } from './other-income.controller';
import { DocNumberService } from './services/doc-number.service';
import { ValidationService } from './services/validation.service';
import { AutoJournalService } from './services/auto-journal.service';
import { OtherIncomeTemplate } from './templates/other-income.template';

@Module({
  imports: [PrismaModule, JournalModule],
  controllers: [OtherIncomeController],
  providers: [
    OtherIncomeService,
    DocNumberService,
    ValidationService,
    AutoJournalService,
    OtherIncomeTemplate,
  ],
  exports: [OtherIncomeService],
})
export class OtherIncomeModule {}
```

No setter wiring needed — `OtherIncomeService` injects `OtherIncomeTemplate` directly in its constructor (added in Task 6.3 step 6.3.0 below).

- [ ] **Step 7.3: Register `OtherIncomeModule` in `AppModule`**

Open `apps/api/src/app.module.ts`. Find the `imports: [...]` array. Add:

```typescript
import { OtherIncomeModule } from './modules/other-income/other-income.module';

// inside imports:
OtherIncomeModule,
```

Place the import alphabetically near other accounting-related modules.

- [ ] **Step 7.4: Type-check + build**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh api
```

Expected: 0 errors. If there are errors, fix them — common causes:
- Wrong import path for guards/decorators
- Missing `@Inject` for constructor params
- Wrong `OtherIncomeReverseReason` enum reference

- [ ] **Step 7.5: Smoke-test the endpoint registration**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npm run start:dev &
sleep 5
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/other-income
# Expected: 401 (unauthorized — guard works)
kill %1
```

If you see `404`, the controller is not registered. Re-check `app.module.ts`.

- [ ] **Step 7.6: Commit**

```bash
git add apps/api/src/modules/other-income/other-income.controller.ts apps/api/src/modules/other-income/other-income.module.ts apps/api/src/app.module.ts
git commit -m "feat(other-income): wire controller + module into app

- POST/GET/PATCH/DELETE + post/reverse/copy/daily-sheet endpoints
- @Roles guard: OWNER/FINANCE_MANAGER/ACCOUNTANT (reverse: OWNER/FINANCE_MANAGER only)
- Daily sheet route declared before :id to avoid UUID parse collision"
```

---

### Task 8: Controller integration tests

**Files:**
- Create: `apps/api/src/modules/other-income/__tests__/other-income.controller.spec.ts`

- [ ] **Step 8.1: Write integration tests**

Create `apps/api/src/modules/other-income/__tests__/other-income.controller.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('OtherIncomeController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let accountantToken: string;
  let salesToken: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);

    // Create test users
    const owner = await prisma.user.create({
      data: { email: 'oi-owner@test', password: 'x', name: 'Owner', role: 'OWNER' },
    });
    const accountant = await prisma.user.create({
      data: { email: 'oi-acc@test', password: 'x', name: 'Acc', role: 'ACCOUNTANT' },
    });
    const sales = await prisma.user.create({
      data: { email: 'oi-sales@test', password: 'x', name: 'Sales', role: 'SALES' },
    });
    token = jwt.sign({ sub: owner.id, role: 'OWNER' });
    accountantToken = jwt.sign({ sub: accountant.id, role: 'ACCOUNTANT' });
    salesToken = jwt.sign({ sub: sales.id, role: 'SALES' });
  });

  afterAll(async () => {
    await prisma.otherIncome.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { in: ['oi-owner@test', 'oi-acc@test', 'oi-sales@test'] } } });
    await app.close();
  });

  it('GET /other-income — 401 without token', async () => {
    await request(app.getHttpServer()).get('/other-income').expect(401);
  });

  it('GET /other-income — 403 for SALES', async () => {
    await request(app.getHttpServer())
      .get('/other-income')
      .set('Authorization', `Bearer ${salesToken}`)
      .expect(403);
  });

  it('POST /other-income — 201 with valid payload (ACCOUNTANT)', async () => {
    const res = await request(app.getHttpServer())
      .post('/other-income')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({
        issueDate: '2026-05-06',
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 850,
        counterpartyName: 'KBank',
        items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
      })
      .expect(201);
    expect(res.body.docNumber).toMatch(/^OI-/);
    expect(res.body.status).toBe('DRAFT');
  });

  it('POST /other-income — 400 with missing items', async () => {
    await request(app.getHttpServer())
      .post('/other-income')
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({
        issueDate: '2026-05-06',
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 850,
      })
      .expect(400);
  });

  it('POST /other-income/:id/reverse — 403 for ACCOUNTANT', async () => {
    // Owner creates and posts a doc
    const create = await request(app.getHttpServer())
      .post('/other-income')
      .set('Authorization', `Bearer ${token}`)
      .send({
        issueDate: '2026-05-06',
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 850,
        items: [{ accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 }],
      });
    await request(app.getHttpServer())
      .post(`/other-income/${create.body.id}/post`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    // ACCOUNTANT tries to reverse → 403
    await request(app.getHttpServer())
      .post(`/other-income/${create.body.id}/reverse`)
      .set('Authorization', `Bearer ${accountantToken}`)
      .send({ reason: 'INPUT_ERROR', note: 'test reverse' })
      .expect(403);
  });
});
```

- [ ] **Step 8.2: Run integration tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npx jest src/modules/other-income/__tests__/other-income.controller.spec.ts
```

Expected: 5 tests pass. If `JwtService` token signing fails because the secret isn't set in the test env, copy the JWT secret env from existing controller tests (e.g., `apps/api/src/modules/accounting/__tests__/accounting.controller.spec.ts`).

- [ ] **Step 8.3: Run full API test suite**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npm test -- --testPathPattern="other-income"
```

Expected: all OtherIncome tests pass (DocNumber + Validation + AutoJournal + Service + Controller).

- [ ] **Step 8.4: Commit**

```bash
git add apps/api/src/modules/other-income/__tests__/other-income.controller.spec.ts
git commit -m "test(other-income): add controller integration tests for guards + payload validation"
```

---

## Phase 4: Frontend foundation

### Task 9: API client, types, and zod schema

**Files:**
- Create: `apps/web/src/lib/otherIncome.ts`
- Create: `apps/web/src/lib/otherIncome.types.ts`
- Create: `apps/web/src/lib/otherIncome.schema.ts`

- [ ] **Step 9.1: Create types**

Create `apps/web/src/lib/otherIncome.types.ts`:

```typescript
export type OtherIncomeStatus = 'DRAFT' | 'POSTED' | 'REVERSED';
export type OtherIncomePriceType = 'EXCLUSIVE' | 'INCLUSIVE';
export type OtherIncomeReverseReason =
  | 'INPUT_ERROR'
  | 'CUSTOMER_REQUEST'
  | 'DUPLICATE'
  | 'WRONG_ACCOUNT'
  | 'WRONG_AMOUNT'
  | 'OTHER';

export interface OtherIncomeItem {
  id: string;
  lineNo: number;
  accountCode: string;
  accountName: string;
  description: string | null;
  quantity: string; // serialized Decimal
  unitAmount: string;
  discountAmount: string;
  vatPct: string;
  whtPct: string;
  amountBeforeVat: string;
  vatAmount: string;
  whtAmount: string;
}

export interface OtherIncomeAdjustment {
  id: string;
  lineNo: number;
  accountCode: string;
  amount: string;
  note: string | null;
}

export interface OtherIncomeAttachment {
  id: string;
  s3Key: string;
  filename: string;
  size: number;
  mimeType: string;
  uploadedById: string;
  createdAt: string;
}

export interface OtherIncome {
  id: string;
  docNumber: string;
  status: OtherIncomeStatus;
  issueDate: string;
  dueDate: string | null;
  paymentDate: string | null;
  priceType: OtherIncomePriceType;
  customerId: string | null;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  counterpartyAddress: string | null;
  counterpartyPhone: string | null;
  paymentAccountCode: string;
  amountReceived: string;
  incomeGross: string;
  vatAmount: string;
  whtAmount: string;
  netReceived: string;
  totalAmount: string;
  receiptNo: string | null;
  journalEntryId: string | null;
  isOverridden: boolean;
  customerNote: string | null;
  createdById: string;
  postedAt: string | null;
  reversesId: string | null;
  reversedById: string | null;
  reverseReason: OtherIncomeReverseReason | null;
  reverseNote: string | null;
  copiedFromId: string | null;
  createdAt: string;
  updatedAt: string;
  items: OtherIncomeItem[];
  adjustments: OtherIncomeAdjustment[];
  attachments: OtherIncomeAttachment[];
  customer: { id: string; name: string; phone?: string | null } | null;
}

export interface DailySheet {
  date: string;
  summary: {
    incomeGross: string;
    vat: string;
    wht: string;
    netReceived: string;
    docCount: number;
  };
  docs: OtherIncome[];
  byAccount: Array<{ code: string; name: string; total: string; count: number }>;
  byPayment: Array<{ code: string; total: string; count: number }>;
}

export interface ListResponse {
  data: OtherIncome[];
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 9.2: Create zod schema for the entry form**

Create `apps/web/src/lib/otherIncome.schema.ts`:

```typescript
import { z } from 'zod';

export const otherIncomeItemSchema = z.object({
  accountCode: z
    .string()
    .min(1, 'เลือกบัญชี')
    .regex(/^42-/, 'ต้องเป็นบัญชีกลุ่ม 42-XXXX'),
  description: z.string().optional(),
  quantity: z.coerce.number().min(0.01, 'จำนวน > 0'),
  unitAmount: z.coerce.number().min(0.01, 'ราคา > 0'),
  discountAmount: z.coerce.number().min(0).optional(),
  vatPct: z.coerce.number().min(0).max(100).optional(),
  whtPct: z.coerce.number().min(0).max(100).optional(),
});

export const otherIncomeAdjustmentSchema = z.object({
  accountCode: z.string().min(1, 'เลือกบัญชีปรับ'),
  amount: z.coerce.number().min(0.01, 'จำนวน > 0'),
  note: z.string().optional(),
});

export const otherIncomeFormSchema = z.object({
  issueDate: z.string().min(1, 'กรุณาระบุวันที่'),
  dueDate: z.string().optional(),
  paymentDate: z.string().optional(),
  priceType: z.enum(['EXCLUSIVE', 'INCLUSIVE']),
  customerId: z.string().uuid().optional().or(z.literal('')),
  counterpartyName: z.string().optional(),
  counterpartyTaxId: z.string().optional(),
  counterpartyAddress: z.string().optional(),
  counterpartyPhone: z.string().optional(),
  paymentAccountCode: z.string().min(1, 'เลือกช่องทางชำระ'),
  amountReceived: z.coerce.number().min(0, 'จำนวนเงิน ≥ 0'),
  items: z.array(otherIncomeItemSchema).min(1, 'อย่างน้อย 1 รายการ'),
  adjustments: z.array(otherIncomeAdjustmentSchema).optional(),
  customerNote: z.string().optional(),
});

export type OtherIncomeFormValues = z.infer<typeof otherIncomeFormSchema>;
```

- [ ] **Step 9.3: Create API client**

Create `apps/web/src/lib/otherIncome.ts`:

```typescript
import { api } from './api';
import type {
  OtherIncome,
  ListResponse,
  DailySheet,
  OtherIncomeStatus,
  OtherIncomeReverseReason,
} from './otherIncome.types';
import type { OtherIncomeFormValues } from './otherIncome.schema';

export interface ListQuery {
  status?: OtherIncomeStatus;
  startDate?: string;
  endDate?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export const otherIncomeApi = {
  list: (q: ListQuery = {}) =>
    api.get<ListResponse>('/other-income', { params: q }).then((r) => r.data),

  findOne: (id: string) =>
    api.get<OtherIncome>(`/other-income/${id}`).then((r) => r.data),

  create: (data: OtherIncomeFormValues) =>
    api.post<OtherIncome>('/other-income', data).then((r) => r.data),

  update: (id: string, data: Partial<OtherIncomeFormValues>) =>
    api.patch<OtherIncome>(`/other-income/${id}`, data).then((r) => r.data),

  softDelete: (id: string) =>
    api.delete(`/other-income/${id}`).then((r) => r.data),

  post: (id: string, override?: { lines: Array<{ accountCode: string; debit: number; credit: number; description?: string }> }) =>
    api
      .post<OtherIncome>(`/other-income/${id}/post`, {
        override: !!override,
        overrideLines: override?.lines,
      })
      .then((r) => r.data),

  reverse: (id: string, reason: OtherIncomeReverseReason, note: string) =>
    api
      .post<OtherIncome>(`/other-income/${id}/reverse`, { reason, note })
      .then((r) => r.data),

  copy: (id: string) =>
    api.post<OtherIncome>(`/other-income/${id}/copy`).then((r) => r.data),

  dailySheet: (date: string) =>
    api.get<DailySheet>('/other-income/daily-sheet', { params: { date } }).then((r) => r.data),
};
```

- [ ] **Step 9.4: Type-check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 9.5: Commit**

```bash
git add apps/web/src/lib/otherIncome*
git commit -m "feat(other-income/web): add API client, types, and zod schema

- typed wrappers for all 9 endpoints (list/findOne/create/update/delete/post/reverse/copy/dailySheet)
- zod schema for the entry form (used by react-hook-form)
- TypeScript types for OtherIncome + items + adjustments + attachments + DailySheet"
```

---

### Task 10: Reusable form components (small, focused)

**Files:**
- Create: `apps/web/src/pages/other-income/components/AccountSearchDropdown.tsx`
- Create: `apps/web/src/pages/other-income/components/CounterpartyPicker.tsx`
- Create: `apps/web/src/pages/other-income/components/PaymentCompareCard.tsx`

These three are the simpler standalone components. Larger ones (`ItemsTable`, `AdjustmentTable`, `AutoJournalPreview`, `ReverseModal`) come in Task 11.

- [ ] **Step 10.1: Create AccountSearchDropdown**

Create `apps/web/src/pages/other-income/components/AccountSearchDropdown.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Search, CheckCircle2 } from 'lucide-react';
import { useCoaGroups } from '@/hooks/useCoa';

interface CoaItem {
  code: string;
  name: string;
}

interface Props {
  value: string;
  onChange: (code: string) => void;
  /** CSS classes filter for which CoA codes to show. */
  filter?: (a: CoaItem) => boolean;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Searchable account-code dropdown — used by ItemsTable (filter: 42-XXXX)
 * and AdjustmentTable (filter: 52-/53-/11-41).
 */
export function AccountSearchDropdown({ value, onChange, filter, placeholder = '— เลือกบัญชี —', disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const { data: groups, isLoading } = useCoaGroups({});

  const allAccounts: CoaItem[] = (groups?.groups ?? []).flatMap((g) => g.accounts);
  const filtered = allAccounts
    .filter((a) => (filter ? filter(a) : true))
    .filter((a) =>
      search
        ? a.code.toLowerCase().includes(search.toLowerCase()) ||
          a.name.toLowerCase().includes(search.toLowerCase())
        : true,
    );

  const selected = allAccounts.find((a) => a.code === value);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="w-full text-left px-3 py-2 rounded-md border bg-background text-sm flex items-center justify-between gap-2 hover:bg-accent disabled:opacity-50"
      >
        {selected ? (
          <span className="flex items-baseline gap-2 truncate">
            <span className="font-mono text-xs font-bold text-primary">{selected.code}</span>
            <span className="truncate">{selected.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <span className="text-muted-foreground text-xs flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && !disabled && (
        <div className="absolute z-30 w-full mt-1 rounded-md border shadow-lg bg-popover" style={{ maxHeight: 320 }}>
          <div className="p-2 border-b">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-2.5 text-muted-foreground" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหารหัส หรือ ชื่อบัญชี"
                className="w-full pl-7 pr-2 py-2 text-xs rounded border bg-background"
              />
            </div>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
            {isLoading ? (
              <p className="p-3 text-xs text-center text-muted-foreground">กำลังโหลด...</p>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-xs text-center text-muted-foreground">ไม่พบบัญชี</p>
            ) : (
              filtered.map((a) => {
                const isSel = a.code === value;
                return (
                  <button
                    key={a.code}
                    type="button"
                    onClick={() => {
                      onChange(a.code);
                      setOpen(false);
                      setSearch('');
                    }}
                    className={`w-full text-left px-3 py-2 hover:bg-accent border-b text-xs flex items-baseline gap-2 ${isSel ? 'bg-accent' : ''}`}
                  >
                    <span className="font-mono w-16 font-bold text-primary flex-shrink-0">{a.code}</span>
                    <span className="flex-1 truncate">{a.name}</span>
                    {isSel && <CheckCircle2 size={12} className="text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 10.2: Create CounterpartyPicker**

Create `apps/web/src/pages/other-income/components/CounterpartyPicker.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Search } from 'lucide-react';

interface Counterparty {
  customerId: string | null;
  name: string;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
}

interface Props {
  value: Counterparty;
  onChange: (cp: Counterparty) => void;
}

interface CustomerLite {
  id: string;
  name: string;
  taxId: string | null;
  address: string | null;
  phone: string | null;
}

/**
 * Dual-mode picker:
 * - Type a name → either pick from customer dropdown OR keep as free-text counterparty.
 * - Useful for ดอกเบี้ยฝาก (counterparty='KBank' free-text) and corporate buyer (Customer FK).
 */
export function CounterpartyPicker({ value, onChange }: Props) {
  const [search, setSearch] = useState(value.name ?? '');
  const [open, setOpen] = useState(false);

  const { data: customers } = useQuery<CustomerLite[]>({
    queryKey: ['customers', 'search', search],
    queryFn: async () => {
      if (search.trim().length < 2) return [];
      const res = await api.get('/customers', { params: { q: search, limit: 10 } });
      return res.data?.data ?? [];
    },
    enabled: search.trim().length >= 2,
  });

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
            // Update free-text mode immediately
            onChange({
              customerId: null,
              name: e.target.value,
              taxId: value.taxId,
              address: value.address,
              phone: value.phone,
            });
          }}
          onFocus={() => setOpen(true)}
          placeholder="พิมพ์ชื่อลูกค้า/คู่ค้า (ถ้าไม่มี → ใช้เป็นข้อความ)"
          className="w-full pl-9 pr-3 py-2 border rounded-md text-sm"
        />
      </div>
      {open && customers && customers.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-md border bg-popover shadow-lg">
          {customers.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange({
                  customerId: c.id,
                  name: c.name,
                  taxId: c.taxId,
                  address: c.address,
                  phone: c.phone,
                });
                setSearch(c.name);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-accent border-b text-sm"
            >
              <p className="font-semibold">{c.name}</p>
              <p className="text-xs text-muted-foreground">
                {c.taxId ?? '—'} · {c.phone ?? '—'}
              </p>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onChange({ customerId: null, name: search });
              setOpen(false);
            }}
            className="w-full text-left px-3 py-2 hover:bg-accent text-xs italic text-muted-foreground"
          >
            ใช้ "{search}" เป็นข้อความ (ไม่มีในระบบลูกค้า)
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 10.3: Create PaymentCompareCard**

Create `apps/web/src/pages/other-income/components/PaymentCompareCard.tsx`:

```tsx
interface Props {
  expected: number;
  received: number | null | undefined;
}

/**
 * Read-only comparison: shows ✓ตรง / ⚠ขาด / ↑เกิน between expected and received.
 * The AdjustmentTable (separate component) handles the data entry for the diff.
 */
export function PaymentCompareCard({ expected, received }: Props) {
  if (received === null || received === undefined) {
    return (
      <div className="rounded-lg border-2 border-dashed p-3 text-center text-xs text-muted-foreground">
        กรอก "จำนวนเงินที่ได้รับจริง" เพื่อตรวจเปรียบเทียบกับยอดสุทธิ
      </div>
    );
  }
  const diff = +(received - expected).toFixed(2);
  let tone: 'success' | 'info' | 'warning';
  let label: string;
  if (Math.abs(diff) < 0.01) {
    tone = 'success';
    label = 'ตรงพอดี';
  } else if (diff > 0) {
    tone = 'info';
    label = `รับเกิน ${diff.toFixed(2)} ฿`;
  } else {
    tone = 'warning';
    label = `ขาด ${Math.abs(diff).toFixed(2)} ฿`;
  }
  const colorMap = {
    success: 'border-green-500 bg-green-500/10 text-green-700',
    info: 'border-blue-500 bg-blue-500/10 text-blue-700',
    warning: 'border-orange-500 bg-orange-500/10 text-orange-700',
  };
  return (
    <div className={`rounded-lg border-2 p-3 ${colorMap[tone]}`}>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <p className="opacity-70">ยอดสุทธิ</p>
          <p className="font-mono font-bold">{expected.toFixed(2)}</p>
        </div>
        <div className="border-x">
          <p className="opacity-70">ได้รับจริง</p>
          <p className="font-mono font-bold">{received.toFixed(2)}</p>
        </div>
        <div>
          <p className="opacity-70">สถานะ</p>
          <p className="font-bold">{label}</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 10.4: Type-check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web
```

Expected: 0 errors.

- [ ] **Step 10.5: Commit**

```bash
git add apps/web/src/pages/other-income/
git commit -m "feat(other-income/web): add small reusable components

- AccountSearchDropdown: searchable CoA picker via useCoaGroups hook
- CounterpartyPicker: dual-mode (Customer FK or free-text) for KBank/etc.
- PaymentCompareCard: read-only diff indicator between expected and received"
```

---

### Task 11: ItemsTable + AdjustmentTable + AutoJournalPreview + ReverseModal

**Files:**
- Create: `apps/web/src/pages/other-income/components/ItemsTable.tsx`
- Create: `apps/web/src/pages/other-income/components/AdjustmentTable.tsx`
- Create: `apps/web/src/pages/other-income/components/AutoJournalPreview.tsx`
- Create: `apps/web/src/pages/other-income/components/ReverseModal.tsx`

These are larger components but each has a single, focused responsibility. They are consumed by `OtherIncomeEntryPage` (T13) and `OtherIncomeViewPage` (T14).

- [ ] **Step 11.1: Create ItemsTable**

Create `apps/web/src/pages/other-income/components/ItemsTable.tsx`:

```tsx
import { useFieldArray, type Control, type UseFormRegister, type UseFormWatch } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { AccountSearchDropdown } from './AccountSearchDropdown';
import type { OtherIncomeFormValues } from '@/lib/otherIncome.schema';

interface Props {
  control: Control<OtherIncomeFormValues>;
  register: UseFormRegister<OtherIncomeFormValues>;
  watch: UseFormWatch<OtherIncomeFormValues>;
}

export function ItemsTable({ control, register, watch }: Props) {
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = watch('items');
  const priceType = watch('priceType');

  const computed = items.map((it) => {
    const qty = Number(it.quantity) || 0;
    const unit = Number(it.unitAmount) || 0;
    const disc = Number(it.discountAmount) || 0;
    const vatPct = Number(it.vatPct) || 0;
    const whtPct = Number(it.whtPct) || 0;
    const gross = qty * unit - disc;
    let amountBeforeVat: number;
    let vatAmount: number;
    if (vatPct > 0) {
      if (priceType === 'INCLUSIVE') {
        amountBeforeVat = +(gross / (1 + vatPct / 100)).toFixed(2);
        vatAmount = +(gross - amountBeforeVat).toFixed(2);
      } else {
        amountBeforeVat = gross;
        vatAmount = +((gross * vatPct) / 100).toFixed(2);
      }
    } else {
      amountBeforeVat = gross;
      vatAmount = 0;
    }
    const whtAmount = +((amountBeforeVat * whtPct) / 100).toFixed(2);
    return { amountBeforeVat, vatAmount, whtAmount };
  });

  return (
    <div className="space-y-3">
      {fields.map((f, idx) => (
        <div key={f.id} className="rounded-lg border p-3 bg-card">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-sm">รายการ #{idx + 1}</span>
            {fields.length > 1 && (
              <button
                type="button"
                onClick={() => remove(idx)}
                className="text-destructive hover:opacity-80"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-12 gap-2 text-xs">
            <div className="col-span-4">
              <label className="text-muted-foreground">บัญชี (42-XXXX)</label>
              <AccountSearchDropdown
                value={items[idx]?.accountCode ?? ''}
                onChange={(code) => {
                  const event = { target: { value: code } } as any;
                  register(`items.${idx}.accountCode`).onChange(event);
                }}
                filter={(a) => a.code.startsWith('42-') && a.code !== '42-1103'}
              />
            </div>
            <div className="col-span-1">
              <label className="text-muted-foreground">จำนวน</label>
              <input
                type="number"
                step="0.01"
                {...register(`items.${idx}.quantity`)}
                className="w-full border rounded px-2 py-1 text-right font-mono"
              />
            </div>
            <div className="col-span-2">
              <label className="text-muted-foreground">ราคา</label>
              <input
                type="number"
                step="0.01"
                {...register(`items.${idx}.unitAmount`)}
                className="w-full border rounded px-2 py-1 text-right font-mono"
              />
            </div>
            <div className="col-span-1">
              <label className="text-muted-foreground">ส่วนลด</label>
              <input
                type="number"
                step="0.01"
                {...register(`items.${idx}.discountAmount`)}
                className="w-full border rounded px-2 py-1 text-right font-mono"
              />
            </div>
            <div className="col-span-1">
              <label className="text-muted-foreground">VAT%</label>
              <select
                {...register(`items.${idx}.vatPct`)}
                className="w-full border rounded px-1 py-1 text-xs font-mono"
              >
                <option value={0}>0</option>
                <option value={7}>7</option>
              </select>
            </div>
            <div className="col-span-1">
              <label className="text-muted-foreground">WHT%</label>
              <select
                {...register(`items.${idx}.whtPct`)}
                className="w-full border rounded px-1 py-1 text-xs font-mono"
              >
                {[0, 1, 2, 3, 5, 7, 10, 15].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 text-right">
              <label className="text-muted-foreground">ก่อนภาษี</label>
              <p className="font-mono font-bold">{computed[idx]?.amountBeforeVat.toFixed(2)}</p>
            </div>
          </div>
          <div className="mt-2">
            <label className="text-xs text-muted-foreground">คำอธิบาย (optional)</label>
            <textarea
              {...register(`items.${idx}.description`)}
              rows={1}
              className="w-full border rounded px-2 py-1 text-xs"
              placeholder="เช่น ดอกเบี้ยเดือน พ.ค. 2569"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          append({
            accountCode: '42-1102',
            quantity: 1,
            unitAmount: 0,
            discountAmount: 0,
            vatPct: 0,
            whtPct: 15,
            description: '',
          })
        }
        className="inline-flex items-center gap-1 px-3 py-2 border rounded-md text-xs font-semibold hover:bg-accent"
      >
        <Plus size={14} /> เพิ่มรายการ
      </button>
    </div>
  );
}
```

- [ ] **Step 11.2: Create AdjustmentTable**

Create `apps/web/src/pages/other-income/components/AdjustmentTable.tsx`:

```tsx
import { useFieldArray, type Control, type UseFormRegister } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { AccountSearchDropdown } from './AccountSearchDropdown';
import type { OtherIncomeFormValues } from '@/lib/otherIncome.schema';

interface Props {
  control: Control<OtherIncomeFormValues>;
  register: UseFormRegister<OtherIncomeFormValues>;
  /** Absolute value of (amountReceived - netExpected). 0 = no adjustment needed. */
  totalDiff: number;
  /** Sign of diff: positive = received > expected, negative = received < expected. */
  diffSign: 'over' | 'under' | 'zero';
  watchedAdjustments: Array<{ amount: number | string }>;
}

const adjAccountFilter = (a: { code: string }) =>
  a.code.startsWith('52-') || a.code.startsWith('53-') || a.code.startsWith('11-41');

export function AdjustmentTable({ control, register, totalDiff, diffSign, watchedAdjustments }: Props) {
  const { fields, append, remove } = useFieldArray({ control, name: 'adjustments' });
  const sumSpec = (watchedAdjustments ?? []).reduce(
    (s, a) => s + (Number(a.amount) || 0),
    0,
  );
  const remaining = +(totalDiff - sumSpec).toFixed(2);
  const balanced = Math.abs(remaining) < 0.01;

  if (diffSign === 'zero' && fields.length === 0) return null;

  return (
    <div className="rounded-lg border p-3 bg-card">
      <p className="text-sm font-bold mb-2">
        บัญชีบันทึกผลต่าง {totalDiff.toFixed(2)} ฿{' '}
        <span className="text-muted-foreground font-normal text-xs">
          (รวมต้องเท่ากับผลต่าง)
        </span>
      </p>
      <div className="space-y-2">
        {fields.map((f, idx) => (
          <div key={f.id} className="grid grid-cols-12 gap-2 items-start">
            <span className="col-span-1 inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-muted">
              {idx + 1}
            </span>
            <div className="col-span-5">
              <AccountSearchDropdown
                value={watchedAdjustments[idx]?.accountCode ?? ''}
                onChange={(code) => {
                  const event = { target: { value: code } } as any;
                  register(`adjustments.${idx}.accountCode`).onChange(event);
                }}
                filter={adjAccountFilter}
                placeholder="เลือกบัญชีปรับ"
              />
              <input
                {...register(`adjustments.${idx}.note`)}
                placeholder="หมายเหตุ (เช่น ค่าธรรมเนียมแบงก์)"
                className="w-full border rounded px-2 py-1 text-xs mt-1"
              />
            </div>
            <div className="col-span-3">
              <input
                type="number"
                step="0.01"
                {...register(`adjustments.${idx}.amount`)}
                className="w-full border rounded px-2 py-1 text-right font-mono"
                placeholder="0.00"
              />
            </div>
            <button
              type="button"
              onClick={() => remove(idx)}
              className="col-span-1 text-destructive hover:opacity-80"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => append({ accountCode: '', amount: 0, note: '' })}
          className="inline-flex items-center gap-1 px-2 py-1 border rounded-md text-xs hover:bg-accent"
        >
          <Plus size={12} /> เพิ่มบัญชี
        </button>
        {!balanced && remaining > 0 && (
          <button
            type="button"
            onClick={() => append({ accountCode: '', amount: remaining, note: '' })}
            className="inline-flex items-center gap-1 px-2 py-1 border rounded-md text-xs bg-primary/10 hover:bg-primary/20"
          >
            <Plus size={12} /> เพิ่มผลต่างที่เหลือ {remaining.toFixed(2)} ฿
          </button>
        )}
      </div>
      <div className="mt-2 pt-2 border-t text-xs flex justify-between">
        <span className="text-muted-foreground">รวมผลต่างที่ระบุ:</span>
        <span className="font-mono font-bold">
          {sumSpec.toFixed(2)} / {totalDiff.toFixed(2)} ฿
        </span>
      </div>
      {!balanced && (
        <p className="text-[10px] mt-1 text-orange-500">
          ⚠ ต้องระบุให้ครบ (V12: ผลรวม = ผลต่าง)
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 11.3: Create AutoJournalPreview**

Create `apps/web/src/pages/other-income/components/AutoJournalPreview.tsx`:

```tsx
interface JeLine {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string;
}

interface Props {
  lines: JeLine[];
}

/**
 * Read-only Dr/Cr preview. Shows BALANCED badge at the bottom.
 * v1: no override mode (locked). Override moved to post-MVP.
 */
export function AutoJournalPreview({ lines }: Props) {
  const totalDr = lines.reduce((s, l) => s + l.debit, 0);
  const totalCr = lines.reduce((s, l) => s + l.credit, 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01;

  return (
    <div className="rounded-lg border p-3 bg-card">
      <p className="text-sm font-bold mb-2">JOURNAL PREVIEW (Auto)</p>
      {lines.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">— ยังไม่มี —</p>
      ) : (
        <div className="font-mono text-xs space-y-1">
          {lines.map((l, idx) => {
            const isDr = l.debit > 0;
            return (
              <div key={idx} className="flex items-baseline gap-2 px-2 py-1 hover:bg-accent rounded">
                <span className={`font-bold w-6 ${isDr ? 'text-cyan-600' : 'text-purple-600'}`}>
                  {isDr ? 'Dr' : 'Cr'}
                </span>
                <span className={`font-bold w-20 ${isDr ? 'text-cyan-600' : 'text-purple-600'}`}>
                  {l.accountCode}
                </span>
                <span className="font-bold w-28 text-right">
                  {(isDr ? l.debit : l.credit).toFixed(2)}
                </span>
                {l.description && (
                  <span className="flex-1 text-muted-foreground truncate">({l.description})</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-2 pt-2 border-t flex items-center justify-between text-sm">
        <span className="text-muted-foreground text-xs">Dr รวม = Cr รวม</span>
        {balanced ? (
          <span className="text-green-600 font-bold font-mono">
            ✓ {totalDr.toFixed(2)} = {totalCr.toFixed(2)} BALANCED
          </span>
        ) : (
          <span className="text-destructive font-bold font-mono">
            ✗ Dr {totalDr.toFixed(2)} ≠ Cr {totalCr.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
```

**Note: V1 client-side preview only — backend re-validates on POST.**

- [ ] **Step 11.4: Create ReverseModal**

Create `apps/web/src/pages/other-income/components/ReverseModal.tsx`:

```tsx
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { OtherIncomeReverseReason } from '@/lib/otherIncome.types';

interface Props {
  docNumber: string;
  onCancel: () => void;
  onConfirm: (reason: OtherIncomeReverseReason, note: string) => void;
  isLoading?: boolean;
}

const REASONS: Array<{ value: OtherIncomeReverseReason; label: string }> = [
  { value: 'INPUT_ERROR', label: 'กรอกผิด — ลูกค้าผิด/ยอดผิด' },
  { value: 'CUSTOMER_REQUEST', label: 'ลูกค้าขอยกเลิก/คืนเงิน' },
  { value: 'DUPLICATE', label: 'บันทึกซ้ำ' },
  { value: 'WRONG_ACCOUNT', label: 'บัญชีผิด' },
  { value: 'WRONG_AMOUNT', label: 'ยอดเงินผิด' },
  { value: 'OTHER', label: 'อื่นๆ' },
];

export function ReverseModal({ docNumber, onCancel, onConfirm, isLoading }: Props) {
  const [reason, setReason] = useState<OtherIncomeReverseReason>('INPUT_ERROR');
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-background rounded-2xl border-2 border-destructive max-w-2xl w-full p-6">
        <h3 className="text-lg font-bold flex items-center gap-2 text-destructive mb-3">
          <AlertTriangle size={20} /> สร้าง Reversing Entry
        </h3>
        <p className="text-sm mb-4">
          กลับรายการเอกสาร <span className="font-mono font-bold">{docNumber}</span> — ระบบจะสร้างเอกสารใหม่ <span className="font-mono">{docNumber}-R</span> โดยสลับ Dr↔Cr อัตโนมัติ
        </p>
        <label className="text-xs font-semibold uppercase">ประเภทเหตุผล</label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as OtherIncomeReverseReason)}
          className="w-full border rounded-md px-3 py-2 text-sm mb-3"
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <label className="text-xs font-semibold uppercase">รายละเอียด (อย่างน้อย 5 ตัวอักษร)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="เช่น ลูกค้าโทรมาแจ้งว่ายอดผิด ต้องเป็น 1,500 ฿ ไม่ใช่ 5,000 ฿"
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <div className="rounded-md p-3 mt-3 bg-orange-500/10 border border-orange-500 text-xs">
          <strong>การ Reverse ไม่สามารถยกเลิกได้</strong> — ทั้งเอกสารต้นฉบับและ Reversing Entry จะอยู่ในระบบถาวร
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            type="button"
            className="px-4 py-2 text-sm font-semibold rounded-md border"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => onConfirm(reason, note)}
            disabled={note.trim().length < 5 || isLoading}
            className="px-5 py-2 text-sm font-bold rounded-md bg-destructive text-destructive-foreground disabled:opacity-50"
          >
            {isLoading ? 'กำลังกลับรายการ...' : 'ยืนยัน — สร้าง Reversing Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 11.5: Type-check + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web && \
git add apps/web/src/pages/other-income/components/ && \
git commit -m "feat(other-income/web): add ItemsTable + AdjustmentTable + AutoJournalPreview + ReverseModal

- ItemsTable: react-hook-form useFieldArray + per-row computed amounts
- AdjustmentTable: V12 footer (sum vs diff) + quick-add remaining
- AutoJournalPreview: read-only Dr/Cr + BALANCED badge (v1: no override)
- ReverseModal: 6-reason dropdown + ≥5-char note + 'cannot undo' warning"
```

---

## Phase 5: Pages

### Task 12: List page

**Files:**
- Create: `apps/web/src/pages/other-income/OtherIncomeListPage.tsx`

Mirror `apps/web/src/pages/ExpensesPage.tsx` for state/query/filter shape — read it first.

- [ ] **Step 12.1: Create the list page**

Create `apps/web/src/pages/other-income/OtherIncomeListPage.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FilePlus2, Search, Eye, Copy, FileText, AlertCircle, Lock, RotateCcw, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { otherIncomeApi } from '@/lib/otherIncome';
import type { OtherIncomeStatus } from '@/lib/otherIncome.types';
import { PageHeader } from '@/components/PageHeader';
import { QueryBoundary } from '@/components/QueryBoundary';
import { useDebounce } from '@/hooks/useDebounce';

export default function OtherIncomeListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<{ q: string; status: OtherIncomeStatus | '' }>({ q: '', status: '' });
  const debouncedQ = useDebounce(filter.q, 300);

  const list = useQuery({
    queryKey: ['other-income', { q: debouncedQ, status: filter.status }],
    queryFn: () =>
      otherIncomeApi.list({
        q: debouncedQ || undefined,
        status: filter.status || undefined,
        page: 1,
        limit: 50,
      }),
  });

  const stats = {
    draft: list.data?.data.filter((d) => d.status === 'DRAFT').length ?? 0,
    posted: list.data?.data.filter((d) => d.status === 'POSTED').length ?? 0,
    reversed: list.data?.data.filter((d) => d.status === 'REVERSED').length ?? 0,
  };

  const copyMutation = useMutation({
    mutationFn: (id: string) => otherIncomeApi.copy(id),
    onSuccess: (clone) => {
      toast.success(`คัดลอกเป็น ${clone.docNumber} แล้ว`);
      qc.invalidateQueries({ queryKey: ['other-income'] });
      navigate(`/other-income/${clone.id}/edit`);
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={[{ label: 'รายได้อื่น' }]}
        action={
          <button
            onClick={() => navigate('/other-income/new')}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-primary-foreground bg-primary hover:opacity-90"
          >
            <FilePlus2 size={18} /> สร้างเอกสารใหม่
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatCard label="ฉบับร่าง" sublabel="DRAFT" value={stats.draft} tone="warning" icon={<AlertCircle size={16} />} onClick={() => setFilter({ ...filter, status: 'DRAFT' })} />
        <StatCard label="บันทึกแล้ว" sublabel="POSTED" value={stats.posted} tone="success" icon={<Lock size={16} />} onClick={() => setFilter({ ...filter, status: 'POSTED' })} />
        <StatCard label="กลับรายการ" sublabel="REVERSED" value={stats.reversed} tone="danger" icon={<RotateCcw size={16} />} onClick={() => setFilter({ ...filter, status: 'REVERSED' })} />
        <StatCard label="สรุปรายวัน" sublabel="DAILY SHEET" value={<ListChecks size={20} />} tone="info" icon={<ListChecks size={16} />} onClick={() => navigate('/other-income/daily-sheet')} />
      </div>

      <div className="border rounded-xl p-4 flex items-center gap-3 bg-card flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter.q}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            placeholder="ค้นหาเลขเอกสาร / คู่ค้า / เลขใบเสร็จ"
            className="w-full pl-9 pr-3 py-2 border rounded-md text-sm"
          />
        </div>
        <select
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value as any })}
          className="px-3 py-2 border rounded-md text-sm"
        >
          <option value="">ทุกสถานะ</option>
          <option value="DRAFT">DRAFT</option>
          <option value="POSTED">POSTED</option>
          <option value="REVERSED">REVERSED</option>
        </select>
      </div>

      <QueryBoundary query={list}>
        {list.data && (
          <div className="border rounded-xl overflow-hidden bg-card">
            {list.data.data.length === 0 ? (
              <div className="text-center py-16">
                <FileText size={36} className="mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">— ยังไม่มีเอกสาร —</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left">เลขเอกสาร</th>
                    <th className="px-4 py-3 text-left">คู่ค้า</th>
                    <th className="px-4 py-3 text-left">บัญชีรายได้</th>
                    <th className="px-4 py-3 text-right">ยอดรวม</th>
                    <th className="px-4 py-3 text-left">วันที่</th>
                    <th className="px-4 py-3 text-left">สถานะ</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((d) => (
                    <tr
                      key={d.id}
                      className={`border-t hover:bg-accent ${d.status === 'REVERSED' ? 'line-through text-muted-foreground' : ''}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs">{d.docNumber}</td>
                      <td className="px-4 py-3">{d.customer?.name ?? d.counterpartyName ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs">{d.items[0]?.accountCode ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono">{Number(d.totalAmount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs">{d.issueDate.slice(0, 10)}</td>
                      <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => navigate(d.status === 'DRAFT' ? `/other-income/${d.id}/edit` : `/other-income/${d.id}`)}
                            className="px-3 py-1.5 text-xs border rounded-md hover:bg-accent inline-flex items-center gap-1"
                          >
                            <Eye size={12} /> ดู
                          </button>
                          {(d.status === 'POSTED' || d.status === 'REVERSED') && (
                            <button
                              onClick={() => copyMutation.mutate(d.id)}
                              className="px-3 py-1.5 text-xs border rounded-md hover:bg-accent inline-flex items-center gap-1"
                            >
                              <Copy size={12} /> คัดลอก
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}

function StatCard({ label, sublabel, value, tone, icon, onClick }: any) {
  const colorMap: Record<string, string> = {
    warning: 'border-orange-500 bg-orange-500/10 text-orange-700',
    success: 'border-green-500 bg-green-500/10 text-green-700',
    danger: 'border-red-500 bg-red-500/10 text-red-700',
    info: 'border-blue-500 bg-blue-500/10 text-blue-700',
  };
  return (
    <button onClick={onClick} className={`text-left rounded-xl border-2 p-3 hover:shadow-md ${colorMap[tone]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold">{label}</p>
          <p className="text-[10px] opacity-70">{sublabel}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <div>{icon}</div>
      </div>
    </button>
  );
}

function StatusBadge({ status }: { status: OtherIncomeStatus }) {
  const map: Record<OtherIncomeStatus, string> = {
    DRAFT: 'bg-orange-500/10 text-orange-700 border-orange-500',
    POSTED: 'bg-green-500/10 text-green-700 border-green-500',
    REVERSED: 'bg-red-500/10 text-red-700 border-red-500',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${map[status]}`}>{status}</span>;
}
```

- [ ] **Step 12.2: Type-check + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web && \
git add apps/web/src/pages/other-income/OtherIncomeListPage.tsx && \
git commit -m "feat(other-income/web): add OtherIncomeListPage with status cards + filter + table"
```

---

### Task 13: Entry page (single-page form)

**Files:**
- Create: `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx`

This is the largest UI component. It uses react-hook-form + zod + the components from T10/T11.

- [ ] **Step 13.1: Create the entry page**

Create `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { otherIncomeApi } from '@/lib/otherIncome';
import { otherIncomeFormSchema, type OtherIncomeFormValues } from '@/lib/otherIncome.schema';
import { ItemsTable } from './components/ItemsTable';
import { AdjustmentTable } from './components/AdjustmentTable';
import { AutoJournalPreview } from './components/AutoJournalPreview';
import { CounterpartyPicker } from './components/CounterpartyPicker';
import { PaymentCompareCard } from './components/PaymentCompareCard';

const PAYMENT_ACCOUNTS = [
  { code: '11-1101', label: 'เงินสด - สุทธินีย์' },
  { code: '11-1102', label: 'เงินสด - เอกนรินทร์' },
  { code: '11-1201', label: 'ธ.กสิกรไทย' },
  { code: '11-1202', label: 'ธ.SCB ค่าใช้จ่าย' },
  { code: '11-1203', label: 'ธ.SCB ค่าเสื่อม' },
];

export default function OtherIncomeEntryPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const qc = useQueryClient();

  const existing = useQuery({
    queryKey: ['other-income', id],
    queryFn: () => otherIncomeApi.findOne(id!),
    enabled: isEdit,
  });

  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const form = useForm<OtherIncomeFormValues>({
    resolver: zodResolver(otherIncomeFormSchema),
    defaultValues: {
      issueDate: today,
      dueDate: sevenDaysLater,
      paymentDate: today,
      priceType: 'EXCLUSIVE',
      paymentAccountCode: '11-1201',
      amountReceived: 0,
      counterpartyName: '',
      items: [
        {
          accountCode: '42-1102',
          quantity: 1,
          unitAmount: 0,
          discountAmount: 0,
          vatPct: 0,
          whtPct: 15,
          description: '',
        },
      ],
      adjustments: [],
    },
  });

  // Populate when editing existing draft
  useEffect(() => {
    if (existing.data) {
      form.reset({
        issueDate: existing.data.issueDate.slice(0, 10),
        dueDate: existing.data.dueDate?.slice(0, 10) ?? '',
        paymentDate: existing.data.paymentDate?.slice(0, 10) ?? '',
        priceType: existing.data.priceType,
        customerId: existing.data.customerId ?? '',
        counterpartyName: existing.data.counterpartyName ?? '',
        counterpartyTaxId: existing.data.counterpartyTaxId ?? '',
        counterpartyAddress: existing.data.counterpartyAddress ?? '',
        counterpartyPhone: existing.data.counterpartyPhone ?? '',
        paymentAccountCode: existing.data.paymentAccountCode,
        amountReceived: Number(existing.data.amountReceived),
        items: existing.data.items.map((it) => ({
          accountCode: it.accountCode,
          description: it.description ?? '',
          quantity: Number(it.quantity),
          unitAmount: Number(it.unitAmount),
          discountAmount: Number(it.discountAmount),
          vatPct: Number(it.vatPct),
          whtPct: Number(it.whtPct),
        })),
        adjustments: existing.data.adjustments.map((a) => ({
          accountCode: a.accountCode,
          amount: Number(a.amount),
          note: a.note ?? '',
        })),
        customerNote: existing.data.customerNote ?? '',
      });
    }
  }, [existing.data, form]);

  const watched = form.watch();

  // Compute totals client-side for preview
  const totals = useMemo(() => {
    const items = watched.items.map((it) => {
      const qty = Number(it.quantity) || 0;
      const unit = Number(it.unitAmount) || 0;
      const disc = Number(it.discountAmount) || 0;
      const vatPct = Number(it.vatPct) || 0;
      const whtPct = Number(it.whtPct) || 0;
      const gross = qty * unit - disc;
      let amountBeforeVat: number;
      let vatAmount: number;
      if (vatPct > 0) {
        if (watched.priceType === 'INCLUSIVE') {
          amountBeforeVat = +(gross / (1 + vatPct / 100)).toFixed(2);
          vatAmount = +(gross - amountBeforeVat).toFixed(2);
        } else {
          amountBeforeVat = gross;
          vatAmount = +((gross * vatPct) / 100).toFixed(2);
        }
      } else {
        amountBeforeVat = gross;
        vatAmount = 0;
      }
      const whtAmount = +((amountBeforeVat * whtPct) / 100).toFixed(2);
      return { ...it, amountBeforeVat, vatAmount, whtAmount };
    });
    const incomeGross = items.reduce((s, it) => s + it.amountBeforeVat, 0);
    const vatTotal = items.reduce((s, it) => s + it.vatAmount, 0);
    const whtTotal = items.reduce((s, it) => s + it.whtAmount, 0);
    const total = incomeGross + vatTotal;
    const net = total - whtTotal;
    return { items, incomeGross, vatTotal, whtTotal, total, net };
  }, [watched.items, watched.priceType]);

  // Generate JE preview lines client-side (matches AutoJournalService)
  const previewLines = useMemo(() => {
    const lines: Array<{ accountCode: string; debit: number; credit: number; description?: string }> = [];
    const received = Number(watched.amountReceived) || 0;
    if (received > 0) lines.push({ accountCode: watched.paymentAccountCode, debit: received, credit: 0, description: 'รับเงินจริง' });
    if (totals.whtTotal > 0) lines.push({ accountCode: '11-4103', debit: totals.whtTotal, credit: 0, description: 'WHT' });
    const diff = received - totals.net;
    for (const adj of watched.adjustments ?? []) {
      const amt = Number(adj.amount) || 0;
      if (!adj.accountCode || amt <= 0) continue;
      if (diff < 0) lines.push({ accountCode: adj.accountCode, debit: amt, credit: 0, description: adj.note });
      else lines.push({ accountCode: adj.accountCode, debit: 0, credit: amt, description: adj.note });
    }
    for (const it of watched.items) {
      if (!it.accountCode) continue;
      lines.push({ accountCode: it.accountCode, debit: 0, credit: totals.items.find((x) => x.accountCode === it.accountCode)?.amountBeforeVat ?? 0, description: it.description });
    }
    if (totals.vatTotal > 0) lines.push({ accountCode: '21-2101', debit: 0, credit: totals.vatTotal, description: 'VAT ภ.พ.30' });
    return lines;
  }, [watched, totals]);

  const saveDraft = useMutation({
    mutationFn: (values: OtherIncomeFormValues) =>
      isEdit ? otherIncomeApi.update(id!, values) : otherIncomeApi.create(values),
    onSuccess: (doc) => {
      toast.success('บันทึกร่างแล้ว');
      qc.invalidateQueries({ queryKey: ['other-income'] });
      if (!isEdit) navigate(`/other-income/${doc.id}/edit`, { replace: true });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'บันทึกไม่สำเร็จ'),
  });

  const postMutation = useMutation({
    mutationFn: async (values: OtherIncomeFormValues) => {
      const draft = isEdit
        ? await otherIncomeApi.update(id!, values)
        : await otherIncomeApi.create(values);
      return otherIncomeApi.post(draft.id);
    },
    onSuccess: (doc) => {
      toast.success('บันทึก & POST เรียบร้อย');
      qc.invalidateQueries({ queryKey: ['other-income'] });
      navigate(`/other-income/${doc.id}`);
    },
    onError: (e: any) => {
      const errors = e?.response?.data?.errors;
      if (Array.isArray(errors)) {
        toast.error(`Validation failed: ${errors.map((x: any) => `[${x.rule}] ${x.msg}`).join('; ')}`);
      } else {
        toast.error(e?.response?.data?.message ?? 'POST ไม่สำเร็จ');
      }
    },
  });

  const diffSign: 'over' | 'under' | 'zero' =
    Math.abs((Number(watched.amountReceived) || 0) - totals.net) < 0.01
      ? 'zero'
      : (Number(watched.amountReceived) || 0) > totals.net
      ? 'over'
      : 'under';

  return (
    <form
      onSubmit={form.handleSubmit((v) => postMutation.mutate(v))}
      className="space-y-4 pb-24"
    >
      <div className="rounded-xl border px-6 py-4 flex items-center justify-between bg-card">
        <div>
          <button
            type="button"
            onClick={() => navigate('/other-income')}
            className="inline-flex items-center gap-1 text-xs font-semibold mb-2 text-muted-foreground"
          >
            <ArrowLeft size={12} /> กลับ
          </button>
          <h2 className="text-2xl font-bold">{isEdit ? 'แก้ไขเอกสาร' : 'บันทึกรายได้อื่น'}</h2>
          <p className="text-xs text-muted-foreground">42-XXXX · Auto Journal · V1-V14</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">เลขที่เอกสาร</p>
          <p className="font-mono font-bold text-lg">{existing.data?.docNumber ?? '— จะสร้างตอนบันทึก —'}</p>
        </div>
      </div>

      {/* Section 1: Header */}
      <div className="rounded-xl border p-5 bg-card space-y-3">
        <h3 className="font-bold">1. ข้อมูลเอกสาร</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs">วันที่ออก</label>
            <input type="date" {...form.register('issueDate')} className="w-full border rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs">ครบกำหนด</label>
            <input type="date" {...form.register('dueDate')} className="w-full border rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs">ประเภท VAT</label>
            <select {...form.register('priceType')} className="w-full border rounded-md px-2 py-1.5 text-sm">
              <option value="EXCLUSIVE">แยกภาษี (Exclusive)</option>
              <option value="INCLUSIVE">รวมภาษี (Inclusive)</option>
            </select>
          </div>
        </div>
        <div className="mt-2">
          <label className="text-xs">ลูกค้า / คู่ค้า (optional)</label>
          <Controller
            control={form.control}
            name="counterpartyName"
            render={({ field }) => (
              <CounterpartyPicker
                value={{
                  customerId: form.getValues('customerId') ?? null,
                  name: field.value ?? '',
                  taxId: form.getValues('counterpartyTaxId'),
                  address: form.getValues('counterpartyAddress'),
                  phone: form.getValues('counterpartyPhone'),
                }}
                onChange={(cp) => {
                  form.setValue('customerId', cp.customerId ?? '');
                  field.onChange(cp.name);
                  form.setValue('counterpartyTaxId', cp.taxId ?? '');
                  form.setValue('counterpartyAddress', cp.address ?? '');
                  form.setValue('counterpartyPhone', cp.phone ?? '');
                }}
              />
            )}
          />
        </div>
      </div>

      {/* Section 2: Items */}
      <div className="rounded-xl border p-5 bg-card">
        <h3 className="font-bold mb-3">2. รายการบัญชี</h3>
        <ItemsTable control={form.control} register={form.register} watch={form.watch} />
        <div className="mt-3 pt-3 border-t flex justify-between text-sm">
          <span className="text-muted-foreground">ก่อนภาษี:</span>
          <span className="font-mono font-bold">{totals.incomeGross.toFixed(2)} ฿</span>
        </div>
        {totals.vatTotal > 0 && (
          <div className="flex justify-between text-xs">
            <span>+ VAT:</span>
            <span className="font-mono">{totals.vatTotal.toFixed(2)}</span>
          </div>
        )}
        {totals.whtTotal > 0 && (
          <div className="flex justify-between text-xs">
            <span>− WHT:</span>
            <span className="font-mono">{totals.whtTotal.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold border-t pt-2 mt-2">
          <span>ยอดสุทธิที่ควรได้รับ:</span>
          <span className="font-mono">{totals.net.toFixed(2)} ฿</span>
        </div>
      </div>

      {/* Section 3: Payment */}
      <div className="rounded-xl border p-5 bg-card space-y-3">
        <h3 className="font-bold">3. ช่องทางชำระเงิน</h3>
        <div className="grid grid-cols-3 gap-2">
          {PAYMENT_ACCOUNTS.map((p) => (
            <label
              key={p.code}
              className={`px-3 py-2 rounded-lg border-2 cursor-pointer ${watched.paymentAccountCode === p.code ? 'border-primary bg-primary/10' : 'border-border'}`}
            >
              <input
                type="radio"
                value={p.code}
                {...form.register('paymentAccountCode')}
                className="sr-only"
              />
              <p className="text-xs font-semibold">{p.label}</p>
              <p className="text-[10px] font-mono text-muted-foreground">{p.code}</p>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs">วันที่ชำระ</label>
            <input type="date" {...form.register('paymentDate')} className="w-full border rounded-md px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs">จำนวนเงินที่ได้รับจริง</label>
            <input
              type="number"
              step="0.01"
              {...form.register('amountReceived')}
              className="w-full border-2 border-primary rounded-md px-3 py-2 text-right font-mono"
            />
            <button
              type="button"
              onClick={() => form.setValue('amountReceived', totals.net)}
              className="text-[11px] mt-1 underline text-primary"
            >
              ใช้ยอดสุทธิ ({totals.net.toFixed(2)})
            </button>
          </div>
        </div>
        <PaymentCompareCard expected={totals.net} received={Number(watched.amountReceived) || 0} />
        {diffSign !== 'zero' && (
          <AdjustmentTable
            control={form.control}
            register={form.register}
            totalDiff={Math.abs((Number(watched.amountReceived) || 0) - totals.net)}
            diffSign={diffSign}
            watchedAdjustments={(watched.adjustments ?? []) as any}
          />
        )}
      </div>

      {/* Section 4: JV preview */}
      <AutoJournalPreview lines={previewLines} />

      {/* Sticky bottom */}
      <div className="fixed bottom-2 left-0 right-0 mx-auto max-w-[1280px] px-5">
        <div className="rounded-xl border shadow-2xl px-5 py-3 flex items-center justify-between bg-card flex-wrap gap-3">
          <div className="flex items-center gap-3 text-sm">
            {form.formState.isValid ? (
              <span className="inline-flex items-center gap-1 text-green-600 font-bold">
                <CheckCircle2 size={16} /> พร้อมบันทึก
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-orange-600">
                <AlertCircle size={16} /> ยังมีข้อมูลที่ต้องแก้ไข
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/other-income')}
              className="px-4 py-2 text-sm font-semibold border rounded-md"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={form.handleSubmit((v) => saveDraft.mutate(v))}
              disabled={saveDraft.isPending}
              className="inline-flex items-center gap-1 px-4 py-2 text-sm font-semibold border rounded-md hover:bg-accent"
            >
              <Save size={14} /> บันทึกร่าง
            </button>
            <button
              type="submit"
              disabled={postMutation.isPending}
              className="inline-flex items-center gap-1 px-5 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-md disabled:opacity-50"
            >
              <ShieldCheck size={14} /> {postMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก & POST'}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
```

- [ ] **Step 13.2: Type-check + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web && \
git add apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx && \
git commit -m "feat(other-income/web): add OtherIncomeEntryPage (single-page form)

- react-hook-form + zod validation
- Live JE preview matching AutoJournalService logic
- AdjustmentTable shown only when amountReceived ≠ net
- Save Draft + Save & POST buttons (sticky bottom)"
```

---

### Task 14: View page (read-only + audit trail + reverse)

**Files:**
- Create: `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx`

- [ ] **Step 14.1: Create view page**

Create `apps/web/src/pages/other-income/OtherIncomeViewPage.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock, RotateCcw, Printer, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { otherIncomeApi } from '@/lib/otherIncome';
import type { OtherIncomeReverseReason } from '@/lib/otherIncome.types';
import { ReverseModal } from './components/ReverseModal';
import { QueryBoundary } from '@/components/QueryBoundary';
import { useAuth } from '@/contexts/AuthContext';

export default function OtherIncomeViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [showReverse, setShowReverse] = useState(false);

  const doc = useQuery({
    queryKey: ['other-income', id],
    queryFn: () => otherIncomeApi.findOne(id!),
    enabled: !!id,
  });

  const reverseMutation = useMutation({
    mutationFn: ({ reason, note }: { reason: OtherIncomeReverseReason; note: string }) =>
      otherIncomeApi.reverse(id!, reason, note),
    onSuccess: (reversal) => {
      toast.success(`สร้าง Reversing Entry: ${reversal.docNumber}`);
      qc.invalidateQueries({ queryKey: ['other-income'] });
      setShowReverse(false);
      navigate(`/other-income/${reversal.id}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Reverse ไม่สำเร็จ'),
  });

  const canReverse =
    doc.data?.status === 'POSTED' &&
    !doc.data?.reversedById &&
    !doc.data?.reversesId &&
    (user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER');

  const justPosted =
    doc.data?.postedAt &&
    Date.now() - new Date(doc.data.postedAt).getTime() < 60_000;

  return (
    <QueryBoundary query={doc}>
      {doc.data && (
        <div className="space-y-4">
          {justPosted && (
            <div className="rounded-xl border-2 border-green-500 bg-green-500/10 px-5 py-4 flex items-center gap-4">
              <CheckCircle2 size={24} className="text-green-600" />
              <div className="flex-1">
                <p className="font-bold text-green-700">บันทึกและ POST เรียบร้อยแล้ว</p>
                <p className="text-xs text-green-700/80">
                  เอกสาร {doc.data.docNumber} ลงบัญชีเรียบร้อย — กดปุ่มขวามือเพื่อพิมพ์ใบเสร็จ
                </p>
              </div>
              {doc.data.customerId && (
                <button
                  onClick={() => navigate(`/other-income/${doc.data.id}/receipt`)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-primary text-primary-foreground rounded-md"
                >
                  <Printer size={16} /> พิมพ์ใบเสร็จเลย
                </button>
              )}
            </div>
          )}

          <div className="rounded-xl border px-6 py-4 flex items-center justify-between bg-card">
            <div>
              <button
                onClick={() => navigate('/other-income')}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              >
                <ArrowLeft size={12} /> กลับ
              </button>
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <Lock size={20} /> {doc.data.status === 'REVERSED' ? 'เอกสารถูก REVERSE' : 'เอกสารบันทึกแล้ว'}
              </h2>
            </div>
            <div className="text-right">
              <p className="font-mono font-bold text-lg">{doc.data.docNumber}</p>
              <p className="text-xs text-muted-foreground">JV: {doc.data.journalEntryId ?? '-'}</p>
              <p className="text-xs text-muted-foreground">RC: {doc.data.receiptNo ?? '-'}</p>
            </div>
          </div>

          {/* Header */}
          <div className="rounded-xl border p-5 bg-card grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">คู่ค้า</p>
              <p className="font-bold">{doc.data.customer?.name ?? doc.data.counterpartyName ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">วันที่ออก</p>
              <p>{doc.data.issueDate.slice(0, 10)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">ช่องทางชำระ</p>
              <p>{doc.data.paymentAccountCode}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">จำนวนรับ</p>
              <p className="font-mono font-bold">{Number(doc.data.amountReceived).toFixed(2)} ฿</p>
            </div>
          </div>

          {/* Items */}
          <div className="rounded-xl border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">บัญชี</th>
                  <th className="px-3 py-2 text-left">รายละเอียด</th>
                  <th className="px-3 py-2 text-right">ก่อนภาษี</th>
                  <th className="px-3 py-2 text-right">VAT</th>
                  <th className="px-3 py-2 text-right">WHT</th>
                </tr>
              </thead>
              <tbody>
                {doc.data.items.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{it.accountCode}</td>
                    <td className="px-3 py-2">{it.description ?? it.accountName}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(it.amountBeforeVat).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(it.vatAmount).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(it.whtAmount).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Reverse linkage */}
          {doc.data.reversesId && (
            <div className="rounded-xl border-2 border-destructive p-4 bg-destructive/10">
              <p className="font-semibold">↺ คือ Reversing Entry — กลับรายการของเอกสารต้นฉบับ</p>
              {doc.data.reverseNote && <p className="text-xs mt-1">เหตุผล: {doc.data.reverseNote}</p>}
            </div>
          )}
          {doc.data.reversedById && (
            <div className="rounded-xl border-2 border-destructive p-4 bg-destructive/10">
              <p className="font-semibold">⚠ เอกสารนี้ถูก REVERSE แล้ว</p>
              {doc.data.reverseNote && <p className="text-xs mt-1">เหตุผล: {doc.data.reverseNote}</p>}
            </div>
          )}

          {/* Reverse button */}
          {canReverse && (
            <div className="flex justify-end">
              <button
                onClick={() => setShowReverse(true)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border rounded-md hover:bg-accent"
              >
                <RotateCcw size={12} /> กลับรายการ (Reverse Entry)
              </button>
            </div>
          )}

          {showReverse && (
            <ReverseModal
              docNumber={doc.data.docNumber}
              onCancel={() => setShowReverse(false)}
              onConfirm={(reason, note) => reverseMutation.mutate({ reason, note })}
              isLoading={reverseMutation.isPending}
            />
          )}
        </div>
      )}
    </QueryBoundary>
  );
}
```

- [ ] **Step 14.2: Type-check + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web && \
git add apps/web/src/pages/other-income/OtherIncomeViewPage.tsx && \
git commit -m "feat(other-income/web): add OtherIncomeViewPage (read-only + reverse modal)"
```

---

### Task 15: Receipt page (A4 print)

**Files:**
- Create: `apps/web/src/pages/other-income/OtherIncomeReceiptPage.tsx`

- [ ] **Step 15.1: Create receipt page**

Create `apps/web/src/pages/other-income/OtherIncomeReceiptPage.tsx`:

```tsx
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { otherIncomeApi } from '@/lib/otherIncome';
import { QueryBoundary } from '@/components/QueryBoundary';

const formatThaiDate = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear() + 543}`;
};

export default function OtherIncomeReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const doc = useQuery({
    queryKey: ['other-income', id],
    queryFn: () => otherIncomeApi.findOne(id!),
    enabled: !!id,
  });

  return (
    <QueryBoundary query={doc}>
      {doc.data && (
        <div className="space-y-4">
          <style>{`
            @media print {
              @page { size: A4; margin: 12mm; }
              .no-print { display: none !important; }
              body { background: white !important; }
              .receipt-page { box-shadow: none !important; padding: 0 !important; }
            }
          `}</style>

          <div className="no-print rounded-xl border px-6 py-4 flex items-center justify-between bg-card">
            <button
              onClick={() => navigate(`/other-income/${id}`)}
              className="inline-flex items-center gap-1 text-sm"
            >
              <ArrowLeft size={14} /> กลับ
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-primary text-primary-foreground rounded-md"
            >
              <Printer size={16} /> พิมพ์ใบเสร็จ
            </button>
          </div>

          <div className="receipt-page mx-auto max-w-[210mm] bg-white text-black p-8 shadow-xl">
            <div className="text-right mb-4">
              <p className="text-xs">(ต้นฉบับ)</p>
              <h1 className="text-3xl font-bold text-blue-900">ใบเสร็จรับเงิน/ใบกำกับภาษี</h1>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="text-sm">
                <p className="font-bold">บริษัท เบสท์ช้อยส์ ไฟแนนท์ จำกัด</p>
                <p className="text-xs text-gray-600">(ที่อยู่ + เลขผู้เสียภาษี)</p>
              </div>
              <div className="bg-blue-50 p-3 rounded text-sm">
                <p>เลขที่: <strong>{doc.data.receiptNo ?? doc.data.docNumber}</strong></p>
                <p>วันที่: {formatThaiDate(doc.data.issueDate)}</p>
                <p>JV: {doc.data.journalEntryId ?? '-'}</p>
              </div>
            </div>

            <div className="border-t border-b py-3 mb-4 text-sm">
              <p className="font-bold mb-1">ลูกค้า / คู่ค้า:</p>
              <p>{doc.data.customer?.name ?? doc.data.counterpartyName ?? '—'}</p>
              {doc.data.counterpartyAddress && <p className="text-xs">{doc.data.counterpartyAddress}</p>}
              {doc.data.counterpartyTaxId && <p className="text-xs">TAX ID: {doc.data.counterpartyTaxId}</p>}
            </div>

            <table className="w-full text-sm border-t border-b mb-6">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-2 py-2 text-left">รายละเอียด</th>
                  <th className="px-2 py-2 text-right">จำนวน</th>
                  <th className="px-2 py-2 text-right">ราคา</th>
                  <th className="px-2 py-2 text-center">VAT</th>
                  <th className="px-2 py-2 text-right">ก่อนภาษี</th>
                </tr>
              </thead>
              <tbody>
                {doc.data.items.map((it) => (
                  <tr key={it.id} className="border-t">
                    <td className="px-2 py-2">
                      <p className="font-bold">{it.accountName}</p>
                      <p className="text-xs">({it.accountCode})</p>
                      {it.description && <p className="text-xs text-gray-600">{it.description}</p>}
                    </td>
                    <td className="px-2 py-2 text-right">{Number(it.quantity).toFixed(2)}</td>
                    <td className="px-2 py-2 text-right">{Number(it.unitAmount).toFixed(2)}</td>
                    <td className="px-2 py-2 text-center">{Number(it.vatPct) > 0 ? `${it.vatPct}%` : '-'}</td>
                    <td className="px-2 py-2 text-right">{Number(it.amountBeforeVat).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div></div>
              <div className="space-y-1">
                <div className="flex justify-between"><span>รวมก่อน VAT:</span><strong>{Number(doc.data.incomeGross).toFixed(2)}</strong></div>
                {Number(doc.data.vatAmount) > 0 && (
                  <div className="flex justify-between"><span>VAT 7%:</span><strong>{Number(doc.data.vatAmount).toFixed(2)}</strong></div>
                )}
                <div className="flex justify-between bg-blue-50 p-2 rounded"><span className="font-bold">จำนวนเงินทั้งสิ้น:</span><strong>{Number(doc.data.totalAmount).toFixed(2)} ฿</strong></div>
                {Number(doc.data.whtAmount) > 0 && (
                  <div className="flex justify-between text-xs"><span>หัก ณ ที่จ่าย:</span><span>{Number(doc.data.whtAmount).toFixed(2)}</span></div>
                )}
                <div className="flex justify-between text-xs border-t pt-1"><span>ยอดที่ชำระ:</span><span>{Number(doc.data.amountReceived).toFixed(2)} ฿</span></div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-8 mt-12 text-center text-xs">
              <div>
                <div className="border-b border-gray-400 mb-2 h-12"></div>
                <p>ผู้ออกเอกสาร / ผู้รับเงิน</p>
              </div>
              <div>
                <div className="border-b border-gray-400 mb-2 h-12"></div>
                <p>ผู้รับเอกสาร / ลูกค้า</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}
```

- [ ] **Step 15.2: Type-check + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web && \
git add apps/web/src/pages/other-income/OtherIncomeReceiptPage.tsx && \
git commit -m "feat(other-income/web): add OtherIncomeReceiptPage (A4 print)"
```

---

### Task 16: Daily sheet page

**Files:**
- Create: `apps/web/src/pages/other-income/OtherIncomeDailySheetPage.tsx`

- [ ] **Step 16.1: Create daily sheet page**

Create `apps/web/src/pages/other-income/OtherIncomeDailySheetPage.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { otherIncomeApi } from '@/lib/otherIncome';
import { QueryBoundary } from '@/components/QueryBoundary';

const today = () => new Date().toISOString().slice(0, 10);

export default function OtherIncomeDailySheetPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(today());
  const sheet = useQuery({
    queryKey: ['daily-sheet', date],
    queryFn: () => otherIncomeApi.dailySheet(date),
  });

  const exportCsv = () => {
    if (!sheet.data) return;
    const rows: string[][] = [
      ['#', 'เลขเอกสาร', 'เลขใบเสร็จ', 'ลูกค้า', 'บัญชีรายได้', 'ก่อนภาษี', 'VAT', 'WHT', 'รับสุทธิ', 'ช่องทาง'],
    ];
    sheet.data.docs.forEach((d, idx) => {
      rows.push([
        String(idx + 1),
        d.docNumber,
        d.receiptNo ?? '-',
        d.customer?.name ?? d.counterpartyName ?? '-',
        d.items[0]?.accountCode ?? '-',
        Number(d.incomeGross).toFixed(2),
        Number(d.vatAmount).toFixed(2),
        Number(d.whtAmount).toFixed(2),
        Number(d.amountReceived).toFixed(2),
        d.paymentAccountCode,
      ]);
    });
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily-sheet-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <QueryBoundary query={sheet}>
      {sheet.data && (
        <div className="space-y-4">
          <div className="rounded-xl border px-6 py-4 flex items-center justify-between bg-card flex-wrap gap-3">
            <div>
              <button onClick={() => navigate('/other-income')} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowLeft size={12} /> กลับ
              </button>
              <h2 className="text-2xl font-bold">สรุปรายได้อื่นรายวัน</h2>
            </div>
            <div className="flex items-center gap-2">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border rounded-md px-3 py-1.5 text-sm" />
              <button onClick={() => setDate(today())} className="text-xs px-3 py-1.5 border rounded-md">วันนี้</button>
              <button onClick={exportCsv} className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border rounded-md">
                <Download size={14} /> CSV
              </button>
              <button onClick={() => window.print()} className="inline-flex items-center gap-1 px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md">
                <Printer size={14} /> พิมพ์
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryBox label="รายได้รวม" value={Number(sheet.data.summary.incomeGross)} color="text-blue-700" />
            <SummaryBox label="VAT 7%" value={Number(sheet.data.summary.vat)} color="text-orange-700" />
            <SummaryBox label="หัก ณ ที่จ่าย" value={Number(sheet.data.summary.wht)} color="text-red-700" />
            <SummaryBox label="รับสุทธิ" value={Number(sheet.data.summary.netReceived)} color="text-green-700" highlight />
          </div>

          <div className="rounded-xl border bg-card overflow-hidden">
            <h3 className="p-3 font-bold border-b">เอกสารทั้งหมด ({sheet.data.docs.length})</h3>
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">เลขเอกสาร</th>
                  <th className="px-2 py-2 text-left">ลูกค้า</th>
                  <th className="px-2 py-2 text-left">บัญชี</th>
                  <th className="px-2 py-2 text-right">ก่อนภาษี</th>
                  <th className="px-2 py-2 text-right">VAT</th>
                  <th className="px-2 py-2 text-right">WHT</th>
                  <th className="px-2 py-2 text-right">รับสุทธิ</th>
                </tr>
              </thead>
              <tbody>
                {sheet.data.docs.map((d, idx) => (
                  <tr key={d.id} className="border-t hover:bg-accent cursor-pointer" onClick={() => navigate(`/other-income/${d.id}`)}>
                    <td className="px-2 py-2 font-mono text-xs">{idx + 1}</td>
                    <td className="px-2 py-2 font-mono text-xs">{d.docNumber}</td>
                    <td className="px-2 py-2">{d.customer?.name ?? d.counterpartyName ?? '-'}</td>
                    <td className="px-2 py-2 font-mono text-xs">{d.items[0]?.accountCode ?? '-'}</td>
                    <td className="px-2 py-2 text-right font-mono">{Number(d.incomeGross).toFixed(2)}</td>
                    <td className="px-2 py-2 text-right font-mono">{Number(d.vatAmount).toFixed(2)}</td>
                    <td className="px-2 py-2 text-right font-mono">{Number(d.whtAmount).toFixed(2)}</td>
                    <td className="px-2 py-2 text-right font-mono font-bold">{Number(d.amountReceived).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border bg-card">
              <h3 className="p-3 font-bold border-b">แยกตามบัญชี</h3>
              <table className="w-full text-sm">
                <tbody>
                  {sheet.data.byAccount.map((r) => (
                    <tr key={r.code} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">{r.count} รายการ</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">{Number(r.total).toFixed(2)} ฿</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-xl border bg-card">
              <h3 className="p-3 font-bold border-b">แยกตามช่องทางชำระ</h3>
              <table className="w-full text-sm">
                <tbody>
                  {sheet.data.byPayment.map((r) => (
                    <tr key={r.code} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">{r.count} รายการ</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">{Number(r.total).toFixed(2)} ฿</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </QueryBoundary>
  );
}

function SummaryBox({ label, value, color, highlight }: { label: string; value: number; color: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border-2 p-3 ${highlight ? 'border-green-500 bg-green-500/10' : 'bg-card'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-mono font-bold mt-1 ${color}`} style={{ fontSize: highlight ? 20 : 16 }}>
        {value.toFixed(2)} ฿
      </p>
    </div>
  );
}
```

- [ ] **Step 16.2: Type-check + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web && \
git add apps/web/src/pages/other-income/OtherIncomeDailySheetPage.tsx && \
git commit -m "feat(other-income/web): add OtherIncomeDailySheetPage with CSV export + 3 breakdown tables"
```

---

### Task 17: Period Close UI page

**Files:**
- Create: `apps/web/src/pages/accounting/PeriodClosePage.tsx`
- Verify: backend endpoint `MonthlyCloseService` is exposed via existing controller (check `apps/api/src/modules/accounting/`).

- [ ] **Step 17.1: Verify backend endpoints exist**

Read `apps/api/src/modules/accounting/accounting.controller.ts` and look for routes like `GET /accounting/periods` or similar that expose `MonthlyCloseService`. If they don't exist, create them in this step:

Append to `accounting.controller.ts`:

```typescript
@Get('periods')
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
listPeriods() {
  return this.monthlyClose.listPeriods(); // implement in MonthlyCloseService if missing
}

@Post('periods/:year/:month/close')
@Roles('OWNER', 'FINANCE_MANAGER')
closePeriod(@Param('year') year: string, @Param('month') month: string, @CurrentUser('id') userId: string) {
  return this.monthlyClose.finalizePeriod(Number(year), Number(month), userId);
}

@Post('periods/:year/:month/reopen')
@Roles('OWNER')
reopenPeriod(@Param('year') year: string, @Param('month') month: string, @CurrentUser('id') userId: string) {
  return this.monthlyClose.reopenPeriod(Number(year), Number(month), userId);
}
```

If `listPeriods` or `reopenPeriod` don't exist on `MonthlyCloseService`, add them as small wrappers around `prisma.accountingPeriod.findMany` and an update setting `status: 'OPEN'`.

- [ ] **Step 17.2: Create PeriodClosePage**

Create `apps/web/src/pages/accounting/PeriodClosePage.tsx`:

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { QueryBoundary } from '@/components/QueryBoundary';
import { useAuth } from '@/contexts/AuthContext';

interface Period {
  year: number;
  month: number;
  status: 'OPEN' | 'REVIEW' | 'CLOSED' | 'SYNCED';
  closedAt: string | null;
  closedById: string | null;
}

export default function PeriodClosePage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const periods = useQuery<Period[]>({
    queryKey: ['accounting-periods'],
    queryFn: () => api.get('/accounting/periods').then((r) => r.data),
  });

  const closeMutation = useMutation({
    mutationFn: ({ year, month }: { year: number; month: number }) =>
      api.post(`/accounting/periods/${year}/${month}/close`).then((r) => r.data),
    onSuccess: () => {
      toast.success('ปิดงวดเรียบร้อย');
      qc.invalidateQueries({ queryKey: ['accounting-periods'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'ปิดงวดไม่สำเร็จ'),
  });

  const reopenMutation = useMutation({
    mutationFn: ({ year, month }: { year: number; month: number }) =>
      api.post(`/accounting/periods/${year}/${month}/reopen`).then((r) => r.data),
    onSuccess: () => {
      toast.success('เปิดงวดเรียบร้อย');
      qc.invalidateQueries({ queryKey: ['accounting-periods'] });
    },
  });

  const canManage = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  return (
    <QueryBoundary query={periods}>
      <div className="space-y-4">
        <div className="rounded-xl border px-6 py-4 bg-card">
          <h2 className="text-2xl font-bold">งวดบัญชี (Accounting Periods)</h2>
          <p className="text-xs text-muted-foreground">
            ปิดงวดหลังยื่น ภ.พ.30 เพื่อ block การบันทึกย้อนหลัง (V8)
          </p>
        </div>
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left">งวด</th>
                <th className="px-3 py-2 text-left">สถานะ</th>
                <th className="px-3 py-2 text-left">ปิดเมื่อ</th>
                {canManage && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {(periods.data ?? []).map((p) => (
                <tr key={`${p.year}-${p.month}`} className="border-t">
                  <td className="px-3 py-2 font-mono">
                    {p.year}-{String(p.month).padStart(2, '0')}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-3 py-2 text-xs">{p.closedAt ? p.closedAt.slice(0, 10) : '-'}</td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      {p.status === 'OPEN' || p.status === 'REVIEW' ? (
                        <button
                          onClick={() => {
                            if (confirm(`ปิดงวด ${p.year}-${p.month}? หลังปิดจะไม่สามารถบันทึกย้อนหลังได้`)) {
                              closeMutation.mutate({ year: p.year, month: p.month });
                            }
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border rounded-md hover:bg-accent"
                        >
                          <Lock size={12} /> ปิดงวด
                        </button>
                      ) : (
                        user?.role === 'OWNER' && (
                          <button
                            onClick={() => reopenMutation.mutate({ year: p.year, month: p.month })}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border rounded-md hover:bg-accent"
                          >
                            <Unlock size={12} /> เปิดงวด
                          </button>
                        )
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </QueryBoundary>
  );
}

function StatusBadge({ status }: { status: Period['status'] }) {
  const map: Record<Period['status'], string> = {
    OPEN: 'bg-green-500/10 text-green-700',
    REVIEW: 'bg-blue-500/10 text-blue-700',
    CLOSED: 'bg-orange-500/10 text-orange-700',
    SYNCED: 'bg-purple-500/10 text-purple-700',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${map[status]}`}>{status}</span>;
}
```

- [ ] **Step 17.3: Type-check + commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh all && \
git add apps/web/src/pages/accounting/ apps/api/src/modules/accounting/ && \
git commit -m "feat(accounting/web): add PeriodClosePage UI for V8 period management"
```

---

### Task 18: Register routes in App.tsx + sidebar nav

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx` (or whichever file holds the nav menu)

- [ ] **Step 18.1: Add lazy-loaded routes**

Open `apps/web/src/App.tsx`. Find existing `lazy()` imports near the top. Add:

```tsx
const OtherIncomeListPage = lazy(() => import('@/pages/other-income/OtherIncomeListPage'));
const OtherIncomeEntryPage = lazy(() => import('@/pages/other-income/OtherIncomeEntryPage'));
const OtherIncomeViewPage = lazy(() => import('@/pages/other-income/OtherIncomeViewPage'));
const OtherIncomeReceiptPage = lazy(() => import('@/pages/other-income/OtherIncomeReceiptPage'));
const OtherIncomeDailySheetPage = lazy(() => import('@/pages/other-income/OtherIncomeDailySheetPage'));
const PeriodClosePage = lazy(() => import('@/pages/accounting/PeriodClosePage'));
```

In the `<Routes>` block, add (inside the `MainLayout` wrapper if used elsewhere):

```tsx
<Route path="/other-income" element={
  <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <OtherIncomeListPage />
  </ProtectedRoute>
} />
<Route path="/other-income/new" element={
  <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <OtherIncomeEntryPage />
  </ProtectedRoute>
} />
<Route path="/other-income/daily-sheet" element={
  <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <OtherIncomeDailySheetPage />
  </ProtectedRoute>
} />
<Route path="/other-income/:id" element={
  <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <OtherIncomeViewPage />
  </ProtectedRoute>
} />
<Route path="/other-income/:id/edit" element={
  <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <OtherIncomeEntryPage />
  </ProtectedRoute>
} />
<Route path="/other-income/:id/receipt" element={
  <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <OtherIncomeReceiptPage />
  </ProtectedRoute>
} />
<Route path="/accounting/periods" element={
  <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
    <PeriodClosePage />
  </ProtectedRoute>
} />
```

**Important: declare `/other-income/daily-sheet` BEFORE `/other-income/:id` to prevent React Router from interpreting `daily-sheet` as a doc id.**

- [ ] **Step 18.2: Add sidebar nav entries**

Open the existing sidebar nav file (search for `Expenses` to find it). Add an entry next to Expenses:

```tsx
{
  label: 'รายได้อื่น',
  icon: TrendingUp, // or another lucide icon
  path: '/other-income',
  roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'],
},
{
  label: 'งวดบัญชี',
  icon: Calendar,
  path: '/accounting/periods',
  roles: ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'],
},
```

(Match the exact shape used by neighboring entries.)

- [ ] **Step 18.3: Type-check + smoke test in dev**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh all
cd apps/web && npm run dev &
sleep 5
# Open browser at http://localhost:5173 — log in as admin@bestchoice.com / admin1234
# Click "รายได้อื่น" in sidebar → list page should load
# Click "+ สร้างเอกสารใหม่" → entry page should load
# Browser dev console should show no errors
kill %1
```

- [ ] **Step 18.4: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/
git commit -m "feat(other-income/web): register routes + sidebar nav entries"
```

---

## Phase 8: E2E + final verification

### Task 19: E2E smoke test

**Files:**
- Create: `apps/web/e2e/other-income-smoke.spec.ts`

- [ ] **Step 19.1: Create the smoke test**

Create `apps/web/e2e/other-income-smoke.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';

const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3000';

test.describe('Other Income Module — smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page, 'admin@bestchoice.com', 'admin1234');
  });

  test('create + post + view', async ({ page }) => {
    // Create draft via API (faster than UI for smoke)
    const create = await page.request.post(`${API_URL}/other-income`, {
      headers: getAuthHeaders(page),
      data: {
        issueDate: '2026-05-06',
        priceType: 'EXCLUSIVE',
        paymentAccountCode: '11-1201',
        amountReceived: 850,
        counterpartyName: 'ทดสอบ KBank',
        items: [
          { accountCode: '42-1102', quantity: 1, unitAmount: 1000, whtPct: 15 },
        ],
      },
    });
    expect(create.ok()).toBeTruthy();
    const draft = await create.json();
    expect(draft.docNumber).toMatch(/^OI-/);

    // Post
    const post = await page.request.post(`${API_URL}/other-income/${draft.id}/post`, {
      headers: getAuthHeaders(page),
    });
    expect(post.ok()).toBeTruthy();
    const posted = await post.json();
    expect(posted.status).toBe('POSTED');
    expect(posted.journalEntryId).toBeTruthy();

    // Navigate to view page in UI
    await page.goto(`/other-income/${posted.id}`);
    await expect(page.getByText(posted.docNumber)).toBeVisible();
    await expect(page.getByText('POSTED').first()).toBeVisible();
  });

  test('list page shows the just-posted doc', async ({ page }) => {
    await page.goto('/other-income');
    await expect(page.getByRole('heading', { name: /รายได้อื่น/ })).toBeVisible();
    // Stats card "POSTED" should be > 0
    await expect(page.getByText('POSTED')).toBeVisible();
  });

  test('daily sheet aggregates today docs', async ({ page }) => {
    await page.goto('/other-income/daily-sheet');
    await expect(page.getByRole('heading', { name: /สรุปรายได้อื่นรายวัน/ })).toBeVisible();
    // Summary boxes always visible
    await expect(page.getByText('รายได้รวม')).toBeVisible();
    await expect(page.getByText('VAT 7%')).toBeVisible();
    await expect(page.getByText('รับสุทธิ')).toBeVisible();
  });
});
```

- [ ] **Step 19.2: Run E2E test**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx playwright test e2e/other-income-smoke.spec.ts --headed
```

Expected: 3 tests pass. If `loginViaAPI` helper signature differs from what I wrote, copy the exact import + call from a neighboring spec file (e.g., `accounting-contract-activation.spec.ts`).

- [ ] **Step 19.3: Commit**

```bash
git add apps/web/e2e/other-income-smoke.spec.ts && \
git commit -m "test(other-income/e2e): add smoke spec covering create+post+view+daily-sheet"
```

---

### Task 20: Final verification + PR prep

- [ ] **Step 20.1: Run full backend test suite**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api && npm test
```

Expected: all tests pass (existing suite + 5 new test files for other-income). If unrelated tests fail, investigate — it may be a regression introduced by schema changes.

- [ ] **Step 20.2: Run full type-check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh all
```

Expected: 0 errors.

- [ ] **Step 20.3: Run lint**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE && npm run lint || true
```

Fix any new lint errors introduced by this work. Pre-existing errors are out of scope.

- [ ] **Step 20.4: Run E2E smoke broadly**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/web && npx playwright test e2e/other-income-smoke.spec.ts e2e/login.spec.ts
```

Make sure no regressions in core flows.

- [ ] **Step 20.5: Smoke-test the UI manually**

Run dev servers and walk through:
1. Login as `admin@bestchoice.com` / `admin1234`
2. Sidebar → รายได้อื่น
3. + สร้างเอกสารใหม่
4. Fill: issueDate=today, counterparty="KBank", item= 42-1102 / qty=1 / unit=1000 / whtPct=15, paymentAccount=11-1201, amountReceived=850
5. Confirm: PaymentCompareCard shows ✓ตรงพอดี, JV preview shows 3 lines balanced
6. Click "บันทึก & POST"
7. Should redirect to View page with green banner + "พิมพ์ใบเสร็จเลย" button
8. Click reverse (as OWNER) → confirm reverse → should redirect to -R doc
9. Visit /other-income/daily-sheet → verify both docs appear with mirrored amounts

- [ ] **Step 20.6: Push branch + open PR**

```bash
git push -u origin feat/other-income-module
gh pr create --title "feat(other-income): 42-XXXX data-entry module (4 new tables + UI)" --body "$(cat <<'EOF'
## Summary
- New module: Other Income (42-XXXX) — entry → POST → reverse, single-page form, daily sheet, A4 receipt
- 3-state workflow (DRAFT → POSTED → REVERSED) per design D1
- Reuses existing JournalEntry/JournalLine/AccountingPeriod/AuditLog/ChartOfAccount

## Spec
- Design: \`docs/superpowers/specs/2026-05-06-other-income-module-design.md\`
- Plan: \`docs/superpowers/plans/2026-05-06-other-income-module.md\`

## Tests
- 5 new test files: doc-number / validation / auto-journal / service / controller
- 1 E2E smoke spec
- 0 TypeScript errors

## Test plan
- [ ] Login as admin → /other-income → see list page
- [ ] Create new draft → fill bank-interest fixture → Save Draft
- [ ] Re-open draft → Save & POST → confirm green banner + JE created
- [ ] Reverse the doc → confirm -R doc created with flipped Dr/Cr
- [ ] Daily sheet → both docs appear

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Note on auto-commit:** per project memory, NEVER push or open a PR without an explicit owner instruction. This step is documented for completeness — wait for the owner to say "push" / "create PR" before running.

- [ ] **Step 20.7: Update CLAUDE.md / accounting rules**

Add to `.claude/rules/accounting.md` near the bottom (under existing module pointers):

```markdown
## Other Income module (42-XXXX)
- Entry path for non-HP income (interest, gain on disposal, etc.)
- 3-state workflow: DRAFT → POSTED → REVERSED
- See `docs/superpowers/specs/2026-05-06-other-income-module-design.md`
- 42-1103 (ค่าปรับ) is intentionally blocked at V4 — already auto-posted via PaymentReceipt2BTemplate
```

Commit:

```bash
git add .claude/rules/accounting.md && \
git commit -m "docs: pointer to Other Income module in accounting rules"
```

---

## Self-review (after completion)

Before declaring "done":

- [ ] All 20 tasks completed with green checkmarks above
- [ ] `./tools/check-types.sh all` exits 0
- [ ] All `apps/api` tests pass
- [ ] E2E smoke spec passes
- [ ] Manual UI smoke passes
- [ ] No `console.log` / `TODO` / `FIXME` markers introduced
- [ ] Each task committed with a clear message; squash on PR merge

---

## Open follow-ups (post-MVP, NOT in this plan)

These are explicitly deferred per spec §2.2:
- Pattern B (Payroll 42-1104) — needs payroll module first
- e-Tax Invoice / e-WHT submission
- Multi-company support
- LIFF / customer-facing access
- Slash command `.claude/skills/create-other-income.md`
- Override JV mode in entry page (locked in v1)

---

*End of plan.*










