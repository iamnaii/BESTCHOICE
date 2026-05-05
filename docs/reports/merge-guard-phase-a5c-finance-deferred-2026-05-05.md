# Merge Guard Report — phase-a5c-finance-deferred

| Field | Value |
|-------|-------|
| Branch | `phase-a5c-finance-deferred` |
| Author | Akenarin Kongdach |
| Date reviewed | 2026-05-05 |
| Base | `origin/main` |

## File Changes Summary

| Area | Files | Net lines |
|------|-------|-----------|
| Prisma schema + migrations | 3 | +117 |
| `journal/cpa-templates/` (new) | 4 templates + 4 specs | +1 245 |
| `journal/cron/depreciation.cron.ts` | 1 | +76 |
| `journal/journal.module.ts` | 1 | +14 |
| `asset/asset.service.ts` | 1 | +40 |
| `asset/asset.module.ts` | 1 | +2 |
| `asset/dto/asset.dto.ts` | 1 | +29 |
| `accounting/dto/expense.dto.ts` | 1 | +18 |

8 commits — Phase A.5c: monthly straight-line depreciation JEs, asset disposal JEs (gain/loss), WHT accrual + remittance templates, `taxDisallowed` flag on Expense for 54-XXXX routing.

---

## Issues by Severity

### Critical
_None._

---

### Warning

**W1 — `GAIN_ON_DISPOSAL_CODE = '41-1102'` routes asset disposal gains to Repossession Income (`asset-disposal.template.ts:21`)**

```typescript
// TODO: Add dedicated gain-on-disposal income account …
const GAIN_ON_DISPOSAL_CODE = '41-1102'; // interim — see TODO above
```

Per the chart of accounts, `41-1102` is "รายได้จากการยึดสินค้า (Repossession Income)". Using it for asset disposal gains misclassifies PPE gains as HP repossession income in every trial balance and P&L report until the TODO is resolved. This will mislead the accountant and make PEAK reconciliation harder.

Recommend: either add `41-1201 รายได้จากการจำหน่ายสินทรัพย์` to the FINANCE chart (one-line addition to `finance-coa.csv`) before merging, or strictly block disposal with proceeds > NBV until the dedicated account exists (throw `BadRequestException` instead of silently routing to 41-1102).

---

**W2 — Final `findFirst` after disposal missing `deletedAt: null` (`asset.service.ts:~178`)**

```typescript
return {
  ...(await this.prisma.fixedAsset.findFirst({
    where: { id },       // ← no deletedAt: null
    include: { branch: true },
  })),
  journalEntryNo: result.entryNo,
};
```

The prior guard at the top of `dispose()` already validates `deletedAt: null`, so the practical risk here is zero. However it is inconsistent with the project convention that every `findMany` / `findFirst` must include `where: { deletedAt: null }`. Fix: `where: { id, deletedAt: null }`.

---

### Info

**I1 — Legacy asset cost-code derivation is brittle (`asset-disposal.template.ts:~100`)**

```typescript
const lastDigit = parseInt(lastChar, 10);
assetCostCode = accumulatedCode.slice(0, -1) + (lastDigit - 1).toString();
// e.g. "12-2102" → "12-2101"; "12-2104" → "12-2103"
```

Works for the current four-category chart but silently produces wrong account codes if accumulated codes are ever non-sequential or if a new category has a different numbering scheme. Recommend adding a guard that throws `BadRequestException` when the derived code is not found in the chart, rather than proceeding silently.

---

**I2 — `DepreciationCron` exported from `JournalModule` unnecessarily**

```typescript
// journal.module.ts
exports: [
  ...
  // DepreciationCron is listed in providers but NOT in exports — confirmed ✓
]
```

Actually verified: `DepreciationCron` is in `providers` but not in `exports`. No issue.

---

**I3 — WHT PND53 single-step clearance is documented simplification**

`WhtRemittanceTemplate` clears `21-3103 → Cr cash` in one step instead of routing through `21-3202 เจ้าหนี้สรรพากร ภ.ง.ด. 53 รอชำระ`. The template comment explicitly documents this simplification and upgrade path. Acceptable for Phase A.5c.

---

## Positive Findings

- ✅ All new Decimal arithmetic uses `Prisma.Decimal` — zero `Number()` coercions on financial fields.
- ✅ No new controllers introduced — no missing `@UseGuards` risk.
- ✅ DTO validation with Thai error messages on all new fields.
- ✅ `deletedAt: null` present on all primary `findFirst`/`findMany` queries in production code.
- ✅ `DepreciationEntry` has `@@unique([assetId, period])` — cron is idempotent.
- ✅ Sentry capture on each individual asset failure in `DepreciationCron.tick()` — failed assets are logged without aborting the batch.
- ✅ `DepreciationCron` last-day-of-month guard is correct (`tomorrow.getMonth() !== now.getMonth()`).
- ✅ `AssetDisposalTemplate` guards against double-dispose (`DISPOSED` / `WRITTEN_OFF` status check).
- ✅ Journal line balance verified by 4 specs × multiple cases (loss, gain, zero-proceeds, by category).
- ✅ Schema follows rules: UUID PKs, Decimal(12,2) for money, soft-delete on `FixedAsset`, `DepreciationEntry` correctly omits `updatedAt`/`deletedAt` with `/// Immutable` comment.
- ✅ New `AssetStatus.WRITTEN_OFF` enum value and `AssetCategory` enum properly declared.

---

## Recommendation

**REVIEW** — Two Warning items before merge:

1. **(W1, higher priority)** Resolve the `41-1102` interim account for disposal gains before any real disposal transaction with `proceeds > NBV` can occur. The simplest fix is adding `41-1201 รายได้จากการจำหน่ายสินทรัพย์` to `finance-coa.csv` and updating the constant. Alternatively, block the gain path until the account exists.

2. **(W2, low effort)** Add `deletedAt: null` to the final `findFirst` in `asset.service.ts:dispose()`.

Info items can be tracked as follow-on tasks.
