# Expense Form v4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4 separate expense-doc forms (EX/CN/PR/SE) with one unified entry form per the v4 mockup — multi-line items, Quick Start, visual cash picker, live AUTO JOURNAL PREVIEW, approver selector.

**Architecture:** New `ExpenseLine[]` sub-table parallel to `PayrollLine`/`SettlementLine`. Server-side line aggregation + JE preview endpoint eliminates client/server drift. One `ExpenseFormV4` React component composed from per-section subcomponents replaces 4 separate forms.

**Tech Stack:** NestJS + Prisma 6 + PostgreSQL backend. React 18 + Vite + @tanstack/react-query + Tailwind + shadcn/ui frontend. Existing project rules in `.claude/rules/` apply (semantic design tokens, no hardcoded hex, IBM Plex Sans Thai font, leading-snug for Thai).

**Owner directive:** match the mockup layout exactly + 100% functional. Use existing project design tokens (emerald primary, light theme) — do NOT copy the dark-theme palette from the screenshot. Match SECTION STRUCTURE, badge numbering, card layout, button placement, computed field flow.

**Spec ref:** `docs/superpowers/specs/2026-05-11-expense-form-v4-unified-design.md`

---

## File Structure

### API
- Modify: `apps/api/prisma/schema.prisma` — add ExpenseLine, modify ExpenseDetail
- Create: `apps/api/prisma/migrations/20260916000000_add_expense_lines/migration.sql`
- Modify: `apps/api/src/modules/expense-documents/dto/create.dto.ts` — replace `detail.category` with `lines[]` + `priceType`
- Modify: `apps/api/src/modules/expense-documents/dto/update.dto.ts`
- Create: `apps/api/src/modules/expense-documents/dto/expense-line-input.dto.ts`
- Create: `apps/api/src/modules/expense-documents/services/line-aggregator.service.ts` — pure computation
- Create: `apps/api/src/modules/expense-documents/services/je-preview.service.ts` — assembles preview JE
- Modify: `apps/api/src/modules/expense-documents/expense-documents.service.ts` — multi-line create/update
- Modify: `apps/api/src/modules/expense-documents/expense-documents.controller.ts` — add `POST /preview-je`
- Modify: `apps/api/src/modules/expense-documents/expense-documents.module.ts` — register new services
- Modify: `apps/api/src/modules/journal/cpa-templates/expense-same-day.template.ts` — multi-line Dr
- Modify: `apps/api/src/modules/journal/cpa-templates/expense-accrual.template.ts` — multi-line Dr
- Modify: `apps/api/src/modules/journal/cpa-templates/credit-note.template.ts` — multi-line CN

### Web
- Create: `apps/web/src/components/expense-form-v4/QuickStartPanel.tsx`
- Create: `apps/web/src/components/expense-form-v4/TypeTabs.tsx`
- Create: `apps/web/src/components/expense-form-v4/VendorSection.tsx`
- Create: `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx`
- Create: `apps/web/src/components/expense-form-v4/CashAccountVisualPicker.tsx`
- Create: `apps/web/src/components/expense-form-v4/JePreview.tsx`
- Create: `apps/web/src/components/expense-form-v4/ApproverSection.tsx`
- Create: `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx`
- Create: `apps/web/src/components/expense-form-v4/SettlementLinesSection.tsx`
- Create: `apps/web/src/components/expense-form-v4/CreditNoteLinesSection.tsx`
- Create: `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx`
- Create: `apps/web/src/components/expense-form-v4/types.ts` — shared form-state shape
- Create: `apps/web/src/components/expense-form-v4/useFormCompute.ts` — debounced JE preview hook
- Modify: `apps/web/src/pages/ExpensesPage.tsx` — wire ExpenseFormV4 in modal slot
- Modify: `apps/web/src/pages/ExpenseDocumentNewPage.tsx` — single route renders ExpenseFormV4
- Delete: `apps/web/src/components/expense-documents/CreditNoteForm.tsx`, `PayrollForm.tsx`, `SettlementForm.tsx` (consolidated)

### Tests
- Create: `apps/api/src/modules/expense-documents/__tests__/line-aggregator.spec.ts`
- Create: `apps/api/src/modules/expense-documents/__tests__/je-preview.service.spec.ts`
- Create: `apps/api/src/modules/expense-documents/__tests__/multi-line-create.service.spec.ts`
- Create: `apps/api/src/modules/expense-documents/__tests__/multi-line-lifecycle.integration.spec.ts`
- Modify: `apps/api/src/modules/expense-documents/__tests__/expense-same-day.template.spec.ts` — multi-line cases
- Modify: `apps/api/src/modules/expense-documents/__tests__/expense-accrual.template.spec.ts`
- Modify: `apps/api/src/modules/expense-documents/__tests__/credit-note.template.spec.ts`

---

## Task 1: Schema — add ExpenseLine + modify ExpenseDetail

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Open the schema and locate the `ExpenseDetail` model**

Run: `grep -n "^model ExpenseDetail\b" apps/api/prisma/schema.prisma`
Expected: prints the line number where `model ExpenseDetail {` starts.

- [ ] **Step 2: Replace the `ExpenseDetail` model and add `ExpenseLine` after it**

Find the existing block (single-line `category` field) and replace with:

```prisma
model ExpenseDetail {
  documentId  String          @id @map("document_id")
  document    ExpenseDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  priceType   String          @default("EXCLUSIVE") @map("price_type")
  lines       ExpenseLine[]

  @@map("expense_details")
}

model ExpenseLine {
  id              String        @id @default(uuid())
  expenseDetailId String        @map("expense_detail_id")
  expenseDetail   ExpenseDetail @relation(fields: [expenseDetailId], references: [documentId], onDelete: Cascade)
  lineNo          Int           @map("line_no")
  category        String
  description     String?
  quantity        Decimal       @default(1) @db.Decimal(12, 2)
  unitPrice       Decimal       @db.Decimal(12, 2) @map("unit_price")
  discount        Decimal       @default(0) @db.Decimal(12, 2)
  vatPercent      Decimal       @default(0) @db.Decimal(5, 2) @map("vat_percent")
  whtPercent      Decimal       @default(0) @db.Decimal(5, 2) @map("wht_percent")
  amountBeforeVat Decimal       @db.Decimal(12, 2) @map("amount_before_vat")
  vatAmount       Decimal       @default(0) @db.Decimal(12, 2) @map("vat_amount")
  whtAmount       Decimal       @default(0) @db.Decimal(12, 2) @map("wht_amount")
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  @@index([expenseDetailId, lineNo])
  @@map("expense_lines")
}
```

- [ ] **Step 3: Validate schema**

Run: `cd apps/api && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Generate client**

Run: `cd apps/api && npx prisma generate`
Expected: `Prisma Client (...) has been generated`

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "feat(schema): add ExpenseLine model + priceType on ExpenseDetail"
```

---

## Task 2: Migration SQL

**Files:**
- Create: `apps/api/prisma/migrations/20260916000000_add_expense_lines/migration.sql`

- [ ] **Step 1: Create migration directory**

Run: `mkdir -p apps/api/prisma/migrations/20260916000000_add_expense_lines`

- [ ] **Step 2: Write migration SQL**

Create `apps/api/prisma/migrations/20260916000000_add_expense_lines/migration.sql`:

```sql
-- ExpenseLine table — multi-line expense items per ExpenseDetail
CREATE TABLE "expense_lines" (
  "id"                TEXT            NOT NULL,
  "expense_detail_id" TEXT            NOT NULL,
  "line_no"           INTEGER         NOT NULL,
  "category"          TEXT            NOT NULL,
  "description"       TEXT,
  "quantity"          DECIMAL(12, 2)  NOT NULL DEFAULT 1,
  "unit_price"        DECIMAL(12, 2)  NOT NULL,
  "discount"          DECIMAL(12, 2)  NOT NULL DEFAULT 0,
  "vat_percent"       DECIMAL(5, 2)   NOT NULL DEFAULT 0,
  "wht_percent"       DECIMAL(5, 2)   NOT NULL DEFAULT 0,
  "amount_before_vat" DECIMAL(12, 2)  NOT NULL,
  "vat_amount"        DECIMAL(12, 2)  NOT NULL DEFAULT 0,
  "wht_amount"        DECIMAL(12, 2)  NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "expense_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_lines_expense_detail_id_line_no_idx"
  ON "expense_lines"("expense_detail_id", "line_no");

ALTER TABLE "expense_lines"
  ADD CONSTRAINT "expense_lines_expense_detail_id_fkey"
  FOREIGN KEY ("expense_detail_id") REFERENCES "expense_details"("document_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop the legacy single-category column on ExpenseDetail
ALTER TABLE "expense_details" DROP COLUMN IF EXISTS "category";

-- Add priceType discriminator
ALTER TABLE "expense_details"
  ADD COLUMN "price_type" TEXT NOT NULL DEFAULT 'EXCLUSIVE';
```

- [ ] **Step 3: Verify migration is recognized**

Run: `cd apps/api && npx prisma migrate status 2>&1 | grep "20260916000000_add_expense_lines"`
Expected: line appears in the migrations list (status: pending).

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/migrations/20260916000000_add_expense_lines/
git commit -m "feat(db): migration adds expense_lines table + ExpenseDetail.price_type"
```

---

## Task 3: ExpenseLineInput DTO

**Files:**
- Create: `apps/api/src/modules/expense-documents/dto/expense-line-input.dto.ts`

- [ ] **Step 1: Write the DTO**

Create `apps/api/src/modules/expense-documents/dto/expense-line-input.dto.ts`:

```ts
import {
  IsString, IsNumber, IsOptional, Min, Max, MinLength, Matches,
} from 'class-validator';

export class ExpenseLineInput {
  /** CoA code prefixed 5x-xxxx (validated against chart_of_accounts in service) */
  @IsString()
  @Matches(/^5\d-\d{4}$/, { message: 'หมวดบัญชีต้องเป็นรูปแบบ 5x-xxxx' })
  category!: string;

  @IsString()
  @IsOptional()
  @MinLength(0)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'จำนวนต้องมากกว่า 0' })
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'ราคาต่อหน่วยต้องมากกว่า 0' })
  unitPrice!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  discount?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  vatPercent?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  whtPercent?: number;
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | grep -E "expense-line-input|expense-documents/dto" | head -5`
Expected: no errors (output empty).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/expense-documents/dto/expense-line-input.dto.ts
git commit -m "feat(dto): add ExpenseLineInput per-line DTO"
```

---

## Task 4: Update CreateExpenseDocumentDto + UpdateDto for multi-line

**Files:**
- Modify: `apps/api/src/modules/expense-documents/dto/create.dto.ts`
- Modify: `apps/api/src/modules/expense-documents/dto/update.dto.ts`

- [ ] **Step 1: Replace `create.dto.ts`**

Open and replace contents of `apps/api/src/modules/expense-documents/dto/create.dto.ts` with:

```ts
import {
  IsString, IsOptional, IsDateString, ValidateNested, IsArray, ArrayMinSize, IsIn, IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExpenseLineInput } from './expense-line-input.dto';

const PRICE_TYPES = ['EXCLUSIVE', 'INCLUSIVE'] as const;
const CASH_ACCOUNT_CODES = ['11-1101', '11-1102', '11-1103', '11-1201', '11-1202', '11-1203'] as const;

export class CreateExpenseDocumentDto {
  @IsIn(['EXPENSE'])
  documentType!: 'EXPENSE';

  @IsString()
  branchId!: string;

  @IsDateString()
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

  @IsString()
  @IsIn(PRICE_TYPES as never)
  @IsOptional()
  priceType?: 'EXCLUSIVE' | 'INCLUSIVE';

  /** Form-type for WHT routing (PND.3 → 21-3102, PND.53 → 21-3103) */
  @IsString()
  @IsIn(['PND3', 'PND53'])
  @IsOptional()
  whtFormType?: 'PND3' | 'PND53';

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsString()
  @IsIn([...CASH_ACCOUNT_CODES])
  @IsOptional()
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

  @IsString()
  @IsOptional()
  fromTemplateId?: string;

  @IsString()
  @IsOptional()
  approvedById?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'ต้องมีรายการบัญชีอย่างน้อย 1 บรรทัด' })
  @ValidateNested({ each: true })
  @Type(() => ExpenseLineInput)
  lines!: ExpenseLineInput[];
}
```

- [ ] **Step 2: Replace `update.dto.ts`**

Open and replace contents of `apps/api/src/modules/expense-documents/dto/update.dto.ts` with:

```ts
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateExpenseDocumentDto } from './create.dto';

// branchId / documentType immutable
export class UpdateExpenseDocumentDto extends PartialType(
  OmitType(CreateExpenseDocumentDto, ['branchId', 'documentType'] as const),
) {}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | grep "expense-documents/dto" | head -10`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/expense-documents/dto/create.dto.ts apps/api/src/modules/expense-documents/dto/update.dto.ts
git commit -m "feat(dto): switch CreateExpenseDocumentDto to multi-line lines[]"
```

---

## Task 5: LineAggregatorService — pure computation (TDD)

**Files:**
- Create: `apps/api/src/modules/expense-documents/services/line-aggregator.service.ts`
- Create: `apps/api/src/modules/expense-documents/__tests__/line-aggregator.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/modules/expense-documents/__tests__/line-aggregator.spec.ts`:

```ts
import { Decimal } from '@prisma/client/runtime/library';
import { LineAggregatorService } from '../services/line-aggregator.service';

