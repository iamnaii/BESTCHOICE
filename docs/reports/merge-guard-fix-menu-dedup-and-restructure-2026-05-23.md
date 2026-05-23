# Pre-Merge Guard Report

**Branch**: `fix/menu-dedup-and-restructure`
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>
**Date**: 2026-05-23
**Reviewer**: Pre-Merge Guard Agent

---

## File Changes Summary

| File | Insertions | Deletions | Notes |
|------|-----------|-----------|-------|
| `apps/web/src/config/menu.ts` | +22 | -79 | Core restructure: dedup, section merges, flatten insurance children |
| `apps/web/src/config/menu.test.ts` | +1 | -1 | Remove assertion for deleted `owner-fin-collection` section |

**Total**: 3 files changed, 26 insertions(+), 84 deletions(-)

---

## Issues Found

### Critical
_None found._

### Warning

**W1 — Real accounting pages removed from ACCOUNTANT sidebar with no alternative access**
- File: `apps/web/src/config/menu.ts` (ACCOUNTANT_CONFIG acc-reports section)
- The following routes were removed from the ACCOUNTANT menu:
  - `/profit-loss` (GainLossPage)
  - `/finance/cash-flow` (CashFlowPage — real, lazy-loaded)
  - `/finance/equity-statement` (EquityStatementPage — real)
  - `/finance/general-ledger` (GeneralLedgerPage — real)
  - `/finance/vat` (VatPage — real)
  - `/finance/wht` (WhtPage — real)
  - `/finance/e-tax` (pending)
  - `/finance/vat-auto-journal` (real)
  - `/finance/bank-accounts` (BankAccountsPage — real)
- **Verification**: All these routes exist in `App.tsx` as real lazy-loaded components with `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}`. Removing them from the sidebar means ACCOUNTANT users can only reach them via direct URL — no discoverability.
- **Mitigating factor**: The router still allows ACCOUNTANT to navigate to these pages directly. The change is a UX reduction, not an access control change.
- **Action**: Confirm with owner that this removal is intentional (these are labeled "SP2 — Accounting reports" in the old menu, suggesting they may be considered incomplete/placeholder). If intentional, the comment in the diff (`// SP2 — Accounting reports`) is missing from the new code.

### Info

**I1 — `owner-fin-collection` section removed, links merged into `owner-fin-revenue`**
- `overdue`, `mdm`, and `repossessions` links have been moved from a dedicated "ติดตามหนี้" section into "รายรับ & จัดเก็บ". All 3 links still exist. Test updated with comment.

**I2 — Insurance menu items flattened (children → sibling items)**
- For SALES, BRANCH_MANAGER, and OWNER: the nested `children` under "รับซ่อม/รับประกัน" are replaced with two sibling top-level items (`/insurance` and `/insurance/warranty-check`). Functionally equivalent. Avoids the awkward UX of a parent link that also navigates while having sub-items.

**I3 — `assetMenuSection` extracted as shared constant**
- The `assetMenuSection` constant is now reused by ACCOUNTANT (line 350), FINANCE_MANAGER (line 400), and OWNER (line 555) configs. Keeps the 6 asset sub-links in sync across roles. Clean pattern.

**I4 — Duplicate `/overdue` labels within OWNER config**
- `menu.ts` now has "ติดตามลูกค้าค้างชำระ" (OWNER fin-revenue) alongside "Collection" (OWNER fin-overview) both pointing to `/overdue`. These are in different sections/zones, so not technically a within-section duplicate, but may confuse users who see two separate sidebar entries going to the same page.

---

## Summary

Purely a frontend configuration change with no security surface. The main concern is the removal of real accounting page links from the ACCOUNTANT sidebar (W1). This should be an intentional product decision confirmed with the owner, as accountants will lose sidebar discoverability for several reporting pages. The route-level access control is unchanged — they can still navigate to those pages directly.

**Recommendation: REVIEW**

Confirm W1 (intentional ACCOUNTANT menu reduction) before merging. If confirmed intentional, change to APPROVE.
