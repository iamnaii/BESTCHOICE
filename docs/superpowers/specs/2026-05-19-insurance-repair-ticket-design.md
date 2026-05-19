# Insurance / Repair Ticket — SP5 Phase 2

> Promote `/insurance` จาก redirect stub → **unified entry point** สำหรับ "เครื่องมีปัญหา" ทั้งหมด: wizard เลือก flow ให้อัตโนมัติ (เปลี่ยนเครื่อง 7 วัน ↔ ส่งซ่อม) + หน้าเช็คประกัน + full repair-ticket lifecycle (รับเข้า → ส่งซ่อม → ซ่อมเสร็จ → คืนลูกค้า → ปิด/เปลี่ยน/ยกเลิก) พร้อม auto-detect warranty, auto-create draft accounting docs, audit trail per status transition.

**Date**: 2026-05-19 · *Updated 2026-05-20 — unified entry point design (B3 smart-default wizard + warranty-check page)*
**Phase**: SP5 Phase 2 (deferred from Phase 1 — was redirect stub)
**Scope**: Full (Option C from brainstorm) — repair ticketing + supplier claim + customer-paid out-of-warranty + auto JE document drafts + **unified `/insurance` wizard entry + warranty-check lookup page** (2026-05-20 update)
**Out of scope** (Phase 3+): LINE OA auto-notification, repair-parts stock management, repair revenue/cost analytics dashboards, **customer-facing LIFF self-service warranty check** (SALES-facing lookup is in-scope; LIFF version deferred)

## Problem

**3 ปัญหา UX/process ที่ต้องแก้พร้อมกัน:**

1. **ไม่มีระบบบันทึก repair ticket** — `apps/web/src/pages/InsurancePage.tsx` 23 บรรทัด — ทำ `<Navigate to="/defect-exchange" replace />` เท่านั้น. ไม่มีระบบบันทึก:
   - เครื่องที่ลูกค้าส่งซ่อม (อาการเสีย, ที่ซ่อม, วัน, ค่าซ่อม)
   - สถานะระหว่างซ่อม (อยู่ที่ศูนย์ไหน, ค้างกี่วัน, ลูกค้ามารับหรือยัง)
   - ค่าซ่อม → บัญชี SHOP (ไม่ได้ post JE อัตโนมัติ)
   - ประวัติซ่อมต่อลูกค้า/ต่อเครื่อง

2. **2 ประตูเข้าสำหรับปัญหาเดียวกัน** — sidebar มีทั้ง "รับประกัน/ส่งซ่อม" (`/insurance` redirect) และ "เปลี่ยนเครื่องชำรุด" (`/defect-exchange`) แยกกัน. SALES ต้องรู้เองว่าจะกดเมนูไหน:
   - ลูกค้ามา → SALES ต้องคิดว่าเครื่องอายุกี่วัน + อาการตรงเงื่อนไข defect ไหม → ค่อยกดเมนู
   - หลายครั้งกดผิด → ต้องย้อน + อธิบายลูกค้าใหม่
   - `/defect-exchange` ครอบ window แคบ (7 วัน) ไม่ใช่ tool ทั่วไปสำหรับซ่อม

3. **ไม่มีหน้าเช็คประกัน standalone** — ลูกค้าถาม "เครื่องผมยังประกันไหม?" ที่หน้าร้านบ่อย แต่ SALES ต้องเข้าหน้าลูกค้า → หน้าสัญญา → ลึกอย่างน้อย 3 click กว่าจะเห็นข้อมูลประกัน. ไม่มี lookup ด้วย IMEI หรือ contract number ตรงๆ

## Solution overview

**Unified entry point ที่ frontend, แยก modules ที่ backend** (low-risk, additive)

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
- REPLACED outcome → call defect-exchange service ภายในด้วย `bypassWindowCheck=true` (atomic transaction)

