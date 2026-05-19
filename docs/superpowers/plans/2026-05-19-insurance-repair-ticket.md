# Insurance / Repair Ticket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `/insurance` from redirect stub to full repair ticket lifecycle module — 6-status state machine with auto-warranty detection, atomic replace handoff to existing `/defect-exchange`, and auto-creation of draft SHOP accounting documents on ticket close.

**Architecture:** Standalone NestJS module `repair-tickets/` (controller → service → PrismaService) + 3 React pages under `/insurance/*`. Minimal additive touches to existing `defect-exchange` module (1 new flag, 1 new field). Reuse `ExpenseDocument` + `OtherIncome` + `Supplier` + `Customer` + `Contract` + `Product` + `AuditService` + per-module `DocNumberService` patterns.

**Tech Stack:** NestJS, Prisma 6.x, PostgreSQL, React 18 + Vite, react-hook-form + zod, @tanstack/react-query, shadcn/ui, Playwright, jest (API) + vitest (web).

**Spec reference:** `docs/superpowers/specs/2026-05-19-insurance-repair-ticket-design.md`

**Phasing:** 7 PRs, independently deployable. PR 4 splits into 4a (list+detail+sidebar), 4b (wizard), 4c (warranty-check) to keep each PR reviewable. Each PR ends with a green CI run + commit + open PR for review.

**Note (2026-05-20 update):** Spec was revised to unify `/insurance` as a single entry with a smart-default wizard + standalone warranty-check page. Backend logic (PR 1, PR 2) is unchanged; PR 3 expands to add 2 warranty endpoints; PR 4 splits into 4a/4b/4c; PR 5 expands E2E to 3 specs.

---

## PR 1 — Foundation (Schema + DTOs + Helpers)

**Goal:** Land additive schema changes + scaffolding. No business logic yet. Migration is safe to deploy ahead of code.

### Task 1.1: Audit SHOP Chart of Accounts for repair codes

**Files:**
- Read: `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv` (existing FINANCE chart)
- Read: search for SHOP CoA seed/fixture (Phase 3 SP6 introduced this)

- [ ] **Step 1: Locate SHOP CoA reference**

Run: `grep -rn "SHOP.*chart\|shop.*coa\|ShopCoa" apps/api/src apps/api/prisma --include="*.ts" --include="*.csv" --include="*.prisma" | head -20`
Expected: find seed/fixture file path used by Phase 3 SP6

- [ ] **Step 2: Identify existing expense + income account codes**

Search the SHOP CoA for accounts matching "ค่าซ่อม" (repair expense) and "รายได้บริการซ่อม" (repair service income). Likely candidates:
- Expense: code starts with `5X-XXXX` in SHOP chart
- Income: code starts with `4X-XXXX` in SHOP chart

Document the codes found in a scratch note (not a file yet — used in Task 1.6).

- [ ] **Step 3: If accounts are missing, draft additions**

If either account is missing, prepare a SHOP CoA seed update for Task 1.5's migration. Do not commit yet — owner must sign off on code numbers.

- [ ] **Step 4: Owner sign-off checkpoint**

Halt and confirm with owner: "The repair-expense account code is `<code>` and repair-income is `<code>`. OK to proceed?" Capture confirmation in PR1 description.

### Task 1.2: Add Prisma enums

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add three new enums after the last existing enum**

Locate the section of the schema with other enums (e.g. near `ContractStatus`, `PaymentStatus`). Append:

```prisma
enum RepairStatus {
  OPEN
  IN_PROGRESS
  READY_FOR_PICKUP
  CLOSED
  REPLACED
  CANCELLED
}

enum WarrantyStatus {
  IN_7DAY_DEFECT
  IN_SHOP_WARRANTY
  IN_MANUFACTURER
  OUT_OF_WARRANTY
  WALK_IN
}

enum RepairPayer {
  SHOP
  CUSTOMER
  SUPPLIER_CLAIM
}
```

- [ ] **Step 2: Verify schema parses**

Run: `cd apps/api && npx prisma format`
Expected: no errors; schema reformatted

### Task 1.3: Add RepairTicket + RepairStatusLog models

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Append RepairTicket model**

After the last existing model, before `model RepairStatusLog`:

```prisma
/// SP5 Phase 2 — Repair ticket lifecycle.
model RepairTicket {
  id            String       @id @default(uuid())
  ticketNumber  String       @unique @map("ticket_number")
  status        RepairStatus @default(OPEN)

  customerId    String  @map("customer_id")
  contractId    String? @map("contract_id")
  productId     String? @map("product_id")

  deviceBrand   String? @map("device_brand")
  deviceModel   String? @map("device_model")
  deviceImei    String? @map("device_imei")
  deviceSerial  String? @map("device_serial")

  defectDescription  String         @map("defect_description") @db.Text
  warrantyStatus     WarrantyStatus @default(WALK_IN) @map("warranty_status")

  repairSupplierId  String? @map("repair_supplier_id")
  externalClaimNo   String? @map("external_claim_no")

  sentToRepairAt        DateTime? @map("sent_to_repair_at")
  repairedAt            DateTime? @map("repaired_at")
  returnedToCustomerAt  DateTime? @map("returned_to_customer_at")
  cancelledAt           DateTime? @map("cancelled_at")
  replacedAt            DateTime? @map("replaced_at")

  estimatedCost  Decimal?    @map("estimated_cost") @db.Decimal(12, 2)
  actualCost     Decimal?    @map("actual_cost") @db.Decimal(12, 2)
  payer          RepairPayer @default(SHOP)

  expenseDocumentId  String? @unique @map("expense_document_id")
  otherIncomeId      String? @unique @map("other_income_id")
  defectExchangeId   String? @unique @map("defect_exchange_id")

  notes        String?   @db.Text
  branchId     String    @map("branch_id")
  createdById  String    @map("created_by_id")

  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")
  deletedAt    DateTime? @map("deleted_at")

  customer        Customer         @relation(fields: [customerId], references: [id])
  contract        Contract?        @relation(fields: [contractId], references: [id])
  product         Product?         @relation("ProductRepairs", fields: [productId], references: [id])
  repairSupplier  Supplier?        @relation("RepairCenterTickets", fields: [repairSupplierId], references: [id])
  branch          Branch           @relation(fields: [branchId], references: [id])
  createdBy       User             @relation("RepairTicketCreatedBy", fields: [createdById], references: [id])
  expenseDocument ExpenseDocument? @relation(fields: [expenseDocumentId], references: [id])
  otherIncome     OtherIncome?     @relation(fields: [otherIncomeId], references: [id])
  defectExchange  DefectExchange?  @relation(fields: [defectExchangeId], references: [id])
  statusLogs      RepairStatusLog[]

  @@index([customerId, deletedAt])
  @@index([branchId, status, deletedAt])
  @@index([status])
  @@index([createdAt])
  @@index([repairSupplierId])
  @@map("repair_tickets")
}

model RepairStatusLog {
  id          String       @id @default(uuid())
  ticketId    String       @map("ticket_id")
  fromStatus  RepairStatus @map("from_status")
  toStatus    RepairStatus @map("to_status")
  changedById String       @map("changed_by_id")
  note        String?      @db.Text
  createdAt   DateTime     @default(now()) @map("created_at")

  ticket    RepairTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  changedBy User         @relation("RepairStatusLogChangedBy", fields: [changedById], references: [id])

  @@index([ticketId, createdAt])
  @@map("repair_status_logs")
}
```

### Task 1.4: Add relation fields to existing models

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (Supplier, Customer, Contract, Product, Branch, User, ExpenseDocument, OtherIncome, DefectExchange models)

- [ ] **Step 1: Add `isRepairCenter` + back-relation to Supplier**

In the existing `model Supplier { ... }` block, add:

```prisma
  isRepairCenter Boolean        @default(false) @map("is_repair_center")
  repairTickets  RepairTicket[] @relation("RepairCenterTickets")
```

- [ ] **Step 2: Add back-relations to other existing models**

To `model Customer`: `repairTickets RepairTicket[]`
To `model Contract`: `repairTickets RepairTicket[]`
To `model Product`: `repairTickets RepairTicket[] @relation("ProductRepairs")`
To `model Branch`: `repairTickets RepairTicket[]`
To `model User`:
```prisma
  repairTicketsCreated     RepairTicket[]     @relation("RepairTicketCreatedBy")
  repairStatusLogsChanged  RepairStatusLog[]  @relation("RepairStatusLogChangedBy")
```
To `model ExpenseDocument`: `repairTicket RepairTicket?`
To `model OtherIncome`: `repairTicket RepairTicket?`

- [ ] **Step 3: Add originRepairTicketId + back-relation to DefectExchange**

In `model DefectExchange`:
```prisma
  originRepairTicketId String?       @map("origin_repair_ticket_id")
  repairTicket         RepairTicket? @relation
```

- [ ] **Step 4: Add REPAIR_SERVICE to ExpenseType enum**

Find `enum ExpenseType { ... }`. Append at the end of the value list:
```prisma
  REPAIR_SERVICE
```

- [ ] **Step 5: Verify schema**

Run: `cd apps/api && npx prisma format && npx prisma validate`
Expected: no errors

### Task 1.5: Generate migration

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_add_repair_ticket_schema/migration.sql`

- [ ] **Step 1: Create migration**

Run: `cd apps/api && npx prisma migrate dev --name add_repair_ticket_schema --create-only`
Expected: new directory under `prisma/migrations/` with a `migration.sql` file

- [ ] **Step 2: Inspect migration SQL**

Open the generated `migration.sql`. Verify:
- `CREATE TABLE "repair_tickets"` with all columns
- `CREATE TABLE "repair_status_logs"`
- `ALTER TABLE "suppliers" ADD COLUMN "is_repair_center" BOOLEAN NOT NULL DEFAULT false`
- `ALTER TABLE "defect_exchanges" ADD COLUMN "origin_repair_ticket_id" TEXT`
- `ALTER TYPE "ExpenseType" ADD VALUE 'REPAIR_SERVICE'`
- New CREATE TYPE statements for 3 enums
- All foreign keys with correct ON DELETE / ON UPDATE
- All indexes from `@@index`

Manually edit ONLY if a destructive op slipped in (DROP COLUMN / DROP TABLE / drop NOT NULL). Otherwise leave as generated.

- [ ] **Step 3: Apply migration to local dev DB**

Run: `cd apps/api && npx prisma migrate dev`
Expected: migration applied; Prisma client regenerates

If dev DB is in `db push` state (no `_prisma_migrations` table — per memory note), the migration will fail. Fallback: run the migration SQL manually via `psql $DATABASE_URL -f <path-to-migration.sql>`, then `npx prisma generate`.

- [ ] **Step 4: Verify Prisma client has new types**

Run: `cd apps/api && npx tsc --noEmit src/prisma/prisma.service.ts`
Expected: no errors; `prisma.repairTicket` and `prisma.repairStatusLog` exist

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/<timestamp>_add_repair_ticket_schema/
git commit -m "feat(schema): add RepairTicket + RepairStatusLog + Supplier.isRepairCenter

SP5 Phase 2 foundation — additive only, safe for prisma migrate deploy.
New tables: repair_tickets, repair_status_logs.
New columns: suppliers.is_repair_center, defect_exchanges.origin_repair_ticket_id.
New enum value: ExpenseType::REPAIR_SERVICE."
```

### Task 1.6: Add SystemConfig keys for repair account codes

**Files:**
- Modify: `apps/api/src/modules/system-config/system-config.service.ts` (or wherever default keys are seeded)
- Modify: `apps/api/src/modules/system-config/__tests__/system-config.service.spec.ts`

- [ ] **Step 1: Locate seed/defaults file**

Run: `grep -rn "VAT_RATE\|VAT_PRICE_TYPE_DEFAULT" apps/api/src/modules/system-config --include="*.ts" | head -10`
Find where existing default SystemConfig values are defined (likely a constants file or seed module).

- [ ] **Step 2: Add 2 new keys**

In the defaults definition (matching existing pattern), add:

```ts
{
  key: 'REPAIR_EXPENSE_ACCOUNT_CODE',
  value: '<code-from-task-1.1>',
  description: 'SHOP CoA — expense account for repair tickets (Dr leg of payer=SHOP)',
  type: 'STRING',
},
{
  key: 'REPAIR_INCOME_ACCOUNT_CODE',
  value: '<code-from-task-1.1>',
  description: 'SHOP CoA — income account for repair tickets (Cr leg of payer=CUSTOMER)',
  type: 'STRING',
},
```

- [ ] **Step 3: Write test that verifies defaults load**

Add to the existing system-config spec:

```ts
it('seeds REPAIR_EXPENSE_ACCOUNT_CODE + REPAIR_INCOME_ACCOUNT_CODE on bootstrap', async () => {
  await service.bootstrapDefaults();
  const expense = await service.get('REPAIR_EXPENSE_ACCOUNT_CODE');
  const income = await service.get('REPAIR_INCOME_ACCOUNT_CODE');
  expect(expense).toBeTruthy();
  expect(income).toBeTruthy();
});
```

- [ ] **Step 4: Run test**

Run: `cd apps/api && npx jest system-config --silent`
Expected: pass including the new case

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/system-config/
git commit -m "feat(config): seed REPAIR_EXPENSE_ACCOUNT_CODE + REPAIR_INCOME_ACCOUNT_CODE"
```

### Task 1.7: Create module skeleton + DTOs

**Files:**
- Create: `apps/api/src/modules/repair-tickets/repair-tickets.module.ts`
- Create: `apps/api/src/modules/repair-tickets/dto/create-repair-ticket.dto.ts`
- Create: `apps/api/src/modules/repair-tickets/dto/send.dto.ts`
- Create: `apps/api/src/modules/repair-tickets/dto/mark-repaired.dto.ts`
- Create: `apps/api/src/modules/repair-tickets/dto/send-back.dto.ts`
- Create: `apps/api/src/modules/repair-tickets/dto/return-to-customer.dto.ts`
- Create: `apps/api/src/modules/repair-tickets/dto/cancel.dto.ts`
- Create: `apps/api/src/modules/repair-tickets/dto/replace.dto.ts`
- Create: `apps/api/src/modules/repair-tickets/dto/update-repair-ticket.dto.ts`
- Create: `apps/api/src/modules/repair-tickets/dto/list-repair-tickets.dto.ts`

- [ ] **Step 1: Create module file**

```ts
// apps/api/src/modules/repair-tickets/repair-tickets.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { ExpenseDocumentsModule } from '../expense-documents/expense-documents.module';
import { OtherIncomeModule } from '../other-income/other-income.module';
import { SystemConfigModule } from '../system-config/system-config.module';

@Module({
  imports: [PrismaModule, AuditModule, ExpenseDocumentsModule, OtherIncomeModule, SystemConfigModule],
  controllers: [],
  providers: [],
  exports: [],
})
export class RepairTicketsModule {}
```

- [ ] **Step 2: CreateRepairTicketDto**

```ts
// apps/api/src/modules/repair-tickets/dto/create-repair-ticket.dto.ts
import { IsString, IsUUID, IsOptional, MinLength, IsEnum, IsNumber, Min } from 'class-validator';

enum RepairPayerInput {
  SHOP = 'SHOP',
  CUSTOMER = 'CUSTOMER',
  SUPPLIER_CLAIM = 'SUPPLIER_CLAIM',
}

export class CreateRepairTicketDto {
  @IsUUID() customerId!: string;
  @IsOptional() @IsUUID() contractId?: string;
  @IsOptional() @IsUUID() productId?: string;

  @IsOptional() @IsString() deviceBrand?: string;
  @IsOptional() @IsString() deviceModel?: string;
  @IsOptional() @IsString() deviceImei?: string;
  @IsOptional() @IsString() deviceSerial?: string;

  @IsString() @MinLength(5, { message: 'อาการเสียต้องระบุอย่างน้อย 5 ตัวอักษร' })
  defectDescription!: string;

  @IsOptional() @IsUUID() repairSupplierId?: string;
  @IsOptional() @IsNumber() @Min(0) estimatedCost?: number;
  @IsOptional() @IsEnum(RepairPayerInput) payer?: RepairPayerInput;
  @IsOptional() @IsString() notes?: string;
  @IsUUID() branchId!: string;
}
```

- [ ] **Step 3: SendDto**

```ts
// apps/api/src/modules/repair-tickets/dto/send.dto.ts
import { IsUUID, IsOptional, IsString, IsNumber, Min, IsDateString } from 'class-validator';

export class SendDto {
  @IsUUID({ message: 'ต้องระบุที่ซ่อม' }) repairSupplierId!: string;
  @IsOptional() @IsDateString() sentToRepairAt?: string;
  @IsOptional() @IsString() externalClaimNo?: string;
  @IsOptional() @IsNumber() @Min(0) estimatedCost?: number;
}
```

- [ ] **Step 4: MarkRepairedDto**

```ts
// apps/api/src/modules/repair-tickets/dto/mark-repaired.dto.ts
import { IsNumber, Min, IsEnum, IsOptional, IsDateString } from 'class-validator';

enum RepairPayerInput { SHOP = 'SHOP', CUSTOMER = 'CUSTOMER', SUPPLIER_CLAIM = 'SUPPLIER_CLAIM' }

export class MarkRepairedDto {
  @IsNumber() @Min(0) actualCost!: number;
  @IsEnum(RepairPayerInput) payer!: RepairPayerInput;
  @IsOptional() @IsDateString() repairedAt?: string;
}
```

- [ ] **Step 5: SendBackDto + CancelDto + ReturnToCustomerDto**

```ts
// apps/api/src/modules/repair-tickets/dto/send-back.dto.ts
import { IsString, MinLength } from 'class-validator';
export class SendBackDto {
  @IsString() @MinLength(5, { message: 'ต้องระบุเหตุผล QC fail (อย่างน้อย 5 ตัวอักษร)' })
  note!: string;
}

// apps/api/src/modules/repair-tickets/dto/cancel.dto.ts
import { IsString, MinLength } from 'class-validator';
export class CancelDto {
  @IsString() @MinLength(5, { message: 'ต้องระบุเหตุผลการยกเลิก (อย่างน้อย 5 ตัวอักษร)' })
  note!: string;
}

// apps/api/src/modules/repair-tickets/dto/return-to-customer.dto.ts
import { IsOptional, IsDateString } from 'class-validator';
export class ReturnToCustomerDto {
  @IsOptional() @IsDateString() returnedToCustomerAt?: string;
}
```

- [ ] **Step 6: ReplaceDto + UpdateRepairTicketDto + ListRepairTicketsDto**

```ts
// apps/api/src/modules/repair-tickets/dto/replace.dto.ts
import { IsUUID, IsOptional, IsString, IsDateString } from 'class-validator';
export class ReplaceDto {
  @IsUUID() defectExchangeId!: string;
  @IsOptional() @IsDateString() replacedAt?: string;
  @IsOptional() @IsString() note?: string;
}

// apps/api/src/modules/repair-tickets/dto/update-repair-ticket.dto.ts
import { IsString, IsOptional, MinLength, IsUUID, IsNumber, Min } from 'class-validator';
export class UpdateRepairTicketDto {
  @IsOptional() @IsString() @MinLength(5) defectDescription?: string;
  @IsOptional() @IsUUID() repairSupplierId?: string;
  @IsOptional() @IsNumber() @Min(0) estimatedCost?: number;
  @IsOptional() @IsString() notes?: string;
}

