# Insurance / Repair Ticket — SP5 Phase 2

> Promote `/insurance` จาก redirect stub → full repair ticket lifecycle (รับเข้า → ส่งซ่อม → ซ่อมเสร็จ → คืนลูกค้า → ปิด/เปลี่ยน/ยกเลิก) พร้อม auto-detect warranty, auto-create draft accounting docs, audit trail per status transition.

**Date**: 2026-05-19
**Phase**: SP5 Phase 2 (deferred from Phase 1 — was redirect stub)
**Scope**: Full (Option C from brainstorm) — repair ticketing + supplier claim + customer-paid out-of-warranty + auto JE document drafts
**Out of scope** (Phase 3+): LINE OA auto-notification, repair-parts stock management, repair revenue/cost analytics dashboards, customer-facing LIFF self-service

## Problem

ปัจจุบัน `apps/web/src/pages/InsurancePage.tsx` 23 บรรทัด — ทำ `<Navigate to="/defect-exchange" replace />` เท่านั้น. ไม่มีระบบบันทึก:

- เครื่องที่ลูกค้าส่งซ่อม (อาการเสีย, ที่ซ่อม, วัน, ค่าซ่อม)
- สถานะระหว่างซ่อม (อยู่ที่ศูนย์ไหน, ค้างกี่วัน, ลูกค้ามารับหรือยัง)
- ค่าซ่อม → บัญชี SHOP (ไม่ได้ post JE อัตโนมัติ)
- ประวัติซ่อมต่อลูกค้า/ต่อเครื่อง

มี `/defect-exchange` ที่ทำเฉพาะ "เปลี่ยนเครื่องภายใน 7 วัน" — ครอบ window แคบ ไม่ใช่ tool ทั่วไปสำหรับซ่อม

## Solution overview

โมดูล `repair-tickets` ใหม่ (standalone) เก็บ lifecycle 6 สถานะ:

```
OPEN → IN_PROGRESS → READY_FOR_PICKUP → CLOSED
                                       ↘ REPLACED (link /defect-exchange)
                                       ↘ CANCELLED
```

- Customer required, Contract/Product optional + free-text fallback (walk-in)
- Auto-detect WarrantyStatus (IN_7DAY_DEFECT / IN_SHOP_WARRANTY / IN_MANUFACTURER / OUT_OF_WARRANTY / WALK_IN)
- เมื่อปิด ticket → auto-create draft `ExpenseDocument` (payer=SHOP) หรือ `OtherIncome` (payer=CUSTOMER); SUPPLIER_CLAIM = no doc
- Reuse existing `Supplier` table + flag `isRepairCenter` (ศูนย์ Apple = supplier ตัวเดียวกับที่ซื้ออะไหล่)
- REPLACED outcome → redirect to existing `/defect-exchange` ด้วย `bypassWindowCheck=true` (เพราะ past 7 วัน)

## Architecture

**Approach 1 — standalone module** (chosen over Approach 2 "unified module merge" + Approach 3 "polymorphic table" — additive-only, low-risk, preserves production-tested defect-exchange code)

```
apps/api/src/modules/
  defect-exchange/          ← preserved + 1 additive flag (bypassWindowCheck)
  repair-tickets/           ← new module
    repair-ticket.controller.ts
    repair-ticket.service.ts
    repair-ticket.module.ts
    dto/
    __tests__/
    templates/              ← (none — reuses ExpenseDoc + OtherIncome templates)

apps/web/src/pages/
  InsurancePage.tsx         ← rewrite from stub to real list page
  insurance/
    CreateRepairTicketPage.tsx
    RepairTicketDetailPage.tsx
    components/
      WarrantyBadge.tsx
      RepairStatusBadge.tsx
      TimelineEvent.tsx
  DefectExchangePage.tsx    ← preserved (mounted at /defect-exchange — unchanged)
```

## Data Model

### Enums

