# CTO Watchdog Report — 2026-05-18

## Summary
**11/15 checks passed** — 2 FAIL, 8 WARN, 5 PASS. Critical issues: test regressions (A5) and 3-way migration timestamp collision (B2).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | API: 0 errors, Web: 0 errors |
| A2 Security | **WARN** | 5 unguarded controllers — 4 legitimately public with alt-auth; 1 questionable (web-widget). E2E localStorage token read is dev-only but present in production bundle path. |
| A3 Decimal | **WARN** | 35+ `Number()` calls on money fields in sales, chatbot-finance, line-oa, stickers, quotes, customers. Most are for display formatting but `sales.service.ts:286,452,579,628` and `chatbot-finance/finance-tools.service.ts:53,54,108,111,127` affect business logic. |
| A4 Soft-Delete | **WARN** | 36 services have `findMany`/`findFirst`/`findUnique` with no `deletedAt: null` filter. High-risk: `contracts/contract-document.service.ts` (9 finds), `pricing-templates.service.ts` (4), `kyc.service.ts` (4). Some are on immutable models (audit logs, tokens) — acceptable. |
| A5 Tests | **FAIL** | API: 3,075 passed / **144 failed** / 8 skipped (10 failed suites). Web: 174 passed / **167 failed** (302 failed test files). Failures are environment-driven (no test DB) but exceed zero-failure baseline. Web Vitest picks up API spec files from root — run from `apps/web/` only. |
| A6 Bundle | **PASS** | No chunk exceeds 500 KB gzipped. Largest gzipped: `excel` 256 KB, `ContractTemplatesPage` 148 KB, `pdf` 139 KB. Raw sizes flag Vite warning (`thai-address-data` 871 KB raw, `excel` 930 KB raw) but gzip keeps them within acceptable range. |

### A2 Detail — Unguarded Controllers

| Controller | Rationale | Verdict |
|-----------|-----------|---------|
| `sms-webhook.controller.ts` | In allowlist | OK |
| `shop-public-config.controller.ts` | In allowlist | OK |
| `metrics.controller.ts` | `@Public` + `METRICS_SCRAPE_TOKEN` shared-secret | OK |
| `yeastar-webhook.controller.ts` | HMAC signature or query token | OK |
| `facebook-webhook.controller.ts` | `FB_VERIFY_TOKEN` challenge | OK |
| `line-login.controller.ts` | LINE OAuth flow (no JWT by design) | OK |
| `web-widget.controller.ts` | `roomId` used as capability token — **no signature/HMAC** | **WARN** |

`web-widget.controller.ts` comment says "roomId acts as capability token" but there is no cryptographic verification. Any caller who discovers or guesses a roomId gets unauthenticated access to that chat room.

### A3 Detail — High-Risk `Number()` Calls

```
apps/api/src/modules/sales/sales.service.ts:286,452,579,628   — costPrice, commissionRate
apps/api/src/modules/chatbot-finance/services/finance-tools.service.ts:53,54,108,111,127 — amountDue, amountPaid sums
apps/api/src/modules/quotes/quotes.service.ts:639,641,644      — amount, subtotal, total DTO output
apps/api/src/modules/customers/customers.service.ts:1100       — totalOutstandingThb
```

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | Python parser flagged 137 issues across 168 models — some are false positives (regex truncation on large models). Confirmed real gaps: `PromiseSlot` missing `deletedAt`, `DunningRule` missing all 3 timestamps, `FixedAsset` missing all 3 timestamps. No Float money fields found. |
| B2 Migrations | **FAIL** | **3 migrations share timestamp `20260938000000`**: `add_inter_company_je_link`, `add_viewer_role`, `tax_report_type_pnd1`. Ambiguous ordering on `prisma migrate deploy` — migration that runs last is undefined. No DROP TABLE/TRUNCATE in recent migrations. 244 total (healthy). |
| B3 Indexes | **WARN** | 140 potential missing FK indexes. High-priority gaps: `Contract.productId`, `Contract.reviewedById`, `DailyAssignment.contractId`, `DailyAssignment.paymentId`, `Payment.toleranceJournalLineId`, `InstallmentSchedule.accrualJournalEntryId`. |
| B4 Drift | **PASS** | Latest migration (`template_categories`) is additive: new table + nullable FK + compound index. Clean. 2nd latest adds `PENDING_APPROVAL`/`APPROVED` enum values with `IF NOT EXISTS` guard. No drift detected. |

### B2 Detail — Migration Timestamp Collision

```
20260938000000_add_inter_company_je_link/migration.sql
20260938000000_add_viewer_role/migration.sql
20260938000000_tax_report_type_pnd1/migration.sql
```

