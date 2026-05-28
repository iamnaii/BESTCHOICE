# Pre-Merge Guard Report — SP2 Exchange Branches

**Reviewed by:** Pre-Merge Guard agent  
**Date:** 2026-05-28  
**Branches reviewed:** 3

---

## Summary Table

| Branch | Files Changed | Critical | Warning | Info | Recommendation |
|--------|--------------|----------|---------|------|----------------|
| `feat/sp2-same-price-exchange` | 23 | 0 | 2 | 3 | ⚠️ REVIEW |
| `feat/sp2-exchange-sign-flow` | 10 | 0 | 1 | 2 | ⚠️ REVIEW |
| `feat/data-deletion-page` | 2 | 0 | 0 | 1 | ✅ APPROVE |

---

## Branch 1: `feat/sp2-same-price-exchange`

**Author:** iamnaii <akenarin.ak@gmail.com>  
**Last updated:** 4 days ago

### File Changes
```
apps/api/prisma/migrations/20260961000000_add_contract_exchange_request/
apps/api/prisma/schema.prisma
apps/api/src/app.module.ts
apps/api/src/modules/contract-exchange/  (controller, module, service, 2 DTOs)
apps/api/src/modules/journal/cpa-templates/  (3 new templates)
apps/api/src/modules/journal/  (3 new template specs)
apps/web/e2e/exchange-request-flow.spec.ts
apps/web/src/App.tsx
apps/web/src/config/menu.ts
apps/web/src/pages/insurance/ExchangeRequestsPage.tsx  (293 lines)
apps/web/src/pages/insurance/ExchangeRequestForm.tsx   (218 lines)
apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx
23 files changed, ~1972 insertions
```

### Security & Guards

Controller (`contract-exchange.controller.ts`) is correctly guarded:
- Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` ✅
- All 4 endpoints have `@Roles()` decorators ✅
- No raw SQL / `$queryRaw` ✅
- DTOs validated with class-validator; Thai error messages ✅

Frontend correctly uses `api.get()`/`api.post()`, `useQuery`/`useMutation`, `toast.success()`/`toast.error()` ✅

---

### ⚠️ WARNING-1: Missing `deletedAt: null` on product queries in `submit()`

**File:** `apps/api/src/modules/contract-exchange/contract-exchange.service.ts:48-49`

```typescript
const [oldRaw, newRaw] = await Promise.all([
  this.prisma.product.findUnique({ where: { id: dto.oldProductId } }),
  this.prisma.product.findUnique({ where: { id: dto.newProductId } }),
]);
```

Both product lookups use `findUnique({ where: { id } })` — no `deletedAt: null` filter.
A soft-deleted product passes the `!oldRaw`/`!newRaw` null checks and enters the validation
pipeline. This allows submitting an exchange request for a product that has been logically
removed from stock. The downstream `status: 'IN_STOCK'` check does not cover the soft-delete case.

**Fix:**
```typescript
this.prisma.product.findUnique({ where: { id: dto.oldProductId, deletedAt: null } })
this.prisma.product.findUnique({ where: { id: dto.newProductId, deletedAt: null } })
```

Note: the contract query at line 35 correctly includes the manual `if (!oldContract || oldContract.deletedAt)` pattern.

---

### ⚠️ WARNING-2: Collision-prone contract number in `approve()`

**File:** `apps/api/src/modules/contract-exchange/contract-exchange.service.ts:135`

```typescript
contractNumber: `EX-${Date.now()}`,
```

Two concurrent approvals within the same millisecond will produce duplicate `contractNumber` values,
hitting the DB unique constraint and crashing the transaction. Also:
- `EX-` collides with `ExpenseDocument` number prefix (`EX-YYYYMMDD-NNNN`) used by accounting reports
- The format is not human-readable (epoch millis)

**Note:** `feat/sp2-exchange-sign-flow` supersedes this approval path with `nextExchangeContractNumber()`
(format `EXCH-YYYYMMDD-NNNN` + advisory lock). If the exchange-sign-flow branch lands first, this
issue is resolved. However, merging `feat/sp2-same-price-exchange` to main without the sign-flow
branch leaves production with a broken approval endpoint.

**Recommendation:** Either merge `feat/sp2-exchange-sign-flow` first, or backport
`nextExchangeContractNumber()` into this branch before merging.

---

### ℹ️ INFO-1: Missing `queryClient.invalidateQueries()` in `ExchangeRequestForm` submit

**File:** `apps/web/src/pages/insurance/ExchangeRequestForm.tsx:99-101`

`onSuccess` navigates to `/insurance` instead of invalidating queries. The pending-requests
list will refetch on mount but any cached exchange-related queries in the current session may
stay stale briefly. Low impact since the form navigates away on success.

---

### ℹ️ INFO-2: `listPending` restricted to OWNER only

**File:** `apps/api/src/modules/contract-exchange/contract-exchange.controller.ts:20-21`

`GET /insurance/exchange-requests/pending` is `@Roles('OWNER')` only.
If `FINANCE_MANAGER` needs to review exchange queues for reporting, they will receive 403.
May be intentional — verify with business requirements before widening.

---

### ℹ️ INFO-3: `ExchangeRequestsPage` missing `QueryBoundary`

**File:** `apps/web/src/pages/insurance/ExchangeRequestsPage.tsx`

All data-list pages should wrap their main query in `<QueryBoundary>` for error+retry UI
(per v1 hardening, ~44 pages). `ExchangeRequestsPage` handles `isLoading`/`isError` inline
but without the standardized retry button. Minor UX inconsistency.

---

## Branch 2: `feat/sp2-exchange-sign-flow`

**Author:** iamnaii <akenarin.ak@gmail.com>  
**Last updated:** 4 days ago  
**Depends on:** `feat/sp2-same-price-exchange`

### File Changes
```
apps/api/src/cli/fix-sp1-used-exchange-uuid.sql  (one-off migration helper)
apps/api/src/modules/contract-exchange/contract-exchange.service.spec.ts
apps/api/src/modules/contract-exchange/contract-exchange.service.ts
apps/api/src/modules/contracts/contract-hash.spec.ts
apps/api/src/modules/contracts/contract-signing-workflow.spec.ts
apps/api/src/modules/contracts/contract-workflow.service.spec.ts
apps/api/src/modules/contracts/contract-workflow.service.ts
apps/api/src/modules/contracts/contracts.module.ts
apps/web/src/pages/insurance/ExchangeRequestForm.tsx
apps/web/src/pages/insurance/ExchangeRequestsPage.tsx
10 files changed, ~685 insertions / ~261 deletions
```

### Security & Guards
- No new controllers — changes are to existing `contract-workflow.service.ts` + service layer ✅
- `Number()` at lines 181-184 and 584 of `contract-workflow.service.ts` — pre-existing in `main`, NOT introduced by this branch (verified with `git diff`) ✅
- Decimal arithmetic in `finalizeAfterActivation` uses `new Decimal(...)` throughout ✅
- Advisory lock pattern for `nextExchangeContractNumber` — correct BKK-day-bounds + sequence ✅

---

### ⚠️ WARNING-1: `$executeRawUnsafe` for advisory lock

**File:** `apps/api/src/modules/contract-exchange/contract-exchange.service.ts:569`

```typescript
await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lockKey})`);
```