```prisma
enum RepairStatus {
  OPEN              // รับเครื่องเข้า ยังไม่ส่งซ่อม
  IN_PROGRESS       // ส่งซ่อม / กำลังซ่อม
  READY_FOR_PICKUP  // ซ่อมเสร็จ รอลูกค้ามารับ
  CLOSED            // คืนลูกค้าแล้ว (+ JE doc created)
  REPLACED          // เปลี่ยนเครื่องแทน (link → defect-exchange)
  CANCELLED         // ยกเลิก (ลูกค้าเปลี่ยนใจ / เคลมไม่ผ่าน / ค่าซ่อมแพงเกิน)
}

enum WarrantyStatus {
  IN_7DAY_DEFECT      // ภายใน 7 วันแรก → banner แนะนำ /defect-exchange
  IN_SHOP_WARRANTY    // ในประกันร้าน 60 วัน
  IN_MANUFACTURER     // ในประกันศูนย์ (Product.warrantyExpireDate)
  OUT_OF_WARRANTY     // หมดประกัน
  WALK_IN             // ไม่ผูก contract/product
}

enum RepairPayer {
  SHOP                // SHOP จ่าย (in-warranty)
  CUSTOMER            // ลูกค้าจ่ายเอง (out-of-warranty)
  SUPPLIER_CLAIM      // เคลม supplier (no JE)
}
```

### Models

```prisma
/// SP5 Phase 2 — Repair ticket lifecycle.
/// Customer required; Contract/Product optional with free-text fallback.
/// Warranty status detected at create-time; recalc allowed in OPEN state only.
model RepairTicket {
  id            String       @id @default(uuid())
  ticketNumber  String       @unique @map("ticket_number")  // RT-YYYYMMDD-NNNN (BKK day reset)
  status        RepairStatus @default(OPEN)

  customerId    String  @map("customer_id")     // required
  contractId    String? @map("contract_id")     // optional — auto-fill shop warranty
  productId     String? @map("product_id")      // optional — auto-fill mfr warranty

  // Free-text fallback (walk-in / device not in stock)
  deviceBrand   String? @map("device_brand")
  deviceModel   String? @map("device_model")
  deviceImei    String? @map("device_imei")
  deviceSerial  String? @map("device_serial")

  defectDescription  String         @map("defect_description") @db.Text
  warrantyStatus     WarrantyStatus @default(WALK_IN) @map("warranty_status")

  repairSupplierId   String? @map("repair_supplier_id")        // FK Supplier where isRepairCenter=true
  externalClaimNo    String? @map("external_claim_no")          // เลข claim ของศูนย์

  // Timestamps per status transition (NULL until reached)
  sentToRepairAt        DateTime? @map("sent_to_repair_at")
  repairedAt            DateTime? @map("repaired_at")
  returnedToCustomerAt  DateTime? @map("returned_to_customer_at")
  cancelledAt           DateTime? @map("cancelled_at")
  replacedAt            DateTime? @map("replaced_at")

  estimatedCost  Decimal?    @map("estimated_cost") @db.Decimal(12, 2)
  actualCost     Decimal?    @map("actual_cost") @db.Decimal(12, 2)
  payer          RepairPayer @default(SHOP)

  // Auto-created draft document linkage (one of these per non-SUPPLIER_CLAIM ticket)
  expenseDocumentId  String? @unique @map("expense_document_id")
  otherIncomeId      String? @unique @map("other_income_id")

  // REPLACED outcome — link to defect-exchange record
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

/// Audit log per status transition.
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

### Existing model changes (additive only)

```prisma
model Supplier {
  // existing fields preserved
  isRepairCenter Boolean        @default(false) @map("is_repair_center")
  repairTickets  RepairTicket[] @relation("RepairCenterTickets")
}

model DefectExchange {
  // existing fields preserved
  originRepairTicketId String? @map("origin_repair_ticket_id")  // back-ref when created via repair-ticket replace flow
  // Note: RepairTicket.defectExchangeId is the forward FK; this is for traceability of bypass origin
}

