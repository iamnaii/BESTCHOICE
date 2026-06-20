# Pre-Merge Guard Report

**Date:** 2026-06-20  
**Branch:** `feat/contacts-audit-cleanup`  
**PR:** [#1150](https://github.com/iamnaii/BESTCHOICE/pull/1150) — feat(contacts): trade-in seller name on contact card + audit cleanup  
**Author:** iamnaii  
**Base SHA:** `3ad5e99c` (current `main` tip: `a420359a` — 114 commits ahead)

---

## File Changes Summary

6 files changed, +55 / -8 lines

| File | Change |
|------|--------|
| `apps/web/src/pages/ContactDetailPage.tsx` | +18 / -3 — seller name + phone in TradeIn tile |
| `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx` | +37 / 0 — 2 new tests |
| `docs/superpowers/specs/2026-06-01-contact-rich-fields-A1-design.md` | +1 / -1 — status header |
| `docs/superpowers/specs/2026-06-02-contact-360-presentation-redesign-design.md` | +1 / -1 — status header |
| `docs/superpowers/specs/2026-06-02-contact-financial-snapshot-C-design.md` | +1 / -1 — status header |
| `docs/superpowers/specs/2026-06-02-contact-hardening-design.md` | +1 / -1 — status header |

---

## Issues

### Critical — NONE

No critical issues found:
- No new backend controllers → no missing `@UseGuards` / `@Roles` gaps
- No financial arithmetic → no `Number()` on monetary values
- No new Prisma queries → no missing `deletedAt: null` filters
- No hardcoded secrets or API keys
- No raw SQL (`$queryRaw`)

### Warning

#### W1 — Branch is 114 commits behind `main`; overlapping file may not merge cleanly

`ContactDetailPage.tsx` and `ContactDetailPage.test.tsx` were **both modified in `main` after this PR's base** (`3ad5e99c`):

| Location | PR HEAD (old) | `main` (new) |
|---|---|---|
| `ContactDetailPage.tsx` L39 | `SUPPLIER: 'ผู้ขาย'` | `SUPPLIER: 'ผู้จัดจำหน่าย'` |
| `ContactDetailPage.tsx` L232 | `ผู้ขาย` tile title | `ผู้จัดจำหน่าย` tile title |
| `ContactDetailPage.tsx` L250 | `เปิดข้อมูลผู้ขาย / แก้ไข` | `เปิดข้อมูลผู้จัดจำหน่าย / แก้ไข` |
| `ContactDetailPage.tsx` L517 | `...ผู้ขาย — เพิ่ม role...` | `...ผู้จัดจำหน่าย — เพิ่ม role...` |
| `ContactDetailPage.test.tsx` L89 | `/แก้ไข\|เปิดข้อมูล\|ผู้ขาย/` regex | `/เปิดข้อมูลผู้จัดจำหน่าย/` |
| `ContactDetailPage.test.tsx` L179 | `/ยังไม่ผูก.../ผู้ขาย/` | `/ยังไม่ผูก.../ผู้จัดจำหน่าย/` |

**Risk:** A three-way merge should auto-resolve this cleanly because the edit zones don't overlap (PR touches the TradeIn tile around L293–310; main touches supplier labels at L39, L232, L250, L517). However, if GitHub detects a conflict in the test file, manual resolution would be needed.

**Recommendation:** Before merging, run `git fetch origin main && git rebase origin/main` on the branch to confirm there are no conflicts and tests pass with the combined changes.

### Info

#### I1 — `ContactDetailPage.tsx` is 532 lines

Slightly over the 500-line soft guideline, but this PR adds only 10 net lines. No immediate action needed; worth noting for future refactors (e.g., extracting role-specific tile components).

#### I2 — `as any` cast in test mocks

`(contactsApi.detail as any).mockResolvedValue(...)` and similar are appropriate patterns for Jest vi-mocks in TypeScript. No production code affected.

---

## Code Quality Assessment

### `ContactDetailPage.tsx` — TradeIn tile change

```tsx
<div className="grid grid-cols-2 gap-3">
  <Field
    label="ชื่อผู้ขาย"
    value={
      tradeIn.sellerName
        ? `${tradeIn.sellerName}${tradeIn.sellerPhone ? ` (${tradeIn.sellerPhone})` : ''}`
        : tradeIn.sellerPhone
    }
  />
  <Field label="วันที่รับซื้อ" value={...} />
</div>
```

- Type-safe: `sellerName: string | null` and `sellerPhone: string | null` both defined in `ContactTradeInLink` interface
- Null-safe: `Field` component renders `'—'` fallback when `value` is null/undefined
- Both-null edge case: if both `sellerName` and `sellerPhone` are null, `value` will be `null` → displays `'—'` ✓
- Thai label `"ชื่อผู้ขาย"` is field-level (seller name of trade-in), NOT the supplier role label — correct usage

### New tests

Both tests cover meaningful behavior:
1. `shows the seller name in the trade-in tile` — verifies the new display renders correctly
2. `hides the summary strip when the summary fetch fails` — regression guard for graceful degradation (summary error should not crash the page)

Tests use timezone-safe date strings (`'2026-05-01T03:00:00.000Z'`) consistent with codebase pattern.

---

## Recommendation

**REVIEW** — Logic is correct, no security or data-integrity issues. Merge is blocked only by the stale branch risk (W1).

**Required before merge:**
1. Rebase on `origin/main` and resolve any conflicts in `ContactDetailPage.tsx` / `ContactDetailPage.test.tsx`
2. Run `cd apps/web && npx vitest run src/pages/__tests__/ContactDetailPage.test.tsx` and confirm all 9+ tests pass (including the 2 new ones)

**Optional:**
- If rebasing surfaces test failures on the `ผู้จัดจำหน่าย` assertions, update the regex on PR test line 89 and text on line 179 to match the current main labels
