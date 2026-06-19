# Pre-Merge Guard Report

**Branch**: `feat/contacts-audit-cleanup`
**PR**: [#1150](https://github.com/iamnaii/BESTCHOICE/pull/1150) — feat(contacts): trade-in seller name on contact card + audit cleanup
**Author**: Akenarin Kongdach (iamnaii)
**PR Created**: 2026-06-04
**Review Date**: 2026-06-19
**Base**: `main` (sha `3ad5e99c`)
**Head**: `feat/contacts-audit-cleanup` (sha `2d3f74287`)

---

## File Changes Summary

| File | +/- | Type |
|------|-----|------|
| `apps/web/src/pages/ContactDetailPage.tsx` | +14 / -4 | Frontend UI fix |
| `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx` | +37 | New tests |
| `docs/superpowers/specs/2026-06-01-contact-rich-fields-A1-design.md` | +1 / -1 | Doc housekeeping |
| `docs/superpowers/specs/2026-06-02-contact-360-presentation-redesign-design.md` | +1 / -1 | Doc housekeeping |
| `docs/superpowers/specs/2026-06-02-contact-financial-snapshot-C-design.md` | +1 / -1 | Doc housekeeping |
| `docs/superpowers/specs/2026-06-02-contact-hardening-design.md` | +1 / -1 | Doc housekeeping |

**Scope**: Frontend-only. No backend, no Prisma schema, no API changes.

---

## Security Checks

| Check | Result |
|-------|--------|
| New controllers missing `@UseGuards(JwtAuthGuard)` | ✅ No new controllers |
| `Number()` on money/financial fields | ✅ No financial fields touched |
| Missing `deletedAt: null` in queries | ✅ No new DB queries |
| Hardcoded secrets / API keys | ✅ None |
| Missing `@Roles()` decorator | ✅ No new endpoints |
| Unparameterized `$queryRaw` | ✅ None |

---

## Issues Found

### Critical
*None.*

---

### Warning

**[W1] CI checks were CANCELLED — not confirmed passing**

The CI run for this PR shows:
- `Lint & Test` → **cancelled**
- `E2E Tests (1)` → **cancelled**
- `E2E Tests (2)` → **cancelled**
- `Merge E2E Reports` → success (but E2E inputs were cancelled)

The PR author states `web tsc OK` and `ContactDetailPage 9/9 green` in local testing,
but this has NOT been confirmed by the CI pipeline. The PR has been open for 15 days
without a green CI run.

**Action required**: Trigger a fresh CI run before merging to confirm no regressions.

---

### Info

**[I1] `Field` null-value fallback is correct but worth noting**

In `TradeInTile`, when both `sellerName` and `sellerPhone` are null:
```tsx
value={
  tradeIn.sellerName
    ? `${tradeIn.sellerName}${tradeIn.sellerPhone ? ` (${tradeIn.sellerPhone})` : ''}`
    : tradeIn.sellerPhone   // ← null when no phone either
}
```
`Field` renders `null` as `—` via `{value || '—'}`. Behavior is correct and graceful.
No change needed, just documented for awareness.

**[I2] Loose test assertion on badge count**

```tsx
expect(screen.getAllByText('คนขายมือสอง').length).toBeGreaterThan(0);
```

`toBeGreaterThan(0)` is always true if the element exists at all — this assertion
can't catch over-rendering bugs (e.g., 5 badges instead of 2). Low priority since
the immediately following `getByText(/สมชาย \(0899998888\)/)` is the meaningful assertion.
No change required.

**[I3] Phone-only seller scenario**

If `sellerName` is null but `sellerPhone` exists, `Field` receives the bare phone
string (e.g. `0899998888`) with no contextual label. The field is already labelled
`ชื่อผู้ขาย` so this is marginally confusing UI, but matches the existing pattern
used by other tiles. No change needed — owner can decide later whether to add
phone-only formatting.

---

## CI Status

| Check | Result |
|-------|--------|
| Lint & Test | ❌ Cancelled |
| E2E Tests (1) | ❌ Cancelled |
| E2E Tests (2) | ❌ Cancelled |
| Merge E2E Reports | ✅ Success |
| Deploy jobs | Skipped (PR branch — expected) |

---

## Recommendation

**🟡 REVIEW** — Trigger a fresh CI run before merging.

The code change itself is correct and low-risk:
- `Field` handles null gracefully (`|| '—'`)
- Two meaningful new tests added (seller-name display + summary-fetch-failure handling)
- No backend, no security surface, no schema changes
- Doc housekeeping is accurate

The only blocker is that CI was cancelled and has not confirmed passing. Once a
clean `Lint & Test` + `E2E` run shows green (or the E2E cancellations are confirmed
as unrelated to this branch's changes), this PR is safe to merge.