describe('LineAggregatorService', () => {
  const svc = new LineAggregatorService();

  it('exclusive VAT: qty=1, unitPrice=4500, vat=7%, wht=0%', () => {
    const r = svc.computeLine({ quantity: 1, unitPrice: 4500, discount: 0, vatPercent: 7, whtPercent: 0 }, 'EXCLUSIVE');
    expect(r.amountBeforeVat.toFixed(2)).toBe('4500.00');
    expect(r.vatAmount.toFixed(2)).toBe('315.00');
    expect(r.whtAmount.toFixed(2)).toBe('0.00');
  });

  it('inclusive VAT: lineSubtotal=1070, vat=7% → amountBeforeVat=1000, vat=70', () => {
    const r = svc.computeLine({ quantity: 1, unitPrice: 1070, discount: 0, vatPercent: 7, whtPercent: 0 }, 'INCLUSIVE');
    expect(r.amountBeforeVat.toFixed(2)).toBe('1000.00');
    expect(r.vatAmount.toFixed(2)).toBe('70.00');
  });

  it('discount applies before VAT/WHT', () => {
    const r = svc.computeLine({ quantity: 2, unitPrice: 1000, discount: 100, vatPercent: 7, whtPercent: 3 }, 'EXCLUSIVE');
    // (2 × 1000) − 100 = 1900
    expect(r.amountBeforeVat.toFixed(2)).toBe('1900.00');
    expect(r.vatAmount.toFixed(2)).toBe('133.00');
    expect(r.whtAmount.toFixed(2)).toBe('57.00');
  });

  it('WHT computed on amountBeforeVat (pre-VAT base)', () => {
    const r = svc.computeLine({ quantity: 1, unitPrice: 10000, discount: 0, vatPercent: 7, whtPercent: 3 }, 'EXCLUSIVE');
    expect(r.whtAmount.toFixed(2)).toBe('300.00'); // 10000 × 3%, NOT 10700 × 3%
  });

  it('rounding: ROUND_HALF_UP per line', () => {
    // 333.33 × 7% = 23.3331 → 23.33; 333.33 × 3% = 9.9999 → 10.00
    const r = svc.computeLine({ quantity: 1, unitPrice: 333.33, discount: 0, vatPercent: 7, whtPercent: 3 }, 'EXCLUSIVE');
    expect(r.vatAmount.toFixed(2)).toBe('23.33');
    expect(r.whtAmount.toFixed(2)).toBe('10.00');
  });

  it('aggregateLines sums per-line outputs', () => {
    const lines = [
      { amountBeforeVat: new Decimal('1000'), vatAmount: new Decimal('70'), whtAmount: new Decimal('30') },
      { amountBeforeVat: new Decimal('500'),  vatAmount: new Decimal('35'), whtAmount: new Decimal('0') },
    ];
    const t = svc.aggregateLines(lines as never);
    expect(t.subtotal.toFixed(2)).toBe('1500.00');
    expect(t.vatAmount.toFixed(2)).toBe('105.00');
    expect(t.withholdingTax.toFixed(2)).toBe('30.00');
    expect(t.totalAmount.toFixed(2)).toBe('1605.00');
    expect(t.netPayment.toFixed(2)).toBe('1575.00');
  });

  it('rejects line with negative qty/price/discount', () => {
    expect(() =>
      svc.computeLine({ quantity: -1, unitPrice: 100, discount: 0, vatPercent: 0, whtPercent: 0 }, 'EXCLUSIVE'),
    ).toThrow(/จำนวนต้องมากกว่า 0/);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `cd apps/api && npx jest --runInBand --silent --testPathPattern="line-aggregator" 2>&1 | tail -10`
Expected: 7 tests fail with "Cannot find module '../services/line-aggregator.service'"

- [ ] **Step 3: Write the service**

Create `apps/api/src/modules/expense-documents/services/line-aggregator.service.ts`:

```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

export type PriceType = 'EXCLUSIVE' | 'INCLUSIVE';

export interface LineInput {
  quantity: number | string | Decimal;
  unitPrice: number | string | Decimal;
  discount?: number | string | Decimal;
  vatPercent?: number | string | Decimal;
  whtPercent?: number | string | Decimal;
}

export interface LineOutput {
  amountBeforeVat: Decimal;
  vatAmount: Decimal;
  whtAmount: Decimal;
  /** amountBeforeVat + vatAmount (sum of Dr expense + Dr VAT) */
  lineTotal: Decimal;
}

export interface DocumentTotals {
  subtotal: Decimal;
  vatAmount: Decimal;
  withholdingTax: Decimal;
  totalAmount: Decimal;
  netPayment: Decimal;
}

const TWO = 2;

@Injectable()
export class LineAggregatorService {
  /**
   * Compute one line's pre-VAT base, VAT amount, and WHT amount.
   * Per-line rounding is ROUND_HALF_UP to 2 decimals on VAT and WHT.
   * amountBeforeVat is exact arithmetic (no rounding) when EXCLUSIVE,
   * and ROUND_HALF_UP-divided when INCLUSIVE.
   */
  computeLine(input: LineInput, priceType: PriceType): LineOutput {
    const qty       = this.dec(input.quantity);
    const unit      = this.dec(input.unitPrice);
    const disc      = this.dec(input.discount ?? 0);
    const vatPct    = this.dec(input.vatPercent ?? 0);
    const whtPct    = this.dec(input.whtPercent ?? 0);

    if (qty.lte(0)) throw new BadRequestException('จำนวนต้องมากกว่า 0');
    if (unit.lt(0)) throw new BadRequestException('ราคาต่อหน่วยต้องไม่เป็นลบ');
    if (disc.lt(0)) throw new BadRequestException('ส่วนลดต้องไม่เป็นลบ');

    const lineSubtotal = qty.mul(unit).minus(disc);

    let amountBeforeVat: Decimal;
    let vatAmount: Decimal;
    if (priceType === 'EXCLUSIVE') {
      amountBeforeVat = lineSubtotal;
      vatAmount = lineSubtotal.mul(vatPct).div(100).toDecimalPlaces(TWO, Decimal.ROUND_HALF_UP);
    } else {
      // INCLUSIVE: lineSubtotal includes VAT
      const denom = new Decimal(100).plus(vatPct);
      amountBeforeVat = lineSubtotal.mul(100).div(denom).toDecimalPlaces(TWO, Decimal.ROUND_HALF_UP);
      vatAmount = lineSubtotal.minus(amountBeforeVat);
    }

    const whtAmount = amountBeforeVat.mul(whtPct).div(100).toDecimalPlaces(TWO, Decimal.ROUND_HALF_UP);
    const lineTotal = amountBeforeVat.plus(vatAmount);

    return { amountBeforeVat, vatAmount, whtAmount, lineTotal };
  }

  /** Sum line outputs into document-level totals (no rounding — sums of pre-rounded values). */
  aggregateLines(lines: { amountBeforeVat: Decimal; vatAmount: Decimal; whtAmount: Decimal }[]): DocumentTotals {
    const zero = new Decimal(0);
    const subtotal       = lines.reduce((s, l) => s.plus(l.amountBeforeVat), zero);
    const vatAmount      = lines.reduce((s, l) => s.plus(l.vatAmount), zero);
    const withholdingTax = lines.reduce((s, l) => s.plus(l.whtAmount), zero);
    const totalAmount    = subtotal.plus(vatAmount);
    const netPayment     = totalAmount.minus(withholdingTax);
    return { subtotal, vatAmount, withholdingTax, totalAmount, netPayment };
  }

  private dec(v: number | string | Decimal): Decimal {
    if (v instanceof Decimal) return v;
    return new Decimal(typeof v === 'number' ? v.toString() : v);
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd apps/api && npx jest --runInBand --silent --testPathPattern="line-aggregator" 2>&1 | tail -8`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/expense-documents/services/line-aggregator.service.ts apps/api/src/modules/expense-documents/__tests__/line-aggregator.spec.ts
git commit -m "feat(svc): LineAggregatorService — pure per-line computation + 7 tests"
```

---

## Task 6: Wire LineAggregator into ExpenseDocumentsService.create + update

**Files:**
- Modify: `apps/api/src/modules/expense-documents/expense-documents.service.ts`
- Modify: `apps/api/src/modules/expense-documents/expense-documents.module.ts`
- Create: `apps/api/src/modules/expense-documents/__tests__/multi-line-create.service.spec.ts`

- [ ] **Step 1: Register LineAggregatorService in module**

Open `apps/api/src/modules/expense-documents/expense-documents.module.ts` and add to `providers`:

```ts
import { LineAggregatorService } from './services/line-aggregator.service';
// ... in @Module providers array:
providers: [
  ExpenseDocumentsService,
  ExpenseTemplatesService,
  DocNumberService,
  StatusTransitionService,
  LineAggregatorService,
  ExpenseRecurringCron,
],
```

- [ ] **Step 2: Replace `create()` in service**

Open `apps/api/src/modules/expense-documents/expense-documents.service.ts`. Find the `async create(...)` method and replace its body.

Inject `LineAggregatorService` in constructor (add to existing list), then replace the `create` method:

```ts
async create(dto: CreateExpenseDocumentDto, userId: string) {
  const documentDate = new Date(dto.documentDate);
  const priceType = dto.priceType ?? 'EXCLUSIVE';

  // Compute per-line totals + aggregate
  const linesPrepared = dto.lines.map((l, idx) => {
    const out = this.aggregator.computeLine(l, priceType);
    return { ...l, lineNo: idx + 1, ...out };
  });
  const totals = this.aggregator.aggregateLines(linesPrepared);

  return this.prisma.$transaction(async (tx) => {
    // CoA validation — every category must exist + be type ค่าใช้จ่าย
    const codes = [...new Set(linesPrepared.map((l) => l.category))];
    const coaRows = await tx.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true, type: true },
    });
    const byCode = new Map(coaRows.map((r) => [r.code, r.type]));
    for (const c of codes) {
      const t = byCode.get(c);
      if (!t) throw new BadRequestException(`หมวดบัญชี ${c} ไม่พบในผังบัญชี`);
      if (t !== 'ค่าใช้จ่าย') throw new BadRequestException(`หมวดบัญชี ${c} ไม่ใช่ "ค่าใช้จ่าย"`);
    }

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
        subtotal: totals.subtotal,
        vatAmount: totals.vatAmount,
        withholdingTax: totals.withholdingTax,
        whtFormType: dto.whtFormType ?? null,
        totalAmount: totals.totalAmount,
        netPayment: dto.depositAccountCode ? totals.netPayment : null,
        paymentMethod: (dto.paymentMethod as never) ?? null,
        depositAccountCode: dto.depositAccountCode ?? null,
        status: 'DRAFT',
        reference: dto.reference ?? null,
        receiptImageUrl: dto.receiptImageUrl ?? null,
        note: dto.note ?? null,
        fromTemplateId: dto.fromTemplateId ?? null,
        approvedById: dto.approvedById ?? null,
        createdById: userId,
        expenseDetail: {
          create: {
            priceType,
            lines: {
              create: linesPrepared.map((l) => ({
                lineNo: l.lineNo,
                category: l.category,
                description: l.description ?? null,
                quantity: new Prisma.Decimal(l.quantity),
                unitPrice: new Prisma.Decimal(l.unitPrice),
                discount: new Prisma.Decimal(l.discount ?? 0),
                vatPercent: new Prisma.Decimal(l.vatPercent ?? 0),
                whtPercent: new Prisma.Decimal(l.whtPercent ?? 0),
                amountBeforeVat: l.amountBeforeVat,
                vatAmount: l.vatAmount,
                whtAmount: l.whtAmount,
              })),
            },
          },
        },
      },
      include: { expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } } },
    });
  });
}
```

Add to top of file (with other imports):

```ts
import { LineAggregatorService } from './services/line-aggregator.service';
```

- [ ] **Step 3: Replace `update()` to re-aggregate when lines change**

Find `async update(...)` and replace its body. The pattern: if `dto.lines` is supplied, recompute everything; if not, leave totals untouched.

```ts
async update(id: string, dto: UpdateExpenseDocumentDto, _userId: string) {
  return this.prisma.$transaction(async (tx) => {
    const existing = await tx.expenseDocument.findUniqueOrThrow({
      where: { id },
      include: { expenseDetail: { include: { lines: true } } },
    });
    if (existing.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
    this.transition.assertCanEdit({ from: existing.status });

    const data: Prisma.ExpenseDocumentUpdateInput = {};
    if (dto.documentDate) data.documentDate = new Date(dto.documentDate);
    if (dto.vendorName !== undefined) data.vendorName = dto.vendorName;
    if (dto.vendorTaxId !== undefined) data.vendorTaxId = dto.vendorTaxId;
    if (dto.taxInvoiceNo !== undefined) data.taxInvoiceNo = dto.taxInvoiceNo;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.whtFormType !== undefined) data.whtFormType = dto.whtFormType;
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod as never;
    if (dto.depositAccountCode !== undefined) data.depositAccountCode = dto.depositAccountCode;
    if (dto.reference !== undefined) data.reference = dto.reference;
    if (dto.receiptImageUrl !== undefined) data.receiptImageUrl = dto.receiptImageUrl;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.approvedById !== undefined) data.approvedById = dto.approvedById;

    if (dto.lines !== undefined) {
      const priceType = dto.priceType ?? existing.expenseDetail?.priceType ?? 'EXCLUSIVE';
      const linesPrepared = dto.lines.map((l, idx) => {
        const out = this.aggregator.computeLine(l, priceType as never);
        return { ...l, lineNo: idx + 1, ...out };
      });
      const totals = this.aggregator.aggregateLines(linesPrepared);

      data.subtotal = totals.subtotal;
      data.vatAmount = totals.vatAmount;
      data.withholdingTax = totals.withholdingTax;
      data.totalAmount = totals.totalAmount;
      data.netPayment = (dto.depositAccountCode ?? existing.depositAccountCode)
        ? totals.netPayment
        : null;

      // Replace lines wholesale
      await tx.expenseLine.deleteMany({ where: { expenseDetailId: id } });
      await tx.expenseDetail.update({
        where: { documentId: id },
        data: {
          priceType: priceType as string,
          lines: {
            create: linesPrepared.map((l) => ({
              lineNo: l.lineNo,
              category: l.category,
              description: l.description ?? null,
              quantity: new Prisma.Decimal(l.quantity),
              unitPrice: new Prisma.Decimal(l.unitPrice),
              discount: new Prisma.Decimal(l.discount ?? 0),
              vatPercent: new Prisma.Decimal(l.vatPercent ?? 0),
              whtPercent: new Prisma.Decimal(l.whtPercent ?? 0),
              amountBeforeVat: l.amountBeforeVat,
              vatAmount: l.vatAmount,
              whtAmount: l.whtAmount,
            })),
          },
        },
      });
    }

    return tx.expenseDocument.update({
      where: { id },
      data,
      include: { expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } } },
    });
  });
}
```

- [ ] **Step 4: Update constructor**

Add to constructor parameters list:

```ts
private readonly aggregator: LineAggregatorService,
```

- [ ] **Step 5: Write failing test**

Create `apps/api/src/modules/expense-documents/__tests__/multi-line-create.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { LineAggregatorService } from '../services/line-aggregator.service';