// ExpenseType enum (existing — PR1 grep current values, append at end)
enum ExpenseType {
  // ... existing values preserved
  REPAIR_SERVICE  // new — auto-routes to SHOP repair expense account via REPAIR_EXPENSE_ACCOUNT_CODE
}
```

### SystemConfig keys (new)

| Key | Default | Notes |
|---|---|---|
| `REPAIR_EXPENSE_ACCOUNT_CODE` | SHOP chart code for "ค่าซ่อม" | Audit SHOP CoA in PR1 — if account missing, add via same migration |
| `REPAIR_INCOME_ACCOUNT_CODE` | SHOP chart code for "รายได้บริการซ่อม" | Same |

**Audit dependency**: PR1 must verify SHOP CoA has both accounts. If not, migration adds them. Owner sign-off required on chosen codes.

## State Machine

### Transition matrix

| From → To | OPEN | IN_PROGRESS | READY_FOR_PICKUP | CLOSED | REPLACED | CANCELLED |
|---|---|---|---|---|---|---|
| **OPEN** | — | ✓ `send` | ✗ | ✗ | ✓ `replace` | ✓ `cancel` |
| **IN_PROGRESS** | ✗ | — | ✓ `markRepaired` | ✗ | ✓ `replace` | ✓ `cancel` |
| **READY_FOR_PICKUP** | ✗ | ✓ `sendBack` (QC fail) | — | ✓ `returnToCustomer` | ✓ `replace` | ✓ `cancel` |
| **CLOSED / REPLACED / CANCELLED** | — | — | — | — | — | — (terminal) |

Every transition writes 1 row to `RepairStatusLog` atomically via `$transaction`.

### Required fields + side effects per transition

| Transition | Required input | Side effects |
|---|---|---|
| `create()` → OPEN | `customerId`, `defectDescription`, `branchId` | Gen ticketNumber via `DocNumberService.next('RT')`; detect warrantyStatus; insert status log |
| `send()` OPEN → IN_PROGRESS | `repairSupplierId` (must have `isRepairCenter=true`) | Optional: `externalClaimNo`, `estimatedCost`; `sentToRepairAt` defaults to now |
| `markRepaired()` IN_PROGRESS → READY_FOR_PICKUP | `actualCost`, `payer` | `repairedAt` defaults to now |
| `sendBack()` READY_FOR_PICKUP → IN_PROGRESS | `note` (min 5 chars — QC fail reason) | Clears `repairedAt` |
| `returnToCustomer()` READY_FOR_PICKUP → CLOSED | (no input) | Auto-create draft ExpenseDoc (SHOP) OR OtherIncome (CUSTOMER) OR none (SUPPLIER_CLAIM); link back to ticket |
| `replace()` any non-terminal → REPLACED | `defectExchangeId` (must exist + customer match) | Link defectExchangeId |
| `cancel()` any non-terminal → CANCELLED | `note` (min 5 chars — reason) | No JE doc |

### Concurrency control

All transitions use CAS pattern:
```ts
const updated = await tx.repairTicket.updateMany({
  where: { id, status: <fromStatus>, deletedAt: null },
  data: { status: <toStatus>, <timestamp field>: now },
});
if (updated.count === 0) throw new ConflictException('สถานะถูกเปลี่ยนไปแล้ว');
```

Idempotency: auto-doc creation uses `metadata.flow = 'repair-ticket-close' + repairTicketId` AND `@unique` on FK fields → double defense.

### Role-based permissions

| Action | Roles |
|---|---|
| `create`, `send`, `markRepaired`, `returnToCustomer`, `sendBack`, `recalcWarranty` | SALES, BRANCH_MANAGER, OWNER |
| `cancel`, `replace`, `delete (soft)` | BRANCH_MANAGER, OWNER |
| `bypassWindowCheck=true` on `/defect-exchange` POST | BRANCH_MANAGER, OWNER only |
| `view` (list + detail) | All authenticated; BranchGuard applies (SALES/BM see own branch; OWNER/ACC/FM cross-branch) |

### Warranty status detection

```ts
function detectWarrantyStatus({ contractId, productId }): WarrantyStatus {
  if (!contractId && !productId) return 'WALK_IN';

  const contract = contractId ? await loadContract() : null;
  const product = productId ? await loadProduct() : null;

  if (contract?.deviceReceivedAt && daysSince(contract.deviceReceivedAt) <= 7) {
    return 'IN_7DAY_DEFECT';   // banner: "ใช้ /defect-exchange แทน?"
  }
  if (contract?.shopWarrantyEndDate && contract.shopWarrantyEndDate > now()) {
    return 'IN_SHOP_WARRANTY';
  }
  if (product?.warrantyExpireDate && product.warrantyExpireDate > now()) {
    return 'IN_MANUFACTURER';
  }
  return 'OUT_OF_WARRANTY';
}
```

Default payer inference (override-able at `markRepaired` time):
```ts
function defaultPayer(ws: WarrantyStatus): RepairPayer {
  if (ws === 'OUT_OF_WARRANTY' || ws === 'WALK_IN') return 'CUSTOMER';
  return 'SHOP';
}
```

## API Surface

Base path: `/api/repair-tickets`
Module: `apps/api/src/modules/repair-tickets/`
Global guards: `JwtAuthGuard`, `RolesGuard`, `BranchGuard`

| Method | Path | Roles | Purpose |
|---|---|---|---|
| `POST` | `/repair-tickets` | SALES, BM, OWNER | Create (status=OPEN) — auto-detect warrantyStatus |
| `GET` | `/repair-tickets` | all (branch-scoped) | List + filter (`status`, `customerId`, `branchId`, `repairSupplierId`, `q`, `from`, `to`, `page`, `limit`) |
| `GET` | `/repair-tickets/:id` | all (branch-scoped) | Detail + statusLogs[] + linkedDocs |
| `PATCH` | `/repair-tickets/:id` | SALES, BM, OWNER (OPEN only) | Edit non-status fields |
| `POST` | `/repair-tickets/:id/send` | SALES, BM, OWNER | OPEN → IN_PROGRESS |
| `POST` | `/repair-tickets/:id/mark-repaired` | SALES, BM, OWNER | IN_PROGRESS → READY_FOR_PICKUP |
| `POST` | `/repair-tickets/:id/send-back` | SALES, BM, OWNER | READY_FOR_PICKUP → IN_PROGRESS (QC fail) |
| `POST` | `/repair-tickets/:id/return-to-customer` | SALES, BM, OWNER | READY_FOR_PICKUP → CLOSED + auto-create draft doc |
| `POST` | `/repair-tickets/:id/cancel` | BM, OWNER | any non-terminal → CANCELLED |
| `POST` | `/repair-tickets/:id/replace` | BM, OWNER | any non-terminal → REPLACED. Body: `{ defectExchangeId }` (must already exist + customer match). Typically called server-side by `defect-exchange.create()` when `bypassWindowCheck=true` — see flow below. |
| `POST` | `/repair-tickets/:id/recalc-warranty` | SALES, BM, OWNER | Re-detect (OPEN only) |
| `GET` | `/repair-tickets/:id/status-logs` | all (branch-scoped) | Subset of detail |
| `DELETE` | `/repair-tickets/:id` | OWNER | Soft delete (CANCELLED only) |

### Defect-exchange bypass endpoint (additive)

`POST /api/defect-exchange` — additive optional fields:

```ts
class CreateDefectExchangeDto {
  // ... existing fields
  bypassWindowCheck?: boolean;       // default false
  originRepairTicketId?: string;     // required when bypass=true
}
```

Guards on bypass path:
1. Role must be OWNER or BRANCH_MANAGER (SALES still allowed on normal path)
2. `originRepairTicketId` must exist + not deleted + status ∈ [OPEN, IN_PROGRESS, READY_FOR_PICKUP]
3. `RepairTicket.customerId` must equal `defectExchange.customerId`
4. AuditLog: action=`DEFECT_EXCHANGE_WINDOW_BYPASSED`, entity=`defect_exchange`, newValue=`{originRepairTicketId, warrantyStatus}`
5. Skip the existing 7-day eligibility check; rest of create logic (transferred credit calc, new contract creation) unchanged

Existing defect-exchange tests must remain green; new test suite covers the 5 bypass cases.

### Replace flow (atomic across two modules)

When `defect-exchange.create()` is called with `bypassWindowCheck=true` + `originRepairTicketId`, within the same `$transaction`:

1. Skip 7-day eligibility check
2. Set `defectExchange.originRepairTicketId` (back-ref)
3. Create defect-exchange row (existing logic: transferred credit, new contract)
4. Call `RepairTicketService.markReplaced(originRepairTicketId, newDefectExchangeId, tx)` which:
   - CAS guards `RepairTicket.status ∈ [OPEN, IN_PROGRESS, READY_FOR_PICKUP]` → REPLACED
   - Sets `RepairTicket.defectExchangeId` (forward FK)
   - Sets `RepairTicket.replacedAt`
   - Inserts RepairStatusLog + audit row `REPAIR_TICKET_REPLACED`
   - Inserts audit row `DEFECT_EXCHANGE_WINDOW_BYPASSED`

The standalone `POST /repair-tickets/:id/replace` endpoint exists for symmetry (e.g., admin recovering a partial state) but the canonical flow is FE → `POST /defect-exchange` (with bypass + origin) → atomic dual update. UI implements only the canonical flow; the standalone endpoint is OWNER-only and not exposed in the sidebar.

## UI Flow

### Routes (apps/web/src/App.tsx)

```ts
const InsurancePage = lazy(() => import('@/pages/InsurancePage'));
const CreateRepairTicketPage = lazy(() => import('@/pages/insurance/CreateRepairTicketPage'));
const RepairTicketDetailPage = lazy(() => import('@/pages/insurance/RepairTicketDetailPage'));