**Frontend unification** (2026-05-20 update):
- Sidebar เหลือ 1 menu "รับซ่อม/รับประกัน" → `/insurance` (ลบ "เปลี่ยนเครื่องชำรุด" menu)
- `/insurance/new` = **wizard** ที่ branch ระหว่าง repair-ticket flow ↔ defect-exchange flow ด้วย **smart default** (B3):
  - ลูกค้า≤7 วัน + eligible → default = "เปลี่ยนเครื่องใหม่" + small link "ขอส่งซ่อมแทน"
  - กรณีอื่น → default = "ส่งซ่อม", ไม่มี option defect-exchange (ยกเว้น OWNER/BM bypass ใน repair detail page)
- `/insurance/warranty-check` = standalone lookup page (search by customer/IMEI/contract → display warranty windows + CTA jump เข้า wizard)
- `/defect-exchange*` → 301 redirect ไป `/insurance/new?intent=exchange&...` พร้อม pre-fill context
- Backend `defect-exchange` module **ไม่แตะ** — โค้ดผ่าน production แล้ว ลด risk การ regress

## Architecture

**Approach 1 — standalone module** (chosen over Approach 2 "unified module merge" + Approach 3 "polymorphic table" — additive-only, low-risk, preserves production-tested defect-exchange code)

**Unification at frontend layer only** (2026-05-20): backend modules stay separate; wizard component on FE picks which API to call based on smart-default decision tree.

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
  InsurancePage.tsx                       ← rewrite from stub to real list page (ticket table)
  insurance/
    CreateInsuranceWizardPage.tsx         ← NEW — single wizard branching to repair OR exchange
    WarrantyCheckPage.tsx                 ← NEW — standalone lookup tool
    RepairTicketDetailPage.tsx
    components/
      WarrantyBadge.tsx
      WarrantyWindowCard.tsx              ← NEW — 3-tier badge display (7d / 60d / mfr)
      RepairStatusBadge.tsx
      TimelineEvent.tsx
      WizardSteps/
        CustomerPickerStep.tsx
        DevicePickerStep.tsx
        WarrantyPreviewStep.tsx           ← shows detected status + chosen flow
        DefectDescriptionStep.tsx         ← repair branch
        ExchangeProductPickerStep.tsx     ← exchange branch (re-mounts existing DefectExchangePage form)
  DefectExchangePage.tsx                  ← preserved (used by wizard exchange branch as sub-component;
                                              standalone route /defect-exchange now 301 → wizard)
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
| `GET` | `/repair-tickets/warranty-lookup` | all (branch-scoped) | Standalone warranty lookup (powers `/insurance/warranty-check` page). Query params: `customerId` \| `imei` \| `serial` \| `contractNumber` (at least one required). Returns `{ customer, devices: [{product, contract, warrantyWindows: {sevenDayDefect, shopWarranty, mfrWarranty}, eligibility: {forExchange, forRepair}}] }` |
| `GET` | `/repair-tickets/warranty-preview` | SALES, BM, OWNER | Pre-submit preview used by wizard step 3. Query params: `customerId`, `contractId?`, `productId?`. Returns `{ warrantyStatus, defaultFlow: 'repair'\|'exchange', defaultPayer, daysRemaining }` |

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

**Canonical trigger**: User clicks `[ซ่อมไม่ได้ — ออกใหม่]` on RepairTicketDetail (OWNER/BM only) → wizard opens at `/insurance/new?intent=exchange&originRepairTicketId=X&bypassWindow=true` → wizard skips Step 3 + locks Step 2 → user picks replacement device + reason → submits.

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

The standalone `POST /repair-tickets/:id/replace` endpoint exists for symmetry (e.g., admin recovering a partial state) but is **not exposed in the sidebar or wizard** — canonical flow is FE wizard → `POST /defect-exchange` (with bypass + origin) → atomic dual update. The standalone endpoint is OWNER-only and used only for emergency recovery.

