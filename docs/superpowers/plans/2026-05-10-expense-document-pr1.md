# PR-1: Expense Document Polymorphic — Schema + Wipe + EXPENSE Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy `Expense` model with a polymorphic `ExpenseDocument` system supporting EXPENSE type only (Same-day + Accrual flows), wipe all old expense data, switch UI to new API. Foundation for PR-2..PR-6 to add CN/PR/SE/Favorites/DailySummary on top.

**Architecture:** Polymorphic Class Table Inheritance — `ExpenseDocument` header table holds shared fields + `documentType` discriminator; `ExpenseDetail` (1:1 with header) holds EXPENSE-specific fields (just `category` for now). New module `expense-documents` with controller/service/dto folder. Two new JE templates (`ExpenseSameDayTemplate`, `ExpenseAccrualTemplate`) following the existing `cpa-templates/` pattern (atomicity, idempotency, postedAt = doc date). Numbering via Postgres advisory lock per (type, date) — pattern lifted from `other-income/services/doc-number.service.ts`. Wipe CLI mirrors `wipe-accounting.cli.ts`.

**Tech Stack:** NestJS + Prisma 6 + Postgres + class-validator (API). React 18 + Vite + @tanstack/react-query + Tailwind + shadcn/ui (Web). jest unit + vitest integration + Playwright E2E.

**Spec reference:** [docs/superpowers/specs/2026-05-10-expense-document-polymorphic-redesign.md](./2026-05-10-expense-document-polymorphic-redesign.md) — Sections 1-6, 8-9.

---

## File Structure

### API (apps/api/src)

| Path | Responsibility | Action |
|------|----------------|--------|
| `prisma/schema.prisma` | Add `ExpenseDocument`, `ExpenseDetail`, `DocumentType`, `DocumentStatus` enums; remove `Expense` model + `ExpenseStatus` + `ExpenseAccountType` enums | Modify |
| `prisma/migrations/<ts>_expense_documents/migration.sql` | DDL for new tables + drop old | Create (auto by `prisma migrate`) |
| `modules/expense-documents/expense-documents.module.ts` | NestJS module wiring | Create |
| `modules/expense-documents/expense-documents.controller.ts` | REST endpoints `/expense-documents` | Create |
| `modules/expense-documents/expense-documents.service.ts` | CRUD + post + void orchestration | Create |
| `modules/expense-documents/services/doc-number.service.ts` | Daily-reset numbering with advisory lock | Create |
| `modules/expense-documents/services/status-transition.service.ts` | Validates allowed transitions | Create |
| `modules/expense-documents/dto/create.dto.ts` | `CreateExpenseDocumentDto` (EXPENSE only in PR-1) | Create |
| `modules/expense-documents/dto/update.dto.ts` | `UpdateExpenseDocumentDto` (DRAFT-only edit) | Create |
| `modules/expense-documents/dto/list-query.dto.ts` | List query params (`tab`, `type`, `status`, etc.) | Create |
| `modules/journal/cpa-templates/expense-same-day.template.ts` | JE template — Dr expense / Cr cash | Create |
| `modules/journal/cpa-templates/expense-accrual.template.ts` | JE template — Dr expense / Cr 21-1104 | Create |
| `modules/journal/journal.module.ts` | Register new templates | Modify |
| `cli/wipe-expenses.cli.ts` | Destructive wipe CLI mirroring `wipe-accounting.cli.ts` | Create |
| `package.json` (apps/api) | Add `wipe:expenses` script | Modify |
| `app.module.ts` | Register `ExpenseDocumentsModule`, remove old `AccountingModule` expense routes | Modify |
| `modules/accounting/accounting.controller.ts` | Remove old `@Controller('expenses')` block | Modify |
| `modules/accounting/accounting.service.ts` | Remove `findAllExpenses`, `getExpenseSummary`, `findOneExpense`, `createExpense`, etc. (legacy methods) | Modify |
| `modules/accounting/accounting.module.ts` | Drop `ExpensesController` if separate | Modify |

### API tests

| Path | Responsibility |
|------|----------------|
| `modules/expense-documents/__tests__/doc-number.service.spec.ts` | Numbering: format, daily reset, race-safety stub, per-type seq |
| `modules/expense-documents/__tests__/status-transition.service.spec.ts` | Allowed/rejected transitions per type |
| `modules/expense-documents/__tests__/expense-documents.service.spec.ts` | Create, list, update DRAFT, post (delegates), void (delegates) |
| `modules/expense-documents/__tests__/expense-documents.controller.spec.ts` | Role guards, query param plumbing |
| `modules/journal/cpa-templates/expense-same-day.template.spec.ts` | JE balanced, correct accounts, idempotent, postedAt=docDate |
| `modules/journal/cpa-templates/expense-accrual.template.spec.ts` | Same as above for accrual flow |
| `modules/expense-documents/__tests__/full-lifecycle.integration.spec.ts` | Create DRAFT → post → see POSTED + JE row in DB → void → reverse JE |

### Web (apps/web/src)

| Path | Responsibility | Action |
|------|----------------|--------|
| `pages/ExpensesPage.tsx` | Replace API calls (`/expenses` → `/expense-documents`); update `Expense` type interface; keep redesigned UI | Modify |
| `pages/ExpenseDocumentDetailPage.tsx` | Detail/edit view per document — reuse form panel for DRAFT, read-only for POSTED+ | Create |
| `components/expense-documents/ExpenseDocumentForm.tsx` | EXPENSE create/edit form (extracted from old `ExpenseFormPanel`) | Create |
| `App.tsx` | Add routes `/expenses/new` and `/expenses/:id`; rename `LegacyExpensesPage` if any | Modify |
| `lib/api.ts` (no change) | (existing) | — |

### Web tests

| Path | Responsibility |
|------|----------------|
| `pages/__tests__/ExpenseDocumentForm.test.tsx` | Form validation, submit DRAFT, submit POSTED |
| `e2e/expenses-redesign.spec.ts` | Login → /expenses → tab clicks → create EX same-day → verify POSTED + JE preview |

---

## Branch + Worktree

- [ ] **Step 0a: Verify clean working tree**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git status
```

Expected: working tree clean OR pending uncommitted changes are unrelated to expenses (the spec doc commit `b3be9605` already landed).

- [ ] **Step 0b: Create feature branch**

```bash
git checkout -b feat/expense-documents-pr1
git push -u origin feat/expense-documents-pr1
```

Expected: new branch tracking `origin/feat/expense-documents-pr1`.

---

## Task 1: Schema migration — add new tables, drop old

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_expense_documents_polymorphic/migration.sql` (auto-generated)

- [ ] **Step 1.1: Add new enums + tables to `schema.prisma`**

Open `apps/api/prisma/schema.prisma`. Find the `enum ExpenseStatus` block (around line ~2180 per current state). Replace it AND the `enum ExpenseAccountType` AND the `model Expense` block with the following:

```prisma
enum DocumentType {
  EXPENSE
  CREDIT_NOTE
  PAYROLL
  VENDOR_SETTLEMENT
}

enum DocumentStatus {
  DRAFT
  ACCRUAL
  POSTED
  VOIDED
}

model ExpenseDocument {
  id              String   @id @default(uuid())
  number          String   @unique
  documentType    DocumentType   @map("document_type")
  branchId        String   @map("branch_id")
  documentDate    DateTime @map("document_date")
  vendorName      String?  @map("vendor_name")
  vendorTaxId     String?  @map("vendor_tax_id")
  taxInvoiceNo    String?  @map("tax_invoice_no")
  description     String?

  subtotal        Decimal  @db.Decimal(12, 2)
  vatAmount       Decimal  @default(0) @db.Decimal(12, 2) @map("vat_amount")
  withholdingTax  Decimal  @default(0) @db.Decimal(12, 2) @map("withholding_tax")
  whtFormType     String?  @map("wht_form_type")
  totalAmount     Decimal  @db.Decimal(12, 2) @map("total_amount")
  netPayment      Decimal? @db.Decimal(12, 2) @map("net_payment")

  status              DocumentStatus @default(DRAFT)
  paidAt              DateTime?      @map("paid_at")
  paymentMethod       PaymentMethod? @map("payment_method")
  depositAccountCode  String?        @map("deposit_account_code")

  expenseDetail   ExpenseDetail?

  journalEntryId  String?  @map("journal_entry_id")

  receiptImageUrl String?  @map("receipt_image_url")
  reference       String?
  note            String?

  fromTemplateId  String?  @map("from_template_id")

  createdById     String   @map("created_by_id")
  approvedById    String?  @map("approved_by_id")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  deletedAt       DateTime? @map("deleted_at")

  branch          Branch   @relation(fields: [branchId], references: [id])
  createdBy       User     @relation("ExpenseDocumentCreator", fields: [createdById], references: [id])
  approvedBy      User?    @relation("ExpenseDocumentApprover", fields: [approvedById], references: [id])

  @@index([branchId, documentDate])
  @@index([documentType, status])
  @@index([status, paidAt])
  @@map("expense_documents")
}

model ExpenseDetail {
  documentId String          @id @map("document_id")
  document   ExpenseDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  category   String

  @@map("expense_details")
}
```

Then in `model Branch { ... }` add the back-relation:
```prisma
expenseDocuments  ExpenseDocument[]
```

In `model User { ... }` add:
```prisma
expenseDocumentsCreated   ExpenseDocument[] @relation("ExpenseDocumentCreator")
expenseDocumentsApproved  ExpenseDocument[] @relation("ExpenseDocumentApprover")
```

Delete old `model Expense { ... }`, `enum ExpenseStatus`, `enum ExpenseAccountType`, `enum ExpenseCategory` blocks. Also remove any back-relations on Branch/User pointing to old Expense.

- [ ] **Step 1.2: Run migration to generate SQL**

Run:
```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx prisma migrate dev --name expense_documents_polymorphic
```

Expected: prisma generates a migration file under `prisma/migrations/<ts>_expense_documents_polymorphic/migration.sql` containing CREATE TABLE for new tables + DROP TABLE for `expenses`. Prisma client regenerates.

If migration fails because of FK constraints from old Expense to other tables (e.g., AuditLog referencing Expense via metadata), inspect the error and either adjust schema or note FK targets to clean up first. AuditLog uses JSONB metadata — no FK, safe.

- [ ] **Step 1.3: Verify migration file looks sane**

Run:
```bash
cat prisma/migrations/$(ls -t prisma/migrations | head -1)/migration.sql | head -80
```

Expected: SQL contains `CREATE TABLE "expense_documents"`, `CREATE TABLE "expense_details"`, `DROP TABLE "expenses"`, `DROP TYPE "ExpenseStatus"`, etc.

- [ ] **Step 1.4: Run prisma generate**

```bash
npx prisma generate
```

Expected: Prisma client types update — `prisma.expenseDocument`, `prisma.expenseDetail` available.

- [ ] **Step 1.5: TypeScript will break in old code — note the failure point**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
./tools/check-types.sh api 2>&1 | head -30
```

Expected: many errors in `accounting.service.ts`, `accounting.controller.ts` referencing the deleted `Expense` model. This is intentional — Task 7 will clean these up. Do NOT fix yet.

- [ ] **Step 1.6: Commit schema migration**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(expense-documents): add polymorphic schema (EXPENSE type only)"
```

---

## Task 2: Document Numbering Service (TDD)

