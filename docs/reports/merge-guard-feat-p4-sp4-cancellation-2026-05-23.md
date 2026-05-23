# Merge Guard Report — `feat/p4-sp4-cancellation`

**Date:** 2026-05-23  
**Branch:** `feat/p4-sp4-cancellation`  
**Author:** Akenarin Kongdach  
**Commits:** 5  
**Recommendation:** ⚠️ REVIEW — 2 Warning items should be fixed before merge

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/api/src/modules/accounting/accounting.controller.ts` | +18 / 0 |
| `apps/api/src/modules/accounting/accounting.module.ts` | +3 / 0 |
| `apps/api/src/modules/accounting/intercompany-report.service.ts` | +141 (new) |
| `apps/api/src/modules/accounting/intercompany-report.service.spec.ts` | +124 (new) |
| `apps/api/src/modules/contracts/contracts.controller.ts` | +39 / -1 |
| `apps/api/src/modules/contracts/contracts.service.ts` | +216 / 0 |
| `apps/api/src/modules/contracts/contracts.service.spec.ts` | +182 / -1 |
| `apps/api/src/modules/contracts/dto/contract.dto.ts` | +16 / 0 |
| `apps/api/src/modules/journal/cpa-templates/contract-cancellation.template.ts` | +159 (new) |
| `apps/api/src/modules/journal/cpa-templates/contract-cancellation.template.spec.ts` | +179 (new) |
| `apps/api/src/modules/journal/journal.module.ts` | +6 / 0 |
| `apps/api/prisma/schema.prisma` | +43 / 0 |
| `apps/api/prisma/migrations/…/migration.sql` | +58 (new) |
| `apps/web/src/pages/finance/ContractCancellationPage.tsx` | +284 (new) |
| `apps/web/src/pages/finance/IntercompanyReportPage.tsx` | +397 (new) |
| `apps/web/src/config/menu.ts` | +4 / -1 |
| `apps/web/src/App.tsx` | +7 / -1 |
| `apps/web/package.json` | +1 / -1 |

**Total:** ~1,871 insertions, ~7 deletions across 18 files.

---

## What This Branch Does

Implements **P4-SP4: Contract Cancellation + Intercompany Reporting**.

**Contract Cancellation (maker-checker flow):**
- New `ContractCancellation` Prisma model (`contractId`, `status: PENDING|APPROVED|REJECTED`, `refundAmount`, `requestedBy`, `approvedBy`, `reason`).
- Service methods: `requestCancellation`, `approveCancellation`, `rejectCancellation` — all in `$transaction`.
- Approval posts a `ContractCancellationTemplate` JE (reverses the `ContractActivation1A` entry).
- `ContractCancellationPage` shows pending queue; OWNER / FINANCE_MANAGER can approve or reject.

**Intercompany Report (`/finance/interco-report`):**
- `IntercompanyReportService` aggregates `21-1101` (ยอดจัด) + `21-1102` (ค่าคอม) journal lines by period.
- Returns opening balance, accruals, settlements, closing balance per account.
- `IntercompanyReportPage` — date range picker + drill-down table.

---

## Issues by Severity

### Critical
_None._

### Warning

**W1 — `Number()` on Decimal financial aggregates in `IntercompanyReportService`**

`apps/api/src/modules/accounting/intercompany-report.service.ts:90-91`:
```ts
dr: Number(r._sum.debit ?? 0),
cr: Number(r._sum.credit ?? 0),
```
`r._sum.debit` / `r._sum.credit` are `Prisma.Decimal | null` (DB aggregate sums).
Converting to JS `number` before arithmetic violates the "Money: use Decimal, never Float" rule in `.claude/rules/database.md`.

For the interco AP balances involved (potentially in the millions of THB), floating-point drift could produce balance mismatches in the interco report, leading to incorrect closing-balance display.

**Recommended fix:**
```ts
const m = new Map<string, { dr: Prisma.Decimal; cr: Prisma.Decimal }>();
for (const r of rows) {
  m.set(r.accountCode, {
    dr: r._sum.debit ?? new Prisma.Decimal(0),
    cr: r._sum.credit ?? new Prisma.Decimal(0),
  });
}
```
And propagate `Prisma.Decimal` arithmetic through `openingBalance`, `accruals`, `settlements`, `closingBalance` using `.plus()` / `.minus()`, calling `.toNumber()` only at the serialisation boundary (response DTO).

---

**W2 — `refundAmount` typed as `number` in `RequestCancellationDto`**

`apps/api/src/modules/contracts/dto/contract.dto.ts`:
```ts
@IsNumber()
@Min(0, { message: 'จำนวนเงินคืนต้องไม่ติดลบ' })
refundAmount: number;
```

The service correctly converts this to `new Decimal(refundAmount)` before writing to DB, so DB precision is safe. However, the JSON-to-class-validator pipeline accepts a raw JS `number`, meaning a client that sends `"refundAmount": 500.000000000001` (floating-point JSON) would pass validation and be stored as `new Decimal(500.000000000001)` — an imprecise value.

**Recommended fix:** Accept `refundAmount` as a string and validate with a custom `@IsDecimalString()` decorator (as done on other financial DTOs), or add a `@Transform` that rounds to 2dp before validation.

This is not a critical blocker (the amounts are human-entered and tested manually), but it is inconsistent with the project's Decimal discipline.

### Info

- **`IntercompanyReportPage.tsx` is 397 lines** — within the 500-line threshold.
- **`ContractCancellationPage.tsx` is 284 lines** — fine.
- `contract-cancellation.template.ts` correctly uses `new Decimal(l.credit.toString())` / `new Decimal(l.debit.toString())` for the reversal JE arithmetic — Decimal discipline is followed in the JE layer. W1 is isolated to the report aggregation service.
- New `ContractCancellation` Prisma model includes `createdAt`, `updatedAt`, `deletedAt` — timestamps rule satisfied.
- New endpoints in `contracts.controller.ts` and `accounting.controller.ts` all have `@Roles` decorators — no unguarded methods.

---

## Security Checklist

| Check | Result |
|-------|--------|
| `accounting.controller.ts` class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` | ✅ Present |
| `contracts.controller.ts` class-level `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` | ✅ Present |
| New cancellation endpoints have `@Roles(...)` | ✅ OWNER, FINANCE_MANAGER, SALES (appropriately scoped) |
| Approval/rejection restricted to OWNER, FINANCE_MANAGER | ✅ Correct — SALES cannot approve |
| New `interco-report` endpoint role | ✅ OWNER, FINANCE_MANAGER, ACCOUNTANT |
| `ContractCancellation.findMany` includes `deletedAt: null` | ✅ Present |
| `ContractCancellation.findFirst` (duplicate check) includes `deletedAt: null` | ✅ Present |
| `approveCancellation` checks `cancellation.deletedAt` manually after `findUnique` | ✅ Present |
| No raw `fetch()` or `axios` in new pages | ✅ Uses `useQuery` / `useMutation` + `api.*` |
| No hardcoded secrets | ✅ None found |
| No unparameterized `$queryRaw` | ✅ None found |
| Approval `$transaction` atomicity (JE + status update) | ✅ Wrapped in `$transaction` |
| Thai validation messages | ✅ Present on all new DTO fields |

---

## Summary

The feature is well-structured, correctly guarded, and follows the transaction-atomicity pattern. Two items should be addressed before merge to maintain Decimal precision discipline across the accounting layer (W1 is the higher-priority fix). Neither is a data-loss risk at typical Thai phone loan amounts, but both set a precedent that will be harder to fix once more services depend on this shape.