## UI Flow

### Routes (apps/web/src/App.tsx)

```ts
const InsurancePage = lazy(() => import('@/pages/InsurancePage'));
const CreateInsuranceWizardPage = lazy(() => import('@/pages/insurance/CreateInsuranceWizardPage'));
const WarrantyCheckPage = lazy(() => import('@/pages/insurance/WarrantyCheckPage'));
const RepairTicketDetailPage = lazy(() => import('@/pages/insurance/RepairTicketDetailPage'));
const DefectExchangePage = lazy(() => import('@/pages/DefectExchangePage')); // kept for 301-redirect target only

// Routes (replaces the redirect stub):
<Route path="/insurance" element={<ProtectedRoute roles={['OWNER','BM','FM','SALES']}><InsurancePage /></ProtectedRoute>} />
<Route path="/insurance/new" element={<ProtectedRoute roles={['OWNER','BM','SALES']}><CreateInsuranceWizardPage /></ProtectedRoute>} />
<Route path="/insurance/warranty-check" element={<ProtectedRoute roles={['OWNER','BM','FM','SALES','ACCOUNTANT']}><WarrantyCheckPage /></ProtectedRoute>} />
<Route path="/insurance/:id" element={<ProtectedRoute roles={['OWNER','BM','FM','SALES','ACCOUNTANT']}><RepairTicketDetailPage /></ProtectedRoute>} />

// Legacy redirect — keep URL working for bookmarks/external links
// Use a small wrapper component to preserve any existing search params (e.g. ?contractId=X)
// when forwarding to the wizard's exchange intent.
<Route path="/defect-exchange" element={<DefectExchangeRedirect />} />
<Route path="/defect-exchange/*" element={<DefectExchangeRedirect />} />

// where:
function DefectExchangeRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('intent', 'exchange');
  return <Navigate to={`/insurance/new?${params.toString()}`} replace />;
}
```

### `/insurance` (list)

- PageHeader: title "รับซ่อม/รับประกัน" + CTAs `[+ รับเครื่องใหม่]` → `/insurance/new` and `[เช็คประกัน]` → `/insurance/warranty-check`
- Status filter chips with counts (ทั้งหมด / รับเข้า / กำลังซ่อม / รอลูกค้ารับ / คืนแล้ว / เปลี่ยนแล้ว / ยกเลิก)
- Filters row: search (ticketNumber/customer/IMEI), branch dropdown, supplier dropdown
- Table columns: ticketNumber, customer.name, device, defectDescription (truncated), status badge, actualCost, createdAt
- Aging colored borders: OPEN >3d = orange / IN_PROGRESS >14d = red / READY_FOR_PICKUP >7d = purple
- Empty state with create CTA
- Standard QueryBoundary error handling

### `/insurance/new` (wizard — unified entry point)

Single-page wizard using `react-hook-form` + `zod` + step state in URL search params (so back-button works correctly):

**Step 1: Customer**
- Toggle: ลูกค้าเก่า (autocomplete พิมพ์ชื่อ/เบอร์) / walk-in (inline create — name + phone required)
- If `?customerId=` query param → auto-select + skip toggle UI

**Step 2: Device**
- Tabs: contract (ลูกค้าเก่า), product stock (walk-in), free-text fallback
- If `?productId=` or `?contractId=` → auto-select + skip tab UI

**Step 3: Warranty preview (server)**
- Call `GET /repair-tickets/warranty-preview?customerId=&contractId?=&productId?=`
- Display: 3 warranty windows (7-day defect / shop 60-day / mfr) with days remaining + colored badges via `WarrantyWindowCard`
- Display: detected `warrantyStatus` + smart-default `defaultFlow` ("เปลี่ยนเครื่องใหม่" or "ส่งซ่อม")
- **Smart default routing (B3)**:
  - `warrantyStatus = IN_7DAY_DEFECT` + exchange-eligible → default flow = `exchange`. Show small inline link `[ขอส่งซ่อมแทน]` ที่ override → flow = `repair`
  - ทุกกรณีอื่น → default flow = `repair`. **ไม่มี option exchange** ใน wizard (ยกเว้น OWNER/BM bypass via repair detail page action `[ซ่อมไม่ได้ — ออกใหม่]`)
  - User can click the chosen-flow card to confirm before continuing (prevents accidental commits)

