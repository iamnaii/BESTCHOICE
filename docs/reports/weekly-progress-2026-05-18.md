# Weekly Progress Report — 2026-05-11 to 2026-05-18

> Generated: 2026-05-18 | Reporter: cto-progress agent

---

## Executive Summary

An exceptionally high-velocity week: **50 commits** shipped across Phase 2 gap closure (5 SPs completed, marked DONE), Sidebar redesign (final 6th SP landed), and **30+ D1 SystemConfig** settings items merged. TypeScript remains at 0 errors. Test count grew from the 577 baseline to **3,132 passing** (of 3,284 total), with 144 failures all attributable to missing `DATABASE_URL` in the CI environment — not code regressions. One open PR is blocked (PENDING_APPROVAL enum dependency); all others are clean to merge.

---

## Git Activity

**Total commits (7 days):** 50  
**Merge commits (squash PRs):** 0 explicit merge commits — all merged via squash strategy

### Key Themes This Week

| Theme | PRs/Commits | Description |
|-------|-------------|-------------|
| **Phase 2 Gap Closure (p2-sp1…sp5)** | #1003–#1009 | CRM Pipeline Kanban, Thai font on e-Tax PDF, Document Number Config UI, Booking/Deposit system, e-Tax XML (ขมธอ.21-2562) + PKCS#7 scaffolding. All 5 SPs merged → Phase 2 CSV gaps marked COMPLETE |
| **Sidebar Redesign (P6)** | #995–#1002 | SP1–SP6 all merged: Hybrid 2-Pills + Gear nav, Accounting Reports gap (Cash Flow, Equity, GL, Inter-co), Tax Module Restructure (VAT+WHT separate forms), SHOP additions (Quote, Drafts, Insurance), Bank Accounts dedicated page (SP6 final), sidebar pill-click revert fix |
| **D1 SystemConfig Settings (A1)** | #906–#988 (30+ items) | Granular runtime toggles across 4 domains: document numbering (D1.1.x), approval workflow (D1.2.x), integrations (D1.3.x), performance/audit (D1.4.x). Includes post_permission guard, reverse_permission guard, settings_access_role guard, VIEWER role (Q4-gated), BullMQ worker concurrency, PII masking toggle, audit log archive, login log toggle |
| **Bug fixes** | #994, #1002 | CI shared-file conflict repair after auto-merger; sidebar pill instant-revert fix |

### Notable Features

- **e-Tax XML** — Full ขมธอ.21-2562 UBL builder with PKCS#7 envelope structure and pluggable RD client (cert injection deferred)
- **Booking/Deposit system** — ระบบจอง/มัดจำ (Booking model + UI) landed as p2-sp4
- **VIEWER role** — New `VIEWER` UserRole added to enum (Q4-gated, conservative default — no write access)
- **Dynamic permission guards** — `PostPermissionGuard`, `ReversePermissionGuard`, `SettingsAccessGuard` all wired to SystemConfig at runtime

---

## Roadmap Status

**Phase:** P2 (Payment & Accounting Structure) gap closure — marked **COMPLETE**  
**Next Phase:** P3 (Tax & Compliance Automation) — June target per roadmap

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — Quick Wins | ✅ DONE | All 7 tasks complete |
| Phase 1 — FINANCE_MANAGER Role | ✅ DONE | Role live + controllers updated |
| Phase 2 — Payment & Accounting | ✅ CSV gaps DONE | 5/5 SPs merged this week. Core accounting structure (TFRS A.4) complete. VAT 60-day, early payoff, bad-debt journals all live |
| Phase 3 — Tax Automation | ⏳ Not started | e-Tax XML foundation landed (p2-sp5) — partial overlap |
| Phase 4 — External Integrations | ⏳ Not started | PEAK, MDM, CHATCONE, GFIN |
| Phase 5 — Revenue & Operations | ⏳ Not started | Commission, Collections, Loyalty |
| Phase 6 — Scale & Polish | ⏳ Not started | Multi-entity split, PWA, PII encryption |

**D1 SystemConfig (parallel track):** ~35+ of estimated ~60 items merged. Approval workflow, dynamic guards, integration toggles, performance settings all landing. Remaining: email delivery, more integration flags.

