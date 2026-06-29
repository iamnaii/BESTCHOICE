# Pre-Merge Guard Report

**Branch**: `feat/purchasing-v2-b5`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Review date**: 2026-06-29  
**Compared against**: `origin/main`  
**Commits in branch**: 38 (15 shown below — B0–B5 incremental batch)

---

## Summary of Changes

| Category | Count |
|---|---|
| Files changed | 71 |
| Insertions | +12,926 |
| Deletions | -1,613 |
| TS/TSX files | 62 |

### What this branch delivers

- **B0** — `ORDERED` status + `orderedAt` field on PurchaseOrder; `POST /:id/order` endpoint
- **B1** — Goods Receiving v2 with GR number (`grNumber`), mobile-first Drawer UI, IMEI dup detection
- **B2** — `ReceivingUnitCard` + per-unit checklist/defect UX; `DefectReason` enum in schema
- **B3** — Supplier-direct receive (auto-PO flow): `POST /direct-receive`; `DirectReceiveModal`
- **B4** — QC Center page (`/purchase-orders/qc`): bulk confirm/reject, `POST /qc-reject`, `isDirectReceive` field
- **B5** — AP tab polish + `PurchasingSummaryStrip` KPI cards; `GET /summary` endpoint; `overdueOnly` filter

---

## Issues by Severity

### 🔴 Critical — Must Fix Before Merge (1)

#### C1 · Decimal precision loss in `directReceive` — money written as JS float

**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts:313`

```ts
// WRONG — floating-point arithmetic on money
const totalAmount = dto.items.reduce((s, i) => s + Number(i.unitPrice) * i.quantity, 0);
const po = await tx.purchaseOrder.create({
  data: {
    totalAmount,      // written to Decimal @db.Decimal(12, 2)
    netAmount: totalAmount,
    ...
```

`PurchaseOrder.totalAmount` and `netAmount` are `Decimal @db.Decimal(12, 2)` per `schema.prisma`. JavaScript `Number()` + `+` arithmetic accumulates float errors — e.g., `12999.99 * 3` yields `38999.97000000000003` in JS. For a single-unit receive this is benign, but multi-unit batches with fractional prices produce incorrect COGS and AP balances.

**Fix**: use the project's `dSum` / `d` / `dAdd` utilities from `apps/api/src/utils/decimal.util.ts`:

```ts
import { d, dAdd, dSum } from '../../../utils/decimal.util';
const totalAmount = dto.items.reduce(
  (s, i) => dAdd(s, d(i.unitPrice).mul(i.quantity)),
  d(0),
);
```

`DirectReceiveItemDto.unitPrice` is typed `@IsNumber()` (JS number from client). That is fine for DTO validation; just convert with `d()` before arithmetic.

---

### 🟡 Warning — Should Fix (3)

#### W1 · Missing Thai error messages on new DTO fields

**File**: `apps/api/src/modules/purchase-orders/dto/create-po.dto.ts`

`DirectReceiveItemDto` has 14 decorated fields; only one carries a Thai message (`@Min(0.01, { message: 'กรุณาระบุราคาทุน...' })`). The others (`@IsNumber()`, `@Min(1)`, `@IsIn(['PASS', 'REJECT'])`, `@ArrayMinSize(1)`, etc.) fall back to English class-validator defaults. Project convention (`.claude/rules/backend.md`) requires Thai validation messages on all DTO fields.

Suggested additions:
```ts
@IsNumber({}, { message: 'จำนวนต้องเป็นตัวเลข' }) @Min(1, { message: 'จำนวนต้องมากกว่า 0' }) quantity: number;
@IsIn(['PASS', 'REJECT'], { message: 'สถานะต้องเป็น PASS หรือ REJECT' }) status: 'PASS' | 'REJECT';
```

#### W2 · `directReceive` skips Decimal conversion on `unitPrice` when creating POItems

**File**: `apps/api/src/modules/purchase-orders/services/po-receiving.service.ts:~340`

```ts
items: {
  create: dto.items.map((i) => ({
    ...
    unitPrice: i.unitPrice,   // number from DTO → written to POItem.unitPrice Decimal(12,2)
  })),
},
```

`POItem.unitPrice` is `Decimal @db.Decimal(12, 2)`. Prisma accepts a raw JS number here and will coerce it — but fractional values from the DTO (e.g., `13999.5`) may round differently than the computed `totalAmount`. Wrap with `d(i.unitPrice)` for consistency.

#### W3 · `getSummary()` has no branch-level scoping for `BRANCH_MANAGER` callers

**File**: `apps/api/src/modules/purchase-orders/services/po-query.service.ts:296`

`getSummary()` counts POs and products across ALL branches. `BRANCH_MANAGER` is in the `@Roles()` list on `GET /summary`, so a branch manager sees system-wide totals — overdue AP count, all incoming POs, all QC-pending units — not just their branch's.

`findAll()` has the same gap (pre-existing), but the new summary strip is surfaced prominently on the dashboard. If cross-branch visibility is intentional for aggregate KPIs (owner decision), add a comment; otherwise add a `CurrentUser` injection + `if (!CROSS_BRANCH_ROLES.includes(user.role)) where.branchId = user.branchId` filter.

---

### 🔵 Info (2)

#### I1 · `order()` lifecycle transition has no audit trail

**File**: `apps/api/src/modules/purchase-orders/services/po-lifecycle.service.ts:167`

The new `order(id, userId, dto)` method transitions PO from `APPROVED → ORDERED` without writing an `AuditLog` row. Other important transitions in the same service (e.g., `directReceive` at line 346 writes `PO_DIRECT_RECEIVE_APPROVAL_BYPASS`) do audit. The `po-lifecycle.service.ts` file consistently has 0 `auditLog` calls (pre-existing pattern), but `order()` changes a legally-significant purchasing state. Low-priority addition, but worth flagging for traceability.

#### I2 · Large `po-receiving.service.ts` — approaching size threshold

The file after this branch is ~500 lines. Consider extracting `directReceive` into its own `po-direct-receive.service.ts` in a follow-up. Not blocking.

---

## Guard Check Matrix

| Check | Result |
|---|---|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on new controllers | ✅ Class-level guard present |
| `@Roles()` on all new endpoints | ✅ All 4 new endpoints decorated |
| `Number()` on money fields (new code) | ❌ C1 above — `directReceive` totalAmount |
| `deletedAt: null` in new queries | ✅ All new queries include soft-delete filter |
| Hardcoded secrets / API keys | ✅ None found |
| Raw `$queryRaw` (SQL injection risk) | ✅ None found |
| Raw `fetch()` in new React components | ✅ None — all use `api.get()` / `api.post()` |
| `queryClient.invalidateQueries()` after mutations | ✅ Present on all 4 new mutations |
| DTO class-validator decorators present | ✅ Decorators exist; ⚠️ Thai messages missing (W1) |
| TypeScript `any` in production code | ✅ Only in test mocks |

---

## Recommendation

**REVIEW** — branch is nearly merge-ready; one critical Decimal precision fix required.

The feature work is well-structured: guards are correct, soft-delete filters are in place, React Query patterns are followed, and test coverage is thorough. The single Critical issue (C1) is a straightforward one-line fix in `directReceive`. Warnings W1 and W2 are minor polish. W3 is a design question for the owner.

**Suggested merge gate**: fix C1, then merge. W1–W3 can be addressed in a follow-up chore commit on the same branch.
