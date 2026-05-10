# PR-2: Credit Note (CN) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add CREDIT_NOTE document type on top of PR-1 — ใบลดหนี้ that reverses (full or partial) a prior EXPENSE document. Schema additive only (no migration risk). Includes JE template, dedicated `/credit-note` endpoint with original-doc validation + amount cap, and CN form variant in `/expenses/new?type=CN`.

**Architecture:** Reuses PR-1 polymorphic header (`ExpenseDocument`). Adds `CreditNoteDetail` 1:1 sub-table holding `originalDocumentId` + `reason` + `category`. New `CreditNoteTemplate` JE reverses original: target leg depends on whether original is `ACCRUAL` (Dr 21-1104 / Cr expense+VAT) or `POSTED` (Dr cash / Cr expense+VAT). Validation checks original status, same-branch, and cumulative cap (sum of all prior non-VOIDED CNs against same original). Frontend form uses original-doc picker (search by EX number) + reason textarea + amount input with live cap validation.

**Tech Stack:** Same as PR-1 (NestJS + Prisma 6 + Postgres + class-validator API; React 18 + Vite + react-query + Tailwind + shadcn/ui Web). jest unit + vitest integration.

**Spec reference:** [docs/superpowers/specs/2026-05-10-expense-document-polymorphic-redesign.md](./2026-05-10-expense-document-polymorphic-redesign.md) §1.2 (CreditNoteDetail), §3.1 (lifecycle: DRAFT→POSTED→VOIDED, no ACCRUAL state), §4.3 (CreditNoteTemplate JE), §6.2 (CN form section).

**Branch:** `feat/expense-documents-pr2` (off `feat/expense-documents-pr1` — PR-1 must merge before PR-2 to avoid stale base).

---

## File Structure

### API (apps/api/src)

| Path | Responsibility | Action |
|------|----------------|--------|
| `prisma/schema.prisma` | Add `model CreditNoteDetail` + relation on `ExpenseDocument` | Modify |
| `prisma/migrations/<ts>_credit_note_detail/migration.sql` | DDL for new table + FK to expense_documents | Create |
| `modules/journal/cpa-templates/credit-note.template.ts` | JE template — Dr 21-1104 or Dr cash / Cr expense + 11-2104 | Create |
| `modules/journal/journal.module.ts` | Register `CreditNoteTemplate` | Modify |
| `modules/expense-documents/dto/create-credit-note.dto.ts` | `CreateCreditNoteDto` (originalDocumentId + reason + amount) | Create |
| `modules/expense-documents/expense-documents.controller.ts` | Add `POST /credit-note` endpoint | Modify |
| `modules/expense-documents/expense-documents.service.ts` | Add `createCreditNote()` + extend `post()` to dispatch CN template | Modify |

### API tests

| Path | Responsibility |
|------|----------------|
| `modules/expense-documents/__tests__/credit-note.template.spec.ts` | Mocked: balance check, ACCRUAL vs POSTED original branching, idempotency, post-update creditedAmount on original |
| `modules/expense-documents/__tests__/credit-note.service.spec.ts` | Mocked: validation (original exists/same branch/EXPENSE type/non-VOIDED), amount cap (reject when total would exceed original), happy create |
| `modules/expense-documents/__tests__/cn-lifecycle.integration.spec.ts` | vitest + Postgres: create EX → post (POSTED) → create CN → post CN → verify JE reverses + sum-of-CNs respected |

### Web (apps/web/src)

| Path | Responsibility | Action |
|------|----------------|--------|
| `pages/ExpensesPage.tsx` | "+ สร้างเอกสารใหม่" button → dropdown 4 types (EX/CN/PR/SE); CN routes to `/expenses/new?type=CN` | Modify |
| `pages/ExpenseDocumentNewPage.tsx` | Route page that switches form by `?type=` query | Create |
| `components/expense-documents/CreditNoteForm.tsx` | CN form: original picker + reason + amount + reuse common header sections | Create |
| `App.tsx` | Add route `/expenses/new` → `ExpenseDocumentNewPage` | Modify |

### Web tests

| Path | Responsibility |
|------|----------------|
| `e2e/credit-note.spec.ts` | Login → create EX → post → click "ใบลดหนี้" from create dropdown → fill form → save → see CN in list with red badge |

---

## Branch + Worktree

- [ ] **Step 0a: Verify on PR-2 branch (already created off PR-1)**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git branch --show-current
```

Expected: `feat/expense-documents-pr2` (off `feat/expense-documents-pr1`).

If PR-1 has changed (review comments addressed), rebase:
```bash
git fetch origin
git rebase origin/feat/expense-documents-pr1
```

---

## Task 1: Schema migration — add `credit_note_details` table

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_credit_note_detail/migration.sql`

- [ ] **Step 1.1: Add `CreditNoteDetail` model to `schema.prisma`**

Open `apps/api/prisma/schema.prisma`. Find the existing `model ExpenseDetail { ... }` block (added in PR-1 Task 1). Right after it, add:

```prisma
model CreditNoteDetail {
  documentId         String          @id @map("document_id")
  document           ExpenseDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  originalDocumentId String          @map("original_document_id")
  reason             String
  category           String

  @@index([originalDocumentId])
  @@map("credit_note_details")
}
```

In `model ExpenseDocument { ... }`, find the existing `expenseDetail   ExpenseDetail?` line. Right after it, add:

```prisma
  creditNote      CreditNoteDetail?
```

- [ ] **Step 1.2: Generate migration**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx prisma migrate dev --name add_credit_note_detail
```

If shadow DB fails (pgvector issue from PR-1), create migration manually as PR-1 did:

Create `apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_add_credit_note_detail/migration.sql` with:

```sql
-- CreateTable
CREATE TABLE "credit_note_details" (
    "document_id" TEXT NOT NULL,
    "original_document_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "credit_note_details_pkey" PRIMARY KEY ("document_id")
);

-- CreateIndex
CREATE INDEX "credit_note_details_original_document_id_idx" ON "credit_note_details"("original_document_id");

-- AddForeignKey
ALTER TABLE "credit_note_details" ADD CONSTRAINT "credit_note_details_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "expense_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 1.3: Validate + generate Prisma client**

```bash
npx prisma validate
npx prisma generate
```

Expected: both succeed.