// Routes (replaces the redirect stub):
<Route path="/insurance" element={<ProtectedRoute roles={['OWNER','BM','FM','SALES']}><InsurancePage /></ProtectedRoute>} />
<Route path="/insurance/new" element={<ProtectedRoute roles={['OWNER','BM','SALES']}><CreateRepairTicketPage /></ProtectedRoute>} />
<Route path="/insurance/:id" element={<ProtectedRoute roles={['OWNER','BM','FM','SALES','ACCOUNTANT']}><RepairTicketDetailPage /></ProtectedRoute>} />
```

### `/insurance` (list)

- PageHeader: title "รับซ่อม/รับประกัน" + CTA "+ รับเครื่องใหม่" → /insurance/new
- Status filter chips with counts (ทั้งหมด / รับเข้า / กำลังซ่อม / รอลูกค้ารับ / คืนแล้ว / เปลี่ยนแล้ว / ยกเลิก)
- Filters row: search (ticketNumber/customer/IMEI), branch dropdown, supplier dropdown
- Table columns: ticketNumber, customer.name, device, defectDescription (truncated), status badge, actualCost, createdAt
- Aging colored borders: OPEN >3d = orange / IN_PROGRESS >14d = red / READY_FOR_PICKUP >7d = purple
- Empty state with create CTA
- Standard QueryBoundary error handling

### `/insurance/new` (create)

- 5-step single-page form using `react-hook-form` + `zod` (pattern from PR #444+ POS/Customer forms)
- Step 1: customer picker (toggle ลูกค้าเก่า [autocomplete] / walk-in [inline create])
- Step 2: device picker (contract / product stock / free-text)
- Live warranty badge (client-side preview + server confirm on submit)
- "ใช้ /defect-exchange แทน" CTA when IN_7DAY_DEFECT
- Step 3: defectDescription textarea (min 5 chars)
- Step 4: estimatedCost (optional)
- Step 5: repairSupplier (optional at create — can fill on `send`)
- Submit creates ticket in OPEN status → redirect to /insurance/:id

### `/insurance/:id` (detail)

Two-column layout:

Left (60%):
- Customer card (name, phone, optional contract link)
- Device card (brand/model/imei/serial + warranty badge with days remaining)
- Defect description
- Repair vendor card (supplier + claim no)
- Action button row (visibility per status — see matrix below)

Right (40%):
- Timeline of RepairStatusLog rows (chronological, with note and changed-by)
- Linked docs section (ExpenseDoc / OtherIncome / DefectExchange links with status badge)

### Action button visibility by status

| Status | Visible actions |
|---|---|
| OPEN | `[ส่งซ่อม]` `[เปลี่ยนเครื่องแทน]` `[ยกเลิก]` `[แก้ไข]` |
| IN_PROGRESS | `[บันทึกซ่อมเสร็จ]` `[เปลี่ยนเครื่องแทน]` `[ยกเลิก]` |
| READY_FOR_PICKUP | `[ลูกค้ารับเครื่อง]` `[ส่งซ่อมต่อ (QC fail)]` `[เปลี่ยนเครื่องแทน]` `[ยกเลิก]` |
| CLOSED, REPLACED, CANCELLED | (no actions — terminal) |

All actions use `ConfirmDialog`. `returnToCustomer` dialog includes preview text "จะสร้างเอกสารร่าง [ExpenseDoc/OtherIncome] อัตโนมัติ". `replace` action navigates to `/defect-exchange/new?originRepairTicketId=:id&bypassWindow=true` (form is pre-filled with customer + showing "Window bypass" banner). On successful defect-exchange creation, the backend atomically transitions the source repair-ticket to REPLACED (see "Replace flow" in Section "API Surface"); FE then redirects back to the repair-ticket detail page which now shows the linked defect-exchange.

### Sidebar menu update (`apps/web/src/config/menu.ts`)

- Existing "รับประกัน/ส่งซ่อม" label → "**รับซ่อม/รับประกัน**"
- Icon: `Wrench` → `ShieldCheck`
- Path unchanged (`/insurance`) — page itself is replaced
- All 5 roles that had this menu item continue to have it (SALES + BM + FM + ACC + OWNER)

## Auto-document Creation

On `returnToCustomer` (READY_FOR_PICKUP → CLOSED), within `$transaction`:

| `payer` value | Action | Account routing |
|---|---|---|
| `SHOP` | Create `ExpenseDocument` draft (type=`REPAIR_SERVICE`, vendor=repairSupplier, amount=actualCost) | Dr `REPAIR_EXPENSE_ACCOUNT_CODE` / Cr A/P-supplier (existing template) |
| `CUSTOMER` | Create `OtherIncome` draft (account=`REPAIR_INCOME_ACCOUNT_CODE`, counterparty=customer.name, amount=actualCost) | Dr Cash / Cr REPAIR_INCOME_ACCOUNT_CODE (existing template) |
| `SUPPLIER_CLAIM` | No doc created | None — physical claim handled outside accounting |

Both docs created with `companyCode='SHOP'`, `status='DRAFT'`, `metadata={flow:'repair-ticket-close', repairTicketId}`. Accountant reviews + POSTs separately (preserves maker-checker). Ticket stores back-reference FK (`expenseDocumentId` or `otherIncomeId`, `@unique`).

Idempotency: re-call of `returnToCustomer` blocked by CAS guard (status no longer READY_FOR_PICKUP) → no duplicate doc possible. Should auto-doc creation throw mid-tx, the entire transaction rolls back (ticket stays at READY_FOR_PICKUP, no orphan doc).

Reversal of linked doc (via existing module): no auto-rollback of ticket status (customer physically received device — fact does not revert). UI shows "REVERSED" badge on linkedDocs section.

Payer freeze post-CLOSED: editing `payer` after status reaches CLOSED returns 409. To correct, OWNER reverses the original doc via existing module + uses admin endpoint `PATCH /repair-tickets/:id/payer` (audit action `REPAIR_PAYER_CHANGED_POST_CLOSE`, manual recreate of replacement doc required).

## Audit Trail

In addition to `RepairStatusLog` (per-transition row), `AuditService.log` writes to `audit_logs` for:

| Action string | Entity | Payload notes |
|---|---|---|
| `REPAIR_TICKET_CREATED` | `repair_ticket` | newValue = full DTO |
| `REPAIR_TICKET_SENT` | `repair_ticket` | newValue = {repairSupplierId, externalClaimNo, estimatedCost} |
| `REPAIR_TICKET_MARKED_REPAIRED` | `repair_ticket` | newValue = {actualCost, payer} |
| `REPAIR_TICKET_RETURNED` | `repair_ticket` | newValue = {expenseDocumentId, otherIncomeId} |
| `REPAIR_TICKET_REPLACED` | `repair_ticket` | newValue = {defectExchangeId} |
| `REPAIR_TICKET_CANCELLED` | `repair_ticket` | newValue = {note} |
| `REPAIR_TICKET_SENT_BACK` | `repair_ticket` | newValue = {note} |
| `REPAIR_TICKET_EDITED` | `repair_ticket` | oldValue/newValue diff |
| `REPAIR_TICKET_WARRANTY_RECALC` | `repair_ticket` | newValue = {oldStatus, newStatus} |
| `REPAIR_PAYER_CHANGED_POST_CLOSE` | `repair_ticket` | OWNER-only admin override |
| `DEFECT_EXCHANGE_WINDOW_BYPASSED` | `defect_exchange` | newValue = {originRepairTicketId, warrantyStatus} |

`audit_logs.action` remains plain String (no enum) per existing convention.

## Test Strategy

### API unit tests (jest) — `apps/api/src/modules/repair-tickets/__tests__/repair-ticket.service.spec.ts`

Coverage (~30 cases minimum):

- **create()** (8): WALK_IN / IN_7DAY_DEFECT / IN_SHOP_WARRANTY / IN_MANUFACTURER / OUT_OF_WARRANTY warranty detection; default payer inference; ticketNumber format + BKK day reset; BranchGuard cross-branch reject
- **send()** (5): happy path; non-OPEN → 409; missing repairSupplierId → 400; supplier without isRepairCenter → 400; status log atomicity
- **markRepaired()** (4): happy path; Decimal precision (no Number()); payer override; non-IN_PROGRESS → 409
- **returnToCustomer() + auto-doc** (7): payer=SHOP → ExpenseDoc draft created with correct vendor; payer=CUSTOMER → OtherIncome draft with correct account; payer=SUPPLIER_CLAIM → no doc; idempotency under concurrent call; Decimal exact match; full-tx rollback on mid-tx throw; link FK populated
- **sendBack()** (3): READY → IN_PROGRESS; clears repairedAt; note required
- **replace()** (3): defectExchangeId link; customer mismatch → 403; status log
- **cancel()** (3): any non-terminal → CANCELLED; note min 5 chars; no doc created
- **recalcWarranty()** (2): OPEN only; updates correctly
- **findAll()** (5): status filter; branch scope; search; date range; pagination

### Defect-exchange bypass tests (additive to existing module)

- bypassWindowCheck=true without originRepairTicketId → 400
- SALES role with bypass=true → 403
- ticket customer mismatch → 403
- ticket already CLOSED/REPLACED/CANCELLED → 400
- happy path → 7-day check skipped, defect-exchange created, audit row inserted
- Regression: all existing defect-exchange tests still pass (bypass path is additive)

### Web unit tests (vitest) — `apps/web/src/pages/insurance/*.test.tsx`

Coverage (~15 cases):

- List: filter chips render; aging borders applied correctly; debounced search; empty state
- Create form: walk-in vs ลูกค้าเก่า toggle; warranty badge live-update; "/defect-exchange แทน" CTA appears on IN_7DAY_DEFECT; zod validation messages
- Detail: action buttons match status matrix; linkedDocs section renders; timeline sorts desc
- Dialogs: cancel requires note; returnToCustomer shows "จะสร้างเอกสารร่าง" preview

### E2E (Playwright) — `apps/web/e2e/insurance-repair-ticket.spec.ts`

1 happy-path scenario as OWNER: create → send → mark-repaired (SHOP payer) → return-to-customer → assert ExpenseDoc draft exists with matching metadata + ticket detail shows link.

## Migration & Phased Delivery

### Migration `add_repair_ticket_schema` (additive only — safe for `prisma migrate deploy`)

- New tables: `repair_tickets`, `repair_status_logs`
- New column: `suppliers.is_repair_center BOOLEAN DEFAULT false`
- New column: `defect_exchanges.origin_repair_ticket_id` (nullable FK back-ref)
- New enum value: `ExpenseType::REPAIR_SERVICE`
- New SystemConfig rows: `REPAIR_EXPENSE_ACCOUNT_CODE`, `REPAIR_INCOME_ACCOUNT_CODE` (values to be set by PR1 after CoA audit)
- No backfill (no historical data to migrate)

### 5 PR rollout

| PR | Scope | Tests |
|---|---|---|
| **PR 1: Foundation** | Migration + Prisma model + DTOs + SHOP CoA audit + `formatDevice()` helper | Schema diff review; smoke CoA codes exist |
| **PR 2: Backend service + endpoints** | RepairTicketService + Controller + `DocNumberService.next('RT')` integration + auto-doc creation + AuditService integration | ≥30 jest tests |
| **PR 3: Defect-exchange bypass** | Additive `bypassWindowCheck` flag on existing DTO + service guards + 5 new tests | Regression suite must remain green |
| **PR 4: Frontend** | 3 pages + form + dialogs + sidebar update | ≥15 vitest tests |
| **PR 5: E2E + docs** | Happy-path E2E + update `.claude/rules/accounting.md` with REPAIR_SERVICE expense type | E2E green on CI |

PRs are independently deployable. PR1 ships migration ahead of code; PR3 deploys bypass behind absence of UI affordance (only repair-ticket's replace action calls it). 

**Estimated**: 5-7 weeks (matches Option C scope chosen in brainstorm).

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| SHOP CoA missing "ค่าซ่อม" / "รายได้บริการซ่อม" codes | PR1 audits SHOP CoA; if missing, adds in same migration; owner sign-off on chosen codes recorded in `docs/superpowers/specs/2026-05-19-insurance-repair-ticket-design.md` (this doc) before PR1 merge |
| Defect-exchange bypass = elevation path | Role whitelist (OWNER/BM) + audit row + customer FK match check + UI banner on bypassed defect-exchange detail page |
| Auto-doc creation fails mid-tx → orphan state | Full `$transaction` rollback covers ticket status + doc + audit log together |
| User double-clicks "ลูกค้ารับเครื่อง" | CAS (`updateMany` count===1) + `@unique` on FK fields — double defense |
| `prisma db push` denied on local dev DB (per memory note) | Migration is additive; document manual `ALTER TABLE` fallback in PR1 description |
| Stale Prisma client in worktrees | PR1 docs include `npx prisma generate` reminder in dev setup |

## Out of Scope (Future)

- LINE OA auto-notification on status change (Q3 user explicitly passed on this)
- Repair-parts stock tracking (Q2 confirmed: no stock for spare parts)
- Dashboard reports (cost by supplier / by model; aging; repeat-customer flags)
- Customer-facing LIFF page to track ticket status
- Bulk import historical repair records
- Multi-line repair charges (single ticket can have line items via ExpenseDocument lines on doc side, not modeled in ticket itself)
