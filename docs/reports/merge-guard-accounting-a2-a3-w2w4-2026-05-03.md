# Merge Guard Report — Accounting Phase A.2 / A.3 / W-2+W-4

**Date**: 2026-05-03  
**Reviewer**: Pre-Merge Guard (automated)  
**Author**: Akenarin Kongdach `<iamnaii@MacBook-Pro-khxng-Akenarin.local>`

---

## Branches Reviewed (dependency chain — must merge in order)

| # | Branch | Latest commit | Files changed |
|---|--------|--------------|---------------|
| 1 | `fix/accounting-phase-a2-deferred-income` | `54a70e0f` 2026-04-29 | 10 (+452/−96) |
| 2 | `fix/accounting-phase-a3-ic-settlement`   | `ae734a73` 2026-04-29 | 8 (+474/0)    |
| 3 | `fix/accounting-w2-w4-frontend`           | `2941131a` 2026-04-29 | 8 (+405/−37)  |

> Branch 3 includes all changes from 1 and 2. Merge order: A.2 → A.3 → W-2/W-4.

---

## Branch 1: `fix/accounting-phase-a2-deferred-income`

### Summary

Implements Phase A.2 deferred income recognition: interest and commission are
now deferred at contract activation (Unearned Interest 21-2202, Unearned
Commission 21-2201, VAT Pending 21-2102) and recognised cash-basis per
installment payment. Aligns with TFRS for NPAEs straight-line recognition policy.

Key changes:
- `journal-auto.service.ts` — activation JE defers interest/VAT/commission;
  payment JE drains Unearned → Income per installment; early-payoff JE updated
  to drain full Unearned balance
- `contract-workflow.service.ts` — seeds `unearnedInterest` / `unearnedCommission`
  on contract activation
- `payments.service.ts` + `paysolutions.service.ts` — pass `contract.id` to JE
  caller so Unearned fields can be decremented after each payment
- `schema.prisma` — adds `unearnedInterest Decimal @default(0)` and
  `unearnedCommission Decimal @default(0)` to Contract model
- Migration `20260616000000_add_unearned_income_fields` — `ALTER TABLE` with
  backfill for ACTIVE/OVERDUE/DEFAULT contracts
- +266 tests, all existing tests updated for Phase A.2 JE behaviour

### Issues

#### Critical

*None.*

#### Warning

**W-1** `contract-workflow.service.ts:64` — `unearnedCommission: contract.storeCommission ?? 0`  
`storeCommission` is `Decimal | null`; the `?? 0` fallback uses a JS number
literal. Prisma accepts `number` for `Decimal` fields, so this is safe at
runtime, but violates the project convention of wrapping all financial
values in `Prisma.Decimal`. Recommended fix:
```ts
unearnedCommission: contract.storeCommission ?? new Prisma.Decimal(0),
```

**W-2** `journal-auto.service.ts` — `.minus()` used once (payment drift check)  
`breakdownSum.minus(amountPaid).abs()` — `.minus()` is a valid Decimal.js alias
for `.sub()`, but the rest of the service consistently uses `.sub()`. Minor
inconsistency; no functional impact.

#### Info

**I-1** Migration timestamp `20260616000000` is set in the future (June 2026 vs.
today May 2026). This is cosmetic but could confuse `prisma migrate status`.
Recommend renaming to `20260429000000_add_unearned_income_fields` before merge.

**I-2** `contract.update({ where: { id } })` in `createPaymentJournal` and
`createEarlyPayoffJournal` does not include `deletedAt: null`. This is safe
because the contract is guaranteed ACTIVE at this point by the calling service's
own validation, but adds a minor deviation from the soft-delete query rule.

### Recommendation: **REVIEW** (fix W-1 before merge)

---

## Branch 2: `fix/accounting-phase-a3-ic-settlement`

**Depends on**: Branch 1 must be merged first.

### Summary

Implements Phase A.3 (W-5): new `IntercompanyModule` with a controller and
service that let OWNER/FINANCE_MANAGER record actual FINANCE→SHOP cash
settlements. Posts paired JEs (FINANCE: Dr Due-to-SHOP / Cr Cash; SHOP:
Dr Cash / Cr Due-from-FINANCE). Guard: settlement cannot exceed current
outstanding balance. 124 new tests.

Key changes:
- `intercompany.controller.ts` — `GET /accounting/intercompany/balance`,
  `POST /accounting/intercompany/settle`
- `intercompany.service.ts` — balance read (Decimal aggregation) + settle
  (delegates to JournalAutoService within `$transaction`)
- `journal-auto.service.ts` — new `createInterCompanySettlementJournal` method
- `app.module.ts` — imports new `IntercompanyModule`
- 124 unit tests in `intercompany.service.spec.ts` + `journal-auto.service.spec.ts`

### Issues

#### Critical

*None.*

**Security check passed:**
- `@UseGuards(JwtAuthGuard, RolesGuard)` present at class level ✓
- `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` on GET ✓
- `@Roles('OWNER', 'FINANCE_MANAGER')` on POST ✓ (restricted — only OWNER and FINANCE_MANAGER can post settlements)
- `ValidationPipe({ whitelist: true })` present ✓
- All `deletedAt: null` guards in place ✓
- `Prisma.Decimal` used for all financial computations ✓

#### Warning

**W-1** `settle-intercompany.dto.ts:9` — `reference` field missing `@IsNotEmpty()`  
```ts
@IsString({ message: 'กรุณาระบุเลขที่อ้างอิง' })
@MaxLength(50)
reference!: string;
```
An empty string (`""`) passes `@IsString` validation. The JE would be posted
with an empty `referenceId`. Recommended fix:
```ts
@IsNotEmpty({ message: 'กรุณาระบุเลขที่อ้างอิง' })
@IsString()
@MaxLength(50)
reference!: string;
```