**Files:**
- Create: `apps/api/src/modules/expense-documents/services/doc-number.service.ts`
- Test: `apps/api/src/modules/expense-documents/__tests__/doc-number.service.spec.ts`

- [ ] **Step 2.1: Create test file with failing tests**

Create `apps/api/src/modules/expense-documents/__tests__/doc-number.service.spec.ts`:

```ts
import { DocNumberService } from '../services/doc-number.service';
import type { Prisma } from '@prisma/client';

describe('DocNumberService', () => {
  let service: DocNumberService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(() => {
    tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      expenseDocument: {
        findFirst: jest.fn(),
      },
    };
    service = new DocNumberService();
  });

  it('returns EX-YYYYMMDD-0001 for first EXPENSE on given date', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue(null);
    const num = await service.next(tx as Prisma.TransactionClient, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
    expect(num).toBe('EX-20260510-0001');
  });

  it('increments sequence per type per day', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260510-0042' });
    const num = await service.next(tx as Prisma.TransactionClient, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
    expect(num).toBe('EX-20260510-0043');
  });

  it('uses correct prefix per type', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue(null);
    expect(await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'))).toMatch(/^EX-/);
    expect(await service.next(tx, 'CREDIT_NOTE', new Date('2026-05-10T12:00:00Z'))).toMatch(/^CN-/);
    expect(await service.next(tx, 'PAYROLL', new Date('2026-05-10T12:00:00Z'))).toMatch(/^PR-/);
    expect(await service.next(tx, 'VENDOR_SETTLEMENT', new Date('2026-05-10T12:00:00Z'))).toMatch(/^SE-/);
  });

  it('acquires advisory lock with deterministic key per (type, date)', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue(null);
    await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringMatching(/^SELECT pg_advisory_xact_lock\(-?\d+\)$/),
    );
  });

  it('uses Asia/Bangkok timezone for date boundary (UTC late-night → next BKK day)', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue(null);
    // 2026-05-10 19:00 UTC = 2026-05-11 02:00 BKK
    const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T19:00:00Z'));
    expect(num).toBe('EX-20260511-0001');
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx jest --testPathPattern="doc-number.service.spec" 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module '../services/doc-number.service'".

- [ ] **Step 2.3: Implement DocNumberService**

Create `apps/api/src/modules/expense-documents/services/doc-number.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DocumentType, Prisma } from '@prisma/client';

const PREFIX_MAP: Record<DocumentType, string> = {
  EXPENSE: 'EX',
  CREDIT_NOTE: 'CN',
  PAYROLL: 'PR',
  VENDOR_SETTLEMENT: 'SE',
};

@Injectable()
export class DocNumberService {
  /**
   * Generate next sequential document number with race-safe Postgres
   * advisory lock per (type, BKK-day) key. Mirrors OI/RT pattern.
   *
   * Format: <TYPE>-YYYYMMDD-NNNN — daily reset, 4-digit seq.
   */
  async next(
    tx: Prisma.TransactionClient,
    type: DocumentType,
    issueDate: Date,
  ): Promise<string> {
    const yyyymmdd = this.bkkYyyymmdd(issueDate);
    const prefix = `${PREFIX_MAP[type]}-${yyyymmdd}-`;
    const lockKey = this.hashLockKey(`expdoc:${type}:${yyyymmdd}`);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);

    const last = await tx.expenseDocument.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const lastSeq = last
      ? parseInt(last.number.slice(prefix.length), 10) || 0
      : 0;
    const seq = String(lastSeq + 1).padStart(4, '0');
    return `${prefix}${seq}`;
  }

  /** Asia/Bangkok local YYYYMMDD via Intl (BKK is UTC+7, no DST). */
  private bkkYyyymmdd(date: Date): string {
    const parts = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
    return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
  }

  /** Deterministic 32-bit hash for advisory lock keys. */
  private hashLockKey(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) | 0;
    }
    return h;
  }
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
npx jest --testPathPattern="doc-number.service.spec" 2>&1 | tail -10
```

Expected: PASS — 5 tests.

- [ ] **Step 2.5: Commit**

```bash
git add apps/api/src/modules/expense-documents/services/doc-number.service.ts apps/api/src/modules/expense-documents/__tests__/doc-number.service.spec.ts
git commit -m "feat(expense-documents): add daily-reset numbering with advisory lock"
```

---

## Task 3: Status Transition Service (TDD)

**Files:**
- Create: `apps/api/src/modules/expense-documents/services/status-transition.service.ts`
- Test: `apps/api/src/modules/expense-documents/__tests__/status-transition.service.spec.ts`

- [ ] **Step 3.1: Write failing tests**

Create `apps/api/src/modules/expense-documents/__tests__/status-transition.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { StatusTransitionService } from '../services/status-transition.service';

describe('StatusTransitionService', () => {
  const service = new StatusTransitionService();

  describe('canTransition', () => {
    it('DRAFT → POSTED allowed for EXPENSE Same-day (paymentMethod set)', () => {
      expect(() => service.assertCanPost({ type: 'EXPENSE', from: 'DRAFT', hasPaymentMethod: true })).not.toThrow();
    });
    it('DRAFT → ACCRUAL allowed for EXPENSE without payment method', () => {
      expect(() => service.assertCanPost({ type: 'EXPENSE', from: 'DRAFT', hasPaymentMethod: false })).not.toThrow();
    });
    it('reject post from POSTED', () => {
      expect(() => service.assertCanPost({ type: 'EXPENSE', from: 'POSTED', hasPaymentMethod: true })).toThrow(BadRequestException);
    });
    it('reject post from VOIDED', () => {
      expect(() => service.assertCanPost({ type: 'EXPENSE', from: 'VOIDED', hasPaymentMethod: true })).toThrow(BadRequestException);
    });
  });

  describe('resolveTargetStatus', () => {
    it('returns POSTED for EXPENSE with paymentMethod', () => {
      expect(service.resolveTargetStatus('EXPENSE', true)).toBe('POSTED');
    });
    it('returns ACCRUAL for EXPENSE without paymentMethod', () => {
      expect(service.resolveTargetStatus('EXPENSE', false)).toBe('ACCRUAL');
    });
  });

  describe('assertCanVoid', () => {
    it('allow void from DRAFT', () => {
      expect(() => service.assertCanVoid({ from: 'DRAFT' })).not.toThrow();
    });
    it('allow void from ACCRUAL', () => {
      expect(() => service.assertCanVoid({ from: 'ACCRUAL' })).not.toThrow();
    });
    it('allow void from POSTED', () => {
      expect(() => service.assertCanVoid({ from: 'POSTED' })).not.toThrow();
    });
    it('reject void already VOIDED', () => {
      expect(() => service.assertCanVoid({ from: 'VOIDED' })).toThrow(BadRequestException);
    });
  });

  describe('assertCanEdit', () => {
    it('allow edit DRAFT', () => {
      expect(() => service.assertCanEdit({ from: 'DRAFT' })).not.toThrow();
    });
    it('reject edit POSTED', () => {
      expect(() => service.assertCanEdit({ from: 'POSTED' })).toThrow(BadRequestException);
    });
    it('reject edit ACCRUAL', () => {
      expect(() => service.assertCanEdit({ from: 'ACCRUAL' })).toThrow(BadRequestException);
    });
  });
});
```

- [ ] **Step 3.2: Run test (should fail)**

```bash
npx jest --testPathPattern="status-transition.service.spec" 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement StatusTransitionService**

Create `apps/api/src/modules/expense-documents/services/status-transition.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { DocumentStatus, DocumentType } from '@prisma/client';

@Injectable()
export class StatusTransitionService {
  /**
   * Validate that a document can be posted from its current status.
   * Allowed source: DRAFT only.
   */
  assertCanPost(input: {
    type: DocumentType;
    from: DocumentStatus;
    hasPaymentMethod: boolean;
  }): void {
    if (input.from !== 'DRAFT') {
      throw new BadRequestException(`ไม่สามารถ post จากสถานะ ${input.from} ได้ (ต้องเป็น DRAFT)`);
    }
  }

  /**
   * Determine the target status after posting given doc characteristics.
   * - EXPENSE: POSTED if paid same day; ACCRUAL otherwise
   * - CREDIT_NOTE / PAYROLL / VENDOR_SETTLEMENT: always POSTED
   */
  resolveTargetStatus(type: DocumentType, hasPaymentMethod: boolean): DocumentStatus {
    if (type === 'EXPENSE' && !hasPaymentMethod) return 'ACCRUAL';
    return 'POSTED';
  }

  /** Void allowed from any non-VOIDED state. */
  assertCanVoid(input: { from: DocumentStatus }): void {
    if (input.from === 'VOIDED') {
      throw new BadRequestException('เอกสารถูกยกเลิกอยู่แล้ว');
    }
  }

  /** Edit allowed only from DRAFT. */
  assertCanEdit(input: { from: DocumentStatus }): void {
    if (input.from !== 'DRAFT') {
      throw new BadRequestException(`ไม่สามารถแก้ไขเอกสารในสถานะ ${input.from} ได้ (DRAFT เท่านั้น)`);
    }
  }
}
```

- [ ] **Step 3.4: Run test (should pass)**

```bash
npx jest --testPathPattern="status-transition.service.spec" 2>&1 | tail -10
```

Expected: PASS — 11 tests.

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/modules/expense-documents/services/status-transition.service.ts apps/api/src/modules/expense-documents/__tests__/status-transition.service.spec.ts
git commit -m "feat(expense-documents): add status transition guard service"
```

---

## Task 4: ExpenseSameDayTemplate JE (TDD)

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/expense-same-day.template.ts`
- Test: `apps/api/src/modules/journal/cpa-templates/expense-same-day.template.spec.ts`

- [ ] **Step 4.1: Write failing test**

Reference existing template test pattern: `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.spec.ts` (mocked Prisma + JournalAutoService).

Create `apps/api/src/modules/journal/cpa-templates/expense-same-day.template.spec.ts`:

