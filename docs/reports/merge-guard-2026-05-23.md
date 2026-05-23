# Pre-Merge Guard Report — 2026-05-23

**Reviewed branches**: 3 code branches (1 hotfix + 2 fix)  
**Skipped**: `docs/exchange-wizard-spec` (documentation only, no executable code)  
**Author (all branches)**: Akenarin Kongdach  
**Guard run**: 2026-05-23

---

## Branch 1 — `hotfix/insurance-wizard-sp1-followups`

### File changes summary
| File | +/- |
|------|-----|
| `apps/api/src/modules/repair-tickets/__tests__/lookup-by-imei.spec.ts` | +119 / -44 |
| `apps/api/src/modules/repair-tickets/repair-tickets.controller.ts` | +2 / -2 |
| `apps/api/src/modules/repair-tickets/repair-tickets.service.ts` | +43 / -22 |
| `apps/web/e2e/insurance-imei-wizard.spec.ts` | +17 / -11 |
| `apps/web/package.json` | +1 / -1 |
| `apps/web/src/pages/insurance/CreateInsuranceWizardPage.test.tsx` | **DELETED** (165 lines) |
| `apps/web/src/pages/insurance/CreateInsuranceWizardPage.tsx` | +65 / -36 |
| `apps/web/src/pages/insurance/WizardSteps/ImeiLookupStep.tsx` | +6 / -2 |

### Security checklist

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level | ✅ Already present on `RepairTicketsController` |
| `@Roles(...)` on modified method (`lookupByImei`) | ✅ `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')` |
| `Number()` on money fields | ✅ None introduced |
| Missing `deletedAt: null` | ✅ Both `product.findFirst` and `sale.findFirst` keep `deletedAt: null` |
| Hardcoded secrets / API keys | ✅ None |
| Raw `fetch()` in React components | ✅ Uses `api.get()` from `@/lib/api` throughout |
| Unparameterized `$queryRaw` | ✅ None |

### Issues found

#### Critical
None.

#### Warning
None.

#### Info

**I1 — `CreateInsuranceWizardPage.test.tsx` deleted without like-for-like replacement**  
`apps/web/src/pages/insurance/CreateInsuranceWizardPage.test.tsx` (165 lines) is removed. The tests covered wizard-step routing logic (step skipping on `?customerId`, bypass-window handling, role-based step variants). The new E2E spec (`insurance-imei-wizard.spec.ts`) covers only two happy-path scenarios and does not replace the unit-level routing coverage.  
Context: the deleted tests mocked old step components (`CustomerPickerStep`, `DevicePickerStep`, `WarrantyPreviewStep`) that no longer exist in the IMEI-first wizard design, so they were genuinely stale. However, the `useEffect`-based redirect for `intent=exchange` and the `presetProductId` path introduced in this hotfix have no corresponding unit tests.  
Recommendation: add unit tests for the redirect `useEffect` (intent=exchange) and the `presetProductId` auto-lookup path before the next release cycle.

**I2 — PDPA branch-scope logic not covered by a FINANCE_MANAGER cross-branch test**  
The new `branchScope` filter in `lookupByImei` is tested for OWNER (cross-branch) and SALES (scoped). `FINANCE_MANAGER` is a cross-branch role per `hasCrossBranchAccess` but has no explicit spec case. Low risk (the utility is shared), but worth a one-liner test for completeness.

### Recommendation: **APPROVE**

The PDPA branch-scoping change is correctly implemented, aligns with the pattern established in `warrantyLookup` (~line 795 of the service), and is backed by 6 new unit tests including cross-branch SALES restriction and OWNER bypass. The deleted test file contained stale mocks for a wizard design that no longer exists. Info items are non-blocking.

---

## Branch 2 — `fix/menu-dedup-and-restructure`

### File changes summary
| File | +/- |
|------|-----|
| `apps/web/src/config/menu.ts` | +26 / -84 |
| `apps/web/src/config/menu.test.ts` | +1 / -1 |
| `apps/web/package.json` | +1 / -1 |

### Security checklist

All checks: ✅ N/A — no backend code, no API calls, no auth-sensitive logic. Pure sidebar configuration.

### Issues found

#### Critical
None.

#### Warning

**W1 — Potential merge conflict with `fix/menu-revenue-dedupe`**  
`fix/menu-dedup-and-restructure` adds `ติดตามลูกค้าค้างชำระ`, `ล็อคเครื่อง (MDM)`, and `ยึดคืนเครื่อง` to `owner-fin-revenue`, while `fix/menu-revenue-dedupe` (also active today, both vs main) removes those same items. Merging both will require a manual conflict resolution on `menu.ts`. Coordinate merge order: if `fix/menu-revenue-dedupe` lands first, `fix/menu-dedup-and-restructure` will need a rebase.

#### Info

**I1 — `owner-fin-collection` section removed; collection links moved to `owner-fin-revenue`**  
The `menu.test.ts` assertion for `owner-fin-collection` was removed and replaced with a comment. This is intentional per the PR (merged section), but the test file loses explicit coverage that the collection section is gone (currently just a comment). Consider adding a `not.toContain('owner-fin-collection')` assertion to prevent regression if the section is accidentally re-added.

### Recommendation: **APPROVE** (coordinate merge order with `fix/menu-revenue-dedupe`)

---

## Branch 3 — `fix/menu-revenue-dedupe`

### File changes summary
| File | +/- |
|------|-----|
| `apps/web/src/config/menu.ts` | 0 / -3 |

### Security checklist

All checks: ✅ N/A — single-file menu config change.

### Issues found

#### Critical
None.

#### Warning

**W1 — Overlapping change with `fix/menu-dedup-and-restructure`**  
Both branches modify `apps/web/src/config/menu.ts` in overlapping regions. `fix/menu-revenue-dedupe` removes 3 items from `owner-fin-revenue` that were ADDED by `fix/menu-dedup-and-restructure`. If merged after `fix/menu-dedup-and-restructure`, this branch's diff will need to be verified or rebased — it currently diffs against the pre-restructure `main` state.

#### Info
None.

### Recommendation: **APPROVE** — merge this BEFORE `fix/menu-dedup-and-restructure`, or rebase after

---

## Summary

| Branch | Critical | Warning | Info | Verdict |
|--------|----------|---------|------|---------|
| `hotfix/insurance-wizard-sp1-followups` | 0 | 0 | 2 | ✅ APPROVE |
| `fix/menu-dedup-and-restructure` | 0 | 1 | 1 | ✅ APPROVE (coordinate order) |
| `fix/menu-revenue-dedupe` | 0 | 1 | 0 | ✅ APPROVE (coordinate order) |

No blocking issues found. The two menu branches should be merged in a coordinated order to avoid a manual conflict on `menu.ts`.
