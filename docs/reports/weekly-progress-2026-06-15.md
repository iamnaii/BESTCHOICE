# Weekly Progress Report — 2026-06-08 to 2026-06-15

> Generated: 2026-06-15 (Monday) by `cto-progress` agent
> Baseline from CLAUDE.md v4: 577 API tests · 129 web tests · 0 TS errors

---

## Executive Summary

This was a high-velocity week dominated by two major workstreams: a **full-program deep audit** (findings F1–F30 with 16 issues closed, 8 gated, 4 refuted) and a **large-scale service decomposition sprint** (30+ PRs refactoring fat services into focused sub-services). Test counts have grown significantly above baseline (5,020 API / 662 web), reflecting the accumulated test additions since v4. A new TypeScript regression appeared this week — `@prisma/client-finance` module not found (7 errors in sandbox environment) — which needs attention before it becomes a CI blocker.

---

## Git Activity

**Period:** 2026-06-08 → 2026-06-15

| Metric | Count |
|--------|-------|
| Total commits | 114 |
| Non-merge commits | 65 |
| Merge commits / PRs | 49 |
| GitHub PRs (#xxxx) | 46 (PR #1217–#1262) |

### Commit breakdown by type
| Type | Count | Notes |
|------|-------|-------|
| `refactor` | 33 | Service decomposition sprint (30+ fat services split) |
| `fix` | 15 | Deep audit F1–F29, PDPA, contacts UX |
| `docs` | 5 | Audit tracker, money-path sign-off, postmortem |
| `feat` | 3 | Web-shop installment page, master-data in settings, address UX |
| `test` | 2 | T2-C12 expense amount-lock regression, F4 reservation cancel |
| `chore` | 2 | 195 stale docs pruned, dead code (TOTP utils) removed |

### Key work shipped this week

**Deep Audit Fixes (PR #1256)**
- F1: Unauthenticated PII leak on shop applications (non-PII projection for anonymous callers)
- F2: Commission clawback double-pay in payout generation (status filter added)
- F4: Unauthenticated reservation cancel IDOR (sessionId-scoped updateMany)
- F5: Installment accrual cron using server-local midnight instead of Bangkok timezone
- F6: PaySolutions webhook bypassing period-lock check
- F8/F11/F12: Period-lock gaps + advance-consume isolation
- F13/F14: Sentry capture + Bangkok timezone on unguarded crons
- F17/F18/F21: Soft-delete filter gaps, additional money/security fixes
- F20/F28/F29: SHOP-accounting disclaimer, waiver race condition, PII logging
- F25: JournalLine FK Cascade → Restrict + compound index
- F26/F27: Webhooks SSRF private-IP block + customer-access per-IP throttle

**GATED (8 items, need owner/accountant decision):** F3-wiring (SHOP accounting), F7 (KYC SoD policy), F9 (orphan-Payment backfill), F15 (encryption key fail-fast), F16 (PEAK string amounts), F19 (prompt-injection framing), F22 (PDPA LIFF sequence), F24 (broadcast dispatch separation)

**Service Decomposition Sprint (PRs #1217–#1247)**
Massive refactoring to split 20+ oversized services into focused sub-services:
- `ExpenseDocumentsService` → 5 sub-services (lifecycle, posting, void, create, orchestrator)
- `PaymentsService` → 6 sub-services (2,214 → 443 LOC in main file)
- `ContractsService`, `OverdueService`, `LineOaService`, `SalesService`, `PdpaService`, `RepairTicketsService`, `OcrService`, `VoucherService`, `DocumentsService`, `AssetService`, `ReceiptsService`, `PurchaseOrdersService`, `TradeInService`, `NotificationsService`, `CreditCheckService`, `CustomersService`, `DataAuditService`, `TaxService`, `ReportsService`, `SettingsService`, `DashboardService`
- `StaffChatController` thinned: 7 fat handlers moved to `RoomManagerService`
- `LineOaPaymentController` thinned: handlers extracted to `PaymentEvidenceService`

**UX / Contacts (PRs #1258–#1262 + fix/master-data-settings-zone)**
- `CreateContactModal` redesigned from production review feedback
- Auto-formatting for National ID, tax ID, phone numbers
- คำนำหน้า (title) for individual contacts; VAT registration only for juristic entities
- Suppliers renamed "ผู้จัดจำหน่าย" system-wide for consistency
- สมุดผู้ติดต่อ + พนักงาน moved into `/settings` tabs, role-gated (FM/ACC access)
- Address dropdown opens upward to avoid modal clipping
- OWNER menu restored for credit check (fix #1261)

**Web-Shop (PR #1257)**
- Installment transparency page + saving-plan section on home
- Real reviews feed + promotions feed
- Apply status page + bot defense on reviews
- Accurate MDM disclosure for PDPA compliance, a11y icon fixes

**PDPA**
- Fixed `{ not: null }` on non-nullable phone column (unblocked encrypt-PII backfill)
- Postmortem documented

---

## Roadmap Status

> Reference: `docs/CTO-ROADMAP-2026.md`

**Current active phase: Phase 3 (Tax & Compliance) — June 2026**

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — Quick Wins | ✅ Complete | Done Apr 2026 |
| Phase 1 — FINANCE_MANAGER Role | ✅ Complete | FINANCE_MANAGER in schema, seeded, guards updated |
| Phase 2 — Payment & Accounting Structure | ✅ Substantially done | TFRS for NPAEs (A.4), SHOP CoA (P3-SP5), journal templates, PEAK code mapping |
| Phase 3 — Tax & Compliance Automation | 🔄 In progress | Tax module exists, PDPA module active; ภ.พ.30/ภ.ง.ด.3 automation TBD |
| Phase 4 — External Integrations | 🔄 Partial | PEAK sync module exists, MDM auto-lock wired; CHATCONE/GFIN pending |
| Phase 5 — Revenue & Operations | 🔄 Partial | Commission, collections, promotions, trade-in done; loyalty/referral deferred |
| Phase 6 — Scale & Polish | ⏳ Future | Multi-entity legal split, PWA, PII encryption, BI dashboard |

### Phase 3 outstanding tasks
- **3.2** ภ.พ.30 report auto-generation (VAT monthly) — module skeleton exists, generation TBD
- **3.3** ภ.ง.ด.3/53 report auto-generation (WHT monthly) — WHT templates done; one-click export TBD
- **3.4** PDPA DSAR auto-response workflow — DSAR endpoints exist; automation flow TBD
- **3.5** PDPA data retention enforcement — backfill cron exists; full lifecycle TBD
- **3.6** PDPA consent revocation → stop notifications — partial (PDPA module); LINE/SMS gating TBD

### Next recommended focus
1. **Unblock F9**: orphan-Payment backfill (ops decision needed) — document ops impact + get owner sign-off
2. **Wire SHOP JE templates**: F3 owner decision pending — the SHOP Trial Balance currently shows zeros which is misleading
3. **ภ.พ.30 auto-generation**: Phase 3 headline deliverable still missing
4. **Fix `@prisma/client-finance` TS errors**: 7 TS errors introduced, CI risk (see Health section)

---

## Health Dashboard

| Metric | Current | Baseline (v4) | Trend | Notes |
|--------|---------|---------------|-------|-------|
| API Tests (pass) | 4,867 | 577 | ↑ 743% | Massive test growth since v4 baseline |
| API Tests (total) | 5,020 | 577 | ↑ | 145 failing — see below |
| API Test Suites | 438 | 26 | ↑ | 14 suites failing |
| Web Tests (pass) | 662 | 129 | ↑ 413% | vitest run on 98 files |
| Web TS Errors | 0 | 0 | → | Web clean |
| API TS Errors | 7 | 0 | ↓ | New regression this week |
| Vulnerabilities | 5 crit / 43 high | unknown | — | See deps section |

### API Test Failures (145 failing / 14 suites)
All failures trace to **`@prisma/client-finance` module not found** — the Prisma dual-client setup (`prisma-finance.service.ts`) requires generating a second Prisma client artifact that is missing in the sandbox/CI environment. This is an environment provisioning issue, not a code logic failure. The `generate-prisma.sh` script or startup hook should generate this client.

**Action required:** Verify `@prisma/client-finance` is generated in CI/CD before test run. Check `.github/workflows/` and startup scripts.

### New TypeScript Errors (7 — `@prisma/client-finance`)
```
src/prisma/prisma-finance.service.ts(2,30): Cannot find module '@prisma/client-finance'
src/prisma/prisma-finance.service.ts(42,16): Property '$connect' does not exist
src/prisma/prisma-finance.service.ts(48,16): Property '$disconnect' does not exist
src/modules/health/health.controller.ts(144,24): 'PrismaFinanceService' not assignable
src/prisma/prisma-finance.service.spec.ts: 3 related errors
```
These were NOT present in the prior week baseline (0 TS errors per CLAUDE.md). Likely introduced when the `@prisma/client-finance` generate step was dropped from the startup hook or when `prisma-finance.service.ts` was updated during the decomposition sprint.

---

## Code Metrics

| Metric | Count | Change |
|--------|-------|--------|
| API `.ts` files | 1,690 | — |
| API modules | 129 | (up from ~56 cited in CLAUDE.md Apr baseline) |
| Web `.ts/.tsx` files | 887 | — |
| Web pages (total `.tsx`) | 487 | — |
| Web pages (excl. tests) | 440 | — |
| Web pages (root `/pages/*.tsx`) | 122 | — |

---

## Watchdog Summary

No `watchdog-report-*.md` files found in `docs/reports/` this week — the daily `cto-watchdog` agent has not been generating persistent reports. The deep audit tracker at `docs/ceo-review/deep-audit-2026-06-11-findings.md` serves as the primary issue record this week.

**Recurring issues identified from audit tracker:**
1. **Bangkok timezone drift** (F5, F13, F14): Multiple crons were using `new Date().setHours(0,0,0,0)` (UTC) instead of proper Bangkok time — now fixed in all identified spots. Watchdog should scan for any remaining raw `setHours` in cron files.
2. **Missing soft-delete filters** (F21): Some queries lacked `deletedAt: null` — fixed in identified places. Ongoing risk: new service files added during decomposition sprint should be audited.
3. **Commission Decimal precision** (F20): Rounding error in `Math.round(x * 100) / 100` pattern — fixed. This class of bug (Number() on money) was previously tracked in v4 hardening and keeps resurfacing in new services.
4. **PII logging** (F28/F29): Sensitive fields still leaking into structured logs in some paths — partially fixed. Full PII log audit pending.

**Recommended watchdog additions:**
- Scan for `setHours(0,0,0,0)` in cron files (timezone safety)
- Scan for `Math.round(` on money fields (Decimal precision)
- Verify `deletedAt: null` in all new service files from decomposition sprint

---

## Dependency Audit

### Security Scan
```
198 vulnerabilities (9 low, 141 moderate, 43 high, 5 critical)
```

**Critical vulnerabilities:**
| Package | Advisory | Fix Available? |
|---------|----------|---------------|
| `form-data` (via `request`) | Insecure random boundary (GHSA-fjxv-7rqg-78g4) | ✅ `npm audit fix` |
| `loader-utils` (via `react-scripts`→`react-360-view`) | Prototype pollution (GHSA-76p3-8jx3-jpfq) | ❌ No fix (abandon react-360-view) |
| `loader-utils` (via same chain) | ReDoS (GHSA-3rfm-jhwj-7488, GHSA-hhq3-ff78-jv3g) | ❌ Same |
| `shell-quote` (via same chain) | Command injection (GHSA-g4rg-993r-mgx7) | ❌ Same |

**Assessment:** The 5 critical + most high vulns trace to `react-360-view` → `react-scripts` (a very old CRA toolchain in `react-360-view`). This is a **transitive dev/display dependency** — not in the production build path. The `form-data` critical in `request` is fixable via `npm audit fix`.

**Action:** Consider removing `react-360-view` from the project (or replacing with a maintained alternative) to eliminate this vulnerability chain. This would likely resolve ~40-50 of the 198 vulnerabilities.

### Outdated Packages (selected — Wanted != Current)

| Package | Current | Wanted | Type | Notes |
|---------|---------|--------|------|-------|
| @nestjs/common/core/etc | 11.1.19 | 11.1.26 | patch | Safe — minor NestJS patch |
| @nestjs/cli | 11.0.21 | 11.0.23 | patch | Safe |
| @nestjs/swagger | 11.4.2 | 11.4.4 | patch | Safe |
| @aws-sdk/client-s3 | 3.1045.0 | 3.1068.0 | patch | Safe |
| @google-cloud/storage | 7.19.0 | 7.21.0 | patch | Safe |
| react / react-dom | 19.2.6 | 19.2.7 | patch | Safe |
| react-router | 7.15.0 | 7.17.0 | minor | Safe — within ^7 range |
| react-hook-form | 7.75.0 | 7.79.0 | minor | Safe — within ^7 range |
| date-fns | 4.1.0 | 4.4.0 | minor | Safe — within ^4 range |
| dompurify | 3.4.2 | 3.4.10 | patch | **Security** — recommend prioritizing |
| vite | 8.0.12 | 8.0.16 | patch | Safe — within ^8 range |
| turbo | 2.9.12 | 2.9.18 | patch | Safe |
| lucide-react | 1.14.0 | 1.18.0 | minor | Safe — icon additions |
| tailwindcss | 4.3.0 | 4.3.1 | patch | Safe |
| ioredis | 5.10.1 | 5.11.1 | patch | Safe |
| helmet | 8.1.0 | 8.2.0 | patch | Safe |
| puppeteer / puppeteer-core | 24.43.0 | 24.43.1 | patch | ⚠️ **Breaking TS** — `networkidle0` type removed |
| typescript-eslint | 8.59.2 | 8.61.0 | minor | Safe — within ^8 range |
| vitest | 4.1.5 | 4.1.8 | patch | Safe |
| prettier | 3.8.3 | 3.8.4 | patch | Safe |
| nodemailer | 8.0.7 | 8.0.11 | patch | Safe |
| rxjs | 7.8.1 | 7.8.2 | patch | Safe |
| ts-jest | 29.4.9 | 29.4.11 | patch | Safe |

**Packages deliberately NOT updated:**
| Package | Reason |
|---------|--------|
| `prisma` / `@prisma/client` 6.19.3 → 7.8.0 | Per policy: stay on 6.x |
| `react-scripts`, `react-360-view` chain | Legacy dev dep; removal preferred over upgrade |
| `puppeteer` 24.43.0 → 24.43.1 | Breaks `networkidle0` TS types — see below |
| `@anthropic-ai/sdk` 0.88.0 → 0.104.1 | Major breaking change |
| `eslint` → 10.x | Major version jump |
| `typescript` → 6.x | Major version jump |
| `jest` → 30.x | Major version jump |

### Dependency Update Result: **REVERTED**

`npm update --save` was run but **reverted** because the puppeteer patch (24.43.0 → 24.43.1) removed `networkidle0` from its `WaitUntilState` type definition, introducing 3 new TypeScript errors in:
- `apps/api/src/modules/contracts/services/document-rendering.service.ts:661`
- `apps/api/src/modules/line-oa/rich-menu/rich-menu-renderer.service.ts:26`
- `apps/api/src/modules/overdue/letter-pdf.service.ts:415`

A `pg` types error in `src/cli/extract-shop-from-finance.cli.ts` also surfaced during the update run.

**Recommended manual fixes before next update attempt:**
1. Replace `networkidle0` with `load` or `domcontentloaded` in the 3 puppeteer callers (the page option was renamed in Puppeteer v21+)
2. Add `@types/pg` to `apps/api/package.json` (or check if `pg` import in the CLI is intentional)

---

## Action Items for Next Week

### P0 — Immediate
1. **Fix `@prisma/client-finance` generation** — Add to startup hook / CI pre-test step. Currently causes 145 test failures and 7 TS errors. Check if `npx prisma generate --schema=apps/api/prisma/schema-finance.prisma` (or equivalent) needs to be in the setup.
2. **Fix `networkidle0` → `load` in 3 puppeteer callers** — Then re-run `npm update --save` to pick up all safe patch updates.

### P1 — This Week
3. **Owner decision: F3 SHOP JE wiring** — SHOP Trial Balance shows zeros; Dashboard shows real sales. This is misleading for the accountant. Get owner sign-off on the wiring approach.
4. **Owner decision: F9 orphan-Payment backfill** — Document the ops impact and get approval.
5. **PDPA `@types/pg` cleanup** — Verify `extract-shop-from-finance.cli.ts` has the right import or add missing type dep.

### P2 — Phase 3 Completion
6. **ภ.พ.30 auto-generation** — The tax module skeleton exists but one-click monthly VAT export is the headline Phase 3 deliverable.
7. **ภ.ง.ด.3/53 one-click export** — WHT JE templates done; needs a report/export endpoint.
8. **Consider removing `react-360-view`** — Would eliminate ~40-50 vulnerabilities from the audit count.

### P3 — Watchdog Setup
9. **Persist daily watchdog reports** — `cto-watchdog` agent should write to `docs/reports/watchdog-report-YYYY-MM-DD.md` so this report can surface recurring patterns.
10. **Add watchdog scans** for `setHours(0,0,0,0)` in crons, `Math.round(` on money fields, and `deletedAt: null` in new service files.