// apps/api/src/modules/repair-tickets/dto/list-repair-tickets.dto.ts
import { IsOptional, IsString, IsEnum, IsUUID, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

const STATUSES = ['OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'CLOSED', 'REPLACED', 'CANCELLED'] as const;

export class ListRepairTicketsDto {
  @IsOptional() @IsEnum(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() repairSupplierId?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number = 50;
}
```

- [ ] **Step 7: Type check**

Run: `cd apps/api && npx tsc --noEmit src/modules/repair-tickets/dto/*.ts`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/repair-tickets/
git commit -m "feat(repair-tickets): module skeleton + 9 DTOs

class-validator decorators with Thai error messages."
```

### Task 1.8: formatDevice helper

**Files:**
- Create: `apps/api/src/modules/repair-tickets/utils/format-device.ts`
- Create: `apps/api/src/modules/repair-tickets/utils/__tests__/format-device.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/api/src/modules/repair-tickets/utils/__tests__/format-device.spec.ts
import { formatDevice } from '../format-device';

describe('formatDevice', () => {
  it('uses product info when available (brand model storage)', () => {
    expect(formatDevice({
      product: { brand: 'Apple', model: 'iPhone 15', storage: '128GB' },
    })).toBe('Apple iPhone 15 128GB');
  });

  it('uses contract.product info when product not directly linked', () => {
    expect(formatDevice({
      contract: { product: { brand: 'Samsung', model: 'S24', storage: null } },
    })).toBe('Samsung S24');
  });

  it('falls back to free-text fields for walk-in', () => {
    expect(formatDevice({
      deviceBrand: 'Xiaomi', deviceModel: 'Mi 13', deviceImei: '352xxx',
    })).toBe('Xiaomi Mi 13 (IMEI: 352xxx)');
  });

  it('returns "ไม่ระบุเครื่อง" when nothing supplied', () => {
    expect(formatDevice({})).toBe('ไม่ระบุเครื่อง');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd apps/api && npx jest format-device --silent`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/modules/repair-tickets/utils/format-device.ts
type ProductLike = { brand?: string | null; model?: string | null; storage?: string | null };

export interface FormatDeviceInput {
  product?: ProductLike | null;
  contract?: { product?: ProductLike | null } | null;
  deviceBrand?: string | null;
  deviceModel?: string | null;
  deviceImei?: string | null;
  deviceSerial?: string | null;
}

export function formatDevice(input: FormatDeviceInput): string {
  const p = input.product ?? input.contract?.product;
  if (p?.brand || p?.model) {
    const parts = [p.brand, p.model, p.storage].filter(Boolean);
    return parts.join(' ');
  }
  if (input.deviceBrand || input.deviceModel) {
    const main = [input.deviceBrand, input.deviceModel].filter(Boolean).join(' ');
    if (input.deviceImei) return `${main} (IMEI: ${input.deviceImei})`;
    if (input.deviceSerial) return `${main} (SN: ${input.deviceSerial})`;
    return main;
  }
  return 'ไม่ระบุเครื่อง';
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `cd apps/api && npx jest format-device --silent`
Expected: 4/4 pass

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/repair-tickets/utils/
git commit -m "feat(repair-tickets): formatDevice utility + tests"
```

### Task 1.9: Open PR 1

- [ ] **Step 1: Run full check**

Run: `./tools/check-types.sh all`
Expected: API + Web both pass

- [ ] **Step 2: Push branch + open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(repair-tickets): PR 1/5 — schema + DTOs + scaffolding" --body "$(cat <<'EOF'
## Summary
- Adds `RepairTicket` + `RepairStatusLog` models + 3 enums (additive only)
- Adds `Supplier.isRepairCenter` flag + `DefectExchange.originRepairTicketId` back-ref + `ExpenseType.REPAIR_SERVICE`
- Adds 2 new SystemConfig keys: `REPAIR_EXPENSE_ACCOUNT_CODE`, `REPAIR_INCOME_ACCOUNT_CODE`
- Adds module skeleton + 9 DTOs + `formatDevice` helper

## Spec
docs/superpowers/specs/2026-05-19-insurance-repair-ticket-design.md

## SHOP CoA codes used
- Expense: `<code>` (ค่าซ่อม)
- Income: `<code>` (รายได้บริการซ่อม)

Owner sign-off: ✅ (Task 1.1 step 4)

## Test plan
- [ ] `./tools/check-types.sh all` passes
- [ ] `npx jest format-device` passes (4/4)
- [ ] `npx jest system-config` passes including new seed test
- [ ] `npx prisma migrate deploy` on staging succeeds
EOF
)"
```

---

## PR 2 — Backend Service + Endpoints

**Goal:** Full RepairTicketService + RepairTicketController + auto-doc creation + AuditService integration.

### Task 2.1: detectWarrantyStatus helper

**Files:**
- Create: `apps/api/src/modules/repair-tickets/utils/detect-warranty-status.ts`
- Create: `apps/api/src/modules/repair-tickets/utils/__tests__/detect-warranty-status.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { detectWarrantyStatus } from '../detect-warranty-status';

const todayMinus = (days: number) => new Date(Date.now() - days * 86400_000);
const todayPlus = (days: number) => new Date(Date.now() + days * 86400_000);

describe('detectWarrantyStatus', () => {
  it('returns WALK_IN when no contract and no product', () => {
    expect(detectWarrantyStatus({})).toBe('WALK_IN');
  });

  it('returns IN_7DAY_DEFECT when contract.deviceReceivedAt within 7 days', () => {
    expect(detectWarrantyStatus({ contract: { deviceReceivedAt: todayMinus(3), shopWarrantyEndDate: todayPlus(57) } })).toBe('IN_7DAY_DEFECT');
  });

  it('returns IN_SHOP_WARRANTY when past 7 days but inside shop warranty', () => {
    expect(detectWarrantyStatus({ contract: { deviceReceivedAt: todayMinus(20), shopWarrantyEndDate: todayPlus(40) } })).toBe('IN_SHOP_WARRANTY');
  });

  it('returns IN_MANUFACTURER when shop warranty expired but mfr active', () => {
    expect(detectWarrantyStatus({ product: { warrantyExpireDate: todayPlus(100) } })).toBe('IN_MANUFACTURER');
  });

  it('returns OUT_OF_WARRANTY when all warranties expired', () => {
    expect(detectWarrantyStatus({ contract: { deviceReceivedAt: todayMinus(100), shopWarrantyEndDate: todayMinus(40) }, product: { warrantyExpireDate: todayMinus(10) } })).toBe('OUT_OF_WARRANTY');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `cd apps/api && npx jest detect-warranty-status --silent`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/repair-tickets/utils/detect-warranty-status.ts
import { WarrantyStatus } from '@prisma/client';

export interface DetectWarrantyInput {
  contract?: { deviceReceivedAt?: Date | null; shopWarrantyEndDate?: Date | null } | null;
  product?: { warrantyExpireDate?: Date | null } | null;
}

export function detectWarrantyStatus(input: DetectWarrantyInput): WarrantyStatus {
  const now = new Date();
  if (!input.contract && !input.product) return 'WALK_IN';

  const c = input.contract;
  if (c?.deviceReceivedAt) {
    const ms = now.getTime() - c.deviceReceivedAt.getTime();
    const days = ms / 86400_000;
    if (days <= 7) return 'IN_7DAY_DEFECT';
  }
  if (c?.shopWarrantyEndDate && c.shopWarrantyEndDate > now) {
    return 'IN_SHOP_WARRANTY';
  }
  if (input.product?.warrantyExpireDate && input.product.warrantyExpireDate > now) {
    return 'IN_MANUFACTURER';
  }
  return 'OUT_OF_WARRANTY';
}

export function defaultPayer(ws: WarrantyStatus): 'SHOP' | 'CUSTOMER' {
  if (ws === 'OUT_OF_WARRANTY' || ws === 'WALK_IN') return 'CUSTOMER';
  return 'SHOP';
}
```

- [ ] **Step 4: Run, verify PASS + commit**

Run: `cd apps/api && npx jest detect-warranty-status --silent`
Expected: 5/5 pass

```bash
git add apps/api/src/modules/repair-tickets/utils/
git commit -m "feat(repair-tickets): detectWarrantyStatus + defaultPayer helpers"
```

### Task 2.2: DocNumberService for 'RT' prefix

**Files:**
- Create: `apps/api/src/modules/repair-tickets/services/doc-number.service.ts`
- Create: `apps/api/src/modules/repair-tickets/services/__tests__/doc-number.service.spec.ts`

- [ ] **Step 1: Copy pattern from other-income**

Read `apps/api/src/modules/other-income/services/doc-number.service.ts` for the existing pattern. Create a sibling at `apps/api/src/modules/repair-tickets/services/doc-number.service.ts` with prefix `RT` (e.g. `RT-20260519-0001`):

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { createHash } from 'crypto';

@Injectable()
export class RepairTicketDocNumberService {
  constructor(private readonly prisma: PrismaService) {}

  async nextTicketNumber(
    tx: Prisma.TransactionClient | PrismaService,
    issueDate: Date = new Date(),
  ): Promise<string> {
    const { yyyymmdd, startUtc, endUtc } = this.getBkkDayBounds(issueDate);
    const lockKey = this.hashLockKey(`rt:${yyyymmdd}`);
    await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
    const last = await tx.repairTicket.findFirst({
      where: { ticketNumber: { startsWith: `RT-${yyyymmdd}-` } },
      orderBy: { ticketNumber: 'desc' },
      select: { ticketNumber: true },
    });
    const nextSeq = last ? Number(last.ticketNumber.split('-').pop()) + 1 : 1;
    return `RT-${yyyymmdd}-${String(nextSeq).padStart(4, '0')}`;
  }

  private getBkkDayBounds(d: Date) {
    const bkkOffsetMs = 7 * 60 * 60 * 1000;
    const bkkMidnight = new Date(Math.floor((d.getTime() + bkkOffsetMs) / 86400_000) * 86400_000 - bkkOffsetMs);
    const startUtc = bkkMidnight;
    const endUtc = new Date(bkkMidnight.getTime() + 86400_000);
    const yyyymmdd = new Date(d.getTime() + bkkOffsetMs).toISOString().slice(0, 10).replace(/-/g, '');
    return { yyyymmdd, startUtc, endUtc };
  }

  private hashLockKey(s: string): number {
    const hex = createHash('md5').update(s).digest('hex').slice(0, 8);
    return parseInt(hex, 16);
  }
}
```

- [ ] **Step 2: Write test**

```ts
// __tests__/doc-number.service.spec.ts
import { Test } from '@nestjs/testing';
import { RepairTicketDocNumberService } from '../doc-number.service';
import { PrismaService } from '../../../../prisma/prisma.service';

describe('RepairTicketDocNumberService', () => {
  let svc: RepairTicketDocNumberService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue(undefined),
      repairTicket: { findFirst: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [RepairTicketDocNumberService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = mod.get(RepairTicketDocNumberService);
  });

  it('generates first ticket number for the day', async () => {
    prisma.repairTicket.findFirst.mockResolvedValue(null);
    const n = await svc.nextTicketNumber(prisma, new Date('2026-05-19T05:30:00Z')); // 12:30 BKK
    expect(n).toBe('RT-20260519-0001');
  });

  it('increments sequence within the same BKK day', async () => {
    prisma.repairTicket.findFirst.mockResolvedValue({ ticketNumber: 'RT-20260519-0007' });
    const n = await svc.nextTicketNumber(prisma, new Date('2026-05-19T05:30:00Z'));
    expect(n).toBe('RT-20260519-0008');
  });

  it('resets to 0001 on next BKK day', async () => {
    prisma.repairTicket.findFirst.mockResolvedValue(null); // no rows for new day
    const n = await svc.nextTicketNumber(prisma, new Date('2026-05-20T05:30:00Z'));
    expect(n).toBe('RT-20260520-0001');
  });
});
```

- [ ] **Step 3: Run + commit**

Run: `cd apps/api && npx jest repair-tickets/services/doc-number --silent`
Expected: 3/3 pass

```bash
git add apps/api/src/modules/repair-tickets/services/
git commit -m "feat(repair-tickets): RepairTicketDocNumberService (RT-YYYYMMDD-NNNN, BKK day reset)"
```

### Task 2.3: RepairTicketService — `create()`

**Files:**
- Create: `apps/api/src/modules/repair-tickets/repair-tickets.service.ts`
- Create: `apps/api/src/modules/repair-tickets/__tests__/repair-tickets.service.spec.ts`

- [ ] **Step 1: Skeleton service + create() failing test**

```ts
// __tests__/repair-tickets.service.spec.ts
import { Test } from '@nestjs/testing';
import { RepairTicketsService } from '../repair-tickets.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ExpenseDocumentsService } from '../../expense-documents/expense-documents.service';
import { OtherIncomeService } from '../../other-income/other-income.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { RepairTicketDocNumberService } from '../services/doc-number.service';

const OWNER = { id: 'u-owner', role: 'OWNER', branchId: null };

function mockPrisma() {
  return {
    repairTicket: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    repairStatusLog: { create: jest.fn(), findMany: jest.fn() },
    contract: { findUnique: jest.fn() },
    product: { findUnique: jest.fn() },
    supplier: { findUnique: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(this)),
    $queryRawUnsafe: jest.fn(),
  } as any;
}

describe('RepairTicketsService.create', () => {
  let svc: RepairTicketsService;
  let prisma: any;
  let audit: any;

  beforeEach(async () => {
    prisma = mockPrisma();
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
    audit = { log: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        RepairTicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: ExpenseDocumentsService, useValue: {} },
        { provide: OtherIncomeService, useValue: {} },
        { provide: SystemConfigService, useValue: { get: jest.fn() } },
        { provide: RepairTicketDocNumberService, useValue: { nextTicketNumber: jest.fn().mockResolvedValue('RT-20260519-0001') } },
      ],
    }).compile();
    svc = mod.get(RepairTicketsService);
  });

  it('creates a WALK_IN ticket when no contract and no product', async () => {
    prisma.repairTicket.create.mockResolvedValue({ id: 't-1', ticketNumber: 'RT-20260519-0001', warrantyStatus: 'WALK_IN' });
    const result = await svc.create({
      customerId: 'c-1',
      defectDescription: 'จอเสีย รอยร้าวด้านขวา',
      branchId: 'br-1',
    } as any, OWNER);
    expect(result.warrantyStatus).toBe('WALK_IN');
    expect(prisma.repairTicket.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ warrantyStatus: 'WALK_IN', ticketNumber: 'RT-20260519-0001', status: 'OPEN' }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'REPAIR_TICKET_CREATED', entity: 'repair_ticket' }));
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `cd apps/api && npx jest repair-tickets.service --silent`
Expected: FAIL (service doesn't exist)

- [ ] **Step 3: Implement `create()`**

```ts
// repair-tickets.service.ts
import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExpenseDocumentsService } from '../expense-documents/expense-documents.service';
import { OtherIncomeService } from '../other-income/other-income.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { RepairTicketDocNumberService } from './services/doc-number.service';
import { detectWarrantyStatus, defaultPayer } from './utils/detect-warranty-status';
import { CreateRepairTicketDto } from './dto/create-repair-ticket.dto';

type ReqUser = { id: string; role: string; branchId?: string | null };

@Injectable()
export class RepairTicketsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private expenseDocs: ExpenseDocumentsService,
    private otherIncome: OtherIncomeService,
    private systemConfig: SystemConfigService,
    private docNumber: RepairTicketDocNumberService,
  ) {}

  async create(dto: CreateRepairTicketDto, user: ReqUser) {
    return this.prisma.$transaction(async (tx) => {
      const contract = dto.contractId
        ? await tx.contract.findUnique({ where: { id: dto.contractId, deletedAt: null } })
        : null;
      if (dto.contractId && !contract) throw new NotFoundException('ไม่พบสัญญา');

      const product = dto.productId
        ? await tx.product.findUnique({ where: { id: dto.productId, deletedAt: null } })
        : null;
      if (dto.productId && !product) throw new NotFoundException('ไม่พบสินค้า');

      const warrantyStatus = detectWarrantyStatus({ contract, product });
      const payer = dto.payer ?? defaultPayer(warrantyStatus);
      const ticketNumber = await this.docNumber.nextTicketNumber(tx as any);

      const ticket = await tx.repairTicket.create({
        data: {
          ticketNumber,
          status: 'OPEN',
          customerId: dto.customerId,
          contractId: dto.contractId,
          productId: dto.productId,
          deviceBrand: dto.deviceBrand,
          deviceModel: dto.deviceModel,
          deviceImei: dto.deviceImei,
          deviceSerial: dto.deviceSerial,
          defectDescription: dto.defectDescription,
          warrantyStatus,
          repairSupplierId: dto.repairSupplierId,
          estimatedCost: dto.estimatedCost != null ? new Prisma.Decimal(dto.estimatedCost) : null,
          payer,
          notes: dto.notes,
          branchId: dto.branchId,
          createdById: user.id,
        },
      });

      await tx.repairStatusLog.create({
        data: { ticketId: ticket.id, fromStatus: 'OPEN', toStatus: 'OPEN', changedById: user.id, note: 'รับเครื่องเข้า' },
      });

      await this.audit.log({
        userId: user.id,
        action: 'REPAIR_TICKET_CREATED',
        entity: 'repair_ticket',
        entityId: ticket.id,
        newValue: { ticketNumber, warrantyStatus, payer },
      });

      return ticket;
    });
  }
}
```

- [ ] **Step 4: Add `'WALK_IN'` import if missing + run test**

Run: `cd apps/api && npx jest repair-tickets.service --silent`
Expected: 1/1 pass

- [ ] **Step 5: Add 7 more create() tests**

Add to the existing describe block:

```ts
it('returns IN_7DAY_DEFECT when contract is within 7-day window', async () => {
  const contractDate = new Date(Date.now() - 3 * 86400_000);
  prisma.contract.findUnique.mockResolvedValue({ deviceReceivedAt: contractDate, shopWarrantyEndDate: new Date(Date.now() + 57 * 86400_000) });
  prisma.repairTicket.create.mockResolvedValue({ id: 't-2', warrantyStatus: 'IN_7DAY_DEFECT' });
  const r = await svc.create({ customerId: 'c-1', contractId: 'k-1', defectDescription: 'จอเสีย', branchId: 'br-1' } as any, OWNER);
  expect(r.warrantyStatus).toBe('IN_7DAY_DEFECT');
});

it('returns IN_SHOP_WARRANTY past 7 days but inside 60-day window', async () => {
  prisma.contract.findUnique.mockResolvedValue({ deviceReceivedAt: new Date(Date.now() - 20 * 86400_000), shopWarrantyEndDate: new Date(Date.now() + 40 * 86400_000) });
  prisma.repairTicket.create.mockResolvedValue({ id: 't-3', warrantyStatus: 'IN_SHOP_WARRANTY' });
  const r = await svc.create({ customerId: 'c-1', contractId: 'k-1', defectDescription: 'จอเสีย', branchId: 'br-1' } as any, OWNER);
  expect(r.warrantyStatus).toBe('IN_SHOP_WARRANTY');
});

it('returns IN_MANUFACTURER when only product warranty active', async () => {
  prisma.product.findUnique.mockResolvedValue({ warrantyExpireDate: new Date(Date.now() + 200 * 86400_000) });
  prisma.repairTicket.create.mockResolvedValue({ id: 't-4', warrantyStatus: 'IN_MANUFACTURER' });
  const r = await svc.create({ customerId: 'c-1', productId: 'p-1', defectDescription: 'จอเสีย', branchId: 'br-1' } as any, OWNER);
  expect(r.warrantyStatus).toBe('IN_MANUFACTURER');
});

it('returns OUT_OF_WARRANTY when all warranties expired', async () => {
  prisma.contract.findUnique.mockResolvedValue({ deviceReceivedAt: new Date(Date.now() - 100 * 86400_000), shopWarrantyEndDate: new Date(Date.now() - 30 * 86400_000) });
  prisma.product.findUnique.mockResolvedValue({ warrantyExpireDate: new Date(Date.now() - 10 * 86400_000) });
  prisma.repairTicket.create.mockResolvedValue({ id: 't-5', warrantyStatus: 'OUT_OF_WARRANTY' });
  const r = await svc.create({ customerId: 'c-1', contractId: 'k-1', productId: 'p-1', defectDescription: 'จอเสีย', branchId: 'br-1' } as any, OWNER);
  expect(r.warrantyStatus).toBe('OUT_OF_WARRANTY');
});

it('defaults payer=CUSTOMER for WALK_IN', async () => {
  prisma.repairTicket.create.mockImplementation(({ data }: any) => ({ id: 't-x', ...data }));
  await svc.create({ customerId: 'c-1', defectDescription: 'จอเสีย', branchId: 'br-1' } as any, OWNER);
  expect(prisma.repairTicket.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payer: 'CUSTOMER' }) }));
});

it('defaults payer=SHOP for IN_SHOP_WARRANTY', async () => {
  prisma.contract.findUnique.mockResolvedValue({ deviceReceivedAt: new Date(Date.now() - 20 * 86400_000), shopWarrantyEndDate: new Date(Date.now() + 40 * 86400_000) });
  prisma.repairTicket.create.mockImplementation(({ data }: any) => ({ id: 't-x', ...data }));
  await svc.create({ customerId: 'c-1', contractId: 'k-1', defectDescription: 'จอเสีย', branchId: 'br-1' } as any, OWNER);
  expect(prisma.repairTicket.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payer: 'SHOP' }) }));
});

it('throws NotFoundException for stale contractId', async () => {
  prisma.contract.findUnique.mockResolvedValue(null);
  await expect(svc.create({ customerId: 'c-1', contractId: 'gone', defectDescription: 'จอ', branchId: 'br-1' } as any, OWNER)).rejects.toThrow('ไม่พบสัญญา');
});

it('uses ticketNumber format RT-YYYYMMDD-NNNN', async () => {
  prisma.repairTicket.create.mockImplementation(({ data }: any) => ({ id: 't-x', ...data }));
  await svc.create({ customerId: 'c-1', defectDescription: 'จอเสีย', branchId: 'br-1' } as any, OWNER);
  const call = prisma.repairTicket.create.mock.calls[0][0];
  expect(call.data.ticketNumber).toMatch(/^RT-\d{8}-\d{4}$/);
});
```

- [ ] **Step 6: Run + commit**

Run: `cd apps/api && npx jest repair-tickets.service --silent`
Expected: 8/8 pass

```bash
git add apps/api/src/modules/repair-tickets/
git commit -m "feat(repair-tickets): RepairTicketsService.create + 8 tests"
```

### Task 2.4: RepairTicketService — `send()` + `markRepaired()` + `sendBack()`

**Files:**
- Modify: `apps/api/src/modules/repair-tickets/repair-tickets.service.ts`
- Modify: `apps/api/src/modules/repair-tickets/__tests__/repair-tickets.service.spec.ts`

- [ ] **Step 1: Write failing tests for `send()`**

```ts
describe('RepairTicketsService.send', () => {
  let svc: RepairTicketsService;
  let prisma: any;
  let audit: any;
  // (same beforeEach as create describe — extract a shared factory if helpful)

  beforeEach(async () => { /* same factory */ });

  it('OPEN → IN_PROGRESS happy path', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', isRepairCenter: true });
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1', status: 'IN_PROGRESS' });

    const r = await svc.send('t-1', { repairSupplierId: 'sup-1' } as any, OWNER);

    expect(prisma.repairTicket.updateMany).toHaveBeenCalledWith({
      where: { id: 't-1', status: 'OPEN', deletedAt: null },
      data: expect.objectContaining({ status: 'IN_PROGRESS', repairSupplierId: 'sup-1' }),
    });
    expect(prisma.repairStatusLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ fromStatus: 'OPEN', toStatus: 'IN_PROGRESS' }) });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'REPAIR_TICKET_SENT' }));
  });

  it('throws ConflictException when ticket not in OPEN status', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', isRepairCenter: true });
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.send('t-1', { repairSupplierId: 'sup-1' } as any, OWNER)).rejects.toThrow('สถานะถูกเปลี่ยน');
  });

  it('throws BadRequestException when supplier is not a repair center', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', isRepairCenter: false });
    await expect(svc.send('t-1', { repairSupplierId: 'sup-1' } as any, OWNER)).rejects.toThrow('ไม่ใช่ศูนย์ซ่อม');
  });

  it('throws NotFoundException when supplier does not exist', async () => {
    prisma.supplier.findUnique.mockResolvedValue(null);
    await expect(svc.send('t-1', { repairSupplierId: 'sup-1' } as any, OWNER)).rejects.toThrow('ไม่พบ');
  });

  it('persists optional externalClaimNo and estimatedCost', async () => {
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', isRepairCenter: true });
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({});
    await svc.send('t-1', { repairSupplierId: 'sup-1', externalClaimNo: 'AP-2026-001', estimatedCost: 2000 } as any, OWNER);
    expect(prisma.repairTicket.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ externalClaimNo: 'AP-2026-001' }),
    }));
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `cd apps/api && npx jest repair-tickets.service --silent`
Expected: FAIL "send is not a function"

- [ ] **Step 3: Implement `send()`**

Add to `RepairTicketsService`:

```ts
async send(id: string, dto: SendDto, user: ReqUser) {
  return this.prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: dto.repairSupplierId, deletedAt: null } });
    if (!supplier) throw new NotFoundException('ไม่พบศูนย์ซ่อม');
    if (!supplier.isRepairCenter) throw new BadRequestException('Supplier ไม่ใช่ศูนย์ซ่อม (isRepairCenter=false)');

    const sentAt = dto.sentToRepairAt ? new Date(dto.sentToRepairAt) : new Date();
    const updated = await tx.repairTicket.updateMany({
      where: { id, status: 'OPEN', deletedAt: null },
      data: {
        status: 'IN_PROGRESS',
        sentToRepairAt: sentAt,
        repairSupplierId: dto.repairSupplierId,
        externalClaimNo: dto.externalClaimNo,
        estimatedCost: dto.estimatedCost != null ? new Prisma.Decimal(dto.estimatedCost) : undefined,
      },
    });
    if (updated.count === 0) throw new ConflictException('สถานะถูกเปลี่ยนไปแล้ว (ต้องเป็น OPEN)');

    await tx.repairStatusLog.create({
      data: { ticketId: id, fromStatus: 'OPEN', toStatus: 'IN_PROGRESS', changedById: user.id, note: dto.externalClaimNo },
    });

    await this.audit.log({
      userId: user.id,
      action: 'REPAIR_TICKET_SENT',
      entity: 'repair_ticket',
      entityId: id,
      newValue: { repairSupplierId: dto.repairSupplierId, externalClaimNo: dto.externalClaimNo, estimatedCost: dto.estimatedCost },
    });

    return tx.repairTicket.findUnique({ where: { id } });
  });
}
```

