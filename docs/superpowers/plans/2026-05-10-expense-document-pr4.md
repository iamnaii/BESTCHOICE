# PR-4: Vendor Settlement (SE) — Implementation Plan

**Goal:** Add VENDOR_SETTLEMENT document type — จ่ายเจ้าหนี้ that clears one or many ACCRUAL EX documents in a single payment. Schema additive (VendorSettlementDetail 1:1 + SettlementLine[]). New `VendorSettlementTemplate` JE clears AP + cash leg. Side effect: each cleared EX transitions ACCRUAL → POSTED + paidAt = SE.paidAt. Frontend SettlementForm uses multi-select picker over branch's pending ACCRUAL list.

**Architecture:** Reuses PR-1 polymorphic header. `VendorSettlementDetail` 1:1 with header, has `SettlementLine[]`. Each line: `clearedDocumentId` + `amountSettled`. JE: Dr 21-1104 (Σ amountSettled) / Cr cash (Σ - Σ wht) + Cr WHT account (Σ wht). Inside same tx, batch update all cleared EXs to POSTED. Validation: each cleared doc must be ACCRUAL + same branch + sum of prior settlements ≤ totalAmount.

**Branch:** `feat/expense-documents-pr4` (off `feat/expense-documents-pr3`).

**Spec refs:** §1.2 (VendorSettlementDetail/SettlementLine), §3.1 (SE lifecycle), §4.5 (VendorSettlementTemplate JE + side effects), §6.2 (form), §6.3 (validation).

**Note**: PR-4 unblocks ACCRUAL → POSTED transitions for EX docs (see PR-1 task — `/pay` endpoint was intentionally removed; SE is the only path).

---

## File Structure

### API
- Modify: `prisma/schema.prisma` — add VendorSettlementDetail + SettlementLine
- Create: `prisma/migrations/<ts>_add_vendor_settlement/migration.sql`
- Create: `modules/journal/cpa-templates/vendor-settlement.template.ts`
- Modify: `modules/journal/journal.module.ts`
- Create: `modules/expense-documents/dto/create-settlement.dto.ts`
- Modify: `modules/expense-documents/expense-documents.controller.ts` — `/settlement` endpoint
- Modify: `modules/expense-documents/expense-documents.service.ts` — `createSettlement()`, dispatch in `post()`

### API tests
- Create: `modules/expense-documents/__tests__/vendor-settlement.template.spec.ts`
- Create: `modules/expense-documents/__tests__/settlement.service.spec.ts`
- Create: `modules/expense-documents/__tests__/settlement-lifecycle.integration.spec.ts`

### Web
- Create: `components/expense-documents/SettlementForm.tsx`
- Modify: `pages/ExpenseDocumentNewPage.tsx` — add `case 'SE'`
- Modify: `pages/ExpensesPage.tsx` — enable SE option in dropdown

---

## Task 1: Schema migration

Add to schema.prisma:

```prisma
model VendorSettlementDetail {
  documentId      String           @id @map("document_id")
  document        ExpenseDocument  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  settlementLines SettlementLine[]

  @@map("vendor_settlement_details")
}

model SettlementLine {
  id                String                 @id @default(uuid())
  settlementId      String                 @map("settlement_id")
  settlement        VendorSettlementDetail @relation(fields: [settlementId], references: [documentId], onDelete: Cascade)
  clearedDocumentId String                 @map("cleared_document_id")
  clearedDocument   ExpenseDocument        @relation("SettlementCleared", fields: [clearedDocumentId], references: [id], onDelete: Restrict)
  amountSettled     Decimal                @db.Decimal(12, 2) @map("amount_settled")

  @@index([settlementId])
  @@index([clearedDocumentId])
  @@map("settlement_lines")
}
```

In `ExpenseDocument` add 2 new relations after the existing detail relations:

```prisma
  settlement              VendorSettlementDetail?
  settlementsClearingThis SettlementLine[]        @relation("SettlementCleared")
```

