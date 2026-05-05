# Merge Guard Report — `phase-a5a-deferred-templates`

**Date:** 2026-05-05  
**Author:** Akenarin Kongdach  
**Branch:** `origin/phase-a5a-deferred-templates`  
**Target:** `main`  
**Diff:** 15 files changed, +1482 / -40

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/accounting/accounting.service.ts` | Modified — wires `ExpenseTemplate` for Phase A.5a |
| `apps/api/src/modules/accounting/bad-debt.service.ts` | Modified — calls `BadDebtProvisionTemplate` |
| `apps/api/src/modules/defect-exchange/defect-exchange.service.ts` | Modified — calls `DefectExchangeReversalTemplate` |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-provision.template.ts` | NEW |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-provision.template.spec.ts` | NEW — 141 lines |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.ts` | NEW |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.spec.ts` | NEW — 140 lines |
| `apps/api/src/modules/journal/cpa-templates/defect-exchange-reversal.template.ts` | NEW |
| `apps/api/src/modules/journal/cpa-templates/defect-exchange-reversal.template.spec.ts` | NEW — 117 lines |
| `apps/api/src/modules/journal/cpa-templates/expense.template.ts` | NEW |
| `apps/api/src/modules/journal/cpa-templates/expense.template.spec.ts` | NEW — 213 lines |
| `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.ts` | NEW |
| `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.spec.ts` | NEW — 129 lines |
| `apps/api/src/modules/journal/journal.module.ts` | Modified — exports new templates |
| `apps/api/src/modules/receipts/receipts.service.ts` | Modified — calls `ReceiptVoidReversalTemplate` |

---

## Critical Issues

**None.**

No new controllers, no unguarded endpoints, no `$queryRaw`, no hardcoded secrets. New templates use `Prisma.Decimal` throughout. New `findFirst`/`findMany` queries in template files include `deletedAt: null`.

---

## Warning Issues

### W-1 — Transaction Isolation Break: `DefectExchangeReversalTemplate` inside `$transaction`

**File:** `apps/api/src/modules/defect-exchange/defect-exchange.service.ts`

```typescript
// Inside this.prisma.$transaction(async (tx) => { ... })
try {
  await this.defectExchangeReversalTemplate.reverseContract(oldContract.id);
} catch (err) { ... }
```

`DefectExchangeReversalTemplate.reverseContract()` uses `this.prisma` (global `PrismaService`), not the `tx` transaction client. If the enclosing `$transaction` later rolls back, the reversal JEs are already committed — orphaned JEs with no corresponding business event. Conversely, if the JE call itself throws, the `catch` swallows it and the contract closes with no reversal accounting.

**Fix:** Move the non-blocking JE call to after the `$transaction` resolves:

```typescript
const result = await this.prisma.$transaction(async (tx) => { ... });
// Non-blocking — post-tx
try {
  await this.defectExchangeReversalTemplate.reverseContract(oldContractId);
} catch (err) {
  this.logger.error(`[A.5a] DefectExchange reversal JE failed: ${err.message}`);
}
return result;
```

---

### W-2 — Transaction Isolation Break: `ReceiptVoidReversalTemplate` inside `$transaction`

**File:** `apps/api/src/modules/receipts/receipts.service.ts`

Same pattern as W-1. `ReceiptVoidReversalTemplate.voidReceipt()` uses the global `PrismaService`, not the `tx` client inside `$transaction`. A rollback after the JE is committed leaves orphaned reversal JEs with no voided receipt.

**Fix:** Move the template call to after the `$transaction` resolves.

---

### W-3 — Duplicate `CATEGORY_CODE_MAP` (manual-sync risk)

**Files:**
- `apps/api/src/modules/accounting/accounting.service.ts` (existing map)
- `apps/api/src/modules/journal/cpa-templates/expense.template.ts` (new map, comment acknowledges duplication)

Two copies of the same map with a `// Mirrors ... kept in sync manually` comment. Future additions to one will be missed in the other.

**Fix:** Extract to `apps/api/src/modules/journal/cpa-templates/category-code-map.const.ts` and import in both files.

---

### W-4 — Hardcoded cash account `'11-1101'` for all expense payments

**File:** `apps/api/src/modules/accounting/accounting.service.ts`

```typescript
await this.expenseTemplate.execute({
  expenseId: updated.id,
  depositAccountCode: '11-1101', // Default cash account; caller can pass custom in future
  isPaid: true,
});
```

`11-1101` is "เงินสด — สุทธินีย์ คงเดช" (a named cash drawer). Expenses paid from KBank (11-1201), SCB (11-1202), or a different person's drawer will produce JEs crediting the wrong account. The `depositAccountCode` param exists precisely for this — it needs to be wired from the expense record.

**Fix:** Map the expense's existing payment method or bank account to the correct `depositAccountCode` before calling `execute()`.

---

## Info Issues

| # | File | Note |
|---|------|------|
| I-1 | `expense.template.ts` | Uses `11-4101` (ภาษีซื้อ) from the 105-account extended chart; `accounting.md` still says "99 accounts" — doc should be updated |
| I-2 | `defect-exchange-reversal.template.ts` | Reverses all POSTED JEs including any same-day 2A accruals — confirm with CPA that reversing partial-period accruals within the 7-day window is intended |
| I-3 | `bad-debt-writeoff.template.ts` | `deletedAt: null` is correctly placed on `journalEntry` relation; `JournalLine` has no own `deletedAt` so no additional filter needed |
| I-4 | All `*.spec.ts` | Test fixtures use `password: 'x'` — acceptable in test context |
| I-5 | All `*.spec.ts` | Templates directly instantiated (`new XxxTemplate(journal, prisma as any)`) — consistent with existing spec pattern, no action needed |

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning | 4 |
| Info | 5 |

**Recommendation: `REVIEW`**

Branch is structurally sound — correct `Prisma.Decimal` arithmetic, proper idempotency guards, balanced JE assertions in tests, Sentry capture on failures. **Must fix W-1 and W-2 before merge** (transaction isolation bugs can produce orphaned JEs in accounting ledger). W-3 and W-4 can be fixed in the same PR or as fast-follow before the next sprint.