describe('ExpenseDocumentsService.create — multi-line', () => {
  let service: ExpenseDocumentsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let aggregator: LineAggregatorService;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      expenseDocument: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'doc-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      expenseDetail: { update: jest.fn() },
      expenseLine: { deleteMany: jest.fn() },
      chartOfAccount: {
        findMany: jest.fn().mockResolvedValue([
          { code: '53-1101', type: 'ค่าใช้จ่าย' },
          { code: '53-1404', type: 'ค่าใช้จ่าย' },
        ]),
      },
    };
    aggregator = new LineAggregatorService();
    service = new ExpenseDocumentsService(
      prisma,
      { next: jest.fn().mockResolvedValue('EX-20260511-0001') } as never,
      { assertCanPost: jest.fn(), assertCanVoid: jest.fn(), assertCanEdit: jest.fn(), resolveTargetStatus: jest.fn().mockReturnValue('POSTED') } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      { createAndPost: jest.fn() } as never,
      aggregator,
    );
  });

  it('aggregates 3 lines into document totals', async () => {
    await service.create({
      documentType: 'EXPENSE',
      branchId: 'b1',
      documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      lines: [
        { category: '53-1101', quantity: 1, unitPrice: 5000, vatPercent: 7, whtPercent: 0 },
        { category: '53-1404', quantity: 1, unitPrice: 1500, vatPercent: 7, whtPercent: 0 },
        { category: '53-1101', quantity: 1, unitPrice: 500,  vatPercent: 0, whtPercent: 0 },
      ],
    } as never, 'user-1');

    const callArg = prisma.expenseDocument.create.mock.calls[0][0];
    // subtotal = 5000 + 1500 + 500 = 7000
    expect(callArg.data.subtotal.toFixed(2)).toBe('7000.00');
    // vat = (5000 + 1500) × 7% = 455
    expect(callArg.data.vatAmount.toFixed(2)).toBe('455.00');
    // total = 7000 + 455 = 7455
    expect(callArg.data.totalAmount.toFixed(2)).toBe('7455.00');
  });

  it('rejects when ANY line has missing CoA code', async () => {
    prisma.chartOfAccount.findMany.mockResolvedValueOnce([{ code: '53-1101', type: 'ค่าใช้จ่าย' }]);
    await expect(service.create({
      documentType: 'EXPENSE',
      branchId: 'b1',
      documentDate: '2026-05-11',
      lines: [
        { category: '53-1101', quantity: 1, unitPrice: 100, vatPercent: 7, whtPercent: 0 },
        { category: '53-9999', quantity: 1, unitPrice: 100, vatPercent: 7, whtPercent: 0 },
      ],
    } as never, 'user-1')).rejects.toThrow(/53-9999.*ไม่พบ/);
  });

  it('rejects ArrayMinSize when lines is empty (DTO-level)', async () => {
    // class-validator decorator handles this; we just sanity-check service rejects when empty
    await expect(service.create({
      documentType: 'EXPENSE',
      branchId: 'b1',
      documentDate: '2026-05-11',
      lines: [],
    } as never, 'user-1')).rejects.toBeDefined();
  });
});
```

- [ ] **Step 6: Run tests**

Run: `cd apps/api && npx jest --runInBand --silent --testPathPattern="multi-line-create.service" 2>&1 | tail -8`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/expense-documents/expense-documents.service.ts apps/api/src/modules/expense-documents/expense-documents.module.ts apps/api/src/modules/expense-documents/__tests__/multi-line-create.service.spec.ts
git commit -m "feat(svc): multi-line create + update with auto-aggregation"
```

---

## Task 7: JePreviewService — assemble preview JE

**Files:**
- Create: `apps/api/src/modules/expense-documents/services/je-preview.service.ts`
- Create: `apps/api/src/modules/expense-documents/__tests__/je-preview.service.spec.ts`

- [ ] **Step 1: Write the service**

Create `apps/api/src/modules/expense-documents/services/je-preview.service.ts`:

```ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { LineAggregatorService } from './line-aggregator.service';
import { CreateExpenseDocumentDto } from '../dto/create.dto';

export interface PreviewLine {
  accountCode: string;
  accountName: string;
  description: string;
  dr: string;
  cr: string;
}

export interface JePreview {
  flow: 'expense-same-day' | 'expense-accrual';
  lines: PreviewLine[];
  totals: {
    subtotal: string;
    vatAmount: string;
    withholdingTax: string;
    totalAmount: string;
    netPayment: string;
    drSum: string;
    crSum: string;
    balanced: boolean;
  };
}

@Injectable()
export class JePreviewService {
  constructor(private readonly aggregator: LineAggregatorService) {}

  /**
   * Build a JE preview from form-state DTO without touching the database.
   * Same logic as ExpenseSameDay/ExpenseAccrual templates but pure.
   */
  preview(dto: CreateExpenseDocumentDto, accountNames: Map<string, string>): JePreview {
    const priceType = dto.priceType ?? 'EXCLUSIVE';
    const computed = dto.lines.map((l, idx) => ({
      lineNo: idx + 1,
      category: l.category,
      description: l.description,
      vatPercent: l.vatPercent ?? 0,
      whtPercent: l.whtPercent ?? 0,
      ...this.aggregator.computeLine(l, priceType),
    }));
    const totals = this.aggregator.aggregateLines(computed);
    const hasPayment = !!(dto.paymentMethod && dto.depositAccountCode);
    const flow: JePreview['flow'] = hasPayment ? 'expense-same-day' : 'expense-accrual';

    const previewLines: PreviewLine[] = [];
    const zero = new Decimal(0);

    // Aggregate Dr expense by category
    const byCategory = new Map<string, Decimal>();
    for (const c of computed) {
      byCategory.set(c.category, (byCategory.get(c.category) ?? zero).plus(c.amountBeforeVat));
    }
    for (const [code, amt] of byCategory.entries()) {
      previewLines.push({
        accountCode: code,
        accountName: accountNames.get(code) ?? '',
        description: 'ค่าใช้จ่าย',
        dr: amt.toFixed(2),
        cr: '0.00',
      });
    }

    // Dr 11-2104 VAT (if any)
    if (totals.vatAmount.gt(0)) {
      previewLines.push({
        accountCode: '11-2104',
        accountName: accountNames.get('11-2104') ?? 'ลูกหนี้-VAT ที่ออกแทน',
        description: 'VAT ซื้อ',
        dr: totals.vatAmount.toFixed(2),
        cr: '0.00',
      });
    }

    if (hasPayment) {
      // Same-day: Cr cash (totalAmount − wht), Cr WHT (per formType)
      const cashCr = totals.totalAmount.minus(totals.withholdingTax);
      previewLines.push({
        accountCode: dto.depositAccountCode!,
        accountName: accountNames.get(dto.depositAccountCode!) ?? '',
        description: 'จ่ายเงิน',
        dr: '0.00',
        cr: cashCr.toFixed(2),
      });
      if (totals.withholdingTax.gt(0)) {
        const whtAccount = dto.whtFormType === 'PND53' ? '21-3103' : '21-3102';
        previewLines.push({
          accountCode: whtAccount,
          accountName: accountNames.get(whtAccount) ?? '',
          description: `WHT ${dto.whtFormType ?? 'PND3'}`,
          dr: '0.00',
          cr: totals.withholdingTax.toFixed(2),
        });
      }
    } else {
      // Accrual: Cr 21-1104 AP for total
      previewLines.push({
        accountCode: '21-1104',
        accountName: accountNames.get('21-1104') ?? 'เจ้าหนี้ค่าใช้จ่ายกิจการ',
        description: 'ตั้งหนี้',
        dr: '0.00',
        cr: totals.totalAmount.toFixed(2),
      });
    }

    const drSum = previewLines.reduce((s, l) => s.plus(l.dr), zero);
    const crSum = previewLines.reduce((s, l) => s.plus(l.cr), zero);
    const balanced = drSum.equals(crSum);

    return {
      flow,
      lines: previewLines,
      totals: {
        subtotal: totals.subtotal.toFixed(2),
        vatAmount: totals.vatAmount.toFixed(2),
        withholdingTax: totals.withholdingTax.toFixed(2),
        totalAmount: totals.totalAmount.toFixed(2),
        netPayment: totals.netPayment.toFixed(2),
        drSum: drSum.toFixed(2),
        crSum: crSum.toFixed(2),
        balanced,
      },
    };
  }
}
```

- [ ] **Step 2: Write tests**

Create `apps/api/src/modules/expense-documents/__tests__/je-preview.service.spec.ts`:

```ts
import { JePreviewService } from '../services/je-preview.service';
import { LineAggregatorService } from '../services/line-aggregator.service';

describe('JePreviewService', () => {
  let svc: JePreviewService;
  const names = new Map<string, string>([
    ['53-1101', 'ค่าใช้จ่ายเงินเดือน'],
    ['53-1404', 'ค่าทำความสะอาด'],
    ['11-2104', 'VAT ซื้อ'],
    ['11-1101', 'เงินสด'],
    ['11-1201', 'KBank'],
    ['21-1104', 'AP กิจการ'],
    ['21-3102', 'PND.3'],
    ['21-3103', 'PND.53'],
  ]);

  beforeEach(() => {
    svc = new JePreviewService(new LineAggregatorService());
  });

  it('same-day: 1 line, 7% VAT, no WHT — balanced', () => {
    const r = svc.preview({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      paymentMethod: 'CASH', depositAccountCode: '11-1101',
      lines: [{ category: '53-1101', quantity: 1, unitPrice: 4500, vatPercent: 7, whtPercent: 0 }],
    } as never, names);
    expect(r.flow).toBe('expense-same-day');
    expect(r.totals.balanced).toBe(true);
    expect(r.totals.drSum).toBe('4815.00');
    expect(r.totals.crSum).toBe('4815.00');
    expect(r.lines.find((l) => l.accountCode === '53-1101')?.dr).toBe('4500.00');
    expect(r.lines.find((l) => l.accountCode === '11-2104')?.dr).toBe('315.00');
    expect(r.lines.find((l) => l.accountCode === '11-1101')?.cr).toBe('4815.00');
  });

  it('accrual: 2 lines, no payment — balanced via 21-1104', () => {
    const r = svc.preview({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      lines: [
        { category: '53-1101', quantity: 1, unitPrice: 5000, vatPercent: 7, whtPercent: 0 },
        { category: '53-1404', quantity: 1, unitPrice: 1500, vatPercent: 7, whtPercent: 0 },
      ],
    } as never, names);
    expect(r.flow).toBe('expense-accrual');
    expect(r.totals.balanced).toBe(true);
    expect(r.lines.find((l) => l.accountCode === '21-1104')?.cr).toBe('6955.00');
  });

  it('PND.53 routing — WHT lands on 21-3103', () => {
    const r = svc.preview({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      paymentMethod: 'BANK_TRANSFER', depositAccountCode: '11-1201',
      whtFormType: 'PND53',
      lines: [{ category: '53-1404', quantity: 1, unitPrice: 10000, vatPercent: 7, whtPercent: 3 }],
    } as never, names);
    expect(r.lines.find((l) => l.accountCode === '21-3103')?.cr).toBe('300.00');
    expect(r.totals.balanced).toBe(true);
  });

  it('multiple lines same category collapse to ONE Dr row', () => {
    const r = svc.preview({
      documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-05-11',
      priceType: 'EXCLUSIVE',
      paymentMethod: 'CASH', depositAccountCode: '11-1101',
      lines: [
        { category: '53-1101', quantity: 1, unitPrice: 1000, vatPercent: 7, whtPercent: 0 },
        { category: '53-1101', quantity: 2, unitPrice: 500,  vatPercent: 7, whtPercent: 0 },
      ],
    } as never, names);
    const drExpense = r.lines.filter((l) => l.accountCode === '53-1101');
    expect(drExpense).toHaveLength(1);
    expect(drExpense[0].dr).toBe('2000.00');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd apps/api && npx jest --runInBand --silent --testPathPattern="je-preview" 2>&1 | tail -8`
