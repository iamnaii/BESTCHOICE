# Weekly Progress Report — June 22–29, 2026

> Generated: 2026-06-29 by `cto-progress` agent
> Reporting window: last 7 days (Jun 22–29)

---

## Executive Summary

The week of Jun 22–29 was among the most active in the project's history, shipping **231 commits** across **42 PRs** in two major workstreams: a full Payment Wizard (Phases 1–4) with draft/post split, late-fee waiver, and approval matrix, plus a comprehensive Inbox overhaul spanning batches G–K (perf, server-side filtering, room pagination, send idempotency, and WS auth hardening). Web tests are fully green (778/778), but **17 API test suites remain broken** due to the ungenerated `@prisma/client-finance` client (SP7.1 finance-DB stub) — the same root cause as last week. npm patch updates were attempted but reverted because `@types/react` 19.2.17 breaks `react-beautiful-dnd` types in `WorkloadGrid.tsx`; that file needs a targeted fix before updates can land.

---

## Git Activity

### This Week (Jun 22–29, 2026)
| Metric | Count |
|--------|-------|
| Total commits | **231** |
| PRs merged | **42** |
| Date range | Jun 22 – Jun 29 |

### Commits by Category
| Category | Commits |
|----------|---------|
| Inbox overhaul (batches G–K) | ~100 |
| Payment wizard & fixes | ~49 |
| CI / ops / seed | ~5 |
| RBAC / security | ~3 |
| Other fixes / docs | ~74 |

### Key Features Shipped

| Area | Description |
|------|-------------|
| **Payment Wizard Phase 1–3** | Record-payment wizard: 2A/2B preview, gross late-fee waiver (52-1105, CPA-gated), approval matrix; quick-amount tiles (เต็มงวด/ปิดขึ้น/กำหนดเอง); CARD/EDC payment channel |
| **Payment Wizard Phase 4** | Draft/post split — `PaymentDraft` side-table; บันทึก Draft → ลงบัญชี two-step workflow; config-driven waiver reasons + draft-button loading guard |
| **In-page payment overlays** | ปรับงวด + คืนเครื่อง open as overlays (no redirect); overlay pointer-events fix; cancel returns to รับชำระ wizard |
| **Payment fixes** | Early-payoff receipt auto-generated; early-payoff discount removed from outstanding; reschedule fee rounds UP to whole baht; backdated paidDate support (D4) |
| **Receipt history modal** | 4-card summary + receipt-level payment history table |
| **Backfill CLI** | `backfill:payment-receipts` CLI for PAID payments missing receipts |
| **Inbox batches G–K** | Perf: memoize bubbles/rooms, WS-gate thread poll, debounce/cache; server-side tab/channel/AI/unread filters; room pagination (lifted 50-room cap, dedup, load-more); send idempotency (DB-level exactly-once via `clientMessageId`); WS auth hardening (re-check isActive on connect, wrap in try/catch); soft-deleted messages excluded from room preview |
| **CI / ops** | GCS signed-URL Token Creator grant for prod; seed `installment_schedules` for wizard preview; backfill-receipts Cloud Run job; test-contracts CI job with log dump |
| **RBAC** | Widened roles: top-products (SALES), companies list (FM/BM/ACC); fixed audit 500, reopened-periods 404, button nesting |

---

## Roadmap Status

> Reference: `docs/CTO-ROADMAP-2026.md`

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 — Quick Wins | ✅ Complete | All quick fixes done |
| Phase 1 — FINANCE_MANAGER Role | ✅ Complete | Role wired, seed user, all guards |
| Phase 2 — Payment & Accounting (TFRS) | ✅ Complete | Full accrual A.4 live; Payment wizard Phase 1–4 shipped this week |
| Phase 3 — Tax & PDPA Automation | 🟡 Partial | VAT 60-day rule + year-end closing done; ภ.พ.30/ภ.ง.ด.3 auto-gen pending |
| Phase 4 — External Integrations | 🟡 Partial | MDM auto-lock ✅, PEAK mapping ✅; CHATCONE/GFIN pending |
| Phase 5 — Revenue & Operations | ✅ Mostly Done | Commission ✅, trade-in ✅, promotions ✅; loyalty points deferred |
| Phase 6 — Scale & Multi-Entity | 🔵 Started | SP7.1 finance-DB stub in-progress; `@prisma/client-finance` not generated |

**Next recommended focus:**
1. **Generate `@prisma/client-finance`** (fix 17 broken API test suites + 11 TS errors)
2. **Fix `WorkloadGrid.tsx` react-beautiful-dnd types** so patch deps can land
3. **Phase 3**: ภ.พ.30 monthly auto-report generation
4. **Phase 6 SP7**: Flesh out finance DB schema beyond placeholder

---

## Health Dashboard

| Metric | Value | vs Last Week | Trend |
|--------|-------|--------------|-------|
| API Tests (total) | 5,141 | was ~577 baseline | ↑ (suite grown 9×) |
| API Tests (passing) | 4,985 | — | — |
| API Tests (failing) | 148 (17 suites) | Same root cause | → (unchanged, @prisma/client-finance) |
| Web Tests (vitest) | **778 / 778** | was 129 baseline | ✅ all green |
| Web Test Files | 119 | — | ↑ |
| API TS Errors | **11** | Same as last week | → (all @prisma/client-finance) |
| Web TS Errors | **0** | 0 | ✅ clean |
| Vulnerabilities | 5 crit / 51 high | Unchanged | → |
| Watchdog Reports | 0 this week | — | — |