**Step 4: Branch-specific form**
- **Repair flow** (creates RepairTicket):
  - defectDescription textarea (min 5 chars)
  - estimatedCost (optional)
  - repairSupplier (optional at create — can fill on `send` later)
  - Submit → `POST /repair-tickets` → redirect `/insurance/:id`
- **Exchange flow** (creates DefectExchange):
  - Re-mounts existing DefectExchangePage form as sub-component (no rewrite of form internals)
  - New device picker (eligible products from current stock)
  - defectReason + notes
  - Transferred credit preview (read-only — computed by existing service)
  - Submit → `POST /defect-exchange` (no bypass — natural 7-day window) → redirect contract detail page (existing behavior)

**Step navigation**
- Linear with progress indicator (Customer → Device → Warranty → Form)
- Back button preserves entered data (form state in URL params + react-hook-form persistence)
- "เริ่มใหม่" CTA on every step → clear state + return to Step 1

### `/insurance/warranty-check` (standalone lookup)

**Use case**: SALES at counter, customer asks "เครื่องผมยังประกันไหม?" — no commitment to creating a ticket.

**Search input** (single field with mode toggle):
- Mode: ลูกค้า — autocomplete by ชื่อ/เบอร์ (calls existing customer search endpoint)
- Mode: IMEI/Serial — exact match lookup
- Mode: เลขสัญญา — exact match contract number lookup

**Result display** (per device):
```
[brand model] · IMEI: xxx · ลูกค้า: ชื่อ
─────────────────────────────────────
🟢 รับเครื่อง 7 วัน      เหลือ 3 วัน    (deviceReceivedAt + 7)
🟢 ประกันร้าน 60 วัน     เหลือ 23 วัน   (shopWarrantyEndDate)
🟢 ประกันศูนย์ 1 ปี      เหลือ 287 วัน  (product.warrantyExpireDate)
─────────────────────────────────────
[+ ส่งซ่อม]  [+ เปลี่ยนเครื่อง*]
* [+ เปลี่ยนเครื่อง] appears only when eligibility.forExchange = true
```

- 3 warranty windows shown side-by-side. Each window: green (>30% remaining) / yellow (≤30%) / red (expired)
- ลูกค้าหลาย device → list ทั้งหมด, expand/collapse per device
- CTAs jump เข้า wizard `/insurance/new?customerId=X&productId=Y&intent=repair|exchange` พร้อม pre-fill (skip Steps 1+2)
- ไม่ commit อะไรเอง — pure read-only lookup
- Roles: ทุก authenticated, branch-scoped (เหมือน lookup endpoints อื่น). ACCOUNTANT/FM read-only — ไม่เห็นปุ่ม CTA

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
| OPEN | `[ส่งซ่อม]` `[ซ่อมไม่ได้ — ออกใหม่]` `[ยกเลิก]` `[แก้ไข]` |
| IN_PROGRESS | `[บันทึกซ่อมเสร็จ]` `[ซ่อมไม่ได้ — ออกใหม่]` `[ยกเลิก]` |
| READY_FOR_PICKUP | `[ลูกค้ารับเครื่อง]` `[ส่งซ่อมต่อ (QC fail)]` `[ซ่อมไม่ได้ — ออกใหม่]` `[ยกเลิก]` |
| CLOSED, REPLACED, CANCELLED | (no actions — terminal) |

All actions use `ConfirmDialog`. `returnToCustomer` dialog includes preview text "จะสร้างเอกสารร่าง [ExpenseDoc/OtherIncome] อัตโนมัติ".