PostgreSQL/Prisma resolves ordering alphabetically when timestamps match, but this is fragile and likely unintentional. Two of these may have been created simultaneously. **Must rename** two of the three before next `prisma migrate deploy` on production.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current ✅). `MAX_TOOL_ITERATIONS = 5` ✅. `maxTokens = 1024` ✅. Per-iteration 30s AbortController timeout ✅. `Sentry.captureException` + `captureMessage` on errors and iteration cap ✅. |
| C2 Prompt | **OK** | File size: 6,380 bytes (~1,500 tokens — reasonable). Bank account `203-1-16520-5` ✅. Late fee `50 บาท/วัน` ✅. No contradictions detected. |
| C3 Tools | **OK** | 7 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All have Thai descriptions. `tool-executor.ts` and `tool-executor.spec.ts` both present. |
| C4 Auto-Trigger | **WARN** | Idempotency via `ChatAutoTrigger` table ✅. Sentry capture ✅. Reminder types T-5, T-3, T-1, T (same-day) covered ✅. **Missing: T+1 and T+3 post-due reminders** (CLAUDE.md v5 mentions these but `TEMPLATES` constant only covers pre-due). |
| C5 Security | **WARN** | LIFF controller: `LiffTokenGuard` (LINE API verification) ✅. Admin controller: `JwtAuthGuard + RolesGuard` ✅. LINE webhook: `LineFinanceWebhookGuard` ✅. **Webhook dedup not confirmed** — `chatbot-finance.controller.ts` has no visible `ProcessedWebhookEvent` check for LINE Finance webhooks (unlike `paysolutions` which has idempotency). Replay attack risk. |

---

## Action Items

### 🔴 P0 — Fix Immediately

1. **[B2] Migration timestamp collision** — 3 migrations share `20260938000000`. Rename two:
   ```bash
   # Example fix (pick sequential seconds)
   mv apps/api/prisma/migrations/20260938000000_add_viewer_role \
      apps/api/prisma/migrations/20260938000001_add_viewer_role
   mv apps/api/prisma/migrations/20260938000000_tax_report_type_pnd1 \
      apps/api/prisma/migrations/20260938000002_tax_report_type_pnd1
   ```
   Then update `_prisma_migrations` table on staging/prod if already applied.

2. **[A5] 144 API test failures** — Run `npx jest --passWithNoTests` in a DB-connected environment to isolate true failures from environment failures. Any failures not caused by missing test DB must be fixed before next deploy.

### 🟡 P1 — Fix This Sprint

3. **[A2] web-widget.controller.ts** — Add HMAC signature verification or rate-limit + room ownership check. A guessable `roomId` UUID grants unauthenticated chat access.

4. **[C5] LINE Finance webhook dedup** — Add `ProcessedWebhookEvent` idempotency check (matching `paysolutions` pattern) to `chatbot-finance.controller.ts` LINE webhook handler. Duplicate events could trigger duplicate AI responses.

5. **[B1] PromiseSlot missing `deletedAt`** — v5 model intentionally has no soft-delete? Confirm and add `/// Append-only` comment or add `deletedAt DateTime?`. Similarly audit `DunningRule` and `FixedAsset`.

6. **[A3] Money precision in sales.service.ts** — Lines 286, 452, 579, 628 convert `Decimal` to `Number` for commission/cost calculations. Replace with `Prisma.Decimal` arithmetic to prevent rounding errors on large amounts.

### 🟢 P2 — Backlog

7. **[A3] chatbot-finance finance-tools.service.ts** — `Number(amountDue)` sums at lines 53, 54, 108, 111, 127 lose Decimal precision. For display formatting this is acceptable; for balance calculations use `Prisma.Decimal.add()`.

8. **[A4] Soft-delete gap triage** — Prioritize: `contract-document.service.ts`, `pricing-templates.service.ts`, `kyc.service.ts`. Many of the 36 flagged files query immutable models (AuditLog, tokens) where no `deletedAt` exists — these are false positives.

9. **[B3] Missing FK indexes** — Prioritize high-cardinality FKs: `Contract.productId`, `DailyAssignment.contractId`, `DailyAssignment.paymentId`, `Payment.toleranceJournalLineId`. These appear in hot query paths.

10. **[C4] Post-due reminders T+1, T+3** — Add to `TEMPLATES` constant in `auto-trigger.service.ts` if the business requires post-due follow-up messages per CLAUDE.md v5 spec.

11. **[A6] Bundle split** — `ContractTemplatesPage` at 495 KB raw (148 KB gzip) and `pdf` at 430 KB raw (139 KB gzip) are candidates for further code splitting. Not urgent but worth tracking.

---

*Generated by CTO Watchdog Agent | 2026-05-18*
