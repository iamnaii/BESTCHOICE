# Pre-Merge Guard Report — Accounting Phase A.2 / A.3 / W-2+W-4

**Date**: 2026-04-30  
**Author**: Akenarin Kongdach  
**Reviewer**: Pre-Merge Guard (automated)

---

## Branches Reviewed (3)

| Branch | Last Commit | Files Changed | Insertions | Deletions |
|--------|-------------|---------------|------------|-----------|
| `fix/accounting-phase-a2-deferred-income` | 2026-04-29 | 10 | +452 | -96 |
| `fix/accounting-phase-a3-ic-settlement` | 2026-04-29 | 8 | +474 | 0 |
| `fix/accounting-w2-w4-frontend` | 2026-04-29 | 8 | +405 | -37 |

These branches form a sequential accounting series: A.2 → A.3 → W-2/W-4. Each builds on the previous. Reviewed in logical order.

---

## Branch 1: `fix/accounting-phase-a2-deferred-income`

### What It Does
- Adds `unearnedInterest` and `unearnedCommission` `Decimal @default(0)` fields to `Contract` model (with migration)
- Implements deferred income recognition in `journal-auto.service.ts`:
  - Contract activation: books interest → `Unearned Interest (21-2202)` and commission → `Unearned Commission (21-2201)` instead of recognising as immediate income
  - Per-payment JE: drains deferred accounts (`Dr Unearned Interest / Cr Interest Income`, `Dr Unearned Commission / Cr Commission Income`, `Dr VAT Pending / Cr VAT Output`)
  - Early payoff: zeroes out remaining unearned balances
- Passes `contract.id` through to `payments.service.ts` and `paysolutions.service.ts` so payment JEs can update `unearned*` denormalized counters
- Adds new chart-of-accounts seeds: `21-2201 Unearned Commission` (SHOP), `21-2202 Unearned Interest` and `21-2102 VAT Output Pending` (FINANCE)
- 266 new test assertions in `journal-auto.service.spec.ts`

### Critical Issues
_None found._

### Warnings
1. **`contract-workflow.service.ts:406`** — `unearnedCommission: contract.storeCommission ?? 0`  
   The fallback `?? 0` produces a JS `number` (not `Prisma.Decimal`) when `storeCommission` is null. Prisma handles this correctly for Decimal updates, but the pattern is inconsistent with the rest of the codebase which uses explicit `Prisma.Decimal` wrappers. Low risk — suggest `contract.storeCommission ?? new Prisma.Decimal(0)`.

### Info
- `Number(l.debit ?? 0)` and `Number(l.credit ?? 0)` in `journal-auto.service.spec.ts` — test mock code only, not production. Acceptable.
- Schema migration adds `@default(0)` on new Decimal columns — correct approach for non-breaking migration on existing rows.
- `deletedAt: null` is present on all new Prisma queries.
- All JE line values use `.toNumber()` on `Prisma.Decimal` (required by JE line schema which accepts `number` — this is the established pattern, not a bug).

### Recommendation: ✅ APPROVE
Core deferred-recognition logic is correct, Decimal precision maintained throughout, migration is safe, tests are comprehensive.

---

## Branch 2: `fix/accounting-phase-a3-ic-settlement`

### What It Does
- New NestJS module: `apps/api/src/modules/intercompany/`
  - `IntercompanyController` at `GET /accounting/intercompany/balance` + `POST /accounting/intercompany/settle`
  - `IntercompanyService.getOutstandingBalance()` — aggregates net JE balances on SHOP `11-2105` vs FINANCE `21-1102` to detect IC invariant drift
  - `IntercompanyService.settle()` — pre-flight balance check → `$transaction` → paired SHOP+FINANCE JEs
- Adds `JournalAutoService.createInterCompanySettlementJournal()` — posts linked IC settlement JE pair identified by `[IC-<uuid>]` prefix
- Registered in `app.module.ts`
- 124 tests in `intercompany.service.spec.ts` + 4 tests in `journal-auto.service.spec.ts`

### Critical Issues
_None found._

- `@UseGuards(JwtAuthGuard, RolesGuard)` ✅ at class level
- `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` on GET ✅
- `@Roles('OWNER', 'FINANCE_MANAGER')` on POST ✅
- `@UsePipes(new ValidationPipe({ whitelist: true }))` ✅
- `deletedAt: null` in both `companyInfo.findFirst` calls ✅
- `journalLine.aggregate` scoped to `journalEntry.status: 'POSTED', deletedAt: null` ✅

### Warnings
1. **`intercompany/dto/settle-intercompany.dto.ts:7`** — `amount!: number`  
   The DTO declares `amount` as JS `number` (validated by `@IsNumber`). The service immediately wraps it in `new Prisma.Decimal(params.amount)` for the JE, so stored values are safe. However, the pre-flight check in `intercompany.service.ts:88`:
   ```typescript
   if (dto.amount > balance.financeOwesToShop + 0.01)
   ```
   uses JavaScript float comparison where both operands came from `.toNumber()`. For typical Thai baht amounts this is safe (well within 2^53 integer precision), but the `+ 0.01` tolerance approach is ad-hoc. Consider using `Prisma.Decimal` comparison throughout, or at minimum document the tolerance.

2. **`intercompany.service.ts:97`** — `remainingBalance: Math.round((balance.financeOwesToShop - dto.amount) * 100) / 100`  
   Float arithmetic for the response payload (display only, not stored in DB). Same `+ 0.01` tolerance concern. This value is informational and not used for any downstream financial write, so risk is low.

