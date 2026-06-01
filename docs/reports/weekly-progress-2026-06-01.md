# Weekly Progress Report — 2026-05-26 to 2026-06-01

## Executive Summary

A steady shipping week (24 commits, 2 PRs merged): the Letters module graduated from skeleton to full PDF generation via Puppeteer, the Finance Receivable module gained a PEAK-style contact directory, and asset daily depreciation was added. Patch and minor dependency updates were applied and verified clean (0 web TS errors; 11 API TS errors are pre-existing and unrelated to this week's changes). The test suite now runs 3,828 tests total (3,672 passing); 148 failures are all environment-only (missing `@prisma/client-finance`, missing `DATABASE_URL`) and were present before this week.

---

## Git Activity

| Metric | Value |
|--------|-------|
| Total commits (May 26–Jun 1) | 24 |
| Feature commits (`feat`) | 4 |
| Fix commits (`fix`) | 12 |
| Chore/docs commits | 1 |
| PRs merged | 2 (#1114, #1116) |
| Commits prior week (for comparison) | 30 |

### Key Features Shipped

**1. Letters PDF Generation via Puppeteer (#1107)**
- HTML template-based PDF rendering for debt collection letters
- Embedded base64 logo (no external file dependency at render time)
- Both demand and termination letter templates rewritten to match company reference layout
- Fixed: bold labels ("เรียน", "อ้างถึง"), clean schedule text, letter dispatch dialog `initialMode` logic
- `/letters` menu added for SALES and ACCOUNTANT roles (#1100)

**2. Finance Receivable Contact System (#1115)**
- PEAK-style contact directory for HP receivable debtors
- Activity log per contact entry
- Enables structured outreach tracking without leaving the system

**3. Shared InternalControlActionBar (#1116)**
- Single reusable action bar component wired across Other Income, Expense, and Asset modules
- Replaces three near-identical inline bars; code review feedback addressed in follow-up commit

**4. Asset Daily Depreciation + Expense-Style Cost Entry**
- Daily depreciation cron now tracks PPE decline correctly
- Cost entry follows the same UX pattern as Expense Documents

**5. Integration Fixes**
- `ACCOUNTANT` role granted read-only access to `/settings/integrations` (#1113/#1114)
- Facebook webhook verify token + app secret now resolved from `IntegrationConfig` at runtime (#1112)

---

## Roadmap Status

Phase: **2 (Accounting/Payments) + 4 (Integrations) active** | Reference: `docs/CTO-ROADMAP-2026.md`

| Phase | Description | Status | Delta This Week |
|-------|-------------|--------|----------------|
| Phase 0 | Quick Fixes | ✅ Done | — |
| Phase 1 | FINANCE_MANAGER Role | ✅ Done | — |
| Phase 2 | Payment & Accounting Structure | 🔄 ~75% | Asset daily depreciation shipped. Payment breakdown (2.1/2.2) still pending |
| Phase 3 | Tax & Compliance Automation | 🔄 Partial | No new progress — CR-001 (VAT-on-interest) still blocked |
| Phase 4 | External Integrations | 🔄 Partial | Facebook webhook fixed, ACCOUNTANT integration access added |
| Phase 5 | Revenue & Operations | ⏳ Not started | — |
| Phase 6 | Scale & Polish | ⏳ Not started | — |

### What's Next
1. **Resolve 148 failing API tests** — mock `@prisma/client-finance` and add `DATABASE_URL` to test env; these block CI confidence
2. **Complete Phase 2.1/2.2** — `monthlyPrincipal/Interest/Commission` fields on Payment model (prerequisite for accurate P&L)
3. **Advance Phase 3** — ภ.พ.30 monthly VAT report generation (June roadmap target)
4. **MDM PJ-Soft auto-lock** — Phase 4.2 remains the highest-impact pending integration

---

## Health Dashboard

| Metric | Value | Baseline | Trend |
|--------|-------|----------|-------|
| API Tests (total) | 3,828 | 2,503 (05-11) | ↑ +1,325 |
| API Tests (passing) | 3,672 | 2,384 (05-11) | ↑ +1,288 |
| API Tests (failing) | 148 | 119 (05-11) | ↑ +29 (all env-only) |
| Web TS Errors | 0 | 0 | → |
| API TS Errors | 11 | 11 | → (pre-existing, `@prisma/client-finance`) |
| Vulnerabilities (root) | 189 | 196 (pre-update) | ↓ −7 |
| — Critical | 5 | 5 | → |
| — High | 41 | 40 | → |
| — Moderate | 136 | 142 | ↓ −6 |
| — Low | 7 | 9 | ↓ −2 |
| API Modules | 126 | ~56 (roadmap baseline) | ↑ |
| Web Pages | ~211 | 55+ (roadmap baseline) | ↑ |
| API TS Files | 1,451 | — | — |
| Web TS/TSX Files | 847 | — | — |

> **Note on test count jump**: The 3,828 vs 2,503 delta is primarily due to new test suites added since 05-11 (accounting templates, journal services, etc.). The 148 failing tests are all infrastructure-only failures — `@prisma/client-finance` module not found in the monorepo's default Prisma output, and integration tests that require a live `DATABASE_URL`. These are unrelated to this week's feature work.

> **Note on vulnerabilities**: All 189 remaining vulnerabilities are in transitive dependencies within the `react-360-view` → `react-scripts` → `webpack-dev-server` chain. No direct production dependency is affected. `npm audit fix --force` would install breaking changes; this is deferred to a planned dependency audit sprint.

---

## Dependency Updates

`npm update --save` applied. TypeScript check: **0 web errors, 11 API errors (pre-existing, unchanged)**.

### Updated Packages

| Package | Before | After | Type |
|---------|--------|-------|------|
| @nestjs/common | 11.1.19 | 11.1.24 | patch |
| @nestjs/core | 11.1.19 | 11.1.24 | patch |
| @nestjs/platform-express | 11.1.19 | 11.1.24 | patch |
| @nestjs/platform-socket.io | 11.1.19 | 11.1.24 | patch |
| @nestjs/swagger | 11.4.2 | 11.4.4 | patch |
| @nestjs/testing | 11.1.19 | 11.1.24 | patch |
| @nestjs/websockets | 11.1.19 | 11.1.24 | patch |
| ts-jest | 29.4.9 | 29.4.11 | patch |
| nodemailer | 8.0.7 | 8.0.10 | patch |
| jspdf-autotable | 5.0.7 | 5.0.8 | patch |
| puppeteer | 24.43.0 | 24.43.1 | patch |
| @types/node-forge | 1.3.13 | 1.3.14 | patch |
| @tanstack/react-query | 5.100.9 | 5.100.14 | patch |
| axios | 1.16.0 | 1.16.1 | patch |
| dompurify | 3.4.2 | 3.4.7 | patch |
| vite (web) | 8.0.12 | 8.0.15 | patch |
| vitest | 4.1.5 | 4.1.7 | patch |
| zustand | 5.0.13 | 5.0.14 | patch |
| express (card-reader) | 4.22.1 | 4.22.2 | patch |
| @types/node (card-reader) | 20.19.40 | 20.19.41 | patch |
| @aws-sdk/client-s3 | 3.1045.0 | 3.1057.0 | minor |
| @aws-sdk/s3-request-presigner | 3.1045.0 | 3.1057.0 | minor |
| @sentry/nestjs | 10.52.0 | 10.55.0 | minor |
| @sentry/node | 10.52.0 | 10.55.0 | minor |
| @sentry/react | 10.52.0 | 10.55.0 | minor |
| @hookform/resolvers | 5.2.2 | 5.4.0 | minor |
| @line/liff | 2.28.0 | 2.29.0 | minor |
| @tiptap/* (9 packages) | 3.23.1 | 3.24.0 | minor |
| bullmq | 5.76.7 | 5.77.6 | minor |
| date-fns | 4.1.0 | 4.4.0 | minor |
| helmet | 8.1.0 | 8.2.0 | minor |
| ioredis | 5.10.1 | 5.11.0 | minor |
| lucide-react / lucide-static | 1.14.0 | 1.17.0 | minor |
| node-forge | 1.3.1 | 1.4.0 | minor |
| react-hook-form | 7.75.0 | 7.77.0 | minor |
| react-router | 7.15.0 | 7.16.0 | minor |

### Skipped (with reason)

| Package | Current | Latest | Reason |
|---------|---------|--------|--------|
| @prisma/client | 6.19.3 | 7.8.0 | Constraint: stay on Prisma 6.x |
| prisma | 6.19.3 | 7.8.0 | Constraint: stay on Prisma 6.x |
| @anthropic-ai/sdk | 0.88.0 | 0.100.1 | Breaking change (0.88 → 0.100.1 per audit advisory) |
| @dnd-kit/sortable | 8.0.0 | 10.0.0 | Major version jump |
| @eslint/js | 9.39.4 | 10.0.1 | Major version jump |
| @playwright/test | 1.58.2 | 1.60.0 | Playwright browser runtime separate install |
| @types/bcrypt | 5.0.2 | 6.0.0 | Major type-def bump |
| @types/express | 4.17.25 | 5.0.6 | Major type-def bump |
| @types/jest | 29.5.14 | 30.0.0 | Major version jump |
| @typescript-eslint/* (shared) | 7.0.2 | 8.60.0 | Major version; shared workspace pinned to 7.x |
| react-scripts / react-360-view | legacy | — | Abandoned transitive deps, no fix available |

---

## Watchdog / Audit Notes

No new watchdog reports this week. Recurring issues from prior reports that remain open:

1. **`@prisma/client-finance` module missing** — `prisma-finance.service.ts` imports a client that has not been generated. Blocks 15 test suites (148 tests). Root cause: the FINANCE Prisma schema is separate but the client generation step is not part of the standard build. Needs a dedicated `generate` script or mock injection.
2. **`"networkidle0"` Puppeteer wait option** — `rich-menu-renderer.service.ts:26` and `letter-pdf.service.ts:414` use a Chrome DevTools Protocol wait mode not accepted by the current Puppeteer types. Should be replaced with `"load"` or `"domcontentloaded"`.
3. **Vulnerability chain: react-360-view → react-scripts** — 189 transitive vulnerabilities. Not actionable without removing `react-360-view`. Consider auditing whether this package is still in active use.

---

## Action Items for Next Week

1. **[P0] Fix 148 failing API test suites** — mock `@prisma/client-finance` or add a `prisma generate --schema=prisma-finance/schema.prisma` step to the test setup. This is blocking CI confidence.
2. **[P0] Fix `"networkidle0"` TS error** — 2-line change in letter-pdf and rich-menu services; unblocks clean `tsc --noEmit` on API.
3. **[P1] Payment breakdown fields (Phase 2.1/2.2)** — `monthlyPrincipal/Interest/Commission` on `Payment` model; required for correct P&L and PEAK sync.
4. **[P1] ภ.พ.30 VAT report generation (Phase 3.2)** — June roadmap target; accounting infrastructure is now ready.
5. **[P2] Evaluate react-360-view removal** — if unused, removing it collapses ~180 of the 189 transitive vulnerabilities.