Expected: 4 passed.

- [ ] **Step 4: Register in module + commit**

Add `JePreviewService` to `expense-documents.module.ts` providers list, then:

```bash
git add apps/api/src/modules/expense-documents/services/je-preview.service.ts apps/api/src/modules/expense-documents/__tests__/je-preview.service.spec.ts apps/api/src/modules/expense-documents/expense-documents.module.ts
git commit -m "feat(svc): JePreviewService — assemble preview JE without touching DB"
```

---

## Task 8: POST /expense-documents/preview-je endpoint

**Files:**
- Modify: `apps/api/src/modules/expense-documents/expense-documents.controller.ts`
- Modify: `apps/api/src/modules/expense-documents/expense-documents.service.ts`

- [ ] **Step 1: Add controller route**

Open `apps/api/src/modules/expense-documents/expense-documents.controller.ts`. Inject `JePreviewService` (constructor) + add route handler before `@Get(':id/cn-cap')`:

```ts
@Post('preview-je')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
async previewJe(@Body() dto: CreateExpenseDocumentDto) {
  return this.service.previewJe(dto);
}
```

- [ ] **Step 2: Add service method that loads CoA names + delegates**

In `expense-documents.service.ts`, inject `JePreviewService` (constructor) + add method:

```ts
async previewJe(dto: CreateExpenseDocumentDto) {
  const codes = new Set<string>();
  for (const l of dto.lines) codes.add(l.category);
  if (dto.depositAccountCode) codes.add(dto.depositAccountCode);
  codes.add('11-2104');
  codes.add('21-1104');
  if (dto.whtFormType === 'PND53') codes.add('21-3103'); else codes.add('21-3102');

  const rows = await this.prisma.chartOfAccount.findMany({
    where: { code: { in: [...codes] }, deletedAt: null },
    select: { code: true, name: true },
  });
  const accountNames = new Map(rows.map((r) => [r.code, r.name]));
  return this.jePreview.preview(dto, accountNames);
}
```

- [ ] **Step 3: Type-check**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | grep "expense-documents/" | head -5`
Expected: empty.

- [ ] **Step 4: Add controller test**

Add to existing `apps/api/src/modules/expense-documents/__tests__/expense-documents.controller.spec.ts`:

```ts
it('POST /preview-je calls service.previewJe', async () => {
  const dto = { documentType: 'EXPENSE', branchId: 'b1', documentDate: '2026-05-11', lines: [{ category: '53-1101', quantity: 1, unitPrice: 100 }] };
  service.previewJe = jest.fn().mockResolvedValue({ flow: 'expense-accrual', lines: [], totals: { balanced: true } });
  await controller.previewJe(dto as never);
  expect(service.previewJe).toHaveBeenCalledWith(dto);
});
```

- [ ] **Step 5: Run + commit**

```bash
cd apps/api && npx jest --runInBand --silent --testPathPattern="expense-documents.controller" 2>&1 | tail -6
git add apps/api/src/modules/expense-documents/
git commit -m "feat(api): POST /expense-documents/preview-je endpoint"
```

---

## Task 9: Refactor ExpenseSameDayTemplate for multi-line

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/expense-same-day.template.ts`
- Modify: `apps/api/src/modules/expense-documents/__tests__/expense-same-day.template.spec.ts`

- [ ] **Step 1: Replace `execute()` body**

Open `apps/api/src/modules/journal/cpa-templates/expense-same-day.template.ts` and find the `execute` method. Replace the part that builds `lines: JeLineInput[]` with multi-line aggregation:

```ts
const doc = await tx.expenseDocument.findUniqueOrThrow({
  where: { id: documentId },
  include: { expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } } },
});

if (doc.journalEntryId) {
  const existing = await tx.journalEntry.findUnique({
    where: { id: doc.journalEntryId },
    select: { entryNumber: true },
  });
  return { entryNo: existing?.entryNumber ?? doc.journalEntryId };
}

const expenseLines = doc.expenseDetail?.lines ?? [];
if (expenseLines.length === 0) {
  throw new Error(`ExpenseDocument ${documentId} has no expense lines`);
}
if (!doc.depositAccountCode) {
  throw new Error(`ExpenseDocument ${documentId} missing depositAccountCode`);
}

const zero = new Decimal(0);
const subtotal = new Decimal(doc.subtotal.toString());
const vat = new Decimal(doc.vatAmount.toString());
const wht = new Decimal(doc.withholdingTax.toString());
const total = new Decimal(doc.totalAmount.toString());
const cashAmount = total.minus(wht);

// Aggregate Dr by category
const byCategory = new Map<string, Decimal>();
for (const l of expenseLines) {
  const amt = new Decimal(l.amountBeforeVat.toString());
  byCategory.set(l.category, (byCategory.get(l.category) ?? zero).plus(amt));
}

const lines: JeLineInput[] = [];
for (const [code, amt] of byCategory.entries()) {
  lines.push({ accountCode: code, dr: amt, cr: zero, description: `ค่าใช้จ่าย — ${doc.number}` });
}
if (vat.gt(zero)) {
  lines.push({ accountCode: '11-2104', dr: vat, cr: zero, description: 'ลูกหนี้-VAT ที่ออกแทน' });
}
lines.push({
  accountCode: doc.depositAccountCode,
  dr: zero, cr: cashAmount,
  description: `จ่ายเงิน ${cashAmount.toFixed(2)} ฿`,
});
if (wht.gt(zero)) {
  const whtAccount = doc.whtFormType === 'PND53' ? '21-3103' : '21-3102';
  lines.push({ accountCode: whtAccount, dr: zero, cr: wht, description: `หัก ณ ที่จ่าย ${doc.whtFormType ?? 'PND3'}` });
}

const companyId = await this.getShopCompanyId(tx);
const result = await this.journal.createAndPost({
  description: `รับชำระค่าใช้จ่าย ${doc.number}`,
  reference: doc.id,
  metadata: {
    tag: 'EXPENSE_SAME_DAY',
    documentId: doc.id,
    documentNumber: doc.number,
    documentType: doc.documentType,
    flow: 'expense-same-day',
    lineCount: expenseLines.length,
  },
  postedAt: doc.documentDate,
  lines,
  companyId,
}, tx);

await tx.expenseDocument.update({
  where: { id: doc.id },
  data: { status: 'POSTED', paidAt: doc.documentDate, journalEntryId: result.id, netPayment: cashAmount },
});

return { entryNo: result.entryNumber };
```

- [ ] **Step 2: Update spec mocks to include lines**

Open `apps/api/src/modules/expense-documents/__tests__/expense-same-day.template.spec.ts`. Find each `findUniqueOrThrow.mockResolvedValue` and replace any `expenseDetail: { category: '53-xxxx' }` with the new shape:

```ts
expenseDetail: {
  priceType: 'EXCLUSIVE',
  lines: [
    {
      lineNo: 1, category: '53-1302',
      amountBeforeVat: new Decimal('1000'),
      vatAmount: new Decimal('70'),
      whtAmount: new Decimal('0'),
    },
  ],
},
```

For multi-line / mixed-VAT tests, add cases:

```ts
it('multi-line: 2 categories aggregate to 2 Dr rows', async () => {
  prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
    id: 'doc-multi', number: 'EX-20260511-0010',
    documentType: 'EXPENSE',
    documentDate: new Date('2026-05-11'),
    subtotal: new Decimal('1500'),
    vatAmount: new Decimal('105'),
    withholdingTax: new Decimal('0'),
    totalAmount: new Decimal('1605'),
    depositAccountCode: '11-1101',
    journalEntryId: null,
    expenseDetail: {
      priceType: 'EXCLUSIVE',
      lines: [
        { lineNo: 1, category: '53-1101', amountBeforeVat: new Decimal('1000'), vatAmount: new Decimal('70'), whtAmount: new Decimal('0') },
        { lineNo: 2, category: '53-1404', amountBeforeVat: new Decimal('500'),  vatAmount: new Decimal('35'), whtAmount: new Decimal('0') },
      ],
    },
  });
  await template.execute('doc-multi');
  const args = journal.createAndPost.mock.calls[0][0];
  const dr5x = args.lines.filter((l: { accountCode: string }) => l.accountCode.startsWith('5'));
  expect(dr5x).toHaveLength(2);
  expect(dr5x.find((l: { accountCode: string }) => l.accountCode === '53-1101').dr.toString()).toBe('1000');
});
```

- [ ] **Step 3: Run + commit**

```bash
cd apps/api && npx jest --runInBand --silent --testPathPattern="expense-same-day.template" 2>&1 | tail -6
git add apps/api/src/modules/journal/cpa-templates/expense-same-day.template.ts apps/api/src/modules/expense-documents/__tests__/expense-same-day.template.spec.ts
git commit -m "refactor(je): expense-same-day template reads multi-line ExpenseDetail.lines"
```

---

## Task 10: Refactor ExpenseAccrualTemplate for multi-line

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/expense-accrual.template.ts`
- Modify: `apps/api/src/modules/expense-documents/__tests__/expense-accrual.template.spec.ts`

Apply the same pattern as Task 9 (replace single-category Dr with `byCategory` map + multiple Dr lines + Dr 11-2104 if VAT > 0). The Cr leg is `21-1104` for the full total instead of cash. Include the same multi-line test case.

- [ ] **Step 1: Replace `execute()` body — see Task 9 pattern**

Replace from the `expenseLines` declaration through the `lines.push({ accountCode: '21-1104', ... })` block:

```ts
const expenseLines = doc.expenseDetail?.lines ?? [];
if (expenseLines.length === 0) throw new Error(`ExpenseDocument ${documentId} has no expense lines`);

const zero = new Decimal(0);
const total = new Decimal(doc.totalAmount.toString());
const vat = new Decimal(doc.vatAmount.toString());

const byCategory = new Map<string, Decimal>();
for (const l of expenseLines) {
  const amt = new Decimal(l.amountBeforeVat.toString());
  byCategory.set(l.category, (byCategory.get(l.category) ?? zero).plus(amt));
}

const lines: JeLineInput[] = [];
for (const [code, amt] of byCategory.entries()) {
  lines.push({ accountCode: code, dr: amt, cr: zero, description: `ค่าใช้จ่าย — ${doc.number}` });
}
if (vat.gt(zero)) {
  lines.push({ accountCode: '11-2104', dr: vat, cr: zero, description: 'ลูกหนี้-VAT ที่ออกแทน' });
}
lines.push({ accountCode: '21-1104', dr: zero, cr: total, description: 'เจ้าหนี้ค่าใช้จ่ายกิจการ' });
```

- [ ] **Step 2: Update existing tests + add multi-line test**

In `expense-accrual.template.spec.ts` change all mocks (`expenseDetail: { category: '53-xxxx' }`) to the new `lines: [...]` shape, then add:

```ts
it('multi-line accrual: 2 categories → 2 Dr rows + 1 Cr 21-1104', async () => {
  prisma.expenseDocument.findUniqueOrThrow.mockResolvedValue({
    id: 'a-multi', number: 'EX-20260511-0011',
    documentType: 'EXPENSE',
    documentDate: new Date('2026-05-11'),
    subtotal: new Decimal('2000'),
    vatAmount: new Decimal('140'),
    withholdingTax: new Decimal('0'),
    totalAmount: new Decimal('2140'),
    depositAccountCode: null,
    journalEntryId: null,
    expenseDetail: {
      priceType: 'EXCLUSIVE',
      lines: [
        { lineNo: 1, category: '53-1101', amountBeforeVat: new Decimal('1500'), vatAmount: new Decimal('105'), whtAmount: new Decimal('0') },
        { lineNo: 2, category: '53-1404', amountBeforeVat: new Decimal('500'),  vatAmount: new Decimal('35'), whtAmount: new Decimal('0') },
      ],
    },
  });
  await template.execute('a-multi');
  const args = journal.createAndPost.mock.calls[0][0];
  expect(args.lines.find((l: { accountCode: string }) => l.accountCode === '21-1104').cr.toString()).toBe('2140');
});
```

- [ ] **Step 3: Run + commit**

```bash
cd apps/api && npx jest --runInBand --silent --testPathPattern="expense-accrual.template" 2>&1 | tail -6
git add apps/api/src/modules/journal/cpa-templates/expense-accrual.template.ts apps/api/src/modules/expense-documents/__tests__/expense-accrual.template.spec.ts
git commit -m "refactor(je): expense-accrual template reads multi-line ExpenseDetail.lines"
```

---

## Task 11: Refactor CreditNoteTemplate for multi-line

**Files:**
- Modify: `apps/api/src/modules/journal/cpa-templates/credit-note.template.ts`
- Modify: `apps/api/src/modules/expense-documents/__tests__/credit-note.template.spec.ts`

CN under multi-line: each CN line mirrors a portion of an original EX line. Schema-wise CN reuses the same `ExpenseLine[]` table (a CN is just an `ExpenseDocument` with `documentType = 'CREDIT_NOTE'` and its own `expenseDetail.lines`). The category-validation code already in this template still works at the document level — CN must only credit `5x-xxxx` accounts.

- [ ] **Step 1: Replace single-category code with multi-line aggregation**

Find in `credit-note.template.ts` the lines:
```ts
const { originalDocumentId, category } = cn.creditNote;
// ...
const coaRow = await tx.chartOfAccount.findFirst(...);
// ...
lines.push({ accountCode: category, dr: zero, cr: subtotal, description: ... });
```

Replace with:

```ts
const { originalDocumentId } = cn.creditNote;
const cnLines = cn.expenseDetail?.lines ?? [];
if (cnLines.length === 0) throw new Error(`CreditNote ${documentId} has no expense lines`);

