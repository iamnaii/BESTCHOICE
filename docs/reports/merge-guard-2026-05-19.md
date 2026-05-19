# Pre-Merge Guard Report — 2026-05-19

**Agent**: Pre-Merge Guard  
**Run date**: 2026-05-19  
**Branches reviewed**: 3 of 536 unmerged (selected by recency + code-change surface)

---

## Branch 1 — `feat/owner-q4-viewer-scope`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-19 15:18 BKK  
**Diff**: 7 files · +247 / -46

### File changes summary
| File | Change |
|------|--------|
| `accounting.controller.ts` | Add `'VIEWER'` to 12 `@Roles()` decorators (all GET endpoints) |
| `consolidated.controller.ts` | Add `'VIEWER'` to class-level `@Roles()` |
| `audit.controller.ts` | Add `'VIEWER'` to 4 endpoints incl. `audit/logs` + `audit/verify-chain` |
| `roles.decorator.ts` | Update comment — VIEWER is now live (not future-use) |
| `roles.guard.ts` | Add async SystemConfig gate (`viewer_role_enabled`) + 60 s in-process cache |
| `roles.guard.spec.ts` | **New** — 11 test cases (deny/allow/cache/TTL/fail-closed) |
| `reports.controller.ts` | Add `'VIEWER'` to 7 report endpoints |

### Critical issues
_None._

### Warning issues

**W1 — Test helper exported from production module**  
`apps/api/src/modules/auth/guards/roles.guard.ts` exports `__resetViewerFlagCacheForTests()`. This is a test-only side-effect function leaking into the production module surface.  
Preferred fix: move the cache into a class property (`private viewerFlagCache`) so each test instantiates a fresh guard instance — eliminating the need for the reset function entirely.

**W2 — Policy widening: `audit/logs` + `audit/verify-chain` now accessible to VIEWER**  
Both endpoints were previously `@Roles('OWNER')` and the original decorator comment noted "information leak potential." The PR's comment adds a business justification (CPA / สรรพากร auditors need chain integrity), which is reasonable. However, `audit/logs` returns raw audit log entries for _all_ users — this is PII-adjacent. Recommend explicit written sign-off from owner before merge.

### Info
- `PrismaModule` is `@Global()` — DI injection of `PrismaService` into `RolesGuard` constructor will resolve correctly with no extra module imports needed.
- Fail-closed behavior on DB error (deny VIEWER) is correct security posture.
- 60 s cache TTL is reasonable for a flag that changes rarely (owner toggle).
- Test coverage is thorough: all deny/allow paths covered including cache expiry.

### Recommendation: **REVIEW**
No blocking bugs. W2 (audit log VIEWER access) needs explicit owner sign-off before merge.

---

## Branch 2 — `feat/p4-sp1-financial-reports`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-19 13:13 BKK  
**Diff**: 11 files · +1515 / -51

### File changes summary
| File | Change |
|------|--------|
| `accounting.service.ts` | +179 lines: `getGeneralJournal()`, `getAgingReport()`, `getBadDebtReport()` |
| `accounting.service.spec.ts` | +254 lines: tests for all 3 new methods |
| `accounting.controller.ts` | +36 lines: 3 new GET endpoints (`/aging`, `/bad-debt`, `/general-journal`) |
| `AgingReportPage.tsx` | New frontend page |
| `BadDebtReportPage.tsx` | New frontend page |
| `BalanceSheetPage.tsx` | New frontend page |
| `GeneralJournalPage.tsx` | New frontend page |
| `AgingReportPage.test.tsx` | New frontend test |
| `App.tsx` | Wire 4 pages, remove ComingSoon stubs |
| `menu.ts` | Update menu links |
| `apps/web/package.json` | Minor dependency bump |

### Critical issues

**C1 — `Number()` on Prisma Decimal money fields in `getAgingReport()`**  
`apps/api/src/modules/accounting/accounting.service.ts` (~line 2097):
```ts
const remaining = Number(p.amountDue) - Number(p.amountPaid ?? 0);
```
`p.amountDue` and `p.amountPaid` are `Decimal` columns (`@db.Decimal(12, 2)`). Using `Number()` for arithmetic on Decimal values risks floating-point precision loss (e.g., `1500.05 - 0.05` can yield `1499.9999999...` in IEEE 754). This violates the v4 hardening rule: "0 `Number(_sum` remaining" and `.claude/rules/database.md`: "ใช้ `Decimal` เท่านั้น, ห้ามใช้ Float".

**Fix**: use Decimal arithmetic before converting to number for display:
```ts
const remaining = new Prisma.Decimal(p.amountDue)
  .minus(p.amountPaid ?? new Prisma.Decimal(0));
if (remaining.lessThanOrEqualTo(0)) continue;
// ...
summary[bucket] = new Prisma.Decimal(summary[bucket]).plus(remaining).toNumber();
```

