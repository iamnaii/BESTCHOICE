# CTO Watchdog Report — 2026-04-26

## Summary
10/15 checks fully passed · 4 WARN · 1 FAIL — codebase is stable with no critical blockers; Decimal precision leakage and test failures need attention.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | 0 errors in both `apps/api` and `apps/web` |
| A2 Security | **WARN** | 4 unguarded controllers need review (see below); E2E localStorage pattern mitigated |
| A3 Decimal | **WARN** | 30 × `Number()` + 6 × `parseFloat()` on money fields across 8+ services |
| A4 Soft-Delete | **WARN** | 97% compliance; 2 service gaps: `compliance.service.ts:61` + `inter-company.service.ts` reporting queries |
| A5 Tests | **FAIL** | API: 2089 passed / 1 failed · Web: 205 passed / 13 failed (both exceed baselines but have regressions) |
| A6 Bundle | **PASS** | No chunk exceeds 500 KB gzipped (largest: excel 256 KB gz, PaymentsPage 243 KB gz); Vite warns on 3 raw-size chunks >500 KB pre-gzip |

### A2 Detail — Unguarded Controllers

| File | Issue |
|------|-------|
| `modules/line-oa/line-login.controller.ts` | OAuth flow — no JwtAuthGuard, only `@SkipCsrf`; needs review |
| `modules/line-oa/liff-api.controller.ts` | Unclear if auth is LIFF-token or unprotected |
| `modules/metrics/metrics.controller.ts` | Metrics endpoint fully public — risk of data leakage |
| `modules/staff-chat/web-widget.controller.ts` | Public widget with `@SkipCsrf` — documented as intentional but not in the approved public list |

Public endpoints already audited and confirmed safe: `chatbot-finance-liff`, `sms-webhook`, `paysolutions`, `address`, `health`, `shop/public-config`, `shop-*` catalog/cart/shipping.

No `$queryRaw`/`$executeRaw` without parameterization found. No hardcoded secrets. localStorage token usage in `apps/web/src/lib/api.ts:10–13` is E2E-only (immediately removed and stored in-memory) — mitigated.

### A3 Detail — Decimal Violations

Key offenders (replace `Number()` with `.toFixed(2)` or keep as `Prisma.Decimal`):

| File | Pattern |
|------|---------|
| `modules/shop-catalog/shop-catalog.service.ts:93,134` | `Number(price)`, `Number(cost)` |
| `modules/line-oa/chatbot.service.ts:150,159,171,198,214` | `Number(amountDue)`, `Number(amountPaid)` |
| `modules/staff-chat/services/chat-commerce.service.ts:106–108,194,229` | Multiple amount conversions |
| `modules/peak/peak.service.ts:301–302` | `parseFloat(debitAmount)`, `parseFloat(creditAmount)` |
| `modules/payments/payments.service.ts:731` | `parseFloat(amount)` |
| `modules/ocr/ocr.service.ts:631,724` | `parseFloat(amount)`, `parseFloat(balance)` |
| `modules/asset/`, `modules/sales/`, `modules/defect-exchange/`, `modules/customers/`, `modules/finance-tools/` | Various `Number()` wraps |

### A5 Detail — Test Failures

**API (1 failure):**
- `collections-foundation.seed.spec.ts` — Prisma client fails to connect (DATABASE_URL not set in test env). Seed spec should be excluded from CI or have a proper env guard.

**Web (13 failures in 2 files):**
- `ContractCard` component tests — `formatNumber(contract.outstanding)` returns undefined; mock for the utility function is missing or the prop shape changed.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 9 models use domain-specific timestamp names instead of `createdAt`; 2 intentional non-UUID PKs; all money fields correctly use Decimal; enum naming correct |
| B2 Migrations | **PASS** | 180 migrations; latest 5 are additive-only (no DROP TABLE / DROP COLUMN / dangerous ALTER TYPE) |
| B3 Indexes | **PASS** | Comprehensive FK + status field index coverage; composite indexes on critical query paths |
| B4 Drift | **PASS** | Latest migration (20260609) aligns with schema.prisma — `call_logs.caller_id` nullable + `users.yeastar_extension` index |

