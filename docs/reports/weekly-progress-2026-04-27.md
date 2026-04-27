# Weekly Progress Report — 2026-04-21 to 2026-04-27

## Executive Summary

An extraordinary high-velocity week: **198 commits** and **20+ PRs merged**, delivering the complete **Collections v2 system** (10 PRs: foundation → workflow-hub → power-features → legal-letters → hardening → backlog → UI P0–P3), **Yeastar P-Series Cloud PBX integration**, inbox quick-action dialogs, SMS template admin, compliance dashboard, and weekly PDF analytics export. API tests surged from 751 to **2,118** (+1,367 tests, +182%). TypeScript remains at 0 errors; patch dependency updates applied and verified.

---

## Git Activity

| Metric | Value |
|--------|-------|
| Total commits (Apr 21–27) | 198 |
| PRs merged | 20+ |
| Earliest commit | 2026-04-21 |

### PRs Merged (selected)

| PR | Title | Phase |
|----|-------|-------|
| #706 | fix(inbox): send via HTTP + reserve space for MobileBottomNav | Phase 4 |
| #705 | fix: post-ultrareview cleanup — Yeastar PII/OAuth + rich-menu hardening | Phase 4 |
| #702 | feat(yeastar): Yeastar P-Series Cloud Edition PBX integration | Phase 4 |
| #701 | feat(inbox): inline quick-action dialogs + real-time chat fixes | Phase 4 |
| #700 | fix(ui): add Portal to PopoverContent | Infra |
| #699 | fix(inbox): unread count + quick actions popup | Phase 4 |
| #698 | fix(company): make taxId optional when company is not VAT-registered | Phase 2 |
| #697 | chore(scripts): seed/cleanup for collections test data | Infra |
| #696 | fix(customer-intake, contract-docs): UX correctness + cache propagation | Phase 5 |
| #695 | fix(lint): remove eslint-disable for unregistered react-hooks rule | Infra |
| #694 | feat(settings/companies): add company creation dialog with structured address | Phase 2 |
| #693 | feat(collections-ui-p3): guided session, next-best-action, late fee waiver | Phase 5 |
| #692 | feat(collections-ui-p2): voice memo, legal case, skip-tracing wizard | Phase 5 |
| #691 | feat(collections-ui-p1): Customer 360, bulk actions, analytics | Phase 5 |
| #690 | feat(collections-ui-p0): page shell, queue tabs, KPI strip, ContractCard | Phase 5 |
| #689 | feat(collections-backlog): SMS templates, compliance dashboard, PDF reports | Phase 3/5 |
| #688 | feat(collections-hardening): security, perf, compound indexes | Infra |
| #687 | feat(collections-legal-letters): jsPDF letters, evidence, dispatch flow | Phase 5 |
| #686 | feat(collections-power-features): bulk assign, ad-hoc LINE, analytics charts | Phase 5 |
| #685 | feat(collections-workflow-hub): queue tabs, filters, saved presets | Phase 5 |
| #684 | feat(collections-foundation): DB schema, MDM lock, dunning events, crons | Phase 4/5 |

### Key Features Shipped This Week

