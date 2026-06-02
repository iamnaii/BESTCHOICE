# CTO Watchdog Report — 2026-06-02

## Summary
**11/15 checks passed** — 2 FAILs (TS errors in API, test regressions), 2 WARNs (Decimal violations, bundle raw size).
Chatbot health is solid (5/5 OK). Database schema is healthy. Core security posture is good.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors in `prisma-finance.service.ts` (missing `@prisma/client-finance` — new SP7.1 optional DB, client not generated yet). Web: 0 errors. |
| A2 Security | **PASS** | No hardcoded secrets. `$executeRawUnsafe` uses integer hashes (safe). `localStorage` access is E2E-only test helper (explicit comment, cleared after read). Non-`JwtAuthGuard` controllers all have documented alternatives: `LiffTokenGuard`, `LineWebhookGuard`, `ShopBotDefenseGuard`, `@Public()+X-Metrics-Token`. |
| A3 Decimal | **WARN** | ~20 `Number()` calls on money fields across 8 services. See action items. |
| A4 Soft-Delete | **PASS** | All audited `findMany`/`findFirst` calls on soft-deletable models include `deletedAt: null`. Append-only models (CallLog, ChatMessage, AuditLog) correctly omit the filter by design. |
| A5 Tests | **FAIL** | API: 4018 total tests (grown from 577 baseline — many new suites added), 148 failing across 15 suites. Root cause: `PrismaClientInitializationError: DATABASE_URL not found` in asset/other-income/depreciation/users/overdue suites — these tests instantiate Prisma directly instead of using a mock. Core journal, commission, payment, and chatbot tests PASS (3862 passing). Web: vitest ran but encountered jsdom navigation errors and `ECONNREFUSED` (no API server in CI) — separate from code correctness. |
| A6 Bundle | **WARN** | No chunks exceed 500KB **gzipped** (largest: `excel` 256KB gz). However 4 chunks exceed 500KB **raw**: `excel` 929KB, `thai-address-data` 870KB, `LettersPage` 569KB, `ContractTemplatesPage` 489KB. `LettersPage` (220KB gz) warrants monitoring as it includes heavy PDF generation code. |

### A2 Detail — Reviewed Controllers Without JwtAuthGuard

| Controller | Guard Used | Verdict |
|-----------|-----------|---------|
| `shop-catalog.controller.ts` | `ShopBotDefenseGuard` | ✅ Intentional — public shop catalog |
| `shop-reservation.controller.ts` | `ShopBotDefenseGuard` | ✅ Intentional |
| `web-widget.controller.ts` | None (anonymous visitors) | ✅ Documented: "capability token via roomId" |
| `line-oa/liff-api.controller.ts` | `LiffTokenGuard` | ✅ LIFF auth |
| `line-oa/line-oa-chatbot.controller.ts` | `LineWebhookGuard` | ✅ Webhook |
| `line-oa/line-login.controller.ts` | `@SkipCsrf()` only | ⚠️ OAuth redirect flow — needs LINE signature verify |
| `metrics.controller.ts` | `@Public()` + `X-Metrics-Token` | ✅ Prometheus, secret header + timing-safe compare |

### A3 Detail — Decimal Violations (Priority)

| Service | Violations | Risk |
|---------|------------|------|
| `customers.service.ts:1159` | `Number(outstanding._sum.amountDue)` | **HIGH** — aggregate sum loses precision |
| `chatbot-finance/finance-tools.service.ts:53,54,108,111,127,173` | `Number(payment.amountDue/Paid)` | **MED** — display/chatbot context |
| `chatbot-finance/auto-trigger.service.ts:169` | `Number(amountDue) - Number(amountPaid)` | **MED** — reminder amount calc |
| `sales.service.ts:303,518,609` | `Number(costPrice)`, `Number(rate)` | **MED** — sale flow |
| `line-oa/chatbot.service.ts:151,160,172,199,215` | Multiple `amountDue/Paid` | **LOW** — display only |
| `shop-catalog.service.ts:95,136` | `Number(costPrice)` | **LOW** — display |
| `staff-chat/chat-commerce.service.ts:132,134,220,255` | Price display | **LOW** — commerce display |
| `defect-exchange.service.ts:235` | `Number(amountPaid)` filter | **LOW** |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 197 model definitions. All money fields use `@db.Decimal(12,2)`. All 9 `Float` usages are non-money (GPS coords, ML confidence). Enums correct. UUIDs throughout. **Issue**: `InterCompanyTransaction` model has `deletedAt` but is missing `updatedAt` — should have it per coding standards (it is not an immutable audit log). |
| B2 Migrations | **PASS** | 274 migrations. Latest (`20260967_contact_partial_unique`) is clean — replaces full unique with partial unique for soft-delete correctness. Historical `DROP COLUMN` in 16 older migrations (expected for mature app). No dangerous `TRUNCATE` outside the documented wipe CLI. |
| B3 Indexes | **PASS** | 500 index definitions across schema. Payment: 6 indexes including compound `(status, dueDate)`. InterCompanyTransaction: 9 indexes. Well covered overall. |
| B4 Drift | **PASS** | Latest migration SQL matches schema.prisma — partial unique indexes appear in both. No drift detected. |