**`[ซ่อมไม่ได้ — ออกใหม่]` button** (renamed from `[เปลี่ยนเครื่องแทน]`):
- Visible to OWNER/BM only
- ConfirmDialog: "เครื่องนี้ซ่อมไม่ได้ — จะออกเครื่องใหม่ทดแทน. ระบบจะข้าม window 7 วัน (เพราะถือว่าเป็นความรับผิดของร้าน)"
- Navigates to `/insurance/new?intent=exchange&originRepairTicketId=:id&bypassWindow=true` — wizard pre-fills customer + new device picker, shows "Window bypass approved" banner, skips warranty-preview step
- On successful exchange creation, backend atomically transitions source repair-ticket → REPLACED (see "Replace flow" in API Surface section). FE redirects to repair-ticket detail page (now shows linked defect-exchange + REPLACED badge).

### Sidebar menu update (`apps/web/src/config/menu.ts`)

**Before** (2 entries):
- "รับประกัน/ส่งซ่อม" → `/insurance` (redirect)
- "เปลี่ยนเครื่องชำรุด" → `/defect-exchange`

**After** (1 entry, with submenu):
- "**รับซ่อม/รับประกัน**" (icon: `ShieldCheck`) → parent collapsible
  - "รายการ ticket" → `/insurance`
  - "เช็คประกัน" → `/insurance/warranty-check`

Notes:
- Remove "เปลี่ยนเครื่องชำรุด" menu item entirely (URL still resolves via 301 redirect)
- All 5 roles that previously had "รับประกัน/ส่งซ่อม" (SALES + BM + FM + ACC + OWNER) keep the new parent menu
- "เช็คประกัน" sub-item visible to same 5 roles (read-only for ACC/FM by hiding CTA buttons in result card)

## Wizard Decision Tree

`/insurance/new` wizard branches in Step 3 (Warranty preview) based on server-computed `warrantyStatus` + business eligibility rules. Decision logic lives **server-side** (in `RepairTicketService.previewWarranty`) — wizard is a thin shell that calls the endpoint and renders the result; FE never re-implements rules.

### `GET /repair-tickets/warranty-preview` response shape

```ts
type WarrantyPreviewResponse = {
  warrantyStatus: WarrantyStatus;     // existing enum
  defaultFlow: 'repair' | 'exchange'; // smart-default suggestion
  alternativeFlow: 'repair' | null;   // shown as override link when defaultFlow=exchange
  defaultPayer: RepairPayer;          // pre-fills repair flow if chosen
  daysRemaining: {
    sevenDayDefect: number | null;   // null = N/A (no contract / no deviceReceivedAt)
    shopWarranty: number | null;
    mfrWarranty: number | null;
  };
  eligibility: {
    forExchange: boolean;            // contract + ≤7d + product PHONE_USED + status ACTIVE
    forRepair: boolean;              // always true (any device can be sent for repair)
  };
  blockingReasons?: string[];        // human-readable Thai reasons if both flows ineligible
};
```

### Smart-default rules (Step 3 of wizard)

| Condition | `defaultFlow` | `alternativeFlow` | UI Behavior |
|---|---|---|---|
| `warrantyStatus = IN_7DAY_DEFECT` AND `eligibility.forExchange = true` | `'exchange'` | `'repair'` | Show big card "เปลี่ยนเครื่องใหม่" (selected by default) + small link "ขอส่งซ่อมแทน" |
| Anything else | `'repair'` | `null` | Show single card "ส่งซ่อม" (selected by default), no exchange option |
| Both `forExchange = false` AND `forRepair = false` (impossible by current rules, but guard) | n/a | n/a | Show error card with `blockingReasons[]` + "ติดต่อ admin" link |

### Why server-side decision

