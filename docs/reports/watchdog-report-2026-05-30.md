# CTO Watchdog Report — 2026-05-30

## Summary
10/15 checks passed — system is broadly healthy with one critical blocker (missing `@prisma/client-finance` package causing 144 test failures and 7 TS errors), plus ongoing Decimal precision debt and schema timestamp gaps across newer models.

## A. Code Health
| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | FAIL | API: 7 errors (all in `prisma-finance.service.ts` — `@prisma/client-finance` package not generated); Web: 0 errors |
| A2 Security | PASS | No controllers missing `JwtAuthGuard` (outside known-public list). No `localStorage/sessionStorage` token writes found. No hardcoded secrets found in source. |
| A3 Decimal | WARN | 98 `Number()` calls on financial fields across 15 modules. Highest: `ai-usage` (10), `chatbot-finance` (9), `paysolutions` (8), `line-oa` (8). Most are display/serialisation paths; `customers.service.ts:1134` (`totalOutstandingThb`), `sales.service.ts:291/597` (costPrice) and `chatbot-finance/finance-tools.service.ts` (amountDue/amountPaid aggregations) are precision-critical. |
| A4 Soft-Delete | WARN | ~35 `findMany`/`findFirst`/`findUnique` calls lack a `deletedAt: null` filter in production code. Many are on intentionally-immutable models (`ChatMessage`, `SystemConfig`, `InterCompanyTransaction`) or lookup tables. Notable risks: `customers.service.ts`, `stickers.service.ts` (product/pricingTemplate lookups), `installments/reschedule.service.ts` (installmentSchedule + contract). |
| A5 Tests | FAIL | API: 3,758/3,910 passed (144 failed, 8 skipped) across 14 failed suites. Root cause: `PrismaClientInitializationError — DATABASE_URL not found` (integration tests need live DB). Also 1 suite blocked by `@prisma/client-finance` missing. Web: timed out in sandbox (vitest hangs without a browser environment in this CI context). |
| A6 Bundle | WARN | Largest chunks (gzip): `excel` 256 kB, `LettersPage` 220 kB (includes ExcelJS + pdf-lib inline — not lazily split), `ContractTemplatesPage` 145 kB, `pdf` 139 kB, `charts` 120 kB. Vite warns on 4 chunks >500 kB raw (`excel` 930 kB, `thai-address-data` 871 kB, `LettersPage` 569 kB, `ContractTemplatesPage` 490 kB). `LettersPage` bundles ExcelJS + pdf-lib together — these could be split into separate dynamic imports. |

## B. Database Health
| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | WARN | No `Float` money fields found (GPS coordinates and AI confidence scores correctly use `Float`). No `autoincrement()` IDs found — all use UUID. However, 65 models outside the known-exception list are missing one or more of `createdAt`/`updatedAt`/`deletedAt`. Highest-risk gaps: `Customer` (missing all 3), `CompanyInfo` (missing all 3), `FixedAsset` (missing all 3), `Promotion` (missing all 3), `ExpenseDetail`/`CreditNoteDetail`/`PayrollDetail`/`VendorSettlementDetail` (detail lines — missing all 3). These were likely omitted intentionally as child/line records but should carry `deletedAt` at minimum. 7 models also lack UUID PK (`ExpenseDetail`, `CreditNoteDetail`, `PayrollDetail`, `VendorSettlementDetail`, `UserExpenseTemplate`, `IpRateLimit`, `AiSettings`). |
| B2 Migrations | PASS | 270 migrations total (including `migration_lock.toml`). Latest: `20260964000000_add_daily_depr_to_fixed_assets` — adds `daily_depr DECIMAL(12,4) NOT NULL DEFAULT 0` with safe backfill. No `DROP TABLE` or destructive `ALTER TYPE ... USING` found. |
| B3 Indexes | WARN | 104 models have FK fields (`*Id`) without corresponding `@@index`. High-traffic models with unindexed FKs include: `Contract` (`productId`, `reviewedById`, `interestConfigId`), `Payment` (`toleranceJournalLineId`), `InstallmentSchedule` (`accrualJournalEntryId`, `vat60dayJournalEntryId`), `PurchaseOrder` (`createdById`, `approvedById`), `GoodsReceivingItem` (`productId`). These may cause sequential scans on busy tables. |
| B4 Drift | PASS | Latest migration (`add_daily_depr_to_fixed_assets`) aligns with `schema.prisma` — `dailyDepr Decimal @default(0) @map("daily_depr") @db.Decimal(12, 4)` is present in schema. No obvious mismatches. |

