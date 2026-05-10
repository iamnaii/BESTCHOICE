# PR-3: Payroll (PR) — Implementation Plan

**Goal:** Add PAYROLL document type — เงินเดือนงวด with multi-line per employee. Schema additive (PayrollDetail 1:1 + PayrollLine[]). New `PayrollTemplate` JE aggregates lines (Dr salary / Cr WHT + SSO + cash). Endpoint `POST /payroll` with line validation (netPaid = baseSalary − sso − wht per row). Frontend PayrollForm has period selector + dynamic employee table.

**Architecture:** Reuses PR-1 polymorphic header. `PayrollDetail` 1:1 with header holds `payrollPeriod` (Thai "YYYY-MM" string). `PayrollLine` rows hold per-employee data. JE aggregates Σ baseSalary/Σ ssoEmployee/Σ whtAmount/Σ netPaid. PR lifecycle: DRAFT → POSTED+paidAt (always paid same day, no ACCRUAL state). Frontend: dedicated multi-line table editor with auto-sum + per-row validation.

**Branch:** `feat/expense-documents-pr3` (off `feat/expense-documents-pr2`).

**Spec refs:** §1.2 (PayrollDetail/PayrollLine), §3.1 (PR lifecycle), §4.4 (PayrollTemplate JE), §6.2 (form), §6.3 (line validation).

---

## File Structure

### API
- Modify: `prisma/schema.prisma` — add PayrollDetail + PayrollLine
- Create: `prisma/migrations/<ts>_add_payroll/migration.sql`
- Create: `modules/journal/cpa-templates/payroll.template.ts`
- Modify: `modules/journal/journal.module.ts`
- Create: `modules/expense-documents/dto/create-payroll.dto.ts`
- Modify: `modules/expense-documents/expense-documents.controller.ts` — add `/payroll` endpoint
- Modify: `modules/expense-documents/expense-documents.service.ts` — add `createPayroll()`, dispatch in `post()`

### API tests
- Create: `modules/expense-documents/__tests__/payroll.template.spec.ts`
- Create: `modules/expense-documents/__tests__/payroll.service.spec.ts`
- Create: `modules/expense-documents/__tests__/payroll-lifecycle.integration.spec.ts`

### Web
- Create: `components/expense-documents/PayrollForm.tsx`
- Modify: `pages/ExpenseDocumentNewPage.tsx` — add `case 'PR'`
- Modify: `pages/ExpensesPage.tsx` — enable PR option in dropdown

---

## Task 1: Schema migration

- Modify schema.prisma to add:

```prisma
model PayrollDetail {
  documentId    String          @id @map("document_id")
  document      ExpenseDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  payrollPeriod String          @map("payroll_period")
  lines         PayrollLine[]

  @@map("payroll_details")
}

model PayrollLine {
  id            String        @id @default(uuid())
  payrollId     String        @map("payroll_id")
  payroll       PayrollDetail @relation(fields: [payrollId], references: [documentId], onDelete: Cascade)
  employeeName  String        @map("employee_name")
  employeeTaxId String?       @map("employee_tax_id")
  baseSalary    Decimal       @db.Decimal(12, 2) @map("base_salary")
  ssoEmployee   Decimal       @default(0) @db.Decimal(12, 2) @map("sso_employee")
  whtAmount     Decimal       @default(0) @db.Decimal(12, 2) @map("wht_amount")
  netPaid       Decimal       @db.Decimal(12, 2) @map("net_paid")

  @@index([payrollId])
  @@map("payroll_lines")
}
```

Add to `ExpenseDocument`:
```prisma
  payroll          PayrollDetail?
```

- Create `prisma/migrations/20260912000000_add_payroll/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "payroll_details" (
    "document_id" TEXT NOT NULL,
    "payroll_period" TEXT NOT NULL,

    CONSTRAINT "payroll_details_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" TEXT NOT NULL,
    "payroll_id" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "employee_tax_id" TEXT,
    "base_salary" DECIMAL(12,2) NOT NULL,
    "sso_employee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "wht_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_paid" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_lines_payroll_id_idx" ON "payroll_lines"("payroll_id");

-- AddForeignKey
ALTER TABLE "payroll_details" ADD CONSTRAINT "payroll_details_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "expense_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_id_fkey" FOREIGN KEY ("payroll_id") REFERENCES "payroll_details"("document_id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Run validate + generate, commit.

## Task 2: PayrollTemplate JE (TDD)

5 tests:
1. JE balanced: Dr 53-1101 (sum baseSalary) / Cr 21-3101 (sum wht — ภ.ง.ด. 1 ค้างจ่าย) + Cr 21-1104 (sum sso — placeholder; CPA must confirm dedicated SSO payable in Phase A.7) + Cr cash (sum netPaid)
2. Idempotent
3. Updates status=POSTED + paidAt + journalEntryId
4. SSO/WHT zero handled (skip those CR lines if Σ = 0)
5. Multi-line aggregation works (3+ employees)

**Account code notes (post-review correction 2026-05-10):**
- `21-3101` ภ.ง.ด. 1 ค้างจ่าย — correct WHT account from CoA (was incorrectly `21-3102` ภ.ง.ด. 3 in initial plan)
- `21-1104` เจ้าหนี้ค่าใช้จ่ายกิจการ — defensible placeholder for SSO. CoA has no dedicated SSO payable account; `21-3104` is ภ.ง.ด. 2 ปันผล WHT (wrong). TODO: CPA to confirm or add new account in Phase A.7.

Implementation key points:
- Includes `payroll: { include: { lines: true } }` when reading doc
- Aggregates lines via `lines.reduce((sum, l) => sum.plus(l.X.toString()))` for each field
- Requires depositAccountCode (no fallback — payroll always paid)
- companyId = SHOP, postedAt = doc.documentDate

## Task 3: CreatePayrollDto + service.createPayroll

DTO:
```ts
class PayrollLineInput {
  @IsString() @MinLength(2) employeeName: string;
  @IsString() @IsOptional() employeeTaxId?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) baseSalary: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @IsOptional() ssoEmployee?: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @IsOptional() whtAmount?: number;
  // netPaid computed server-side, not accepted from client
}