**C2 — `Number()` on Prisma Decimal in `getBadDebtReport()`**  
`apps/api/src/modules/accounting/accounting.service.ts` (~lines 2165, 2175):
```ts
const total = lines.reduce((sum, l) => sum + Number(l.debit ?? 0), 0);
// ...
amount: Number(l.debit ?? 0),
```
Same violation. `l.debit` is a Decimal column. The reduce accumulates as plain JS `number`, which loses Decimal precision on large sums.

**Fix**: use `.toNumber()` on the Decimal instance after safe Decimal arithmetic, or accept that for read-only reporting display the service can call `.toNumber()` at the final output boundary (as the existing service does for other reports — see lines 1608-1620 where Decimal `.toNumber()` is called only at the return boundary). The canonical existing pattern for summation in this service is:
```ts
let total = new Prisma.Decimal(0);
lines.forEach((l) => { total = total.plus(l.debit ?? 0); });
return total.toNumber();
```

### Warning issues

**W1 — `contracts` counter never incremented for multi-contract customers**  
`getAgingReport()` populates `contracts: 1` when creating a new `customerMap` entry, but never increments `contracts` in the `if (existing)` branch. A customer with 3 overdue contracts will show `contracts: 1` in the report. Logic bug (data accuracy).

**W2 — Frontend `Number(n)` in `fmt()` helper for display formatting**  
Multiple new pages define local `fmt(n)` helpers using `Number(n).toLocaleString(...)`. This is **acceptable** — it is display-only formatting at the boundary (receiving already-serialized values from the API response), not financial arithmetic. No action required, noted for clarity.

### Info
- All 4 new pages use `useQuery` + `api.get()` correctly — no raw `fetch()`.
- No mutations on these pages, so `invalidateQueries` not applicable.
- New controller endpoints have `@Roles()` decorators and inherit class-level `@UseGuards(JwtAuthGuard, RolesGuard)`.
- No hardcoded secrets or SQL injection vectors found.
- `deletedAt: null` filter present in `getGeneralJournal()` and `getBadDebtReport()` queries; `getAgingReport()` also includes it.

### Recommendation: **BLOCK**
C1 and C2 are arithmetic precision violations of the established hardening rule. Fix before merge.

---

## Branch 3 — `feat/a1-d1.1.3.2-wht-rates`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-20 00:23 BKK  
**Diff**: 6 files · +169 / -13

### File changes summary
| File | Change |
|------|--------|
| `wht-rates.ts` | **New** — `filterActiveWhtRates()` + `whtRatesToSelectOptions()` pure helpers |
| `wht-rates.test.ts` | **New** — 11 vitest cases covering boundary, future, NaN, mix |
| `ItemLinesSection.tsx` | Refactor: replace 7 inline lines with `whtRatesToSelectOptions(whtRates)` call |
| `useUiFlags.ts` | Add `REPAIR_SERVICE: 'RS'` to `docPrefixes` map |
| `settings.service.spec.ts` | Fix test: 5 → 6 document types (adds `REPAIR_SERVICE`) |
| `D1-settings-implement.md` | Mark D1.1.3.2 and D1.1.3.5 as done |

### Critical issues
_None._

### Warning issues
_None._

### Info
- Clean extraction of inline filter logic into a testable pure helper.
- `filterActiveWhtRates` defaults `now = new Date()` — injection point for testing is preserved.
- Permissive fallback for unparseable `effectiveDate` (include the entry) is intentional and documented in the function comment.
- `REPAIR_SERVICE: 'RS'` prefix addition aligns with SP5 Phase 2 RepairTicket module.

### Recommendation: **APPROVE**

---

## Summary

| Branch | Files | Lines | Critical | Warning | Recommendation |
|--------|-------|-------|----------|---------|----------------|
| `feat/owner-q4-viewer-scope` | 7 | +247/-46 | 0 | 2 | **REVIEW** |
| `feat/p4-sp1-financial-reports` | 11 | +1515/-51 | 2 | 1 | **BLOCK** |
| `feat/a1-d1.1.3.2-wht-rates` | 6 | +169/-13 | 0 | 0 | **APPROVE** |

### Action items

1. **`feat/p4-sp1-financial-reports`** — Fix C1 and C2: replace `Number(decimal)` arithmetic in `getAgingReport()` and `getBadDebtReport()` with `Prisma.Decimal` operations. Also fix the `contracts` counter (W1). Re-run `./tools/check-types.sh all` after fix.

2. **`feat/owner-q4-viewer-scope`** — Confirm with owner that VIEWER access to `GET /audit/logs` and `GET /audit/verify-chain` is intentional. Consider moving `viewerFlagCache` to a class property to remove the `__resetViewerFlagCacheForTests` export.

3. **`feat/a1-d1.1.3.2-wht-rates`** — Ready to merge.