**Collections v2 System (PRs #684–#693)** — Complete collections operations-room:
- **Foundation**: New DB models (`MdmLockRequest`, `ContractLetter`, `ContractSnooze`, `ContractDailySnapshot`, `FilterPreset`, `CallLog` enums); event-triggered dunning; MDM auto-propose cron
- **Workflow Hub**: `/collections` route + feature-flag hook; Queue/FollowUp/Promise/All tabs; KPI 4-card strip; URL-synced filter drawer; ContractCard with indicator chips; saved filter presets
- **Power Features**: Bulk assign/LINE/propose-lock (100-item cap, atomic); ad-hoc LINE dialog; Customer 360 slide-over (timeline, payment record, related contracts); analytics charts (aging buckets, leaderboard, 5 trend charts)
- **Legal Letters**: jsPDF renderer for 2 letter templates; PDF preview popup; dispatch/delivered/undeliverable state machine; evidence upload + slip enforcement; letter auto-generate cron (09:15 Bangkok)
- **Hardening**: Security throttle, perf `groupBy`, compound FK indexes, SSRF host allowlist on evidence URLs, paginated audit
- **Backlog**: SMS template admin UI with preview + A/B; compliance dashboard (PDPA + LEGAL pipeline + retention); weekly PDF analytics report + on-demand export; voice memo (HOT/GLACIER tiered S3/GCS); skip-tracing wizard; late fee waiver workflow; next-best-action chips; auto-balance exclusions; customer tags + auto-tag cron; DunningRule tag conditions (VIP/HIGH_RISK/BLACKLIST)
- **UI P0–P3**: All frontend phases: page shell, ContractCard, Customer 360 inline LINE panel, trending arrows from 7-day snapshot diff, keyboard shortcuts overlay, undo snackbar, daily mini-KPI strip, letter evidence thumbnails, MDM unlock button, LegalCase attachments, compliance dashboard

**Yeastar P-Series Cloud PBX Integration (PR #702):**
- Full VoIP integration with Yeastar P-Series Cloud Edition
- PII-safe webhook handling, OAuth token management, rich-menu hardening

**Inbox Quick-Actions (PRs #699, #701, #706):**
- Inline quick-action dialogs (no page navigation required)
- Real-time chat fixes, unread count, MobileBottomNav spacing

**Company Settings Dialog (PR #694):**
- Company creation dialog with structured Thai address
- taxId optional for non-VAT entities (#698)

---

## Roadmap Status

Phase: **4–5 (ahead of schedule)** | Using `docs/CTO-ROADMAP-2026.md`

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| Phase 0 | Quick Fixes (deletedAt, PII, journal bugs) | ✅ Done | Completed wk of Apr 7 |
| Phase 1 | FINANCE_MANAGER Role | ✅ Done | Completed wk of Apr 7 |
| Phase 2 | Payment & Accounting Structure | 🔄 Partial | Company model + dialog done; payment principal/interest split (2.1–2.3) pending |
| Phase 3 | Tax & Compliance Automation | 🔄 Partial | PDPA/retention compliance dashboard + PDF reports done this week (#689); ภ.พ.30 report (3.2) pending |
| Phase 4 | External Integrations | 🔄 Partial | **Yeastar PBX** (new, ahead of schedule) + **MDM** (via collections) + **Smart Dunning** ✅; PEAK Sync pending |
| Phase 5 | Revenue & Operations | 🔄 Active | **Collections Workflow ✅ COMPLETE** (massive); Commission active |
| Phase 6 | Scale & Polish | 🔄 Ongoing | PWA done; BI partial; Multi-entity SHOP/FINANCE pending |

### Next Steps (week of Apr 28)

1. **Phase 2 priority**: Add `monthlyPrincipal` / `monthlyInterest` breakdown to Payment model — unblocks correct P&L and PEAK sync
2. **Phase 4.1**: PEAK journal sync — design API mapping with accountant
3. **CR-001 decision**: Owner + accountant VAT-on-interest ruling still needed before Phase 3 ภ.พ.30 can be finalized
4. **1 failing test**: Fix `collections-foundation.seed.spec.ts` — seed spec attempts real DB upsert; should be wrapped in proper mock or moved to integration test suite
5. **E2E expansion**: Collections v2 has smoke tests — expand to full flow coverage for Customer 360 + letter dispatch

---

## Health Dashboard

| Metric | Value | Baseline (last week) | Trend |
|--------|-------|---------------------|-------|
| API Tests | 2,118 (180 suites) | 751 (39 suites) | ↑ +1,367 (+182%) |
| API Test Pass Rate | 2,117 / 2,118 (99.95%) | 751 / 751 | ↓ 1 new failure |
| Web Tests | N/A (API server required for E2E) | 143 (12 files) | — |
| TS Errors (API) | 0 | 0 | → |
| TS Errors (Web) | 0 | 0 | → |
| Vulnerabilities | 5 crit / 40 high / 138 mod (all transitive) | Same | → |
| API Modules | 106 | 65 | ↑ +41 |
| Web Pages | 80 | 67 | ↑ +13 |
| API TS files | 932 | ~650 | ↑ |
| Web TS/TSX files | 553 | ~400 | ↑ |
| Watchdog Reports | 0 this week | 0 | → |

### Test Notes

- **2,118 API tests** in 180 suites — worker force-exit warning present (timer leak, non-critical, pre-existing)
- **1 failing test**: `collections-foundation.seed.spec.ts:12` — seed spec calls `prisma.user.upsert()` on a real DB (no mock). Test environment has no live DB. Needs mock or reclassification as integration test.
- **ERROR logs in test output** are expected (mocked LINE API, S3, DB-down Sentry captures) — not real failures
- **Web E2E tests** require a running API server at `localhost:3000` — not available in this environment; last known count was 143

---

## Dependency Updates

### Patch Updates Applied — TypeScript verified ✅ (exit 0, both apps)

| Package | Before | After | Type |
|---------|--------|-------|------|
| @aws-sdk/client-s3 | 3.1029.0 | 3.1037.0 | minor |
| @aws-sdk/s3-request-presigner | 3.1029.0 | 3.1037.0 | minor |
| @nestjs/cache-manager | 3.1.0 | 3.1.2 | patch |
| @nestjs/cli | 11.0.19 | 11.0.21 | patch |
| @nestjs/schedule | 6.1.1 | 6.1.3 | patch |
| @nestjs/schematics | 11.0.10 | 11.1.0 | minor |
| @nestjs/swagger | 11.2.7 | 11.4.1 | minor |
| @sentry/nestjs | 10.48.0 | 10.50.0 | minor |
| @sentry/react | 10.48.0 | 10.50.0 | minor |
| @tanstack/react-query | 5.99.0 | 5.100.5 | minor |
| @tiptap/* (9 packages) | 3.22.3 | 3.22.4 | patch |
| axios | 1.15.0 | 1.15.2 | patch |
| bullmq | 5.73.5 | 5.76.2 | patch |
| class-variance-authority | 0.7.0 | 0.7.1 | patch |
| clsx | 2.1.0 | 2.1.1 | patch |
| dompurify | 3.3.3 | 3.4.1 | minor |
| lucide-react | 1.8.0 | 1.11.0 | minor |
| lucide-static | 1.8.0 | 1.11.0 | minor |
| nodemailer | 8.0.5 | 8.0.6 | patch |
| prettier | 3.8.2 | 3.8.3 | patch |
| puppeteer | 24.40.0 | 24.42.0 | patch |
| @radix-ui/react-dropdown-menu | 2.0.6 | 2.1.16 | minor |
| @radix-ui/react-tabs | 1.0.4 | 1.1.13 | minor |
| react / react-dom (web-shop) | 19.0.0 | 19.2.5 | minor |
| react-hook-form | 7.72.1 | 7.74.0 | minor |
| react-router | 7.14.0 | 7.14.2 | patch |
| typescript-eslint | 8.58.1 | 8.59.0 | minor |
| vitest | 4.1.4 | 4.1.5 | patch |

### Skipped (with reasons)

| Package | Reason |
|---------|--------|
| prisma / @prisma/client 7.x | Project constraint: locked to v6.x per `docs/CTO-ROADMAP-2026.md` decision log |
| @anthropic-ai/sdk 0.91.x | Beyond current semver range; requires deliberate upgrade |
| @dnd-kit/sortable 10.x | Major version — breaking API |
| @eslint/js 10.x | Major version — would break ESLint 9 flat config |
| @playwright/test 1.59.x | Minor beyond semver pin; deferred |
| @types/bcrypt 6.x | Major version |
| @types/express 5.x | Major version |
| @types/jest 30.x | Major version |
| @types/nodemailer 8.x | Major version |
| @types/node 25.x | Major version |
| @google-cloud/storage (force) | `--force` required — breaking change, deferred |
| esbuild 0.28.x | `--force` required — dev server only, low risk, deferred |

### Remaining Vulnerabilities (195 total — all transitive, 0 fixable without breaking changes)

| Severity | Count | Root Cause | Risk |
|----------|-------|------------|------|
| Critical | 5 | `react-360-view` → old `react-scripts` chain | Dev-only, likely unused package |
| High | 40 | `@tootallnate/once` (GCS SDK), `babel-preset-react-app` chain | Transitive dev deps only |
| Moderate | 138 | `esbuild ≤0.24.2`, `yargs-parser`, `@babel/runtime` | Dev tooling, not in prod request path |
| Low | 12 | Various transitive | Negligible |

**Risk assessment**: No production request paths affected. All critical/high vulnerabilities are in dev tooling (`react-360-view` is likely unused — consider removing) or GCS SDK transitives. Acceptable to defer until major dependency upgrades.

---

## Watchdog Summary

No `watchdog-report-*.md` files found for the week of Apr 21–27. Previous reports (Apr 5–6, Apr 17) flagged issues that were all resolved in PRs #472, #483, and the ultrareview cleanup (#705).

**Recurring pattern from PR reviews this week**: Several wave-2 fix commits (C1-C3 patterns: `toLocaleString` in JSX, `prompt()`/`confirm()` usage, missing DTO validation) were caught and fixed inline during the collections PRs. These are tracked as recurring issues worth adding to the automated watchdog scan:
- `toLocaleString()` calls in JSX render paths (non-Thai locale formatting)
- `confirm()`/`prompt()` usage (should use `ConfirmDialog`)
- Unguarded `parseFloat()` on money strings (should use `Prisma.Decimal`)

---

## Action Items for Week of Apr 28 – May 4

| Priority | Task | Owner |
|----------|------|-------|
| P0 | Fix `collections-foundation.seed.spec.ts` — mock DB or move to integration suite | Dev |
| P0 | **Owner decision**: CR-001 VAT on interest — schedule call with accountant | Business |
| P1 | **Phase 2**: Add `monthlyPrincipal` + `monthlyInterest` to Payment model + migration | Dev |
| P1 | **Phase 4.1**: PEAK sync — map journal entry fields to PEAK API schema | Dev |
| P1 | Consider removing `react-360-view` — likely unused, responsible for 5 critical vulns | Dev |
| P2 | Add watchdog pattern: scan for `toLocaleString`, `confirm()`, `parseFloat()` on money | Dev |
| P2 | Expand E2E: Collections Customer 360 + letter dispatch flows | Dev |
| P2 | `@anthropic-ai/sdk` 0.88 → 0.91 deliberate upgrade (new features available) | Dev |
| P3 | BI Dashboard (Phase 6.2): cohort + forecast views | Dev |