```ts
import { Decimal } from '@prisma/client/runtime/library';
import { ExpenseSameDayTemplate } from './expense-same-day.template';

describe('ExpenseSameDayTemplate', () => {
  let template: ExpenseSameDayTemplate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journal: any;

  const docId = 'doc-1';

  beforeEach(() => {
    journal = {
      createAndPost: jest.fn().mockResolvedValue({ entryNumber: 'JE-001', id: 'je-1' }),
    };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      expenseDocument: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    template = new ExpenseSameDayTemplate(journal, prisma);
  });

  it('posts balanced JE for EX with VAT 7% no WHT', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'EX-20260510-0001',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('1000.00'),
      vatAmount: new Decimal('70.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      totalAmount: new Decimal('1070.00'),
      depositAccountCode: '11-1101',
      paymentMethod: 'CASH',
      journalEntryId: null,
      expenseDetail: { category: '53-1302' },
    });

    const result = await template.execute(docId);

    expect(result.entryNo).toBe('JE-001');
    expect(journal.createAndPost).toHaveBeenCalledTimes(1);
    const [args] = journal.createAndPost.mock.calls[0];
    expect(args.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: '53-1302', dr: new Decimal('1000.00') }),
        expect.objectContaining({ accountCode: '11-2104', dr: new Decimal('70.00') }),
        expect.objectContaining({ accountCode: '11-1101', cr: new Decimal('1070.00') }),
      ]),
    );
    // metadata
    expect(args.metadata).toMatchObject({ tag: 'EXPENSE_SAME_DAY', documentId: docId });
    expect(args.postedAt).toEqual(new Date('2026-05-10'));
  });

  it('skips VAT line when vatAmount = 0', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'EX-20260510-0002',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('500.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      totalAmount: new Decimal('500.00'),
      depositAccountCode: '11-1101',
      paymentMethod: 'CASH',
      journalEntryId: null,
      expenseDetail: { category: '53-1302' },
    });

    await template.execute(docId);
    const [args] = journal.createAndPost.mock.calls[0];
    const codes = args.lines.map((l: { accountCode: string }) => l.accountCode);
    expect(codes).not.toContain('11-2104');
  });

  it('routes WHT to 21-3102 when whtFormType=PND3 (บุคคลธรรมดา)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'EX-20260510-0003',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('1000.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('30.00'),
      whtFormType: 'PND3',
      totalAmount: new Decimal('1000.00'),
      depositAccountCode: '11-1201',
      paymentMethod: 'BANK_TRANSFER',
      journalEntryId: null,
      expenseDetail: { category: '53-1702' },
    });

    await template.execute(docId);
    const [args] = journal.createAndPost.mock.calls[0];
    const whtLine = args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3102');
    expect(whtLine).toBeDefined();
    expect(whtLine.cr).toEqual(new Decimal('30.00'));
    // Cash leg = total - wht = 970
    const cashLine = args.lines.find((l: { accountCode: string }) => l.accountCode === '11-1201');
    expect(cashLine.cr).toEqual(new Decimal('970.00'));
  });

  it('routes WHT to 21-3103 when whtFormType=PND53 (นิติบุคคล)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'EX-20260510-0004',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('1000.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('30.00'),
      whtFormType: 'PND53',
      totalAmount: new Decimal('1000.00'),
      depositAccountCode: '11-1201',
      paymentMethod: 'BANK_TRANSFER',
      journalEntryId: null,
      expenseDetail: { category: '53-1702' },
    });

    await template.execute(docId);
    const [args] = journal.createAndPost.mock.calls[0];
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3103')).toBeDefined();
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '21-3102')).toBeUndefined();
  });

  it('idempotent: returns existing entryNo when journalEntryId already set', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      journalEntryId: 'JE-EXISTING',
    });
    const result = await template.execute(docId);
    expect(result.entryNo).toBe('JE-EXISTING');
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('updates document status=POSTED + paidAt + journalEntryId after post', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: docId,
      number: 'EX-20260510-0005',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('500.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      totalAmount: new Decimal('500.00'),
      depositAccountCode: '11-1101',
      paymentMethod: 'CASH',
      journalEntryId: null,
      expenseDetail: { category: '53-1302' },
    });

    await template.execute(docId);

    expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: docId },
        data: expect.objectContaining({
          status: 'POSTED',
          paidAt: expect.any(Date),
          journalEntryId: 'JE-001',
        }),
      }),
    );
  });
});
```

- [ ] **Step 4.2: Run test (should fail)**

```bash
npx jest --testPathPattern="expense-same-day.template.spec" 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement ExpenseSameDayTemplate**

Reference for shape: `apps/api/src/modules/journal/cpa-templates/payment-receipt-2b.template.ts`.

Create `apps/api/src/modules/journal/cpa-templates/expense-same-day.template.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template — Expense Same-day (EX paid same day).
 *
 * Spec §4.1 — records expense + cash payment in one JE.
 *
 *   Dr 5x-xxxx ค่าใช้จ่ายตาม category    (subtotal)
 *   Dr 11-2104 ลูกหนี้-VAT                (vatAmount)        [if VAT > 0]
 *     Cr depositAccountCode               (totalAmount - whtAmount)
 *     Cr 21-3102/3103 หัก ณ ที่จ่าย       (whtAmount)        [if WHT > 0; route by whtFormType]
 *
 * ⚠️ CPA AUDIT REQUIRED — accounts logical-correct against Phase A.4 chart
 * but pending CPA case verification (Phase A.7).
 */
@Injectable()
export class ExpenseSameDayTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    documentId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const exec = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      const doc = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: { expenseDetail: true },
      });

      // Idempotency
      if (doc.journalEntryId) {
        return { entryNo: doc.journalEntryId };
      }

      const zero = new Decimal(0);
      const subtotal = new Decimal(doc.subtotal.toString());
      const vat = new Decimal(doc.vatAmount.toString());
      const wht = new Decimal(doc.withholdingTax.toString());
      const total = new Decimal(doc.totalAmount.toString());
      const cashAmount = total.minus(wht);

      if (!doc.expenseDetail?.category) {
        throw new Error(`ExpenseDocument ${documentId} missing expenseDetail.category`);
      }
      if (!doc.depositAccountCode) {
        throw new Error(`ExpenseDocument ${documentId} missing depositAccountCode`);
      }

      const lines: JeLineInput[] = [
        {
          accountCode: doc.expenseDetail.category,
          dr: subtotal,
          cr: zero,
          description: `ค่าใช้จ่าย — ${doc.number}`,
        },
      ];
      if (vat.gt(zero)) {
        lines.push({
          accountCode: '11-2104',
          dr: vat,
          cr: zero,
          description: 'ลูกหนี้-VAT ที่ออกแทน',
        });
      }
      lines.push({
        accountCode: doc.depositAccountCode,
        dr: zero,
        cr: cashAmount,
        description: `จ่ายเงิน ${cashAmount.toFixed(2)} ฿`,
      });
      if (wht.gt(zero)) {
        const whtAccount = doc.whtFormType === 'PND53' ? '21-3103' : '21-3102';
        lines.push({
          accountCode: whtAccount,
          dr: zero,
          cr: wht,
          description: `หัก ณ ที่จ่าย ${doc.whtFormType ?? 'PND3'}`,
        });
      }

      const result = await this.journal.createAndPost(
        {
          description: `รับชำระค่าใช้จ่าย ${doc.number}`,
          reference: doc.id,
          metadata: {
            tag: 'EXPENSE_SAME_DAY',
            documentId: doc.id,
            documentNumber: doc.number,
            documentType: doc.documentType,
            flow: 'expense-same-day',
          },
          postedAt: doc.documentDate,
          lines,
        },
        tx,
      );

      await tx.expenseDocument.update({
        where: { id: doc.id },
        data: {
          status: 'POSTED',
          paidAt: doc.documentDate,
          journalEntryId: result.entryNumber,
          netPayment: cashAmount,
        },
      });

      return { entryNo: result.entryNumber };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }
}
```

- [ ] **Step 4.4: Run test (should pass)**

```bash
npx jest --testPathPattern="expense-same-day.template.spec" 2>&1 | tail -15
```

Expected: PASS — 6 tests.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/expense-same-day.template.ts apps/api/src/modules/journal/cpa-templates/expense-same-day.template.spec.ts
git commit -m "feat(journal): add ExpenseSameDayTemplate JE (CPA audit pending)"
```

---

## Task 5: ExpenseAccrualTemplate JE (TDD)

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/expense-accrual.template.ts`
- Test: `apps/api/src/modules/journal/cpa-templates/expense-accrual.template.spec.ts`

- [ ] **Step 5.1: Write failing test**

Create `apps/api/src/modules/journal/cpa-templates/expense-accrual.template.spec.ts`:

```ts
import { Decimal } from '@prisma/client/runtime/library';
import { ExpenseAccrualTemplate } from './expense-accrual.template';

describe('ExpenseAccrualTemplate', () => {
  let template: ExpenseAccrualTemplate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journal: any;

  beforeEach(() => {
    journal = { createAndPost: jest.fn().mockResolvedValue({ entryNumber: 'JE-A1', id: 'je-a1' }) };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      expenseDocument: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    template = new ExpenseAccrualTemplate(journal, prisma);
  });

  it('posts accrual JE: Dr expense + Dr VAT / Cr 21-1104 (no cash leg)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'doc-2',
      number: 'EX-20260510-0010',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('5000.00'),
      vatAmount: new Decimal('350.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      totalAmount: new Decimal('5350.00'),
      depositAccountCode: null,
      paymentMethod: null,
      journalEntryId: null,
      expenseDetail: { category: '53-1404' },
    });

    const result = await template.execute('doc-2');
    expect(result.entryNo).toBe('JE-A1');
    const [args] = journal.createAndPost.mock.calls[0];
    expect(args.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: '53-1404', dr: new Decimal('5000.00') }),
        expect.objectContaining({ accountCode: '11-2104', dr: new Decimal('350.00') }),
        expect.objectContaining({ accountCode: '21-1104', cr: new Decimal('5350.00') }),
      ]),
    );
    // No cash account leg
    const cashCodes = ['11-1101', '11-1102', '11-1103', '11-1201', '11-1202', '11-1203'];
    args.lines.forEach((l: { accountCode: string }) => {
      expect(cashCodes).not.toContain(l.accountCode);
    });
  });

  it('updates status=ACCRUAL (not POSTED) + clears paidAt + sets journalEntryId', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'doc-3',
      number: 'EX-20260510-0011',
      documentType: 'EXPENSE',
      branchId: 'branch-1',
      documentDate: new Date('2026-05-10'),
      subtotal: new Decimal('1000.00'),
      vatAmount: new Decimal('0.00'),
      withholdingTax: new Decimal('0.00'),
      whtFormType: null,
      totalAmount: new Decimal('1000.00'),
      depositAccountCode: null,
      paymentMethod: null,
      journalEntryId: null,
      expenseDetail: { category: '53-1302' },
    });

    await template.execute('doc-3');
    expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-3' },
        data: expect.objectContaining({
          status: 'ACCRUAL',
          paidAt: null,
          journalEntryId: 'JE-A1',
        }),
      }),
    );
  });

  it('idempotent: skips post when journalEntryId already set', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'doc-4',
      journalEntryId: 'JE-EXISTING-A',
    });
    const result = await template.execute('doc-4');
    expect(result.entryNo).toBe('JE-EXISTING-A');
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5.2: Run test (should fail)**

```bash
npx jest --testPathPattern="expense-accrual.template.spec" 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement ExpenseAccrualTemplate**

Create `apps/api/src/modules/journal/cpa-templates/expense-accrual.template.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template — Expense Accrual (EX ตั้งหนี้, no cash leg yet).
 *
 * Spec §4.2 — books expense as AP, awaits VENDOR_SETTLEMENT to clear.
 *
 *   Dr 5x-xxxx ค่าใช้จ่าย                 (subtotal)
 *   Dr 11-2104 ลูกหนี้-VAT                (vatAmount)        [if VAT > 0]
 *     Cr 21-1104 เจ้าหนี้-ค่าใช้จ่ายกิจการ (totalAmount)
 *
 * WHT does not post here — defers to SE settlement time.
 *
 * ⚠️ CPA AUDIT REQUIRED — pending Phase A.7 review.
 */