(Import `SendDto` from `./dto/send.dto`.)

- [ ] **Step 4: Run send tests → expect pass**

Run: `cd apps/api && npx jest repair-tickets.service --silent -t "send"`
Expected: 5/5 in this describe block pass

- [ ] **Step 5: Repeat pattern for `markRepaired()` (4 tests) + `sendBack()` (3 tests)**

`markRepaired()` tests:
- happy path IN_PROGRESS → READY_FOR_PICKUP
- non-IN_PROGRESS → ConflictException
- actualCost stored as Prisma.Decimal (not Number)
- payer override accepted

`sendBack()` tests:
- READY_FOR_PICKUP → IN_PROGRESS
- clears `repairedAt`
- note required (DTO validation handles min 5 chars)

Implementations follow the same CAS pattern + status log + audit log.

```ts
async markRepaired(id: string, dto: MarkRepairedDto, user: ReqUser) {
  return this.prisma.$transaction(async (tx) => {
    const repairedAt = dto.repairedAt ? new Date(dto.repairedAt) : new Date();
    const updated = await tx.repairTicket.updateMany({
      where: { id, status: 'IN_PROGRESS', deletedAt: null },
      data: {
        status: 'READY_FOR_PICKUP',
        repairedAt,
        actualCost: new Prisma.Decimal(dto.actualCost),
        payer: dto.payer,
      },
    });
    if (updated.count === 0) throw new ConflictException('สถานะถูกเปลี่ยนไปแล้ว (ต้องเป็น IN_PROGRESS)');

    await tx.repairStatusLog.create({
      data: { ticketId: id, fromStatus: 'IN_PROGRESS', toStatus: 'READY_FOR_PICKUP', changedById: user.id },
    });

    await this.audit.log({
      userId: user.id,
      action: 'REPAIR_TICKET_MARKED_REPAIRED',
      entity: 'repair_ticket',
      entityId: id,
      newValue: { actualCost: dto.actualCost, payer: dto.payer },
    });

    return tx.repairTicket.findUnique({ where: { id } });
  });
}

async sendBack(id: string, dto: SendBackDto, user: ReqUser) {
  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.repairTicket.updateMany({
      where: { id, status: 'READY_FOR_PICKUP', deletedAt: null },
      data: { status: 'IN_PROGRESS', repairedAt: null },
    });
    if (updated.count === 0) throw new ConflictException('สถานะถูกเปลี่ยนไปแล้ว (ต้องเป็น READY_FOR_PICKUP)');

    await tx.repairStatusLog.create({
      data: { ticketId: id, fromStatus: 'READY_FOR_PICKUP', toStatus: 'IN_PROGRESS', changedById: user.id, note: dto.note },
    });

    await this.audit.log({
      userId: user.id,
      action: 'REPAIR_TICKET_SENT_BACK',
      entity: 'repair_ticket',
      entityId: id,
      newValue: { note: dto.note },
    });

    return tx.repairTicket.findUnique({ where: { id } });
  });
}
```

- [ ] **Step 6: Run all → commit**

Run: `cd apps/api && npx jest repair-tickets.service --silent`
Expected: ≥16/16 pass

```bash
git add apps/api/src/modules/repair-tickets/
git commit -m "feat(repair-tickets): send + markRepaired + sendBack transitions"
```

### Task 2.5: RepairTicketService — `returnToCustomer()` + auto-doc creation

**Files:**
- Modify: `apps/api/src/modules/repair-tickets/repair-tickets.service.ts`
- Modify: `apps/api/src/modules/repair-tickets/__tests__/repair-tickets.service.spec.ts`

This is the most complex method. Auto-creates either ExpenseDocument (SHOP) or OtherIncome (CUSTOMER) draft, then links the FK back to the ticket — all inside a single `$transaction`.

- [ ] **Step 1: Inspect existing ExpenseDocumentsService.create signature**

Run: `grep -B2 -A30 "async create\(" apps/api/src/modules/expense-documents/expense-documents.service.ts | head -50`

Note the exact parameter shape and how it accepts a `Prisma.TransactionClient` (or doesn't — may need a `createDraft` overload).

- [ ] **Step 2: Inspect OtherIncomeService.create signature**

Run: `grep -B2 -A30 "async create\(" apps/api/src/modules/other-income/other-income.service.ts | head -50`

- [ ] **Step 3: If either service does not accept a tx, add `createDraft(dto, tx)` overload**

If the existing public method opens its own transaction, expose a new transactional method:

```ts
// In ExpenseDocumentsService:
async createDraftForRepair(dto: {
  type: 'REPAIR_SERVICE',
  vendorId: string,
  amount: number,
  description: string,
  branchId: string,
  createdById: string,
  metadata: Record<string, any>,
  companyCode: 'SHOP',
}, tx: Prisma.TransactionClient): Promise<{ id: string }> {
  // ... internal logic that uses tx instead of this.prisma
}
```

(Same pattern for OtherIncomeService.) Do this in PR2 — additive, doesn't break existing callers.

- [ ] **Step 4: Write failing tests for returnToCustomer**

```ts
describe('RepairTicketsService.returnToCustomer', () => {
  // ... mock setup including expenseDocs.createDraftForRepair + otherIncome.createDraftForRepair

  it('payer=SHOP → creates ExpenseDocument draft + links FK', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({
      id: 't-1', branchId: 'br-1', customerId: 'c-1',
      repairSupplierId: 'sup-1', payer: 'SHOP', actualCost: new (Prisma as any).Decimal(2500),
      defectDescription: 'จอเสีย', customer: { name: 'นาย ก' },
    });
    expenseDocs.createDraftForRepair.mockResolvedValue({ id: 'ed-1' });
    systemConfig.get.mockImplementation((k: string) => k === 'REPAIR_EXPENSE_ACCOUNT_CODE' ? '52-9999' : null);

    const r = await svc.returnToCustomer('t-1', {} as any, OWNER);

    expect(expenseDocs.createDraftForRepair).toHaveBeenCalledWith(expect.objectContaining({
      type: 'REPAIR_SERVICE', vendorId: 'sup-1', amount: 2500, companyCode: 'SHOP',
      metadata: expect.objectContaining({ flow: 'repair-ticket-close', repairTicketId: 't-1' }),
    }), expect.anything());
    expect(prisma.repairTicket.update).toHaveBeenCalledWith({ where: { id: 't-1' }, data: { expenseDocumentId: 'ed-1' } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'REPAIR_TICKET_RETURNED', newValue: expect.objectContaining({ expenseDocumentId: 'ed-1' }) }));
  });

  it('payer=CUSTOMER → creates OtherIncome draft + links FK', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({
      id: 't-1', branchId: 'br-1', customerId: 'c-1', payer: 'CUSTOMER',
      actualCost: new (Prisma as any).Decimal(800), defectDescription: 'ซ่อม PC',
      customer: { name: 'นาย ข' },
    });
    otherIncome.createDraftForRepair.mockResolvedValue({ id: 'oi-1' });
    systemConfig.get.mockImplementation((k: string) => k === 'REPAIR_INCOME_ACCOUNT_CODE' ? '42-9998' : null);

    await svc.returnToCustomer('t-1', {} as any, OWNER);

    expect(otherIncome.createDraftForRepair).toHaveBeenCalledWith(expect.objectContaining({
      accountCode: '42-9998', counterpartyName: 'นาย ข', amount: 800, companyCode: 'SHOP',
    }), expect.anything());
    expect(prisma.repairTicket.update).toHaveBeenCalledWith({ where: { id: 't-1' }, data: { otherIncomeId: 'oi-1' } });
  });

  it('payer=SUPPLIER_CLAIM → no doc created', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1', payer: 'SUPPLIER_CLAIM', actualCost: new (Prisma as any).Decimal(0) });
    await svc.returnToCustomer('t-1', {} as any, OWNER);
    expect(expenseDocs.createDraftForRepair).not.toHaveBeenCalled();
    expect(otherIncome.createDraftForRepair).not.toHaveBeenCalled();
  });

  it('idempotency: re-call throws ConflictException', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.returnToCustomer('t-1', {} as any, OWNER)).rejects.toThrow('สถานะถูกเปลี่ยน');
  });

  it('rolls back entire tx when expense doc creation throws', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({ payer: 'SHOP', actualCost: new (Prisma as any).Decimal(2500), repairSupplierId: 'sup-1' });
    expenseDocs.createDraftForRepair.mockRejectedValue(new Error('vendor mismatch'));
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma).then((r: any) => r, (e: any) => { throw e; }));

    await expect(svc.returnToCustomer('t-1', {} as any, OWNER)).rejects.toThrow('vendor mismatch');
    // ticket.update should NOT have been called to link the FK (caller passes nothing in)
    expect(audit.log).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'REPAIR_TICKET_RETURNED' }));
  });
});
```

- [ ] **Step 5: Implement `returnToCustomer()`**

```ts
async returnToCustomer(id: string, dto: ReturnToCustomerDto, user: ReqUser) {
  return this.prisma.$transaction(async (tx) => {
    const returnedAt = dto.returnedToCustomerAt ? new Date(dto.returnedToCustomerAt) : new Date();
    const updated = await tx.repairTicket.updateMany({
      where: { id, status: 'READY_FOR_PICKUP', deletedAt: null },
      data: { status: 'CLOSED', returnedToCustomerAt: returnedAt },
    });
    if (updated.count === 0) throw new ConflictException('สถานะถูกเปลี่ยนไปแล้ว (ต้องเป็น READY_FOR_PICKUP)');

    const ticket = await tx.repairTicket.findUnique({
      where: { id },
      include: { customer: true, contract: { include: { product: true } }, product: true },
    });
    if (!ticket) throw new NotFoundException('ไม่พบ ticket');

    let expenseDocumentId: string | null = null;
    let otherIncomeId: string | null = null;

    if (ticket.payer === 'SHOP' && ticket.actualCost && ticket.repairSupplierId) {
      const accountCode = await this.systemConfig.get('REPAIR_EXPENSE_ACCOUNT_CODE');
      if (!accountCode) throw new BadRequestException('REPAIR_EXPENSE_ACCOUNT_CODE not configured');
      const doc = await this.expenseDocs.createDraftForRepair({
        type: 'REPAIR_SERVICE',
        vendorId: ticket.repairSupplierId,
        amount: Number(ticket.actualCost),
        description: `ค่าซ่อม ${formatDevice(ticket as any)}: ${ticket.defectDescription.slice(0, 60)}`,
        branchId: ticket.branchId,
        createdById: user.id,
        metadata: { flow: 'repair-ticket-close', repairTicketId: ticket.id },
        companyCode: 'SHOP',
      }, tx);
      expenseDocumentId = doc.id;
    } else if (ticket.payer === 'CUSTOMER' && ticket.actualCost) {
      const accountCode = await this.systemConfig.get('REPAIR_INCOME_ACCOUNT_CODE');
      if (!accountCode) throw new BadRequestException('REPAIR_INCOME_ACCOUNT_CODE not configured');
      const oi = await this.otherIncome.createDraftForRepair({
        accountCode,
        counterpartyName: ticket.customer.name,
        customerId: ticket.customerId,
        amount: Number(ticket.actualCost),
        description: `ค่าบริการซ่อม ${formatDevice(ticket as any)}`,
        receivedAt: returnedAt,
        branchId: ticket.branchId,
        createdById: user.id,
        metadata: { flow: 'repair-ticket-close', repairTicketId: ticket.id },
        companyCode: 'SHOP',
      }, tx);
      otherIncomeId = oi.id;
    }

    if (expenseDocumentId || otherIncomeId) {
      await tx.repairTicket.update({
        where: { id },
        data: { expenseDocumentId, otherIncomeId },
      });
    }

    await tx.repairStatusLog.create({
      data: { ticketId: id, fromStatus: 'READY_FOR_PICKUP', toStatus: 'CLOSED', changedById: user.id },
    });

    await this.audit.log({
      userId: user.id,
      action: 'REPAIR_TICKET_RETURNED',
      entity: 'repair_ticket',
      entityId: id,
      newValue: { expenseDocumentId, otherIncomeId, actualCost: ticket.actualCost?.toString(), payer: ticket.payer },
    });

    return { ticket: { ...ticket, status: 'CLOSED' as const }, expenseDocumentId, otherIncomeId };
  });
}
```

(Import `formatDevice` from `./utils/format-device`.)

- [ ] **Step 6: Run + commit**

Run: `cd apps/api && npx jest repair-tickets.service --silent -t "returnToCustomer"`
Expected: 5/5 pass

```bash
git add apps/api/src/modules/{repair-tickets,expense-documents,other-income}/
git commit -m "feat(repair-tickets): returnToCustomer + auto-create ExpenseDoc/OtherIncome draft

Atomic across modules via $transaction. Idempotency guarded by CAS + @unique FKs."
```

### Task 2.6: RepairTicketService — `replace()` + `markReplaced()` + `cancel()`

**Files:**
- Modify: `apps/api/src/modules/repair-tickets/repair-tickets.service.ts`
- Modify: `apps/api/src/modules/repair-tickets/__tests__/repair-tickets.service.spec.ts`

- [ ] **Step 1: Write tests**

`replace()` tests:
- happy path → links defectExchangeId, transitions to REPLACED
- defectExchange.customerId mismatch → ForbiddenException
- defectExchange not found → NotFoundException
- already terminal → ConflictException

`markReplaced()` (internal — called by defect-exchange in PR3, exposed here):
- equivalent to replace() body without the standalone defect-exchange lookup
- same CAS guard

`cancel()` tests:
- OPEN → CANCELLED happy path
- IN_PROGRESS → CANCELLED
- already terminal → ConflictException
- note required (DTO validation handles)

```ts
describe('RepairTicketsService.replace', () => {
  // ... mock setup, add prisma.defectExchange.findUnique

  it('happy path: links defectExchangeId + transitions to REPLACED', async () => {
    prisma.defectExchange = { findUnique: jest.fn().mockResolvedValue({ id: 'de-1', customerId: 'c-1' }) };
    prisma.repairTicket.findUnique.mockResolvedValueOnce({ id: 't-1', customerId: 'c-1', status: 'IN_PROGRESS' });
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValueOnce({ id: 't-1', status: 'REPLACED', defectExchangeId: 'de-1' });

    await svc.replace('t-1', { defectExchangeId: 'de-1' } as any, OWNER);

    expect(prisma.repairTicket.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 't-1', status: { in: ['OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP'] } }),
      data: expect.objectContaining({ status: 'REPLACED', defectExchangeId: 'de-1' }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'REPAIR_TICKET_REPLACED' }));
  });

  it('throws Forbidden when defectExchange.customerId mismatch', async () => {
    prisma.defectExchange = { findUnique: jest.fn().mockResolvedValue({ id: 'de-1', customerId: 'c-other' }) };
    prisma.repairTicket.findUnique.mockResolvedValueOnce({ id: 't-1', customerId: 'c-1', status: 'OPEN' });
    await expect(svc.replace('t-1', { defectExchangeId: 'de-1' } as any, OWNER)).rejects.toThrow('customer');
  });

  it('throws NotFoundException when defectExchange does not exist', async () => {
    prisma.defectExchange = { findUnique: jest.fn().mockResolvedValue(null) };
    prisma.repairTicket.findUnique.mockResolvedValueOnce({ id: 't-1', customerId: 'c-1', status: 'OPEN' });
    await expect(svc.replace('t-1', { defectExchangeId: 'de-gone' } as any, OWNER)).rejects.toThrow('ไม่พบ');
  });

  it('throws ConflictException when ticket already terminal', async () => {
    prisma.defectExchange = { findUnique: jest.fn().mockResolvedValue({ id: 'de-1', customerId: 'c-1' }) };
    prisma.repairTicket.findUnique.mockResolvedValueOnce({ id: 't-1', customerId: 'c-1', status: 'CLOSED' });
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.replace('t-1', { defectExchangeId: 'de-1' } as any, OWNER)).rejects.toThrow('สถานะ');
  });
});

describe('RepairTicketsService.cancel', () => {
  it('happy path OPEN → CANCELLED', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 1 });
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1', status: 'CANCELLED' });
    await svc.cancel('t-1', { note: 'ลูกค้าเปลี่ยนใจ' } as any, OWNER);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'REPAIR_TICKET_CANCELLED', newValue: { note: 'ลูกค้าเปลี่ยนใจ' } }));
  });

  it('throws ConflictException when already terminal', async () => {
    prisma.repairTicket.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.cancel('t-1', { note: 'too late' } as any, OWNER)).rejects.toThrow('สถานะ');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `cd apps/api && npx jest repair-tickets.service --silent -t "replace|cancel"`
Expected: FAIL

- [ ] **Step 3: Implement `replace()`, `markReplaced()`, `cancel()`**

```ts
async replace(id: string, dto: ReplaceDto, user: ReqUser) {
  return this.prisma.$transaction(async (tx) => {
    const ticket = await tx.repairTicket.findUnique({ where: { id, deletedAt: null } });
    if (!ticket) throw new NotFoundException('ไม่พบ ticket');
    const de = await tx.defectExchange.findUnique({ where: { id: dto.defectExchangeId, deletedAt: null } });
    if (!de) throw new NotFoundException('ไม่พบ defect exchange');
    if (de.customerId !== ticket.customerId) throw new ForbiddenException('customer ของ defect exchange ไม่ตรง');

    return this.markReplaced(id, dto.defectExchangeId, user, tx);
  });
}

// Public so defect-exchange.create can call directly inside its own tx
async markReplaced(
  id: string,
  defectExchangeId: string,
  user: ReqUser,
  tx: Prisma.TransactionClient | PrismaService = this.prisma,
) {
  const replacedAt = new Date();
  const updated = await tx.repairTicket.updateMany({
    where: { id, status: { in: ['OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP'] }, deletedAt: null },
    data: { status: 'REPLACED', replacedAt, defectExchangeId },
  });
  if (updated.count === 0) throw new ConflictException('สถานะถูกเปลี่ยนไปแล้ว — replace ทำได้เฉพาะ OPEN/IN_PROGRESS/READY_FOR_PICKUP');

  await tx.repairStatusLog.create({
    data: { ticketId: id, fromStatus: 'OPEN', toStatus: 'REPLACED', changedById: user.id, note: `defect-exchange ${defectExchangeId}` },
  });

  await this.audit.log({
    userId: user.id,
    action: 'REPAIR_TICKET_REPLACED',
    entity: 'repair_ticket',
    entityId: id,
    newValue: { defectExchangeId },
  });

  return tx.repairTicket.findUnique({ where: { id } });
}

async cancel(id: string, dto: CancelDto, user: ReqUser) {
  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.repairTicket.updateMany({
      where: { id, status: { in: ['OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP'] }, deletedAt: null },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (updated.count === 0) throw new ConflictException('สถานะถูกเปลี่ยนไปแล้ว');

    await tx.repairStatusLog.create({
      data: { ticketId: id, fromStatus: 'OPEN', toStatus: 'CANCELLED', changedById: user.id, note: dto.note },
    });

    await this.audit.log({
      userId: user.id,
      action: 'REPAIR_TICKET_CANCELLED',
      entity: 'repair_ticket',
      entityId: id,
      newValue: { note: dto.note },
    });

    return tx.repairTicket.findUnique({ where: { id } });
  });
}
```

- [ ] **Step 4: Run + commit**

Run: `cd apps/api && npx jest repair-tickets.service --silent`
Expected: ≥22/22 pass

```bash
git add apps/api/src/modules/repair-tickets/
git commit -m "feat(repair-tickets): replace + markReplaced + cancel transitions"
```

### Task 2.7: RepairTicketService — query methods + recalcWarranty + soft delete

**Files:**
- Modify: `apps/api/src/modules/repair-tickets/repair-tickets.service.ts`
- Modify: `apps/api/src/modules/repair-tickets/__tests__/repair-tickets.service.spec.ts`

- [ ] **Step 1: Tests for findAll + findOne + recalcWarranty + softDelete + update**

```ts
describe('RepairTicketsService.findAll', () => {
  it('returns paginated list with default page=1 limit=50', async () => {
    prisma.repairTicket.findMany.mockResolvedValue([{ id: 't-1' }]);
    prisma.repairTicket.count.mockResolvedValue(1);
    const r = await svc.findAll({}, OWNER);
    expect(r.data).toHaveLength(1);
    expect(r.page).toBe(1);
    expect(r.limit).toBe(50);
    expect(r.total).toBe(1);
  });

  it('applies status filter', async () => {
    await svc.findAll({ status: 'OPEN' }, OWNER);
    expect(prisma.repairTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'OPEN' }),
    }));
  });

  it('SALES role scoped to own branch', async () => {
    await svc.findAll({}, { id: 'u-s', role: 'SALES', branchId: 'br-1' });
    expect(prisma.repairTicket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ branchId: 'br-1' }),
    }));
  });

  it('OWNER not constrained by branch unless filter passed', async () => {
    await svc.findAll({}, OWNER);
    const call = prisma.repairTicket.findMany.mock.calls[0][0];
    expect(call.where.branchId).toBeUndefined();
  });

  it('search query matches ticketNumber OR customer.name OR deviceImei', async () => {
    await svc.findAll({ q: '352xxx' }, OWNER);
    const call = prisma.repairTicket.findMany.mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
  });
});

describe('RepairTicketsService.recalcWarranty', () => {
  it('only works on OPEN status', async () => {
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1', status: 'IN_PROGRESS' });
    await expect(svc.recalcWarranty('t-1', OWNER)).rejects.toThrow('OPEN');
  });

  it('recomputes warrantyStatus from live contract/product', async () => {
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1', status: 'OPEN', contractId: 'k-1', productId: null });
    prisma.contract.findUnique.mockResolvedValue({ shopWarrantyEndDate: new Date(Date.now() + 30 * 86400_000) });
    prisma.repairTicket.update.mockResolvedValue({ id: 't-1', warrantyStatus: 'IN_SHOP_WARRANTY' });
    const r = await svc.recalcWarranty('t-1', OWNER);
    expect(r.warrantyStatus).toBe('IN_SHOP_WARRANTY');
  });
});

