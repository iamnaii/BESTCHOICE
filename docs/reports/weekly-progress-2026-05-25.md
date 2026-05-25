# Weekly Progress Report — 2026-05-20 to 2026-05-25

## Executive Summary

A high-velocity week (50 commits, PRs #1049–#1097) dominated by three parallel tracks: **SHOP AI Sales Bot Phase A** (LLM abstraction, Gemini support, editable persona, FB/LINE pathways), **Insurance SP2 device exchange** (same-price swap, sign-then-activate flow, PDPA consent cloning), and **chat/inbox hardening** (Message Template Picker, Messenger profile API, per-channel canned responses). Safe patch dependency updates were applied and verified (0 new TS errors introduced).

---

## Git Activity

| Metric | Value |
|--------|-------|
| Total commits (May 20–25) | 50 |
| Feature commits (`feat`) | 22 |
| Fix/Hotfix commits (`fix`/`hotfix`) | 14 |
| Docs/Debug/Chore commits | 14 |
| PRs shipped | #1049–#1097 (~49 numbered) |

### Key Features Shipped This Week

**1. SHOP AI Sales Bot — Phase A (#1049–#1065)**
- Full `LLMProvider` abstraction — swap Claude / Gemini without changing caller code
- Gemini 2.5-flash dual-mode (Vertex + API key) as new default, bench CLI for Thai-quality comparison
- FB + LINE Shop bot pathways re-enabled; PSID whitelist for staged rollout
- AI features ported to `UnifiedInboxPage` (Phase A.1)
- UI toggle for LLM provider selection (OWNER)
- Editable persona — split `BASE + BOT_EXTRAS`, owner edits via UI
- Anti-hallucinate grounding guard for product prices (`priceMissing` flag instead of dropping)
- AI section split into dedicated sidebar section (not buried in ตั้งค่า)

**2. Insurance / Device Exchange — SP1 + SP2 (#1076–#1090)**
- SP1: IMEI-driven wizard UX — existing warranty status auto-detection
- `DefectExchangePage` refactored to 3-step wizard matching insurance flow
- SP2: same-price device exchange — Case 8 JE chain + maker-checker queue
- Sign-then-activate requirement enforced for exchange contracts (option B)
- PDPA consent cloned from original to new exchange contract
- JE aggregation fix + EXCH doc number + SHOP re-intake blockers resolved

**3. Chat / Inbox Improvements (#1091–#1097)**
- Generated avatar fallback + link-customer-from-chat flow
- Direct Messenger User Profile API (before fallback workaround)
- Message Template Picker + Admin redesign + multi-bubble rich content
- Canned Response Phase 5: per-channel tabs in template editor, Quick Reply postback routing

**4. Menu / Navigation UX (#1070–#1075)**
- FINANCE zone redesign: landing/filters + AI section split
- OWNER sidebar deduplication (remove overdue/mdm/repo from รายรับ, merge ติดตามหนี้)
- Fix bogus access-denied toast for OWNER on Dashboard `/`

**5. Product Installment Calculator (#1071)**
- Interactive BC + GFIN installment calculator on Product Detail page

**6. Privacy / Meta App Review (#1093–#1094)**
- Public `/privacy/data-deletion` instructions page (SPA shell)
- Submission guide docs for Business Asset User Profile Access

---

## Roadmap Status

Phase: **4 (External Integrations — CHATCONE/AI) + 5 (Revenue & Operations — Insurance/Exchange)** | Reference: `docs/CTO-ROADMAP-2026.md`

| Phase | Description | Status | Delta This Week |
|-------|-------------|--------|----------------|
| Phase 0 | Quick Fixes | ✅ Done | — |
| Phase 1 | FINANCE_MANAGER Role | ✅ Done | — |
| Phase 2 | Payment & Accounting Structure | 🔄 ~70% | No new changes |
| Phase 3 | Tax & Compliance Automation | 🔄 Partial | No new changes |
| Phase 4 | External Integrations | 🔄 Active | **CHATCONE-equivalent via UnifiedInbox + AI** ✅; FB Messenger profile API ✅ |
| Phase 5 | Revenue & Operations | 🔄 Active | Insurance SP1 ✅, Exchange SP2 ✅ |
| Phase 6 | Scale & Polish | ⬜ Not started | — |

### Next Steps
1. **Insurance SP2 Repair Tickets** — complete full list/detail/create UI (spec done, impl pending)
2. **Fix PrismaFinanceService TS errors** — 9 pre-existing errors blocking clean API build (`@prisma/client-finance` not generated)
3. **Phase 2 payment breakdown** — `monthlyPrincipal/Interest` fields still pending (#2.1/#2.2)
4. **Canned Response Phase 5 polish** — postback routing needs E2E coverage
5. **Tax automation Phase 3** — blocked on CR-001 (VAT-on-interest CPA sign-off)

---

## Health Dashboard

| Metric | Value | Last Report (05-11) | Trend |
|--------|-------|---------------------|-------|
| API Tests (sampled) | 2,503+ | 2,503 | ↑/→ |
| Web Tests | 222 | 222 | → |
| API TS Errors | 9 (pre-existing) | 0 | ⚠️ new pre-existing |
| Web TS Errors | 0 | 0 | → |
| Vulnerabilities | 5 crit / 40 high | 5 crit / 40 high | → |
| Watchdog Issues | 0 this week | — | — |
| API Modules | 123 | 112 | ↑ +11 |
| Web Pages | 118 (top-level .tsx) | ~100 | ↑ |

> **Note on API TS errors**: 9 errors in `apps/api/src/prisma/prisma-finance.service.ts` — the file references `@prisma/client-finance` (a not-yet-generated dual-DB client for FINANCE entity split). These were present before this week's changes; `npm update` did not introduce them. See Action Items.

---

## Merge Guard Summary (2026-05-17)

Reviewed 3 PRs; **all APPROVE** with only Info-level findings:
- `feat/email-provider`: `ConfigService` injection via global module (fine), `SmtpEmailProvider` swallows failures silently (intentional pattern, callers need `sent` check)
- `feat/reverse-permission`: Dynamic `ReversePermissionGuard` wired correctly, Q4-gated via SystemConfig

No Critical or Warning issues flagged this week.

---

## Dependency Updates

### Applied (patch + minor within semver range)

| Package | Before | After | Type |
|---------|--------|-------|------|
| @nestjs/common | 11.1.19 | 11.1.23 | patch |
| @nestjs/core | 11.1.19 | 11.1.23 | patch |
| @nestjs/platform-express | 11.1.19 | 11.1.23 | patch |
| @nestjs/platform-socket.io | 11.1.19 | 11.1.23 | patch |
| @nestjs/swagger | 11.4.2 | 11.4.4 | patch |
| @nestjs/websockets | 11.1.19 | 11.1.23 | patch |
| @nestjs/testing | 11.1.19 | 11.1.23 | patch |
| @aws-sdk/client-s3 | 3.1045.0 | 3.1053.0 | patch |
| @aws-sdk/s3-request-presigner | 3.1045.0 | 3.1053.0 | patch |
| @sentry/nestjs | 10.52.0 | 10.53.1 | minor |
| @sentry/node | 10.52.0 | 10.53.1 | minor |
| bullmq | 5.76.7 | 5.77.3 | patch |
| helmet | 8.1.0 | 8.2.0 | minor |
| jspdf-autotable | 5.0.7 | 5.0.8 | patch |
| lucide-static | 1.14.0 | 1.16.0 | minor |
| node-forge | 1.3.1 | 1.4.0 | minor |
| nodemailer | 8.0.7 | 8.0.8 | patch |
| puppeteer / puppeteer-core | 24.43.0 | 24.43.1 | patch |
| ts-jest | 29.4.9 | 29.4.11 | patch |
| typescript-eslint | 8.59.2 | 8.59.4 | patch |
| @hookform/resolvers | 5.2.2 | 5.4.0 | minor |
| @tanstack/react-query | 5.100.9 | 5.100.14 | patch |
| axios | 1.16.0 | 1.16.1 | patch |
| express | 4.22.1 | 4.22.2 | patch |

**TypeScript verification**: 0 new errors introduced. API pre-existing errors: 9 (unchanged). Web: 0.

### Skipped (with reasons)

| Package | Current | Latest | Reason |
|---------|---------|--------|--------|
| @prisma/client | 6.19.3 | 7.8.0 | Explicitly prohibited — stay on 6.x |
| prisma | 6.19.3 | 7.8.0 | Explicitly prohibited — stay on 6.x |
| @anthropic-ai/sdk | 0.88.0 | 0.98.0 | Breaking change — requires API code migration |
| @dnd-kit/sortable | 8.0.0 | 10.0.0 | Major version bump |
| @eslint/js | 9.39.4 | 10.0.1 | Major version bump |
| @line/liff | 2.28.0 | 2.29.0 | Minor — LINE API changes risk |
| @playwright/test | 1.58.2 | 1.60.0 | Minor — prefer stability for E2E |
| @types/bcrypt | 5.0.2 | 6.0.0 | Major bump |
| @types/express | 4.17.25 | 5.0.6 | Major bump |
| @types/jest | 29.5.14 | 30.0.0 | Major bump |
| multer (override) | 2.1.1 | — | Override in root package.json — do not touch |

### Security Vulnerabilities (unchanged from last report)

| Advisory | Severity | Package | Fix Available? |
|----------|----------|---------|----------------|
| GHSA-p7fg-763f-g4gf | Moderate | @anthropic-ai/sdk | Requires 0.98.0 (breaking) |
| GHSA-968p-4wvh-cqc8 | Moderate | @babel/runtime | No fix (via react-scripts/react-360-view) |
| GHSA-whgm-jr23-g3j9 | High | ansi-html (via webpack-dev-server) | No fix without removing react-360-view |

The 5 critical / 40 high vulnerabilities are all rooted in `react-360-view → react-scripts → webpack-dev-server` (dev-only, not in production bundle). The @anthropic-ai/sdk vulnerability requires a breaking upgrade — track as a separate task.

---

## Action Items for Next Week

1. **Fix `@prisma/client-finance` TS errors (9 errors)** — generate or stub the Finance Prisma client so the API build is clean again; otherwise this will mask future regressions
2. **Insurance SP2 Repair Tickets UI** — complete list/detail/create pages, wire 5 action dialogs + status timeline
3. **@anthropic-ai/sdk upgrade planning** — GHSA-p7fg-763f-g4gf; evaluate 0.98.0 breaking changes, schedule migration
4. **Phase 2 payment breakdown** — `monthlyPrincipal/Interest` on Payment model (#2.1/#2.2 remain open)
5. **E2E test expansion** — Insurance/Exchange SP2 flows lack E2E coverage; add smoke tests for new chat/canned-response features
