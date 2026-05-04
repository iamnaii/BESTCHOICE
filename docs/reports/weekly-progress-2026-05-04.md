# Weekly Progress Report — 2026-04-28 to 2026-05-04

## Executive Summary

Another high-velocity week: **47 commits** and **30 PRs merged** (#707–#739), delivering a complete accounting system overhaul (Phases A.0–A.3 with multi-entity CoA, inter-company JE, deferred income, and settlement), a full notification system redesign (V3 Flex Messages, multi-OA routing, PDPA gates, DB-driven templates), a Thai tax-invoice receipt PDF redesign with e-Receipt generation on every payment, and an AI semantic retrieval layer via pgvector + Vertex AI. API test count grew from 2,118 to **2,285** (+167 tests). TypeScript remains at 0 errors; patch dependency updates applied and verified.

---

## Git Activity

| Metric | Value |
|--------|-------|
| Total commits (Apr 28 – May 4) | 47 |
| PRs merged | 30 (#707–#739, with gaps) |
| Earliest commit | `fix(inbox): drop eslint-disable...` (#707) |
| Latest commit | `feat(ai): semantic retrieval via pgvector + Vertex AI` (#739) |

### PRs Merged by Theme

**Accounting System Overhaul (PRs #721–#728)**
| PR | Title |
|----|-------|
| #721 | docs(accounting): 6-layer audit report — system status BROKEN, 79 findings |
| #722 | feat(accounting): Phase A.0 — math + try/catch + webhook + period close |
| #723 | feat(accounting): Phase A.1a — CoA split (SHOP + FINANCE multi-entity) |
| #724 | feat(accounting): Phase A.1b — inter-company JE wiring |
| #725 | fix(accounting): Phase A.1c — JE bug fixes |
| #726 | feat(accounting): Phase A.2 — Deferred income |
| #727 | feat(accounting): Phase A.3 (W-5) — inter-company settlement |
| #728 | feat(accounting): W-2 + W-4 + frontend |

**Notification System Redesign (PRs #731–#736)**
| PR | Title |
|----|-------|
| #731 | feat(notifications): P1 — multi-OA routing + observability |
| #732 | feat(notifications): P2 compliance — Thai debt collection law + PDPA gates |
| #733 | feat(notifications): P3 templates — DB-driven messages + preview + test-send |
| #734 | feat(web): live preview pane in TemplateForm + fix var chips |
| #735 | feat(web): polish TemplateManager table styling |
| #736 | feat(notifications): convert all 19 templates to V3 White Card Flex Messages |

**Receipt System Redesign (unlisted PRs + #715–#716)**
| PR | Title |
|----|-------|
| (unlisted) | feat(receipts): redesign PDF as Thai tax-invoice receipt with QR + signature |
| (unlisted) | feat(payments): generate e-Receipt on every payment event including partial |
| #715 | fix(receipts): replace react-qr-code with qrcode.react to fix modal crash |
| #716 | feat(receipts): simplify ⋯ menu to send-LINE + void only |
| #729 | fix(payments): handle paginated response shape in PaymentHistorySheet |
| #730 | feat(payments): convert payment history Sheet → Modal + multi-transaction view |

**Collections & Contracts (PRs #707–#714, #717–#720, #737)**
| PR | Title |
|----|-------|
| #707 | fix(inbox): drop eslint-disable for unregistered react-hooks rule |
| #709 | fix(trade-in): resolve branchId from user when not in payload |
| #710 | feat(trade-in): branch picker in QuickBuyModal step 1 |
| #712 | feat(collections): promise-to-pay lifecycle redesign |
| #714 | feat(collections): partial-payment-reschedule + escalation guardrail (v2 re-port) |
| #717 | fix(contracts): separate ช่องทาง / ยอด columns in expand panel |
| #718 | feat(inbox): group recent payments by งวด with expandable partials |
| #719 | feat(inbox): render payment Flex Card as preview bubble + fix URL overflow |
| #720 | fix(menu): show ผังบัญชี + ตรวจสอบบัญชี in OWNER sidebar |
| #737 | feat(collections): show date + amount on promise slot chips |

**AI & Chat (PRs #738–#739)**
| PR | Title |
|----|-------|
| #738 | feat(chat): render Flex notifications in staff inbox |
| #739 | feat(ai): semantic retrieval via pgvector + Vertex AI |

### Key Features Shipped This Week

1. **Accounting System Phases A.0–A.3 + W-2/W-4/W-5** — Fixed silent-null journal bug (now throws + Sentry), split CoA into SHOP (109 accounts) and FINANCE (41 accounts), wired inter-company JE with deferred income recognition, added inter-company settlement UI. See `accounting.md` Phase A.1a deviations.

2. **Notification System V3** — All 19 LINE notification templates migrated to V3 White Card Flex format; multi-OA routing (SHOP OA / FINANCE OA per entity); PDPA gates block sends to revoked consent; Thai debt collection law compliance (opt-out, time windows); DB-driven template preview + test-send UI.

3. **Thai Tax-Invoice Receipt** — Complete PDF redesign as proper Thai fiscal receipt (ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ) with QR code, digital signature block, A4-fit layout; e-Receipt auto-generated on every payment including partial payments; backfill script for legacy payments without receipts.

4. **AI Semantic Retrieval** — pgvector embeddings + Vertex AI integration for semantic search over contract/customer data (PR #739).

5. **Promise-to-Pay Lifecycle** — PromiseSlot chips now show date + amount; partial payment reschedule + escalation guardrail wired into collections workflow.

---

## Roadmap Status

Phase: **2 (Accounting — active sprint) + 3 (Notifications — major progress)** | Using `docs/CTO-ROADMAP-2026.md`

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| Phase 0 | Quick Fixes | ✅ Done | Completed wk of Apr 7 |
| Phase 1 | FINANCE_MANAGER Role | ✅ Done | Completed wk of Apr 7 |
| Phase 2 | Payment & Accounting Structure | 🔄 Active sprint | **A.0–A.3 complete this week** — multi-entity CoA, inter-company JE, deferred income, settlement. Payment principal/interest split (2.1–2.3) still pending |
| Phase 3 | Tax & Compliance Automation | 🔄 Partial | V3 Flex templates + PDPA gates this week; ภ.พ.30 report generation (3.2) still pending — blocked on CR-001 decision |
| Phase 4 | External Integrations | 🔄 Partial | MDM (via collections) ✅; Smart Dunning ✅; Yeastar PBX ✅ (last week); PEAK Sync pending |
| Phase 5 | Revenue & Operations | 🔄 Partial | Collections v2 complete (last week); Commission active |
| Phase 6 | Scale & Polish | 🔄 Ongoing | AI layer started (#739); Multi-entity SHOP/FINANCE in progress via accounting phases |

### Progress on Phase 2 Accounting Tasks This Week

| Task | Status |
|------|--------|
| 2.1 Add monthlyPrincipal/Interest/Commission to Payment | ⏳ Pending |
| 2.2 Update generatePaymentSchedule() breakdowns | ⏳ Pending |
| 2.3 Separate interest income account (42-2101) | ✅ Done (A.1a CoA split) |
| 2.4 VAT input/output tracking per entity | ✅ Done (A.1a/A.1b) |
| 2.5 Fix early payoff to use actual Payment records | ⏳ Pending |
| 2.6 Allowance for Doubtful + Credit Balance | ✅ Done (A.1a chart) |
| 2.7 Update journal auto-generation for new structure | ✅ Done (A.0–A.3) |

### Next Steps (week of May 5)

1. **Phase 2.1–2.2**: Add `monthlyPrincipal` + `monthlyInterest` breakdown to Payment model — unblocks PEAK sync and accurate per-installment P&L
2. **CR-001 decision**: Owner + accountant ruling on VAT-on-interest needed before ภ.พ.30 (Phase 3.2) can finalize
3. **Fix known failing test**: `collections-foundation.seed.spec.ts:12` — seed spec calls `prisma.user.upsert()` against real DB (no mock). Wrap in mock or reclassify as integration test.
4. **Phase 4.1 PEAK Sync**: Design JE → PEAK API field mapping with accountant
5. **Consider removing `react-360-view`**: Responsible for 5 critical vulns; likely unused in production

---

## Health Dashboard

| Metric | Value | Baseline (last week) | Trend |
|--------|-------|---------------------|-------|
| API Tests | 2,285 (1 fail) | 2,118 (1 fail) | ↑ +167 |
| API Suites | 196 | 180 | ↑ +16 |
| Web Tests | N/A (API server required) | N/A | — |
| TS Errors (API) | 0 | 0 | → |
| TS Errors (Web) | 0 | 0 | → |
| Vulnerabilities | 0 crit / 0 high (prod paths) | same | → |
| API Modules | 107 | 106 | ↑ +1 |
| Web Pages (tsx in /pages) | 279 | ~270 | ↑ |
| API TS files | 967 | 932 | ↑ +35 |
| Web TS/TSX files | 559 | 553 | ↑ +6 |
| Watchdog Reports | 0 this week | 0 | → |

### Test Notes

- **1 known failing test** (persistent from last week): `collections-foundation.seed.spec.ts:12` — calls `prisma.user.upsert()` on real DB without mock. Not a regression; needs fix (P0 action item).
- **ERROR logs in test output** are expected — mocked LINE API, S3, DB-down Sentry captures. Not real failures.
- **Web E2E tests** require a running API server at `localhost:3000` — not available in this environment.

---

## Dependency Updates

### Updates Applied — TypeScript verified ✅ (0 errors, both apps)

| Package | Before | After | Type |
|---------|--------|-------|------|
| @aws-sdk/client-s3 | 3.1037.0 | 3.1041.0 | minor |
| @aws-sdk/s3-request-presigner | 3.1037.0 | 3.1041.0 | minor |
| @nestjs/swagger | 11.4.1 | 11.4.2 | patch |
| @sentry/nestjs | 10.50.0 | 10.51.0 | minor |
| @sentry/node | 10.50.0 | 10.51.0 | minor |
| @sentry/react | 10.50.0 | 10.51.0 | minor |
| @tanstack/react-query | 5.100.5 | 5.100.9 | patch |
| @tiptap/* (9 packages) | 3.22.4 | 3.22.5 | patch |
| axios | 1.15.2 | 1.16.0 | minor |
| bullmq | 5.76.2 | 5.76.5 | patch |
| dompurify | 3.4.1 | 3.4.2 | patch |
| esbuild (transitive) | 0.24.2 | 0.28.0 | minor |
| globals | 17.5.0 | 17.6.0 | minor |
| lucide-react | 1.11.0 | 1.14.0 | minor |
| lucide-static | 1.11.0 | 1.14.0 | minor |
| nodemailer | 8.0.6 | 8.0.7 | patch |
| react-hook-form | 7.74.0 | 7.75.0 | minor |
| react-hotkeys-hook | 5.2.4 | 5.3.0 | minor |
| react-resizable-panels | 4.10.0 | 4.11.0 | minor |
| typescript-eslint | 8.59.0 | 8.59.1 | patch |
| zod | 4.3.6 | 4.4.3 | minor |

### Skipped (with reasons)

| Package | Current | Latest | Reason |
|---------|---------|--------|--------|
| prisma / @prisma/client | 6.19.3 | 7.8.0 | Project constraint: locked to v6.x per roadmap decision log |
| @anthropic-ai/sdk | 0.88.0 | 0.92.0 | `--force` required (breaking change); deliberate upgrade deferred |
| @dnd-kit/sortable | 8.0.0 | 10.0.0 | Major version — breaking API |
| @eslint/js | 9.39.4 | 10.0.1 | Major version — would break ESLint 9 flat config |
| @playwright/test | 1.58.2 | 1.59.1 | Beyond semver pin; deferred |
| @types/bcrypt | 5.0.2 | 6.0.0 | Major version |
| @types/express | 4.17.25 | 5.0.6 | Major version |
| @types/jest | 29.5.14 | 30.0.0 | Major version |
| @types/nodemailer | 7.0.11 | 8.0.0 | Major version |
| @types/node | 22.19.17 | 25.6.0 | Major version |
| @vitejs/plugin-react (web-shop) | 4.7.0 | 6.0.1 | Major version |
| rxjs | 7.8.1 | 7.8.2 | Pinned by NestJS peer dep constraints |

### Vulnerability Summary

| Severity | Count | Root Cause | Risk |
|----------|-------|------------|------|
| Critical | 5 | `react-360-view` → old `react-scripts` chain | Dev-only, unused package — **consider removing** |
| High | ~40 | `@tootallnate/once` (GCS SDK transitive), `babel-preset-react-app` | Transitive dev deps, not in prod request path |
| Moderate | ~138 | `@babel/runtime`, `esbuild ≤0.24.2` chain | Dev tooling only |

**Risk assessment**: 0 critical/high vulnerabilities in any production request path. All are transitive dev tooling deps. `react-360-view` is the root cause of 5 criticals — likely unused, should be removed.

---

## Watchdog Summary

No `watchdog-report-*.md` files found for the week of Apr 28 – May 4 (no automated watchdog agent running). Last watchdog reports: Apr 5–6 and Apr 17 (all findings resolved in subsequent PRs).

**Recurring patterns from PR reviews this week** (same as last week — not yet automated):
- `toLocaleString()` calls in JSX render paths without explicit Thai locale `'th-TH'`
- `confirm()`/`prompt()` usage in UI code (should use `ConfirmDialog`)
- `parseFloat()` on money strings (should use `Prisma.Decimal`)

These three patterns should be added to an automated watchdog scan. Action item carried forward from last week (P2 priority).

---

## Action Items for Week of May 5 – May 11

| Priority | Task | Owner |
|----------|------|-------|
| P0 | Fix `collections-foundation.seed.spec.ts:12` — mock Prisma or move to integration suite | Dev |
| P0 | **Owner decision required**: CR-001 — VAT-on-interest ruling with accountant | Business |
| P1 | **Phase 2.1–2.2**: Add `monthlyPrincipal` + `monthlyInterest` to Payment model + migration | Dev |
| P1 | **Phase 4.1**: PEAK sync — map JE fields to PEAK API schema; get API creds from accountant | Dev |
| P1 | Remove `react-360-view` — 5 critical vulns, verify it's unused in codebase | Dev |
| P2 | Add watchdog pattern scan: `toLocaleString`, `confirm()`, `parseFloat()` on money | Dev |
| P2 | **Phase 2.5**: Fix early payoff to use actual Payment records (not estimated) | Dev |
| P2 | `@anthropic-ai/sdk` 0.88 → 0.92 deliberate upgrade (new features, security fix) | Dev |
| P3 | Expand E2E: notification send flow + receipt PDF generation | Dev |
| P3 | Phase 6.2 BI Dashboard: cohort + forecast views | Dev |