Migration SQL `apps/api/prisma/migrations/20260913000000_add_vendor_settlement/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "vendor_settlement_details" (
    "document_id" TEXT NOT NULL,

    CONSTRAINT "vendor_settlement_details_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "settlement_lines" (
    "id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "cleared_document_id" TEXT NOT NULL,
    "amount_settled" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlement_lines_settlement_id_idx" ON "settlement_lines"("settlement_id");
CREATE INDEX "settlement_lines_cleared_document_id_idx" ON "settlement_lines"("cleared_document_id");

-- AddForeignKey
ALTER TABLE "vendor_settlement_details" ADD CONSTRAINT "vendor_settlement_details_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "expense_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "vendor_settlement_details"("document_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_cleared_document_id_fkey" FOREIGN KEY ("cleared_document_id") REFERENCES "expense_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

## Task 2: VendorSettlementTemplate JE (TDD)

Tests (5):
1. Single ACCRUAL EX cleared (1 line, no WHT) → JE balances Dr 21-1104 / Cr cash
2. Multiple ACCRUAL EXs cleared in one SE → Dr 21-1104 (sum) / Cr cash
3. With WHT → Dr 21-1104 / Cr cash (- wht) + Cr WHT account
4. Side effect: each cleared EX → POSTED + paidAt = SE.paidAt
5. Idempotent (skip if SE.journalEntryId set)

Implementation:
```ts
@Injectable()
export class VendorSettlementTemplate {
  private shopCompanyIdCache: string | null = null;

  constructor(
    private readonly journal: JournalAutoService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(documentId, outerTx?) {
    const exec = async (tx) => {
      const se = await tx.expenseDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: { settlement: { include: { settlementLines: true } } },
      });
      if (se.journalEntryId) {
        const existing = await tx.journalEntry.findUnique({ where: { id: se.journalEntryId } });
        return { entryNo: existing?.entryNumber ?? se.journalEntryId };
      }
      if (!se.settlement || se.settlement.settlementLines.length === 0) {
        throw new Error(`Settlement ${documentId} missing detail/lines`);
      }
      if (!se.depositAccountCode) {
        throw new BadRequestException(`Settlement ${documentId} requires depositAccountCode`);
      }

      const zero = new Decimal(0);
      const sumSettled = se.settlement.settlementLines.reduce(
        (s, l) => s.plus(l.amountSettled.toString()), zero
      );
      const wht = new Decimal(se.withholdingTax.toString());
      const cashLeg = sumSettled.minus(wht);

      const lines = [
        {
          accountCode: '21-1104',
          dr: sumSettled,
          cr: zero,
          description: `จ่ายเจ้าหนี้ ${se.number}`,
        },
        {
          accountCode: se.depositAccountCode,
          dr: zero,
          cr: cashLeg,
          description: `ตัดเงินสด ${cashLeg.toFixed(2)} ฿`,
        },
      ];
      if (wht.gt(zero)) {
        const whtAccount = se.whtFormType === 'PND53' ? '21-3103' : '21-3102';
        lines.push({
          accountCode: whtAccount,
          dr: zero,
          cr: wht,
          description: `หัก ณ ที่จ่าย ${se.whtFormType ?? 'PND3'}`,
        });
      }

      const shopCompanyId = await this.getShopCompanyId(tx);

      const result = await this.journal.createAndPost({
        description: `จ่ายเจ้าหนี้ ${se.number}`,
        reference: se.id,
        metadata: {
          tag: 'VENDOR_SETTLEMENT',
          documentId: se.id,
          documentNumber: se.number,
          documentType: se.documentType,
          clearedCount: se.settlement.settlementLines.length,
          flow: 'expense-vendor-settlement',
        },
        postedAt: se.documentDate,
        companyId: shopCompanyId,
        lines,
      }, tx);

      // SIDE EFFECT: each cleared EX → POSTED + paidAt
      for (const line of se.settlement.settlementLines) {
        await tx.expenseDocument.update({
          where: { id: line.clearedDocumentId },
          data: {
            status: 'POSTED',
            paidAt: se.documentDate,
            // Note: does NOT overwrite cleared.journalEntryId — original ACCRUAL JE stays
          },
        });
      }

      // Update SE itself
      await tx.expenseDocument.update({
        where: { id: se.id },
        data: {
          status: 'POSTED',
          paidAt: se.documentDate,
          journalEntryId: result.id,
          netPayment: cashLeg,
        },
      });

      return { entryNo: result.entryNumber };
    };

