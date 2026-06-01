# CTO Watchdog Report — 2026-06-01

## Summary
12/15 checks passed (A1-A6, B1-B4, C1-C5)

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | WARN | api: 7 errors (all in `prisma-finance.service.ts` + spec — missing `@prisma/client-finance` generated client); web: 0 errors |
| A2 Security | PASS | No controllers missing guards. localStorage used only for UI prefs (sidebar, recent searches) and E2E test token injection (immediately removed). No hardcoded secrets. No raw `$queryRaw` template literals. |
| A3 Decimal | WARN | 305 `Number(` calls near money fields in service layer. Hotspots: `sales.service.ts` (16), `chat-commerce.service.ts` (5), `stickers.service.ts` (8), `shop-catalog.service.ts` (4), `line-oa/chatbot.service.ts` (6). Most are display/formatting conversions but some are in calculation paths (sales commission, cost price). |
| A4 Soft-Delete | PASS | Sampled `customers`, `contracts`, `payments`, `products`, `users` services — all `findMany`/`findFirst` include `deletedAt: null`. |
| A5 Tests | WARN | API: 3801 passed / 148 failed / 3957 total (15 suites failed). Root causes: (1) `DATABASE_URL` env not set → 70 integration tests require live DB (expected in CI without DB); (2) `@prisma/client-finance` not generated → 7 type errors collapse `prisma-finance.service.spec.ts`; (3) `AuditService` DI missing in `users.service.spec.ts` test module (8 tests). Web: vitest timed out (>90s) — unable to collect pass/fail count in this environment; 81 test files found. |
| A6 Bundle | WARN | Two chunks exceed 500 KB after minification: `excel-BFF9miLw.js` raw=908 KB **gzip=250 KB**, `thai-address-data-DlMY639R.js` raw=850 KB **gzip=69 KB**, `LettersPage-Db72ZHeP.js` raw=555 KB **gzip=214 KB**. All others under threshold. Excel and LettersPage chunks are above the 200 KB gzip threshold for lazy chunks. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | PASS | All models use UUID `@id @default(uuid())`. Money fields use `@db.Decimal(12, 2)`. Float only used for GPS coordinates, AI confidence scores, and config thresholds — not for financial amounts. Enums use SCREAMING_SNAKE_CASE values and PascalCase names. Standard `createdAt/updatedAt/deletedAt` present on mutable models; intentional omissions (AuditLog, CallLog, tokens) have `///` comment justification. |
| B2 Migrations | PASS | 272 migrations total (excluding `migration_lock.toml`). Latest: `20260965000000_add_reverse_reasons_and_user_override` — descriptive name. No `DROP TABLE` or `DROP COLUMN` in last 10 migrations. One `ALTER TYPE "BubbleType" ADD VALUE IF NOT EXISTS` in `20260963000002_phase3_bubble_rich_types` — uses safe `ADD VALUE IF NOT EXISTS` idiom, not a destructive type change. |
| B3 Indexes | PASS | `Contract` model has 12 `@@index` entries covering `customerId`, `branchId`, `status`, `createdAt`, composite `(status, deletedAt, branchId)` etc. `Payment` model has 8 indexes. Key query paths appear covered. |
| B4 Drift | PASS | Latest migration SQL (`20260965000000`) adds `can_reverse_override` column on `users` and creates `reverse_reasons` table — matches `ReverseReason` model and `canReverseOverride` field found in `schema.prisma`. No observable drift. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | WARN | Model: `claude-sonnet-4-6`. `MAX_TOOL_ITERATIONS = 5` guard present. Sentry `captureException` on errors, `captureMessage` on max-iterations. **maxTokens = 1024** — this is low for a finance assistant that generates structured bank-info blocks and multi-step installment summaries; risk of truncated responses on complex queries. |
| C2 Prompt | PASS | `system-prompt.ts` (67 lines) — reasonable length, well-structured. Business hours (Mon-Sat 09:00-18:00), bank account (KBank 203-1-16520-5), and contact phone (063-134-6356) are defined as constants in `constants/finance-rules.ts` (single source of truth, not duplicated). Safety rules, handoff conditions, and forbidden vocabulary present. |
| C3 Tools | PASS | 7 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All have descriptions. `tool-executor.ts` has full switch-case coverage for all 7 tools with input validation via `validateToolInput`. |
| C4 Auto-Trigger | PASS | Idempotency via `ChatAutoTrigger.referenceKey` unique constraint (P2002 catch → skip). Sentry captures on cron job errors. Daily reminders (09:00) and escalations (same cron block) both wrapped in try/catch with `captureException`. Reminder types: pre-due, same-day, D+1, D+3, D+7, D+30. |
| C5 Security | PASS | LIFF controller (`chatbot-finance-liff.controller.ts`) protected by `LiffTokenGuard` (no JWT — correct for LINE LIFF). Admin controller (`chatbot-finance-admin.controller.ts`) protected by `@UseGuards(JwtAuthGuard, RolesGuard)`. Main webhook controller uses `LineFinanceWebhookGuard`. Webhook dedup via `ProcessedWebhookEvent` DB table (safe for multi-instance Cloud Run). |