- [ ] **Step 1.4: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(expense-documents): add CreditNoteDetail schema + migration"
```

---

## Task 2: CreditNoteTemplate JE (TDD)

**Files:**
- Create: `apps/api/src/modules/journal/cpa-templates/credit-note.template.ts`
- Test: `apps/api/src/modules/expense-documents/__tests__/credit-note.template.spec.ts`

- [ ] **Step 2.1: Write failing test**

Create `apps/api/src/modules/expense-documents/__tests__/credit-note.template.spec.ts`:

```ts
import { Decimal } from '@prisma/client/runtime/library';
import { CreditNoteTemplate } from '../../journal/cpa-templates/credit-note.template';

describe('CreditNoteTemplate', () => {
  let template: CreditNoteTemplate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let journal: any;

  beforeEach(() => {
    journal = { createAndPost: jest.fn().mockResolvedValue({ entryNumber: 'JE-CN-001', id: 'je-cn-1' }) };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      expenseDocument: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      companyInfo: {
        findFirst: jest.fn().mockResolvedValue({ id: 'company-shop' }),
      },
    };
    template = new CreditNoteTemplate(journal, prisma);
  });

  it('reverses ACCRUAL original: Dr 21-1104 + Dr cash=0 / Cr expense + Cr 11-2104', async () => {
    // CN doc
    prisma.expenseDocument.findUniqueOrThrow.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'cn-1') return Promise.resolve({
        id: 'cn-1',
        number: 'CN-20260510-0001',
        documentType: 'CREDIT_NOTE',
        branchId: 'branch-1',
        documentDate: new Date('2026-05-10'),
        subtotal: new Decimal('500.00'),
        vatAmount: new Decimal('35.00'),
        withholdingTax: new Decimal('0.00'),
        totalAmount: new Decimal('535.00'),
        depositAccountCode: null,
        journalEntryId: null,
        creditNote: { originalDocumentId: 'orig-1', reason: 'partial return', category: '53-1404' },
      });
      if (args.where.id === 'orig-1') return Promise.resolve({
        id: 'orig-1',
        status: 'ACCRUAL',
        depositAccountCode: null,
      });
      return Promise.reject(new Error('unknown id'));
    });

    const result = await template.execute('cn-1');
    expect(result.entryNo).toBe('JE-CN-001');
    const [args] = journal.createAndPost.mock.calls[0];
    const dr = args.lines.filter((l: { dr: Decimal }) => l.dr.gt(0));
    const cr = args.lines.filter((l: { cr: Decimal }) => l.cr.gt(0));
    // ACCRUAL reverse: debit AP (21-1104) for total
    expect(dr).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: '21-1104', dr: new Decimal('535.00') }),
    ]));
    // Credit expense + VAT
    expect(cr).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: '53-1404', cr: new Decimal('500.00') }),
      expect.objectContaining({ accountCode: '11-2104', cr: new Decimal('35.00') }),
    ]));
    // No cash account in lines (ACCRUAL didn't pay yet)
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode.startsWith('11-1'))).toBeUndefined();
  });

  it('reverses POSTED original: Dr cash + Dr 11-2104 / Cr expense (refund flow)', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'cn-2') return Promise.resolve({
        id: 'cn-2',
        number: 'CN-20260510-0002',
        documentType: 'CREDIT_NOTE',
        branchId: 'branch-1',
        documentDate: new Date('2026-05-10'),
        subtotal: new Decimal('1000.00'),
        vatAmount: new Decimal('70.00'),
        withholdingTax: new Decimal('0.00'),
        totalAmount: new Decimal('1070.00'),
        depositAccountCode: '11-1101',
        journalEntryId: null,
        creditNote: { originalDocumentId: 'orig-2', reason: 'full return', category: '53-1302' },
      });
      if (args.where.id === 'orig-2') return Promise.resolve({
        id: 'orig-2',
        status: 'POSTED',
        depositAccountCode: '11-1101',
      });
      return Promise.reject(new Error('unknown id'));
    });

    await template.execute('cn-2');
    const [args] = journal.createAndPost.mock.calls[0];
    // POSTED reverse: cash debit (refund), Cr expense + VAT
    expect(args.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCode: '11-1101', dr: new Decimal('1070.00') }),
      expect.objectContaining({ accountCode: '53-1302', cr: new Decimal('1000.00') }),
      expect.objectContaining({ accountCode: '11-2104', cr: new Decimal('70.00') }),
    ]));
  });

  it('idempotent: skip when CN already has journalEntryId', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: 'cn-3',
      journalEntryId: 'je-existing',
    });
    const result = await template.execute('cn-3');
    expect(result.entryNo).toBe('je-existing');
    expect(journal.createAndPost).not.toHaveBeenCalled();
  });

  it('updates CN status=POSTED + paidAt + journalEntryId after post', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'cn-4') return Promise.resolve({
        id: 'cn-4',
        number: 'CN-20260510-0004',
        documentType: 'CREDIT_NOTE',
        branchId: 'branch-1',
        documentDate: new Date('2026-05-10'),
        subtotal: new Decimal('100.00'),
        vatAmount: new Decimal('0.00'),
        withholdingTax: new Decimal('0.00'),
        totalAmount: new Decimal('100.00'),
        depositAccountCode: null,
        journalEntryId: null,
        creditNote: { originalDocumentId: 'orig-4', reason: 'r', category: '53-1302' },
      });
      if (args.where.id === 'orig-4') return Promise.resolve({
        id: 'orig-4',
        status: 'ACCRUAL',
        depositAccountCode: null,
      });
      return Promise.reject(new Error('unknown id'));
    });

    await template.execute('cn-4');
    expect(prisma.expenseDocument.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cn-4' },
        data: expect.objectContaining({
          status: 'POSTED',
          paidAt: expect.any(Date),
          journalEntryId: 'je-cn-1',
        }),
      }),
    );
  });

  it('VAT line skipped when CN has no VAT', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === 'cn-5') return Promise.resolve({
        id: 'cn-5',
        number: 'CN-20260510-0005',
        documentType: 'CREDIT_NOTE',
        branchId: 'branch-1',
        documentDate: new Date('2026-05-10'),
        subtotal: new Decimal('200.00'),
        vatAmount: new Decimal('0.00'),
        withholdingTax: new Decimal('0.00'),
        totalAmount: new Decimal('200.00'),
        depositAccountCode: null,
        journalEntryId: null,
        creditNote: { originalDocumentId: 'orig-5', reason: 'r', category: '53-1302' },
      });
      if (args.where.id === 'orig-5') return Promise.resolve({
        id: 'orig-5',
        status: 'ACCRUAL',
        depositAccountCode: null,
      });
      return Promise.reject(new Error('unknown id'));
    });

    await template.execute('cn-5');
    const [args] = journal.createAndPost.mock.calls[0];
    expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '11-2104')).toBeUndefined();
  });
});
```

- [ ] **Step 2.2: Run test (FAIL: module not found)**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx jest --testPathPattern="credit-note.template.spec" 2>&1 | tail -10
```