    return outerTx ? exec(outerTx) : this.prisma.$transaction(exec);
  }

  private async getShopCompanyId(tx) { /* same pattern as PR-2/3 */ }
}
```

⚠️ CPA AUDIT — Phase A.7

## Task 3: CreateSettlementDto + service.createSettlement

DTO:
```ts
class SettlementLineInput {
  @IsUUID() clearedDocumentId: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amountSettled: number;
}

export class CreateSettlementDto {
  @IsString() branchId: string;
  @IsDateString() documentDate: string;
  @IsString() @IsOptional() vendorName?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsIn([...CASH_ACCOUNT_CODES]) depositAccountCode: string;
  @IsString() @IsOptional() paymentMethod?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @IsOptional() withholdingTax?: number;
  @IsString() @IsOptional() @IsIn(['PND3', 'PND53']) whtFormType?: string;
  @ValidateNested({ each: true }) @ArrayMinSize(1) @Type(() => SettlementLineInput) lines: SettlementLineInput[];
  @IsString() @IsOptional() reference?: string;
  @IsString() @IsOptional() note?: string;
}
```

Service `createSettlement(dto, user)`:
- Branch access check (hasCrossBranchAccess)
- For each line: load original (must be ACCRUAL + same branch + EXPENSE type + not deleted)
- For each line: compute remaining cap = original.totalAmount - sum prior settlements; reject if amountSettled > cap
- Sum total: subtotal = Σ amountSettled, totalAmount = subtotal, netPayment = subtotal - wht
- Generate `SE-YYYYMMDD-NNNN`
- Create header + detail + lines in same tx

Tests (6):
1. Rejects no lines (DTO)
2. Rejects when cleared doc not found
3. Rejects when cleared doc is not ACCRUAL
4. Rejects when cleared doc is different branch
5. Rejects when amountSettled > cleared.totalAmount - prior settlements
6. Happy path creates SE with lines

Update existing service tests for 8th constructor arg (VendorSettlementTemplate). Update post() dispatcher and type guard.

## Task 4: POST /settlement endpoint + controller test

```ts
@Post('settlement')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
createSettlement(
  @Body() dto: CreateSettlementDto,
  @CurrentUser() user: { id: string; branchId?: string; role: string },
) {
  return this.service.createSettlement(dto, user);
}
```

Add 1 controller test.

## Task 5: Integration test

Tests (3):
1. Clear 2 ACCRUAL EXs → SE POSTED, both EXs flip to POSTED + paidAt
2. Mixed batch validation: SE with 1 valid + 1 already-posted EX → reject before creating
3. Cap exceeded: prior partial settlement leaves 400, attempt 500 → reject

## Task 6: Frontend SettlementForm

UI:
- Branch + cash account + payment method header
- Optional vendor name (free text — usually paired with one or more EXs from same vendor)
- Multi-select table:
  - Fetches from `GET /expense-documents?status=ACCRUAL&branchId=X&type=EXPENSE&limit=100`
  - Checkbox column for selecting
  - For selected: show `amountSettled` input (defaults to remaining cap)
- Optional WHT amount + form type
- Footer total: Σ amountSettled, cash leg = total - wht, computed netPayment
- Validation: at least 1 row selected, all amountSettled > 0 and ≤ remaining cap

## Task 7: Verify + push + PR

```bash
./tools/check-types.sh all
git push -u origin feat/expense-documents-pr4
gh pr create --base feat/expense-documents-pr3 --title "PR-4: Vendor Settlement (SE) on top of PR-3"
```

---

## Self-Review

- §1.2 schema ✅, §3.1 lifecycle ✅, §4.5 JE + side effect ✅, §5 endpoint ✅, §6.2 form ✅, §6.3 validation ✅
- This PR completes ACCRUAL → POSTED transition (was held in PR-1)
- Out of scope: settlement reverse on void; vendor master table

## Notes

- Concurrency: settlement must lock cleared documents to prevent two SEs from over-clearing same EX. Use `pg_advisory_xact_lock(hashtext(clearedDocumentId))` per line.
- WHT routing matches ExpenseSameDayTemplate pattern (PND53 → 21-3103, else 21-3102)