## C. Chatbot Health
| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | OK | Model: `claude-sonnet-4-6`. `maxTokens`: 1024. `MAX_TOOL_ITERATIONS` guard: YES (set to 5). Sentry `captureException` on catch + `captureMessage` on max-iterations reached. 30s per-iteration timeout with `AbortController`. All guards present. |
| C2 Prompt | OK | ~1,600 tokens (6,380 chars ÷ 4). System prompt and `finance-rules.ts` constants are consistent: phone `063-134-6356` matches, bank account `203-1-16520-5 / KBank / บจก. เบสท์ช้อยส์โฟน` matches. Business hours Mon-Sat 09:00-18:00 stated. No contradictions found. Late fee 50 THB/day stated. |
| C3 Tools | OK | 7 tools defined (`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`). All 7 have corresponding `case` handlers in `tool-executor.ts`. No orphaned tool names. |
| C4 Auto-Trigger | OK | `ChatAutoTrigger` table used for idempotency. Triggers T-5, T-3, T-1, T (09:00 cron) and T+1, T+3 escalations (10:00 cron) all covered. Sentry `captureException` on both cron error paths. |
| C5 Security | OK | LIFF controller uses `LiffTokenGuard` (LINE ID token verified server-side) — not `JwtAuthGuard`. Admin controller uses `@UseGuards(JwtAuthGuard, RolesGuard)` at class level with per-method `@Roles`. `WebhookDedupService` present and wired into webhook handler for deduplication. |

## Action Items

### Critical (fix before next deploy)
- **[A1/A5] `@prisma/client-finance` package not generated** — `PrismaFinanceService` extends a `PrismaClient` from `@prisma/client-finance` which does not exist in `node_modules/@prisma/`. This causes 7 TypeScript compilation errors and blocks 1 test suite entirely. The SP7.1 secondary-DB feature is declared but the package was never generated. Run `npx prisma generate --schema=apps/api/prisma/schema-finance.prisma` (or the equivalent command) to create the generated client. Until this is resolved the `health` endpoint's finance DB probe is silently skipping (gracefully, but the TS errors will block strict CI if enabled).

### Warning (fix this sprint)
- **[A3] Decimal precision leaks in financial aggregations** — `customers.service.ts:1134` uses `Number(_sum.amountDue)` for `totalOutstandingThb`, `sales.service.ts:291/597` uses `Number(product.costPrice)` in COGS logic, and `chatbot-finance/finance-tools.service.ts:53-173` converts multiple `amountDue`/`amountPaid` Decimals to JS floats before arithmetic. These are precision-critical paths (customer balance display, sales margin, chatbot payment info). Replace with `new Prisma.Decimal()` arithmetic or `.toFixed(2)` serialisation only at the response boundary.
- **[A5] Integration tests require DATABASE_URL** — 14 test suites (144 tests) fail with `PrismaClientInitializationError` because no `.env.test` or test DB is configured in this environment. These tests are not pure unit tests; they instantiate `PrismaService` directly. Either mock `PrismaService` in these suites or provide a test database URL in `jest` config (`testEnvironment` globals or `setupFiles`).
- **[B1] 65 models missing timestamp fields** — Particularly `Customer`, `CompanyInfo`, `FixedAsset`, `Promotion`, `ExpenseDetail`, `CreditNoteDetail`, `PayrollDetail`, and `VendorSettlementDetail`. Child/line models (detail rows) should at minimum have `deletedAt` so accidental soft-delete of a parent can be cascaded cleanly. Add `deletedAt DateTime?` to line-item models and `createdAt/updatedAt/deletedAt` to top-level business entities.
- **[B3] Missing FK indexes on high-traffic models** — `Contract.productId`, `Contract.interestConfigId`, `InstallmentSchedule.accrualJournalEntryId`, `GoodsReceivingItem.productId`, `PurchaseOrder.createdById/approvedById` are queried frequently and lack indexes. Add `@@index` for these FK columns to avoid seq-scans as data grows.
- **[A6] LettersPage bundle includes ExcelJS + pdf-lib statically** — `LettersPage` is 569 kB raw (220 kB gzip) because it statically imports both `ExcelJS` and `pdf-lib`. Since these are only needed for "export to Excel" and "bulk-print PDF" actions, they should be lazily imported inside the handler functions (`const ExcelJS = await import('exceljs')`). This would drop the initial LettersPage chunk significantly.

### Info (monitor)
- **[A4] Soft-delete filter gaps** — `inter-company.service.ts`, `stickers.service.ts`, and `shop-catalog.service.ts` perform `findMany`/`findFirst` without `deletedAt: null`. `InterCompanyTransaction` and `SystemConfig` models may not have `deletedAt` by design (check schema), but `Product` and `PricingTemplate` lookups in `stickers.service.ts` should guard against soft-deleted records appearing in sticker data.
- **[B1] 7 models missing UUID PKs** — `ExpenseDetail`, `CreditNoteDetail`, `PayrollDetail`, `VendorSettlementDetail` use composite or sequential keys. This is likely intentional for detail/line tables but worth documenting with `///` comments per the database rules convention.
- **[A6] `thai-address-data` chunk is 870 kB raw / 69 kB gzip** — gzip is reasonable but the raw size triggers Vite's warning. Consider lazy-loading the address data only when the address form is rendered (it is already in its own chunk, which is good).
- **[C1] `maxTokens: 1024` may be low for complex tool-use chains** — With up to 5 tool iterations, responses that include structured payment schedules or multi-step verifications could be truncated. Consider raising to 2048 for the finance bot and monitoring token usage via Sentry breadcrumbs.