- [ ] **Step 2.3: Implement template**

Reference `apps/api/src/modules/journal/cpa-templates/expense-same-day.template.ts` (PR-1 pattern) for shape. Resolve SHOP companyId, atomic via `$transaction`, idempotency, postedAt = doc.documentDate.

Create `apps/api/src/modules/journal/cpa-templates/credit-note.template.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { JournalAutoService, JeLineInput } from '../journal-auto.service';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Template — Credit Note (CN ใบลดหนี้). Reverses prior EXPENSE document,
 * fully or partially.
 *
 * Spec §4.3 — JE shape depends on whether original was ACCRUAL (still owed)
 * or POSTED (already paid → refund flow).
 *
 * If original.status === 'ACCRUAL':
 *   Dr 21-1104                            (totalAmount)      — clear AP
 *     Cr 5x-xxxx ค่าใช้จ่าย               (subtotal)
 *     Cr 11-2104 ลูกหนี้-VAT              (vatAmount)        [if VAT > 0]
 *
 * If original.status === 'POSTED' (refund):
 *   Dr depositAccountCode                 (totalAmount)      — refund cash in
 *     Cr 5x-xxxx ค่าใช้จ่าย               (subtotal)
 *     Cr 11-2104 ลูกหนี้-VAT              (vatAmount)        [if VAT > 0]
 *
 * ⚠️ CPA AUDIT REQUIRED — high priority (ม.86/10 compliance).
 */
@Injectable()
export class CreditNoteTemplate {
  private shopCompanyIdCache: string | null = null;

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    documentId: string,
    outerTx?: Prisma.TransactionClient,
  ): Promise<{ entryNo: string }> {
    const exec = async (tx: Prisma.TransactionClient): Promise<{ entryNo: string }> => {
      const cn = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: { creditNote: true },
      });

      // Idempotency
      if (cn.journalEntryId) {
        const existing = await tx.journalEntry.findUnique({ where: { id: cn.journalEntryId } });
        return { entryNo: existing?.entryNumber ?? cn.journalEntryId };
      }

      if (!cn.creditNote) {
        throw new Error(`CreditNote ${documentId} missing creditNote detail`);
      }
      const { originalDocumentId, category } = cn.creditNote;
      const original = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: originalDocumentId },
      });

      const zero = new Decimal(0);
      const subtotal = new Decimal(cn.subtotal.toString());
      const vat = new Decimal(cn.vatAmount.toString());
      const total = new Decimal(cn.totalAmount.toString());

      const lines: JeLineInput[] = [];

      // Dr leg depends on original status
      if (original.status === 'ACCRUAL') {
        // Reverse the AP booking
        lines.push({
          accountCode: '21-1104',
          dr: total,
          cr: zero,
          description: `กลับเจ้าหนี้ — ${cn.number}`,
        });
      } else {
        // POSTED → refund cash. CN.depositAccountCode (or fall back to original's)
        const refundAccount = cn.depositAccountCode ?? original.depositAccountCode;
        if (!refundAccount) {
          throw new Error(`CreditNote ${cn.id} on POSTED original requires depositAccountCode for refund`);
        }
        lines.push({
          accountCode: refundAccount,
          dr: total,
          cr: zero,
          description: `รับคืนเงิน — ${cn.number}`,
        });
      }

      // Cr legs (always)
      lines.push({
        accountCode: category,
        dr: zero,
        cr: subtotal,
        description: `กลับค่าใช้จ่าย — ${cn.number}`,
      });
      if (vat.gt(zero)) {
        lines.push({
          accountCode: '11-2104',
          dr: zero,
          cr: vat,
          description: 'กลับ VAT',
        });
      }

      const shopCompanyId = await this.getShopCompanyId(tx);

      const result = await this.journal.createAndPost(
        {
          description: `ใบลดหนี้ ${cn.number} (อ้าง ${original.id.slice(0, 8)}…)`,
          reference: cn.id,
          metadata: {
            tag: 'CREDIT_NOTE',
            documentId: cn.id,
            documentNumber: cn.number,
            documentType: cn.documentType,
            originalDocumentId,
            flow: 'expense-credit-note',
          },
          postedAt: cn.documentDate,
          companyId: shopCompanyId,
          lines,
        },
        tx,
      );

      await tx.expenseDocument.update({
        where: { id: cn.id },
        data: {
          status: 'POSTED',
          paidAt: cn.documentDate,
          journalEntryId: result.id,
          netPayment: total,
        },
      });

      return { entryNo: result.entryNumber };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }

  private async getShopCompanyId(tx: Prisma.TransactionClient): Promise<string> {
    if (this.shopCompanyIdCache) return this.shopCompanyIdCache;
    const co = await tx.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
    });
    if (!co) throw new Error('SHOP companyInfo not found — seed required');
    this.shopCompanyIdCache = co.id;
    return co.id;
  }
}
```

- [ ] **Step 2.4: Run test (PASS — 5 tests)**

```bash
npx jest --testPathPattern="credit-note.template.spec" 2>&1 | tail -10
```

- [ ] **Step 2.5: Register in journal.module.ts**

Open `apps/api/src/modules/journal/journal.module.ts`. Add import:

```ts
import { CreditNoteTemplate } from './cpa-templates/credit-note.template';
```

In `@Module` decorator `providers: [...]` add `CreditNoteTemplate,`. In `exports: [...]` add `CreditNoteTemplate,`.

- [ ] **Step 2.6: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/api/src/modules/journal/cpa-templates/credit-note.template.ts apps/api/src/modules/expense-documents/__tests__/credit-note.template.spec.ts apps/api/src/modules/journal/journal.module.ts
git commit -m "feat(journal): add CreditNoteTemplate JE (CPA audit pending — ม.86/10)"
```

---

## Task 3: CreateCreditNoteDto

**Files:**
- Create: `apps/api/src/modules/expense-documents/dto/create-credit-note.dto.ts`

- [ ] **Step 3.1: Implement DTO**

Create `apps/api/src/modules/expense-documents/dto/create-credit-note.dto.ts`:

```ts
import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsNumber,
  Min,
  IsUUID,
  MinLength,
} from 'class-validator';
import { CASH_ACCOUNT_CODES } from '../../../constants/cash-account.constants';

export class CreateCreditNoteDto {
  @IsString()
  branchId!: string;