1. **Source of truth** — `detectWarrantyStatus()` already exists in `RepairTicketService`; wizard reuses same function via the preview endpoint, no risk of FE/BE drift
2. **Audit** — every wizard load logs the preview call (auditable: which `warrantyStatus` did SALES see when deciding)
3. **Performance** — single round-trip vs 3 separate API calls (contract + product + customer)
4. **Future LIFF** — same endpoint can serve customer self-service version (Phase 3+) without re-implementing rules

### Override path (`/insurance/new?intent=exchange&originRepairTicketId=...&bypassWindow=true`)

When user enters wizard from RepairTicketDetail `[ซ่อมไม่ได้ — ออกใหม่]` action:
- `bypassWindow=true` query param sets server-side flag `bypassWindowCheck=true` on the eventual `POST /defect-exchange` call
- Wizard skips Step 3 (warranty preview unnecessary — bypass already authorized)
- Step 2 (device picker) pre-locked to current contract/product from origin ticket
- Banner shown: "Window 7 วันได้รับการอนุมัติให้ผ่าน (OWNER/BM)"
- Role guard: param ignored if user role is not OWNER/BM (reverts to normal flow)

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
| `WARRANTY_LOOKED_UP` | `repair_ticket` | newValue = {searchMode, query, resultCount} — PDPA traceability for `/insurance/warranty-check` and wizard preview calls. **Async** (does not block response). Throttled per-user to 200/hr to prevent log spam. |

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
- **warrantyPreview()** (6): WALK_IN preview; IN_7DAY_DEFECT → defaultFlow=exchange + alternativeFlow=repair; IN_SHOP_WARRANTY → defaultFlow=repair + alternativeFlow=null; OUT_OF_WARRANTY → defaultPayer=CUSTOMER; missing inputs → 400; daysRemaining math correctness across timezone boundaries
- **warrantyLookup()** (5): customer search returns all devices; IMEI exact match; contract number lookup; not-found returns 404 with Thai message; branch scope enforcement (SALES cross-branch → empty result)

### Defect-exchange bypass tests (additive to existing module)

- bypassWindowCheck=true without originRepairTicketId → 400
- SALES role with bypass=true → 403
- ticket customer mismatch → 403
- ticket already CLOSED/REPLACED/CANCELLED → 400
- happy path → 7-day check skipped, defect-exchange created, audit row inserted
- Regression: all existing defect-exchange tests still pass (bypass path is additive)

### Web unit tests (vitest) — `apps/web/src/pages/insurance/*.test.tsx`

Coverage (~24 cases total, split across PRs 4a/4b/4c):

**PR 4a (list + detail):**
- List: filter chips render; aging borders applied correctly; debounced search; empty state
- Detail: action buttons match status matrix; linkedDocs section renders; timeline sorts desc
- Dialogs: cancel requires note; returnToCustomer shows "จะสร้างเอกสารร่าง" preview; `[ซ่อมไม่ได้ — ออกใหม่]` dialog visible to OWNER/BM only

**PR 4b (wizard):**
- Wizard step navigation: forward/back preserves form state; "เริ่มใหม่" clears state
- Step 1 customer: walk-in inline create + autocomplete + `?customerId=` pre-fill
- Step 2 device: contract/product/free-text tabs + `?productId=` pre-fill
- Step 3 smart-default rendering:
  - `IN_7DAY_DEFECT + forExchange=true` → "เปลี่ยนเครื่องใหม่" card selected + override link visible
  - `OUT_OF_WARRANTY` → "ส่งซ่อม" card selected, no exchange option
  - Both ineligible → blocking reasons displayed
- Override link click → flow switches to repair
- Step 4 repair form: zod validation; required fields enforced
- Step 4 exchange form: mounts DefectExchangePage sub-component correctly
- Bypass query path: `bypassWindow=true` + non-OWNER role → bypass ignored