### B1 Detail — Timestamp Deviations

Models using domain-specific timestamps instead of `createdAt` (not necessarily wrong, but undocumented exceptions):

`FeeWaiverApproval` (approvedAt), `CrmLeadStageHistory` (stagedAt), `BroadcastApproval` (approvedAt), `WebsiteVisit` (visitedAt), `WebsiteSession` (startedAt), `IpRateLimit` (no timestamps — ephemeral), `KnownDevice` (firstSeenAt/lastSeenAt), `AiSettings` (updatedAt only — singleton), `LegalCaseDocument` (uploadedAt).

**Recommendation:** Add `/// Non-standard timestamps — intentional` JSDoc to each, or add to the exceptions table in `database.md`.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` ✓; `MAX_TOOL_ITERATIONS = 5` ✓; Sentry captures on max-iter + API errors ✓; `maxTokens = 1024` ✓ |
| C2 Prompt | **OK** | ~1,595 tokens (well under 8k limit); Thai phone/bank/hours verified accurate; no contradictions with `finance-rules.ts` |
| C3 Tools | **OK** | 7 tools defined with Thai descriptions; all input schemas typed; executor handles all 7 with default error case; PII redaction on logging |
| C4 Auto-Trigger | **OK** | All 6 reminder types covered (T-5, T-3, T-1, T, T+1, T+3); `ChatAutoTrigger` idempotency via `@@unique([customerId, referenceKey])`; Sentry captures on both crons |
| C5 Security | **OK** | LIFF controller: `LiffTokenGuard` + LINE API token verification ✓; Admin controller: `JwtAuthGuard + RolesGuard` ✓; webhook: `LineFinanceWebhookGuard` + ProcessedWebhookEvent dedup ✓; tool executor: `customerId → contractId` chain prevents cross-customer data leakage ✓ |

---

## Action Items

### 🔴 P1 — Fix Immediately

1. **[A5] Web test regressions (13 failures)** — `ContractCard` tests failing due to missing/broken `formatNumber` mock. Likely caused by a recent prop shape change. Fix the mock or update the component test.

2. **[A5] API seed spec DATABASE_URL** — `collections-foundation.seed.spec.ts` crashes in CI when DATABASE_URL is unset. Add an env guard (`if (!process.env.DATABASE_URL) return`) or exclude from unit test run.

### 🟡 P2 — Fix This Sprint

3. **[A3] Decimal leakage — payments & peak services** — `parseFloat()` in `payments.service.ts:731` and `peak.service.ts:301–302` can cause floating-point errors in financial records. Replace with `new Prisma.Decimal(value)` or keep the field as Decimal throughout the chain.

4. **[A2] `metrics.controller.ts`** — Public metrics endpoint. Add `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER')` or restrict to internal network via middleware.

5. **[A4] Soft-delete gaps** — Add `deletedAt: null` filter to `compliance.service.ts:61–64` and the inter-company reporting aggregate queries.

### 🟢 P3 — Backlog

6. **[A2] `line-login.controller.ts` + `liff-api.controller.ts`** — Audit whether LINE OAuth flow is intentionally public or needs LIFF token verification.

7. **[A3] Remaining `Number()` wraps** — `shop-catalog`, `chatbot.service`, `chat-commerce.service` — lower risk (display/messaging) but should migrate to Decimal for consistency. Lint rule: warn on `Number(.*amount|price|cost)`.

8. **[B1] Document non-standard timestamps** — Add the 9 models with domain-specific timestamp names to the exceptions table in `.claude/rules/database.md`.

9. **[A6] PaymentsPage bundle** — 843 KB raw is large. Consider splitting heavy sub-components (payment import, CSV parser) into dynamic imports.