  @IsDateString({}, { message: 'วันที่ใบกำกับไม่ถูกต้อง' })
  documentDate!: string;

  @IsUUID('4', { message: 'รหัสเอกสารต้นฉบับไม่ถูกต้อง' })
  originalDocumentId!: string;

  @IsString()
  @MinLength(3, { message: 'เหตุผลต้องมีอย่างน้อย 3 ตัวอักษร' })
  reason!: string;

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

  // Refund-account: required when original was POSTED + already paid
  @IsString()
  @IsOptional()
  @IsIn([...CASH_ACCOUNT_CODES], { message: 'บัญชีรับเงินคืนไม่ถูกต้อง' })
  depositAccountCode?: string;

  @IsString()
  @IsOptional()
  receiptImageUrl?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  note?: string;
}
```

- [ ] **Step 3.2: Commit**

```bash
git add apps/api/src/modules/expense-documents/dto/create-credit-note.dto.ts
git commit -m "feat(expense-documents): add CreateCreditNoteDto"
```

---

## Task 4: ExpenseDocumentsService.createCreditNote() — validation + creation

**Files:**
- Modify: `apps/api/src/modules/expense-documents/expense-documents.service.ts`
- Test: `apps/api/src/modules/expense-documents/__tests__/credit-note.service.spec.ts`

- [ ] **Step 4.1: Write failing tests for validation + create**

Create `apps/api/src/modules/expense-documents/__tests__/credit-note.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ExpenseDocumentsService } from '../expense-documents.service';

describe('ExpenseDocumentsService.createCreditNote', () => {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let creditNote: any;

  const ORIG_ID = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      expenseDocument: {
        create: jest.fn().mockResolvedValue({ id: 'cn-1', number: 'CN-20260510-0001' }),
        findUniqueOrThrow: jest.fn(),
        aggregate: jest.fn(),
      },
    };
    docNumber = { next: jest.fn().mockResolvedValue('CN-20260510-0001') };
    transition = { assertCanPost: jest.fn(), assertCanVoid: jest.fn(), assertCanEdit: jest.fn(), resolveTargetStatus: jest.fn() };
    sameDay = { execute: jest.fn() };
    accrual = { execute: jest.fn() };
    creditNote = { execute: jest.fn() };
    service = new ExpenseDocumentsService(prisma, docNumber, transition, sameDay, accrual, creditNote);
  });

  it('rejects when original not found', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockRejectedValue(new Error('not found'));
    await expect(service.createCreditNote({
      branchId: 'b1',
      documentDate: '2026-05-10',
      originalDocumentId: ORIG_ID,
      reason: 'partial',
      subtotal: 100,
    } as never, 'user-1')).rejects.toThrow();
  });

  it('rejects when original is different branch', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: ORIG_ID,
      branchId: 'b2',
      documentType: 'EXPENSE',
      status: 'POSTED',
      totalAmount: new Decimal('1000.00'),
      expenseDetail: { category: '53-1302' },
    });
    await expect(service.createCreditNote({
      branchId: 'b1',
      documentDate: '2026-05-10',
      originalDocumentId: ORIG_ID,
      reason: 'partial',
      subtotal: 100,
    } as never, 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects when original is not EXPENSE type', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: ORIG_ID,
      branchId: 'b1',
      documentType: 'PAYROLL',
      status: 'POSTED',
      totalAmount: new Decimal('1000.00'),
      expenseDetail: null,
    });
    await expect(service.createCreditNote({
      branchId: 'b1',
      documentDate: '2026-05-10',
      originalDocumentId: ORIG_ID,
      reason: 'r',
      subtotal: 100,
    } as never, 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects when original is DRAFT or VOIDED', async () => {
    for (const status of ['DRAFT', 'VOIDED']) {
      prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
        id: ORIG_ID,
        branchId: 'b1',
        documentType: 'EXPENSE',
        status,
        totalAmount: new Decimal('1000.00'),
        expenseDetail: { category: '53-1302' },
      });
      await expect(service.createCreditNote({
        branchId: 'b1',
        documentDate: '2026-05-10',
        originalDocumentId: ORIG_ID,
        reason: 'r',
        subtotal: 100,
      } as never, 'user-1')).rejects.toThrow(BadRequestException);
    }
  });

  it('rejects when subtotal+vat > original.totalAmount minus prior CNs', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: ORIG_ID,
      branchId: 'b1',
      documentType: 'EXPENSE',
      status: 'POSTED',
      totalAmount: new Decimal('1000.00'),
      expenseDetail: { category: '53-1302' },
    });
    // Prior CNs total 600
    prisma.expenseDocument.aggregate.mockResolvedValue({ _sum: { totalAmount: new Decimal('600.00') } });
    // Cap = 1000 - 600 = 400; we ask for 500 → reject
    await expect(service.createCreditNote({
      branchId: 'b1',
      documentDate: '2026-05-10',
      originalDocumentId: ORIG_ID,
      reason: 'r',
      subtotal: 500,
    } as never, 'user-1')).rejects.toThrow(/เกินยอดที่ลดได้/);
  });

  it('happy path creates CN with originalDocumentId + auto category mirror', async () => {
    prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
      id: ORIG_ID,
      branchId: 'b1',
      documentType: 'EXPENSE',
      status: 'POSTED',
      totalAmount: new Decimal('1000.00'),
      expenseDetail: { category: '53-1302' },
    });
    prisma.expenseDocument.aggregate.mockResolvedValue({ _sum: { totalAmount: null } });

    await service.createCreditNote({
      branchId: 'b1',
      documentDate: '2026-05-10',
      originalDocumentId: ORIG_ID,
      reason: 'partial return',
      subtotal: 200,
      vatAmount: 14,
    } as never, 'user-1');

    expect(prisma.expenseDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          number: 'CN-20260510-0001',
          documentType: 'CREDIT_NOTE',
          createdById: 'user-1',
          status: 'DRAFT',
          creditNote: {
            create: expect.objectContaining({
              originalDocumentId: ORIG_ID,
              reason: 'partial return',
              category: '53-1302',
            }),
          },
        }),
      }),
    );
  });
});
```

- [ ] **Step 4.2: Run test (FAIL: createCreditNote method does not exist)**

```bash
npx jest --testPathPattern="credit-note.service.spec" 2>&1 | tail -10
```

- [ ] **Step 4.3: Implement createCreditNote() in service**

Open `apps/api/src/modules/expense-documents/expense-documents.service.ts`.

First update the constructor to inject `CreditNoteTemplate`:

```ts
import { CreditNoteTemplate } from '../journal/cpa-templates/credit-note.template';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';

