# Pre-Merge Guard Report
**Branch**: `feat/contacts-audit-cleanup`
**PR**: #1150 — feat(contacts): trade-in seller name on contact card + audit cleanup
**Author**: iamnaii
**Date**: 2026-06-19
**Base**: `main` (sha: `3ad5e99c`)
**Head**: sha `2d3f7428`

---

## File Changes Summary

| File | Status | +/- |
|------|--------|-----|
| `apps/web/src/pages/ContactDetailPage.tsx` | modified | +14 / -4 |
| `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx` | modified | +37 / 0 |
| `docs/superpowers/specs/2026-06-01-contact-rich-fields-A1-design.md` | modified | +1 / -1 |
| `docs/superpowers/specs/2026-06-02-contact-360-presentation-redesign-design.md` | modified | +1 / -1 |
| `docs/superpowers/specs/2026-06-02-contact-financial-snapshot-C-design.md` | modified | +1 / -1 |
| `docs/superpowers/specs/2026-06-02-contact-hardening-design.md` | modified | +1 / -1 |

**Total**: 6 files, +55 / -8 lines. Pure frontend + docs — no backend or Prisma changes.

---

## Issues by Severity

### Critical — None

No critical issues found:
- No new NestJS controllers → guard check N/A
- No money/financial calculations in changed code
- No new Prisma queries → `deletedAt: null` check N/A
- No hardcoded secrets or API keys
- No raw SQL

### Warning

**W1 — CI Cancelled (no confirmed green build)**
- `Lint & Test`: `cancelled`
- `E2E Tests (1)`: `cancelled`
- `E2E Tests (2)`: `cancelled`
- Only `Merge E2E Reports` completed as `success` (depends on E2E which was cancelled)
- The PR has not had a clean CI run. Tests must pass before merge.

**W2 — Pre-existing money type issue noted in spec doc (not introduced by this PR)**
- `2026-06-02-contact-financial-snapshot-C-design.md` status update mentions:
  `outstanding shape = Number(_sum.amountDue) number ตรง ๆ`
- This refers to already-merged code (PR #1122, commit `6255e66c`) — NOT code in this PR.
- However, this is a confirmed Decimal-precision risk in `GET /customers/:id/summary` response
  (using `Number()` on a Prisma `_sum` aggregate of a `Decimal` field violates the
  `apps/api` rule against `Number()` on money). Should be tracked as a separate bug.

### Info

**I1 — Test uses `as any` casts on mocks**
- `(contactsApi.detail as any).mockResolvedValue(...)` and `(customersApi.summary as any).mockRejectedValue(...)`
- Standard test pattern for mock assertions; acceptable.

**I2 — `sellerPhone` can be undefined, handled inline**
- The ternary `tradeIn.sellerName ? ... : tradeIn.sellerPhone` renders `undefined` as `Field value`
  if both `sellerName` and `sellerPhone` are absent. The `Field` component likely handles nullish
  gracefully, but worth a visual check.

---

## Code Review — Changed Logic

```tsx
// ContactDetailPage.tsx — TradeInTile component
<div className="grid grid-cols-2 gap-3">
  <Field
    label="ชื่อผู้ขาย"
    value={
      tradeIn.sellerName
        ? `${tradeIn.sellerName}${tradeIn.sellerPhone ? ` (${tradeIn.sellerPhone})` : ''}`
        : tradeIn.sellerPhone
    }
  />
  <Field
    label="วันที่รับซื้อ"
    value={new Date(tradeIn.createdAt).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}
  />
</div>
```

Logic is correct. Matches spec §2 (show `sellerName + phone` pair). No data fetching changes —
uses existing `tradeInsAsSeller` already loaded by the contact detail query.

---

## Test Coverage

PR adds 2 new tests to `ContactDetailPage.test.tsx`:
1. **Trade-in tile shows seller name** — verifies `สมชาย (0899998888)` renders. ✅ Well-scoped.
2. **Summary fetch failure hides KPI strip but keeps card** — regression test for graceful degradation. ✅ Proves the query was attempted (`toHaveBeenCalledWith`), not silently skipped.

9/9 tests reported green by author. CI should confirm before merge.

---

## CI Status

| Job | Result |
|-----|--------|
| Lint & Test | ❌ cancelled |
| E2E Tests (1) | ❌ cancelled |
| E2E Tests (2) | ❌ cancelled |
| Merge E2E Reports | ✅ success |
| Deploy jobs | ⏭ skipped (expected on non-main) |

CI was cancelled — no green run on record for this PR's head commit.

---

## Recommendation

**REVIEW** — not BLOCK, but not APPROVE until CI completes.

### Required before merge:
1. Re-run CI (`Lint & Test` + `E2E Tests`) and confirm all green.

### Should track separately (not blocking):
- **W2**: `Number(_sum.amountDue)` in `/customers/:id/summary` response (existing code from PR #1122) — raises a `Number()` on money Decimal risk. Should be fixed in a follow-up PR per the `apps/api` money rules.

### Changes in this PR are low-risk:
- No backend changes, no new security surface, no financial logic.
- Two well-written regression tests included.
- Docs status updates are accurate and helpful.