**PR 4c (warranty-check):**
- Search mode toggle (customer / IMEI / contract number)
- Result card displays 3 warranty windows with correct day-remaining colors (green/yellow/red)
- CTA `[+ ส่งซ่อม]` always visible if `eligibility.forRepair = true`
- CTA `[+ เปลี่ยนเครื่อง]` only when `eligibility.forExchange = true`
- ACCOUNTANT/FM role → CTAs hidden (read-only mode)
- CTA click → navigates to wizard with correct query params
- Empty state when no match found

### E2E (Playwright) — `apps/web/e2e/insurance-*.spec.ts`

3 happy-path scenarios as OWNER:

1. `insurance-wizard-repair.spec.ts` — wizard → enter customer + walk-in device + defect description → repair-ticket created → send → mark-repaired (SHOP payer) → return-to-customer → assert ExpenseDoc draft exists with matching metadata + ticket detail shows link.

2. `insurance-wizard-exchange.spec.ts` — wizard → enter customer (existing contract with `deviceReceivedAt = today - 2 days`) → Step 3 shows "เปลี่ยนเครื่องใหม่" default → pick new device → submit → assert DefectExchange created with `originRepairTicketId = null` (natural window, no bypass).

3. `insurance-warranty-check.spec.ts` — open warranty-check page → search by IMEI → assert 3 warranty windows displayed with correct days-remaining → click "+ ส่งซ่อม" CTA → wizard opens with customer + product pre-filled.

Regression: existing `defect-exchange.spec.ts` E2E (if any) must remain green via the redirect path.

## Migration & Phased Delivery

### Migration `add_repair_ticket_schema` (additive only — safe for `prisma migrate deploy`)

- New tables: `repair_tickets`, `repair_status_logs`
- New column: `suppliers.is_repair_center BOOLEAN DEFAULT false`
- New column: `defect_exchanges.origin_repair_ticket_id` (nullable FK back-ref)
- New enum value: `ExpenseType::REPAIR_SERVICE`
- New SystemConfig rows: `REPAIR_EXPENSE_ACCOUNT_CODE`, `REPAIR_INCOME_ACCOUNT_CODE` (values to be set by PR1 after CoA audit)
- No backfill (no historical data to migrate)

### 7 PR rollout (updated 2026-05-20 — split frontend due to wizard + warranty-check additions)

| PR | Scope | Tests |
|---|---|---|
| **PR 1: Foundation** | Migration + Prisma model + DTOs + SHOP CoA audit + `formatDevice()` helper | Schema diff review; smoke CoA codes exist |
| **PR 2: Backend service + endpoints** | RepairTicketService + Controller + `DocNumberService.next('RT')` integration + auto-doc creation + AuditService integration | ≥30 jest tests |
| **PR 3: Defect-exchange bypass + warranty endpoints** | Additive `bypassWindowCheck` flag on existing defect-exchange DTO + service guards + **new `GET /repair-tickets/warranty-lookup` + `GET /repair-tickets/warranty-preview` endpoints** | Regression suite green + ≥10 new tests for warranty endpoints |
| **PR 4a: Frontend — list + detail + sidebar** | InsurancePage (list) + RepairTicketDetailPage + sidebar consolidation + 301 redirect from `/defect-exchange*` | ≥8 vitest tests |
| **PR 4b: Frontend — wizard** | CreateInsuranceWizardPage (4 steps) + WizardSteps components + form persistence + `intent=exchange` query handling + bypass override path | ≥10 vitest tests (smart-default routing matrix + step navigation + bypass path) |
| **PR 4c: Frontend — warranty-check** | WarrantyCheckPage + WarrantyWindowCard component + 3 search modes + CTA jump-to-wizard | ≥6 vitest tests (each search mode + empty state + role-based CTA hiding) |
| **PR 5: E2E + docs** | 2 happy-path E2E specs (wizard → repair-ticket close; wizard → defect-exchange close) + 1 warranty-check E2E + update `.claude/rules/accounting.md` with REPAIR_SERVICE expense type | E2E green on CI |