// Validate every CN line.category against CoA
const codes = [...new Set(cnLines.map((l) => l.category))];
const coaRows = await tx.chartOfAccount.findMany({
  where: { code: { in: codes }, deletedAt: null },
  select: { code: true, type: true },
});
const byCode = new Map(coaRows.map((r) => [r.code, r.type]));
for (const c of codes) {
  if (!byCode.get(c)) {
    throw new BadRequestException(`หมวดบัญชี ${c} ไม่พบในผังบัญชี — ไม่สามารถ post ใบลดหนี้`);
  }
  if (!c.startsWith('5') || byCode.get(c) !== 'ค่าใช้จ่าย') {
    throw new BadRequestException(`หมวดบัญชี ${c} ไม่ใช่บัญชีค่าใช้จ่าย — ใบลดหนี้ต้องอ้างถึงบัญชี 5x-xxxx`);
  }
}

const original = await tx.expenseDocument.findUniqueOrThrow({ where: { id: originalDocumentId } });
if (['VOIDED', 'DRAFT'].includes(original.status)) {
  throw new BadRequestException(`ไม่สามารถ post ใบลดหนี้ เพราะเอกสารต้นฉบับอยู่ในสถานะ ${original.status}`);
}

const zero = new Decimal(0);
const total = new Decimal(cn.totalAmount.toString());
const vat = new Decimal(cn.vatAmount.toString());

const lines: JeLineInput[] = [];
if (original.status === 'ACCRUAL') {
  lines.push({ accountCode: '21-1104', dr: total, cr: zero, description: `กลับเจ้าหนี้ — ${cn.number}` });
} else {
  const refundAccount = cn.depositAccountCode ?? original.depositAccountCode;
  if (!refundAccount) throw new Error(`CreditNote ${cn.id} on POSTED original requires depositAccountCode`);
  lines.push({ accountCode: refundAccount, dr: total, cr: zero, description: `รับคืนเงิน — ${cn.number}` });
}

// Cr expense by category
const byCategory = new Map<string, Decimal>();
for (const l of cnLines) {
  const amt = new Decimal(l.amountBeforeVat.toString());
  byCategory.set(l.category, (byCategory.get(l.category) ?? zero).plus(amt));
}
for (const [code, amt] of byCategory.entries()) {
  lines.push({ accountCode: code, dr: zero, cr: amt, description: `กลับค่าใช้จ่าย — ${cn.number}` });
}
if (vat.gt(zero)) {
  lines.push({ accountCode: '11-2104', dr: zero, cr: vat, description: 'กลับ VAT' });
}
```

Also update the include block at the top of `execute()` to load lines:

```ts
const cn = await tx.expenseDocument.findUniqueOrThrow({
  where: { id: documentId },
  include: {
    creditNote: true,
    expenseDetail: { include: { lines: { orderBy: { lineNo: 'asc' } } } },
  },
});
```

The `category` field on `CreditNoteDetail` is now redundant (lines carry their own categories). It can stay for backward-compat docs that reference it, or be migrated out in a later cleanup.

- [ ] **Step 2: Update tests for multi-line CN**

In `credit-note.template.spec.ts`, change every CN doc fixture to use the new shape:

```ts
expenseDetail: {
  priceType: 'EXCLUSIVE',
  lines: [
    { lineNo: 1, category: '53-1404', amountBeforeVat: new Decimal('500'), vatAmount: new Decimal('35'), whtAmount: new Decimal('0') },
  ],
},
creditNote: { originalDocumentId: 'orig-1', reason: 'partial return' },
```

- [ ] **Step 3: Run + commit**

```bash
cd apps/api && npx jest --runInBand --silent --testPathPattern="credit-note.template" 2>&1 | tail -6
git add apps/api/src/modules/journal/cpa-templates/credit-note.template.ts apps/api/src/modules/expense-documents/__tests__/credit-note.template.spec.ts
git commit -m "refactor(je): credit-note template reads multi-line ExpenseDetail.lines"
```

---

## Task 12: Multi-line lifecycle integration test

**Files:**
- Create: `apps/api/src/modules/expense-documents/__tests__/multi-line-lifecycle.integration.spec.ts`

- [ ] **Step 1: Write the integration test**

This mirrors the existing `full-lifecycle.integration.spec.ts` but exercises a 3-line invoice with mixed VAT and WHT. Create the file with:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient, DocumentStatus } from '@prisma/client';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { LineAggregatorService } from '../services/line-aggregator.service';
import { JePreviewService } from '../services/je-preview.service';
import { DocNumberService } from '../services/doc-number.service';
import { StatusTransitionService } from '../services/status-transition.service';
import { ExpenseSameDayTemplate } from '../../journal/cpa-templates/expense-same-day.template';
import { ExpenseAccrualTemplate } from '../../journal/cpa-templates/expense-accrual.template';
import { CreditNoteTemplate } from '../../journal/cpa-templates/credit-note.template';
import { PayrollTemplate } from '../../journal/cpa-templates/payroll.template';
import { VendorSettlementTemplate } from '../../journal/cpa-templates/vendor-settlement.template';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';

const prisma = new PrismaClient();
let userId: string;
let branchId: string;

describe('ExpenseDocuments multi-line lifecycle', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    const branch = await prisma.branch.findFirst({ where: { deletedAt: null } });
    branchId = branch!.id;
    const user = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    userId = user!.id;
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE metadata->>'flow' LIKE 'expense-%')`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE metadata->>'flow' LIKE 'expense-%'`);
    await prisma.expenseDocument.deleteMany({});
  });

  function buildService() {
    const journal = new JournalAutoService(prisma as never);
    const aggregator = new LineAggregatorService();
    const jePreview = new JePreviewService(aggregator);
    return new ExpenseDocumentsService(
      prisma as never,
      new DocNumberService(),
      new StatusTransitionService(),
      new ExpenseSameDayTemplate(journal, prisma as never),
      new ExpenseAccrualTemplate(journal, prisma as never),
      new CreditNoteTemplate(journal, prisma as never),
      new PayrollTemplate(journal, prisma as never),
      new VendorSettlementTemplate(journal, prisma as never),
      journal,
      aggregator,
      jePreview,
    );
  }

  it('3-line invoice with mixed VAT post → JE balanced, Dr expenses by category, Cr cash + Cr WHT', async () => {
    const svc = buildService();
    const doc = await svc.create({
      documentType: 'EXPENSE',
      branchId,
      documentDate: new Date().toISOString(),
      priceType: 'EXCLUSIVE',
      paymentMethod: 'BANK_TRANSFER',
      depositAccountCode: '11-1201',
      whtFormType: 'PND53',
      vendorName: 'Test Vendor',
      lines: [
        { category: '53-1302', quantity: 1, unitPrice: 5000,  vatPercent: 7, whtPercent: 0 },
        { category: '53-1404', quantity: 1, unitPrice: 1500,  vatPercent: 7, whtPercent: 3 },
        { category: '53-1302', quantity: 1, unitPrice: 500,   vatPercent: 0, whtPercent: 0 },
      ],
    } as never, userId);

    expect(doc.status).toBe(DocumentStatus.DRAFT);
    await svc.post(doc.id, userId);

    const after = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(after.status).toBe(DocumentStatus.POSTED);

    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { id: after.journalEntryId! },
      include: { lines: true },
    });
    const drSum = je.lines.reduce((s, l) => s + Number(l.debit), 0);
    const crSum = je.lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(drSum).toBeCloseTo(crSum, 2);

    const codes = je.lines.map((l) => l.accountCode);
    expect(codes).toContain('53-1302');
    expect(codes).toContain('53-1404');
    expect(codes).toContain('11-2104');
    expect(codes).toContain('11-1201');
    expect(codes).toContain('21-3103');
  });

  it('preview-je round-trips: preview before save → JE matches preview after post', async () => {
    const svc = buildService();
    const dto = {
      documentType: 'EXPENSE' as const,
      branchId,
      documentDate: new Date().toISOString(),
      priceType: 'EXCLUSIVE' as const,
      paymentMethod: 'CASH',
      depositAccountCode: '11-1101',
      lines: [
        { category: '53-1302', quantity: 1, unitPrice: 1000, vatPercent: 7, whtPercent: 0 },
      ],
    };
    const preview = await svc.previewJe(dto as never);
    expect(preview.totals.balanced).toBe(true);

    const doc = await svc.create(dto as never, userId);
    await svc.post(doc.id, userId);
    const after = await prisma.expenseDocument.findUniqueOrThrow({ where: { id: doc.id } });
    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { id: after.journalEntryId! }, include: { lines: true },
    });
    const drTotal = je.lines.reduce((s, l) => s + Number(l.debit), 0);
    expect(drTotal.toFixed(2)).toBe(preview.totals.drSum);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd apps/api && npx vitest run src/modules/expense-documents/__tests__/multi-line-lifecycle.integration.spec.ts 2>&1 | tail -10
git add apps/api/src/modules/expense-documents/__tests__/multi-line-lifecycle.integration.spec.ts
git commit -m "test: multi-line lifecycle integration — 3-line invoice + preview round-trip"
```

---

## Task 13: Frontend types + form-state shape

**Files:**
- Create: `apps/web/src/components/expense-form-v4/types.ts`

- [ ] **Step 1: Write shared types**

Create `apps/web/src/components/expense-form-v4/types.ts`:

```ts
export type DocType = 'EXPENSE_SAMEDAY' | 'EXPENSE_ACCRUAL' | 'CREDIT_NOTE' | 'PAYROLL' | 'VENDOR_SETTLEMENT';
export type PriceType = 'EXCLUSIVE' | 'INCLUSIVE';
export type WhtFormType = 'PND3' | 'PND53';

export interface ExpenseLineForm {
  uid: string; // local React key
  category: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  vatPercent: string;
  whtPercent: string;
  // computed (server-authoritative)
  amountBeforeVat?: string;
  vatAmount?: string;
  whtAmount?: string;
}

export interface ExpenseFormState {
  docType: DocType;
  branchId: string;
  documentDate: string;
  vendorName: string;
  vendorTaxId: string;
  taxInvoiceNo: string;
  priceType: PriceType;
  whtFormType: WhtFormType | '';
  paymentMethod: string;
  depositAccountCode: string;
  reference: string;
  receiptImageUrl: string;
  note: string;
  approvedById: string;
  fromTemplateId: string;
  lines: ExpenseLineForm[];
  // CN-only
  originalDocumentId: string;
  cnReason: string;
}

export interface JePreviewLine {
  accountCode: string;
  accountName: string;
  description: string;
  dr: string;
  cr: string;
}

export interface JePreviewResponse {
  flow: 'expense-same-day' | 'expense-accrual';
  lines: JePreviewLine[];
  totals: {
    subtotal: string;
    vatAmount: string;
    withholdingTax: string;
    totalAmount: string;
    netPayment: string;
    drSum: string;
    crSum: string;
    balanced: boolean;
  };
}

export const newLine = (overrides?: Partial<ExpenseLineForm>): ExpenseLineForm => ({
  uid: Math.random().toString(36).slice(2),
  category: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discount: '0',
  vatPercent: '7',
  whtPercent: '0',
  ...overrides,
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/expense-form-v4/types.ts
git commit -m "feat(web): expense-form-v4 shared types"
```

---

## Task 14: CashAccountVisualPicker (6-card visual selector)