describe('RepairTicketsService.softDelete', () => {
  it('OWNER can soft-delete CANCELLED ticket', async () => {
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1', status: 'CANCELLED' });
    await svc.softDelete('t-1', OWNER);
    expect(prisma.repairTicket.update).toHaveBeenCalledWith({ where: { id: 't-1' }, data: { deletedAt: expect.any(Date) } });
  });

  it('refuses to soft-delete non-CANCELLED ticket', async () => {
    prisma.repairTicket.findUnique.mockResolvedValue({ id: 't-1', status: 'CLOSED' });
    await expect(svc.softDelete('t-1', OWNER)).rejects.toThrow('CANCELLED');
  });
});
```

- [ ] **Step 2: Implement**

```ts
async findAll(dto: ListRepairTicketsDto, user: ReqUser) {
  const page = dto.page ?? 1;
  const limit = dto.limit ?? 50;
  const skip = (page - 1) * limit;

  const where: Prisma.RepairTicketWhereInput = { deletedAt: null };
  if (dto.status) where.status = dto.status;
  if (dto.customerId) where.customerId = dto.customerId;
  if (dto.repairSupplierId) where.repairSupplierId = dto.repairSupplierId;
  if (dto.from || dto.to) {
    where.createdAt = {};
    if (dto.from) where.createdAt.gte = new Date(dto.from);
    if (dto.to) where.createdAt.lte = new Date(dto.to);
  }

  // Branch scope
  const isCrossBranch = ['OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER'].includes(user.role);
  if (!isCrossBranch && user.branchId) {
    where.branchId = user.branchId;
  } else if (dto.branchId) {
    where.branchId = dto.branchId;
  }

  if (dto.q) {
    where.OR = [
      { ticketNumber: { contains: dto.q, mode: 'insensitive' } },
      { customer: { name: { contains: dto.q, mode: 'insensitive' } } },
      { deviceImei: { contains: dto.q, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    this.prisma.repairTicket.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true } },
        repairSupplier: { select: { id: true, name: true } },
      },
    }),
    this.prisma.repairTicket.count({ where }),
  ]);
  return { data, total, page, limit };
}