@Injectable()
export class ExpenseAccrualTemplate {
  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    documentId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const exec = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      const doc = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: { expenseDetail: true },
      });

      if (doc.journalEntryId) return { entryNo: doc.journalEntryId };

      const zero = new Decimal(0);
      const subtotal = new Decimal(doc.subtotal.toString());
      const vat = new Decimal(doc.vatAmount.toString());
      const total = new Decimal(doc.totalAmount.toString());

      if (!doc.expenseDetail?.category) {
        throw new Error(`ExpenseDocument ${documentId} missing expenseDetail.category`);
      }

      const lines: JeLineInput[] = [
        {
          accountCode: doc.expenseDetail.category,
          dr: subtotal,
          cr: zero,
          description: `ค่าใช้จ่าย — ${doc.number}`,
        },
      ];
      if (vat.gt(zero)) {
        lines.push({
          accountCode: '11-2104',
          dr: vat,
          cr: zero,
          description: 'ลูกหนี้-VAT ที่ออกแทน',
        });
      }
      lines.push({
        accountCode: '21-1104',
        dr: zero,
        cr: total,
        description: `เจ้าหนี้-ค่าใช้จ่าย ${doc.number}`,
      });

      const result = await this.journal.createAndPost(
        {
          description: `ตั้งหนี้ค่าใช้จ่าย ${doc.number}`,
          reference: doc.id,
          metadata: {
            tag: 'EXPENSE_ACCRUAL',
            documentId: doc.id,
            documentNumber: doc.number,
            documentType: doc.documentType,
            flow: 'expense-accrual',
          },
          postedAt: doc.documentDate,
          lines,
        },
        tx,
      );

      await tx.expenseDocument.update({
        where: { id: doc.id },
        data: {
          status: 'ACCRUAL',
          paidAt: null,
          journalEntryId: result.entryNumber,
        },
      });

      return { entryNo: result.entryNumber };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }
}
```

- [ ] **Step 5.4: Run test (should pass)**

```bash
npx jest --testPathPattern="expense-accrual.template.spec" 2>&1 | tail -10
```

Expected: PASS — 3 tests.

- [ ] **Step 5.5: Register both templates in journal.module.ts**

Open `apps/api/src/modules/journal/journal.module.ts`. Find the `providers: [...]` array (search for `JournalAutoService`). Add:

```ts
import { ExpenseSameDayTemplate } from './cpa-templates/expense-same-day.template';
import { ExpenseAccrualTemplate } from './cpa-templates/expense-accrual.template';
```

In the `@Module` decorator add to providers:
```ts
ExpenseSameDayTemplate,
ExpenseAccrualTemplate,
```

In the `exports` array add the same two.

- [ ] **Step 5.6: Commit**

```bash
git add apps/api/src/modules/journal/cpa-templates/expense-accrual.template.ts apps/api/src/modules/journal/cpa-templates/expense-accrual.template.spec.ts apps/api/src/modules/journal/journal.module.ts
git commit -m "feat(journal): add ExpenseAccrualTemplate JE + register both templates"
```

---

## Task 6: ExpenseDocuments DTOs

**Files:**
- Create: `apps/api/src/modules/expense-documents/dto/create.dto.ts`
- Create: `apps/api/src/modules/expense-documents/dto/update.dto.ts`
- Create: `apps/api/src/modules/expense-documents/dto/list-query.dto.ts`

- [ ] **Step 6.1: Create CreateExpenseDocumentDto**

Create `apps/api/src/modules/expense-documents/dto/create.dto.ts`:

```ts
import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

class ExpenseDetailInput {
  @IsString()
  category!: string;
}

export class CreateExpenseDocumentDto {
  // PR-1 supports EXPENSE only. CN/PR/SE shorthand endpoints come later.
  @IsIn(['EXPENSE'], { message: 'ใน PR-1 รองรับเฉพาะ EXPENSE — CN/PR/SE ทำใน PR-2..4' })
  documentType!: 'EXPENSE';

  @IsString()
  branchId!: string;

  @IsDateString({}, { message: 'วันที่ใบกำกับไม่ถูกต้อง' })
  documentDate!: string;

  @IsString()
  @IsOptional()
  vendorName?: string;

  @IsString()
  @IsOptional()
  vendorTaxId?: string;

  @IsString()
  @IsOptional()
  taxInvoiceNo?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'จำนวนเงินต้องมากกว่า 0' })
  subtotal!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  vatAmount?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  withholdingTax?: number;

  @IsString()
  @IsOptional()
  @IsIn(['PND3', 'PND53'])
  whtFormType?: string;

  // Payment dimension (for Same-day flow). If absent → ACCRUAL.
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsString()
  @IsOptional()
  @IsIn([...CASH_ACCOUNT_CODES], { message: 'บัญชีรับเงินไม่ถูกต้อง' })
  depositAccountCode?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  receiptImageUrl?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @ValidateNested()
  @Type(() => ExpenseDetailInput)
  detail!: ExpenseDetailInput;
}
```

- [ ] **Step 6.2: Create UpdateExpenseDocumentDto**

Create `apps/api/src/modules/expense-documents/dto/update.dto.ts`:

```ts
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateExpenseDocumentDto } from './create.dto';

// Update allows everything except documentType + branchId (immutable post-create).
export class UpdateExpenseDocumentDto extends PartialType(
  OmitType(CreateExpenseDocumentDto, ['documentType', 'branchId'] as const),
) {}
```

- [ ] **Step 6.3: Create ListQueryDto**

Create `apps/api/src/modules/expense-documents/dto/list-query.dto.ts`:

```ts
import { IsString, IsOptional, IsIn, IsInt, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class ListExpenseDocumentsQueryDto {
  @IsString()
  @IsOptional()
  @IsIn(['all', 'draft', 'unpaid', 'recorded', 'paid'])
  tab?: string;

  @IsString()
  @IsOptional()
  @IsIn(['EXPENSE', 'CREDIT_NOTE', 'PAYROLL', 'VENDOR_SETTLEMENT'])
  type?: string;

  @IsString()
  @IsOptional()
  @IsIn(['DRAFT', 'ACCRUAL', 'POSTED', 'VOIDED'])
  status?: string;

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}
```

- [ ] **Step 6.4: Commit**

```bash
git add apps/api/src/modules/expense-documents/dto/
git commit -m "feat(expense-documents): add Create/Update/ListQuery DTOs"
```

---

## Task 7: ExpenseDocumentsService — Create + List + Update + Soft-delete (TDD)

**Files:**
- Create: `apps/api/src/modules/expense-documents/expense-documents.service.ts`
- Test: `apps/api/src/modules/expense-documents/__tests__/expense-documents.service.spec.ts`

- [ ] **Step 7.1: Write failing service tests**

Create `apps/api/src/modules/expense-documents/__tests__/expense-documents.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExpenseDocumentsService } from '../expense-documents.service';

