# Pre-Merge Guard Report — Accounting Branches
**Date**: 2026-05-02  
**Reviewer**: Pre-Merge Guard Agent  
**Branches reviewed** (3 most recently updated, unmerged against `main`):

1. `fix/accounting-phase-a3-ic-settlement` (2026-04-29)
2. `fix/accounting-w2-w4-frontend` (2026-04-29)
3. `feat/accounting-phase-a1b-intercompany-je` (2026-04-29)

---

## Branch 1 — `fix/accounting-phase-a3-ic-settlement`

**Author**: iamnaii  
**Commits**: 1 — `feat(accounting): Phase A.3 (W-5) — Inter-company settlement JE`  
**Files changed**: 8 files (+474 / −0)

### File Changes Summary
| File | +/- |
|------|-----|
| `apps/api/src/modules/intercompany/intercompany.controller.ts` | +29 new |
| `apps/api/src/modules/intercompany/intercompany.service.ts` | +103 new |
| `apps/api/src/modules/intercompany/intercompany.service.spec.ts` | +124 new |
| `apps/api/src/modules/intercompany/intercompany.module.ts` | +12 new |
| `apps/api/src/modules/intercompany/dto/settle-intercompany.dto.ts` | +20 new |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +91 |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +92 |
| `apps/api/src/app.module.ts` | +3 |

### Security Checks
- ✅ `@UseGuards(JwtAuthGuard, RolesGuard)` present on controller class
- ✅ `@Roles()` on all endpoints (`GET /balance` → OWNER/FINANCE_MANAGER/ACCOUNTANT; `POST /settle` → OWNER/FINANCE_MANAGER)
- ✅ No hardcoded secrets or API keys
- ✅ `deletedAt: null` on all Prisma queries
- ✅ DTO uses class-validator with Thai validation messages
- ✅ `$queryRaw` not used (no SQL injection risk)

### Issues Found

#### ⚠️ Warning — Floating-point arithmetic on money (`intercompany.service.ts:97`)
```typescript
remainingBalance: Math.round((balance.financeOwesToShop - dto.amount) * 100) / 100,
```
`balance.financeOwesToShop` is a `number` (returned from `.toNumber()`) and `dto.amount` is a raw JSON number. Arithmetic on two floats risks precision errors (e.g. `10600.00 - 5000.00 * 100 / 100 = 5600.0000000001`). Should use:
```typescript
remainingBalance: new Prisma.Decimal(balance.financeOwesToShop).sub(dto.amount).toDecimalPlaces(2).toNumber(),
```

#### ⚠️ Warning — Float comparison for pre-flight guard (`intercompany.service.ts:80`)
```typescript
if (dto.amount > balance.financeOwesToShop + 0.01) {
```
The `+ 0.01` tolerance is a code smell for floating-point comparison. Should compare using `Prisma.Decimal`:
```typescript
const dtoDecimal = new Prisma.Decimal(dto.amount);
if (dtoDecimal.gt(new Prisma.Decimal(balance.financeOwesToShop).add('0.01'))) { ... }
```

#### ℹ️ Info — DTO `amount` typed as `number`
`SettleIntercompanyDto.amount` is `@IsNumber()` / `number`. Acceptable for HTTP JSON input (will be wrapped in `new Prisma.Decimal()` before any financial computation), but inconsistent with convention of passing monetary values as strings. Low risk given immediate wrapping.

### Recommendation: **REVIEW** — 2 Warnings must be addressed before merge.

---

## Branch 2 — `fix/accounting-w2-w4-frontend`

**Author**: iamnaii  
**Commits**: 1 — `feat(accounting): W-2 + W-4 + frontend settlement page`  
**Files changed**: 8 files (+405 / −37)

### File Changes Summary
| File | +/- |
|------|-----|
| `apps/web/src/pages/IntercompanySettlementPage.tsx` | +287 new |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +99 / −37 |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +21 |
| `apps/api/src/modules/receipts/receipts.service.ts` | +16 / −0 |
| `apps/api/prisma/seeds/chart-of-accounts-finance.ts` | +1 |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | +7 |
| `apps/web/src/App.tsx` | +9 |
| `apps/web/src/config/menu.ts` | +2 |

### Security Checks
- ✅ No new controller — existing guards unchanged
- ✅ New page uses `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}` ✓
- ✅ Page is `React.lazy()`-loaded ✓
- ✅ Uses `api.get()` / `api.post()` (no raw `fetch()`) ✓
- ✅ `queryClient.invalidateQueries()` called after `settleMut` ✓
- ✅ Design tokens used (`bg-muted`, `bg-card`, `text-muted-foreground`, `border-border`) — no hardcoded hex ✓
- ✅ `toast.success()` / `toast.error()` from sonner ✓
- ✅ Advisory lock (`pg_advisory_xact_lock`) parameterized correctly in template literal ✓
- ✅ No hardcoded secrets

### Issues Found