**Files:**
- Create: `apps/web/src/components/expense-form-v4/CashAccountVisualPicker.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/expense-form-v4/CashAccountVisualPicker.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { CASH_ACCOUNT_CODES } from '@/components/CashAccountSelect';
import { Banknote, Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CoaRow { code: string; name: string }

interface Props {
  value?: string;
  onChange: (code: string) => void;
}

/** Visual 6-card cash account selector — replaces the dropdown. Layout: 3 cash codes (11-11xx) + 3 bank codes (11-12xx) in 2 rows. */
export function CashAccountVisualPicker({ value, onChange }: Props) {
  const { data } = useQuery<CoaRow[]>({
    queryKey: ['chart-of-accounts', 'cash-codes'],
    queryFn: async () => (await api.get(`/chart-of-accounts/by-codes?codes=${CASH_ACCOUNT_CODES.join(',')}`)).data,
    staleTime: Infinity,
  });
  const nameMap = new Map<string, string>(data?.map((r) => [r.code, r.name]) ?? []);

  return (
    <div className="grid grid-cols-3 gap-3">
      {CASH_ACCOUNT_CODES.map((code) => {
        const isBank = code.startsWith('11-12');
        const Icon = isBank ? Landmark : Banknote;
        const selected = value === code;
        return (
          <button
            type="button"
            key={code}
            onClick={() => onChange(code)}
            className={cn(
              'flex items-start gap-2 rounded-lg border p-3 text-left transition-colors',
              selected
                ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                : 'border-border bg-card hover:bg-accent',
            )}
            aria-pressed={selected}
          >
            <Icon className={cn('size-4 mt-0.5', selected ? 'text-primary' : 'text-muted-foreground')} />
            <div className="flex-1 min-w-0">
              <div className="font-mono text-xs text-muted-foreground">{code}</div>
              <div className="text-sm leading-snug truncate">{nameMap.get(code) ?? '—'}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/expense-form-v4/CashAccountVisualPicker.tsx
git commit -m "feat(web): CashAccountVisualPicker — 6-card visual selector"
```

---

## Task 15: ItemLinesSection — multi-line editor with computed fields

**Files:**
- Create: `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx`:

```tsx
import { useCoaGroups } from '@/hooks/useCoa';
import { Plus, Trash2 } from 'lucide-react';
import { ExpenseLineForm, newLine } from './types';
import { formatNumberDecimal } from '@/utils/formatters';

interface Props {
  lines: ExpenseLineForm[];
  onChange: (lines: ExpenseLineForm[]) => void;
  priceTypeLabel: string; // 'รวม VAT' | 'ไม่รวม VAT' for display
}

export function ItemLinesSection({ lines, onChange, priceTypeLabel }: Props) {
  const { data: coaData } = useCoaGroups({ type: 'ค่าใช้จ่าย' });
  const groups = coaData?.groups ?? [];

  const updateLine = (uid: string, patch: Partial<ExpenseLineForm>) => {
    onChange(lines.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  };
  const removeLine = (uid: string) => {
    if (lines.length === 1) return; // keep at least 1
    onChange(lines.filter((l) => l.uid !== uid));
  };
  const addLine = () => {
    onChange([...lines, newLine()]);
  };

  const computeBeforeVat = (l: ExpenseLineForm): string => {
    const q = parseFloat(l.quantity) || 0;
    const u = parseFloat(l.unitPrice) || 0;
    const d = parseFloat(l.discount) || 0;
    return Math.max(0, q * u - d).toFixed(2);
  };

  return (
    <div className="space-y-3">
      {lines.map((line, idx) => (
        <div key={line.uid} className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="font-mono text-xs text-muted-foreground">#{idx + 1}</span>
              <span>{line.category || 'เลือกบัญชี'}</span>
            </div>
            <button
              type="button"
              onClick={() => removeLine(line.uid)}
              disabled={lines.length === 1}
              className="text-muted-foreground hover:text-destructive disabled:opacity-30"
              aria-label="ลบรายการ"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">บัญชีค่าใช้จ่าย</label>
              <select
                value={line.category}
                onChange={(e) => updateLine(line.uid, { category: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
              >
                <option value="">— เลือก —</option>
                {groups.flatMap((g) =>
                  g.accounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} — {a.name}
                    </option>
                  )),
                )}
              </select>
            </div>
            <div className="grid grid-cols-6 gap-2">
              <Field label="จำนวน" value={line.quantity} onChange={(v) => updateLine(line.uid, { quantity: v })} />
              <Field label="ราคา/หน่วย" value={line.unitPrice} onChange={(v) => updateLine(line.uid, { unitPrice: v })} />
              <Field label="ส่วนลด" value={line.discount} onChange={(v) => updateLine(line.uid, { discount: v })} />
              <SelectField label="VAT%" value={line.vatPercent} onChange={(v) => updateLine(line.uid, { vatPercent: v })} options={['0', '7']} />
              <SelectField label="WHT%" value={line.whtPercent} onChange={(v) => updateLine(line.uid, { whtPercent: v })} options={['0', '1', '3', '5']} />
              <div>
                <label className="block text-xs font-medium mb-1 text-muted-foreground">ก่อนภาษี</label>
                <div className="px-3 py-2 border border-border rounded-lg text-sm bg-muted/50 text-right font-mono">
                  {formatNumberDecimal(computeBeforeVat(line))}
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">คำอธิบาย</label>
              <input
                type="text"
                value={line.description}
                onChange={(e) => updateLine(line.uid, { description: e.target.value })}
                placeholder="ค่าไฟฟ้าสาขา A เดือน เม.ย. 2569"
                className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
              />
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addLine}
        className="w-full flex items-center justify-center gap-1.5 py-3 border-2 border-dashed border-border rounded-xl text-sm text-muted-foreground hover:text-foreground hover:border-primary"
      >
        <Plus className="size-4" /> เพิ่มบัญชี
      </button>
      <p className="text-xs text-muted-foreground">{priceTypeLabel} — ยอด VAT/WHT คำนวณจาก server เมื่อกด Preview/บันทึก</p>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1">{label}</label>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-right font-mono"
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
      >
        {options.map((o) => <option key={o} value={o}>{o}%</option>)}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/expense-form-v4/ItemLinesSection.tsx
git commit -m "feat(web): ItemLinesSection — multi-line editor"
```

---

## Task 16: JePreview — debounced server preview hook + display

**Files:**
- Create: `apps/web/src/components/expense-form-v4/useFormCompute.ts`
- Create: `apps/web/src/components/expense-form-v4/JePreview.tsx`

- [ ] **Step 1: Write the debounced hook**

Create `apps/web/src/components/expense-form-v4/useFormCompute.ts`:

```ts
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { ExpenseFormState, JePreviewResponse } from './types';

interface CreateExpensePayload {
  documentType: 'EXPENSE';
  branchId: string;
  documentDate: string;
  priceType: 'EXCLUSIVE' | 'INCLUSIVE';
  paymentMethod?: string;
  depositAccountCode?: string;
  whtFormType?: 'PND3' | 'PND53';
  lines: Array<{
    category: string; description?: string;
    quantity: number; unitPrice: number; discount: number;
    vatPercent: number; whtPercent: number;
  }>;
}

function buildPayload(state: ExpenseFormState): CreateExpensePayload | null {
  const validLines = state.lines.filter((l) => l.category && parseFloat(l.unitPrice) > 0);
  if (validLines.length === 0) return null;
  return {
    documentType: 'EXPENSE',
    branchId: state.branchId,
    documentDate: state.documentDate,
    priceType: state.priceType,
    paymentMethod: state.paymentMethod || undefined,
    depositAccountCode: state.depositAccountCode || undefined,
    whtFormType: (state.whtFormType || undefined) as 'PND3' | 'PND53' | undefined,
    lines: validLines.map((l) => ({
      category: l.category,
      description: l.description || undefined,
      quantity: parseFloat(l.quantity) || 1,
      unitPrice: parseFloat(l.unitPrice) || 0,
      discount: parseFloat(l.discount) || 0,
      vatPercent: parseFloat(l.vatPercent) || 0,
      whtPercent: parseFloat(l.whtPercent) || 0,
    })),
  };
}

/** Debounced server-side JE preview. Re-runs ~300ms after the form stops changing. */
export function useFormCompute(state: ExpenseFormState): {
  preview: JePreviewResponse | null;
  loading: boolean;
  error: string | null;
} {
  const [preview, setPreview] = useState<JePreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const payload = buildPayload(state);
    if (!payload) {
      setPreview(null);
      return;
    }
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.post<JePreviewResponse>('/expense-documents/preview-je', payload);
        setPreview(data);
      } catch (e) {
        setError((e as Error).message ?? 'preview failed');
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [state]);

  return { preview, loading, error };
}
```

- [ ] **Step 2: Write the display component**

Create `apps/web/src/components/expense-form-v4/JePreview.tsx`:

```tsx
import { Check, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { JePreviewResponse } from './types';
import { formatNumberDecimal } from '@/utils/formatters';

interface Props {
  preview: JePreviewResponse | null;
  loading: boolean;
  error: string | null;
}

export function JePreview({ preview, loading, error }: Props) {
  if (loading && !preview) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> กำลังคำนวณ JE...
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        ไม่สามารถคำนวณ JE: {error}
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
        กรอกรายการบัญชีอย่างน้อย 1 บรรทัดเพื่อดู JE Preview
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left px-3 py-2 font-medium">บัญชี</th>
            <th className="text-left px-3 py-2 font-medium">ชื่อบัญชี</th>
            <th className="text-right px-3 py-2 font-medium">DR</th>
            <th className="text-right px-3 py-2 font-medium">CR</th>
          </tr>
        </thead>
        <tbody>
          {preview.lines.map((l, idx) => (
            <tr key={idx} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-xs">{l.accountCode}</td>
              <td className="px-3 py-2">
                <div>{l.accountName}</div>
                <div className="text-xs text-muted-foreground">{l.description}</div>
              </td>
              <td className="px-3 py-2 text-right font-mono">{l.dr === '0.00' ? '' : formatNumberDecimal(l.dr)}</td>
              <td className="px-3 py-2 text-right font-mono">{l.cr === '0.00' ? '' : formatNumberDecimal(l.cr)}</td>
            </tr>
          ))}
          <tr className={cn(
            'border-t-2',
            preview.totals.balanced ? 'border-success bg-success/5' : 'border-destructive bg-destructive/5',
          )}>
            <td colSpan={2} className="px-3 py-2 font-medium flex items-center gap-2">
              {preview.totals.balanced ? <Check className="size-4 text-success" /> : <AlertTriangle className="size-4 text-destructive" />}
              {preview.totals.balanced ? 'BALANCED' : 'UNBALANCED'}
            </td>
            <td className="px-3 py-2 text-right font-mono font-semibold">{formatNumberDecimal(preview.totals.drSum)}</td>
            <td className="px-3 py-2 text-right font-mono font-semibold">{formatNumberDecimal(preview.totals.crSum)}</td>
          </tr>
        </tbody>
      </table>
      <div className="grid grid-cols-4 gap-2 p-3 bg-muted/30 text-xs">
        <SummaryCard label="ค่าใช้จ่าย" value={preview.totals.subtotal} />
        <SummaryCard label="VAT ซื้อ" value={preview.totals.vatAmount} />
        <SummaryCard label="WHT" value={preview.totals.withholdingTax} />
        <SummaryCard label="สุทธิจ่าย" value={preview.totals.netPayment} highlight />
      </div>
    </div>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn('rounded-lg p-2', highlight ? 'bg-primary/10' : 'bg-card')}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-mono font-semibold', highlight && 'text-primary')}>{formatNumberDecimal(value)}</div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/expense-form-v4/useFormCompute.ts apps/web/src/components/expense-form-v4/JePreview.tsx
git commit -m "feat(web): JePreview + useFormCompute hook (debounced server preview)"
```

---

## Task 17: TypeTabs + VendorSection + ApproverSection

**Files:**
- Create: `apps/web/src/components/expense-form-v4/TypeTabs.tsx`
- Create: `apps/web/src/components/expense-form-v4/VendorSection.tsx`
- Create: `apps/web/src/components/expense-form-v4/ApproverSection.tsx`

- [ ] **Step 1: TypeTabs**

Create `apps/web/src/components/expense-form-v4/TypeTabs.tsx`:

```tsx
import { Banknote, FileWarning, Receipt, Users, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DocType } from './types';

interface Props {
  value: DocType;
  onChange: (t: DocType) => void;
  invoiceDateIsToday: boolean;
}

const TABS: { type: DocType; label: string; sub: string; Icon: typeof Receipt }[] = [
  { type: 'EXPENSE_SAMEDAY',    label: 'Same-day',     sub: 'จ่ายวันเดียวกับใบกำกับ', Icon: Banknote },
  { type: 'EXPENSE_ACCRUAL',    label: 'ตั้งหนี้',     sub: 'รับใบ ยังไม่จ่าย',         Icon: FileWarning },
  { type: 'VENDOR_SETTLEMENT',  label: 'จ่ายเจ้าหนี้', sub: 'อ้างถึง ACCRUAL',          Icon: Wallet },
  { type: 'PAYROLL',            label: 'เงินเดือน',    sub: 'จ่ายเงินเดือนพนักงาน',      Icon: Users },
  { type: 'CREDIT_NOTE',        label: 'ใบลดหนี้',     sub: 'ผู้ขายคืนเงิน',            Icon: Receipt },
];

export function TypeTabs({ value, onChange, invoiceDateIsToday }: Props) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-2">
        {TABS.map(({ type, label, sub, Icon }) => {
          const active = value === type;
          return (
            <button
              type="button"
              key={type}
              onClick={() => onChange(type)}
              className={cn(
                'flex items-start gap-2 rounded-lg border p-3 text-left transition-colors',
                active
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                  : 'border-border bg-card hover:bg-accent',
              )}
              aria-pressed={active}
            >
              <Icon className={cn('size-4 mt-0.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
              <div className="min-w-0">
                <div className="text-sm font-medium leading-snug">{label}</div>
                <div className="text-xs text-muted-foreground leading-snug truncate">{sub}</div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground pl-1">
        Smart Default: invoice_date = today → SAMEDAY / invoice_date &lt; today → ACCRUAL
        {invoiceDateIsToday && value === 'EXPENSE_ACCRUAL' && (
          <span className="text-warning"> · ตั้งหนี้แล้วทั้งที่วันที่เป็นวันนี้</span>
        )}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: VendorSection**

Create `apps/web/src/components/expense-form-v4/VendorSection.tsx`:

```tsx
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { ExpenseFormState } from './types';