**Dependency graph**:
- PR 1 → PR 2 (schema must land before service code)
- PR 2 → PR 3 (warranty endpoints reuse PR2's `detectWarrantyStatus` extraction)
- PR 3 → PR 4a/4b/4c (frontend depends on warranty + bypass endpoints)
- PR 4a, 4b, 4c can ship **in parallel** (different files, no overlap)
- PR 5 last (E2E needs all UI shipped)

PRs are independently deployable; FE PRs gate on PR 3 endpoint availability. PR1 ships migration ahead of code; PR3 deploys bypass behind absence of UI affordance (only wizard + repair-ticket's `[ซ่อมไม่ได้ — ออกใหม่]` action calls it).

**Estimated**: 7-9 weeks (vs original 5-7 weeks — +2 weeks for wizard component + warranty-check page split).

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| SHOP CoA missing "ค่าซ่อม" / "รายได้บริการซ่อม" codes | PR1 audits SHOP CoA; if missing, adds in same migration; owner sign-off on chosen codes recorded in `docs/superpowers/specs/2026-05-19-insurance-repair-ticket-design.md` (this doc) before PR1 merge |
| Defect-exchange bypass = elevation path | Role whitelist (OWNER/BM) + audit row + customer FK match check + UI banner on bypassed defect-exchange detail page |
| Auto-doc creation fails mid-tx → orphan state | Full `$transaction` rollback covers ticket status + doc + audit log together |
| User double-clicks "ลูกค้ารับเครื่อง" | CAS (`updateMany` count===1) + `@unique` on FK fields — double defense |
| `prisma db push` denied on local dev DB (per memory note) | Migration is additive; document manual `ALTER TABLE` fallback in PR1 description |
| Stale Prisma client in worktrees | PR1 docs include `npx prisma generate` reminder in dev setup |
| Wizard FE/BE rule drift (smart-default decision computed twice) | All decision logic lives server-side in `warrantyPreview` endpoint; wizard renders endpoint output directly. ESLint rule (custom or code-review) forbids re-implementing `daysSince(deviceReceivedAt) <= 7` check in FE. |
| User bookmarks `/defect-exchange` and breaks workflow | 301 redirect preserves query string + hash → wizard pre-fills as much context as possible. Add deprecation banner to redirected URL: "เมนูนี้ย้ายมาที่ /insurance/new — บันทึก URL ใหม่ได้" |
| Wizard step 3 round-trip slow (mobile/3G branches) | Endpoint must return <300ms p95. Add Sentry transaction monitoring. Show skeleton loader at Step 3 (existing pattern). |
| `/insurance/warranty-check` lookup PII leak risk | Endpoint scoped to authenticated + branch-aware (SALES sees own branch only). Search results truncate national ID / address fields. AuditLog records lookup with `action=WARRANTY_LOOKED_UP` for PDPA traceability. |

## Out of Scope (Future)

- LINE OA auto-notification on status change (Q3 user explicitly passed on this)
- Repair-parts stock tracking (Q2 confirmed: no stock for spare parts)
- Dashboard reports (cost by supplier / by model; aging; repeat-customer flags)
- **Customer-facing LIFF warranty check + ticket tracking** — Phase 3+ will expose `/repair-tickets/warranty-lookup` to LIFF with token auth (deferred per 2026-05-20 brainstorm decision). SALES-facing warranty-check page IS in scope (this iteration).
- Bulk import historical repair records
- Multi-line repair charges (single ticket can have line items via ExpenseDocument lines on doc side, not modeled in ticket itself)
- **Wizard "save draft" feature** — wizard does not persist incomplete form state to DB (Step 3 onward). If user leaves mid-wizard, state is lost. localStorage-based draft recovery (like POS auto-save in PR #444) deferred to follow-up if SALES feedback requests it.