`lockKey` is a 32-bit integer computed from an internal string (`exch:YYYYMMDD`), not from user input,
so there is **no SQL injection risk**. However project convention (and Prisma docs) recommend
parameterized `$executeRaw(Prisma.sql\`...\`)` to signal intent and prevent accidental copy-paste
of this pattern with user-supplied values.

**Fix:**
```typescript
import { Prisma } from '@prisma/client';
await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${lockKey})`);
```

Note: existing `DocNumberService` and `RepairTicketDocNumberService` likely use the same unsafe pattern — check consistency.

---

### ℹ️ INFO-1: Zero-outstanding risk if old contract has no POSTED journal entries

**File:** `apps/api/src/modules/contract-exchange/contract-exchange.service.ts:497-555` (`computeOldOutstanding`)

`computeOldOutstanding` sums POSTED journal lines for the old contract from the ledger.
If the old contract predates Phase A.4 (no JEs ever posted) all outstanding values return `0`,
and the JE templates post a ฿0 JE that silently no-ops the receivable close. No guard exists
for this case.

Consider adding:
```typescript
if (gross.equals(0) && unearnedInterest.equals(0)) {
  throw new BadRequestException('ไม่พบรายการบัญชีสำหรับสัญญาเดิม — ตรวจสอบการ migrate Phase A.4 ก่อน finalize');
}
```

---

### ℹ️ INFO-2: `ContractWorkflowService` → `ContractExchangeService` injection creates coupling

**File:** `apps/api/src/modules/contracts/contract-workflow.service.ts`

`ContractWorkflowService` now injects `ContractExchangeService`. If a future change ever requires
`ContractExchangeService` to call back into `ContractWorkflowService`, a circular dependency
will crash at startup. Currently safe. Document in `contracts.module.ts` with a comment noting
the one-way dependency constraint.

---

## Branch 3: `feat/data-deletion-page`

**Author:** iamnaii <akenarin.ak@gmail.com>  
**Last updated:** 3 days ago

### File Changes
```
apps/web/src/App.tsx          |   2 +
apps/web/src/pages/DataDeletionPage.tsx | 123 ++++
2 files changed, 125 insertions(+)
```

### Checks
- Route `/privacy/data-deletion` added as public (no `ProtectedRoute`) — correct for PDPA/Meta requirement ✅
- Lazy-loaded with `React.lazy()` ✅
- Uses design tokens throughout (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-muted`) ✅
- Thai text uses `leading-snug` ✅
- No API calls, no auth, no side effects ✅

---

### ℹ️ INFO-1: Owner personal email hardcoded as PDPA contact

**File:** `apps/web/src/pages/DataDeletionPage.tsx:37`

```tsx
<a href="mailto:akenarin.ak@gmail.com?subject=...">akenarin.ak@gmail.com</a>
```

The owner's personal Gmail is the listed deletion contact. For a legally-facing PDPA page, a
dedicated company email (`privacy@bestchoice.co.th` or similar) is preferable — personal
emails can change, and the page will be indexed by Meta/Facebook. Likely intentional for now
(single owner), worth flagging for the future.

---

## Merge Order Recommendation

```
1. feat/sp2-same-price-exchange   ← fix WARNING-1 + WARNING-2 first (or merge after step 2)
2. feat/sp2-exchange-sign-flow    ← fix WARNING-1 ($executeRaw) first; supersedes step 1's WARNING-2
3. feat/data-deletion-page        ← ready to merge as-is
```

Since `feat/sp2-exchange-sign-flow` **supersedes** the broken contract-number generation in
`feat/sp2-same-price-exchange`, the safest order is: fix WARNING-1 in branch 1, merge branch 2
(which patches WARNING-2), then merge branch 1. Or: batch-merge both with WARNING-1 fixed in branch 1.

---

*Report generated by Pre-Merge Guard agent — 2026-05-28*