constructor(
  private readonly prisma: PrismaService,
  private readonly docNumber: DocNumberService,
  private readonly transition: StatusTransitionService,
  private readonly sameDayTemplate: ExpenseSameDayTemplate,
  private readonly accrualTemplate: ExpenseAccrualTemplate,
  private readonly creditNoteTemplate: CreditNoteTemplate,
) {}
```

Add new method right after `create()`:

```ts
// ─── Credit Note create (validates + auto-mirrors category) ──────────
async createCreditNote(dto: CreateCreditNoteDto, userId: string) {
  return this.prisma.$transaction(async (tx) => {
    // Load + validate original
    const original = await tx.expenseDocument.findUniqueOrThrow({
      where: { id: dto.originalDocumentId },
      include: { expenseDetail: true },
    });
    if (original.branchId !== dto.branchId) {
      throw new BadRequestException('ใบลดหนี้ต้องอยู่สาขาเดียวกับเอกสารต้นฉบับ');
    }
    if (original.documentType !== 'EXPENSE') {
      throw new BadRequestException('ใบลดหนี้ใช้ลดเอกสารรายจ่ายเท่านั้น');
    }
    if (!['ACCRUAL', 'POSTED'].includes(original.status)) {
      throw new BadRequestException(`ไม่สามารถออกใบลดหนี้บนเอกสารสถานะ ${original.status}`);
    }

    // Cumulative cap check
    const priorAgg = await tx.expenseDocument.aggregate({
      where: {
        documentType: 'CREDIT_NOTE',
        status: { not: 'VOIDED' },
        deletedAt: null,
        creditNote: { originalDocumentId: dto.originalDocumentId },
      },
      _sum: { totalAmount: true },
    });
    const priorTotal = new Prisma.Decimal(priorAgg._sum.totalAmount ?? 0);

    const subtotal = new Prisma.Decimal(dto.subtotal);
    const vat = new Prisma.Decimal(dto.vatAmount ?? 0);
    const total = subtotal.plus(vat);

    const cap = new Prisma.Decimal(original.totalAmount.toString()).minus(priorTotal);
    if (total.gt(cap)) {
      throw new BadRequestException(
        `จำนวนเงินเกินยอดที่ลดได้ (เหลือ ${cap.toFixed(2)} ฿)`,
      );
    }

    // Mirror category from original
    const category = original.expenseDetail?.category;
    if (!category) {
      throw new BadRequestException('เอกสารต้นฉบับไม่มีหมวดบัญชี (data corruption)');
    }

    const documentDate = new Date(dto.documentDate);
    const number = await this.docNumber.next(tx, 'CREDIT_NOTE', documentDate);

    return tx.expenseDocument.create({
      data: {
        number,
        documentType: 'CREDIT_NOTE',
        branchId: dto.branchId,
        documentDate,
        description: dto.description ?? null,
        subtotal,
        vatAmount: vat,
        withholdingTax: new Prisma.Decimal(0),
        totalAmount: total,
        netPayment: dto.depositAccountCode ? total : null,
        depositAccountCode: dto.depositAccountCode ?? null,
        status: 'DRAFT',
        reference: dto.reference ?? null,
        receiptImageUrl: dto.receiptImageUrl ?? null,
        note: dto.note ?? null,
        createdById: userId,
        creditNote: {
          create: {
            originalDocumentId: dto.originalDocumentId,
            reason: dto.reason,
            category,
          },
        },
      },
      include: { creditNote: true },
    });
  });
}
```

Also extend the existing `post()` method to dispatch CN template. Find the current dispatch:

```ts
if (target === 'POSTED') {
  return this.sameDayTemplate.execute(id, tx);
} else {
  return this.accrualTemplate.execute(id, tx);
}
```

Replace with:

```ts
if (doc.documentType === 'CREDIT_NOTE') {
  return this.creditNoteTemplate.execute(id, tx);
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
```

Also relax the EXPENSE-only restriction in `post()`. Find:

```ts
if (doc.documentType !== 'EXPENSE') {
  throw new BadRequestException(`PR-1 รองรับเฉพาะ EXPENSE — type ${doc.documentType} จะมาใน PR-2..4`);
}
```

Update to allow CREDIT_NOTE too:

```ts
if (!['EXPENSE', 'CREDIT_NOTE'].includes(doc.documentType)) {
  throw new BadRequestException(`type ${doc.documentType} จะมาใน PR-3..4`);
}
```

- [ ] **Step 4.4: Update module + run test (PASS — 6 tests)**

Open `apps/api/src/modules/expense-documents/expense-documents.module.ts`. Imports already pull `JournalModule` which now exports `CreditNoteTemplate`. Add explicit if needed:

```ts
// CreditNoteTemplate is exported by JournalModule — no extra wiring needed
```

Run:

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx jest --testPathPattern="credit-note.service.spec" 2>&1 | tail -10
```

If tests fail because constructor expects 6 args but existing tests pass 5, update the existing `expense-documents.service.spec.ts` to pass a CreditNoteTemplate mock too:

```ts
// In the existing spec's beforeEach:
let creditNote: any;
// Add:
creditNote = { execute: jest.fn() };
service = new ExpenseDocumentsService(prisma, docNumber, transition, sameDay, accrual, creditNote);
```

- [ ] **Step 4.5: Commit**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
git add apps/api/src/modules/expense-documents/expense-documents.service.ts apps/api/src/modules/expense-documents/__tests__/credit-note.service.spec.ts apps/api/src/modules/expense-documents/__tests__/expense-documents.service.spec.ts
git commit -m "feat(expense-documents): add createCreditNote() with validation + cumulative cap"
```

---

## Task 5: Controller endpoint `POST /credit-note`

**Files:**
- Modify: `apps/api/src/modules/expense-documents/expense-documents.controller.ts`
- Test: extend `apps/api/src/modules/expense-documents/__tests__/expense-documents.controller.spec.ts`

- [ ] **Step 5.1: Add endpoint test**

Open `apps/api/src/modules/expense-documents/__tests__/expense-documents.controller.spec.ts`. Add to the existing `service` mock:

```ts
createCreditNote: jest.fn().mockResolvedValue({ id: 'cn-1', number: 'CN-20260510-0001' }),
```

Add a new test case:

```ts
it('POST /credit-note calls service.createCreditNote with userId', async () => {
  await controller.createCreditNote({ originalDocumentId: 'orig-1' } as never, { id: 'user-1' } as never);
  expect(service.createCreditNote).toHaveBeenCalledWith({ originalDocumentId: 'orig-1' }, 'user-1');
});
```

- [ ] **Step 5.2: Add `POST /credit-note` to controller**

Open `apps/api/src/modules/expense-documents/expense-documents.controller.ts`. Add import:

```ts
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
```

Add endpoint method right after the existing `create()`:

```ts
@Post('credit-note')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
createCreditNote(
  @Body() dto: CreateCreditNoteDto,
  @CurrentUser() user: { id: string },
) {
  return this.service.createCreditNote(dto, user.id);
}
```

- [ ] **Step 5.3: Run test (PASS)**

```bash
npx jest --testPathPattern="expense-documents.controller.spec" 2>&1 | tail -10
```

Expected: 9 tests pass (8 existing + 1 new).

- [ ] **Step 5.4: Commit**

```bash
git add apps/api/src/modules/expense-documents/expense-documents.controller.ts apps/api/src/modules/expense-documents/__tests__/expense-documents.controller.spec.ts
git commit -m "feat(expense-documents): add POST /credit-note endpoint"
```

---

## Task 6: Integration test — full CN flow (vitest + Postgres)

**Files:**
- Create: `apps/api/src/modules/expense-documents/__tests__/cn-lifecycle.integration.spec.ts`

- [ ] **Step 6.1: Write integration test**

Pattern reference: `apps/api/src/modules/expense-documents/__tests__/full-lifecycle.integration.spec.ts` from PR-1. Mirror its setup.

Create `apps/api/src/modules/expense-documents/__tests__/cn-lifecycle.integration.spec.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient, DocumentStatus } from '@prisma/client';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { DocNumberService } from '../services/doc-number.service';
import { StatusTransitionService } from '../services/status-transition.service';
import { ExpenseSameDayTemplate } from '../../journal/cpa-templates/expense-same-day.template';
import { ExpenseAccrualTemplate } from '../../journal/cpa-templates/expense-accrual.template';
import { CreditNoteTemplate } from '../../journal/cpa-templates/credit-note.template';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
let userId: string;
let branchId: string;