### Info
- The returned `financeOwesToShop` and `shopReceivableFromFinance` are `number` type (from `.toNumber()` after Decimal computation). These are balance display values, not stored — acceptable.
- `InternalServerErrorException` is used for "amount must be positive" in `createInterCompanySettlementJournal` — arguably `BadRequestException` is more appropriate since the caller controls `amount`. Low severity.

### Recommendation: ⚠️ REVIEW
Functionally correct and secure. Two warnings around float comparison in the balance pre-flight check. Worth one code-review pass before merge; no blocking issues for a finance-team-only feature.

---

## Branch 3: `fix/accounting-w2-w4-frontend`

### What It Does
- **Frontend**: Adds `IntercompanySettlementPage.tsx` (287 lines) — displays outstanding IC balance, IC invariant health, settlement history, and settlement form dialog
- **Route**: `/accounting/intercompany` behind `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}` ✅
- **Menu**: Adds "ชำระเงินระหว่างบริษัท" entry under Accounting section
- **Journal W-2/W-4**: Adds early-payoff discount logic in `journal-auto.service.ts`:
  - W-2: `SALES_DISCOUNT_INTEREST (53-1805)` — waived interest written off on early payoff
  - W-4: `SALES_DISCOUNT_COMMISSION (53-1801)` — waived commission on early payoff
  - Legacy contract fallback path (contracts without unearned tracking fields)
- **Receipts fix (W-2)**: `receipts.service.ts` — replaces `SELECT FOR UPDATE` (which missed the first-of-month race) with `pg_advisory_xact_lock(1YYYYMM)` to serialise concurrent receipt number generation within the same month
- Chart-of-accounts: adds `53-1805 Sales Discount on Interest` (FINANCE) and `53-1801 Sales Discount on Commission` (SHOP-side seed)

### Critical Issues
_None found._

- Route is behind `ProtectedRoute` with correct roles ✅
- Uses `useQuery` / `useMutation` from React Query ✅
- Uses `api.get()` / `api.post()` from `@/lib/api` ✅
- `qc.invalidateQueries()` called after settlement (`['intercompany-balance']` + `['intercompany-history']`) ✅
- Uses `toast.success()` / `toast.error()` from sonner ✅
- `QueryBoundary` on both `balanceQ` and `historyQ` ✅
- Semantic design tokens throughout (`bg-muted`, `text-muted-foreground`, `border-border`, `text-primary`, `text-destructive`) — no hardcoded hex colors ✅
- `leading-snug` on Thai text (baht amounts) ✅

### Warnings
1. **`IntercompanySettlementPage.tsx:559`** — `Number(l.debit) > 0` and **line 561** — `Number(cashLine.debit)`  
   `l.debit` is a `Decimal` value serialized as a string from the API. Casting via `Number()` for display-only filtering is pragmatically fine (currency amounts are well within safe integer range), but inconsistent with the project's Decimal discipline. Since this is display logic only (no DB write), this is low risk. Consider `parseFloat(String(l.debit)) > 0` or a helper function for clarity.

2. **`IntercompanySettlementPage.tsx:530`** — `amount: parseFloat(amount)`  
   User-typed string → `parseFloat()` → serialized as JSON number to the API. The backend `@IsNumber` decorator accepts this and the service converts to `Prisma.Decimal` before writing. Standard form-to-API pattern. Risk is limited to exotic decimal inputs by OWNER/FINANCE_MANAGER users who understand they are inputting Thai baht amounts. Acceptable.

### Info
- `Loader2` icon imported but used in `settleMut.isPending` spinner — used correctly.
- `hpLine.credit = sumRemainingDue.toNumber()` in journal service — in-place mutation of a JE line object being built. Functionally correct, minor style note.
- `historyQ` fetches from `/journal-entries?search=IC_SETTLEMENT&limit=50` then filters client-side by description. This is a workaround pending a dedicated settlements history endpoint. Creates an overfetch of up to 50 journal entries. Acceptable for now (OWNER/FINANCE_MANAGER-only page, low traffic).
- `53-1801` added to SHOP chart as "Sales Discount on Commission" but the SHOP extra-accounts seed adds it with `parentCode: '53-18XX'`. Verify this parent group exists in the SHOP seed; owner CSV does not include this group. Low risk since seeds use upsert.

### Recommendation: ⚠️ REVIEW
Feature is well-structured and follows all security/frontend rules. Two minor warnings, both in display layer only. The advisory-lock receipt number fix (W-2) is a genuine correctness improvement worth getting in promptly. Recommend a quick review of the `53-18XX` parent account existence before merge.

---

## Overall Summary

| Branch | Criticals | Warnings | Infos | Verdict |
|--------|-----------|----------|-------|---------|
| `fix/accounting-phase-a2-deferred-income` | 0 | 1 | 2 | ✅ APPROVE |
| `fix/accounting-phase-a3-ic-settlement` | 0 | 2 | 2 | ⚠️ REVIEW |
| `fix/accounting-w2-w4-frontend` | 0 | 2 | 4 | ⚠️ REVIEW |

**No blocking issues.** All three branches can merge after a quick human review of the flagged warnings. The accounting logic itself (Decimal precision, deferred recognition, IC invariant, double-entry balance) is correct throughout.

**Merge order**: A.2 → A.3 → W-2/W-4 (they build sequentially).

---

_Generated by Pre-Merge Guard agent · 2026-04-30_
