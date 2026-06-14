# CTO Watchdog Report — 2026-06-14

## Summary
**8 PASS / 5 WARN / 2 FAIL out of 15 checks.**
Two critical blockers: API TypeScript errors (missing `@prisma/client-finance` client) cascade into 145 test failures — both trace to the same SP7.1 dual-DB root cause. The `Customer` model is missing `deletedAt` (soft-delete blind spot on the most important entity). Decimal precision drift has returned in new code since v4 cleanup.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors — root cause: `@prisma/client-finance` not generated (SP7.1 dual-DB). Errors in `prisma-finance.service.ts` (L2, L42, L48) + cascade into `health.controller.ts` (L144) + spec file (3 errors). Web: 0 errors ✅ |
| A2 Security | **WARN** | Raw SQL all use template literals (parameterized, safe). `localStorage` used only for E2E Playwright token injection with immediate `removeItem()` cleanup. No hardcoded secrets. WARN: `web-widget.controller.ts` (anonymous chat widget, no JWT/HMAC guard — intentionally public but not listed in security.md allow-list). `line-login.controller.ts` also not in allow-list. All shop-* controllers use `ShopBotDefenseGuard`. `metrics.controller.ts` uses `X-Metrics-Token` header auth. Yeastar/Facebook webhooks use HMAC-SHA256. |
| A3 Decimal | **WARN** | 30+ `Number()` calls on money fields found post-v4 cleanup. Critical calculation-path violations: `sale-creation.service.ts:95` (`costPrice = Number(product.costPrice)`), `po-receiving.service.ts:86,250` (`costPrice = Number(poItem.unitPrice)`), `repossessions.service.ts:136,137` (`Number(contract.sellingPrice/financedAmount)`), `shop-catalog.service.ts:95,136,164,165`. Display-only `Number()` for `toLocaleString` are lower risk but indicate incomplete discipline. `staff-chat/chat-commerce.service.ts:132-134` uses `Number()` in sum arithmetic. |
| A4 Soft-Delete | **WARN** | `compliance.service.ts:61` — `contract.findMany({ where: { id: { in: ids } } })` missing `deletedAt: null`. `liff-api.service.ts` — 10+ `customer.findFirst` / `contract.findFirst` without `deletedAt` filter (L24, L126, L137, L152, L172, L202, L269, L298, L318, L325, L343, L355, L379). `shop-catalog.service.ts:91,114,120` — `product.findFirst/findMany` without filter. `chat-ai-draft.service.ts:112` — `customer.findUnique` without deletedAt. |
| A5 Tests | **FAIL** | API: **145 failed / 5,020 total** (14 suites failed). Root cause A: `@prisma/client-finance` missing module cascades TS errors into any test that transitively imports `PrismaFinanceService`. Root cause B: Some suites hit live-DB calls (`seedCollectionsFoundation`) that fail in the CI environment. Web: **1 failed / 662 total** — `CreateContactModal.test.tsx > SUPPLIER` timed out at 5000ms (network call not mocked). |
| A6 Bundle | **WARN** | No chunk exceeds 500 KB **gzipped** (watchdog threshold). Vite reports 5 chunks >500 KB **minified**: `excel` 929 KB (256 KB gzip), `thai-address-data` 870 KB (69 KB gzip), `LettersPage` 569 KB (219 KB gzip), `ContractTemplatesPage` 489 KB (145 KB gzip), `charts` 417 KB (119 KB gzip). `LettersPage` at 219 KB gzip warrants a split investigation since it's a staff-only page loading a massive chunk on open. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | ✅ No `Float` money fields — GPS/AI confidence fields are correctly typed as `Float`. ⚠️ **`Customer` model missing `deletedAt`** — Python scan confirmed absence. This is the core business entity; soft-delete queries against it silently return deleted records. Additionally 19 other models lack `deletedAt`: `DunningRule`, `SavingPlanPayment`, `CompanyInfo`, `FixedAsset`, `AssetTransferHistory`, `DepreciationEntry`, `SlipFingerprint`, `FeeWaiverApproval`, `JournalPostAuditLog`, `ExpenseDetail`, `ExpenseLine`, `AccountRoleMap`, `ExpenseAdjustment`, `CreditNoteDetail`, `PayrollDetail`, `PayrollLine`, `PayrollCustomIncome`, `PayrollCustomDeduction`, `VendorSettlementDetail`. Sub-entity models (ExpenseLine, PayrollLine, etc.) may be intentional cascade-deletes but are not documented with `///` comments per the database.md exception rule. |
| B2 Migrations | **PASS** | 278 migrations with descriptive names. Latest 3: `add_employee_profile`, `add_payroll_line_user_fk`. Dangerous-op scan: `ALTER TYPE "ContractStatus" RENAME VALUE 'LEGAL' TO 'TERMINATED'` is a safe Postgres 10+ atomic rename (no data loss). `ALTER COLUMN "original_document_id" DROP NOT NULL` (credit_note_2mode) is backward-compatible. No table drops found. |
| B3 Indexes | **PASS** | 503 `@@index` definitions across the schema. FK fields covered well. |
| B4 Drift | **PASS** | Latest migration (`20260970000000_add_payroll_line_user_fk`) adds `user_id` column + index to `payroll_lines` and FK to `users`. Schema shows matching `payrollLines PayrollLine[]` back-relation on `User` with `@@index([branchId])` — aligned. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current, matches session config) ✅. `MAX_TOOL_ITERATIONS = 5` guard present ✅. Sentry `captureException` on both `generateReply` outer catch and tool loop errors ✅. `maxTokens = 1024` ✅. History window: 10 messages / 20k char budget with DB-backed fetch ✅. |
| C2 Prompt | **OK** | Business info verified: hours จันทร์-เสาร์ 09:00-18:00 ✅, phone 063-134-6356 ✅, KBank account 203-1-16520-5 บจก.เบสท์ช้อยส์โฟน ✅, late fee 50฿/day ✅, product scope iPhone/iPad มือ1 clearly stated ✅. Prompt length ~3.5 KB (reasonable). Minor WARN: system-prompt.ts comment notes it must stay in sync with `docs/reports/KNOWLEDGE-BASE-FINANCE-BOT.md` — two sources of truth until Phase E moves to DB. |
| C3 Tools | **OK** | 7 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All have Thai descriptions ✅. `tool-executor.ts` handles all 7 via explicit `case` branches ✅. `customerId` security isolation: orchestrator injects it; not in tool input schema (Claude cannot request another customer's data) ✅. |
| C4 Auto-Trigger | **OK** | All 6 reminder types covered: `REMINDER_T_MINUS_5`, `REMINDER_T_MINUS_3`, `REMINDER_T_MINUS_1`, `REMINDER_T_DAY`, `ESCALATION_T_PLUS_1`, `ESCALATION_T_PLUS_3` ✅. Idempotency via `ChatAutoTrigger` table (check before send) ✅. Sentry `captureException` on both cron handlers ✅. `Asia/Bangkok` timezone-aware cron schedules ✅. |
| C5 Security | **OK** | LIFF controller: `LiffTokenGuard` (verifies LINE ID token server-side) ✅. Admin controller: `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✅. Facebook webhook: HMAC-SHA256 + `WebhookAnomalyService` ✅. Yeastar webhook: HMAC-SHA256 dual-mode verification ✅. Customer data isolation enforced in tool executor ✅. |

---

## Action Items (Priority Order)

### 🔴 Critical (block deploy)

1. **Generate `@prisma/client-finance` Prisma client** (A1, A5)
   - Root cause of 7 TS errors + 14 failing test suites + ~145 test failures
   - Fix: `npx prisma generate --schema=apps/api/prisma/schema-finance.prisma` (or equivalent path)
   - Alternatively: if SP7.1 is not ready for this environment, add `@prisma/client-finance` to tsconfig `paths` as a mock or behind a conditional import
   - After fix, re-run `./tools/check-types.sh api` and `./tools/run-tests.sh --skip-e2e`

2. **Add `deletedAt` to `Customer` model** (B1, A4)
   - `Customer` is the core entity — missing soft-delete means `customer.findFirst` in liff-api.service returns deleted customers
   - Fix: add `deletedAt DateTime? @map("deleted_at")` + migration + audit all 10+ liff-api.service queries to add `{ deletedAt: null }` filter
   - Also add `@@index([deletedAt])` for query performance

### 🟡 Warning (fix before next sprint)

3. **Fix Decimal compliance regressions** (A3)
   - Highest priority: `sale-creation.service.ts:95`, `po-receiving.service.ts:86,250`, `repossessions.service.ts:136,137`
   - These are in calculation paths (costPrice used in financial calculations, not just display)
   - Pattern fix: `new Prisma.Decimal(product.costPrice)` instead of `Number(product.costPrice)`
   - Run `./tools/check-types.sh api` and add a lint rule: `no-restricted-syntax` for `Number(` on Decimal fields

4. **Fix soft-delete gaps** (A4)
   - `compliance.service.ts:61` — add `deletedAt: null` to contract.findMany
   - `liff-api.service.ts` — add `deletedAt: null` to all customer/contract lookups (10+ locations)
   - `shop-catalog.service.ts:91,114,120` — add `deletedAt: null` to product queries

5. **Document or guard `web-widget.controller.ts` and `line-login.controller.ts`** (A2)
   - Add both to the "Intentionally Public Endpoints" list in `.claude/rules/security.md`
   - For `web-widget.controller.ts`, consider adding a `@Public()` decorator or comment block consistent with the security policy pattern

6. **Fix web test timeout** (A5)
   - `CreateContactModal.test.tsx > SUPPLIER` times out — mock the `/suppliers` API call in the test
   - Use `vi.mock` or `msw` handler for the supplier POST endpoint

7. **Document sub-entity `deletedAt` exceptions** (B1)
   - For each of the 19 models missing `deletedAt` that are intentional (ExpenseLine, PayrollLine, etc.), add `///` comments per `database.md` exception rule: `/// Child entity — soft-delete cascades from parent ExpenseDocument via onDelete: Cascade`
   - Evaluate `CompanyInfo` and `FixedAsset` as top-level entities — likely need `deletedAt` added

### 🟢 Low priority (next opportunity)

8. **Split `LettersPage` bundle** (A6)
   - 219 KB gzip on a staff-only page — investigate if the heavy PDF/barcode library is inlined
   - Consider dynamic `import()` for the PDF generation path

9. **Move chatbot system prompt to DB** (C2)
   - Phase E work: migrate `FINANCE_BOT_SYSTEM_PROMPT` constant to `ChatKnowledgeBase` table
   - Eliminates dual source-of-truth risk

---

*Generated by CTO Watchdog automated scan — 2026-06-14 06:04 UTC*
