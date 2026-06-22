# Pre-Merge Guard Review
**Branch:** `feat/contacts-audit-cleanup`
**PR:** #1150 — feat(contacts): trade-in seller name on contact card + audit cleanup
**Author:** iamnaii
**Date:** 2026-06-22
**Base SHA:** `3ad5e99c` → **Head SHA:** `2d3f7428`

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/pages/ContactDetailPage.tsx` | +10 / -4 — TradeInTile shows sellerName + sellerPhone in 2-col grid |
| `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx` | +37 / -0 — 2 new tests |
| `docs/superpowers/specs/2026-06-01-contact-rich-fields-A1-design.md` | +1 / -1 — status updated |
| `docs/superpowers/specs/2026-06-02-contact-360-presentation-redesign-design.md` | +1 / -1 — status updated |
| `docs/superpowers/specs/2026-06-02-contact-financial-snapshot-C-design.md` | +1 / -1 — status updated |
| `docs/superpowers/specs/2026-06-02-contact-hardening-design.md` | +1 / -1 — status updated |

**Total:** 6 files changed, 55 insertions(+), 8 deletions(-)

---

## Issues

### Critical (must fix before merge)
_None found._

- ✅ No new controllers — no missing `@UseGuards`/`@Roles` risk
- ✅ No money/financial calculations — no `Number()` precision risk
- ✅ No Prisma queries — no missing `deletedAt: null` risk
- ✅ No hardcoded secrets or API keys
- ✅ No raw `$queryRaw` SQL

### Warning (should fix)
_None found._

- ✅ No new DTOs — no validation decorator risk
- ✅ No raw `fetch()` / `axios` — uses component display logic only
- ✅ No mutations — no `queryClient.invalidateQueries` gap
- ✅ No hardcoded hex colors (`#…`, `bg-gray-*`, `text-gray-*`)

### Info
- `(contactsApi.detail as any)` and `(customersApi.summary as any)` in test mocks — standard vitest mock cast pattern; not a production concern.

---

## Code Quality Notes

**`ContactDetailPage.tsx` change is correct:**
- `sellerName: string | null` and `sellerPhone: string | null` are properly declared on `ContactTradeInLink` (verified in `apps/web/src/lib/api/contacts.ts:45-50`)
- Null-safe display logic: shows `sellerName (sellerPhone)` when both present, falls back to just `sellerPhone` when name is null
- Uses `leading-snug` on Thai text heading (✅ follows frontend rules)
- Uses semantic tokens (`grid-cols-2 gap-3`) — no hardcoded colors

**Tests are well-structured:**
1. `shows the seller name in the trade-in tile` — covers the new `sellerName` display path directly
2. `hides the summary strip when the summary fetch fails, but still renders the card` — covers a regression path (summary failure should not crash the card); correctly verifies `customersApi.summary` was called (ensures failure path, not silenced query)

**Docs changes:** Housekeeping — updates 4 spec headers from stale `รออนุมัติ` to `✅ DONE` with merge commit references.

---

## Recommendation

**✅ APPROVE**

Small, focused change. UI addition is spec-compliant (contact 360 §2 — seller name + phone on TradeInTile), correctly typed, no regressions introduced. Tests cover both the golden path and the failure path. No security, financial, or data integrity concerns.
