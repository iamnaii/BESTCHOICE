# Weekly Progress Report — June 15–22, 2026

> Generated: 2026-06-22 by `cto-progress` agent
> Reporting window: last 7 days (Jun 15–22)

---

## Executive Summary

The current week (Jun 15–22) is quiet with **0 commits** — the prior sprint (Jun 9–13) shipped 114 commits across 49 PRs covering a deep-audit security pass, web-shop public storefront, contact UX, and multiple service decompositions. A critical infrastructure issue was detected and fixed this run: `@prisma/client-finance` (SP7.1 FINANCE database client) was not generated in the dev container, causing 14 failing test suites and 7 TS errors that have now been resolved by regenerating the client. `npm update --save` was attempted for patch deps but reverted after it introduced web TypeScript errors (Radix + React DnD type incompatibility); manual targeted updates are recommended instead.

---

## Git Activity

### This Week (Jun 15–22, 2026)
| Metric | Count |
|--------|-------|
| Commits | **0** |
| PRs merged | **0** |

> Last commit was `a420359` on **2026-06-13** — the current 9-day gap may indicate a planned pause or pending PR review.

### Prior Sprint Highlight (Jun 9–13, 2026)
| Metric | Count |
|--------|-------|
| Commits | 114 |
| PRs merged | 49 |

**Key work shipped in Jun 9–13:**

| Category | Description |
|----------|-------------|
| Deep Audit (F1–F29) | Security + money + period-lock fixes: PII leak, commission clawback double-pay, IDOR, soft-delete filters, accrual cron BKK timezone, advance-consume isolation, SSRF private-IP block, JournalLine FK Cascade→Restrict |
| Web-Shop | Public storefront: installment pricing lead, real reviews feed, promotions, apply-status page, bot defense on reviews, installment transparency page, saving-plan section |
| Contacts / Suppliers | CreateContactModal with auto-format (ID card/tax no./phone), title prefix, VAT-only for juristic, label rename ผู้ขาย→ผู้จัดจำหน่าย |
| Settings Zone | Master data (สมุดผู้ติดต่อ, พนักงาน) consolidated into `/settings` tabs, role-gated |
| PDPA | Fix non-nullable phone Prisma query blocking encrypt-PII backfill |
| Service Decomposition | 8 fat services split: StaffChat, LineOA Payment, Notifications/Scheduler, Sales, PDPA, RepairTickets, Contracts Documents, LineOA core |
| Dead Code / Docs | 195 stale docs pruned, orphaned TOTP utils removed |
| Money-path I2 | Accountant sign-off recorded; marked IMPLEMENTED |

---

## Roadmap Status

> Reference: `docs/CTO-ROADMAP-2026.md`

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — Quick Wins | ✅ Complete | deletedAt checks, DTO validators, PII sanitization done |
| Phase 1 — FINANCE_MANAGER Role | ✅ Complete | Role in Prisma enum, guards, menus, seed user |
| Phase 2 — Payment & Accounting (TFRS) | ✅ Complete | Full accrual A.4 live, accountant sign-off Jun 11 |
| Phase 3 — Tax & PDPA Automation | 🟡 Partial | VAT 60-day rule + year-end closing done; ภ.พ.30/ภ.ง.ด.3 auto-gen still pending |
| Phase 4 — External Integrations | 🟡 Partial | MDM auto-lock (v5) ✅, PEAK mapping (SP3) ✅; CHATCONE/GFIN pending |
| Phase 5 — Revenue & Operations | 🟡 Partial | Commission ✅, trade-in ✅, promotions ✅; loyalty points pending |
| Phase 6 — Scale & Multi-Entity | 🔵 Started | SP7.1 introduced `DATABASE_URL_FINANCE` + finance Prisma schema (placeholder) |

**Next recommended focus:** Phase 3 tax automation (ภ.พ.30 monthly auto-report) and Phase 6 SP7 schema parity between main and finance DB.

---

## Health Dashboard

| Metric | Value | vs Baseline | Trend |
|--------|-------|-------------|-------|
| API Tests — total | 5,037 | 577 (v4 baseline) | ↑ Massive growth |
| API Tests — passing | 4,882 | — | — |
| API Tests — failing | 145 | 0 | ⚠ See note |
| API Tests — skipped | 10 | — | — |
| Web Tests (vitest) | Not run (no DB) | 129 (v4 baseline) | — |
| TS Errors — API | **0** | 0 | → Maintained |
| TS Errors — Web | **0** | 0 | → Maintained |
| Vulnerabilities | 0 critical / 22 high / 36 moderate / 1 low | — | ⚠ See note |
| Watchdog Reports | None found this week | — | — |

### Test Health Note

The v4 baseline of "577 API tests" referred to an earlier test count. The suite has grown massively with v5 (Promise-to-Pay), v6 (Insurance/Repair), Phase A.4 accounting, SHOP accounting (SP5), assets module, etc.

**All 145 failing tests share one root cause: `PrismaClientInitializationError: DATABASE_URL not found`** — these tests require a live database and cannot run in this ephemeral CI container. They are integration tests, not logic failures. The failing suites are:
- `asset.service.spec.ts`, `asset-transfer.service.spec.ts`, `asset-journal.service.spec.ts`, `asset-reports.service.spec.ts`
- `other-income.service.spec.ts`, `maker-checker.spec.ts`, `doc-number.service.spec.ts`, `template.service.spec.ts`
- `depreciation.service.spec.ts`, `collections-foundation.seed.spec.ts`