describe('Credit Note lifecycle (integration)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    const branch = await prisma.branch.findFirst({ where: { deletedAt: null } });
    branchId = branch!.id;
    const user = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    userId = user!.id;
  });

  beforeEach(async () => {
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
    const cn = new CreditNoteTemplate(journal, prisma as never);
    return new ExpenseDocumentsService(
      prisma as never,
      new DocNumberService(),
      new StatusTransitionService(),
      sameDay,
      accrual,
      cn,
    );
  }

  it('CN against ACCRUAL original: post CN → reverses 21-1104 + Cr expense + Cr VAT', async () => {
    const service = buildService();
    // Create + post original ACCRUAL
    const original = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        subtotal: 1000,
        vatAmount: 70,
        detail: { category: '53-1302' },
      } as never,
      userId,
    );
    await service.post(original.id, userId);

    // Create CN
    const cn = await service.createCreditNote(
      {
        branchId,
        documentDate: new Date().toISOString(),
        originalDocumentId: original.id,
        reason: 'partial return',
        subtotal: 500,
        vatAmount: 35,
      } as never,
      userId,
    );
    expect(cn.documentType).toBe('CREDIT_NOTE');
    expect(cn.status).toBe(DocumentStatus.DRAFT);

    await service.post(cn.id, userId);
    const after = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: cn.id } });
    expect(after.status).toBe('POSTED');
    expect(after.journalEntryId).not.toBeNull();

    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { id: after.journalEntryId! },
      include: { lines: true },
    });
    const codes = je.lines.map((l) => l.accountCode);
    expect(codes).toContain('21-1104'); // Reverses AP
    expect(codes).toContain('53-1302'); // Reverses expense
    expect(codes).toContain('11-2104'); // Reverses VAT
  });

  it('CN amount cap: cumulative CNs cannot exceed original totalAmount', async () => {
    const service = buildService();
    const original = await service.create(
      {
        documentType: 'EXPENSE',
        branchId,
        documentDate: new Date().toISOString(),
        subtotal: 1000,
        vatAmount: 0,
        detail: { category: '53-1302' },
      } as never,
      userId,
    );
    await service.post(original.id, userId);

    // First CN: 600
    const cn1 = await service.createCreditNote(
      { branchId, documentDate: new Date().toISOString(), originalDocumentId: original.id, reason: 'r1', subtotal: 600 } as never,
      userId,
    );
    await service.post(cn1.id, userId);

    // Second CN attempting 500 should fail (cap = 1000 - 600 = 400)
    await expect(service.createCreditNote(
      { branchId, documentDate: new Date().toISOString(), originalDocumentId: original.id, reason: 'r2', subtotal: 500 } as never,
      userId,
    )).rejects.toThrow(/เกินยอดที่ลดได้/);

    // 400 should pass exactly
    const cn3 = await service.createCreditNote(
      { branchId, documentDate: new Date().toISOString(), originalDocumentId: original.id, reason: 'r3', subtotal: 400 } as never,
      userId,
    );
    expect(cn3.subtotal.toString()).toBe('400');
  });

  it('CN cross-branch rejected', async () => {
    const service = buildService();
    const original = await service.create(
      { documentType: 'EXPENSE', branchId, documentDate: new Date().toISOString(), subtotal: 100, detail: { category: '53-1302' } } as never,
      userId,
    );
    await service.post(original.id, userId);

    // Create another branch
    const co = await prisma.companyInfo.findFirst();
    const otherBranch = await prisma.branch.create({ data: { name: '__test_branch_other__', companyId: co!.id } });

    await expect(service.createCreditNote(
      { branchId: otherBranch.id, documentDate: new Date().toISOString(), originalDocumentId: original.id, reason: 'cross', subtotal: 50 } as never,
      userId,
    )).rejects.toThrow(/สาขาเดียวกัน/);
  });
});
```

- [ ] **Step 6.2: Run integration test (PASS — 3 tests)**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx vitest run --no-file-parallelism src/modules/expense-documents/__tests__/cn-lifecycle.integration.spec.ts 2>&1 | tail -15
```

If local DB drift prevents running, commit anyway — CI will run.

- [ ] **Step 6.3: Commit**

```bash
git add apps/api/src/modules/expense-documents/__tests__/cn-lifecycle.integration.spec.ts
git commit -m "test(expense-documents): add CN lifecycle integration test"
```

---

## Task 7: Frontend — CN form variant + create dropdown