### Test Suite Regression Note
The 17 failing API test suites all trace to the same root cause: `Cannot find module '@prisma/client-finance'`. This module (part of SP7.1 finance-DB split) has not been generated in the dev container. Run `npx prisma generate --schema=apps/api/prisma/schema-finance.prisma` (or equivalent) to unblock. This is the **same issue reported last week** — needs a permanent CI fix.

---

## Dependency Updates

### Security Scan Summary
| Severity | Count | Notes |
|----------|-------|-------|
| Critical | 5 | form-data, loader-utils, react-dev-utils, request, shell-quote — all trace through `react-360-view → react-scripts` (dev dep, not in production build) |
| High | 51 | @nestjs/* (advisory covers all versions — no fix available without major upgrade), @typescript-eslint legacy ranges, react-scripts transitive |
| Moderate | 166 | @anthropic-ai/sdk 0.88.0 (fix = 0.106.0, breaking change) + transitive |
| Low | 10 | Various transitive |

**Production-relevant items:**
- `@anthropic-ai/sdk` 0.88.0 has a moderate vulnerability (insecure default file permissions in local filesystem memory tool). Fix requires upgrading to 0.106.0 (breaking change — review API surface before landing).
- `@nestjs/*` HIGH advisory affects all NestJS versions; no patch currently available. Monitor for 11.2.x release.
- Critical/high `react-scripts` tree is from `react-360-view` (360-photo component) — only in dev/build tooling, not shipped to production.

### Patch Updates Attempted & Reverted

`npm update --save` was run but **reverted** because `@types/react` 19.2.17 introduced a type incompatibility with `react-beautiful-dnd` in `apps/web/src/pages/CollectionsPage/components/WorkloadGrid.tsx:248`.

**Root cause:** `@types/react` 19.2.17 tightened `ref` callback typing; react-beautiful-dnd's `DroppableProvided.innerRef` is typed as `(element?: HTMLElement | null | undefined) => void` which no longer satisfies `React.RefCallback<HTMLDivElement>`. Fix: add `as unknown as React.RefCallback<HTMLDivElement>` cast or upgrade `react-beautiful-dnd` → `@hello-pangea/dnd` (maintained fork).

| Package | Before | After | Status |
|---------|--------|-------|--------|
| npm update (all) | — | — | ❌ Reverted (web TS error) |

**Packages pending patch update (blocked by WorkloadGrid fix):**
| Package | Current | Wanted |
|---------|---------|--------|
| @radix-ui/react-* (18 packages) | various | patch bumps |
| @types/react | 19.2.14 | 19.2.17 |
| react / react-dom | 19.2.6 | 19.2.7 |
| tailwindcss + @tailwindcss/vite | 4.3.0 | 4.3.1 |
| dompurify | 3.4.2 | 3.4.11 |
| vitest | 4.1.5 | 4.1.9 |
| zustand | 5.0.13 | 5.0.14 |
| jspdf-autotable | 5.0.7 | 5.0.8 |
| rxjs | 7.8.1 | 7.8.2 |

**Skipped (not patch):**
| Package | Reason |
|---------|--------|
| @prisma/client / prisma | Pinned at 6.x per project policy |
| @anthropic-ai/sdk (0.106.0) | Breaking change — requires API review |
| @nestjs/* minor bumps (11.1.27) | Minor, pending WorkloadGrid fix; low risk |
| react-router, vite, axios, etc. | Minor version — not patching in this run |
| @dnd-kit/sortable (10.0.0) | Major version bump |
| @eslint/js (10.0.1) | Major version bump |

---

## Code Metrics

| Metric | Count | vs Baseline |
|--------|-------|-------------|
| API TS files (`apps/api/src`) | 1,736 | ↑ (was ~800 early 2026) |
| Web TS/TSX files (`apps/web/src`) | 921 | ↑ |
| API modules | 130 | ↑ (was 56 at baseline) |
| Web pages | 155 | ↑ (was 65+ at baseline) |

---

## Watchdog Summary

No watchdog reports (`docs/reports/watchdog-report-*.md`) were found for this week. The daily `cto-watchdog` cron may not be generating reports — recommend verifying the cron schedule is active.

---

## Action Items (Priority Order)

| # | Action | Owner | Effort |
|---|--------|-------|--------|
| 1 | **Generate `@prisma/client-finance`** — run prisma generate for finance schema to fix 17 failing test suites and 11 TS errors. Add to CI so it never drifts again. | BE | S |
| 2 | **Fix `WorkloadGrid.tsx` react-beautiful-dnd types** — cast or migrate to `@hello-pangea/dnd`. Unblocks all patch dep updates. | FE | S |
| 3 | **Land patch dep updates** — after #2, re-run `npm update --save` and verify TS clean. ~29 packages have pending patches. | DevOps | S |
| 4 | **Upgrade `@anthropic-ai/sdk`** 0.88.0 → 0.106.0 — review breaking changes, test AI chat flows. Closes moderate vulnerability. | BE | M |
| 5 | **Phase 3: ภ.พ.30 monthly auto-report** — last major tax automation gap; generate VAT filing PDF/CSV from journal data. | BE | L |
| 6 | **Wire SHOP JE templates to production callers** — `ShopCashSaleTemplate`, `ShopDownPaymentTemplate`, `ShopInventoryTransferTemplate` have zero callers (flagged in deep-audit Jun 11). SHOP P&L reports are near-empty. | BE | L |
| 7 | **Watchdog cron health check** — confirm daily watchdog is running; no reports found this week. | DevOps | S |
| 8 | **Phase 6 SP7**: Document finance-DB schema and decide on split timeline. | Arch | M |