---

## Action Items

### P0 — Critical (fix immediately)

**P0-1: `@prisma/client-finance` not generated — causes 7 TypeScript errors and collapses `prisma-finance.service.spec.ts`**
- `@prisma/client-finance` output client does not exist at `apps/api/node_modules/@prisma/client-finance`
- `prisma-finance.service.ts` fails to compile, making `HealthController` unable to use `PrismaFinanceService.$queryRaw`
- **Fix**: run `cd apps/api && npx prisma generate --schema=prisma-finance/schema.prisma` (or `npm run prisma:finance:generate`). Add this step to CI before `tsc` and `jest`.

### P1 — High (fix this sprint)

**P1-1: `AuditService` missing from `users.service.spec.ts` test module — 8 tests broken**
- `UsersService` was updated to depend on `AuditService` but the spec's `TestingModule` was not updated to provide it.
- **Fix**: add `AuditService` (or a mock) to the `providers` array in `users.service.spec.ts`.

**P1-2: maxTokens = 1024 in FinanceAI service — risk of truncated chatbot responses**
- Complex finance queries (payment schedules, multi-instalment summaries, bank-block formatting) can exceed 1024 tokens.
- Truncated responses will silently cut off structured data mid-message.
- **Fix**: increase to at least `2048` (preferably `4096`). Sonnet pricing at 4096 output tokens is still well within chatbot cost envelope.

**P1-3: `excel` and `LettersPage` JS chunks are large (gzip 250 KB and 214 KB respectively)**
- `excel-BFF9miLw.js` (gzip 250 KB) is loaded by any page that imports ExcelJS — check if this is already lazy-loaded.
- `LettersPage-Db72ZHeP.js` (gzip 214 KB) — LettersPage is a staff tool (low traffic), but 214 KB gzip is heavy for a single page chunk.
- **Fix**: verify ExcelJS is behind a dynamic `import()`. Consider splitting LettersPage sub-components.

### P2 — Medium (fix next sprint)

**P2-1: Decimal compliance — 305 `Number()` calls near financial fields**
- Despite v4 hardening removing `Number(_sum` patterns, new modules (`chat-commerce.service.ts`, `sales.service.ts`, `stickers.service.ts`, `shop-catalog.service.ts`, `chatbot.service.ts`) still convert Prisma `Decimal` → `Number` for calculations.
- Risk: floating-point precision errors on amounts >10,000 THB.
- **Fix**: systematic pass on flagged files, replacing `Number(amount)` with `new Prisma.Decimal(amount)` or `.toNumber()` only at serialization boundaries.

**P2-2: 70 API integration tests require `DATABASE_URL` — no in-memory mock strategy**
- Tests fail when run without a live DB (CI environments, local cold start). These are not tagged or skipped.
- **Fix**: tag integration tests with `@group integration` and skip in unit-test runs, or provide a mock `PrismaService` in those test modules.

**P2-3: Web vitest suite timeout (>90s)**
- `npx vitest run` did not complete within 90 seconds in this audit environment. 81 test files may include slow integration-style tests.
- **Fix**: audit slowest specs, add `--testTimeout` guards, or split unit vs integration runs.

---

## Environment Notes
- `DATABASE_URL_FINANCE` (second DB for `prisma-finance` schema) required for finance-service tests — not available in audit environment.
- CI/CD (`deploy.yml`) should run `npm run prisma:finance:generate` before `npm test`.