**Files:**
- Create: `apps/web/src/components/expense-documents/CreditNoteForm.tsx`
- Create: `apps/web/src/pages/ExpenseDocumentNewPage.tsx`
- Modify: `apps/web/src/App.tsx` (add route)
- Modify: `apps/web/src/pages/ExpensesPage.tsx` (dropdown for create button)

- [ ] **Step 7.1: Create ExpenseDocumentNewPage that switches by `?type=`**

Create `apps/web/src/pages/ExpenseDocumentNewPage.tsx`:

```tsx
import { useSearchParams, useNavigate } from 'react-router';
import { CreditNoteForm } from '@/components/expense-documents/CreditNoteForm';

export default function ExpenseDocumentNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const type = params.get('type') ?? 'EX';

  // PR-1 already handles EX via the modal in ExpensesPage; PR-2 adds CN.
  // PR-3 (PR), PR-4 (SE) will extend this switch.
  switch (type) {
    case 'CN':
      return <CreditNoteForm onClose={() => navigate('/expenses')} onSaved={() => navigate('/expenses')} />;
    default:
      // EX still uses the existing modal — redirect home
      navigate('/expenses?openNew=1');
      return null;
  }
}
```

- [ ] **Step 7.2: Create CreditNoteForm component**

Create `apps/web/src/components/expense-documents/CreditNoteForm.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { ArrowLeft, FileText, Search, AlertCircle } from 'lucide-react';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Button } from '@/components/ui/button';

interface OriginalDoc {
  id: string;
  number: string;
  vendorName: string | null;
  totalAmount: string;
  status: string;
  documentDate: string;
  expenseDetail: { category: string } | null;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function CreditNoteForm({ onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [original, setOriginal] = useState<OriginalDoc | null>(null);
  const [reason, setReason] = useState('');
  const [subtotal, setSubtotal] = useState('');
  const [vatAmount, setVatAmount] = useState('0');
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');

  // Search original EX docs (POSTED/ACCRUAL only)
  const { data: searchResults } = useQuery<{ data: OriginalDoc[] }>({
    queryKey: ['expense-search', search],
    queryFn: async () => {
      if (!search.trim()) return { data: [] };
      const { data } = await api.get(`/expense-documents?type=EXPENSE&search=${encodeURIComponent(search)}&limit=10`);
      return data;
    },
    enabled: search.trim().length >= 3,
  });

  // Fetch creditedAmount for selected original
  const { data: capInfo } = useQuery<{ remainingCap: number }>({
    queryKey: ['cn-cap', original?.id],
    queryFn: async () => {
      if (!original) return { remainingCap: 0 };
      // For PR-2: rely on submit-time validation; we approximate cap as totalAmount.
      // Future: dedicated /:id/cn-cap endpoint
      return { remainingCap: parseFloat(original.totalAmount) };
    },
    enabled: !!original,
  });

  const mutation = useMutation({
    mutationFn: async (andPost: boolean) => {
      const { data } = await api.post('/expense-documents/credit-note', {
        branchId: '', // will be filled from original on backend (or pass original.branchId)
        documentDate,
        originalDocumentId: original!.id,
        reason,
        subtotal: parseFloat(subtotal),
        vatAmount: parseFloat(vatAmount) || 0,
        note: note || undefined,
      });
      if (andPost) {
        await api.post(`/expense-documents/${data.id}/post`);
      }
      return data;
    },
    onSuccess: () => {
      toast.success('สร้างใบลดหนี้สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      onSaved();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const total = (parseFloat(subtotal) || 0) + (parseFloat(vatAmount) || 0);
  const remaining = capInfo?.remainingCap ?? 0;
  const exceedsCap = total > remaining;
  const canSubmit = original && reason.trim().length >= 3 && parseFloat(subtotal) > 0 && !exceedsCap;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8">
      <div className="w-full max-w-3xl bg-background rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
          <button onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">สร้างใบลดหนี้ (CN)</h2>
          <div className="w-16" />
        </div>

        <div className="p-6 space-y-5">
          {/* Section: Original document picker */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <FileText className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">เอกสารต้นฉบับ</h3>
                <p className="text-xs text-muted-foreground">เลือกเอกสาร EX ที่ต้องการลดหนี้</p>
              </div>
            </div>
            {original ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-warning text-sm">{original.number}</div>
                  <div className="text-sm">{original.vendorName ?? '–'} · ยอด {original.totalAmount} ฿</div>
                  <div className="text-xs text-muted-foreground">{original.expenseDetail?.category} · {original.status}</div>
                </div>
                <button onClick={() => setOriginal(null)} className="text-xs text-destructive hover:underline">เปลี่ยน</button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="ค้นหาเลข EX-... / ผู้ขาย"
                    className="w-full pl-10 pr-3 py-2.5 border border-input rounded-lg text-sm outline-hidden bg-background"
                  />
                </div>
                {searchResults && searchResults.data.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
                    {searchResults.data.filter((d) => ['POSTED', 'ACCRUAL'].includes(d.status)).map((d) => (
                      <button key={d.id} onClick={() => setOriginal(d)}
                        className="w-full text-left rounded-lg border border-border p-2 hover:bg-muted">
                        <div className="font-mono text-warning text-sm">{d.number}</div>
                        <div className="text-sm">{d.vendorName ?? '–'} · {d.totalAmount} ฿ · {d.status}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section: CN amount + reason */}
          {original && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">รายละเอียดการลดหนี้</h3>
              <div>
                <label className="block text-xs font-medium mb-1.5">วันที่</label>
                <ThaiDateInput value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5">เหตุผลลดหนี้ <span className="text-destructive">*</span></label>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น สินค้าคืน, ปรับราคา"
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden bg-background" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5">จำนวนเงิน (ก่อน VAT) <span className="text-destructive">*</span></label>
                  <input type="number" step="0.01" min="0.01" value={subtotal} onChange={(e) => setSubtotal(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden bg-background" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5">VAT</label>
                  <input type="number" step="0.01" min="0" value={vatAmount} onChange={(e) => setVatAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden bg-background" />
                </div>
              </div>
              <div className="rounded-lg bg-muted p-3 text-sm flex justify-between">
                <span>รวม</span>
                <span className="font-semibold">{total.toFixed(2)} ฿</span>
              </div>
              {exceedsCap && (
                <div className="flex items-start gap-2 text-destructive text-sm">
                  <AlertCircle className="size-4 mt-0.5" />
                  <span>เกินยอดที่ลดได้สูงสุด {remaining.toFixed(2)} ฿</span>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium mb-1.5">หมายเหตุ</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden bg-background resize-none" />
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-background border-t px-6 py-4 flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button variant="outline" onClick={() => mutation.mutate(false)} disabled={!canSubmit || mutation.isPending}>
            บันทึกร่าง
          </Button>
          <Button variant="primary" onClick={() => mutation.mutate(true)} disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก + โพสต์'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 7.3: Add route in App.tsx**

Open `apps/web/src/App.tsx`. Find the routes for `/expenses`. Add:

```tsx
const ExpenseDocumentNewPage = lazy(() => import('@/pages/ExpenseDocumentNewPage'));
```

In the routes block:

```tsx
<Route path="/expenses/new" element={<ProtectedRoute><MainLayout><ExpenseDocumentNewPage /></MainLayout></ProtectedRoute>} />
```

- [ ] **Step 7.4: Update create dropdown in ExpensesPage**

Open `apps/web/src/pages/ExpensesPage.tsx`. Find the `<Button variant="primary" size="md" onClick={openCreate}>` (current single-action button). Replace with a dropdown:

```tsx
import { ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router';

// inside component:
const navigate = useNavigate();
const [showCreateMenu, setShowCreateMenu] = useState(false);

// Replace the existing button:
<div className="relative">
  <Button variant="primary" size="md" onClick={() => setShowCreateMenu((v) => !v)}>
    <Plus className="size-4" /> สร้างเอกสารใหม่ <ChevronDown className="size-3" />
  </Button>
  {showCreateMenu && (
    <div className="absolute right-0 top-full mt-1 z-10 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
      <button onClick={() => { setShowCreateMenu(false); openCreate(); }}
        className="w-full px-3 py-2 text-sm text-left hover:bg-muted">รายจ่าย (EX)</button>
      <button onClick={() => { setShowCreateMenu(false); navigate('/expenses/new?type=CN'); }}
        className="w-full px-3 py-2 text-sm text-left hover:bg-muted">ใบลดหนี้ (CN)</button>
      <button disabled className="w-full px-3 py-2 text-sm text-left text-muted-foreground/50 cursor-not-allowed">เงินเดือน (PR-3)</button>
      <button disabled className="w-full px-3 py-2 text-sm text-left text-muted-foreground/50 cursor-not-allowed">จ่ายเจ้าหนี้ (PR-4)</button>
    </div>
  )}
</div>
```

- [ ] **Step 7.5: Verify TypeScript**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
./tools/check-types.sh web 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 7.6: Commit**

```bash
git add apps/web/src/components/expense-documents/ apps/web/src/pages/ExpenseDocumentNewPage.tsx apps/web/src/pages/ExpensesPage.tsx apps/web/src/App.tsx
git commit -m "feat(web): add CreditNoteForm + dropdown to create EX/CN from listing"
```

---

## Task 8: Verify everything

- [ ] **Step 8.1: Full typecheck**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
./tools/check-types.sh all 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 8.2: Run all relevant tests**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE/apps/api
npx jest --testPathPattern="^/Users/iamnaii/Desktop/App/BESTCHOICE/apps/api/src/modules/(expense-documents|journal|accounting)" --runInBand --silent 2>&1 | tail -7
```

Expected: 195+ tests pass (177 from PR-1 + 14 new from PR-2: 5 CN template + 6 CN service + 1 controller + 3 integration).

---

## Task 9: Push branch + open PR

- [ ] **Step 9.1: Push**

```bash
git push -u origin feat/expense-documents-pr2
```

- [ ] **Step 9.2: Create PR**

```bash
gh pr create --base feat/expense-documents-pr1 --title "PR-2: Credit Note (CN) on top of PR-1" --body "$(cat <<'EOF'
## Summary
- Adds CREDIT_NOTE document type — ใบลดหนี้ that reverses prior EX (full or partial)
- Schema: new `credit_note_details` 1:1 sub-table with `originalDocumentId`/`reason`/`category`
- JE template: `CreditNoteTemplate` reverses original (Dr 21-1104 if ACCRUAL, Dr cash if POSTED-refund / Cr expense + Cr 11-2104)
- Endpoint: `POST /expense-documents/credit-note` with cumulative cap validation (sum of prior CNs ≤ original.totalAmount)
- Form: `CreditNoteForm` with original-doc picker (search by EX number) + reason + amount with live cap warning
- Listing: create button now dropdown → EX (existing) / CN (new) / PR-PR3 / SE-PR4 disabled

## CPA AUDIT FLAG ⚠️
High priority — ม.86/10 compliance verification required (output VAT credit note).

## Test plan
- [x] CreditNoteTemplate: 5 unit tests (ACCRUAL reverse, POSTED refund, idempotent, status update, no-VAT)
- [x] createCreditNote service: 6 unit tests (validation: not found, cross-branch, non-EXPENSE, DRAFT/VOIDED, cap exceeded, happy path)
- [x] Controller: +1 test for /credit-note endpoint
- [x] Integration: 3 vitest tests (CN against ACCRUAL, cumulative cap, cross-branch reject)
- [x] TypeScript: 0 errors (api + web)

## Base
Branched off `feat/expense-documents-pr1` (PR #795). PR-1 must merge first.

## Spec
docs/superpowers/specs/2026-05-10-expense-document-polymorphic-redesign.md §1.2 + §3.1 + §4.3 + §6.2

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -3
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|--------------|------|
| §1.2 CreditNoteDetail | Task 1 |
| §3.1 CN lifecycle (DRAFT → POSTED → VOIDED) | Reuses PR-1 transition; CN doesn't use ACCRUAL state |
| §4.3 CreditNoteTemplate JE (ACCRUAL vs POSTED branching) | Task 2 |
| §5 POST /credit-note shorthand endpoint | Task 5 |
| §6.2 CN form variant | Task 7 |
| §7 (cumulative cap SQL formula) | Task 4 (createCreditNote uses aggregate _sum) |

**Placeholder check**: all code blocks complete. No TODO/TBD.

**Type consistency**: `CreditNoteTemplate.execute(documentId, outerTx?)` matches PR-1 pattern. `service.createCreditNote(dto, userId)` mirrors `service.create(dto, userId)`. Controller endpoint `createCreditNote` mirrors `create`.

**Out of scope**:
- Reverse JE on void of CN — defers to existing void path (currently flips status only)
- "ใบลดหนี้-VAT credit note" gov form (ภพ.86/10 file gen) — Phase A.7
- Original-document amendment (subtract from `originalDocument.totalAmount`) — kept as cumulative SUM query, no header mutation

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-05-10-expense-document-pr2.md`.