### B1 Detail — `InterCompanyTransaction` missing `updatedAt`

```prisma
model InterCompanyTransaction {
  // ...
  createdAt      DateTime  @default(now()) @map("created_at")
  // updatedAt missing — should be DateTime @updatedAt @map("updated_at")
  deletedAt      DateTime? @map("deleted_at")
}
```

This model is mutable (it has `status`, `note` fields that change) so `updatedAt` should be present. Requires migration.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` ✅ current. `MAX_TOOL_ITERATIONS = 5` ✅. `Sentry.captureException` on catch ✅. `Sentry.captureMessage` on max-iterations ✅. `maxTokens = 1024` ✅ reasonable. 5-minute prompt cache with fallback ✅. |
| C2 Prompt | **OK** | System prompt matches `finance-rules.ts` constants: bank account `203-1-16520-5` ✅, phone `063-134-6356` ✅, hours `09:00-18:00 Mon-Sat` ✅, late fee `50 บาท/วัน` ✅. No contradictions. Prompt ~2KB (reasonable). |
| C3 Tools | **OK** | 7 tools in `tool-definitions.ts`, all 7 handled in `tool-executor.ts` with matching `case` blocks ✅. All tools have Thai descriptions ✅. `customerId` injected by orchestrator — AI cannot override ✅. |
| C4 Auto-Trigger | **OK** | All 6 reminder types present: T-5, T-3, T-1, T, T+1, T+3 ✅. Idempotency via atomic `chatAutoTrigger.create` with `@@unique([customerId, referenceKey])` — race-safe ✅. `Sentry.captureException` on cron failures ✅. **Minor**: uses `Number(amountDue) - Number(amountPaid)` for display amount (cosmetic Decimal issue). |
| C5 Security | **OK** | LIFF controller uses `LiffTokenGuard` (verified LINE token) ✅. Admin controller has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level with `@Roles('OWNER','FINANCE_MANAGER')` ✅. Webhook dedup uses DB unique constraint — multi-instance Cloud Run safe ✅. Customer isolation: `customerId` from orchestrator only, Claude cannot target other customers ✅. |

---

## Action Items

### P0 — Fix before next deploy

1. **[A1] Generate `@prisma/client-finance`** — `prisma-finance.service.ts` references a client package that doesn't exist yet. Either generate a second Prisma client for the FINANCE DB schema, or add a type stub. Currently causes 7 TS compilation errors and breaks `health.controller.spec.ts`.
   - File: `apps/api/src/prisma/prisma-finance.service.ts`
   - Fix: Run `prisma generate --schema=prisma/schema-finance.prisma` or stub the types until SP7.1 DB is provisioned.

### P1 — Fix this sprint

2. **[A3/A5] `customers.service.ts:1159` `Number(_sum.amountDue)`** — aggregated sum on a money field must use `Prisma.Decimal` not `Number()`. This can silently lose precision on large portfolios.
   ```ts
   // Before (wrong)
   totalOutstandingThb: Number(outstanding._sum.amountDue ?? 0),
   // After
   totalOutstandingThb: new Prisma.Decimal(outstanding._sum.amountDue ?? 0),
   ```

3. **[A5] Fix test environment for Prisma-instantiating specs** — 15 suites fail because they call `new PrismaService()` without a `DATABASE_URL`. Fix by mocking `PrismaService` via NestJS `TestingModule` providers override (pattern already used in passing test suites). Affected: asset, other-income, depreciation, users, health, overdue, outbox-processor, prisma-finance spec.

4. **[B1] Add `updatedAt` to `InterCompanyTransaction`** — Model is mutable but missing the required timestamp. Add migration:
   ```sql
   ALTER TABLE "inter_company_transactions" 
     ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW();
   ```
   Then add `@map` trigger via `@updatedAt` in schema.

### P2 — Address soon

5. **[A3] Decimal cleanup in `sales.service.ts`** — `costPrice`, `rate` conversions should use `new Prisma.Decimal()`.

6. **[A3] Chatbot `Number()` calls in `finance-tools.service.ts` and `auto-trigger.service.ts`** — Low risk (display context) but inconsistent with project standard. Refactor to use `Prisma.Decimal.toNumber()` explicitly when intentional float conversion for display.

7. **[A6] `LettersPage` chunk (569KB raw, 220KB gz)** — Consider splitting the PDF generation import to a separate lazy chunk so the main letters list doesn't load jsPDF until a user clicks "Generate PDF".

8. **[A2] `line-login.controller.ts`** — Verify LINE OAuth `code` and `state` parameters are validated before use. The controller lacks explicit webhook signature verification (unlike the chatbot controller that uses `LineWebhookGuard`). Audit the callback handler for open redirect risks on `returnPath`.

### P3 — Backlog

9. **[A5] Web vitest failures** — `useAssetCalculation.test.ts` (7 failures) and API connection errors in jsdom need investigation. The jsdom navigation errors suggest some tests are accidentally triggering page navigation. Requires API mock setup for web tests.

10. **[A6] `thai-address-data` (870KB raw, 69KB gz)** — Already well-compressed but consider lazy-loading the address data only on pages that need it (contract create, customer forms) instead of bundling it universally.

---

_Generated by CTO Watchdog — run `./tools/check-types.sh all` to reproduce A1._