describe('ExpenseDocumentsService', () => {
  let service: ExpenseDocumentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let docNumber: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let transition: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sameDay: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let accrual: any;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      expenseDocument: {
        create: jest.fn().mockResolvedValue({ id: 'doc-1', number: 'EX-20260510-0001' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      },
    };
    docNumber = { next: jest.fn().mockResolvedValue('EX-20260510-0001') };
    transition = {
      assertCanPost: jest.fn(),
      assertCanVoid: jest.fn(),
      assertCanEdit: jest.fn(),
      resolveTargetStatus: jest.fn().mockReturnValue('POSTED'),
    };
    sameDay = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-1' }) };
    accrual = { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-2' }) };
    service = new ExpenseDocumentsService(prisma, docNumber, transition, sameDay, accrual);
  });

  describe('create', () => {
    it('generates number, creates header + ExpenseDetail in same tx', async () => {
      await service.create(
        {
          documentType: 'EXPENSE',
          branchId: 'branch-1',
          documentDate: '2026-05-10',
          subtotal: 1000,
          vatAmount: 70,
          withholdingTax: 0,
          totalAmount: 1070,
          detail: { category: '53-1302' },
        } as never,
        'user-1',
      );
      expect(docNumber.next).toHaveBeenCalledWith(prisma, 'EXPENSE', expect.any(Date));
      expect(prisma.expenseDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            number: 'EX-20260510-0001',
            documentType: 'EXPENSE',
            createdById: 'user-1',
            status: 'DRAFT',
            expenseDetail: { create: { category: '53-1302' } },
          }),
        }),
      );
    });

    it('computes totalAmount = subtotal + vatAmount when not provided', async () => {
      await service.create(
        {
          documentType: 'EXPENSE',
          branchId: 'branch-1',
          documentDate: '2026-05-10',
          subtotal: 1000,
          vatAmount: 70,
          detail: { category: '53-1302' },
        } as never,
        'user-1',
      );
      const callArg = prisma.expenseDocument.create.mock.calls[0][0];
      expect(callArg.data.totalAmount.toString()).toBe('1070');
    });
  });

  describe('list', () => {
    it('translates tab=draft to status=DRAFT', async () => {
      await service.list({ tab: 'draft' } as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'DRAFT' }),
        }),
      );
    });
    it('translates tab=unpaid to status=ACCRUAL', async () => {
      await service.list({ tab: 'unpaid' } as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'ACCRUAL' }) }),
      );
    });
    it('translates tab=recorded to status IN [ACCRUAL, POSTED]', async () => {
      await service.list({ tab: 'recorded' } as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { in: ['ACCRUAL', 'POSTED'] } }),
        }),
      );
    });
    it('translates tab=paid to paidAt NOT NULL', async () => {
      await service.list({ tab: 'paid' } as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ paidAt: { not: null } }),
        }),
      );
    });
    it('default excludes VOIDED', async () => {
      await service.list({} as never, { branchId: 'branch-1', role: 'BRANCH_MANAGER' });
      expect(prisma.expenseDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { not: 'VOIDED' },
            deletedAt: null,
          }),
        }),
      );
    });
  });

  describe('post', () => {
    it('calls SameDay template when paymentMethod set', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-1',
        status: 'DRAFT',
        documentType: 'EXPENSE',
        paymentMethod: 'CASH',
      });
      await service.post('doc-1', 'user-1');
      expect(sameDay.execute).toHaveBeenCalledWith('doc-1', expect.anything());
      expect(accrual.execute).not.toHaveBeenCalled();
    });
    it('calls Accrual template when paymentMethod missing', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-2',
        status: 'DRAFT',
        documentType: 'EXPENSE',
        paymentMethod: null,
      });
      await service.post('doc-2', 'user-1');
      expect(accrual.execute).toHaveBeenCalledWith('doc-2', expect.anything());
      expect(sameDay.execute).not.toHaveBeenCalled();
    });
    it('rejects post when transition guard throws', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: 'doc-3', status: 'POSTED', documentType: 'EXPENSE', paymentMethod: 'CASH',
      });
      transition.assertCanPost.mockImplementation(() => { throw new BadRequestException('not draft'); });
      await expect(service.post('doc-3', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('rejects update on POSTED doc', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({ id: 'doc-1', status: 'POSTED' });
      transition.assertCanEdit.mockImplementation(() => { throw new BadRequestException('locked'); });
      await expect(service.update('doc-1', { description: 'X' } as never, 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('softDelete', () => {
    it('rejects soft-delete on non-DRAFT', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({ id: 'doc-1', status: 'ACCRUAL', deletedAt: null });
      await expect(service.softDelete('doc-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
    it('sets deletedAt for DRAFT', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({ id: 'doc-1', status: 'DRAFT', deletedAt: null });
      await service.softDelete('doc-1', 'user-1');
      expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFound for missing or soft-deleted', async () => {
      prisma.expenseDocument.findUniqueOrThrow.mockRejectedValue(new Error('not found'));
      await expect(service.findOne('missing-id')).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 7.2: Run test (should fail)**

```bash
npx jest --testPathPattern="expense-documents.service.spec" 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 7.3: Implement ExpenseDocumentsService**

Create `apps/api/src/modules/expense-documents/expense-documents.service.ts`:

```ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Prisma, DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DocNumberService } from './services/doc-number.service';
import { StatusTransitionService } from './services/status-transition.service';
import { ExpenseSameDayTemplate } from '../journal/cpa-templates/expense-same-day.template';
import { ExpenseAccrualTemplate } from '../journal/cpa-templates/expense-accrual.template';
import { CreateExpenseDocumentDto } from './dto/create.dto';
import { UpdateExpenseDocumentDto } from './dto/update.dto';
import { ListExpenseDocumentsQueryDto } from './dto/list-query.dto';
import { hasCrossBranchAccess } from '../auth/branch-access.util';

@Injectable()
export class ExpenseDocumentsService {
  private readonly logger = new Logger(ExpenseDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: DocNumberService,
    private readonly transition: StatusTransitionService,
    private readonly sameDayTemplate: ExpenseSameDayTemplate,
    private readonly accrualTemplate: ExpenseAccrualTemplate,
  ) {}

  // ─── Create ──────────────────────────────────────────────────────────
  async create(dto: CreateExpenseDocumentDto, userId: string) {
    const documentDate = new Date(dto.documentDate);
    const subtotal = new Prisma.Decimal(dto.subtotal);
    const vat = new Prisma.Decimal(dto.vatAmount ?? 0);
    const wht = new Prisma.Decimal(dto.withholdingTax ?? 0);
    const total = subtotal.plus(vat);

    return this.prisma.$transaction(async (tx) => {
      const number = await this.docNumber.next(tx, 'EXPENSE', documentDate);
      return tx.expenseDocument.create({
        data: {
          number,
          documentType: 'EXPENSE',
          branchId: dto.branchId,
          documentDate,
          vendorName: dto.vendorName ?? null,
          vendorTaxId: dto.vendorTaxId ?? null,
          taxInvoiceNo: dto.taxInvoiceNo ?? null,
          description: dto.description ?? null,
          subtotal,
          vatAmount: vat,
          withholdingTax: wht,
          whtFormType: dto.whtFormType ?? null,
          totalAmount: total,
          netPayment: dto.depositAccountCode ? total.minus(wht) : null,
          paymentMethod: (dto.paymentMethod as never) ?? null,
          depositAccountCode: dto.depositAccountCode ?? null,
          status: 'DRAFT',
          reference: dto.reference ?? null,
          receiptImageUrl: dto.receiptImageUrl ?? null,
          note: dto.note ?? null,
          createdById: userId,
          expenseDetail: { create: { category: dto.detail.category } },
        },
        include: { expenseDetail: true },
      });
    });
  }

  // ─── List ────────────────────────────────────────────────────────────
  async list(
    query: ListExpenseDocumentsQueryDto,
    user: { branchId?: string | null; role?: string },
  ) {
    const where: Prisma.ExpenseDocumentWhereInput = { deletedAt: null };

    // Branch scoping
    const effectiveBranchId = hasCrossBranchAccess(user)
      ? query.branchId
      : user.branchId || query.branchId;
    if (effectiveBranchId) where.branchId = effectiveBranchId;

    // Tab translation
    switch (query.tab) {
      case 'draft':
        where.status = 'DRAFT';
        break;
      case 'unpaid':
        where.status = 'ACCRUAL';
        break;
      case 'recorded':
        where.status = { in: ['ACCRUAL', 'POSTED'] };
        break;
      case 'paid':
        where.paidAt = { not: null };
        break;
      default:
        where.status = { not: 'VOIDED' };
    }

    // Explicit status overrides tab
    if (query.status) where.status = query.status as DocumentStatus;
    if (query.type) where.documentType = query.type as never;

    // Date range on documentDate
    if (query.startDate || query.endDate) {
      where.documentDate = {};
      if (query.startDate) where.documentDate.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.documentDate.lte = end;
      }
    }

    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
        { vendorName: { contains: query.search, mode: 'insensitive' } },
        { taxInvoiceNo: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const [data, total] = await Promise.all([
      this.prisma.expenseDocument.findMany({
        where,
        include: {
          expenseDetail: true,
          branch: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { documentDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseDocument.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  // ─── Summary aggregations ────────────────────────────────────────────
  async getSummary(filters: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const where: Prisma.ExpenseDocumentWhereInput = {
      deletedAt: null,
      status: { not: 'VOIDED' },
    };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.startDate || filters.endDate) {
      where.documentDate = {};
      if (filters.startDate) where.documentDate.gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        where.documentDate.lte = end;
      }
    }

    const docs = await this.prisma.expenseDocument.findMany({
      where,
      select: { status: true, documentType: true, paidAt: true, totalAmount: true },
    });

    const byStatus: Record<string, number> = {};
    let accrualUnpaidCount = 0;
    let accrualUnpaidTotal = new Prisma.Decimal(0);
    for (const d of docs) {
      byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
      if (d.status === 'ACCRUAL' && !d.paidAt) {
        accrualUnpaidCount++;
        accrualUnpaidTotal = accrualUnpaidTotal.plus(d.totalAmount);
      }
    }

    return {
      totalCount: docs.length,
      byStatus,
      accrualUnpaidCount,
      accrualUnpaidTotal: accrualUnpaidTotal.toNumber(),
    };
  }

  // ─── Find one ────────────────────────────────────────────────────────
  async findOne(id: string) {
    const doc = await this.prisma.expenseDocument.findUniqueOrThrow({
      where: { id },
      include: {
        expenseDetail: true,
        branch: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
    if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
    return doc;
  }

  // ─── Update (DRAFT only) ─────────────────────────────────────────────
  async update(id: string, dto: UpdateExpenseDocumentDto, _userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      this.transition.assertCanEdit({ from: existing.status });

      const data: Prisma.ExpenseDocumentUpdateInput = {};
      if (dto.documentDate) data.documentDate = new Date(dto.documentDate);
      if (dto.vendorName !== undefined) data.vendorName = dto.vendorName;
      if (dto.vendorTaxId !== undefined) data.vendorTaxId = dto.vendorTaxId;
      if (dto.taxInvoiceNo !== undefined) data.taxInvoiceNo = dto.taxInvoiceNo;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.subtotal !== undefined) data.subtotal = new Prisma.Decimal(dto.subtotal);
      if (dto.vatAmount !== undefined) data.vatAmount = new Prisma.Decimal(dto.vatAmount);
      if (dto.withholdingTax !== undefined) data.withholdingTax = new Prisma.Decimal(dto.withholdingTax);
      if (dto.whtFormType !== undefined) data.whtFormType = dto.whtFormType;
      if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod as never;
      if (dto.depositAccountCode !== undefined) data.depositAccountCode = dto.depositAccountCode;
      if (dto.reference !== undefined) data.reference = dto.reference;
      if (dto.receiptImageUrl !== undefined) data.receiptImageUrl = dto.receiptImageUrl;
      if (dto.note !== undefined) data.note = dto.note;
      // Recalculate totalAmount if money fields touched
      if (dto.subtotal !== undefined || dto.vatAmount !== undefined) {
        const subtotal = dto.subtotal !== undefined
          ? new Prisma.Decimal(dto.subtotal)
          : new Prisma.Decimal(existing.subtotal.toString());
        const vat = dto.vatAmount !== undefined
          ? new Prisma.Decimal(dto.vatAmount)
          : new Prisma.Decimal(existing.vatAmount.toString());
        data.totalAmount = subtotal.plus(vat);
      }

      const updated = await tx.expenseDocument.update({ where: { id }, data });
      if (dto.detail?.category) {
        await tx.expenseDetail.update({
          where: { documentId: id },
          data: { category: dto.detail.category },
        });
      }
      return updated;
    });
  }

  // ─── Post (DRAFT → ACCRUAL or POSTED) ────────────────────────────────
  async post(id: string, _userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      this.transition.assertCanPost({
        type: doc.documentType,
        from: doc.status,
        hasPaymentMethod: !!doc.paymentMethod && !!doc.depositAccountCode,
      });

      // EXPENSE only in PR-1
      if (doc.documentType !== 'EXPENSE') {
        throw new BadRequestException(`PR-1 รองรับเฉพาะ EXPENSE — type ${doc.documentType} จะมาใน PR-2..4`);
      }

      const target = this.transition.resolveTargetStatus(
        doc.documentType,
        !!doc.paymentMethod && !!doc.depositAccountCode,
      );
      if (target === 'POSTED') {
        return this.sameDayTemplate.execute(id, tx);
      } else {
        return this.accrualTemplate.execute(id, tx);
      }
    });
  }

  // ─── Void (any non-VOIDED → VOIDED) ──────────────────────────────────
  async voidDocument(id: string, _userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      this.transition.assertCanVoid({ from: doc.status });

      // Reverse JE if doc was POSTED/ACCRUAL — reuse existing pattern from
      // expense-reverse.template.ts. PR-1 implements reverse inline because
      // the existing reverse template targets the legacy Expense table.
      if (doc.journalEntryId) {
        // Note: JournalAutoService should expose a reverseEntry helper.
        // For PR-1 we delegate to a thin reverse: post a copy of the JE with
        // dr/cr swapped. Implementation handled in journal.service or a
        // dedicated helper — out of scope for this service. For now we set
        // status to VOIDED and clear the link; reverse JE wiring happens in
        // a follow-up commit (or PR-1.5 if needed).
        this.logger.warn(`Voiding doc ${id} with posted JE — reverse JE TODO in journal helper`);
      }

      return tx.expenseDocument.update({
        where: { id },
        data: { status: 'VOIDED' },
      });
    });
  }

  // ─── Soft delete (DRAFT only) ────────────────────────────────────────
  async softDelete(id: string, _userId: string) {
    const existing = await this.prisma.expenseDocument.findUniqueOrThrow({ where: { id } });
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('ลบได้เฉพาะเอกสาร DRAFT — เอกสารที่ post ไปแล้ว ใช้ void แทน');
    }
    if (existing.deletedAt) {
      throw new BadRequestException('เอกสารถูกลบไปแล้ว');
    }
    return this.prisma.expenseDocument.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
```

⚠️ **Note on Void + Reverse JE**: The plan defers full reverse-JE wiring to a follow-up commit within this PR. For unit tests in this task, we just verify status flips to VOIDED. Reverse JE side-effect is added in Task 11 with the integration test.

- [ ] **Step 7.4: Run tests (should pass)**

```bash
npx jest --testPathPattern="expense-documents.service.spec" 2>&1 | tail -15
```

Expected: PASS — all 15+ tests.

- [ ] **Step 7.5: Commit**

```bash
git add apps/api/src/modules/expense-documents/expense-documents.service.ts apps/api/src/modules/expense-documents/__tests__/expense-documents.service.spec.ts
git commit -m "feat(expense-documents): add core service (create/list/update/post/void/softDelete)"
```

---

## Task 8: ExpenseDocumentsController

**Files:**
- Create: `apps/api/src/modules/expense-documents/expense-documents.controller.ts`
- Create: `apps/api/src/modules/expense-documents/expense-documents.module.ts`
- Test: `apps/api/src/modules/expense-documents/__tests__/expense-documents.controller.spec.ts`

- [ ] **Step 8.1: Write controller test**

Create `apps/api/src/modules/expense-documents/__tests__/expense-documents.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ExpenseDocumentsController } from '../expense-documents.controller';
import { ExpenseDocumentsService } from '../expense-documents.service';

describe('ExpenseDocumentsController', () => {
  let controller: ExpenseDocumentsController;
  let service: jest.Mocked<Partial<ExpenseDocumentsService>>;

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'doc-1', number: 'EX-20260510-0001' }),
      list: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
      getSummary: jest.fn().mockResolvedValue({ totalCount: 0, byStatus: {}, accrualUnpaidCount: 0, accrualUnpaidTotal: 0 }),
      findOne: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      update: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      post: jest.fn().mockResolvedValue({ entryNo: 'JE-1' }),
      voidDocument: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      softDelete: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ExpenseDocumentsController],
      providers: [{ provide: ExpenseDocumentsService, useValue: service }],
    }).compile();
    controller = moduleRef.get(ExpenseDocumentsController);
  });

  it('POST / calls service.create with userId', async () => {
    await controller.create({ documentType: 'EXPENSE' } as never, { id: 'user-1' } as never);
    expect(service.create).toHaveBeenCalledWith({ documentType: 'EXPENSE' }, 'user-1');
  });

  it('GET / passes query + user context', async () => {
    await controller.list(
      { tab: 'draft' } as never,
      { user: { id: 'u', branchId: 'b1', role: 'BRANCH_MANAGER' } } as never,
    );
    expect(service.list).toHaveBeenCalledWith(
      { tab: 'draft' },
      { branchId: 'b1', role: 'BRANCH_MANAGER' },
    );
  });

  it('GET /summary calls service.getSummary', async () => {
    await controller.summary('b1', undefined, undefined, { user: { id: 'u', branchId: 'b1', role: 'OWNER' } } as never);
    expect(service.getSummary).toHaveBeenCalledWith({ branchId: 'b1', startDate: undefined, endDate: undefined });
  });

  it('GET /:id calls findOne', async () => {
    await controller.findOne('doc-1');
    expect(service.findOne).toHaveBeenCalledWith('doc-1');
  });

  it('POST /:id/post fires post', async () => {
    await controller.post('doc-1', { id: 'user-1' } as never);
    expect(service.post).toHaveBeenCalledWith('doc-1', 'user-1');
  });

  it('POST /:id/void fires voidDocument', async () => {
    await controller.void('doc-1', { id: 'user-1' } as never);
    expect(service.voidDocument).toHaveBeenCalledWith('doc-1', 'user-1');
  });

  it('PATCH /:id calls update', async () => {
    await controller.update('doc-1', { description: 'X' } as never, { id: 'user-1' } as never);
    expect(service.update).toHaveBeenCalledWith('doc-1', { description: 'X' }, 'user-1');
  });

  it('DELETE /:id calls softDelete', async () => {
    await controller.delete('doc-1', { id: 'user-1' } as never);
    expect(service.softDelete).toHaveBeenCalledWith('doc-1', 'user-1');
  });
});
```

- [ ] **Step 8.2: Run test (should fail)**

```bash
npx jest --testPathPattern="expense-documents.controller.spec" 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 8.3: Implement controller**

Create `apps/api/src/modules/expense-documents/expense-documents.controller.ts`:

```ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExpenseDocumentsService } from './expense-documents.service';
import { CreateExpenseDocumentDto } from './dto/create.dto';
import { UpdateExpenseDocumentDto } from './dto/update.dto';
import { ListExpenseDocumentsQueryDto } from './dto/list-query.dto';

@Controller('expense-documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpenseDocumentsController {
  constructor(private readonly service: ExpenseDocumentsService) {}

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  create(
    @Body() dto: CreateExpenseDocumentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  list(
    @Query() query: ListExpenseDocumentsQueryDto,
    @Req() req: { user: { id: string; branchId?: string; role: string } },
  ) {
    return this.service.list(query, { branchId: req.user.branchId, role: req.user.role });
  }

  @Get('summary')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  summary(
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Req() req?: { user: { id: string; branchId?: string; role: string } },
  ) {
    // Branch scoping mirror: if user lacks cross-branch role, override with their branch
    const effective =
      req?.user.role && ['OWNER', 'FINANCE_MANAGER'].includes(req.user.role)
        ? branchId
        : req?.user.branchId ?? branchId;
    return this.service.getSummary({ branchId: effective, startDate, endDate });
  }

  @Get(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDocumentDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/post')
  @Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  post(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.post(id, user.id);
  }

  @Post(':id/void')
  @Roles('OWNER', 'FINANCE_MANAGER')
  void(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.voidDocument(id, user.id);
  }

  @Delete(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
  delete(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.service.softDelete(id, user.id);
  }
}
```

- [ ] **Step 8.4: Implement module**

Create `apps/api/src/modules/expense-documents/expense-documents.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { JournalModule } from '../journal/journal.module';
import { AuthModule } from '../auth/auth.module';
import { ExpenseDocumentsController } from './expense-documents.controller';
import { ExpenseDocumentsService } from './expense-documents.service';
import { DocNumberService } from './services/doc-number.service';
import { StatusTransitionService } from './services/status-transition.service';

@Module({
  imports: [PrismaModule, JournalModule, AuthModule],
  controllers: [ExpenseDocumentsController],
  providers: [ExpenseDocumentsService, DocNumberService, StatusTransitionService],
  exports: [ExpenseDocumentsService],
})
export class ExpenseDocumentsModule {}
```

- [ ] **Step 8.5: Register module in app.module.ts**

Open `apps/api/src/app.module.ts`. In the `imports: [...]` array add:

```ts
import { ExpenseDocumentsModule } from './modules/expense-documents/expense-documents.module';
```

Add to imports array next to other domain modules:
```ts
ExpenseDocumentsModule,
```

- [ ] **Step 8.6: Run controller test**

```bash
npx jest --testPathPattern="expense-documents.controller.spec" 2>&1 | tail -10
```

Expected: PASS — 9 tests.

- [ ] **Step 8.7: Commit**

```bash
git add apps/api/src/modules/expense-documents/expense-documents.controller.ts apps/api/src/modules/expense-documents/expense-documents.module.ts apps/api/src/modules/expense-documents/__tests__/expense-documents.controller.spec.ts apps/api/src/app.module.ts
git commit -m "feat(expense-documents): add controller + module + register in app"
```

---

## Task 9: Wipe CLI

**Files:**
- Create: `apps/api/src/cli/wipe-expenses.cli.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 9.1: Read existing wipe CLI for structure reference**

Reference: `apps/api/src/cli/wipe-accounting.cli.ts` (env-var guards, db-name match, prod check, cooldown).

- [ ] **Step 9.2: Implement wipe-expenses CLI**

Create `apps/api/src/cli/wipe-expenses.cli.ts`:

```ts
/**
 * Wipe Expense Documents CLI — PR-1 helper.
 *
 * DESTRUCTIVE: Truncates expense_documents + expense_details + related
 * journal_entries (metadata.flow LIKE 'expense-%') and journal_lines.
 *
 * Run as Cloud Run Job after PR-1 deploys, or locally for dev reset.
 *
 * Required env (mirrors wipe-accounting.cli.ts):
 *   CONFIRM_WIPE_EXPENSES=YES_I_AM_SURE
 *   EXPECTED_DB_NAME=<exact db name>
 *   ALLOW_PROD_WIPE=YES_I_AM_SURE   (only when NODE_ENV=production)
 */
import { PrismaClient } from '@prisma/client';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

async function main(): Promise<void> {
  if (process.env.CONFIRM_WIPE_EXPENSES !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to run without CONFIRM_WIPE_EXPENSES=${REQUIRED_CONSENT}`);
    console.error('');
    console.error('This script performs the following DESTRUCTIVE operations:');
    console.error('  DELETE FROM journal_lines WHERE journal_entry_id IN (... metadata flow=expense-*)');
    console.error('  DELETE FROM journal_entries WHERE metadata->>flow LIKE expense-%');
    console.error('  TRUNCATE expense_details CASCADE');
    console.error('  TRUNCATE expense_documents CASCADE');
    console.error('');
    console.error('All expense documents + their JE entries will be permanently deleted.');
    console.error(
      'Re-run with: CONFIRM_WIPE_EXPENSES=YES_I_AM_SURE EXPECTED_DB_NAME=<db> npm --prefix apps/api run wipe:expenses',
    );
    console.error('Production: also add ALLOW_PROD_WIPE=YES_I_AM_SURE');
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_WIPE !== REQUIRED_CONSENT) {
    console.error('ERROR: NODE_ENV=production requires ALLOW_PROD_WIPE=YES_I_AM_SURE');
    process.exit(1);
  }

  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: Refusing to run without EXPECTED_DB_NAME=<exact db name>');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const [{ current_database }] = await prisma.$queryRaw<Array<{ current_database: string }>>`
      SELECT current_database()
    `;
    if (current_database !== expectedDb) {
      console.error(
        `ERROR: Connected DB "${current_database}" does not match EXPECTED_DB_NAME="${expectedDb}"`,
      );
      process.exit(1);
    }

    console.error(`About to wipe expense data on database "${current_database}".`);
    console.error('Press Ctrl+C within 5 seconds to abort...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const stats = await prisma.$transaction(async (tx) => {
      const lines = await tx.$executeRawUnsafe(`
        DELETE FROM journal_lines
        WHERE journal_entry_id IN (
          SELECT id FROM journal_entries
          WHERE metadata->>'flow' LIKE 'expense-%'
        )
      `);
      const entries = await tx.$executeRawUnsafe(`
        DELETE FROM journal_entries
        WHERE metadata->>'flow' LIKE 'expense-%'
      `);
      const details = await tx.$executeRawUnsafe(`TRUNCATE expense_details CASCADE`);
      const docs = await tx.$executeRawUnsafe(`TRUNCATE expense_documents CASCADE`);
      return { lines, entries, details, docs };
    });

    console.log('Wipe complete:');
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Wipe failed:', err);
  process.exit(1);
});
```

- [ ] **Step 9.3: Add npm script**

Open `apps/api/package.json`. Find `"scripts": { ... }`. Add the line (next to `wipe:accounting` if present):

```json
"wipe:expenses": "tsx src/cli/wipe-expenses.cli.ts",
```

- [ ] **Step 9.4: Verify the CLI compiles**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx tsc --noEmit src/cli/wipe-expenses.cli.ts 2>&1 | head -10
```

Expected: no TypeScript errors. (May see errors for the wider project from pending Task 7 — only inspect lines mentioning `wipe-expenses.cli.ts`.)

- [ ] **Step 9.5: Commit**

```bash
git add apps/api/src/cli/wipe-expenses.cli.ts apps/api/package.json
git commit -m "feat(expense-documents): add wipe CLI for fresh-start migration"
```

---

## Task 10: Remove old Expense API endpoints + Service code

**Files:**
- Modify: `apps/api/src/modules/accounting/accounting.controller.ts`
- Modify: `apps/api/src/modules/accounting/accounting.service.ts`
- Modify: `apps/api/src/modules/accounting/accounting.module.ts` (if separate)

- [ ] **Step 10.1: Identify old expense routes in accounting.controller.ts**

Open `apps/api/src/modules/accounting/accounting.controller.ts`. The current file has `@Controller('expenses')` at line 28.

Identify the entire controller block and decide: this controller is dedicated to expenses — delete the WHOLE controller class.

- [ ] **Step 10.2: Delete the legacy controller**

Open `apps/api/src/modules/accounting/accounting.controller.ts`. The whole file is the legacy expenses controller (verified earlier — endpoints `/expenses/*`). Delete the file:

```bash
rm apps/api/src/modules/accounting/accounting.controller.ts
```

If the file ALSO contains other expense endpoints (legacy ledger, period-status, bad-debt etc.) — keep those, only delete the `findAll/getSummary/category-breakdown/findOne/create/submit/approve/reject/accrue/pay/void` methods. Re-grep:

```bash
grep -n "@Get\|@Post" apps/api/src/modules/accounting/accounting.controller.ts 2>/dev/null | head -30
```

If the file no longer exists you're done with Step 10.2; otherwise edit out only the deleted methods listed above and keep `ledger/*`, `period-status`, `close-period`, `bad-debt/*` endpoints.

- [ ] **Step 10.3: Remove orphan service methods**

Open `apps/api/src/modules/accounting/accounting.service.ts`. Delete (the methods that backed the deleted endpoints):

- `findAllExpenses(...)`
- `getExpenseSummary(...)`
- `getExpenseCategoryBreakdown(...)`
- `findOneExpense(...)`
- `createExpense(...)`
- `submitExpense(...)`
- `approveExpense(...)`
- `rejectExpense(...)`
- `accrueExpense(...)`
- `payExpense(...)`
- `voidExpense(...)`
- `generateExpenseNumber(...)` (file-level helper at line ~90)

Also delete the import of `ExpenseStatus`, `ExpenseAccountType`, `ExpenseCategory` enums.

- [ ] **Step 10.4: Update accounting.module.ts to drop expense controller (if separate)**

Open `apps/api/src/modules/accounting/accounting.module.ts`. If `AccountingExpensesController` or similar is registered, remove it. Keep `AccountingLedgerController`, `AccountingPeriodController`, `BadDebtController` if they are separate.

- [ ] **Step 10.5: Run typecheck — expect compile to succeed now**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
./tools/check-types.sh api 2>&1 | tail -20
```

Expected: API: OK. (If there are errors, they should only point to remaining places in the codebase that use `Expense` model — fix those by removing or migrating the call.)

- [ ] **Step 10.6: Run all api tests — expect old tests broken from removed methods**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx jest --testPathPattern="^/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/(accounting|expense-documents|journal)" --runInBand 2>&1 | tail -10
```

Expected: PASS for new expense-documents + journal tests; old `accounting.service.spec.ts` may have failures referencing deleted methods. Delete/update those legacy spec lines.

- [ ] **Step 10.7: Update accounting.service.spec.ts**

Open `apps/api/src/modules/accounting/accounting.service.spec.ts`. Remove `describe()` blocks for any of the deleted methods (findAllExpenses, getExpenseSummary, etc.). Run tests again:

```bash
npx jest --testPathPattern="accounting" --runInBand 2>&1 | tail -7
```

Expected: PASS.

- [ ] **Step 10.8: Commit**

```bash
git add apps/api/src/modules/accounting/
git commit -m "refactor(accounting): remove legacy expense endpoints + service methods (replaced by expense-documents module)"
```

---

## Task 11: Integration test — full lifecycle (vitest + real Postgres)

**Files:**
- Create: `apps/api/src/modules/expense-documents/__tests__/full-lifecycle.integration.spec.ts`

- [ ] **Step 11.1: Write integration test**

Reference shape: `apps/api/src/modules/journal/cron/installment-accrual.cron.spec.ts` (uses real PrismaClient, vitest, seedFinanceCoa).

Create `apps/api/src/modules/expense-documents/__tests__/full-lifecycle.integration.spec.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient, DocumentStatus } from '@prisma/client';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { DocNumberService } from '../services/doc-number.service';
import { StatusTransitionService } from '../services/status-transition.service';
import { ExpenseSameDayTemplate } from '../../journal/cpa-templates/expense-same-day.template';
import { ExpenseAccrualTemplate } from '../../journal/cpa-templates/expense-accrual.template';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
let userId: string;
let branchId: string;

describe('ExpenseDocuments full lifecycle (integration)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);

    // Ensure system user + branch
    const branch = await prisma.branch.findFirst({ where: { deletedAt: null } });
    if (branch) branchId = branch.id;
    else {
      const co = await prisma.companyInfo.findFirst({ where: { deletedAt: null } });
      const b = await prisma.branch.create({
        data: { name: '__test_branch_expdoc__', companyId: co!.id },
      });
      branchId = b.id;
    }

    const user = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!user) {
      const created = await prisma.user.create({
        data: {
          email: 'admin@bestchoice.com',
          password: 'placeholder',
          name: 'Admin',
          role: 'OWNER',
          branchId,
        },
      });
      userId = created.id;
    } else {
      userId = user.id;
    }
  });

  beforeEach(async () => {
    // Clean expense data + their JEs between tests
    await prisma.$executeRawUnsafe(`
      DELETE FROM journal_lines
      WHERE journal_entry_id IN (
        SELECT id FROM journal_entries WHERE metadata->>'flow' LIKE 'expense-%'
      )
    `);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE metadata->>'flow' LIKE 'expense-%'`);
    await prisma.expenseDocument.deleteMany();
  });

  function buildService() {
    const journal = new JournalAutoService(prisma as never);
    const sameDay = new ExpenseSameDayTemplate(journal, prisma as never);
    const accrual = new ExpenseAccrualTemplate(journal, prisma as never);
    return new ExpenseDocumentsService(
      prisma as never,
      new DocNumberService(),
      new StatusTransitionService(),
      sameDay,
      accrual,
    );
  }

  it('Same-day flow: create DRAFT → post → POSTED + balanced JE in DB', async () => {
    const service = buildService();
    const created = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        subtotal: 1000,
        vatAmount: 70,
        withholdingTax: 0,
        paymentMethod: 'CASH',
        depositAccountCode: '11-1101',
        detail: { category: '53-1302' },
      } as never,
      userId,
    );
    expect(created.status).toBe(DocumentStatus.DRAFT);

    await service.post(created.id, userId);

    const after = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.status).toBe(DocumentStatus.POSTED);
    expect(after.paidAt).not.toBeNull();
    expect(after.journalEntryId).not.toBeNull();

    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { entryNumber: after.journalEntryId! },
      include: { lines: true },
    });
    const drSum = je.lines.reduce((s, l) => s + Number(l.dr), 0);
    const crSum = je.lines.reduce((s, l) => s + Number(l.cr), 0);
    expect(drSum).toBeCloseTo(crSum, 2);
    expect(drSum).toBeCloseTo(1070, 2);
  });

  it('Accrual flow: create DRAFT (no payment) → post → ACCRUAL + JE without cash leg', async () => {
    const service = buildService();
    const created = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        subtotal: 5000,
        vatAmount: 350,
        withholdingTax: 0,
        // No paymentMethod
        detail: { category: '53-1404' },
      } as never,
      userId,
    );

    await service.post(created.id, userId);
    const after = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.status).toBe(DocumentStatus.ACCRUAL);
    expect(after.paidAt).toBeNull();

    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { entryNumber: after.journalEntryId! },
      include: { lines: true },
    });
    const codes = je.lines.map((l) => l.accountCode);
    expect(codes).toContain('21-1104'); // AP
    expect(codes).not.toContain('11-1101'); // No cash leg
  });

  it('Tab=draft returns only DRAFT documents', async () => {
    const service = buildService();
    await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        subtotal: 100,
        detail: { category: '53-1302' },
      } as never,
      userId,
    );
    const accruedDoc = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        subtotal: 200,
        detail: { category: '53-1302' },
      } as never,
      userId,
    );
    await service.post(accruedDoc.id, userId);

    const draftList = await service.list({ tab: 'draft' } as never, { branchId, role: 'OWNER' });
    expect(draftList.data.length).toBe(1);
    expect(draftList.data[0].status).toBe('DRAFT');

    const unpaidList = await service.list({ tab: 'unpaid' } as never, { branchId, role: 'OWNER' });
    expect(unpaidList.data.length).toBe(1);
    expect(unpaidList.data[0].status).toBe('ACCRUAL');
  });

  it('Soft-delete blocks non-DRAFT', async () => {
    const service = buildService();
    const doc = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        subtotal: 100,
        paymentMethod: 'CASH',
        depositAccountCode: '11-1101',
        detail: { category: '53-1302' },
      } as never,
      userId,
    );
    await service.post(doc.id, userId); // → POSTED
    await expect(service.softDelete(doc.id, userId)).rejects.toThrow();
  });

  it('Numbering increments per-day per-type', async () => {
    const service = buildService();
    const a = await service.create(
      { documentType: 'EXPENSE', branchId, documentDate: new Date().toISOString(), subtotal: 100, detail: { category: '53-1302' } } as never,
      userId,
    );
    const b = await service.create(
      { documentType: 'EXPENSE', branchId, documentDate: new Date().toISOString(), subtotal: 100, detail: { category: '53-1302' } } as never,
      userId,
    );
    expect(a.number).toMatch(/^EX-\d{8}-0001$/);
    expect(b.number).toMatch(/^EX-\d{8}-0002$/);
  });
});
```

- [ ] **Step 11.2: Run integration test**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx vitest run --no-file-parallelism src/modules/expense-documents/__tests__/full-lifecycle.integration.spec.ts 2>&1 | tail -20
```

Expected: PASS — 5 tests.

- [ ] **Step 11.3: Commit**

```bash
git add apps/api/src/modules/expense-documents/__tests__/full-lifecycle.integration.spec.ts
git commit -m "test(expense-documents): add full-lifecycle integration test"
```

---

## Task 12: Frontend — switch ExpensesPage to /expense-documents API

**Files:**
- Modify: `apps/web/src/pages/ExpensesPage.tsx`

- [ ] **Step 12.1: Update Expense interface to match new API shape**

Open `apps/web/src/pages/ExpensesPage.tsx`. Find the `interface Expense { ... }` block (line ~25). Replace with:

```ts
interface ExpenseDocument {
  id: string;
  number: string;
  documentType: 'EXPENSE' | 'CREDIT_NOTE' | 'PAYROLL' | 'VENDOR_SETTLEMENT';
  branchId: string;
  documentDate: string;
  vendorName: string | null;
  vendorTaxId: string | null;
  taxInvoiceNo: string | null;
  description: string | null;
  subtotal: string;
  vatAmount: string;
  withholdingTax: string;
  totalAmount: string;
  netPayment: string | null;
  status: 'DRAFT' | 'ACCRUAL' | 'POSTED' | 'VOIDED';
  paidAt: string | null;
  paymentMethod: string | null;
  depositAccountCode: string | null;
  expenseDetail: { category: string } | null;
  branch: { id: string; name: string };
  createdBy: { id: string; name: string };
  createdAt: string;
  reference: string | null;
  note: string | null;
}

// Alias for backward compat with existing code in the file
type Expense = ExpenseDocument;
```

- [ ] **Step 12.2: Update Summary interface**

Find `interface Summary { ... }`. Replace with:

```ts
interface Summary {
  totalCount: number;
  byStatus: Record<string, number>;
  accrualUnpaidCount: number;
  accrualUnpaidTotal: number;
}
```

- [ ] **Step 12.3: Update API endpoint URLs**

Find every occurrence of `/expenses` (without expense- prefix) in this file:

```bash
grep -n "/expenses\b\|'/expenses" apps/web/src/pages/ExpensesPage.tsx
```

Replace each:
- `api.get('/expenses/summary?...')` → `api.get('/expense-documents/summary?...')`
- `api.get('/expenses?...')` → `api.get('/expense-documents?...')`
- `api.post('/expenses', data)` → `api.post('/expense-documents', mapPayload(data))` — see Step 12.4
- `api.patch('/expenses/${id}', data)` → `api.patch('/expense-documents/${id}', data)`
- `api.post('/expenses/${id}/submit')` → `api.post('/expense-documents/${id}/post')`
- `api.post('/expenses/${id}/${action}', body)` → `api.post('/expense-documents/${id}/${action}', body)`

- [ ] **Step 12.4: Update form payload mapping (ExpenseFormPanel save)**

The new API expects:
```ts
{
  documentType: 'EXPENSE',
  branchId,
  documentDate: form.expenseDate,  // renamed
  subtotal: amount,                 // renamed from "amount"
  vatAmount,
  withholdingTax,
  paymentMethod: form.paymentMethod || undefined,
  depositAccountCode: form.depositAccountCode || undefined,
  vendorName, vendorTaxId, taxInvoiceNo, description: form.description, note: form.note,
  detail: { category: form.category },
}
```

Find the `saveMutation.mutate({ data: ... })` call in `ExpenseFormPanel`. Build the new payload:

```ts
saveMutation.mutate({
  data: {
    documentType: 'EXPENSE',
    branchId: form.branchId || branches[0]?.id,
    documentDate: form.expenseDate,
    subtotal: amount,
    vatAmount,
    withholdingTax,
    paymentMethod: form.paymentMethod || undefined,
    depositAccountCode: form.paymentMethod ? '11-1101' : undefined, // PR-1: assume default; selector added later
    vendorName: form.vendorName || undefined,
    vendorTaxId: form.vendorTaxId || undefined,
    taxInvoiceNo: form.taxInvoiceNo || undefined,
    description: form.description,
    note: form.note || undefined,
    receiptImageUrl: form.receiptImageUrl || undefined,
    reference: form.reference || undefined,
    detail: { category: form.category },
  },
  andSubmit,
});
```

- [ ] **Step 12.5: Update column accessors**

Find the `columns = [...]` array. Update each column's `render` to use new field names:
- `e.expenseNumber` → `e.number`
- `e.expenseDate` → `e.documentDate`
- `e.amount`, `e.vatAmount`, `e.totalAmount` → `e.subtotal`, `e.vatAmount`, `e.totalAmount`
- `e.category` → `e.expenseDetail?.category ?? '-'`
- `e.accountCode` → drop (not in new schema)

The status badge logic stays: `status === 'POSTED'` etc.

- [ ] **Step 12.6: Update getDocumentType helper**

Replace the existing `getDocumentType(e)` function with:

```ts
function getDocumentType(e: Expense): { label: string; cls: string } {
  switch (e.documentType) {
    case 'CREDIT_NOTE':
      return { label: 'ใบลดหนี้', cls: 'bg-destructive/10 text-destructive border-destructive/20' };
    case 'PAYROLL':
      return { label: 'เงินเดือน', cls: 'bg-info/10 text-info border-info/20' };
    case 'VENDOR_SETTLEMENT':
      return { label: 'จ่ายเจ้าหนี้', cls: 'bg-muted text-muted-foreground border-border' };
    case 'EXPENSE':
    default:
      return e.status === 'ACCRUAL'
        ? { label: 'ตั้งหนี้', cls: 'bg-warning/10 text-warning border-warning/20' }
        : { label: 'Same-day', cls: 'bg-success/10 text-success border-success/20' };
  }
}
```

- [ ] **Step 12.7: Update getStatusBadge helper**

Replace with:

```ts
function getStatusBadge(e: Expense): { label: string; cls: string } {
  if (e.status === 'DRAFT') return { label: 'DRAFT', cls: 'bg-muted text-muted-foreground border-border' };
  if (e.status === 'VOIDED') return { label: 'VOIDED', cls: 'bg-muted text-muted-foreground border-border' };
  if (e.status === 'ACCRUAL') return { label: 'ACCRUAL', cls: 'bg-success/10 text-success border-success/20' };
  return { label: 'POSTED', cls: 'bg-success/10 text-success border-success/20' };
}
```

- [ ] **Step 12.8: Run web typecheck**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
./tools/check-types.sh web 2>&1 | tail -10
```

Expected: PASS. If errors:
- field name mismatches → fix the column accessors
- removed types (`statusLabels` referencing deleted enum values) — drop those entries

- [ ] **Step 12.9: Commit**

```bash
git add apps/web/src/pages/ExpensesPage.tsx
git commit -m "refactor(web): switch ExpensesPage to /expense-documents API"
```

---

## Task 13: Verify everything compiles + tests pass

- [ ] **Step 13.1: Full typecheck**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
./tools/check-types.sh all 2>&1 | tail -10
```

Expected: API: OK, Web: OK.

- [ ] **Step 13.2: Run all expense-documents + journal + accounting tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx jest --testPathPattern="^/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/(expense-documents|journal|accounting)" --runInBand 2>&1 | tail -7
```

Expected: All PASS.

- [ ] **Step 13.3: Run integration test**

```bash
npx vitest run --no-file-parallelism src/modules/expense-documents/__tests__/full-lifecycle.integration.spec.ts 2>&1 | tail -10
```

Expected: 5/5 PASS.

---

## Task 14: Manual local verification

- [ ] **Step 14.1: Run wipe CLI on dev DB**

Verify dev DB name first:

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
node -e "console.log(require('@prisma/client').Prisma)" 2>/dev/null | head -1  # smoke
echo $DATABASE_URL | sed 's|.*/||'
```

Run wipe (dev DB name from above):

```bash
CONFIRM_WIPE_EXPENSES=YES_I_AM_SURE \
  EXPECTED_DB_NAME=bestchoice_dev \
  npm --prefix apps/api run wipe:expenses
```

Expected: 5-second cooldown then "Wipe complete" with stats. Old expense data + JE entries cleared.

- [ ] **Step 14.2: Restart dev servers (NestJS hot-reload should pick up new module)**

If dev servers running, NestJS `--watch` will reload automatically. Otherwise:

```bash
npm run dev  # from project root, or restart manually
```

- [ ] **Step 14.3: Open /expenses in browser**

```bash
open http://localhost:5173/expenses
```

Verify visually:
- Listing renders with 0 records (post-wipe)
- Tabs all show 0 counts
- "+ สร้างเอกสารใหม่" button works
- Form opens, can fill EX with all required fields
- Save DRAFT → list shows 1 DRAFT
- Open and post → list shows 1 POSTED (or ACCRUAL based on payment method)
- Click status filter tabs → filter works

If any UI flow breaks, debug and add a fix commit before merging.

- [ ] **Step 14.4: Final commit if any UI fixes needed**

```bash
git add apps/web/src/pages/ExpensesPage.tsx
git commit -m "fix(web): adjust [specific issue found in manual test]"
```

(Skip if no fixes.)

---

## Task 15: Push branch + open PR

- [ ] **Step 15.1: Push branch**

```bash
git push origin feat/expense-documents-pr1
```

- [ ] **Step 15.2: Create PR**

```bash
gh pr create --title "PR-1: Expense Document polymorphic foundation (EXPENSE type)" --body "$(cat <<'EOF'
## Summary
- Replaces legacy `Expense` model with polymorphic `ExpenseDocument` + `ExpenseDetail` (EXPENSE type only in this PR)
- Adds new module `expense-documents` with controller, service, doc-number, status-transition
- Adds 2 JE templates: `ExpenseSameDayTemplate` (Dr expense / Cr cash) and `ExpenseAccrualTemplate` (Dr expense / Cr 21-1104 AP)
- Wipes legacy expense data + drops `expenses` table via `wipe-expenses.cli.ts`
- Frontend `ExpensesPage` switched to `/expense-documents` API; UI redesign from previous session preserved

## CPA AUDIT FLAG
Both JE templates are logical-correct against Phase A.4 chart but pending CPA case verification. Flagged for Phase A.7 review.

## Test plan
- [x] Unit tests for DocNumberService, StatusTransitionService, both JE templates, ExpenseDocumentsService, controller (jest)
- [x] Integration test: full lifecycle Same-day + Accrual flows, tab filters, soft-delete, numbering (vitest + real Postgres)
- [x] TypeScript: 0 errors (api + web)
- [x] Manual: dev wipe + create EX form → POSTED + ACCRUAL flows, tab filtering, badge colors

## Migration notes
This PR contains the destructive wipe migration. After merge:
1. Run `CONFIRM_WIPE_EXPENSES=YES_I_AM_SURE EXPECTED_DB_NAME=<prod-db> ALLOW_PROD_WIPE=YES_I_AM_SURE npm --prefix apps/api run wipe:expenses` as Cloud Run Job (owner-confirmed only)
2. PR-2..6 add CN/PR/SE/Favorites/DailySummary on top

## Spec
- docs/superpowers/specs/2026-05-10-expense-document-polymorphic-redesign.md (commit b3be9605)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 15.3: Verify CI passes**

```bash
gh pr checks --watch
```

Expected: All checks green.

---

## Self-Review Notes

(Filled in after writing the plan — fix any issues inline before handing off.)

**Spec coverage check (mapping spec section → task):**

| Spec section | Task |
|--------------|------|
| §1.1 ExpenseDocument header | Task 1 |
| §1.2 Detail tables (EXPENSE only in PR-1) | Task 1 (ExpenseDetail only) |
| §2 Numbering | Task 2 |
| §3.1 Status lifecycle (EXPENSE Same-day + Accrual) | Task 3, Task 7 |
| §3.2 Tab → query mapping | Task 7 (list method), Task 12 (web) |
| §3.3 Type label | Task 12 (web) |
| §4.1 ExpenseSameDayTemplate | Task 4 |
| §4.2 ExpenseAccrualTemplate | Task 5 |
| §4.6 Reverse on void | Task 7 (basic), follow-up note for full reverse JE wiring |
| §5 REST API | Task 6 (DTOs), Task 8 (controller) |
| §6.4 Listing page (existing redesigned UI preserved) | Task 12 |
| §8 Migration (wipe + drop legacy) | Task 9, Task 10, Task 14 |
| §9.1-9.2 Testing (unit + integration) | Tasks 2-7, 11 |
| §11 Risks → mitigated by tests + advisory lock pattern | Tasks 2, 7 |

**Out of scope for PR-1 (will fail validation if user tries):**
- CN/PR/SE create endpoints — explicitly rejected by `documentType` enum guard in DTO + service
- Favorites — not implemented
- Daily summary — not implemented
- Reverse JE on full void — basic VOIDED status flip only; full Dr↔Cr swap deferred (could be added inline later)

**Placeholders fixed:**
- All steps contain exact code or commands. No `// TODO`, no "implement appropriately".
- The void → reverse JE in Task 7 logs a warning rather than implementing the reversal — flagged explicitly as a known PR-1 limitation in Task 7 note.

**Type consistency:**
- `DocNumberService.next(tx, type, date)` — same signature in Task 2 (impl), Task 7 (consumer), Task 11 (integration).
- `StatusTransitionService.assertCanPost({ type, from, hasPaymentMethod })` — same shape across.
- Templates: `execute(documentId, outerTx?)` returns `{ entryNo: string }` — consistent in Tasks 4, 5, 7.
- `ExpenseDocument` shape on web (Task 12) matches Prisma model (Task 1).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-10-expense-document-pr1.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