**Action required**: Add a `DATABASE_URL_TEST` stub or use `jest.mock('@prisma/client')` in these specs to allow offline running, OR mark them as integration tests excluded from the standard test run.

### SP7.1 Finance Client (Fixed This Run)

`@prisma/client-finance` was not generated in this container (new SP7.1 dependency). This caused:
- 7 TypeScript errors in `prisma-finance.service.ts` and its spec
- 14 test suites failing to initialize

**Fixed**: ran `npx prisma generate --schema=prisma-finance/schema.prisma` in apps/api. This should be added to the SessionStart hook or `npm run prisma:generate` script to prevent recurrence.

---

## Dependency Updates

### Security Audit Summary

```
59 vulnerabilities (1 low, 36 moderate, 22 high, 0 critical)
```

| Package | Severity | Status | Notes |
|---------|----------|--------|-------|
| `vite` | High | **Not affected** | Vuln only ≤6.4.2; we run 8.0.12 on Linux — Windows-only vector |
| `@nestjs/core` (and NestJS family) | High | **False positive** | npm audit's fix path = downgrade to v7; we're on v11. CVE resolved in old branch. |
| `ws` 8.20.0 | High | Fixable (→ 8.21+) | Transitive dep; range 8.0.0–8.20.1 |
| `form-data` 4.0.5 | High | Fixable (→ 4.0.6) | CRLF injection; transitive dep |
| `nodemailer` | High | Low risk | ≤9.0.0 affected; check installed version |
| `@babel/core` | Moderate | No fix | Transitive via `react-360-view`; not used in production paths |

### Outdated Packages (Key)

`npm update --save` was attempted but **reverted** — it introduced a web TypeScript error:

```
DraggingStyle is not assignable to CSSProperties
  (react-beautiful-dnd + updated @radix-ui/* type incompatibility)
```

| Package | Current | Wanted | Type | Recommendation |
|---------|---------|--------|------|----------------|
| @nestjs/common et al | 11.1.19 | 11.1.27 | Patch | Update manually in apps/api |
| @nestjs/cli | 11.0.21 | 11.0.23 | Patch | Safe to update |
| @nestjs/swagger | 11.4.2 | 11.4.4 | Patch | Safe to update |
| @nestjs/cache-manager | 3.1.2 | 3.1.3 | Patch | Safe to update |
| @aws-sdk/client-s3 | 3.1045.0 | 3.1073.0 | Minor | Safe to update |
| @aws-sdk/s3-request-presigner | 3.1045.0 | 3.1073.0 | Minor | Safe to update |
| @google-cloud/storage | 7.19.0 | 7.21.0 | Minor | Safe to update |
| @sentry/nestjs + node + react | 10.52.0 | 10.59.0 | Minor | Recommended (fixes vuln) |
| @tanstack/react-query | 5.100.9 | 5.101.0 | Patch | Safe to update |
| @line/liff | 2.28.0 | 2.29.0 | Minor | Safe to update |
| @tailwindcss/vite | 4.3.0 | 4.3.1 | Patch | Safe to update |

**Skipped (per policy):**
- `@prisma/client` 6.x → 7.8.0 — DEFERRED (stay on 6.x per 2026-04-12 decision)
- `@dnd-kit/sortable` 8.x → 10.x — Major version (breaking changes)
- `@eslint/js` 9.x → 10.x — Major version (ESLint 10)
- `@playwright/test` 1.58.x → 1.61.0 — Minor; safe but out of scope this run
- `@anthropic-ai/sdk` 0.88.0 → 0.105.0 — Major version (breaking changes)
- `react-*` family — root `overrides` manage these; do not update independently

---

## Watchdog Report Summary

No `docs/reports/watchdog-report-*.md` files found this week. The `cto-watchdog` daily agent does not appear to be running. **Recommended**: re-enable the daily watchdog schedule to catch the DATABASE_URL/prisma-generate issue earlier.

---

## Action Items

| Priority | Item | Owner |
|----------|------|-------|
| P0 | Add `npx prisma generate --schema=prisma-finance/schema.prisma` to SessionStart hook (prevent recurrence of missing `@prisma/client-finance`) | DevOps |
| P0 | Fix 145 integration tests to run without live DB (mock Prisma or skip via `@Skip` + dedicated integration test job) | Engineering |
| P1 | Manual patch update: @nestjs/* 11.1.27, @sentry/* 10.59.0, @aws-sdk/* 3.1073.0 (avoids the blanket `npm update` issue) | Engineering |
| P1 | Investigate 9-day commit gap (Jun 13 → 22) — is this planned, or is a large PR stuck in review? | CTO |
| P1 | Re-enable `cto-watchdog` daily agent (no reports found) | DevOps |
| P2 | Phase 3: implement ภ.พ.30 auto-report generation | Engineering |
| P2 | Phase 6 SP7: define `prisma-finance/schema.prisma` full model parity (currently placeholder only) | Architecture |
| P3 | Investigate `ws` 8.20.0 and `form-data` 4.0.5 transitive dep update path | Engineering |