#### ⚠️ Warning — History query uses general JE endpoint with client-side filtering (`IntercompanySettlementPage.tsx:431-437`)
```typescript
queryFn: async () =>
  (await api.get('/journal-entries', {
    params: { search: 'IC_SETTLEMENT', limit: 50 },
  })).data,
// …then client-side filtered:
.filter((e) => e.description?.includes('IC-') && e.description?.includes('ชำระเงินระหว่างบริษัท'))
```
The `limit: 50` on a general JE endpoint may not return all IC_SETTLEMENT entries if there are more than 50 total JEs in the search results. The client-side filter then quietly drops them. Should use the dedicated `/accounting/intercompany/settle` history endpoint or add `referenceType=IC_SETTLEMENT` if supported, without the 50-entry blind spot.

#### ⚠️ Warning — In-place mutation of journal lines array (`journal-auto.service.ts:219-230`)
```typescript
if (isLegacyFallback) {
  const hpLine = financeLines.find((l) => l.accountCode === FA.HP_RECEIVABLE)!;
  hpLine.credit = sumRemainingDue.toNumber();   // mutates element found by .find()
  const interestLine = financeLines.find(...)!;
  interestLine.credit = 0;
  const vatLine = financeLines.find(...)!;
  vatLine.credit = 0;
  ...
}
```
Mutating objects returned by `.find()` is fragile — if line order or account codes change, the wrong lines are silently patched. The legacy fallback should build its `financeLines` from scratch in a separate branch rather than patching the main array.

#### ℹ️ Info — Same account code `53-1801` in both SHOP and FINANCE `_ACC` constants
`SHOP_ACC.SALES_DISCOUNT_COMMISSION = '53-1801'` and `FINANCE_ACC.COMMISSION_EXPENSE = '53-1801'` are both `'53-1801'` but refer to different accounts in different company charts. This is correct per the multi-entity chart partition design, but a clarifying comment would prevent future confusion.

#### ℹ️ Info — `journal-auto.service.ts` is now 1548 lines
Well above the 500-line guideline. Should be split into focused sub-services (e.g. `early-payoff-journal.service.ts`, `payment-journal.service.ts`, `contract-activation-journal.service.ts`) — ideally as a follow-up refactor ticket, not a merge blocker.

### Recommendation: **REVIEW** — 2 Warnings should be addressed before merge (history endpoint pagination gap is a correctness bug).

---

## Branch 3 — `feat/accounting-phase-a1b-intercompany-je`

**Author**: iamnaii  
**Commits**: 5  
**Files changed**: 23 files (+3835 / −181)

### File Changes Summary (key files)
| File | +/- |
|------|-----|
| `apps/api/src/modules/journal/journal-auto.service.ts` | +665 / −91 |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +796 / −0 |
| `apps/api/src/modules/payments/payments.service.ts` | +66 / −16 |
| `apps/api/src/modules/repossessions/repossessions.service.ts` | +38 / −6 |
| `apps/api/src/modules/repossessions/repossessions.controller.ts` | +8 / −0 |
| `apps/web/e2e/accounting-inter-company-flow.spec.ts` | +125 new |
| `docs/` | +1959 (2 design docs) |
| Other (contracts, paysolutions, bad-debt, data-audit) | +181 / −68 |

### Security Checks
- ✅ No new controllers added — existing guards on `repossessions.controller.ts` unchanged
- ✅ `repossessions.controller.ts` change only adds `@CurrentUser()` injection to `PATCH :id` (already `@Roles('OWNER', 'BRANCH_MANAGER')`) ✓
- ✅ `deletedAt: null` on all new Prisma queries ✓
- ✅ No hardcoded secrets
- ✅ No raw `$queryRaw` in new code
- ✅ All financial Decimal computations use `Prisma.Decimal` arithmetic; `Number()` / `.toNumber()` only appear in test assertion helpers
- ✅ New E2E test added for the inter-company flow ✓

### Issues Found

#### ℹ️ Info — `journal-auto.service.ts` grows to 1124 lines
After this branch the file is 1124 lines — 2× the 500-line guideline. Accounting logic is complex but the file now handles 10+ distinct JE types. Recommend a follow-up split.

#### ℹ️ Info — Inconsistent `orderBy` on SHOP company lookup
`data-audit.service.ts:1044` uses `orderBy: { createdAt: 'asc' }` when resolving SHOP companyId, but `payments.service.ts:resolveShopCompanyId()` does not. Both should be consistent (or neither, since there should only ever be one SHOP record).

#### ℹ️ Info — Two large design doc markdown files added to branch
`docs/guards/accounting-phase-a1b-...` files are 1525 + 434 lines. Not a code issue, but these should be reviewed to ensure they reflect the final implementation (not the plan).

### Recommendation: **APPROVE** — No Critical or Warning issues. Three Info items are improvement suggestions only.

---

## Summary Table

| Branch | Files | +Lines | Critical | Warning | Info | Recommendation |
|--------|-------|--------|----------|---------|------|----------------|
| `fix/accounting-phase-a3-ic-settlement` | 8 | +474 | 0 | 2 | 1 | **REVIEW** |
| `fix/accounting-w2-w4-frontend` | 8 | +405 | 0 | 2 | 2 | **REVIEW** |
| `feat/accounting-phase-a1b-intercompany-je` | 23 | +3835 | 0 | 0 | 3 | **APPROVE** |

**No Critical blockers found across any branch.**  
Both `fix/` branches have Warning-level issues that should be resolved before merge — particularly the floating-point money arithmetic (A3) and the pagination gap in the history query (W2/W4 frontend).