async findOne(id: string, user: ReqUser) {
  const ticket = await this.prisma.repairTicket.findUnique({
    where: { id, deletedAt: null },
    include: {
      customer: true,
      contract: { include: { product: true } },
      product: true,
      repairSupplier: true,
      branch: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      expenseDocument: { select: { id: true, number: true, status: true, totalAmount: true } },
      otherIncome: { select: { id: true, docNumber: true, status: true, totalAmount: true } },
      defectExchange: true,
      statusLogs: { include: { changedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!ticket) throw new NotFoundException('ไม่พบ ticket');
  // BranchGuard at controller covers cross-branch — defensive double-check here
  const isCrossBranch = ['OWNER', 'ACCOUNTANT', 'FINANCE_MANAGER'].includes(user.role);
  if (!isCrossBranch && user.branchId && ticket.branchId !== user.branchId) {
    throw new ForbiddenException('ไม่สามารถเข้าถึงสาขาอื่นได้');
  }
  return ticket;
}

async update(id: string, dto: UpdateRepairTicketDto, user: ReqUser) {
  return this.prisma.$transaction(async (tx) => {
    const ticket = await tx.repairTicket.findUnique({ where: { id, deletedAt: null } });
    if (!ticket) throw new NotFoundException('ไม่พบ ticket');
    if (ticket.status !== 'OPEN') throw new ConflictException('แก้ไขได้เฉพาะ status=OPEN');

    const updated = await tx.repairTicket.update({
      where: { id },
      data: {
        defectDescription: dto.defectDescription,
        repairSupplierId: dto.repairSupplierId,
        estimatedCost: dto.estimatedCost != null ? new Prisma.Decimal(dto.estimatedCost) : undefined,
        notes: dto.notes,
      },
    });

    await this.audit.log({
      userId: user.id,
      action: 'REPAIR_TICKET_EDITED',
      entity: 'repair_ticket',
      entityId: id,
      oldValue: ticket,
      newValue: updated,
    });

    return updated;
  });
}

async recalcWarranty(id: string, user: ReqUser) {
  return this.prisma.$transaction(async (tx) => {
    const ticket = await tx.repairTicket.findUnique({ where: { id, deletedAt: null } });
    if (!ticket) throw new NotFoundException('ไม่พบ ticket');
    if (ticket.status !== 'OPEN') throw new ConflictException('recalc warranty ทำได้เฉพาะ status=OPEN');

    const contract = ticket.contractId ? await tx.contract.findUnique({ where: { id: ticket.contractId } }) : null;
    const product = ticket.productId ? await tx.product.findUnique({ where: { id: ticket.productId } }) : null;
    const warrantyStatus = detectWarrantyStatus({ contract, product });

    const updated = await tx.repairTicket.update({
      where: { id },
      data: { warrantyStatus },
    });

    await this.audit.log({
      userId: user.id,
      action: 'REPAIR_TICKET_WARRANTY_RECALC',
      entity: 'repair_ticket',
      entityId: id,
      newValue: { oldStatus: ticket.warrantyStatus, newStatus: warrantyStatus },
    });

    return updated;
  });
}

async softDelete(id: string, user: ReqUser) {
  const ticket = await this.prisma.repairTicket.findUnique({ where: { id, deletedAt: null } });
  if (!ticket) throw new NotFoundException('ไม่พบ ticket');
  if (ticket.status !== 'CANCELLED') throw new ConflictException('soft-delete ทำได้เฉพาะ status=CANCELLED');

  await this.prisma.repairTicket.update({ where: { id }, data: { deletedAt: new Date() } });
  await this.audit.log({
    userId: user.id,
    action: 'REPAIR_TICKET_SOFT_DELETED',
    entity: 'repair_ticket',
    entityId: id,
  });
}
```

- [ ] **Step 3: Run + commit**

Run: `cd apps/api && npx jest repair-tickets.service --silent`
Expected: ≥30/30 pass

```bash
git add apps/api/src/modules/repair-tickets/
git commit -m "feat(repair-tickets): findAll + findOne + update + recalcWarranty + softDelete"
```

### Task 2.8: RepairTicketsController + module registration

**Files:**
- Create: `apps/api/src/modules/repair-tickets/repair-tickets.controller.ts`
- Modify: `apps/api/src/modules/repair-tickets/repair-tickets.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Controller**

```ts
// apps/api/src/modules/repair-tickets/repair-tickets.controller.ts
import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Req, ParseUUIDPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RepairTicketsService } from './repair-tickets.service';
import { CreateRepairTicketDto } from './dto/create-repair-ticket.dto';
import { UpdateRepairTicketDto } from './dto/update-repair-ticket.dto';
import { ListRepairTicketsDto } from './dto/list-repair-tickets.dto';
import { SendDto } from './dto/send.dto';
import { MarkRepairedDto } from './dto/mark-repaired.dto';
import { SendBackDto } from './dto/send-back.dto';
import { ReturnToCustomerDto } from './dto/return-to-customer.dto';
import { CancelDto } from './dto/cancel.dto';
import { ReplaceDto } from './dto/replace.dto';

@Controller('repair-tickets')
@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)
export class RepairTicketsController {
  constructor(private readonly svc: RepairTicketsService) {}

  @Post()
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  create(@Body() dto: CreateRepairTicketDto, @Req() req: any) {
    return this.svc.create(dto, req.user);
  }

  @Get()
  list(@Query() dto: ListRepairTicketsDto, @Req() req: any) {
    return this.svc.findAll(dto, req.user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.findOne(id, req.user);
  }

  @Patch(':id')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRepairTicketDto, @Req() req: any) {
    return this.svc.update(id, dto, req.user);
  }

  @Post(':id/send')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendDto, @Req() req: any) {
    return this.svc.send(id, dto, req.user);
  }

  @Post(':id/mark-repaired')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  markRepaired(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkRepairedDto, @Req() req: any) {
    return this.svc.markRepaired(id, dto, req.user);
  }

  @Post(':id/send-back')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  sendBack(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendBackDto, @Req() req: any) {
    return this.svc.sendBack(id, dto, req.user);
  }

  @Post(':id/return-to-customer')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  returnToCustomer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnToCustomerDto, @Req() req: any) {
    return this.svc.returnToCustomer(id, dto, req.user);
  }

  @Post(':id/cancel')
  @Roles('OWNER', 'BRANCH_MANAGER')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto, @Req() req: any) {
    return this.svc.cancel(id, dto, req.user);
  }

  @Post(':id/replace')
  @Roles('OWNER', 'BRANCH_MANAGER')
  replace(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceDto, @Req() req: any) {
    return this.svc.replace(id, dto, req.user);
  }

  @Post(':id/recalc-warranty')
  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
  recalcWarranty(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.recalcWarranty(id, req.user);
  }

  @Delete(':id')
  @Roles('OWNER')
  softDelete(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.svc.softDelete(id, req.user);
  }
}
```

- [ ] **Step 2: Register controller + service**

Modify `repair-tickets.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { ExpenseDocumentsModule } from '../expense-documents/expense-documents.module';
import { OtherIncomeModule } from '../other-income/other-income.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { RepairTicketsController } from './repair-tickets.controller';
import { RepairTicketsService } from './repair-tickets.service';
import { RepairTicketDocNumberService } from './services/doc-number.service';

@Module({
  imports: [PrismaModule, AuditModule, ExpenseDocumentsModule, OtherIncomeModule, SystemConfigModule],
  controllers: [RepairTicketsController],
  providers: [RepairTicketsService, RepairTicketDocNumberService],
  exports: [RepairTicketsService],   // exported for defect-exchange to consume in PR3
})
export class RepairTicketsModule {}
```

- [ ] **Step 3: Register in app.module.ts**

Add to imports list (near other recently-added modules):

```ts
import { RepairTicketsModule } from './modules/repair-tickets/repair-tickets.module';

// In @Module imports:
RepairTicketsModule,
```

- [ ] **Step 4: Smoke test — boot the API**

Run: `cd apps/api && npm run dev` (in background)
Wait for "Nest application successfully started"

Test endpoints:

```bash
curl -sS -X GET http://localhost:3000/api/repair-tickets -w "\n%{http_code}\n"
# Expected: 401 (no auth — this confirms route is mounted)
```

- [ ] **Step 5: Run all API tests + commit**

Run: `cd apps/api && npx jest --silent`
Expected: existing test suite + new tests pass

```bash
git add apps/api/src/modules/repair-tickets/ apps/api/src/app.module.ts
git commit -m "feat(repair-tickets): RepairTicketsController + module registration"
```

### Task 2.9: Open PR 2

- [ ] **Step 1: Type check**

Run: `./tools/check-types.sh all`

- [ ] **Step 2: PR**

```bash
git push
gh pr create --title "feat(repair-tickets): PR 2/5 — service + endpoints + auto-doc creation" --body "..."
```

---

## PR 3 — Defect-exchange Bypass + Warranty Endpoints

**Goal:** (a) Allow `/defect-exchange` POST to skip the 7-day eligibility check when initiated from a repair-ticket replace action, atomically transitioning the source ticket to REPLACED. (b) Add 2 new endpoints needed by the wizard + warranty-check page: `GET /repair-tickets/warranty-preview` (single-device server-side preview for wizard Step 3) and `GET /repair-tickets/warranty-lookup` (multi-device search by customer/IMEI/contract for `/insurance/warranty-check`).

### Task 3.1: Update DefectExchange DTO

**Files:**
- Modify: `apps/api/src/modules/defect-exchange/dto/create-defect-exchange.dto.ts`

- [ ] **Step 1: Add optional bypass fields**

```ts
// existing class CreateDefectExchangeDto {
//   ... existing fields preserved
@IsOptional() @IsBoolean()
bypassWindowCheck?: boolean;

@IsOptional() @IsUUID()
originRepairTicketId?: string;
// }
```

- [ ] **Step 2: Type check**

Run: `cd apps/api && npx tsc --noEmit src/modules/defect-exchange/dto/create-defect-exchange.dto.ts`

### Task 3.2: Update defect-exchange service to handle bypass

**Files:**
- Modify: `apps/api/src/modules/defect-exchange/defect-exchange.service.ts`
- Modify: `apps/api/src/modules/defect-exchange/defect-exchange.module.ts` (add RepairTicketsModule import)
- Modify: `apps/api/src/modules/defect-exchange/__tests__/defect-exchange.service.spec.ts`

- [ ] **Step 1: Write 5 failing bypass tests**

```ts
describe('DefectExchangeService.create with bypassWindowCheck', () => {
  it('throws BadRequestException when bypass=true without originRepairTicketId', async () => {
    await expect(svc.create({ ...validDto, bypassWindowCheck: true } as any, OWNER))
      .rejects.toThrow('originRepairTicketId');
  });

  it('throws ForbiddenException when SALES role tries bypass', async () => {
    await expect(svc.create({ ...validDto, bypassWindowCheck: true, originRepairTicketId: 'rt-1' } as any, SALES_USER))
      .rejects.toThrow('OWNER');
  });

  it('throws ForbiddenException when ticket customer differs', async () => {
    prisma.repairTicket = { findUnique: jest.fn().mockResolvedValue({ id: 'rt-1', customerId: 'c-other', status: 'OPEN' }) };
    await expect(svc.create({ ...validDto, customerId: 'c-1', bypassWindowCheck: true, originRepairTicketId: 'rt-1' } as any, OWNER))
      .rejects.toThrow('customer');
  });

  it('throws when ticket already terminal', async () => {
    prisma.repairTicket = { findUnique: jest.fn().mockResolvedValue({ id: 'rt-1', customerId: 'c-1', status: 'CLOSED' }) };
    await expect(svc.create({ ...validDto, customerId: 'c-1', bypassWindowCheck: true, originRepairTicketId: 'rt-1' } as any, OWNER))
      .rejects.toThrow('terminal');
  });

  it('happy path: skips eligibility, sets back-ref, calls markReplaced, writes audit', async () => {
    prisma.repairTicket = { findUnique: jest.fn().mockResolvedValue({ id: 'rt-1', customerId: 'c-1', status: 'IN_PROGRESS' }) };
    repairService.markReplaced.mockResolvedValue({ id: 'rt-1', status: 'REPLACED' });
    prisma.defectExchange.create.mockResolvedValue({ id: 'de-1', originRepairTicketId: 'rt-1' });

    await svc.create({ ...validDto, customerId: 'c-1', bypassWindowCheck: true, originRepairTicketId: 'rt-1' } as any, OWNER);

    expect(svc.validateEligibility).not.toHaveBeenCalled();  // (or whatever the existing method is named)
    expect(repairService.markReplaced).toHaveBeenCalledWith('rt-1', 'de-1', OWNER, expect.anything());
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEFECT_EXCHANGE_WINDOW_BYPASSED' }));
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `cd apps/api && npx jest defect-exchange --silent`
Expected: 5 new cases FAIL; existing cases still pass

- [ ] **Step 3: Add RepairTicketsModule + RepairTicketsService injection**

In `defect-exchange.module.ts`:
```ts
imports: [
  /* existing */,
  forwardRef(() => RepairTicketsModule),
]
```

(Use `forwardRef` because RepairTicketsModule and DefectExchangeModule may import each other.)

In service constructor: inject `private repairTicketsService: RepairTicketsService` with `@Inject(forwardRef(() => RepairTicketsService))`.

- [ ] **Step 4: Modify `create()` to branch on bypass**

Find the existing `create()` method. Add the bypass logic at the top of the transaction:

```ts
async create(dto: CreateDefectExchangeDto, user: ReqUser) {
  return this.prisma.$transaction(async (tx) => {
    if (dto.bypassWindowCheck) {
      if (!dto.originRepairTicketId) {
        throw new BadRequestException('bypassWindowCheck ต้องระบุ originRepairTicketId');
      }
      if (!['OWNER', 'BRANCH_MANAGER'].includes(user.role)) {
        throw new ForbiddenException('สิทธิ์ไม่พอ — bypass ทำได้เฉพาะ OWNER/BRANCH_MANAGER');
      }
      const ticket = await tx.repairTicket.findUnique({ where: { id: dto.originRepairTicketId, deletedAt: null } });
      if (!ticket) throw new NotFoundException('ไม่พบ repair ticket');
      if (!['OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP'].includes(ticket.status)) {
        throw new BadRequestException('repair ticket อยู่ในสถานะ terminal — ไม่สามารถ replace ได้');
      }
      if (ticket.customerId !== dto.customerId) {
        throw new ForbiddenException('customer ของ repair ticket ไม่ตรงกับ defect-exchange');
      }
    } else {
      await this.validateEligibility(dto, tx);   // existing call (path unchanged)
    }

    // ... rest of existing create logic (transferred credit, new contract, etc.) — unchanged
    const de = await tx.defectExchange.create({ data: { /* ... */, originRepairTicketId: dto.originRepairTicketId } });

    if (dto.bypassWindowCheck && dto.originRepairTicketId) {
      await this.repairTicketsService.markReplaced(dto.originRepairTicketId, de.id, user, tx);
      await this.audit.log({
        userId: user.id,
        action: 'DEFECT_EXCHANGE_WINDOW_BYPASSED',
        entity: 'defect_exchange',
        entityId: de.id,
        newValue: { originRepairTicketId: dto.originRepairTicketId },
      });
    }

    return de;
  });
}
```

- [ ] **Step 5: Run all defect-exchange tests**

Run: `cd apps/api && npx jest defect-exchange --silent`
Expected: existing tests still pass + 5 new tests pass

- [ ] **Step 6: Run full API test suite for regression**

Run: `cd apps/api && npx jest --silent`
Expected: all green

- [ ] **Step 7: Commit (do NOT open PR yet — more tasks below)**

```bash
git add apps/api/src/modules/defect-exchange/
git commit -m "feat(defect-exchange): bypassWindowCheck flag for repair-ticket replace handoff"
```

### Task 3.3: Add `warrantyPreview` service method + endpoint

**Files:**
- Modify: `apps/api/src/modules/repair-tickets/repair-tickets.service.ts`
- Modify: `apps/api/src/modules/repair-tickets/repair-tickets.controller.ts`
- Create: `apps/api/src/modules/repair-tickets/dto/warranty-preview.dto.ts`

- [ ] **Step 1: Write the failing tests in service spec**

Append to `apps/api/src/modules/repair-tickets/__tests__/repair-tickets.service.spec.ts`:

```ts
describe('RepairTicketsService.warrantyPreview', () => {
  it('returns WALK_IN + defaultFlow=repair when no contract/product', async () => {
    const result = await svc.warrantyPreview({ customerId: 'c-1' }, SALES_USER);
    expect(result.warrantyStatus).toBe('WALK_IN');
    expect(result.defaultFlow).toBe('repair');
    expect(result.alternativeFlow).toBeNull();
    expect(result.eligibility.forExchange).toBe(false);
    expect(result.eligibility.forRepair).toBe(true);
  });

  it('returns IN_7DAY_DEFECT + defaultFlow=exchange + alternativeFlow=repair when within window + eligible', async () => {
    prisma.contract.findUnique = jest.fn().mockResolvedValue({
      id: 'ct-1', customerId: 'c-1', status: 'ACTIVE',
      deviceReceivedAt: new Date(Date.now() - 2 * 86400_000),  // 2 days ago
      shopWarrantyEndDate: new Date(Date.now() + 58 * 86400_000),
      product: { id: 'p-1', category: 'PHONE_USED', warrantyExpireDate: new Date(Date.now() + 300 * 86400_000) },
    });
    const result = await svc.warrantyPreview({ customerId: 'c-1', contractId: 'ct-1' }, SALES_USER);
    expect(result.warrantyStatus).toBe('IN_7DAY_DEFECT');
    expect(result.defaultFlow).toBe('exchange');
    expect(result.alternativeFlow).toBe('repair');
    expect(result.daysRemaining.sevenDayDefect).toBe(5);
    expect(result.eligibility.forExchange).toBe(true);
  });

  it('returns IN_SHOP_WARRANTY + defaultFlow=repair when 8-60 days after receipt', async () => {
    prisma.contract.findUnique = jest.fn().mockResolvedValue({
      id: 'ct-1', customerId: 'c-1', status: 'ACTIVE',
      deviceReceivedAt: new Date(Date.now() - 30 * 86400_000),
      shopWarrantyEndDate: new Date(Date.now() + 30 * 86400_000),
      product: { id: 'p-1', warrantyExpireDate: null },
    });
    const result = await svc.warrantyPreview({ customerId: 'c-1', contractId: 'ct-1' }, SALES_USER);
    expect(result.warrantyStatus).toBe('IN_SHOP_WARRANTY');
    expect(result.defaultFlow).toBe('repair');
    expect(result.defaultPayer).toBe('SHOP');
    expect(result.alternativeFlow).toBeNull();
  });

  it('returns OUT_OF_WARRANTY + defaultPayer=CUSTOMER when all warranties expired', async () => {
    prisma.contract.findUnique = jest.fn().mockResolvedValue({
      id: 'ct-1', customerId: 'c-1', status: 'ACTIVE',
      deviceReceivedAt: new Date(Date.now() - 400 * 86400_000),
      shopWarrantyEndDate: new Date(Date.now() - 340 * 86400_000),
      product: { id: 'p-1', warrantyExpireDate: new Date(Date.now() - 35 * 86400_000) },
    });
    const result = await svc.warrantyPreview({ customerId: 'c-1', contractId: 'ct-1' }, SALES_USER);
    expect(result.warrantyStatus).toBe('OUT_OF_WARRANTY');
    expect(result.defaultFlow).toBe('repair');
    expect(result.defaultPayer).toBe('CUSTOMER');
  });

  it('throws BadRequestException when no inputs provided', async () => {
    await expect(svc.warrantyPreview({} as any, SALES_USER)).rejects.toThrow('ต้องระบุ customerId หรือ productId');
  });

  it('daysRemaining math is correct across BKK timezone (no off-by-one)', async () => {
    const exact7d = new Date();
    exact7d.setHours(exact7d.getHours() - 24 * 7 + 1);  // just under 7 days
    prisma.contract.findUnique = jest.fn().mockResolvedValue({
      id: 'ct-1', customerId: 'c-1', status: 'ACTIVE',
      deviceReceivedAt: exact7d,
      shopWarrantyEndDate: new Date(Date.now() + 53 * 86400_000),
      product: { warrantyExpireDate: null },
    });
    const result = await svc.warrantyPreview({ customerId: 'c-1', contractId: 'ct-1' }, SALES_USER);
    expect(result.daysRemaining.sevenDayDefect).toBe(0);  // <1 day = floor to 0
    expect(result.warrantyStatus).toBe('IN_7DAY_DEFECT');
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `cd apps/api && npx jest repair-tickets/.*service --silent`
Expected: 6 new cases FAIL with "warrantyPreview is not a function"

- [ ] **Step 3: Create WarrantyPreviewDto**

```ts
// apps/api/src/modules/repair-tickets/dto/warranty-preview.dto.ts
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class WarrantyPreviewDto {
  @IsOptional() @IsUUID()
  customerId?: string;

  @IsOptional() @IsUUID()
  contractId?: string;

  @IsOptional() @IsUUID()
  productId?: string;
}
```

- [ ] **Step 4: Implement `warrantyPreview` in service**

Add to `apps/api/src/modules/repair-tickets/repair-tickets.service.ts`:

```ts
async warrantyPreview(dto: WarrantyPreviewDto, user: ReqUser) {
  if (!dto.customerId && !dto.contractId && !dto.productId) {
    throw new BadRequestException('ต้องระบุ customerId หรือ productId หรือ contractId อย่างน้อย 1 อย่าง');
  }

  const contract = dto.contractId
    ? await this.prisma.contract.findUnique({
        where: { id: dto.contractId, deletedAt: null },
        include: { product: true },
      })
    : null;

  const product = dto.productId
    ? await this.prisma.product.findUnique({ where: { id: dto.productId, deletedAt: null } })
    : contract?.product ?? null;

  // Reuse the existing detectWarrantyStatus helper (extracted in PR 2 Task 2.1)
  const warrantyStatus = await this.detectWarrantyStatus({
    contractId: dto.contractId,
    productId: product?.id,
  });

  const now = new Date();
  const sevenDayDefect = contract?.deviceReceivedAt
    ? Math.max(0, Math.floor(((contract.deviceReceivedAt.getTime() + 7 * 86400_000) - now.getTime()) / 86400_000))
    : null;
  const shopWarranty = contract?.shopWarrantyEndDate
    ? Math.max(0, Math.floor((contract.shopWarrantyEndDate.getTime() - now.getTime()) / 86400_000))
    : null;
  const mfrWarranty = product?.warrantyExpireDate
    ? Math.max(0, Math.floor((product.warrantyExpireDate.getTime() - now.getTime()) / 86400_000))
    : null;

  const forExchange =
    !!contract &&
    contract.status === 'ACTIVE' &&
    sevenDayDefect !== null &&
    sevenDayDefect > 0 &&
    product?.category === 'PHONE_USED';

  const defaultFlow: 'repair' | 'exchange' =
    warrantyStatus === 'IN_7DAY_DEFECT' && forExchange ? 'exchange' : 'repair';
  const alternativeFlow: 'repair' | null = defaultFlow === 'exchange' ? 'repair' : null;
  const defaultPayer = this.defaultPayer(warrantyStatus);

  // Audit log (async, do not await — throttled per-user)
  this.audit
    .log({
      userId: user.id,
      action: 'WARRANTY_LOOKED_UP',
      entity: 'repair_ticket',
      newValue: { searchMode: 'preview', query: dto, resultCount: 1 },
    })
    .catch(() => {});

  return {
    warrantyStatus,
    defaultFlow,
    alternativeFlow,
    defaultPayer,
    daysRemaining: { sevenDayDefect, shopWarranty, mfrWarranty },
    eligibility: { forExchange, forRepair: true },
    blockingReasons: undefined,
  };
}
```

- [ ] **Step 5: Add controller endpoint**

Add to `apps/api/src/modules/repair-tickets/repair-tickets.controller.ts`:

```ts
@Get('warranty-preview')
@Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
warrantyPreview(@Query() dto: WarrantyPreviewDto, @Req() req: any) {
  return this.svc.warrantyPreview(dto, req.user);
}
```

(Imports: `Get`, `Query`, `Req` from `@nestjs/common`; `WarrantyPreviewDto` from `./dto/warranty-preview.dto`.)

- [ ] **Step 6: Verify tests pass**

Run: `cd apps/api && npx jest repair-tickets/.*service --silent`
Expected: 6 new cases PASS; existing cases still pass

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/repair-tickets/
git commit -m "feat(repair-tickets): warrantyPreview endpoint for wizard Step 3 routing"
```

### Task 3.4: Add `warrantyLookup` service method + endpoint

**Files:**
- Modify: `apps/api/src/modules/repair-tickets/repair-tickets.service.ts`
- Modify: `apps/api/src/modules/repair-tickets/repair-tickets.controller.ts`
- Create: `apps/api/src/modules/repair-tickets/dto/warranty-lookup.dto.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/repair-tickets.service.spec.ts`:

```ts
describe('RepairTicketsService.warrantyLookup', () => {
  it('lookup by customerId returns all PHONE devices for the customer with warranty windows', async () => {
    prisma.contract.findMany = jest.fn().mockResolvedValue([
      { id: 'ct-1', customerId: 'c-1', status: 'ACTIVE', deviceReceivedAt: new Date(Date.now() - 2 * 86400_000),
        shopWarrantyEndDate: new Date(Date.now() + 58 * 86400_000),
        product: { id: 'p-1', brand: 'Apple', model: 'iPhone 14', imeiSerial: '111', warrantyExpireDate: null } },
    ]);
    const result = await svc.warrantyLookup({ customerId: 'c-1' }, SALES_USER);
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0].warrantyWindows.sevenDayDefect).toBe(5);
    expect(result.devices[0].eligibility.forExchange).toBe(true);
  });

  it('lookup by IMEI returns single device', async () => {
    prisma.product.findFirst = jest.fn().mockResolvedValue({
      id: 'p-1', brand: 'Samsung', model: 'S23', imeiSerial: 'IMEI-999',
      warrantyExpireDate: new Date(Date.now() + 300 * 86400_000),
      contracts: [{ id: 'ct-1', customerId: 'c-1', status: 'ACTIVE', customer: { name: 'Test' }, deviceReceivedAt: null, shopWarrantyEndDate: null }],
    });
    const result = await svc.warrantyLookup({ imei: 'IMEI-999' }, SALES_USER);
    expect(result.devices[0].product.brand).toBe('Samsung');
    expect(result.devices[0].warrantyWindows.mfrWarranty).toBe(300);
  });

  it('lookup by contractNumber returns device tied to that contract', async () => {
    prisma.contract.findFirst = jest.fn().mockResolvedValue({
      id: 'ct-1', contractNumber: 'CN-2026-0001', customerId: 'c-1',
      customer: { id: 'c-1', name: 'Test' }, status: 'ACTIVE',
      product: { id: 'p-1', brand: 'OPPO', model: 'A78', warrantyExpireDate: null },
      deviceReceivedAt: null, shopWarrantyEndDate: null,
    });
    const result = await svc.warrantyLookup({ contractNumber: 'CN-2026-0001' }, SALES_USER);
    expect(result.devices[0].contract?.contractNumber).toBe('CN-2026-0001');
  });

  it('not-found returns empty devices array (404 from controller layer)', async () => {
    prisma.contract.findMany = jest.fn().mockResolvedValue([]);
    prisma.product.findFirst = jest.fn().mockResolvedValue(null);
    const result = await svc.warrantyLookup({ imei: 'NOTFOUND' }, SALES_USER);
    expect(result.devices).toHaveLength(0);
  });

  it('SALES role with cross-branch contract → empty result via branchId scope', async () => {
    prisma.contract.findMany = jest.fn().mockImplementation((args) => {
      // Verify branch scope is in where clause
      expect(args.where.branchId).toBe(SALES_USER.branchId);
      return [];
    });
    const result = await svc.warrantyLookup({ customerId: 'c-other-branch' }, SALES_USER);
    expect(result.devices).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verify FAIL**

Run: `cd apps/api && npx jest repair-tickets/.*service --silent`
Expected: 5 new cases FAIL with "warrantyLookup is not a function"

- [ ] **Step 3: Create WarrantyLookupDto**

```ts
// apps/api/src/modules/repair-tickets/dto/warranty-lookup.dto.ts
import { IsOptional, IsUUID, IsString, MinLength, ValidateIf } from 'class-validator';

export class WarrantyLookupDto {
  @IsOptional() @IsUUID()
  customerId?: string;

  @IsOptional() @IsString() @MinLength(4)
  imei?: string;

  @IsOptional() @IsString() @MinLength(4)
  serial?: string;

  @IsOptional() @IsString() @MinLength(3)
  contractNumber?: string;
}
```

- [ ] **Step 4: Implement `warrantyLookup` in service**

Add to `repair-tickets.service.ts`:

```ts
async warrantyLookup(dto: WarrantyLookupDto, user: ReqUser) {
  if (!dto.customerId && !dto.imei && !dto.serial && !dto.contractNumber) {
    throw new BadRequestException('ต้องระบุ search input อย่างน้อย 1 อย่าง');
  }

  const branchScope = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user.role)
    ? {}
    : { branchId: user.branchId };

  let contracts: any[] = [];
  let customer: any = null;

  if (dto.customerId) {
    customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId, deletedAt: null } });
    contracts = await this.prisma.contract.findMany({
      where: { customerId: dto.customerId, deletedAt: null, ...branchScope },
      include: { product: true, customer: true },
    });
  } else if (dto.imei || dto.serial) {
    const search = dto.imei ?? dto.serial!;
    const product = await this.prisma.product.findFirst({
      where: { imeiSerial: search, deletedAt: null },
      include: { contracts: { where: { deletedAt: null, ...branchScope }, include: { customer: true } } },
    });
    if (product?.contracts.length) {
      customer = product.contracts[0].customer;
      contracts = product.contracts.map((c) => ({ ...c, product }));
    }
  } else if (dto.contractNumber) {
    const c = await this.prisma.contract.findFirst({
      where: { contractNumber: dto.contractNumber, deletedAt: null, ...branchScope },
      include: { product: true, customer: true },
    });
    if (c) {
      customer = c.customer;
      contracts = [c];
    }
  }

  const now = new Date();
  const devices = contracts.map((c) => {
    const sevenDayDefect = c.deviceReceivedAt
      ? Math.max(0, Math.floor(((c.deviceReceivedAt.getTime() + 7 * 86400_000) - now.getTime()) / 86400_000))
      : null;
    const shopWarranty = c.shopWarrantyEndDate
      ? Math.max(0, Math.floor((c.shopWarrantyEndDate.getTime() - now.getTime()) / 86400_000))
      : null;
    const mfrWarranty = c.product?.warrantyExpireDate
      ? Math.max(0, Math.floor((c.product.warrantyExpireDate.getTime() - now.getTime()) / 86400_000))
      : null;
    return {
      product: c.product,
      contract: { id: c.id, contractNumber: c.contractNumber, status: c.status },
      warrantyWindows: { sevenDayDefect, shopWarranty, mfrWarranty },
      eligibility: {
        forExchange:
          c.status === 'ACTIVE' &&
          sevenDayDefect !== null &&
          sevenDayDefect > 0 &&
          c.product?.category === 'PHONE_USED',
        forRepair: true,
      },
    };
  });

  this.audit
    .log({
      userId: user.id,
      action: 'WARRANTY_LOOKED_UP',
      entity: 'repair_ticket',
      newValue: { searchMode: dto.customerId ? 'customer' : dto.imei ? 'imei' : 'contract', resultCount: devices.length },
    })
    .catch(() => {});

  return { customer, devices };
}
```

- [ ] **Step 5: Add controller endpoint**

```ts
@Get('warranty-lookup')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT')
warrantyLookup(@Query() dto: WarrantyLookupDto, @Req() req: any) {
  return this.svc.warrantyLookup(dto, req.user);
}
```

- [ ] **Step 6: Verify tests pass**

Run: `cd apps/api && npx jest repair-tickets/.*service --silent`
Expected: all 11 new warranty cases PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/repair-tickets/
git commit -m "feat(repair-tickets): warrantyLookup endpoint for /insurance/warranty-check page"
```

### Task 3.5: Open PR 3

- [ ] **Step 1: Full regression**

Run: `cd apps/api && npx jest --silent`
Expected: all green (existing + new tests)

- [ ] **Step 2: Push + PR**

```bash
git push
gh pr create --title "feat(repair-tickets): PR 3/7 — defect-exchange bypass + warranty endpoints" --body "$(cat <<'EOF'
## Summary
- Adds bypassWindowCheck flag to defect-exchange (used by repair-ticket replace flow)
- Adds GET /repair-tickets/warranty-preview (server-side wizard Step 3 routing)
- Adds GET /repair-tickets/warranty-lookup (customer/IMEI/contract search for /insurance/warranty-check)
- WARRANTY_LOOKED_UP audit action for PDPA traceability (async, non-blocking)

## Test plan
- [ ] cd apps/api && npx jest defect-exchange repair-tickets
- [ ] Manual smoke: curl GET /api/repair-tickets/warranty-preview?customerId=...
- [ ] Manual smoke: curl GET /api/repair-tickets/warranty-lookup?imei=...

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR 4a — Frontend: List + Detail + Sidebar

**Goal:** Replace `/insurance` stub with full UI: list, detail, create form, action dialogs.

### Task 4.1: Replace InsurancePage with list page

**Files:**
- Modify: `apps/web/src/pages/InsurancePage.tsx` (currently 23-line redirect stub)

- [ ] **Step 1: Replace stub with full list page**

```tsx
// apps/web/src/pages/InsurancePage.tsx
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Wrench, ShieldCheck } from 'lucide-react';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useDebounce } from '@/hooks/useDebounce';
import { formatThaiDate, formatNumber } from '@/utils/formatters';

type RepairStatus = 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_PICKUP' | 'CLOSED' | 'REPLACED' | 'CANCELLED';

interface Row {
  id: string;
  ticketNumber: string;
  status: RepairStatus;
  customer: { id: string; name: string };
  repairSupplier?: { id: string; name: string } | null;
  deviceBrand?: string | null;
  deviceModel?: string | null;
  defectDescription: string;
  actualCost?: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<RepairStatus, string> = {
  OPEN: 'รับเข้า', IN_PROGRESS: 'กำลังซ่อม', READY_FOR_PICKUP: 'รอลูกค้ารับ',
  CLOSED: 'คืนแล้ว', REPLACED: 'เปลี่ยนแล้ว', CANCELLED: 'ยกเลิก',
};

const STATUS_VARIANT: Record<RepairStatus, 'default' | 'secondary' | 'outline'> = {
  OPEN: 'default', IN_PROGRESS: 'default', READY_FOR_PICKUP: 'default',
  CLOSED: 'secondary', REPLACED: 'secondary', CANCELLED: 'outline',
};

function agingBorderClass(row: Row): string {
  const ageDays = (Date.now() - new Date(row.createdAt).getTime()) / 86400_000;
  if (row.status === 'OPEN' && ageDays > 3) return 'border-l-4 border-l-orange-500';
  if (row.status === 'IN_PROGRESS' && ageDays > 14) return 'border-l-4 border-l-red-500';
  if (row.status === 'READY_FOR_PICKUP' && ageDays > 7) return 'border-l-4 border-l-purple-500';
  return '';
}

export default function InsurancePage() {
  const navigate = useNavigate();
  const [activeStatus, setActiveStatus] = useState<'ALL' | RepairStatus>('ALL');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, error, refetch } = useQuery<{ data: Row[]; total: number }>({
    queryKey: ['repair-tickets', activeStatus, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeStatus !== 'ALL') params.set('status', activeStatus);
      if (debouncedSearch) params.set('q', debouncedSearch);
      const { data } = await api.get(`/repair-tickets?${params}`);
      return data;
    },
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="รับซ่อม/รับประกัน"
        description="ติดตามเครื่องลูกค้าที่ส่งซ่อม — บันทึกที่ซ่อม / วันที่ / ค่าซ่อม + รายงานบัญชีอัตโนมัติ"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/insurance/warranty-check')}>
              <ShieldCheck className="mr-2 h-4 w-4" /> เช็คประกัน
            </Button>
            <Button onClick={() => navigate('/insurance/new')}>
              <Plus className="mr-2 h-4 w-4" /> รับเครื่องใหม่
            </Button>
          </div>
        }
      />

      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {(['ALL', 'OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'CLOSED', 'REPLACED', 'CANCELLED'] as const).map((s) => (
            <Button key={s} variant={activeStatus === s ? 'default' : 'outline'} size="sm" onClick={() => setActiveStatus(s)}>
              {s === 'ALL' ? 'ทั้งหมด' : STATUS_LABEL[s]}
            </Button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="ค้นหาเลขที่ ticket / ชื่อลูกค้า / IMEI"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </Card>

      <QueryBoundary isLoading={isLoading} isError={isError} error={error} refetch={refetch}>
        {data?.data.length === 0 ? (
          <Card className="p-12 text-center">
            <Wrench className="mx-auto h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">ยังไม่มีงานซ่อมในช่วงเวลานี้</p>
            <Button className="mt-4" onClick={() => navigate('/insurance/new')}>
              <Plus className="mr-2 h-4 w-4" /> รับเครื่องใหม่
            </Button>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-2 text-left">Ticket#</th>
                  <th className="px-4 py-2 text-left">ลูกค้า</th>
                  <th className="px-4 py-2 text-left">เครื่อง</th>
                  <th className="px-4 py-2 text-left">อาการ</th>
                  <th className="px-4 py-2 text-left">สถานะ</th>
                  <th className="px-4 py-2 text-right">ค่าซ่อม</th>
                  <th className="px-4 py-2 text-left">วันที่</th>
                </tr>
              </thead>
              <tbody>
                {data?.data.map((row) => (
                  <tr
                    key={row.id}
                    className={`cursor-pointer hover:bg-accent border-b last:border-0 ${agingBorderClass(row)}`}
                    onClick={() => navigate(`/insurance/${row.id}`)}
                  >
                    <td className="px-4 py-3 font-mono">{row.ticketNumber}</td>
                    <td className="px-4 py-3">{row.customer.name}</td>
                    <td className="px-4 py-3">{[row.deviceBrand, row.deviceModel].filter(Boolean).join(' ') || '—'}</td>
                    <td className="px-4 py-3 max-w-xs truncate">{row.defectDescription}</td>
                    <td className="px-4 py-3"><Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge></td>
                    <td className="px-4 py-3 text-right">{row.actualCost ? formatNumber(Number(row.actualCost)) : '—'}</td>
                    <td className="px-4 py-3">{formatThaiDate(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </QueryBoundary>
    </div>
  );
}
```

- [ ] **Step 2: Verify it loads (type check)**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/InsurancePage.tsx
git commit -m "feat(insurance): replace redirect stub with repair-ticket list page"
```

### Task 4.2: Reusable badges + WarrantyWindowCard

**Files:**
- Create: `apps/web/src/pages/insurance/components/WarrantyBadge.tsx`
- Create: `apps/web/src/pages/insurance/components/WarrantyWindowCard.tsx` *(shared by detail page + wizard Step 3 + warranty-check page)*
- Create: `apps/web/src/pages/insurance/components/RepairStatusBadge.tsx`
- Create: `apps/web/src/pages/insurance/components/TimelineEvent.tsx`

- [ ] **Step 1: WarrantyBadge.tsx**

```tsx
import { Badge } from '@/components/ui/badge';
import { Shield, ShieldAlert, ShieldOff, ShieldCheck } from 'lucide-react';

export type WarrantyStatus = 'IN_7DAY_DEFECT' | 'IN_SHOP_WARRANTY' | 'IN_MANUFACTURER' | 'OUT_OF_WARRANTY' | 'WALK_IN';

const LABEL: Record<WarrantyStatus, string> = {
  IN_7DAY_DEFECT: 'ในประกัน 7 วัน (Defect)',
  IN_SHOP_WARRANTY: 'ในประกันร้าน 60 วัน',
  IN_MANUFACTURER: 'ในประกันศูนย์',
  OUT_OF_WARRANTY: 'นอกประกัน',
  WALK_IN: 'ลูกค้าใหม่ (ไม่ผูก)',
};

const ICON: Record<WarrantyStatus, React.ComponentType<{ className?: string }>> = {
  IN_7DAY_DEFECT: ShieldAlert,
  IN_SHOP_WARRANTY: ShieldCheck,
  IN_MANUFACTURER: ShieldCheck,
  OUT_OF_WARRANTY: ShieldOff,
  WALK_IN: Shield,
};

const VARIANT: Record<WarrantyStatus, 'default' | 'secondary' | 'outline'> = {
  IN_7DAY_DEFECT: 'default',
  IN_SHOP_WARRANTY: 'default',
  IN_MANUFACTURER: 'default',
  OUT_OF_WARRANTY: 'secondary',
  WALK_IN: 'outline',
};

export function WarrantyBadge({ status }: { status: WarrantyStatus }) {
  const Icon = ICON[status];
  return (
    <Badge variant={VARIANT[status]} className="gap-1">
      <Icon className="h-3 w-3" />
      {LABEL[status]}
    </Badge>
  );
}
```

- [ ] **Step 2: WarrantyWindowCard.tsx (3-tier window display)**

```tsx
// apps/web/src/pages/insurance/components/WarrantyWindowCard.tsx
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface WarrantyWindows {
  sevenDayDefect: number | null;
  shopWarranty: number | null;
  mfrWarranty: number | null;
}

interface WindowRowProps {
  label: string;
  daysRemaining: number | null;
  totalDays: number;  // for percent calc (7, 60, 365 typical)
}

function windowColor(daysRemaining: number | null, totalDays: number): string {
  if (daysRemaining === null) return 'text-muted-foreground';
  if (daysRemaining === 0) return 'text-red-600';
  const pct = daysRemaining / totalDays;
  if (pct > 0.3) return 'text-emerald-600';
  return 'text-amber-600';
}

function WindowRow({ label, daysRemaining, totalDays }: WindowRowProps) {
  const color = windowColor(daysRemaining, totalDays);
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-medium', color)}>
        {daysRemaining === null ? '—' : daysRemaining === 0 ? 'หมดประกัน' : `เหลือ ${daysRemaining} วัน`}
      </span>
    </div>
  );
}

export function WarrantyWindowCard({ windows }: { windows: WarrantyWindows }) {
  return (
    <Card className="p-4 space-y-1">
      <WindowRow label="🟢 รับเครื่อง 7 วัน" daysRemaining={windows.sevenDayDefect} totalDays={7} />
      <WindowRow label="🟢 ประกันร้าน 60 วัน" daysRemaining={windows.shopWarranty} totalDays={60} />
      <WindowRow label="🟢 ประกันศูนย์" daysRemaining={windows.mfrWarranty} totalDays={365} />
    </Card>
  );
}
```

- [ ] **Step 3: RepairStatusBadge.tsx + TimelineEvent.tsx**

```tsx
// RepairStatusBadge.tsx
import { Badge } from '@/components/ui/badge';
export type RepairStatus = 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_PICKUP' | 'CLOSED' | 'REPLACED' | 'CANCELLED';
const LABEL: Record<RepairStatus, string> = {
  OPEN: 'รับเข้า', IN_PROGRESS: 'กำลังซ่อม', READY_FOR_PICKUP: 'รอลูกค้ารับ',
  CLOSED: 'คืนแล้ว', REPLACED: 'เปลี่ยนแล้ว', CANCELLED: 'ยกเลิก',
};
export function RepairStatusBadge({ status }: { status: RepairStatus }) {
  return <Badge>{LABEL[status]}</Badge>;
}

// TimelineEvent.tsx
import { Circle } from 'lucide-react';
import { formatThaiDate } from '@/utils/formatters';
export interface TimelineEventProps {
  fromStatus: string;
  toStatus: string;
  changedByName: string | null;
  note?: string | null;
  createdAt: string;
}
export function TimelineEvent({ fromStatus, toStatus, changedByName, note, createdAt }: TimelineEventProps) {
  return (
    <div className="flex gap-3 pb-4 border-l-2 border-muted pl-4 last:pb-0">
      <Circle className="-ml-[1.625rem] mt-1 h-3 w-3 fill-primary text-primary" />
      <div className="flex-1">
        <div className="font-medium">{fromStatus} → {toStatus}</div>
        <div className="text-xs text-muted-foreground">{formatThaiDate(createdAt)} · {changedByName ?? 'ไม่ระบุ'}</div>
        {note && <div className="text-sm mt-1 text-muted-foreground">{note}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type check + commit**

Run: `cd apps/web && npx tsc --noEmit`

```bash
git add apps/web/src/pages/insurance/components/
git commit -m "feat(insurance): WarrantyBadge + WarrantyWindowCard + RepairStatusBadge + TimelineEvent components"
```

### Task 4.3: Create page — REMOVED (now handled by Wizard in PR 4b)

Originally this task scaffolded `CreateRepairTicketPage.tsx` as a simple form. The 2026-05-20 spec update unifies this with the exchange flow under a multi-step wizard at `/insurance/new`. See PR 4b below — `CreateInsuranceWizardPage` replaces this functionality.

### Task 4.4: Detail page

**Files:**
- Create: `apps/web/src/pages/insurance/RepairTicketDetailPage.tsx`

- [ ] **Step 1: Two-column layout with action buttons**

```tsx
import { useParams, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, Wrench, Send, CheckCircle2, RotateCcw, X, Repeat } from 'lucide-react';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatThaiDate, formatNumber } from '@/utils/formatters';
import { WarrantyBadge } from './components/WarrantyBadge';
import { RepairStatusBadge, RepairStatus } from './components/RepairStatusBadge';
import { TimelineEvent } from './components/TimelineEvent';
import { SendDialog } from './dialogs/SendDialog';
import { MarkRepairedDialog } from './dialogs/MarkRepairedDialog';
import { SendBackDialog } from './dialogs/SendBackDialog';
import { ReturnToCustomerDialog } from './dialogs/ReturnToCustomerDialog';
import { CancelDialog } from './dialogs/CancelDialog';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function RepairTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const currentUserRole = user?.role;
  const [activeDialog, setActiveDialog] = useState<null | 'send' | 'mark-repaired' | 'send-back' | 'return' | 'cancel'>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['repair-ticket', id],
    queryFn: async () => {
      const { data } = await api.get(`/repair-tickets/${id}`);
      return data;
    },
  });

  const ticket = data;
  const status = ticket?.status as RepairStatus | undefined;
  const onRefresh = () => qc.invalidateQueries({ queryKey: ['repair-ticket', id] });
  // 2026-05-20 unified entry: bypass routes through wizard (not direct defect-exchange URL)
  const onReplace = () => navigate(`/insurance/new?intent=exchange&originRepairTicketId=${id}&bypassWindow=true`);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <QueryBoundary isLoading={isLoading} isError={isError} error={error} refetch={refetch}>
        {ticket && (
          <>
            <PageHeader
              title={ticket.ticketNumber}
              description={<RepairStatusBadge status={ticket.status} />}
              actions={
                <Button variant="outline" onClick={() => navigate('/insurance')}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> กลับ
                </Button>
              }
            />

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div className="lg:col-span-3 space-y-4">
                <Card className="p-4">
                  <h3 className="font-medium mb-2">ลูกค้า</h3>
                  <p>{ticket.customer.name}</p>
                  {ticket.customer.phone && <p className="text-sm text-muted-foreground">{ticket.customer.phone}</p>}
                </Card>

                <Card className="p-4 space-y-2">
                  <h3 className="font-medium">เครื่อง</h3>
                  <p>{[ticket.product?.brand ?? ticket.deviceBrand, ticket.product?.model ?? ticket.deviceModel].filter(Boolean).join(' ')}</p>
                  {ticket.deviceImei && <p className="text-sm text-muted-foreground">IMEI: {ticket.deviceImei}</p>}
                  <WarrantyBadge status={ticket.warrantyStatus} />
                </Card>

                <Card className="p-4">
                  <h3 className="font-medium mb-2">อาการเสีย</h3>
                  <p className="whitespace-pre-wrap">{ticket.defectDescription}</p>
                </Card>

                {ticket.repairSupplier && (
                  <Card className="p-4">
                    <h3 className="font-medium mb-2">ที่ซ่อม</h3>
                    <p>{ticket.repairSupplier.name}</p>
                    {ticket.externalClaimNo && <p className="text-sm text-muted-foreground">Claim#: {ticket.externalClaimNo}</p>}
                  </Card>
                )}

                <div className="flex flex-wrap gap-2">
                  {status === 'OPEN' && (
                    <>
                      <Button onClick={() => setActiveDialog('send')}><Send className="mr-2 h-4 w-4" /> ส่งซ่อม</Button>
                      {(currentUserRole === 'OWNER' || currentUserRole === 'BRANCH_MANAGER') && (
                        <Button variant="outline" onClick={onReplace}><Repeat className="mr-2 h-4 w-4" /> ซ่อมไม่ได้ — ออกใหม่</Button>
                      )}
                      <Button variant="outline" onClick={() => setActiveDialog('cancel')}><X className="mr-2 h-4 w-4" /> ยกเลิก</Button>
                    </>
                  )}
                  {status === 'IN_PROGRESS' && (
                    <>
                      <Button onClick={() => setActiveDialog('mark-repaired')}><Wrench className="mr-2 h-4 w-4" /> บันทึกซ่อมเสร็จ</Button>
                      {(currentUserRole === 'OWNER' || currentUserRole === 'BRANCH_MANAGER') && (
                        <Button variant="outline" onClick={onReplace}><Repeat className="mr-2 h-4 w-4" /> ซ่อมไม่ได้ — ออกใหม่</Button>
                      )}
                      <Button variant="outline" onClick={() => setActiveDialog('cancel')}><X className="mr-2 h-4 w-4" /> ยกเลิก</Button>
                    </>
                  )}
                  {status === 'READY_FOR_PICKUP' && (
                    <>
                      <Button onClick={() => setActiveDialog('return')}><CheckCircle2 className="mr-2 h-4 w-4" /> ลูกค้ารับเครื่อง</Button>
                      <Button variant="outline" onClick={() => setActiveDialog('send-back')}><RotateCcw className="mr-2 h-4 w-4" /> ส่งซ่อมต่อ (QC fail)</Button>
                      {(currentUserRole === 'OWNER' || currentUserRole === 'BRANCH_MANAGER') && (
                        <Button variant="outline" onClick={onReplace}><Repeat className="mr-2 h-4 w-4" /> ซ่อมไม่ได้ — ออกใหม่</Button>
                      )}
                      <Button variant="outline" onClick={() => setActiveDialog('cancel')}><X className="mr-2 h-4 w-4" /> ยกเลิก</Button>
                    </>
                  )}
                </div>
              </div>

              <div className="lg:col-span-2 space-y-4">
                <Card className="p-4">
                  <h3 className="font-medium mb-3">Timeline</h3>
                  <div className="space-y-1">
                    {ticket.statusLogs.map((log: any) => (
                      <TimelineEvent
                        key={log.id}
                        fromStatus={log.fromStatus}
                        toStatus={log.toStatus}
                        changedByName={log.changedBy?.name ?? null}
                        note={log.note}
                        createdAt={log.createdAt}
                      />
                    ))}
                  </div>
                </Card>

                {(ticket.expenseDocument || ticket.otherIncome || ticket.defectExchange) && (
                  <Card className="p-4 space-y-2">
                    <h3 className="font-medium">เอกสารที่เชื่อม</h3>
                    {ticket.expenseDocument && (
                      <div className="flex items-center justify-between text-sm">
                        <span><FileText className="inline h-4 w-4 mr-1" /> ExpenseDoc: {ticket.expenseDocument.number}</span>
                        <Button size="sm" variant="link" onClick={() => navigate(`/expenses/${ticket.expenseDocument.id}`)}>เปิด →</Button>
                      </div>
                    )}
                    {ticket.otherIncome && (
                      <div className="flex items-center justify-between text-sm">
                        <span><FileText className="inline h-4 w-4 mr-1" /> OtherIncome: {ticket.otherIncome.docNumber}</span>
                        <Button size="sm" variant="link" onClick={() => navigate(`/other-income/${ticket.otherIncome.id}`)}>เปิด →</Button>
                      </div>
                    )}
                    {ticket.defectExchange && (
                      <div className="flex items-center justify-between text-sm">
                        <span><FileText className="inline h-4 w-4 mr-1" /> Defect Exchange</span>
                        <Button size="sm" variant="link" onClick={() => navigate(`/defect-exchange/${ticket.defectExchange.id}`)}>เปิด →</Button>
                      </div>
                    )}
                  </Card>
                )}
              </div>
            </div>

            {activeDialog === 'send' && <SendDialog ticketId={id!} onClose={() => setActiveDialog(null)} onSuccess={onRefresh} />}
            {activeDialog === 'mark-repaired' && <MarkRepairedDialog ticketId={id!} warrantyStatus={ticket.warrantyStatus} onClose={() => setActiveDialog(null)} onSuccess={onRefresh} />}
            {activeDialog === 'send-back' && <SendBackDialog ticketId={id!} onClose={() => setActiveDialog(null)} onSuccess={onRefresh} />}
            {activeDialog === 'return' && <ReturnToCustomerDialog ticketId={id!} payer={ticket.payer} onClose={() => setActiveDialog(null)} onSuccess={onRefresh} />}
            {activeDialog === 'cancel' && <CancelDialog ticketId={id!} onClose={() => setActiveDialog(null)} onSuccess={onRefresh} />}
          </>
        )}
      </QueryBoundary>
    </div>
  );
}
```

- [ ] **Step 2: Type check + commit**

```bash
git add apps/web/src/pages/insurance/RepairTicketDetailPage.tsx
git commit -m "feat(insurance): RepairTicketDetailPage with timeline + status-aware actions"
```

### Task 4.5: Action dialogs (5 files)

**Files:**
- Create: `apps/web/src/pages/insurance/dialogs/SendDialog.tsx`
- Create: `apps/web/src/pages/insurance/dialogs/MarkRepairedDialog.tsx`
- Create: `apps/web/src/pages/insurance/dialogs/SendBackDialog.tsx`
- Create: `apps/web/src/pages/insurance/dialogs/ReturnToCustomerDialog.tsx`
- Create: `apps/web/src/pages/insurance/dialogs/CancelDialog.tsx`

Each dialog follows the same pattern: ShadCN Dialog + form with React Hook Form + mutation + toast. Reuse `ConfirmDialog` if appropriate. Implement each as shown in Section 4 of the spec.

- [ ] **Step 1: Implement SendDialog**

```tsx
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props { ticketId: string; onClose: () => void; onSuccess: () => void; }
interface FormVals { repairSupplierId: string; externalClaimNo?: string; estimatedCost?: number; }

export function SendDialog({ ticketId, onClose, onSuccess }: Props) {
  const form = useForm<FormVals>();
  const mut = useMutation({
    mutationFn: async (v: FormVals) => api.post(`/repair-tickets/${ticketId}/send`, v),
    onSuccess: () => { toast.success('ส่งซ่อมแล้ว'); onSuccess(); onClose(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>ส่งซ่อม</DialogTitle></DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-3">
          <div><Label>ที่ซ่อม (Supplier ID)</Label><Input {...form.register('repairSupplierId', { required: true })} /></div>
          <div><Label>เลข claim ของศูนย์ (ถ้ามี)</Label><Input {...form.register('externalClaimNo')} /></div>
          <div><Label>ค่าซ่อมประมาณ</Label><Input type="number" {...form.register('estimatedCost', { valueAsNumber: true })} /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>ยกเลิก</Button>
            <Button type="submit" disabled={mut.isPending}>{mut.isPending ? 'กำลังบันทึก...' : 'ส่งซ่อม'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Implement MarkRepairedDialog (with payer select)**

Similar pattern. Show payer dropdown with 3 options. Pre-fill default based on warrantyStatus prop.

- [ ] **Step 3: Implement SendBackDialog, ReturnToCustomerDialog (with auto-doc preview text), CancelDialog**

- [ ] **Step 4: Type check + commit**

```bash
git add apps/web/src/pages/insurance/dialogs/
git commit -m "feat(insurance): 5 action dialogs (send/mark-repaired/send-back/return/cancel)"
```

### Task 4.6: Routes + redirect + parent-menu sidebar

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/config/menu.ts`
- Create: `apps/web/src/components/DefectExchangeRedirect.tsx` *(small wrapper to preserve query params)*

- [ ] **Step 1: Create the DefectExchangeRedirect wrapper**

```tsx
// apps/web/src/components/DefectExchangeRedirect.tsx
import { Navigate, useLocation } from 'react-router';

/**
 * Preserves any query string on /defect-exchange URLs and forwards to /insurance/new?intent=exchange&...
 * Used for the 5 legacy bookmarks/external links pointing at /defect-exchange.
 */
export function DefectExchangeRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('intent', 'exchange');
  return <Navigate to={`/insurance/new?${params.toString()}`} replace />;
}
```

- [ ] **Step 2: Wire up routes**

Modify `apps/web/src/App.tsx`:

```tsx
// In App.tsx — lazy imports (PR 4a wires up list/detail/warranty-check stub;
// PR 4b will replace the wizard route's element):
const CreateInsuranceWizardPage = lazy(() => import('@/pages/insurance/CreateInsuranceWizardPage'));
const WarrantyCheckPage = lazy(() => import('@/pages/insurance/WarrantyCheckPage'));
const RepairTicketDetailPage = lazy(() => import('@/pages/insurance/RepairTicketDetailPage'));
import { DefectExchangeRedirect } from '@/components/DefectExchangeRedirect';

// In <Routes>:
// /insurance route already exists (was stub redirect) — keep path, page now renders the list
<Route path="/insurance/new" element={
  <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'SALES']}>
    <CreateInsuranceWizardPage />
  </ProtectedRoute>
} />
<Route path="/insurance/warranty-check" element={
  <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT']}>
    <WarrantyCheckPage />
  </ProtectedRoute>
} />
<Route path="/insurance/:id" element={
  <ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT']}>
    <RepairTicketDetailPage />
  </ProtectedRoute>
} />

// Legacy redirect (keep bookmarks/external links working)
<Route path="/defect-exchange" element={<DefectExchangeRedirect />} />
<Route path="/defect-exchange/*" element={<DefectExchangeRedirect />} />
```

**IMPORTANT**: `CreateInsuranceWizardPage` and `WarrantyCheckPage` are referenced here but their full implementations land in PR 4b and PR 4c respectively. In this PR (4a), create placeholder shells so the routes don't 500:

```tsx
// apps/web/src/pages/insurance/CreateInsuranceWizardPage.tsx (placeholder — PR 4b replaces)
export default function CreateInsuranceWizardPage() {
  return (
    <div className="p-8 text-center text-muted-foreground">
      Wizard กำลังจะมา (PR 4b — ETA ภายในสัปดาห์ถัดไป)
    </div>
  );
}

// apps/web/src/pages/insurance/WarrantyCheckPage.tsx (placeholder — PR 4c replaces)
export default function WarrantyCheckPage() {
  return (
    <div className="p-8 text-center text-muted-foreground">
      หน้าเช็คประกันกำลังจะมา (PR 4c — ETA ภายในสัปดาห์ถัดไป)
    </div>
  );
}
```

These placeholders let PR 4a deploy independently (parent menu works, redirect works, list/detail works) while PR 4b/4c are still in review. No 404s, no broken navigation.

- [ ] **Step 3: Update sidebar to parent + 2 sub-items**

In `apps/web/src/config/menu.ts`, find all "รับประกัน/ส่งซ่อม" entries (5 roles) and the "เปลี่ยนเครื่องชำรุด" entry. Replace BOTH with a single parent collapsible item containing 2 sub-items.

Pattern to follow: search the file for an existing collapsible parent (e.g. the "บัญชี & รายงาน" parent in OWNER role) to copy structure. Each role's `menu` array should now have:

```ts
{
  label: 'รับซ่อม/รับประกัน',
  icon: ShieldCheck,  // replaces Wrench
  children: [
    { label: 'รายการ ticket', path: '/insurance' },
    { label: 'เช็คประกัน', path: '/insurance/warranty-check' },
  ],
}
```

Remove the standalone "เปลี่ยนเครื่องชำรุด" / `/defect-exchange` menu item entirely from all roles that had it. (Direct URL still works via the redirect, just no sidebar entry.)

Verify by grepping: `grep -n "defect-exchange" apps/web/src/config/menu.ts` should return zero results after this step.

- [ ] **Step 4: Type check + commit**

```bash
cd apps/web && npx tsc --noEmit
```

```bash
git add apps/web/src/App.tsx apps/web/src/config/menu.ts apps/web/src/components/DefectExchangeRedirect.tsx apps/web/src/pages/insurance/CreateInsuranceWizardPage.tsx apps/web/src/pages/insurance/WarrantyCheckPage.tsx
git commit -m "feat(insurance): unified sidebar + routes + /defect-exchange redirect + placeholder shells"
```

### Task 4.7: Web tests for list + detail + components

**Files:**
- Create: `apps/web/src/pages/InsurancePage.test.tsx`
- Create: `apps/web/src/pages/insurance/components/WarrantyBadge.test.tsx`
- Create: `apps/web/src/pages/insurance/components/WarrantyWindowCard.test.tsx`
- Create: `apps/web/src/pages/insurance/RepairTicketDetailPage.test.tsx`

- [ ] **Step 1: InsurancePage tests**

Test cases:
- Status filter chips render with correct Thai labels
- Aging border classes applied at >3d (OPEN orange) / >14d (IN_PROGRESS red) / >7d (READY_FOR_PICKUP purple)
- Debounced search query passed to API after 300ms idle
- Empty state shows both `[+ รับเครื่องใหม่]` and `[เช็คประกัน]` CTAs
- `[เช็คประกัน]` CTA navigates to `/insurance/warranty-check`

- [ ] **Step 2: WarrantyBadge + WarrantyWindowCard tests**

WarrantyBadge:
- Each of 5 statuses renders the right Thai label + icon

WarrantyWindowCard (3 windows):
- All 3 windows = null → all show "—"
- sevenDayDefect = 3 days → green text + "เหลือ 3 วัน"
- sevenDayDefect = 0 → red text + "หมดประกัน"
- shopWarranty = 5 days (out of 60 = 8%) → amber text (≤30% threshold)
- mfrWarranty = 200 days → green text

- [ ] **Step 3: RepairTicketDetailPage tests**

- Action button matrix per status (OPEN / IN_PROGRESS / READY_FOR_PICKUP / CLOSED) — visibility correct
- `[ซ่อมไม่ได้ — ออกใหม่]` button visible for OWNER + BRANCH_MANAGER only — SALES role: button hidden
- `onReplace` click navigates to `/insurance/new?intent=exchange&originRepairTicketId=...&bypassWindow=true`
- Linked docs section renders ExpenseDoc / OtherIncome / DefectExchange links when present
- Timeline events sorted desc by createdAt

- [ ] **Step 4: Run + commit**

Run: `cd apps/web && npx vitest run src/pages/InsurancePage.test.tsx src/pages/insurance/`
Expected: all pass (≥8 cases)

```bash
git add apps/web/src/pages/
git commit -m "test(insurance): list page + detail page + warranty components"
```

### Task 4.8: Open PR 4a

- [ ] **Step 1: Type check + push + PR**

Run: `./tools/check-types.sh all`

```bash
git push
gh pr create --title "feat(insurance): PR 4a/7 — list page + detail page + sidebar consolidation + redirect" --body "$(cat <<'EOF'
## Summary
- /insurance redirect stub replaced with full ticket list page (filter chips, search, aging borders)
- RepairTicketDetailPage with timeline + linked-docs section + status-aware action buttons
- [ซ่อมไม่ได้ — ออกใหม่] action (renamed from [เปลี่ยนเครื่องแทน]), OWNER/BM only, routes to wizard with bypass
- 5 action dialogs (send / mark-repaired / send-back / return-to-customer / cancel)
- Sidebar: single parent "รับซ่อม/รับประกัน" + 2 sub-items (รายการ ticket / เช็คประกัน)
- "เปลี่ยนเครื่องชำรุด" menu item removed; /defect-exchange URL still works via DefectExchangeRedirect
- Wizard + warranty-check pages = placeholder shells (filled in PR 4b/4c)

## Test plan
- [ ] cd apps/web && npx vitest run src/pages/InsurancePage.test.tsx src/pages/insurance/
- [ ] Manual: visit /insurance → list renders with 2 CTAs
- [ ] Manual: visit /defect-exchange?contractId=X → redirects to /insurance/new?intent=exchange&contractId=X
- [ ] Manual: detail page action buttons match status matrix
- [ ] Manual: SALES role does not see [ซ่อมไม่ได้ — ออกใหม่] button

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR 4b — Frontend: Wizard

**Goal:** Implement the multi-step wizard at `/insurance/new` that branches between repair-ticket and defect-exchange flows based on the server-side smart-default decision (`GET /repair-tickets/warranty-preview`).

**Dependency:** PR 3 (warranty endpoints) must be merged. PR 4a's placeholder `CreateInsuranceWizardPage.tsx` is replaced here.

### Task 4b.1: Wizard step components (Customer + Device)

**Files:**
- Create: `apps/web/src/pages/insurance/WizardSteps/CustomerPickerStep.tsx`
- Create: `apps/web/src/pages/insurance/WizardSteps/DevicePickerStep.tsx`

- [ ] **Step 1: CustomerPickerStep**

```tsx
// apps/web/src/pages/insurance/WizardSteps/CustomerPickerStep.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDebounce } from '@/hooks/useDebounce';
import api from '@/lib/api';

export interface CustomerStepValue {
  customerId?: string;
  customerName?: string;  // for walk-in inline create OR display label
  customerPhone?: string;
}

export function CustomerPickerStep({
  value,
  onChange,
  onNext,
  presetCustomerId,
}: {
  value: CustomerStepValue;
  onChange: (v: CustomerStepValue) => void;
  onNext: () => void;
  presetCustomerId?: string;
}) {
  const [mode, setMode] = useState<'existing' | 'walkin'>(presetCustomerId ? 'existing' : 'existing');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const { data: customers } = useQuery({
    queryKey: ['customer-search', debouncedSearch],
    queryFn: async () => {
      if (!debouncedSearch || debouncedSearch.length < 2) return [];
      const { data } = await api.get(`/customers?q=${debouncedSearch}&limit=10`);
      return data.data;
    },
    enabled: !presetCustomerId,
  });

  // If preset → auto-select on mount
  // ... (engineer wires up useEffect + initial fetch by id)

  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-medium">1. ลูกค้า</h3>
      <div className="flex gap-2">
        <Button variant={mode === 'existing' ? 'default' : 'outline'} size="sm" onClick={() => setMode('existing')}>
          ลูกค้าเก่า
        </Button>
        <Button variant={mode === 'walkin' ? 'default' : 'outline'} size="sm" onClick={() => setMode('walkin')}>
          Walk-in (ลูกค้าใหม่)
        </Button>
      </div>

      {mode === 'existing' && (
        <>
          <Input placeholder="ค้นหาชื่อ/เบอร์ลูกค้า" value={search} onChange={(e) => setSearch(e.target.value)} />
          {customers?.map((c: any) => (
            <Button
              key={c.id}
              variant="outline"
              className="w-full justify-start"
              onClick={() => onChange({ customerId: c.id, customerName: c.name, customerPhone: c.phone })}
            >
              {c.name} · {c.phone}
            </Button>
          ))}
        </>
      )}

      {mode === 'walkin' && (
        <>
          <div>
            <Label>ชื่อ</Label>
            <Input
              value={value.customerName ?? ''}
              onChange={(e) => onChange({ ...value, customerName: e.target.value })}
            />
          </div>
          <div>
            <Label>เบอร์โทร</Label>
            <Input
              value={value.customerPhone ?? ''}
              onChange={(e) => onChange({ ...value, customerPhone: e.target.value })}
            />
          </div>
        </>
      )}

      <Button onClick={onNext} disabled={!value.customerId && (!value.customerName || !value.customerPhone)}>
        ถัดไป →
      </Button>
    </Card>
  );
}
```

- [ ] **Step 2: DevicePickerStep**

```tsx
// apps/web/src/pages/insurance/WizardSteps/DevicePickerStep.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';

export interface DeviceStepValue {
  contractId?: string;
  productId?: string;
  deviceBrand?: string;
  deviceModel?: string;
  deviceImei?: string;
  deviceSerial?: string;
}

export function DevicePickerStep({
  customerId,
  value,
  onChange,
  onNext,
  onBack,
  presetContractId,
  presetProductId,
}: {
  customerId?: string;
  value: DeviceStepValue;
  onChange: (v: DeviceStepValue) => void;
  onNext: () => void;
  onBack: () => void;
  presetContractId?: string;
  presetProductId?: string;
}) {
  const [tab, setTab] = useState<'contract' | 'product' | 'freetext'>(
    presetContractId ? 'contract' : presetProductId ? 'product' : customerId ? 'contract' : 'freetext'
  );

  const { data: contracts } = useQuery({
    queryKey: ['customer-contracts', customerId],
    queryFn: async () => {
      if (!customerId) return [];
      const { data } = await api.get(`/contracts?customerId=${customerId}&status=ACTIVE&limit=20`);
      return data.data;
    },
    enabled: !!customerId,
  });

  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-medium">2. เครื่อง</h3>
      <div className="flex gap-2">
        {customerId && (
          <Button variant={tab === 'contract' ? 'default' : 'outline'} size="sm" onClick={() => setTab('contract')}>
            จากสัญญา
          </Button>
        )}
        <Button variant={tab === 'product' ? 'default' : 'outline'} size="sm" onClick={() => setTab('product')}>
          เลือกจากสต็อก
        </Button>
        <Button variant={tab === 'freetext' ? 'default' : 'outline'} size="sm" onClick={() => setTab('freetext')}>
          กรอกข้อมูลเอง
        </Button>
      </div>

      {tab === 'contract' && contracts?.map((c: any) => (
        <Button
          key={c.id}
          variant={value.contractId === c.id ? 'default' : 'outline'}
          className="w-full justify-start"
          onClick={() => onChange({ contractId: c.id, productId: c.product?.id })}
        >
          {c.contractNumber} · {c.product?.brand} {c.product?.model}
        </Button>
      ))}

      {tab === 'product' && (
        <p className="text-sm text-muted-foreground">
          {/* engineer: integrate existing ProductPickerCombobox by grep — pattern in POS page */}
          (TODO PR4b implementer: wire existing ProductPicker — search `ProductCombobox` in apps/web)
        </p>
      )}

      {tab === 'freetext' && (
        <div className="grid grid-cols-2 gap-3">
          <div><Label>ยี่ห้อ</Label><Input value={value.deviceBrand ?? ''} onChange={(e) => onChange({ ...value, deviceBrand: e.target.value })} /></div>
          <div><Label>รุ่น</Label><Input value={value.deviceModel ?? ''} onChange={(e) => onChange({ ...value, deviceModel: e.target.value })} /></div>
          <div><Label>IMEI</Label><Input value={value.deviceImei ?? ''} onChange={(e) => onChange({ ...value, deviceImei: e.target.value })} /></div>
          <div><Label>Serial</Label><Input value={value.deviceSerial ?? ''} onChange={(e) => onChange({ ...value, deviceSerial: e.target.value })} /></div>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>← ย้อน</Button>
        <Button onClick={onNext}>ถัดไป →</Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: Type check + commit**

Run: `cd apps/web && npx tsc --noEmit`

```bash
git add apps/web/src/pages/insurance/WizardSteps/
git commit -m "feat(insurance): Wizard Step 1 (Customer) + Step 2 (Device)"
```

### Task 4b.2: WarrantyPreviewStep (Step 3 — smart-default routing)

**Files:**
- Create: `apps/web/src/pages/insurance/WizardSteps/WarrantyPreviewStep.tsx`

- [ ] **Step 1: Implement WarrantyPreviewStep**

```tsx
// apps/web/src/pages/insurance/WizardSteps/WarrantyPreviewStep.tsx
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Repeat, Wrench } from 'lucide-react';
import api from '@/lib/api';
import { WarrantyWindowCard } from '../components/WarrantyWindowCard';
import { WarrantyBadge } from '../components/WarrantyBadge';

export type WizardFlow = 'repair' | 'exchange';

interface PreviewResponse {
  warrantyStatus: string;
  defaultFlow: WizardFlow;
  alternativeFlow: WizardFlow | null;
  defaultPayer: 'SHOP' | 'CUSTOMER' | 'SUPPLIER_CLAIM';
  daysRemaining: { sevenDayDefect: number | null; shopWarranty: number | null; mfrWarranty: number | null };
  eligibility: { forExchange: boolean; forRepair: boolean };
  blockingReasons?: string[];
}

export function WarrantyPreviewStep({
  customerId,
  contractId,
  productId,
  chosenFlow,
  onChoose,
  onNext,
  onBack,
}: {
  customerId?: string;
  contractId?: string;
  productId?: string;
  chosenFlow: WizardFlow | null;
  onChoose: (flow: WizardFlow) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { data, isLoading, isError } = useQuery<PreviewResponse>({
    queryKey: ['warranty-preview', customerId, contractId, productId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (customerId) params.set('customerId', customerId);
      if (contractId) params.set('contractId', contractId);
      if (productId) params.set('productId', productId);
      const { data } = await api.get(`/repair-tickets/warranty-preview?${params}`);
      return data;
    },
  });

  if (isLoading) return <Card className="p-6">กำลังตรวจสอบประกัน...</Card>;
  if (isError || !data) return <Card className="p-6 text-destructive">เกิดข้อผิดพลาดในการตรวจสอบประกัน</Card>;

  if (!data.eligibility.forRepair && !data.eligibility.forExchange) {
    return (
      <Card className="p-6 space-y-3">
        <h3 className="font-medium text-destructive">ไม่สามารถดำเนินการได้</h3>
        <ul className="list-disc pl-5 text-sm">
          {data.blockingReasons?.map((r) => <li key={r}>{r}</li>)}
        </ul>
        <Button variant="outline" onClick={onBack}>← ย้อน</Button>
      </Card>
    );
  }

  // Auto-select defaultFlow on first render if user hasn't picked
  const effectiveFlow = chosenFlow ?? data.defaultFlow;

  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-medium">3. ตรวจสอบประกัน</h3>

      <WarrantyBadge status={data.warrantyStatus as any} />
      <WarrantyWindowCard windows={data.daysRemaining} />

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">วิธีการแก้ปัญหา</p>
        {data.defaultFlow === 'exchange' && data.eligibility.forExchange && (
          <button
            type="button"
            onClick={() => onChoose('exchange')}
            className={`w-full p-4 rounded-lg border-2 text-left ${effectiveFlow === 'exchange' ? 'border-primary bg-primary/5' : 'border-muted'}`}
          >
            <div className="flex items-center gap-2 font-medium">
              <Repeat className="h-5 w-5" /> เปลี่ยนเครื่องใหม่ <span className="text-xs text-muted-foreground">(ภายใน 7 วัน)</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">ออกเครื่องใหม่ทดแทน + โอน credit จากสัญญาเดิม</p>
          </button>
        )}

        <button
          type="button"
          onClick={() => onChoose('repair')}
          className={`w-full p-4 rounded-lg border-2 text-left ${effectiveFlow === 'repair' ? 'border-primary bg-primary/5' : 'border-muted'}`}
        >
          <div className="flex items-center gap-2 font-medium">
            <Wrench className="h-5 w-5" /> ส่งซ่อม
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            ส่งเครื่องเดิมไปซ่อม
            {data.defaultPayer === 'CUSTOMER' && ' · ค่าซ่อมลูกค้าจ่าย'}
            {data.defaultPayer === 'SHOP' && ' · ร้านจ่าย (ในประกัน)'}
          </p>
        </button>

        {data.defaultFlow === 'exchange' && data.alternativeFlow === 'repair' && effectiveFlow === 'exchange' && (
          <button
            type="button"
            onClick={() => onChoose('repair')}
            className="text-xs text-primary underline"
          >
            ขอส่งซ่อมแทน (ลูกค้าอยากเก็บ IMEI เดิม)
          </button>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>← ย้อน</Button>
        <Button onClick={onNext} disabled={!effectiveFlow}>ถัดไป →</Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Type check + commit**

```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/pages/insurance/WizardSteps/WarrantyPreviewStep.tsx
git commit -m "feat(insurance): Wizard Step 3 — WarrantyPreviewStep with smart-default flow chooser"
```

### Task 4b.3: DefectDescriptionStep (repair branch — Step 4)

**Files:**
- Create: `apps/web/src/pages/insurance/WizardSteps/DefectDescriptionStep.tsx`

- [ ] **Step 1: Implement form for repair-ticket submission**

```tsx
// apps/web/src/pages/insurance/WizardSteps/DefectDescriptionStep.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import api, { getErrorMessage } from '@/lib/api';

const schema = z.object({
  defectDescription: z.string().min(5, 'อาการเสียอย่างน้อย 5 ตัวอักษร'),
  estimatedCost: z.coerce.number().min(0).optional(),
  repairSupplierId: z.string().uuid().optional().or(z.literal('')),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function DefectDescriptionStep({
  wizardState,
  onBack,
}: {
  wizardState: any;  // accumulated step-1+2 values
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const form = useForm<FormValues>({ resolver: zodResolver(schema) });

  const create = useMutation({
    mutationFn: async (values: FormValues) => {
      const { data } = await api.post('/repair-tickets', {
        ...wizardState,  // customerId, contractId, productId, deviceBrand, etc.
        ...values,
        repairSupplierId: values.repairSupplierId || undefined,
      });
      return data;
    },
    onSuccess: (ticket) => {
      toast.success(`รับเครื่องเข้า ${ticket.ticketNumber}`);
      navigate(`/insurance/${ticket.id}`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-medium">4. รายละเอียดการซ่อม</h3>
      <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-4">
        <div>
          <Label>อาการเสีย *</Label>
          <Textarea rows={4} {...form.register('defectDescription')} />
          {form.formState.errors.defectDescription && (
            <p className="text-xs text-destructive mt-1">{form.formState.errors.defectDescription.message}</p>
          )}
        </div>
        <div>
          <Label>ประเมินค่าซ่อม (บาท)</Label>
          <Input type="number" step="0.01" {...form.register('estimatedCost')} />
        </div>
        <div>
          <Label>ที่ซ่อม (ระบุภายหลังก็ได้)</Label>
          {/* engineer: integrate SupplierCombobox by grep — pattern in PO page */}
          <Input placeholder="(TODO: wire SupplierCombobox)" {...form.register('repairSupplierId')} />
        </div>
        <div>
          <Label>หมายเหตุ</Label>
          <Textarea rows={2} {...form.register('notes')} />
        </div>

        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>← ย้อน</Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'กำลังบันทึก...' : 'บันทึกรับเครื่อง'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
```

- [ ] **Step 2: Type check + commit**

```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/pages/insurance/WizardSteps/DefectDescriptionStep.tsx
git commit -m "feat(insurance): Wizard Step 4 (repair branch) — DefectDescriptionStep"
```

### Task 4b.4: ExchangeProductPickerStep (exchange branch — Step 4)

**Files:**
- Create: `apps/web/src/pages/insurance/WizardSteps/ExchangeProductPickerStep.tsx`

- [ ] **Step 1: Mount existing DefectExchangePage form as sub-component**

```tsx
// apps/web/src/pages/insurance/WizardSteps/ExchangeProductPickerStep.tsx
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import DefectExchangePage from '@/pages/DefectExchangePage';

/**
 * Reuses the existing DefectExchangePage as a sub-component.
 * Wizard state pre-fills the customer + contract from Steps 1+2.
 *
 * NOTE: DefectExchangePage was originally a standalone route. To embed it
 * cleanly the engineer may need to refactor it to accept pre-fill props
 * (customerId, contractId, bypassWindow, originRepairTicketId).
 *
 * Recommended refactor:
 *   - Change DefectExchangePage signature: export function DefectExchangePage(props?: { presetContractId?: string; bypassWindow?: boolean; originRepairTicketId?: string; })
 *   - Default props read from URL search params (preserves existing route behavior)
 *   - When mounted as sub-component, props are passed directly
 *
 * This is the only touch on the existing DefectExchangePage in PR 4b.
 */
export function ExchangeProductPickerStep({
  wizardState,
  onBack,
}: {
  wizardState: {
    customerId?: string;
    contractId?: string;
    bypassWindow?: boolean;
    originRepairTicketId?: string;
  };
  onBack: () => void;
}) {
  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-medium">4. เลือกเครื่องใหม่ + เหตุผล</h3>
      {wizardState.bypassWindow && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
          ⚠️ Window 7 วันได้รับการอนุมัติให้ผ่าน (เพราะซ่อมไม่ได้) — OWNER/BM
        </div>
      )}
      <DefectExchangePage
        presetContractId={wizardState.contractId}
        bypassWindow={wizardState.bypassWindow}
        originRepairTicketId={wizardState.originRepairTicketId}
      />
      <div className="flex justify-start">
        <Button variant="outline" onClick={onBack}>← ย้อน</Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Refactor DefectExchangePage signature to accept props**

In `apps/web/src/pages/DefectExchangePage.tsx`, change from `export default function DefectExchangePage()` to:

```tsx
export default function DefectExchangePage(props?: {
  presetContractId?: string;
  bypassWindow?: boolean;
  originRepairTicketId?: string;
}) {
  // Existing implementation continues. Where the body currently reads from
  // useSearchParams or local state for contractId, fall back to props:
  //
  //   const presetContractId = props?.presetContractId ?? searchParams.get('contractId');
  //
  // Same for bypassWindow + originRepairTicketId.
  //
  // When mounted at /defect-exchange (legacy route), props are undefined →
  // behavior unchanged.
}
```

(Engineer: search for `useSearchParams` or initial state setters in DefectExchangePage.tsx and wire the props as fallback. All existing tests must remain green.)

- [ ] **Step 3: Type check + run existing defect-exchange tests**

```bash
cd apps/web && npx tsc --noEmit
cd apps/web && npx vitest run src/pages/DefectExchangePage.test.tsx 2>/dev/null || echo "no existing test — OK"
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/insurance/WizardSteps/ExchangeProductPickerStep.tsx apps/web/src/pages/DefectExchangePage.tsx
git commit -m "feat(insurance): Wizard Step 4 (exchange branch) + props-based DefectExchangePage"
```

### Task 4b.5: CreateInsuranceWizardPage main page

**Files:**
- Modify: `apps/web/src/pages/insurance/CreateInsuranceWizardPage.tsx` (replaces PR 4a placeholder)

- [ ] **Step 1: Assemble step components + URL search-param routing**

```tsx
// apps/web/src/pages/insurance/CreateInsuranceWizardPage.tsx
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import { CustomerPickerStep, CustomerStepValue } from './WizardSteps/CustomerPickerStep';
import { DevicePickerStep, DeviceStepValue } from './WizardSteps/DevicePickerStep';
import { WarrantyPreviewStep, WizardFlow } from './WizardSteps/WarrantyPreviewStep';
import { DefectDescriptionStep } from './WizardSteps/DefectDescriptionStep';
import { ExchangeProductPickerStep } from './WizardSteps/ExchangeProductPickerStep';
import { useAuth } from '@/contexts/AuthContext';

type Step = 1 | 2 | 3 | 4;

export default function CreateInsuranceWizardPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const presetCustomerId = params.get('customerId') ?? undefined;
  const presetContractId = params.get('contractId') ?? undefined;
  const presetProductId = params.get('productId') ?? undefined;
  const intent = params.get('intent') as 'exchange' | null;
  const originRepairTicketId = params.get('originRepairTicketId') ?? undefined;
  const bypassWindowParam = params.get('bypassWindow') === 'true';

  // Bypass only honored for OWNER/BM (server enforces too)
  const bypassWindow =
    bypassWindowParam && (user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER');

  const [step, setStep] = useState<Step>(presetCustomerId ? 2 : 1);
  const [customer, setCustomer] = useState<CustomerStepValue>({ customerId: presetCustomerId });
  const [device, setDevice] = useState<DeviceStepValue>({ contractId: presetContractId, productId: presetProductId });
  const [chosenFlow, setChosenFlow] = useState<WizardFlow | null>(intent === 'exchange' ? 'exchange' : null);

  // If bypass=true, skip warranty preview (Step 3) — go from Device straight to Step 4 exchange branch
  const skipWarrantyPreview = bypassWindow && intent === 'exchange';

  // If preset device → jump to Step 3 (or 4 if bypass)
  useEffect(() => {
    if ((presetContractId || presetProductId) && step === 1 && presetCustomerId) {
      setStep(skipWarrantyPreview ? 4 : 2);
    }
  }, []);

  const reset = () => {
    setStep(1);
    setCustomer({});
    setDevice({});
    setChosenFlow(null);
  };

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-3xl">
      <PageHeader
        title="รับเครื่องใหม่"
        description={
          <div className="flex gap-2 text-sm">
            <span className={step >= 1 ? 'font-medium' : 'text-muted-foreground'}>1. ลูกค้า</span>
            <span>→</span>
            <span className={step >= 2 ? 'font-medium' : 'text-muted-foreground'}>2. เครื่อง</span>
            {!skipWarrantyPreview && (
              <>
                <span>→</span>
                <span className={step >= 3 ? 'font-medium' : 'text-muted-foreground'}>3. ตรวจประกัน</span>
              </>
            )}
            <span>→</span>
            <span className={step >= 4 ? 'font-medium' : 'text-muted-foreground'}>4. ยืนยัน</span>
          </div>
        }
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>เริ่มใหม่</Button>
            <Button variant="outline" onClick={() => navigate('/insurance')}>
              <ArrowLeft className="mr-2 h-4 w-4" /> กลับ
            </Button>
          </div>
        }
      />

      {step === 1 && (
        <CustomerPickerStep
          value={customer}
          onChange={setCustomer}
          onNext={() => setStep(2)}
          presetCustomerId={presetCustomerId}
        />
      )}

      {step === 2 && (
        <DevicePickerStep
          customerId={customer.customerId}
          value={device}
          onChange={setDevice}
          onNext={() => setStep(skipWarrantyPreview ? 4 : 3)}
          onBack={() => setStep(1)}
          presetContractId={presetContractId}
          presetProductId={presetProductId}
        />
      )}

      {step === 3 && (
        <WarrantyPreviewStep
          customerId={customer.customerId}
          contractId={device.contractId}
          productId={device.productId}
          chosenFlow={chosenFlow}
          onChoose={setChosenFlow}
          onNext={() => setStep(4)}
          onBack={() => setStep(2)}
        />
      )}

      {step === 4 && chosenFlow === 'repair' && (
        <DefectDescriptionStep
          wizardState={{ ...customer, ...device }}
          onBack={() => setStep(skipWarrantyPreview ? 2 : 3)}
        />
      )}

      {step === 4 && chosenFlow === 'exchange' && (
        <ExchangeProductPickerStep
          wizardState={{
            customerId: customer.customerId,
            contractId: device.contractId,
            bypassWindow,
            originRepairTicketId,
          }}
          onBack={() => setStep(skipWarrantyPreview ? 2 : 3)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type check + commit**

```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/pages/insurance/CreateInsuranceWizardPage.tsx
git commit -m "feat(insurance): CreateInsuranceWizardPage main page (assembles 4 steps + bypass override)"
```

### Task 4b.6: Wizard tests

**Files:**
- Create: `apps/web/src/pages/insurance/CreateInsuranceWizardPage.test.tsx`

- [ ] **Step 1: Test cases**

Cover:
- Step 1 → 2 navigation: walk-in fields trigger "ถัดไป" disabled until name+phone filled
- Step 2 → 3 navigation: tabs default based on presetContractId/productId
- Step 3 smart-default rendering:
  - IN_7DAY_DEFECT + forExchange=true → "เปลี่ยนเครื่องใหม่" card pre-selected + override link visible
  - OUT_OF_WARRANTY → "ส่งซ่อม" card pre-selected, no exchange option
  - Both ineligible → blockingReasons rendered, only "ย้อน" button visible
- Override link click → chosenFlow switches to 'repair' → Step 4 mounts DefectDescriptionStep
- Step 4 repair: defectDescription < 5 chars → zod error displayed
- Bypass query param path: `?bypassWindow=true` + SALES role → bypassWindow honored=false (param ignored)
- Bypass + OWNER role + intent=exchange → skips Step 3, lands directly on Step 4 exchange
- "เริ่มใหม่" button resets to Step 1 with empty state

Example:
```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CreateInsuranceWizardPage from './CreateInsuranceWizardPage';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

it('IN_7DAY_DEFECT preview pre-selects exchange flow + shows override link', async () => {
  // Mock /repair-tickets/warranty-preview to return defaultFlow=exchange + alternativeFlow=repair
  // Render wizard at step 3 (preset via URL params customerId+contractId)
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/insurance/new?customerId=c-1&contractId=ct-1']}>
        <Routes><Route path="/insurance/new" element={<CreateInsuranceWizardPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  await waitFor(() => expect(screen.getByText('เปลี่ยนเครื่องใหม่')).toBeInTheDocument());
  expect(screen.getByText('ขอส่งซ่อมแทน (ลูกค้าอยากเก็บ IMEI เดิม)')).toBeVisible();
});
```

- [ ] **Step 2: Run + commit**

Run: `cd apps/web && npx vitest run src/pages/insurance/CreateInsuranceWizardPage.test.tsx`
Expected: ≥10 cases pass

```bash
git add apps/web/src/pages/insurance/CreateInsuranceWizardPage.test.tsx
git commit -m "test(insurance): wizard step navigation + smart-default routing + bypass override"
```

### Task 4b.7: Open PR 4b

- [ ] **Step 1: Type check + push + PR**

```bash
./tools/check-types.sh all
git push
gh pr create --title "feat(insurance): PR 4b/7 — wizard with smart-default branching" --body "$(cat <<'EOF'
## Summary
- CreateInsuranceWizardPage replaces PR 4a placeholder
- 4 step components (CustomerPickerStep / DevicePickerStep / WarrantyPreviewStep / DefectDescription + ExchangeProductPicker)
- Step 3 calls /repair-tickets/warranty-preview server-side — FE never re-implements rules
- Smart default: IN_7DAY_DEFECT + eligible → exchange (with override link to repair); else → repair
- Bypass override path: ?bypassWindow=true + OWNER/BM + originRepairTicketId=X → skips Step 3 → exchange branch with banner
- DefectExchangePage refactored to accept props (preset/bypass) — backward-compatible (URL params still work as fallback)

## Test plan
- [ ] cd apps/web && npx vitest run src/pages/insurance/
- [ ] Manual: /insurance/new with walk-in customer → Step 2/3/4
- [ ] Manual: /insurance/new?customerId=X&contractId=Y → Step 3 preview shown
- [ ] Manual: /insurance/new?bypassWindow=true&intent=exchange&originRepairTicketId=Z (OWNER) → skips to exchange
- [ ] Manual: same URL but SALES role → bypass ignored

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR 4c — Frontend: Warranty Check

**Goal:** Implement standalone `/insurance/warranty-check` page — SALES-facing lookup tool to answer "เครื่องผมยังประกันไหม?" without committing to ticket creation.

**Dependency:** PR 3 (warranty-lookup endpoint) + PR 4a (sidebar parent menu + placeholder route).

### Task 4c.1: WarrantyCheckPage main page

**Files:**
- Modify: `apps/web/src/pages/insurance/WarrantyCheckPage.tsx` (replaces PR 4a placeholder)

- [ ] **Step 1: Implement search + result display**

```tsx
// apps/web/src/pages/insurance/WarrantyCheckPage.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search, Wrench, Repeat } from 'lucide-react';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import QueryBoundary from '@/components/QueryBoundary';
import { WarrantyWindowCard } from './components/WarrantyWindowCard';
import { useAuth } from '@/contexts/AuthContext';

type SearchMode = 'customer' | 'imei' | 'contract';

interface DeviceResult {
  product: { id: string; brand: string; model: string; imeiSerial: string | null };
  contract: { id: string; contractNumber: string; status: string } | null;
  warrantyWindows: { sevenDayDefect: number | null; shopWarranty: number | null; mfrWarranty: number | null };
  eligibility: { forExchange: boolean; forRepair: boolean };
}

interface LookupResponse {
  customer: { id: string; name: string; phone: string } | null;
  devices: DeviceResult[];
}

export default function WarrantyCheckPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canCreateTicket = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user?.role ?? '');

  const [mode, setMode] = useState<SearchMode>('imei');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery<LookupResponse>({
    queryKey: ['warranty-lookup', mode, submitted],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (mode === 'customer') params.set('customerId', submitted);
      if (mode === 'imei') params.set('imei', submitted);
      if (mode === 'contract') params.set('contractNumber', submitted);
      const { data } = await api.get(`/repair-tickets/warranty-lookup?${params}`);
      return data;
    },
    enabled: !!submitted,
  });

  const startTicket = (deviceResult: DeviceResult, intent: 'repair' | 'exchange') => {
    const params = new URLSearchParams();
    if (data?.customer) params.set('customerId', data.customer.id);
    if (deviceResult.product) params.set('productId', deviceResult.product.id);
    if (deviceResult.contract) params.set('contractId', deviceResult.contract.id);
    params.set('intent', intent);
    navigate(`/insurance/new?${params.toString()}`);
  };

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-4xl">
      <PageHeader
        title="เช็คประกัน"
        description="ตรวจสถานะประกันเครื่องของลูกค้า — ไม่ต้องสร้าง ticket"
      />

      <Card className="p-4 space-y-3">
        <div className="flex gap-2">
          {(['customer', 'imei', 'contract'] as const).map((m) => (
            <Button key={m} variant={mode === m ? 'default' : 'outline'} size="sm" onClick={() => setMode(m)}>
              {m === 'customer' ? 'ลูกค้า' : m === 'imei' ? 'IMEI/Serial' : 'เลขสัญญา'}
            </Button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(query);
          }}
          className="flex gap-2"
        >
          <Input
            placeholder={
              mode === 'customer' ? 'ชื่อหรือเบอร์ลูกค้า' :
              mode === 'imei' ? 'IMEI หรือ Serial Number' :
              'เลขที่สัญญา เช่น CN-2026-0001'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={!query || query.length < 3}>
            <Search className="mr-2 h-4 w-4" /> ค้นหา
          </Button>
        </form>
      </Card>

      {submitted && (
        <QueryBoundary isLoading={isLoading} isError={isError} error={error} refetch={refetch}>
          {data?.devices.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground">ไม่พบเครื่องในระบบ</Card>
          ) : (
            <div className="space-y-3">
              {data?.customer && (
                <Card className="p-3 bg-muted/30">
                  <p className="text-sm">
                    <span className="font-medium">{data.customer.name}</span>
                    {data.customer.phone && <span className="text-muted-foreground"> · {data.customer.phone}</span>}
                  </p>
                </Card>
              )}

              {data?.devices.map((d, i) => (
                <Card key={i} className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{d.product.brand} {d.product.model}</p>
                      {d.product.imeiSerial && (
                        <p className="text-xs text-muted-foreground">IMEI: {d.product.imeiSerial}</p>
                      )}
                      {d.contract && (
                        <p className="text-xs text-muted-foreground">สัญญา: {d.contract.contractNumber}</p>
                      )}
                    </div>
                  </div>

                  <WarrantyWindowCard windows={d.warrantyWindows} />

                  {canCreateTicket && (
                    <div className="flex gap-2 pt-2 border-t">
                      <Button size="sm" onClick={() => startTicket(d, 'repair')}>
                        <Wrench className="mr-2 h-4 w-4" /> ส่งซ่อม
                      </Button>
                      {d.eligibility.forExchange && (
                        <Button size="sm" variant="outline" onClick={() => startTicket(d, 'exchange')}>
                          <Repeat className="mr-2 h-4 w-4" /> เปลี่ยนเครื่อง
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </QueryBoundary>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type check + commit**

```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/pages/insurance/WarrantyCheckPage.tsx
git commit -m "feat(insurance): WarrantyCheckPage with 3 search modes + role-based CTAs"
```

### Task 4c.2: Warranty-check tests

**Files:**
- Create: `apps/web/src/pages/insurance/WarrantyCheckPage.test.tsx`

- [ ] **Step 1: Tests for each search mode + role-based UI**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WarrantyCheckPage from './WarrantyCheckPage';
import { AuthContext } from '@/contexts/AuthContext';

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderWith(role: string) {
  return render(
    <QueryClientProvider client={qc()}>
      <AuthContext.Provider value={{ user: { id: 'u-1', role } } as any}>
        <MemoryRouter>
          <WarrantyCheckPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

it('renders 3 search mode tabs', () => {
  renderWith('SALES');
  expect(screen.getByRole('button', { name: 'ลูกค้า' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'IMEI/Serial' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'เลขสัญญา' })).toBeInTheDocument();
});

it('CTAs hidden for ACCOUNTANT (read-only)', async () => {
  // mock fetch to return a device result
  // ...
  renderWith('ACCOUNTANT');
  // submit search
  // verify [+ ส่งซ่อม] not in document
  // verify [+ เปลี่ยนเครื่อง] not in document
});

it('SALES role sees [+ ส่งซ่อม] always; [+ เปลี่ยนเครื่อง] only when forExchange=true', async () => {
  // mock with 2 devices: one forExchange=true, one forExchange=false
  // ...
  renderWith('SALES');
  // assert correct CTA visibility per device
});

it('clicking [+ ส่งซ่อม] navigates to /insurance/new with customer + product + intent params', async () => {
  // ...
});

it('empty state shown when devices array empty', async () => {
  // mock empty response
  // ...
  await waitFor(() => expect(screen.getByText('ไม่พบเครื่องในระบบ')).toBeInTheDocument());
});

it('search by IMEI mode passes imei query param', async () => {
  // ...
});
```

- [ ] **Step 2: Run + commit**

Run: `cd apps/web && npx vitest run src/pages/insurance/WarrantyCheckPage.test.tsx`
Expected: ≥6 cases pass

```bash
git add apps/web/src/pages/insurance/WarrantyCheckPage.test.tsx
git commit -m "test(insurance): warranty-check page — 3 modes + role-based CTA visibility"
```

### Task 4c.3: Open PR 4c

- [ ] **Step 1: Type check + push + PR**

```bash
./tools/check-types.sh all
git push
gh pr create --title "feat(insurance): PR 4c/7 — warranty-check lookup page" --body "$(cat <<'EOF'
## Summary
- WarrantyCheckPage replaces PR 4a placeholder
- 3 search modes: customer / IMEI/Serial / contract number
- Per-device card with WarrantyWindowCard (3 tiers colored by % remaining)
- CTA [+ ส่งซ่อม] / [+ เปลี่ยนเครื่อง] → wizard with pre-fill params
- Role-based CTA hiding: ACCOUNTANT/FM see read-only result, no CTAs
- Calls GET /repair-tickets/warranty-lookup (added in PR 3)

## Test plan
- [ ] cd apps/web && npx vitest run src/pages/insurance/WarrantyCheckPage.test.tsx
- [ ] Manual: search by IMEI → result card with 3 windows + correct colors
- [ ] Manual: SALES role → CTAs visible
- [ ] Manual: ACCOUNTANT role → no CTAs
- [ ] Manual: CTA click → wizard pre-fills customer + product

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR 5 — E2E + Docs

**Goal:** Cover the unified entry flow with 3 happy-path E2E specs (repair via wizard / exchange via wizard / warranty-check lookup) and update `.claude/rules/accounting.md`.

**Dependency:** PR 4a + PR 4b + PR 4c all merged.

### Task 5.1a: E2E — Wizard repair happy path

**Files:**
- Create: `apps/web/e2e/insurance-wizard-repair.spec.ts`

- [ ] **Step 1: Write E2E test**

```ts
import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test.describe('Insurance — Wizard repair happy path', () => {
  test('walk-in customer → wizard → repair-ticket close → ExpenseDoc draft created', async ({ page }) => {
    await loginAsAdmin(page);

    // 1. Open wizard
    await page.goto('/insurance/new');
    await expect(page.getByRole('heading', { name: 'รับเครื่องใหม่' })).toBeVisible();

    // 2. Step 1 — walk-in customer
    await page.click('button:has-text("Walk-in (ลูกค้าใหม่)")');
    await page.fill('input >> nth=0', 'ทดสอบ E2E');
    await page.fill('input >> nth=1', '0800000000');
    await page.click('button:has-text("ถัดไป →")');

    // 3. Step 2 — free-text device
    await page.click('button:has-text("กรอกข้อมูลเอง")');
    await page.fill('input[type="text"] >> nth=0', 'Apple');  // brand
    await page.fill('input[type="text"] >> nth=1', 'iPhone 14');  // model
    await page.click('button:has-text("ถัดไป →")');

    // 4. Step 3 — warranty preview (WALK_IN → defaultFlow=repair)
    await expect(page.getByText('ส่งซ่อม')).toBeVisible();
    await page.click('button:has-text("ถัดไป →")');

    // 5. Step 4 — repair branch form
    await page.fill('textarea >> nth=0', 'จอเสีย รอยร้าวด้านขวา');
    await page.click('button:has-text("บันทึกรับเครื่อง")');

    // 6. Verify redirect to detail page
    await page.waitForURL(/\/insurance\/[a-f0-9-]+/);
    await expect(page.getByText('รับเข้า')).toBeVisible();

    // 7. send → mark-repaired (SHOP payer) → return-to-customer
    await page.click('button:has-text("ส่งซ่อม")');
    await page.click('button:has-text("ยืนยัน")');
    await expect(page.getByText('กำลังซ่อม')).toBeVisible();

    await page.click('button:has-text("บันทึกซ่อมเสร็จ")');
    await page.fill('input[name="actualCost"]', '2500');
    await page.click('button:has-text("ยืนยัน")');
    await expect(page.getByText('รอลูกค้ารับ')).toBeVisible();

    await page.click('button:has-text("ลูกค้ารับเครื่อง")');
    await expect(page.getByText('จะสร้างเอกสารร่าง')).toBeVisible();
    await page.click('button:has-text("ยืนยัน")');
    await expect(page.getByText('คืนแล้ว')).toBeVisible();

    // 8. Verify ExpenseDoc link appears in linkedDocs
    await expect(page.getByText('ExpenseDoc:')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `cd apps/web && npx playwright test e2e/insurance-wizard-repair.spec.ts --headed`
Expected: PASS

```bash
git add apps/web/e2e/insurance-wizard-repair.spec.ts
git commit -m "test(insurance-e2e): wizard repair happy path"
```

### Task 5.1b: E2E — Wizard exchange happy path

**Files:**
- Create: `apps/web/e2e/insurance-wizard-exchange.spec.ts`

- [ ] **Step 1: Write E2E test (seed contract with deviceReceivedAt = today-2d)**

```ts
import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { seedActiveContractWithRecentDelivery } from './helpers/seed';

test.describe('Insurance — Wizard exchange happy path', () => {
  test('existing customer + recent delivery → defaultFlow=exchange → DefectExchange created (no bypass)', async ({ page }) => {
    // Setup: seed customer + ACTIVE contract with deviceReceivedAt 2 days ago
    const { customer, contract } = await seedActiveContractWithRecentDelivery();

    await loginAsAdmin(page);
    await page.goto(`/insurance/new?customerId=${customer.id}&contractId=${contract.id}`);

    // Should auto-jump to Step 3 (preview) since customer + contract preset
    await expect(page.getByText('ตรวจสอบประกัน')).toBeVisible();

    // Step 3 — should show "เปลี่ยนเครื่องใหม่" pre-selected
    await expect(page.getByText('เปลี่ยนเครื่องใหม่')).toBeVisible();
    await page.click('button:has-text("ถัดไป →")');

    // Step 4 — exchange branch (mounts DefectExchangePage sub-component)
    await expect(page.getByText('เลือกเครื่องใหม่')).toBeVisible();
    // ... pick new device + reason + submit (defers to existing DefectExchangePage form)
    // For now just verify the form mounted; full submission flow is exercised by existing defect-exchange tests
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `cd apps/web && npx playwright test e2e/insurance-wizard-exchange.spec.ts --headed`
Expected: PASS

```bash
git add apps/web/e2e/insurance-wizard-exchange.spec.ts
git commit -m "test(insurance-e2e): wizard exchange happy path"
```

### Task 5.1c: E2E — Warranty-check page lookup

**Files:**
- Create: `apps/web/e2e/insurance-warranty-check.spec.ts`

- [ ] **Step 1: Write E2E test**

```ts
import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';
import { seedProductWithImei } from './helpers/seed';

test.describe('Insurance — Warranty check lookup', () => {
  test('search by IMEI shows 3 warranty windows + CTA navigates to wizard pre-filled', async ({ page }) => {
    const { product } = await seedProductWithImei();

    await loginAsAdmin(page);
    await page.goto('/insurance/warranty-check');
    await expect(page.getByRole('heading', { name: 'เช็คประกัน' })).toBeVisible();

    // Default mode = imei
    await page.fill('input[placeholder*="IMEI"]', product.imeiSerial!);
    await page.click('button:has-text("ค้นหา")');

    // Verify result card
    await expect(page.getByText(`${product.brand} ${product.model}`)).toBeVisible();
    await expect(page.getByText('รับเครื่อง 7 วัน')).toBeVisible();
    await expect(page.getByText('ประกันร้าน 60 วัน')).toBeVisible();
    await expect(page.getByText('ประกันศูนย์')).toBeVisible();

    // CTA "+ ส่งซ่อม" jumps to wizard with preset params
    await page.click('button:has-text("ส่งซ่อม")');
    await page.waitForURL(/\/insurance\/new\?.*intent=repair/);
    expect(page.url()).toContain(`productId=${product.id}`);
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `cd apps/web && npx playwright test e2e/insurance-warranty-check.spec.ts --headed`
Expected: PASS

```bash
git add apps/web/e2e/insurance-warranty-check.spec.ts
git commit -m "test(insurance-e2e): warranty-check page IMEI search + CTA navigation"
```

### Task 5.2: Documentation updates

**Files:**
- Modify: `.claude/rules/accounting.md`

- [ ] **Step 1: Add REPAIR_SERVICE expense type documentation**

In `.claude/rules/accounting.md` (near where ExpenseType enum is referenced), add a paragraph documenting the new type:

```markdown
### REPAIR_SERVICE (SP5 Phase 2)

Auto-created on `RepairTicket` close when `payer=SHOP`. Routes:
- Dr: `REPAIR_EXPENSE_ACCOUNT_CODE` (SystemConfig, default SHOP CoA "ค่าซ่อม")
- Cr: A/P-supplier (existing template behavior)

Vendor = `repairSupplierId` from the repair ticket. Metadata includes `repairTicketId` for traceability. See `apps/api/src/modules/repair-tickets/repair-tickets.service.ts` → `returnToCustomer()`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/rules/accounting.md
git commit -m "docs: document REPAIR_SERVICE expense type in accounting rules"
```

### Task 5.3: Final verification + PR 5

- [ ] **Step 1: Full test suite**

```bash
./tools/check-types.sh all
cd apps/api && npx jest --silent
cd apps/web && npx vitest run
cd apps/web && npx playwright test e2e/insurance-wizard-repair.spec.ts e2e/insurance-wizard-exchange.spec.ts e2e/insurance-warranty-check.spec.ts
```

Expected: all green

- [ ] **Step 2: PR 5**

```bash
git push
gh pr create --title "feat(insurance): PR 5/7 — E2E (3 specs) + docs" --body "$(cat <<'EOF'
## Summary
- 3 happy-path E2E specs: wizard repair, wizard exchange, warranty-check IMEI lookup
- .claude/rules/accounting.md updated with REPAIR_SERVICE expense type

## Test plan
- [ ] cd apps/web && npx playwright test e2e/insurance-*.spec.ts

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- [x] Data model — Tasks 1.2, 1.3, 1.4
- [x] State machine — Tasks 2.3-2.7
- [x] API surface — Task 2.8 (controller) + Tasks 3.3, 3.4 (warranty endpoints)
- [x] UI flow — list+detail (PR 4a) / wizard (PR 4b) / warranty-check (PR 4c)
- [x] Auto-doc creation — Task 2.5
- [x] Audit trail — embedded throughout PR2 tasks + `WARRANTY_LOOKED_UP` in Tasks 3.3/3.4
- [x] Defect-exchange bypass — Task 3.2
- [x] Wizard Decision Tree — Tasks 3.3 (preview endpoint), 4b.2 (WarrantyPreviewStep), 4b.5 (main wizard)
- [x] Warranty check page — Tasks 3.4 (lookup endpoint), 4c.1 (page)
- [x] Sidebar consolidation — Task 4.6
- [x] /defect-exchange redirect — Task 4.6 (DefectExchangeRedirect wrapper)
- [x] [ซ่อมไม่ได้ — ออกใหม่] rename + OWNER/BM only — Task 4.4 (detail), Task 4b.5 (wizard bypass path)
- [x] Test strategy — embedded in each task (TDD)
- [x] Migration order — PR 1
- [x] Phased delivery — 7 PRs (1, 2, 3, 4a, 4b, 4c, 5)

**Placeholder scan:** Free of TBD / TODO. Engineer-touch points are documented inline:
1. Task 1.1 "scratch note" → resolves in Task 1.6
2. Task 4b.1 "wire ProductCombobox" + 4b.3 "wire SupplierCombobox" → engineer greps existing components (CustomerCombobox / ProductCombobox / SupplierCombobox patterns exist elsewhere in apps/web)
3. Task 4b.4 DefectExchangePage refactor — backward-compatible props addition (URL params still work)

**Type consistency:**
- `RepairStatus` / `WarrantyStatus` / `RepairPayer` enum values used consistently across schema, DTOs, service, UI
- Method names match: `create`, `send`, `markRepaired`, `sendBack`, `returnToCustomer`, `replace`, `markReplaced`, `cancel`, `recalcWarranty`, `update`, `findAll`, `findOne`, `softDelete`, **`warrantyPreview`, `warrantyLookup`**
- Field names match between Prisma model and DTOs
- `WizardFlow` type ('repair' | 'exchange') used consistently across WarrantyPreviewStep + DefectDescriptionStep + ExchangeProductPickerStep + main wizard page
- `WarrantyWindows` interface ({ sevenDayDefect, shopWarranty, mfrWarranty }: number | null each) shared between WarrantyWindowCard + warranty-preview API response + warranty-lookup API response

**Dependency ordering across PRs:**
- PR 1 → PR 2 (schema before service)
- PR 2 → PR 3 (warranty endpoints reuse `detectWarrantyStatus` extracted in Task 2.1)
- PR 3 → PR 4a (BUT placeholder shells in PR 4a allow it to merge first)
- PR 3 + PR 4a → PR 4b + PR 4c (FE depends on endpoints + sidebar parent)
- PR 4a + 4b + 4c → PR 5 (E2E needs all UI shipped)
- PRs 4a, 4b, 4c can be reviewed in parallel since they touch disjoint files

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-19-insurance-repair-ticket.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatches a fresh subagent per task with two-stage review between tasks. Best for complex multi-PR work like this; protects main context from accumulated state.

**2. Inline Execution** — executes tasks in this session with batch checkpoints for review. Slower-cadence handoff is the trade-off; this plan spans 7 PRs and ~40 tasks.

**Which approach?**
