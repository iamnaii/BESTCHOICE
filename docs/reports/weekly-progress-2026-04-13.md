# Weekly Progress Report — 2026-04-07 to 2026-04-13

## Executive Summary

An extremely high-velocity week: **64 commits** and **5 PRs merged**, culminating in the delivery of the full Unified Chat System (Phase 6, PR #476) — covering LINE/Facebook/TikTok unified inbox, AI-powered features, PWA support, PII column encryption, and role-specific dashboards. Test counts jumped from 577/129 to **751/143** (API/Web). All TypeScript checks pass at 0 errors after this week's patch dependency updates.

---

## Git Activity

| Metric | Value |
|--------|-------|
| Total commits (Apr 07–13) | 64 |
| PRs merged | 5 |
| Earliest commit in window | 2026-04-10 |

### PRs Merged

| PR | Title | Phase |
|----|-------|-------|
| #476 | feat: unified chat system — all 4 phases (engine, adapters, inbox, CRM) | Phase 6 |
| #475 | feat: PWA support + PII encryption utility | Phase 6 |
| #473 | feat: role-specific dashboard layout | Phase 1 |
| #472 | feat: DataAuditModule + HP Receivable journal fix + FINANCE_MANAGER endpoints | Phase 0/1 |
| #471 | chore: Tier 3 dependency upgrades (React 19, Vite 8, Tailwind v4, react-router v7, zod v4, etc.) | Infra |

### Key Features Shipped

**Unified Chat System (PR #476)** — 26/26 features complete:
- Engine: WebSocket gateway, room management, message persistence
- Adapters: LINE Messaging API, Facebook Graph v25, TikTok Business Manager
- Inbox UI: collision detection, AI summary, snooze, SLA alerts, CSAT survey, broadcast, canned variables, auto-assign, emoji, file upload, overdue inbox, payment links, product cards, voice messages, merge conversations, tickets
- After-hours AI, contract creation from chat, command palette, web widget, FB webhook

**PWA + PII Encryption (PR #475):**
- Service worker + offline support + install prompt
- PII column encryption utility (PDPA strict mode foundation)

**Role-Specific Dashboard (PR #473):**
- OWNER / BRANCH_MANAGER / FINANCE_MANAGER / SALES / ACCOUNTANT layouts
- MoM/YoY KPI badges via `getComparativePL`

**Data Audit + Fixes (PR #472):**
- `DataAuditModule` — 12 DB health checks, contract trace engine, daily cron
- Fixed HP Receivable journal (was silent `return null` on unbalanced)
- Fixed FINANCE_MANAGER missing from 6 controller endpoints
- Fixed missing `deletedAt` filters + PII sanitization in audit logs
- Overpaid tolerance handling

**Tier 3 Dependency Upgrades (PR #471):**
- React 18 → 19, Vite 6 → 8, Tailwind CSS v3 → v4
- react-router v6 → v7, zod v3 → v4, zustand v4 → v5
- NestJS v10 → v11, @anthropic-ai/sdk ^0.78 → ^0.88
- ESLint 8 → 9 (flat config)

**Post-merge fixes (direct commits):**
- Docker build: `nest` binary path resolution in Alpine
- `journal-auto` test inputs: `sellingPrice === downPayment + financedAmount`
- Circular dependency fix: `PaySolutionsModule` + CRM unused imports
- Correct Anthropic model IDs (OCR + Finance AI)
- FB Graph v25 + TikTok BM adapter verification against official API docs

---

## Roadmap Status

> Note: `docs/CTO-ROADMAP-2026.md` does not exist. Using `docs/reports/MASTER-PRIORITY-LIST-2026-04-06.md` as roadmap proxy.

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Quick Fixes (deletedAt, PII audit, journal bugs) | ✅ Done (PR #472) |
| Phase 1 | FINANCE_MANAGER Role (role-specific dashboard, 6 endpoints) | ✅ Done (PR #472, #473) |
| Phase 2 | Multi-Entity Foundation (Company model, companyId FK, P&L separation) | ⏳ Pending |
| Phase 3 | Payment & Accounting Structure (principal/interest split) | ⏳ Pending |
| Phase 4 | Tax & Compliance (VAT-on-interest CR-001, Tax reports) | ⏳ Pending — owner decision required |
| Phase 5 | Revenue & Operations (PEAK sync, MDM, GFIN) | ⏳ Pending — awaiting API specs |
| Phase 6 | Integrations & CX (Chat, PWA, BI Dashboard) | ✅ Done ahead of schedule (PR #475, #476) |
| Phase 7 | E2E Test Coverage | 🔄 Ongoing (35 specs, mostly smoke) |
| Phase 8 | UI Redesign (Metronic) | ⏳ Pending — do last |

**Phase 6 was completed 2–3 months ahead of the Q3-Q4 2026 target.**

### Next Steps (recommended week of Apr 14)
1. **Phase 2**: Start `Company` model in Prisma — add `companyId` FK to Branch, Contract, Sale, Expense
2. **Phase 3**: Split HP Receivable into principal + interest fields in payments
3. **Decision needed**: Owner + accountant to resolve CR-001 (VAT on interest) before Phase 4 can start
4. Create `docs/CTO-ROADMAP-2026.md` to replace ad-hoc priority list

---

## Health Dashboard

| Metric | Value | Baseline | Trend |
|--------|-------|----------|-------|
| API Tests | 751 (39 suites) | 577 | ↑ +174 |
| Web Tests | 143 (12 files) | 129 | ↑ +14 |
| TS Errors (API) | 0 | 0 | → |
| TS Errors (Web) | 0 | 0 | → |
| Vulnerabilities | 0 critical / 0 high (audit) — 6 high (transitive, force-only) | — | → |
| Watchdog Reports | 0 (no watchdog-report-*.md this week) | — | — |
| API Modules | 65 | 48 | ↑ +17 |
| Web Pages | 137 | ~55 | ↑ +82 |

### Test Notes
- **751 API tests** across 39 suites — worker force-exit warning present (timer leak, non-critical)
- **143 Web tests** across 12 files (vitest)
- ERROR logs in test output are expected (mocked LINE API failures, S3 errors) — not real failures

---

## Dependency Updates

### What Changed (npm update --save, TypeScript verified ✅)

| Package | Before | After | Type |
|---------|--------|-------|------|
| @nestjs/common | 11.1.18 | 11.1.19 | patch |
| @nestjs/core | 11.1.18 | 11.1.19 | patch |
| @nestjs/platform-express | 11.1.18 | 11.1.19 | patch |
| @nestjs/platform-socket.io | 11.1.17 | 11.1.19 | patch |
| @nestjs/testing | 11.1.18 | 11.1.19 | patch |
| @nestjs/websockets | 11.1.17 | 11.1.19 | patch |
| @nestjs/config | 4.0.3 | 4.0.4 | patch |
| @nestjs/throttler | 6.0.0 | 6.5.0 | minor |
| @aws-sdk/client-s3 | 3.1010.0 | 3.1029.0 | minor |
| @aws-sdk/s3-request-presigner | 3.1010.0 | 3.1029.0 | minor |
| @prisma/client | 6.19.2 | 6.19.3 | patch |
| prisma | 6.19.2 | 6.19.3 | patch |
| @sentry/nestjs | 10.47.0 | 10.48.0 | patch |
| @sentry/react | 10.47.0 | 10.48.0 | patch |
| bullmq | 5.73.0 | 5.73.5 | patch |
| nodemailer | 8.0.4 | 8.0.5 | patch |
| ts-jest | 29.1.2 | 29.4.9 | minor |
| @tanstack/react-query | 5.60.0 | 5.99.0 | minor |
| @tiptap/* | 3.20.1 | 3.22.3 | minor |
| @line/liff | 2.27.3 | 2.28.0 | minor |
| globals | 17.4.0 | 17.5.0 | minor |
| @types/cookie-parser | 1.4.7 | 1.4.10 | minor |
| @types/jest | 29.5.12 | 29.5.14 | patch |

### Skipped (with reasons)

| Package | Reason |
|---------|--------|
| prisma / @prisma/client 7.x | Locked to v6.x per project constraint |
| typescript 6.x | Major version — deferred, requires migration testing |
| @eslint/js 10.x | Major version — would break ESLint flat config |
| eslint 10.x | Major version — deferred |
| @dnd-kit/sortable 10.x | Major version — deferred |
| @types/express 5.x | Major version — deferred |
| @types/bcrypt 6.x | Major version — deferred |
| @types/nodemailer 8.x | Major version — deferred |
| @types/jest 30.x | Major version — deferred |
| jest 30.x | Major version — deferred |
| @playwright/test 1.59.x | Minor — outside semver range, deferred |
| esbuild 0.28.x | Would require `--force`, fixes dev server vuln but breaking change |
| @google-cloud/storage (force) | Breaking change, requires `--force` |

### Remaining Vulnerabilities (12 total, 0 fixable without breaking changes)

| Severity | Package | Fix |
|----------|---------|-----|
| High (x3) | minimatch 9.0.0–9.0.6 (in `packages/shared/@typescript-eslint`) | Force-only — @typescript-eslint major upgrade |
| High (x3) | @tootallnate/once, http-proxy-agent, teeny-request (@google-cloud/storage) | Force-only — breaking GCS downgrade |
| Moderate | esbuild ≤0.24.2 (card-reader devDep) | Force-only — dev server only, low risk |
| Low (x5) | Various transitive | Not fixable without force |

**Risk assessment**: All high-severity vulns are in dev tools (`@typescript-eslint` in `packages/shared`) or GCS SDK transitive deps — not in production request paths. Acceptable to defer.

---

## Watchdog Summary

No `watchdog-report-*.md` files found for this week. Previous reports (Apr 5–6) flagged:
- Missing `deletedAt` filters in several queries → **fixed in PR #472**
- FINANCE_MANAGER missing from controller roles → **fixed in PR #472**
- HP Receivable unbalanced journal silent failure → **fixed in PR #472 (now throws + Sentry)**
- PII in audit logs → **fixed in PR #472**

---

## Action Items for Week of Apr 14–20

| Priority | Task | Owner |
|----------|------|-------|
| P0 | **Owner decision**: VAT on interest (CR-001) — schedule call with accountant | Business |
| P0 | **Owner decision**: Inventory costing method (FIFO/WAC) for Phase 3 | Business |
| P1 | Start Phase 2: `Company` Prisma model + `companyId` FK migration | Dev |
| P1 | Phase 3: Add `principalAmount` + `interestAmount` fields to Payment model | Dev |
| P1 | Create `docs/CTO-ROADMAP-2026.md` to replace ad-hoc priority list | Dev/CTO |
| P2 | Investigate test worker force-exit warning (timer leak in test suite) | Dev |
| P2 | Upgrade `@typescript-eslint` in `packages/shared` to fix 3 high vulns | Dev |
| P2 | E2E coverage: POS Checkout + Contract Signing (now that FINANCE_MANAGER is live) | Dev |
| P3 | Restore `docs/CTO-ROADMAP-2026.md` as living document | CTO |
