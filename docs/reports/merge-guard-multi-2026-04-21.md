# Merge Guard Report — 2026-04-21

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-04-21  
**Branches reviewed** (3 of 157 unmerged):

| Branch | Unique Commits | Files Changed | Recommendation |
|--------|---------------|---------------|----------------|
| `refactor/ui-design-tokens-2026-04-17` | 5 | 159 | **REVIEW** |
| `refactor/contract-create-unify-docs` | 1 | 9 | **APPROVE** |
| `refactor/customer-contract-detail-ui` | 1 | 4 | **APPROVE** |

---

## Branch 1: `refactor/ui-design-tokens-2026-04-17`

**Author**: Akenarin Kongdach <akenarin.ak@gmail.com>  
**Unique commits**: 5 (all 4 days old)  
**Files**: 159 changed — mostly frontend color-token migration + new exchange module + E2E fix + DB migration

### Commits summary
1. `32aef061` — fix(chat): register adapters via OnModuleInit + surface send failures to UI
2. `5c86e645` — test(e2e): share login tokens across workers to beat /auth/login 10/min throttle
3. `092d3949` — fix(api): add missing canned_responses.response_type + media_url migration
4. `6efa2b3a` — refactor(web): Phase 8 tokenize 32 component/hook/lib/constant files
5. `4b564048` — refactor(web): Phase 7 eliminate final 45 color-scale violations

---

### 🔴 Critical

#### C1 — `Number()` on monetary fields in `exchange.service.ts` (NEW file)
**File**: `apps/api/src/modules/exchange/exchange.service.ts`  
The exchange module is entirely new in this branch (not on `main`). It uses `Number()` to convert Prisma `Decimal` values for financial calculations — violating the v4 hardening rule ("53 `Number()` → `Prisma.Decimal` ใน 12 services").

Affected lines (exchange.service.ts):
```ts
// Line 65-67 — preview response object
remainingPrincipal: Number(remainingPrincipal),   // Decimal → Number
totalLateFees:      Number(totalLateFees),          // Decimal → Number
outstandingBalance: Number(outstandingBalance),     // Decimal → Number
// Line 76, 80-82 — summary response
amount:            Number(newPrice.amount),         // Decimal → Number
outstandingBalance: Number(outstandingBalance),
newProductPrice:   Number(newPrice.amount),
difference:        Number(newPrice.amount) - Number(outstandingBalance),
// Line 134, 137 — contract calculation variables
const outstandingBalance = Number(outstandingDecimal);   // used in arithmetic
const sellingPrice = Number(newPrice.amount);            // used in arithmetic
// Lines 121-164 — config values (lower risk but still Number())
interestRate = config ? Number(config.value) : 0.08;
const minDownPct = minDownConfig ? Number(minDownConfig.value) : 0.15;
const storeCommissionPct = storeCommConfig ? Number(storeCommConfig.value) : 0.10;
const vatPct = vatConfig ? Number(vatConfig.value) : 0.07;
```

**Risk**: Float precision errors in exchange contract calculations (outstandingBalance and sellingPrice directly feed new installment arithmetic — incorrect rounding will produce wrong สัญญาแลกเปลี่ยน amounts).

**Fix**: Use `Prisma.Decimal` throughout:
```ts
import { Prisma } from '@prisma/client';
const outstandingBalance = outstandingDecimal; // keep as Prisma.Decimal
const sellingPrice = newPrice.amount;          // Prisma.Decimal
// arithmetic: use .add(), .sub(), .mul(), .div() or toFixed(2) only at response boundary
```

---

#### C2 — `Number()` on `costPrice` in `purchase-orders.service.ts`
**File**: `apps/api/src/modules/purchase-orders/purchase-orders.service.ts`  
Two instances when receiving stock into Product records:
```ts
costPrice: Number(poItem.unitPrice),  // 2× product.create() calls
```
`costPrice` is `@db.Decimal(12, 2)` on the Product model. Passing a JS `number` works via Prisma coercion but loses the explicit precision guarantee and breaks consistency with the hardening standard.

**Fix**: Pass the Decimal directly: `costPrice: poItem.unitPrice`

---

### 🟡 Warning

#### W1 — Frontend `Number()` on display values (acceptable, not blocking)
The frontend diffs contain many `Number(p.amountPaid).toLocaleString()` patterns — these are for **display-only formatting** in React components and do not store or calculate financial values. Not a violation per current rules, but noted for consistency.

---

### ✅ Passing

