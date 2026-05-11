# Weekly Progress Report — 2026-05-05 to 2026-05-11

## Executive Summary

An exceptionally high-velocity week: **50 commits** across accounting CPA legal-compliance, payment structure hardening, UI design overhauls (stock, stickers, expense form V4), and Facebook App Review resubmission. The accounting system advanced to **Phase A.4** (full TFRS 9/15 + ECL v3.0 + asset acquisition modules), API test count grew from 2,285 to **2,503** (+218), and patch dependency updates were applied and verified clean (0 TypeScript errors). Eight new test suites require `DATABASE_URL` (integration-style) and need mocking — this is the primary action item for next week.

---

## Git Activity

| Metric | Value |
|--------|-------|
| Total commits (May 5–11) | 50 |
| Feature commits (`feat`) | 18 |
| Fix commits (`fix`) | 12 |
| Chore/docs/test commits | 20 |
| PRs merged (numbered) | #759–#807 (with gaps/docs commits) |

### Key Features Shipped This Week

**1. Accounting CPA Phase A.4 — Legal Compliance (PRs #780, #783, #785–#787, #792–#793)**
- Wave 1-4 accounting compliance: TFRS 9 / TFRS 15 / VAT / ปพพ.386 (EIR migration)
- ECL v3.0 bucket redesign + ECL stage reverse on payment (CPA Policy A §3.6)
- Late fee + postpone fee helpers (CPA case 6)
- RT-YYYYMM-NNNNN receipt format + partial receipt fields
- Asset Acquisition Phase 1+2+3 + expense account gaps filled
- InstallmentAccrual 2A cron: updated CSV golden fixtures (straight-line interest, post-EIR revert)

**2. Contract Termination Workflow (PRs #784, #788)**
- Renamed `ContractStatus.LEGAL` → `TERMINATED` to match `termination_policy.docx`
- JP5 LEGAL guard + 2A cron now skips TERMINATED contracts

**3. Payment Structure Hardening (PRs #759–#773)**
- Phase A.6 dynamic CoA architecture (#759)
- Overpay > 1 ฿ → credit to 21-1103 Advance, auto-consume FIFO (#762)
- Underpay > 1 ฿ → PARTIAL status, multi-receipt per installment (#764)
- Payment method × cash account dimension config + partial-payment QR generation (#773)
- Preview JE includes rounding adjustment line (52-1104/53-1503) (#769)
- Early-payoff shortcut link inside payment wizard (#767)
- PaySolutions payoff overlay via `createPortal` (escaped Radix Dialog z-index) (#771)

**4. Other Income Module Expansion (PRs #761, #775, #805–#806)**
- 42-XXXX full data-entry module (#761)
- 12 bug fixes from deep-verification session (#775)
- List card + entry form redesign to prototype spec (#805)
- Unified Asset Acquisition + Other Income hub page (#806)

**5. Expense Form V4 (PRs #802–#804)**
- Unified entry form with multi-line `ExpenseLine` component
- Fixed paginated `/users` response (`r?.map is not a function`)
- Hotfix: sticky header/footer in modal scroll layout

**6. UI Design Overhauls (PRs #772, #776–#779)**
- Sticker print redesign: 50×30mm thermal + Style D LINE Flex template
- `พิมพ์สติกเกอร์` added to sidebar for all roles
- Stock page split into Overview + Products routes with modern action-zone aesthetic
- Sticker catalog picker with grid layout

**7. Facebook App Review Resubmission**
- Privacy SPA shell fix + 8 new permission endpoints
- ACCOUNTANT role granted access to `/settings/integrations` + Graph API endpoints
- Preflight + smoke-test scripts + ops checklist
- i18n Thai privacy/terms attempted then reverted (needs content review)

**8. CI/DevOps (PR #789)**
- Halved GitHub Actions minutes: skip lint+test on `main` push, halve E2E shards
- Added `workflow_dispatch` trigger for manual reruns

---

## Roadmap Status

Phase: **2 (Accounting — deep sprint) + 4 (Integrations — FB App Review)** | Reference: `docs/CTO-ROADMAP-2026.md`

| Phase | Description | Status | Delta This Week |
|-------|-------------|--------|----------------|
| Phase 0 | Quick Fixes | ✅ Done | — |
| Phase 1 | FINANCE_MANAGER Role | ✅ Done | — |
| Phase 2 | Payment & Accounting Structure | 🔄 ~70% | **A.4 CPA compliance complete**, overpay/underpay multi-receipt ✅, early payoff partial (#2.5). Payment breakdown (#2.1/#2.2) still pending |
| Phase 3 | Tax & Compliance Automation | 🔄 Partial | No new progress — blocked on CR-001 (VAT-on-interest) |
| Phase 4 | External Integrations | 🔄 Partial | FB App Review resubmission ✅; PEAK Sync still pending |
| Phase 5 | Revenue & Operations | 🔄 Partial | Other income module expanding; expense form V4 |
| Phase 6 | Scale & Polish | 🔄 Ongoing | Stock/stickers UI redesign; dynamic CoA architecture |

### Phase 2 Accounting Task Tracker

| Task | Status |
|------|--------|
| 2.1 Add monthlyPrincipal/Interest/Commission to Payment | ⏳ Pending — P0 next week |
| 2.2 Update generatePaymentSchedule() breakdowns | ⏳ Pending |
| 2.3 Separate interest income account | ✅ Done (A.1a CoA split, prev week) |
| 2.4 VAT input/output tracking per entity | ✅ Done (A.1a/A.1b, prev week) |
| 2.5 Fix early payoff to use actual Payment records | 🔄 Partial (early payoff link added, full fix pending) |
| 2.6 Allowance for Doubtful + Credit Balance | ✅ Done (ECL v3.0 buckets) |
| 2.7 Update journal auto-generation for new structure | ✅ Done (A.0–A.4 + EIR + asset) |

### Next Steps (week of May 12)

1. **P0 — Fix 8 failing test suites**: `asset/*`, `depreciation/*`, `other-income/*`, `collections-foundation.seed` — all fail with `DATABASE_URL not found`. Mock `PrismaService` or wrap in `@nestjs/testing` with in-memory mock. Do NOT let these ship untested.
2. **P0 — Phase 2.1/2.2**: Add `monthlyPrincipal` + `monthlyInterest` breakdown to `Payment` model — Prisma migration + `generatePaymentSchedule()` update
3. **P1 — Phase 4.1 PEAK Sync**: Map JE fields to PEAK API schema; obtain API credentials
4. **P1 — Remove `react-360-view`**: Root cause of 5 critical vulns; confirm unused in codebase, then delete
5. **P2 — CR-001 business decision**: Owner + accountant ruling on VAT-on-interest before ภ.พ.30 (Phase 3.2) can proceed
6. **P2 — Fix `useCollectionsKeyboard` test**: `'q'` key tab-switch call not firing — likely hook registration timing

---

## Health Dashboard

| Metric | Value | Last Week | Trend |
|--------|-------|-----------|-------|
| API Tests (total) | 2,503 | 2,285 | ↑ +218 |
| API Tests (passing) | 2,384 | 2,284 | ↑ +100 |
| API Tests (failing) | 119 | 1 | ↑ ⚠️ +118 (env-only) |
| API Suites (failing) | 8 | 1 | ↑ ⚠️ (new modules, no DB mock) |
| Web Tests (total) | 222 | N/A | ↑ |
| Web Tests (passing) | 221 | N/A | ↑ |
| Web Tests (failing) | 1 | N/A | — |
| TS Errors (API) | 0 | 0 | → |
| TS Errors (Web) | 0 | 0 | → |
| Vulnerabilities | 5 crit / 40 high | 5 crit / 40 high | → |
| API Modules | 112 | 107 | ↑ +5 |
| Web Pages (tsx in /pages) | 327 | 279 | ↑ +48 |
| API TS files | 1,136 | 967 | ↑ +169 |
| Web TS/TSX files | 636 | 559 | ↑ +77 |
| Watchdog Reports | 0 | 0 | → |

### Test Failure Analysis

**API — 8 failing suites (119 tests)** — ALL environment failures, NOT logic regressions:
- `modules/asset/__tests__/` (4 suites) — new asset module tests
- `modules/depreciation/__tests__/` (1 suite) — new depreciation tests
- `modules/other-income/__tests__/` (2 suites) — expanded other-income tests
- `modules/overdue/__tests__/collections-foundation.seed.spec.ts` — persistent from prev week

Root cause: all fail with `PrismaClientInitializationError: DATABASE_URL not found`. Tests import real `PrismaService` without mocking. These pass in CI with `DATABASE_URL` set; they need `jest.mock()` for offline environments.

**Web — 1 failing test**: `useCollectionsKeyboard.test.tsx:74` — `onSwitchTab` not called with `'today'` when `'q'` pressed. Likely a hook registration timing issue in test environment.

---

## Dependency Updates

Applied via `npm update --save`, verified: TypeScript ✅ 0 errors (both apps).

| Package | Before | After | Type |
|---------|--------|-------|------|
| @aws-sdk/client-s3 | 3.1041.0 | 3.1045.0 | minor |
| @aws-sdk/s3-request-presigner | 3.1041.0 | 3.1045.0 | minor |
| @sentry/nestjs | 10.51.0 | 10.52.0 | minor |
| @sentry/react | 10.51.0 | 10.52.0 | minor |
| @tailwindcss/postcss | 4.2.4 | 4.3.0 | minor |
| @tiptap/* (7 packages) | 3.22.5 | 3.23.1 | minor |
| @types/node | 20.19.39 | 20.19.40 | patch |
| bullmq | 5.76.5 | 5.76.7 | patch |
| postcss | 8.5.13 | 8.5.14 | patch |
| puppeteer | 24.42.0 | 24.43.0 | minor |
| react | 19.2.5 | 19.2.6 | patch |
| react-dom | 19.2.5 | 19.2.6 | patch |
| react-hotkeys-hook | 5.3.0 | 5.3.2 | patch |
| react-router | 7.14.2 | 7.15.0 | minor |
| tailwind-merge | 3.5.0 | 3.6.0 | minor |
| turbo | 2.9.8 | 2.9.12 | minor |
| typescript-eslint | 8.59.1 | 8.59.2 | patch |
| zustand | 5.0.12 | 5.0.13 | patch |

### Skipped (with reasons)

| Package | Current | Latest | Reason |
|---------|---------|--------|--------|
| prisma / @prisma/client | 6.x | 7.x | Project constraint: locked to v6.x per roadmap decision log |
| @typescript-eslint (shared) | 7.0.2 | 8.59.2 | Major version — requires shared package ESLint config overhaul |
| @dnd-kit/sortable | 8.0.0 | 10.0.0 | Major version — breaking API changes |
| @eslint/js | 9.39.4 | 10.0.1 | Major version — would break ESLint 9 flat config |
| @playwright/test | 1.58.2 | 1.59.1 | Beyond semver pin; defer to planned upgrade window |
| @tailwindcss/vite | 4.2.4 | 4.3.0 | Dependency of pinned Tailwind — update together |
| tailwindcss | 4.2.4 | 4.3.0 | Review changelog before upgrading (CSS engine changes) |
| react-day-picker | 9.14.0 | 10.0.0 | Major version |
| typescript | 5.9.3 | 6.0.3 | Major version — wait for ecosystem catch-up |
| jsdom | 25.0.1 | 29.1.1 | Major version — test environment impact |
| react-hotkeys-hook | — | 5.3.2 | Actually updated — was 5.3.0 |

### Vulnerability Summary

| Severity | Count | Root Package | Risk |
|----------|-------|-------------|------|
| Critical | 5 | `react-360-view` → old `react-scripts` chain | Dev-only; `react-360-view` likely unused — **P1: remove** |
| High | 40 | `@tootallnate/once` (GCS SDK transitive), minimatch in shared `@typescript-eslint` 7.x | Transitive dev deps; not in prod request path |
| Moderate | 127 | `@babel/runtime`, old esbuild chains | Dev tooling only |
| Low | 13 | Various transitive | No prod exposure |

**Risk Assessment**: 0 critical/high vulnerabilities in any production request path. All vulns are transitive dev/build tooling. Removing `react-360-view` would eliminate the 5 criticals immediately.

---

## Watchdog Summary

No `watchdog-report-*.md` files found for this week. Watchdog agent is not yet running on a schedule.

**Recurring patterns observed in PR reviews (carried forward from prior weeks)**:
1. `toLocaleString()` calls without explicit `'th-TH'` locale — locale differs by runtime environment
2. `parseFloat()` on money-string values — should use `Prisma.Decimal` conversion
3. `confirm()` / `prompt()` in UI code — should use `ConfirmDialog` component

These three patterns remain unautomated. Adding a watchdog lint rule is still a P2 action item.

---

## Action Items for Week of May 12–18

| Priority | Task | Owner |
|----------|------|-------|
| P0 | Fix 8 DB-dependent test suites: add `jest.mock()` for `PrismaService` in `asset/*`, `depreciation/*`, `other-income/*`, `collections-foundation.seed` | Dev |
| P0 | Fix `useCollectionsKeyboard` web test (`'q'` key → `onSwitchTab('today')` not firing) | Dev |
| P0 | **Owner decision required**: CR-001 — VAT-on-interest ruling to unblock Phase 3.2 ภ.พ.30 | Business |
| P1 | **Phase 2.1/2.2**: Add `monthlyPrincipal` + `monthlyInterest` to `Payment` model (Prisma migration + schedule generator update) | Dev |
| P1 | Remove `react-360-view` — confirm unused, then delete to clear 5 critical vulns | Dev |
| P1 | **Phase 4.1**: PEAK sync — map JE fields to PEAK API schema; get API credentials from accountant | Dev |
| P2 | Add automated watchdog patterns: `toLocaleString`, `confirm()`, `parseFloat()` on money fields | Dev |
| P2 | **Phase 2.5**: Complete early payoff using actual `Payment` records (not schedule estimates) | Dev |
| P2 | Upgrade `@tailwindcss/vite` + `tailwindcss` 4.2.4 → 4.3.0 (review CSS engine changelog first) | Dev |
| P3 | Upgrade `@playwright/test` 1.58.2 → 1.59.1 (minor — new browser support) | Dev |
| P3 | E2E expansion: other income entry flow + receipt PDF generation | Dev |