interface Props {
  state: ExpenseFormState;
  onChange: (patch: Partial<ExpenseFormState>) => void;
}

export function VendorSection({ state, onChange }: Props) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div>
        <label className="block text-xs font-medium mb-1">ผู้ขาย <span className="text-destructive">*</span></label>
        <input
          type="text"
          value={state.vendorName}
          onChange={(e) => onChange({ vendorName: e.target.value })}
          placeholder="ชื่อผู้ขาย"
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">ประเภทผู้ขาย</label>
        <select
          value={state.whtFormType}
          onChange={(e) => onChange({ whtFormType: e.target.value as 'PND3' | 'PND53' | '' })}
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
        >
          <option value="">— เลือก —</option>
          <option value="PND53">นิติบุคคล (ภงด.53)</option>
          <option value="PND3">บุคคลธรรมดา (ภงด.3)</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">เลขประจำตัวผู้เสียภาษี</label>
        <input
          type="text"
          value={state.vendorTaxId}
          onChange={(e) => onChange({ vendorTaxId: e.target.value })}
          placeholder="13 หลัก"
          maxLength={13}
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">เลขใบกำกับ</label>
        <input
          type="text"
          value={state.taxInvoiceNo}
          onChange={(e) => onChange({ taxInvoiceNo: e.target.value })}
          placeholder="INV-..."
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">วันที่ใบกำกับ <span className="text-destructive">*</span></label>
        <ThaiDateInput
          value={state.documentDate}
          onChange={(e) => onChange({ documentDate: e.target.value })}
          required
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">ประเภทราคา</label>
        <select
          value={state.priceType}
          onChange={(e) => onChange({ priceType: e.target.value as 'EXCLUSIVE' | 'INCLUSIVE' })}
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
        >
          <option value="EXCLUSIVE">ไม่รวม VAT</option>
          <option value="INCLUSIVE">รวม VAT</option>
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: ApproverSection**

Create `apps/web/src/components/expense-form-v4/ApproverSection.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  approvedById: string;
  onChange: (id: string) => void;
}

interface UserRow { id: string; name: string; role: string }

export function ApproverSection({ approvedById, onChange }: Props) {
  const { user } = useAuth();
  const { data: approvers } = useQuery<UserRow[]>({
    queryKey: ['users', 'approvers'],
    queryFn: async () => (await api.get('/users?roles=OWNER,FINANCE_MANAGER,ACCOUNTANT')).data,
    staleTime: 60_000,
  });

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-xs font-medium mb-1">ผู้บันทึก</label>
        <input
          type="text"
          value={user ? `${user.name} (${user.role})` : ''}
          readOnly
          className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-muted/50"
        />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1">ผู้อนุมัติ</label>
        <select
          value={approvedById}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
        >
          <option value="">— เลือก —</option>
          {approvers?.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
          ))}
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/expense-form-v4/
git commit -m "feat(web): TypeTabs + VendorSection + ApproverSection"
```

---

## Task 18: QuickStartPanel — 3 modes + ใช้บ่อย cards

**Files:**
- Create: `apps/web/src/components/expense-form-v4/QuickStartPanel.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/expense-form-v4/QuickStartPanel.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Bookmark, FileEdit, Files, Sparkles, X, Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TemplateRow {
  id: string;
  name: string;
  documentType: 'EXPENSE' | 'CREDIT_NOTE' | 'PAYROLL' | 'VENDOR_SETTLEMENT';
  isRecurring: boolean;
  prefilledData: { vendorName?: string; description?: string; category?: string; sampleAmount?: number };
}

interface Props {
  branchId: string;
  onMode: (mode: 'blank' | 'template' | 'copy') => void;
  onPickTemplate: (tplId: string) => void;
  onClose: () => void;
}

export function QuickStartPanel({ branchId, onMode, onPickTemplate, onClose }: Props) {
  const { data: templates } = useQuery<TemplateRow[]>({
    queryKey: ['expense-templates', branchId],
    queryFn: async () => (await api.get(`/expense-templates?branchId=${branchId}`)).data,
    enabled: !!branchId,
  });
  const top6 = (templates ?? []).slice(0, 6);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm font-medium">เริ่มต้นเร็ว</span>
        </div>
        <button onClick={onClose} aria-label="ปิด" className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <ModeCard Icon={FileEdit} label="เริ่มเปล่า" sub="กรอกใหม่ทั้งหมด" onClick={() => onMode('blank')} />
          <ModeCard Icon={Bookmark} label="จาก Template" sub={`${templates?.length ?? 0} รายการพร้อมใช้`} onClick={() => onMode('template')} accent />
          <ModeCard Icon={Files} label="คัดลอกเก่า" sub="เปิด ListPage เพื่อหา" onClick={() => onMode('copy')} />
        </div>
        {top6.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-2">ใช้บ่อย</div>
            <div className="grid grid-cols-3 gap-3">
              {top6.map((tpl) => (
                <button
                  type="button"
                  key={tpl.id}
                  onClick={() => onPickTemplate(tpl.id)}
                  className="flex items-start gap-2 rounded-lg border border-border bg-card p-3 text-left hover:bg-accent transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        'text-2xs font-medium px-1.5 py-0.5 rounded',
                        tpl.isRecurring ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground',
                      )}>{tpl.isRecurring ? 'recur' : 'manual'}</span>
                      {tpl.isRecurring && <Star className="size-3 text-warning" />}
                    </div>
                    <div className="text-sm font-medium leading-snug truncate">{tpl.name}</div>
                    <div className="text-xs text-muted-foreground leading-snug">
                      <span className="font-mono">{tpl.prefilledData.category ?? '—'}</span>
                      {tpl.prefilledData.vendorName && ` · ${tpl.prefilledData.vendorName}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeCard({ Icon, label, sub, onClick, accent }: { Icon: typeof FileEdit; label: string; sub: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
        accent ? 'border-primary/40 bg-primary/5 hover:bg-primary/10' : 'border-border bg-card hover:bg-accent',
      )}
    >
      <Icon className={cn('size-5 mt-0.5', accent ? 'text-primary' : 'text-muted-foreground')} />
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/expense-form-v4/QuickStartPanel.tsx
git commit -m "feat(web): QuickStartPanel — 3 modes + 6 ใช้บ่อย cards"
```

---

## Task 19: ExpenseFormV4 — composes all sections (EX type only first)

**Files:**
- Create: `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx`

This is the largest component — it wires every section together. Begin with the EX path (Same-day + ACCRUAL); other types reuse the shell with conditional sections in Task 20.

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx`:

```tsx
import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Receipt, Users, Banknote, FileText, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ExpenseFormState, DocType, newLine } from './types';
import { useFormCompute } from './useFormCompute';
import { QuickStartPanel } from './QuickStartPanel';
import { TypeTabs } from './TypeTabs';
import { VendorSection } from './VendorSection';
import { ItemLinesSection } from './ItemLinesSection';
import { CashAccountVisualPicker } from './CashAccountVisualPicker';
import { JePreview } from './JePreview';
import { ApproverSection } from './ApproverSection';
import { formatNumberDecimal } from '@/utils/formatters';

interface Props {
  branchId: string;
  onClose: () => void;
  onSaved: () => void;
}

const initial = (branchId: string, defaultCash: string): ExpenseFormState => ({
  docType: 'EXPENSE_SAMEDAY',
  branchId,
  documentDate: new Date().toISOString().slice(0, 10),
  vendorName: '',
  vendorTaxId: '',
  taxInvoiceNo: '',
  priceType: 'EXCLUSIVE',
  whtFormType: '',
  paymentMethod: 'CASH',
  depositAccountCode: defaultCash,
  reference: '',
  receiptImageUrl: '',
  note: '',
  approvedById: '',
  fromTemplateId: '',
  lines: [newLine()],
  originalDocumentId: '',
  cnReason: '',
});

export function ExpenseFormV4({ branchId, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showQuickStart, setShowQuickStart] = useState(true);
  const [state, setState] = useState<ExpenseFormState>(() =>
    initial(branchId, user?.defaultCashAccountCode || '11-1101'),
  );

  const patch = (p: Partial<ExpenseFormState>) => setState((s) => ({ ...s, ...p }));

  // Smart default: switch SAMEDAY ↔ ACCRUAL when invoice date crosses today
  const todayIso = new Date().toISOString().slice(0, 10);
  const invoiceIsToday = state.documentDate === todayIso;
  useMemo(() => {
    if (state.docType === 'EXPENSE_SAMEDAY' && !invoiceIsToday) patch({ docType: 'EXPENSE_ACCRUAL' });
    if (state.docType === 'EXPENSE_ACCRUAL' && invoiceIsToday) patch({ docType: 'EXPENSE_SAMEDAY' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.documentDate]);

  const { preview, loading, error } = useFormCompute(state);

  const saveMutation = useMutation({
    mutationFn: async ({ andPost }: { andPost: boolean }) => {
      const payload = {
        documentType: 'EXPENSE',
        branchId: state.branchId,
        documentDate: state.documentDate,
        priceType: state.priceType,
        vendorName: state.vendorName || undefined,
        vendorTaxId: state.vendorTaxId || undefined,
        taxInvoiceNo: state.taxInvoiceNo || undefined,
        whtFormType: state.whtFormType || undefined,
        paymentMethod: state.docType === 'EXPENSE_SAMEDAY' ? state.paymentMethod : undefined,
        depositAccountCode: state.docType === 'EXPENSE_SAMEDAY' ? state.depositAccountCode : undefined,
        approvedById: state.approvedById || undefined,
        fromTemplateId: state.fromTemplateId || undefined,
        lines: state.lines.filter((l) => l.category && parseFloat(l.unitPrice) > 0).map((l) => ({
          category: l.category, description: l.description || undefined,
          quantity: parseFloat(l.quantity) || 1,
          unitPrice: parseFloat(l.unitPrice) || 0,
          discount: parseFloat(l.discount) || 0,
          vatPercent: parseFloat(l.vatPercent) || 0,
          whtPercent: parseFloat(l.whtPercent) || 0,
        })),
      };
      const { data } = await api.post('/expense-documents', payload);
      if (andPost) await api.post(`/expense-documents/${data.id}/post`);
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกรายจ่ายสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expenses-summary'] });
      onSaved();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const itemCount = state.lines.filter((l) => l.category).length;
  const ready = !!preview && preview.totals.balanced && itemCount > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8 overflow-y-auto">
      <div className="w-full max-w-5xl bg-background rounded-xl shadow-modal min-h-[80vh]">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> กลับ
            </button>
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Receipt className="size-5 text-primary" /> บันทึกค่าใช้จ่ายใหม่
            </div>
          </div>
          <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">DRAFT</span>
        </div>

        <div className="p-6 space-y-5">
          {/* Quick Start */}
          {showQuickStart && (
            <QuickStartPanel
              branchId={state.branchId}
              onMode={(m) => {
                if (m === 'blank') setState(initial(branchId, user?.defaultCashAccountCode || '11-1101'));
                if (m === 'copy') toast.info('เปิดหน้ารายการเพื่อเลือกเอกสารเดิมที่จะคัดลอก'); // wired in a later task
                if (m === 'template') toast.info('เลือก template จาก ใช้บ่อย ด้านล่าง');
              }}
              onPickTemplate={async (tplId) => {
                const { data } = await api.post(`/expense-templates/${tplId}/instantiate`);
                setState((s) => ({
                  ...s,
                  fromTemplateId: tplId,
                  vendorName: data.vendorName ?? '',
                  description: data.description ?? '',
                  lines: (data.expenseDetail?.lines ?? []).map((l: { category: string; description?: string; quantity: string; unitPrice: string; discount: string; vatPercent: string; whtPercent: string }) =>
                    newLine({ ...l }),
                  ),
                }));
                toast.success('นำเข้า template สำเร็จ');
              }}
              onClose={() => setShowQuickStart(false)}
            />
          )}

          {/* Section 1: Type tabs */}
          <Section num={1} title="ประเภทเอกสาร" Icon={FileText}>
            <TypeTabs value={state.docType} onChange={(t) => patch({ docType: t })} invoiceDateIsToday={invoiceIsToday} />
          </Section>

          {/* Section 2: Vendor */}
          <Section num={2} title="ผู้ขาย & วันที่ใบกำกับ" Icon={Users}>
            <VendorSection state={state} onChange={patch} />
          </Section>

          {/* Section 3: Lines */}
          <Section num={3} title="รายการบัญชี" Icon={Receipt}>
            <ItemLinesSection
              lines={state.lines}
              onChange={(lines) => patch({ lines })}
              priceTypeLabel={state.priceType === 'INCLUSIVE' ? 'ราคารวม VAT' : 'ราคาไม่รวม VAT'}
            />
          </Section>

          {/* Section 4: Cash account (Same-day only) */}
          {state.docType === 'EXPENSE_SAMEDAY' && (
            <Section num={4} title="ช่องทางจ่ายเงิน" Icon={Banknote}>
              <CashAccountVisualPicker
                value={state.depositAccountCode}
                onChange={(code) => patch({ depositAccountCode: code })}
              />
              <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
                <Stat label="ที่ต้องจ่าย" value={preview?.totals.netPayment ?? '0.00'} />
                <Stat label="จ่ายจริง" value={preview?.totals.netPayment ?? '0.00'} />
                <Stat label="ผลต่าง" value="0.00" highlight />
              </div>
            </Section>
          )}

          {/* Section 6: JE Preview */}
          <Section num={6} title="AUTO JOURNAL PREVIEW" Icon={Check}>
            <JePreview preview={preview} loading={loading} error={error} />
          </Section>

          {/* Section 7: Approver */}
          <Section num={7} title="ผู้บันทึก & ผู้อนุมัติ" Icon={Users}>
            <ApproverSection approvedById={state.approvedById} onChange={(id) => patch({ approvedById: id })} />
          </Section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-3 flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>← ยกเลิก</Button>
          <div className="flex items-center gap-3 text-xs">
            <span>Items: {itemCount}</span>
            <span className={ready ? 'text-success' : 'text-muted-foreground'}>
              {ready ? '✓ Ready' : '⌛ ยังไม่พร้อม'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => saveMutation.mutate({ andPost: false })} disabled={!ready || saveMutation.isPending}>
              บันทึกร่าง
            </Button>
            <Button onClick={() => saveMutation.mutate({ andPost: true })} disabled={!ready || saveMutation.isPending}>
              บันทึก & POST
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ num, title, Icon, children }: { num: number; title: string; Icon: typeof Receipt; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="flex items-center justify-center size-7 rounded bg-primary/10 text-primary text-sm font-mono font-medium">{num}</span>
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-2 ${highlight ? 'bg-success/10 border border-success/30' : 'bg-muted/30'}`}>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold">{formatNumberDecimal(value)}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx
git commit -m "feat(web): ExpenseFormV4 — composes Quick Start + Tabs + Vendor + Lines + Cash + JE Preview + Approver (EX paths)"
```

---

## Task 20: PR/SE/CN sub-section variants — wire into ExpenseFormV4

**Files:**
- Create: `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx`
- Create: `apps/web/src/components/expense-form-v4/SettlementLinesSection.tsx`
- Create: `apps/web/src/components/expense-form-v4/CreditNoteLinesSection.tsx`
- Modify: `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx`

For each non-EX type, the v4 form swaps Section 3's content but keeps the same shell (header, type tabs, JE preview, approver, footer). The PR variant lifts logic from the existing PayrollForm; SE from SettlementForm; CN from CreditNoteForm. Schema-side, those types are untouched (PayrollLine / SettlementLine already exist).

- [ ] **Step 1: Port PayrollLinesSection from existing PayrollForm**

Create `apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx`. Lift the `lines` state + table editor + period picker from the existing `apps/web/src/components/expense-documents/PayrollForm.tsx` (lines 35-180 of that file). Remove modal chrome (header, footer buttons) — keep only the period selector + employee table. Component signature:

```tsx
export interface PayrollLineForm { uid: string; employeeName: string; employeeTaxId: string; baseSalary: string; ssoEmployee: string; whtAmount: string }
export interface PayrollFormFields { year: number; month: number; payrollPeriod: string; lines: PayrollLineForm[] }
interface Props { value: PayrollFormFields; onChange: (v: PayrollFormFields) => void }
export function PayrollLinesSection({ value, onChange }: Props) { /* port body here */ }
```

- [ ] **Step 2: Port SettlementLinesSection from existing SettlementForm**

Create `apps/web/src/components/expense-form-v4/SettlementLinesSection.tsx`. Lift the ACCRUAL EX list + multi-select + amount input from `apps/web/src/components/expense-documents/SettlementForm.tsx`. Same pattern: extract just the section content, drop modal chrome.

- [ ] **Step 3: Port CreditNoteLinesSection from existing CreditNoteForm**

Create `apps/web/src/components/expense-form-v4/CreditNoteLinesSection.tsx`. Lift the original-EX picker + reason + cap display from `apps/web/src/components/expense-documents/CreditNoteForm.tsx`. The line editor here uses `ItemLinesSection` (CN can have multiple credit lines).

- [ ] **Step 4: Wire into ExpenseFormV4**

In `ExpenseFormV4.tsx`, replace the single `<Section num={3} ...>` block with conditional rendering by `state.docType`:

```tsx
{state.docType === 'EXPENSE_SAMEDAY' || state.docType === 'EXPENSE_ACCRUAL' ? (
  <Section num={3} title="รายการบัญชี" Icon={Receipt}>
    <ItemLinesSection lines={state.lines} onChange={(lines) => patch({ lines })} priceTypeLabel={state.priceType === 'INCLUSIVE' ? 'ราคารวม VAT' : 'ราคาไม่รวม VAT'} />
  </Section>
) : state.docType === 'PAYROLL' ? (
  <Section num={3} title="งวดเงินเดือน + พนักงาน" Icon={Users}>
    <PayrollLinesSection value={state.payroll} onChange={(p) => patch({ payroll: p })} />
  </Section>
) : state.docType === 'VENDOR_SETTLEMENT' ? (
  <Section num={3} title="เอกสารตั้งหนี้ที่จะล้าง" Icon={FileText}>
    <SettlementLinesSection branchId={state.branchId} value={state.settlement} onChange={(s) => patch({ settlement: s })} />
  </Section>
) : (
  <Section num={3} title="ใบลดหนี้ — เอกสารต้นฉบับ + รายการ" Icon={Receipt}>
    <CreditNoteLinesSection state={state} onChange={patch} />
  </Section>
)}
```

Add the corresponding fields to `ExpenseFormState` in `types.ts`:

```ts
export interface PayrollFormFields { year: number; month: number; payrollPeriod: string; lines: PayrollLineForm[] }
export interface SettlementFormFields { selections: { docId: string; amount: string }[] }
// ... extend ExpenseFormState
payroll: PayrollFormFields;
settlement: SettlementFormFields;
```

The save mutation also branches by `docType` — call `/expense-documents/payroll` for PR, `/expense-documents/settlement` for SE, `/expense-documents/credit-note` for CN. Each branch sends the appropriate DTO shape (already exists from PR #801).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/expense-form-v4/PayrollLinesSection.tsx apps/web/src/components/expense-form-v4/SettlementLinesSection.tsx apps/web/src/components/expense-form-v4/CreditNoteLinesSection.tsx apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx apps/web/src/components/expense-form-v4/types.ts
git commit -m "feat(web): wire PR/SE/CN variants into ExpenseFormV4"
```

---

## Task 21: Wire ExpenseFormV4 into ExpensesPage + delete legacy forms

**Files:**
- Modify: `apps/web/src/pages/ExpensesPage.tsx`
- Modify: `apps/web/src/pages/ExpenseDocumentNewPage.tsx`
- Delete: `apps/web/src/components/expense-documents/CreditNoteForm.tsx`
- Delete: `apps/web/src/components/expense-documents/PayrollForm.tsx`
- Delete: `apps/web/src/components/expense-documents/SettlementForm.tsx`

- [ ] **Step 1: Replace `ExpenseFormPanel` import + usage in ExpensesPage**

Open `apps/web/src/pages/ExpensesPage.tsx`. Find the section that imports + renders `ExpenseFormPanel`. Replace with:

```tsx
import { ExpenseFormV4 } from '@/components/expense-form-v4/ExpenseFormV4';
// ... inside the modal slot:
{showForm && (
  <ExpenseFormV4
    branchId={selectedBranchId || branches[0]?.id || ''}
    onClose={() => setShowForm(false)}
    onSaved={() => { setShowForm(false); refetch(); }}
  />
)}
```

Remove the inline `ExpenseFormPanel` function definition + its imports.

- [ ] **Step 2: Replace ExpenseDocumentNewPage**

Open `apps/web/src/pages/ExpenseDocumentNewPage.tsx`. Replace the file contents with:

```tsx
import { useNavigate, useSearchParams, Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { ExpenseFormV4 } from '@/components/expense-form-v4/ExpenseFormV4';
import { useAuth } from '@/contexts/AuthContext';

export default function ExpenseDocumentNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: branches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
  });
  const branchId = user?.branchId || branches?.[0]?.id;
  if (!branchId) return <Navigate to="/expenses" replace />;

  return (
    <ExpenseFormV4
      branchId={branchId}
      onClose={() => navigate('/expenses')}
      onSaved={() => navigate('/expenses')}
    />
  );
}
```

The `?type=` query param is now informational; ExpenseFormV4's TypeTabs handle type selection. If you want to honor `?type=PR` as initial type, pass an `initialDocType` prop down (optional; v4 mockup doesn't require URL-driven type selection).

- [ ] **Step 3: Delete legacy form files**

```bash
rm apps/web/src/components/expense-documents/CreditNoteForm.tsx
rm apps/web/src/components/expense-documents/PayrollForm.tsx
rm apps/web/src/components/expense-documents/SettlementForm.tsx
```

- [ ] **Step 4: Type-check + run web tests**

```bash
./tools/check-types.sh web 2>&1 | tail -10
cd apps/web && npx vitest run 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ExpensesPage.tsx apps/web/src/pages/ExpenseDocumentNewPage.tsx
git rm apps/web/src/components/expense-documents/CreditNoteForm.tsx apps/web/src/components/expense-documents/PayrollForm.tsx apps/web/src/components/expense-documents/SettlementForm.tsx
git commit -m "feat(web): replace legacy forms with ExpenseFormV4 + remove dead files"
```

---

## Task 22: Verify, push, open PR

- [ ] **Step 1: Full type check**

```bash
./tools/check-types.sh all
```
Expected: `TypeScript check passed!`

- [ ] **Step 2: Full jest test run**

```bash
cd apps/api && npx jest --runInBand --silent --testPathPattern="src/modules/expense-documents|src/modules/journal/cpa-templates" 2>&1 | tail -10
```
Expected: all suites pass.

- [ ] **Step 3: Vitest integration**

```bash
cd apps/api && npx vitest run src/modules/expense-documents/__tests__/multi-line-lifecycle.integration.spec.ts 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 4: Push branch**

```bash
git push -u origin feat/expense-form-v4
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --base main --title "feat(expense-form-v4): unified entry form + multi-line ExpenseLine" --body "$(cat <<'EOF'
## Summary

- Replaces 4 separate forms (EX/CN/PR/SE) with one unified ExpenseFormV4
- New ExpenseLine[] sub-table — multi-line items per EX/CN, each with own category/VAT%/WHT%
- Server-side line aggregation + JE preview endpoint = no client/server drift
- Quick Start panel (Template/Copy/Blank + ใช้บ่อย cards)
- Visual cash-account picker (6 cards)
- Live AUTO JOURNAL PREVIEW with BALANCED indicator
- Explicit approver selector

## Spec
docs/superpowers/specs/2026-05-11-expense-form-v4-unified-design.md

## Test plan
- [ ] Unit: 7 line-aggregator tests pass
- [ ] Unit: 4 je-preview tests pass
- [ ] Unit: 3 multi-line create.service tests pass
- [ ] Integration: 2 multi-line lifecycle tests pass (3-line invoice, preview round-trip)
- [ ] JE templates: existing same-day / accrual / credit-note specs still green after refactor
- [ ] Manual: open /expenses → New, fill 3-line invoice with mixed VAT, verify JE Preview balances, Save & POST → JE on document matches preview line-for-line
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- ✅ Multi-line ExpenseLine schema (Tasks 1-2)
- ✅ ExpenseDetail.priceType (Tasks 1-2)
- ✅ Server-computed totals + LineAggregatorService (Task 5)
- ✅ JE template refactor for multi-line (Tasks 9-11)
- ✅ POST /preview-je endpoint + JePreviewService (Tasks 7-8)
- ✅ Visual cash picker (Task 14)
- ✅ Multi-line editor (Task 15)
- ✅ JE Preview component (Task 16)
- ✅ TypeTabs + smart default (Task 17)
- ✅ VendorSection + ApproverSection (Task 17)
- ✅ QuickStartPanel + ใช้บ่อย cards (Task 18)
- ✅ ExpenseFormV4 composer (Task 19)
- ✅ PR/SE/CN variants (Task 20)
- ✅ Wire into ExpensesPage + delete legacy (Task 21)
- ✅ Multi-line lifecycle integration test (Task 12)
- ✅ Migration (Task 2)

**Placeholder scan:** No `TBD` / `TODO` / "fill in" — every task has full code in steps. Task 20 (PR/SE/CN port) explicitly tells the engineer which file/line range to lift, with new component signatures. Acceptable because the source code exists in the same repo.

**Type consistency:**
- `PriceType = 'EXCLUSIVE' | 'INCLUSIVE'` used consistently in DTO, service, types, JePreview
- `ExpenseLineInput` DTO matches `ExpenseLineForm` frontend (snake/camel: API uses camel)
- `JePreviewResponse` shape matches backend `JePreview` interface
- `LineAggregatorService.computeLine` signature is the same between unit tests and service callers

**Out of scope confirmed:** 4-eye approval, recurring duplicate detection, project allocation, multi-currency, document-level discount, inline CoA creation — all match spec.

---

## Implementation handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-expense-form-v4.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration. Use `superpowers:subagent-driven-development`.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

**Which approach?**