export class CreatePayrollDto {
  @IsString() branchId: string;
  @IsDateString() documentDate: string;
  @IsString() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) payrollPeriod: string; // YYYY-MM
  @IsString() @IsOptional() description?: string;
  @IsString() @IsIn([...CASH_ACCOUNT_CODES]) depositAccountCode: string; // REQUIRED for payroll
  @IsString() @IsOptional() paymentMethod?: string;
  @ValidateNested({ each: true }) @ArrayMinSize(1) @Type(() => PayrollLineInput) lines: PayrollLineInput[];
  @IsString() @IsOptional() reference?: string;
  @IsString() @IsOptional() note?: string;
}
```

Service `createPayroll(dto, userId)`:
- For each line: compute netPaid = baseSalary - sso - wht; reject if any line.netPaid < 0
- subtotal = Σ baseSalary, vatAmount = 0, withholdingTax = Σ wht, totalAmount = subtotal, netPayment = Σ netPaid
- Generate `PR-YYYYMMDD-NNNN`
- Create header with `payroll: { create: { payrollPeriod, lines: { create: lines.map(...) } } }`

Tests (6):
1. Rejects when no lines (ArrayMinSize)
2. Rejects when line.netPaid would be negative
3. Computes netPaid per line correctly
4. Sums correctly across multiple lines
5. Rejects invalid payrollPeriod format
6. Happy path creates header + detail + lines in same tx

Update `expense-documents.service.spec.ts` — constructor takes 7th arg (PayrollTemplate). Add mock.

Update `post()` to dispatch PayrollTemplate when `documentType === 'PAYROLL'`. Update type guard to allow PAYROLL.

## Task 4: POST /payroll endpoint + controller test

```ts
@Post('payroll')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')
createPayroll(
  @Body() dto: CreatePayrollDto,
  @CurrentUser() user: { id: string },
) {
  return this.service.createPayroll(dto, user.id);
}
```

Add 1 controller test.

## Task 5: Integration test

3 vitest tests:
1. Happy: create payroll with 3 employees → post → JE balanced + Σ baseSalary on Dr / Σ on Cr
2. Reject: line netPaid mismatch
3. Numbering: PR-YYYYMMDD-0001 for first

## Task 6: Frontend PayrollForm

- Period selector (year + month dropdowns, store as "2569-05" Thai year)
- Deposit account selector (CashAccountSelect from PR-1 fixes)
- Dynamic table:
  - Headers: ชื่อ / เลขบัตร / ฐาน / SSO / WHT / สุทธิ / ลบ
  - Each row: inputs for name/taxId/baseSalary/sso/wht; auto-calc netPaid (read-only)
  - "+ เพิ่มพนักงาน" button
  - Per-row delete button (except first row)
- Footer totals: Σ ฐาน / Σ SSO / Σ WHT / Σ สุทธิ
- Validation: at least 1 row, all rows have valid name + baseSalary > 0
- Save Draft / Save+Post buttons

Update `ExpenseDocumentNewPage` to handle `case 'PR'` → render PayrollForm.

Update ExpensesPage dropdown — replace "เงินเดือน (PR-3)" disabled with active link to `/expenses/new?type=PR`.

## Task 7: Verify + push + PR

```bash
./tools/check-types.sh all
npx jest --runInBand --silent --testPathPattern="(expense-documents|journal)"
git push -u origin feat/expense-documents-pr3
gh pr create --base feat/expense-documents-pr2 --title "PR-3: Payroll (PR) on top of PR-2"
```

---

## Self-Review

**Spec coverage:** §1.2 PayrollDetail+PayrollLine ✅, §3.1 PR lifecycle ✅, §4.4 JE ✅, §5 endpoint ✅, §6.2 form ✅, §6.3 validation ✅.

**Type consistency:** `PayrollTemplate.execute(documentId, outerTx?)` matches PR-1/PR-2 pattern. `service.createPayroll(dto, userId)` mirrors siblings.

**Out of scope:**
- ภงด.1 file generation (Phase A.7)
- Employee master table (free-text employeeName for now)
- Multiple payments per period (only "pay all at once" supported)
- Payroll edit after post (status guard — same as siblings)
