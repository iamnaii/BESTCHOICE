# Merge Guard Report — `phase-a5a-deferred-templates`

**Date:** 2026-05-13  
**Author:** Akenarin Kongdach  
**Last commit:** 2026-05-04  
**Recommendation:** ⚠️ REVIEW (minor fix before merge)

---

## File Changes Summary

| File | +Lines | −Lines | Notes |
|------|--------|--------|-------|
| `apps/api/src/modules/accounting/accounting.service.ts` | +19 | −10 | Wires ExpenseTemplate, removes Phase A.4 TODO stub |
| `apps/api/src/modules/accounting/bad-debt.service.ts` | +36 | −8 | Wires BadDebtProvisionTemplate + BadDebtWriteOffTemplate |
| `apps/api/src/modules/defect-exchange/defect-exchange.service.ts` | +6 | −20 | Replaces A.4 TODO stub with DefectExchangeReversalTemplate call |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-provision.template.ts` | +96 | 0 | New template |
| `apps/api/src/modules/journal/cpa-templates/bad-debt-writeoff.template.ts` | +145 | 0 | New template |
| `apps/api/src/modules/journal/cpa-templates/defect-exchange-reversal.template.ts` | +158 | 0 | New template |
| `apps/api/src/modules/journal/cpa-templates/expense.template.ts` | +151 | 0 | New template |
| `apps/api/src/modules/journal/cpa-templates/receipt-void-reversal.template.ts` | +116 | 0 | New template |
| `apps/api/src/modules/journal/journal.module.ts` | +15 | 0 | Registers 5 new templates |
| Test specs (5 files) | +740 | 0 | Full spec coverage per template |

**Total:** +1482 / −40 lines, 15 files

---

## Issues Found

### Critical
_None._

### Warning

**W-01** — `accounting.service.ts:407` — Hardcoded `depositAccountCode: '11-1101'` in `ExpenseTemplate.execute()` call  
The `Expense` model already has a `depositAccountCode: String?` field (confirmed in `schema.prisma`). The call ignores it and always uses `'11-1101'` (สุทธินีย์ เงินสด). For expenses that were recorded as paid via bank or a different cash register, the JE will book to the wrong cash account.

```typescript
// accounting.service.ts:407 — current (wrong)
await this.expenseTemplate.execute({
  expenseId: updated.id,
  depositAccountCode: '11-1101', // always สุทธินีย์
  isPaid: true,
});

// suggested fix
await this.expenseTemplate.execute({
  expenseId: updated.id,
  depositAccountCode: updated.depositAccountCode ?? '11-1101',
  isPaid: true,
});
```

### Info

**I-01** — All 5 templates correctly use `Prisma.Decimal` for all money arithmetic. No `Number()` conversion on financial values.

**I-02** — All templates implement idempotency via `findFirst` with `metadata` path filters + `deletedAt: null`. Pattern is consistent with existing v4 templates.

**I-03** — `BadDebtWriteOffTemplate` correctly reads outstanding AR balance from `JournalLine` sums (not a denormalized field), preventing stale-balance write-off.

**I-04** — Non-blocking error handling in all three caller sites (`accounting.service`, `bad-debt.service`, `defect-exchange.service`) — JE failure is captured via Sentry/logger but does not roll back the primary business operation. This is intentional (consistent with prior v4 pattern).

---

## Account Code Verification

| Template | Dr | Cr | CPA Chart ✓ |
|----------|----|----|-------------|
| BadDebtProvision | 51-1103 (ค่าเผื่อหนี้สงสัยจะสูญ เพิ่มในปี) | 11-2102 (ค่าเผื่อ Contra) | ✅ |
| BadDebtWriteOff (no provision) | 51-1102 (หนี้สูญ/ขาดทุนยึด) | 11-2101 (AR Gross) | ✅ |
| BadDebtWriteOff (with provision) | 11-2102 + 51-1102 (remainder) | 11-2101 (AR Gross) | ✅ |
| ExpenseTemplate (paid) | category code + 11-4101 (VAT input) | depositAccountCode | ✅ |
| ExpenseTemplate (unpaid) | category code + 11-4101 | 21-1104 (AP accrued) | ✅ |

---

## Required Fix Before Merge

1. In `accounting.service.ts:407`: change hardcoded `'11-1101'` to `updated.depositAccountCode ?? '11-1101'`