### Next Steps (recommended)
1. Start Phase 3: ภ.พ.30 monthly VAT report generation (TaxReport model + aggregation)
2. Fix `fix/a1-d1-2-1-5-payroll-pii-audit` blocker — merge D1.2.1.6 enum migration first, then re-merge the approval PR
3. Fix 5 skipped period-guard tests (PR #992 grace-window bug)
4. Fix `networkidle0` type in `documents.service.ts` + `rich-menu-renderer.service.ts` to unblock future puppeteer patch update

---

## Health Dashboard

| Metric | Value | Baseline | Trend |
|--------|-------|----------|-------|
| API Tests (passing) | 3,132 | 577 | ↑ +2,555 |
| API Tests (total) | 3,284 | 577 | ↑ |
| API Test Suites failing | 10 | 0 | ↓ (env-only, see below) |
| Web Tests (passing) | 443 | 129 | ↑ +314 |
| Web Tests (total) | 452 | 129 | ↑ |
| Web Test Files failing | 3 | 0 | ↓ (see below) |
| TypeScript Errors | **0** | 0 | → |
| Critical Vulnerabilities | 0 | — | → |
| High Vulnerabilities | 6 | — | (pre-existing transitive) |
| Merge Guard Issues (Critical) | 1 blocked PR | — | — |
| Open PRs reviewed this week | 10 | — | — |

### API Test Failure Analysis
All 144 failing tests (10 suites) are caused by `PrismaClientInitializationError: DATABASE_URL not found` — these are integration/service tests that attempt real DB connections. **Not code regressions.** Affected suites:
- `other-income` service, maker-checker, doc-number, template (4 suites) — need real Prisma client
- `asset` service, reports, transfer, journal (4 suites) — same
- `depreciation` service (1 suite)
- `overdue/collections-foundation.seed` (1 suite)

These pass in environments with a live Postgres. CI must inject `DATABASE_URL` for integration tests to run.

### Web Test Failure Analysis
3 failing test files, 9 failing tests — all in `useAssetCalculation.test.ts` and related asset hooks. Root cause: `useQuery` called inside a hook that's missing `QueryClientProvider` wrapper in the test environment. The hook `useCoaByCode` calls `useQuery` without a surrounding provider in test renders. Tracked as a test-setup issue, not a logic bug.

---

## Merge Guard Summary (2026-05-17)

**10 PRs reviewed** across 10 merge-guard reports generated this week.

| PR / Branch | Recommendation | Issues |
|-------------|----------------|--------|
| `feat/a1-d1.3.1.3-email-provider` (#961) | ✅ APPROVE | 0 critical, 0 warning |
| `feat/a1-d1.3.2.4-reverse-permission` (#960) | ✅ APPROVE | 0 critical, 0 warning |
| `feat/a1-d1.3.2.3-post-permission` (#959) | ⚠️ APPROVE with note | 0 critical, 1 warning: BRANCH_MANAGER superset widened — needs owner confirmation |
| `feat/a5-tax-disallowed-expense-flag` | ✅ APPROVE | 0 critical, 1 warning (stale-read UX, cosmetic) |
| `fix/a1-d1-2-1-5-payroll-pii-audit` | 🚫 **BLOCK** | **CRIT-1**: `PENDING_APPROVAL` not in `DocumentStatus` enum — will 500 on every call until D1.2.1.6 migration merges |
| `test/a1-d1-1-1-5-normal-balance-drift` | ✅ APPROVE | 0 critical, 1 warning (optional validator arg drift) |
| `fix/ci-test-infrastructure` | ✅ APPROVE | 5 tests skipped (period-lock grace-window bug, tracked PR #992) |
| `feat/a1-d1.1.2.5-doc-number-admin-reset` | ✅ APPROVE | 0 critical |
| `feat/a1-d1.4.2.5-max-concurrent-jobs` | ✅ APPROVE | 0 critical |
| `feat/a1-d1.4.3.6-login-log` | ✅ APPROVE | 0 critical |

**Recurring patterns across reports:**
- `findUniqueOrThrow` without `deletedAt: null` in WHERE (WARN in 2 PRs) — convention drift from `database.md` rule
- AuditService DI chain export verification needed when new modules import JournalModule (INFO in 1 PR)
- Feature-gated (Q4/Q5) stubs throwing `NotImplementedException` by design — acceptable pattern but needs caller-side catch documentation

---

## Code Metrics

| Metric | Count |
|--------|-------|
| TypeScript files (API src) | 1,259 |
| TypeScript/TSX files (Web src) | 723 |
| API module directories | 120 |
| Web page components | 387 |
| Prisma schema models | 40+ |
| E2E test specs | 35+ |

---

## Dependency Audit

### Security Vulnerabilities

| Severity | Count | Details |
|----------|-------|---------|
| Critical | 0 | — |
| High | 6 | `@tootallnate/once` control-flow bug in `teeny-request` → `http-proxy-agent` chain (Google Cloud Storage transitive). Fix requires `@google-cloud/storage@5.18.3` — breaking change. `react-360-view` pulls in ancient `react-scripts`. No fix without dropping these packages |
| Moderate | 4 | `@anthropic-ai/sdk` file-permissions issue (fix = 0.96.0, breaking); `@babel/runtime` RegExp complexity in `react-360-view`→`react-scripts` chain (no fix) |

**Action**: High vulns are all buried in transitive dependencies (`teeny-request`, `react-360-view`) with no non-breaking fix path. No direct exploitable surface in production app. Log for quarterly review.

### Outdated Packages

| Package | Current | Wanted | Latest | Type | Decision |
|---------|---------|--------|--------|------|----------|
| @nestjs/* (6 packages) | 11.1.19 | 11.1.21 | 11.1.21 | patch | ⛔ See below |
| @tiptap/* (9 packages) | 3.23.1 | 3.23.4 | 3.23.4 | patch | ⛔ See below |
| bullmq | 5.76.7 | 5.76.10 | 5.76.10 | patch | ⛔ See below |
| dompurify | 3.4.2 | 3.4.4 | 3.4.4 | patch | ⛔ See below |
| express | 4.22.1 | 4.22.2 | 5.2.1 | patch | ⛔ See below |
| puppeteer / puppeteer-core | 24.43.0 | 24.43.1 | 24.43.1 | patch | ⛔ **Blocked** |
| vitest | 4.1.5 | 4.1.6 | 4.1.6 | patch | ⛔ See below |
| turbo | 2.9.12 | 2.9.14 | 2.9.14 | patch | ⛔ See below |
| @aws-sdk/* (2) | 3.1045.0 | 3.1048.0 | 3.1048.0 | minor | ⏭ Skipped |
| @sentry/* (3) | 10.52.0 | 10.53.1 | 10.53.1 | minor | ⏭ Skipped |
| @line/liff | 2.28.0 | 2.29.0 | 2.29.0 | minor | ⏭ Skipped |
| @anthropic-ai/sdk | 0.88.0 | 0.88.0 | 0.96.0 | major | ⏭ Skipped |
| @dnd-kit/sortable | 8.0.0 | 8.0.0 | 10.0.0 | major | ⏭ Skipped |
| @prisma/client | 6.19.3 | 6.19.3 | 7.8.0 | major | ⏭ **Never** (pinned at 6.x) |

### Patch Update Attempt — REVERTED

`npm update --save` was run and all packages updated to `wanted` versions. TypeScript check **failed** immediately:

```
src/modules/contracts/documents.service.ts(1531,37):
  error TS2322: Type '"networkidle0"' is not assignable to type '"load" | "domcontentloaded" | ...'.

src/modules/line-oa/rich-menu/rich-menu-renderer.service.ts(26,37):
  error TS2322: Same error.
```

**Root cause:** puppeteer 24.43.1 removed `"networkidle0"` from its `WaitUntilEvent` type union. Two services use this string literal. The package files were reverted (`git checkout -- package.json package-lock.json apps/*/package.json`) and `npm ci && prisma generate` restored the original state.

**All dep changes reverted. Working tree is clean.**

### Skipped (with reasons)

| Package | Reason |
|---------|--------|
| `puppeteer` (24.43.0→24.43.1) | Patch broke `"networkidle0"` type — requires fixing `documents.service.ts` + `rich-menu-renderer.service.ts` first |
| `@aws-sdk/*` (3.1045→3.1048) | Minor semver bump — conservative skip per policy |
| `@sentry/*` (10.52→10.53.1) | Minor bump — skip, test at lower-traffic time |
| `@line/liff` (2.28→2.29) | Minor bump — LIFF is customer-facing; test in staging first |
| `@anthropic-ai/sdk` (0.88→0.96) | Major — breaking API changes expected |
| `@dnd-kit/sortable` (8→10) | Major — breaking |
| `@prisma/client` (6→7) | **Permanently pinned at 6.x** per CLAUDE.md |
| NestJS, React, Vite | No major version upgrades |

---

## Action Items for Next Week

| Priority | Action | Owner |
|----------|--------|-------|
| 🔴 P0 | Fix `fix/a1-d1-2-1-5-payroll-pii-audit`: merge D1.2.1.6 enum migration first, then fix `PENDING_APPROVAL` cast | Backend |
| 🔴 P0 | Fix `documents.service.ts` + `rich-menu-renderer.service.ts` `networkidle0` → use `'domcontentloaded'` or puppeteer-compatible value, then re-run patch updates | Backend |
| 🟡 P1 | Fix 5 skipped period-lock grace-window tests (PR #992) — injectable clock or `grace=0` fix | Backend |
| 🟡 P1 | Fix web test setup: `useAssetCalculation` tests need `QueryClientProvider` wrapper in renderHook | Frontend |
| 🟡 P1 | Begin Phase 3 — TaxReport model + ภ.พ.30 VAT monthly aggregation | Backend |
| 🟠 P2 | Inject `DATABASE_URL` into CI test runner for integration tests (10 failing suites) | DevOps |
| 🟠 P2 | Get owner confirmation on BRANCH_MANAGER superset widening in PR #959 before merge | Product/Owner |
| 🟠 P2 | Enforce `findUniqueOrThrow + deletedAt: null` pattern (recurring warning in merge guards) | Backend |
| 🟢 P3 | Minor dep updates (Sentry 10.53, @line/liff 2.29, @aws-sdk 3.1048) — stage + verify | DevOps |