| Check | Result |
|-------|--------|
| New controller guards (`ExchangeController`) | ✅ `@UseGuards(JwtAuthGuard, RolesGuard)` present |
| Roles on exchange endpoints | ✅ `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')` |
| `deletedAt: null` in exchange queries | ✅ checks `oldContract.deletedAt`, `newProduct.deletedAt`, `interestConfig.deletedAt` |
| Raw `$queryRaw` (unparameterized) | ✅ Only `$queryRaw\`SELECT 1\`` health check (safe) |
| Hardcoded secrets | ✅ None found |
| Frontend `fetch()` instead of `api.get()` | ✅ None |
| Chat adapter fix (C1 bug) | ✅ Correctly uses `OnModuleInit` self-registration |
| E2E token sharing fix | ✅ Prevents 429s on sharded CI |
| DB migration for canned_responses | ✅ Fixes schema drift |
| Design token migration (159 files) | ✅ No hardcoded hex/gray colors introduced |

### Recommendation: **REVIEW** — Fix C1 + C2 before merge

---

## Branch 2: `refactor/contract-create-unify-docs`

**Author**: Akenarin Kongdach <akenarin.ak@gmail.com>  
**Unique commits**: 1 (31 hours old)  
**Commit**: `4864d580` — refactor(contract-create): remove step 4 doc upload — consolidate to detail page

### Changes summary
- Removes `DocumentUploadStep.tsx` (263 lines) and `useDocumentUpload.ts` (114 lines)
- Removes `PendingDoc` type and duplicate `DOCUMENT_TYPES` constant
- Removes Step 4 from the 4-step contract wizard → now 3 steps
- Document upload still available on the ContractDetailPage (existing `DocumentUpload` component)
- Net: −520 LOC, no functional loss

### Critical: None
### Warning: None
### Info
- The "สร้าง + ส่งตรวจสอบ" combined button (create-and-submit) is removed; users must now explicitly click "ส่งตรวจสอบ" from the detail page. This is an intentional UX simplification (documented in commit message).

### ✅ Passing
- No new backend code
- No API endpoints added or changed
- TypeScript: clean (passed per commit message)
- No security surface changes

### Recommendation: **APPROVE**

---

## Branch 3: `refactor/customer-contract-detail-ui`

**Author**: Akenarin Kongdach <akenarin.ak@gmail.com>  
**Unique commits**: 1 (3 days old)  
**Commit**: `724a67ab` — refactor(ui): ปรับหน้า CustomerDetail + ContractDetail + PaymentTimeline ให้อ่านง่ายขึ้น

### Changes summary (4 files)
- `CustomerDetailPage.tsx`: adds 4 KPI summary cards + controlled tabs (contract count badge becomes clickable → jumps to contracts tab) + tab counters `(n)`
- `ContractDetailPage.tsx`: replaces 5-card status row (status + workflow + 3 numbers) with 4-card layout (removes status badge + WorkflowStatusBadge), improves plan details section
- `PaymentTimeline.tsx` / `ContractPaymentSchedule.tsx`: removes detailed per-installment visual timeline, keeps only progress overview (progress bar + legend)

### Critical: None
### Warning

#### W1 — Contract status badge and WorkflowStatusBadge removed from summary row
The 5-card grid previously showed:
1. สถานะสัญญา (Badge: ACTIVE / OVERDUE / etc.)
2. Workflow (WorkflowStatusBadge: PENDING_REVIEW / APPROVED / etc.)

Both are removed in the new 4-card layout. Contract status and workflow status are no longer prominently visible at the top of the contract detail page.

**Impact**: Reviewers and finance managers may miss contracts stuck in `PENDING_REVIEW` or `DEFAULT` status. The Workflow Actions block still appears further down the page — but only when `workflowStatus === 'PENDING_REVIEW'`.

**Suggestion**: Add at least a small status indicator near the page header (e.g., inside the existing breadcrumb/title area) so status is visible without scrolling.

#### W2 — Payment timeline detail removed
The per-installment timeline (icon per payment with date/amount/status) was removed, leaving only the progress bar + legend summary. Users can still see all installments in the DataTable below, so data is not lost — but the visual context is gone.

### ✅ Passing
- No backend changes
- All new frontend code uses semantic design tokens (`bg-primary/10`, `text-destructive`, `text-success`)
- No raw `fetch()` calls
- `Tabs` state correctly wired via `value` + `onValueChange`

### Recommendation: **APPROVE** (W1 is a UX concern, not a blocking bug)

---

## Action Items Before Merge

| Priority | Branch | Action |
|----------|--------|--------|
| 🔴 Critical | `ui-design-tokens-2026-04-17` | Replace `Number(outstandingBalance/remainingPrincipal/amount)` with `Prisma.Decimal` in `exchange.service.ts` |
| 🔴 Critical | `ui-design-tokens-2026-04-17` | Fix `costPrice: Number(poItem.unitPrice)` → `costPrice: poItem.unitPrice` in `purchase-orders.service.ts` |
| 🟡 Optional | `customer-contract-detail-ui` | Re-add contract status badge to header/breadcrumb area so `OVERDUE`/`DEFAULT` is visible without scroll |