**W-2** `intercompany.service.ts:92` — `remainingBalance` uses JS Number arithmetic  
```ts
remainingBalance: Math.round((balance.financeOwesToShop - dto.amount) * 100) / 100,
```
`balance.financeOwesToShop` is already a `.toDecimalPlaces(2).toNumber()`, so
floating-point precision loss is low but possible for edge amounts. Prefer:
```ts
remainingBalance: new Prisma.Decimal(balance.financeOwesToShop)
  .sub(dto.amount).toDecimalPlaces(2).toNumber(),
```
(Response-only field, not stored to DB — risk is display-only.)

#### Info

**I-1** `SettleIntercompanyDto.amount` is typed as `number` (HTTP input). The
service correctly wraps it in `new Prisma.Decimal(params.amount)` before any
JE arithmetic. Pattern is consistent with other DTO fields in this codebase.

### Recommendation: **REVIEW** (fix W-1 before merge)

---

## Branch 3: `fix/accounting-w2-w4-frontend`

**Depends on**: Branches 1 and 2 must be merged first.

### Summary

Three independent improvements bundled:
- **W-2**: `pg_advisory_xact_lock` replaces `SELECT ... FOR UPDATE` in
  `generateEntryNumber()` and `generateReceiptNumber()`, fixing a race condition
  on the first JE/receipt of each new month.
- **W-4**: Early-payoff discount now posts an explicit `Dr Sales Discount
  Interest (53-1805)` P&L line instead of hiding the discount in an
  interest/VAT income asymmetry. Makes discount visible to CPA auditors.
- **Frontend**: New `IntercompanySettlementPage.tsx` + route
  `/accounting/intercompany` + menu entries for OWNER / ACCOUNTANT.

### Issues

#### Critical

*None.*

**Security check passed:**
- New route uses `<ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>` ✓
- All API calls use `api.get()` / `api.post()` from `@/lib/api` ✓
- `useQuery` / `useMutation` with `queryClient.invalidateQueries()` ✓
- No hardcoded secrets ✓
- Design tokens used throughout (no hardcoded hex, no `bg-white`, no `text-gray-*`) ✓
- `leading-snug` applied to Thai numeric display ✓

#### Warning

**W-1** `IntercompanySettlementPage.tsx:461-464` — History filtered client-side  
```ts
const settlementHistory = (historyQ.data?.data ?? []).filter(
  (e) => e.description?.includes('IC-') &&
         e.description?.includes('ชำระเงินระหว่างบริษัท'),
);
```
The `/journal-entries?search=IC_SETTLEMENT` endpoint returns results by
`referenceType`, but the description matching is fragile (depends on the
Thai phrase staying constant). If a future refactor changes the description
template, history silently disappears. Recommendation: filter by
`e.referenceType === 'IC_SETTLEMENT'` once the API exposes `referenceType`
in the response shape (or add it to the select).

**W-2** `IntercompanySettlementPage.tsx:559` — `Number(l.debit)` on financial value  
Used only for display in the history table (not for any calculation or storage).
Acceptable for display; no financial impact.

#### Info

**I-1** W-2 lock key namespace:
- JE lock key: `parseInt(ym, 10)` → e.g. `202605`
- Receipt lock key: `parseInt('1' + ym, 10)` → e.g. `1202605`
- Comment in code explains the namespace separation. ✓ But the
  `pg_advisory_xact_lock` lock space is global per PG connection — confirm no
  other module uses the same key space for a different purpose.

**I-2** New account `53-1805` (`Sales Discount on Interest`) is added to the
FINANCE seed. The seed uses `upsert` so it's idempotent on re-run ✓. No
migration needed (chart-of-accounts seeded, not schema columns).

### Recommendation: **REVIEW** (fix W-1 before merge)

---

## Cross-Branch Notes

1. **Migration timestamp** (Branch 1, I-1): the migration name
   `20260616000000` is dated 6 weeks in the future. Since Prisma uses the
   timestamp for ordering, this will sort last among existing migrations.
   It would not break `migrate deploy`, but is confusing and should be
   corrected before merging to `main`.

2. **Merge order is strictly required**:
   - Branch 1 (A.2) adds the `unearnedInterest` / `unearnedCommission`
     schema fields + the JE logic that writes to them.
   - Branch 2 (A.3) calls `createInterCompanySettlementJournal` which
     is defined in the Branch 1 version of `journal-auto.service.ts`.
   - Branch 3 (W-2/W-4) seeds the new accounts and adds the frontend
     that calls the Branch 2 endpoint.
   Attempting to cherry-pick or merge out of order will cause TypeScript
   errors and missing account codes.

3. **No new public endpoints introduced** — the `IntercompanyController`
   is properly guarded. The balance endpoint is read-only and restricted
   to financial roles.

4. **Test coverage**: 474 new API tests across the three branches. All
   Phase A.2 lifecycle invariants verified (activation + 12 payments →
   all Unearned accounts drain to 0). ✓

---

## Summary

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `fix/accounting-phase-a2-deferred-income` | 0 | 2 | 2 | **REVIEW** |
| `fix/accounting-phase-a3-ic-settlement`   | 0 | 2 | 1 | **REVIEW** |
| `fix/accounting-w2-w4-frontend`           | 0 | 2 | 2 | **REVIEW** |

No blocking critical issues found. All three branches are **safe to merge**
after addressing the Warnings:

1. Fix `@IsNotEmpty()` on `reference` in `SettleIntercompanyDto`
2. Wrap `remainingBalance` computation in `Prisma.Decimal`
3. Wrap `storeCommission ?? 0` in `new Prisma.Decimal(0)` at activation
4. Consider renaming migration timestamp to match commit date (Apr 29)
