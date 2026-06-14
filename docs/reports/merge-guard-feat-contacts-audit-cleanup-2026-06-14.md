# Merge Guard Report — PR #1150

**Branch**: `feat/contacts-audit-cleanup`
**PR**: [#1150](https://github.com/iamnaii/BESTCHOICE/pull/1150) — feat(contacts): trade-in seller name on contact card + audit cleanup
**Author**: iamnaii
**Base**: `main`
**Review date**: 2026-06-14
**Reviewer**: Pre-Merge Guard (automated)

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

**Total**: 6 files, +55 / -8 — **frontend-only**, no backend or schema changes.

---

## Issues Found

### Critical — None

- No new controllers → guard checks N/A
- No `Number()` on money/financial fields (frontend component, no financial logic)
- No new DB queries → soft-delete check N/A
- No hardcoded secrets or API keys
- No unparameterized `$queryRaw`

### Warning

1. **CI was cancelled, not passed** (`Lint & Test`, `E2E Tests (1)`, `E2E Tests (2)` all show `conclusion: cancelled`). The only completed check is `Merge E2E Reports: success`. The PR description claims "web tsc OK" and "9/9 green" but this was run locally, not via CI.

   - Impact: No CI gate enforced for this PR.
   - Recommendation: Re-trigger CI before merge, or confirm the `feat/contacts-audit-cleanup` branch passes `./tools/check-types.sh all` in CI.

### Info

1. **sellerName null-safety** — the render expression handles `null` correctly via ternary:
   ```tsx
   tradeIn.sellerName
     ? `${tradeIn.sellerName}${tradeIn.sellerPhone ? ` (${tradeIn.sellerPhone})` : ''}`
     : tradeIn.sellerPhone
   ```
   If both are `null`, `Field` receives `undefined` as value — acceptable (renders blank label).

2. **Test coverage is good** — 2 new tests added covering:
   - Seller name display in `TradeInTile` (regression for spec §2)
   - Summary strip hidden on fetch failure (but card still renders)

3. **Docs changes** — 4 spec files updated from `รออนุมัติ` → `✅ DONE` with correct PR/commit references. No content changes.

4. **Grid layout** (`grid grid-cols-2 gap-3`) on `TradeInTile` uses Tailwind semantic classes correctly — no hardcoded hex colors, no `bg-gray-*`/`text-gray-*` violations.

---

## Code Quality Notes

- Change is minimal and focused — only `TradeInTile` function modified
- No new components, no new hooks, no state changes
- No raw `fetch()` calls; no React Query mutations added
- Existing `Field` + `CardLink` pattern reused correctly
- Thai UI text present (`ชื่อผู้ขาย`, `วันที่รับซื้อ`)

---

## CI Status

| Check | Conclusion |
|-------|-----------|
| Merge E2E Reports | ✅ success |
| Lint & Test | ❌ cancelled |
| E2E Tests (1) | ❌ cancelled |
| E2E Tests (2) | ❌ cancelled |
| Deploy jobs | ⏭️ skipped (expected) |

---

## Recommendation

**APPROVE** — with one condition:

> Re-trigger or confirm `Lint & Test` CI passes before merging. The code change itself is clean, minimal, and correctly reviewed. The only concern is the cancelled CI run. If the owner has confirmed local type-check + test pass (as stated in the PR body), this is low-risk to merge.

**No blocking issues found** in the code itself.
