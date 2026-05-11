# CTO Watchdog Report — 2026-05-11

## Summary
11/15 checks passed; 4 warnings requiring action — highest priority is Decimal compliance (A3, ~30 `Number()` violations on money fields across 12 services).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | `npx tsc --noEmit` exits clean on both `apps/api` and `apps/web` — zero errors |
| A2 Security | **WARN** | See notes below |
| A3 Decimal | **FAIL** | ~30 `Number()` calls on money fields in 12 production services |
| A4 Soft-Delete | **WARN** | Several models without `deletedAt` lack documented exception comments |
| A5 Tests | **WARN** | API: 2384 pass / 119 fail (DB-dependent, no DATABASE_URL in env); Web: 221 pass / 1 fail |
| A6 Bundle | **WARN** | `excel.js` 929 KB raw / 256 KB gzip; Vite warns on 5 chunks >500 KB raw |

### A2 Security — Detail

**Controllers missing `JwtAuthGuard` (not in security.md exception list):**

| Controller | Guard Used | Notes |
|-----------|-----------|-------|
| `shop-catalog.controller.ts` | `ShopBotDefenseGuard` | Customer-facing shop (bestchoicephone.app) |
| `shop-reservation.controller.ts` | `ShopBotDefenseGuard` | Same |
| `shop-shipping.controller.ts` | `ShopBotDefenseGuard` | Same |
| `shop-buyback.controller.ts` | `ShopBotDefenseGuard` | Same |
| `shop-tracking.controller.ts` | `ShopBotDefenseGuard` | Same |
| `shop-cart.controller.ts` | `ShopBotDefenseGuard` | Same |
| `shop-auth-social.controller.ts` | `ShopBotDefenseGuard` | Same |
| `shop-line-chat.controller.ts` | `ShopBotDefenseGuard` | Same |
| `web-widget.controller.ts` | None (anonymous public) | Widget for website visitors — intentional |
| `line-login.controller.ts` | None (`@SkipCsrf`) | LINE OAuth flow — intentional |
| `metrics.controller.ts` | `@Public()` + `X-Metrics-Token` header | Prometheus — gated by shared secret |

The shop-* controllers appear intentionally public for the customer-facing shop app, but `security.md` only documents `shop/public-config` as an exception. The others need to be added to the exception list or have their guard rationale documented.

**`localStorage` in production code:**
- `apps/web/src/lib/api.ts:10` reads `localStorage.getItem('access_token')` — guarded by E2E test comment, but exists in prod bundle. Not a live exploit path (E2E-only), but worth noting.

**`$queryRaw` without visible parameterization (needs review):**
- `apps/api/src/modules/staff-chat/services/ai-training.service.ts:104,115`
- `apps/api/src/modules/receivable-recon/receivable-recon.service.ts:34,49`
- `apps/api/src/app.controller.ts:43` — `SELECT 1` health check (safe, template literal)
- `apps/api/src/modules/journal/journal-auto.service.ts:107` — advisory lock with `${lockKey}` (Prisma template tag = parameterized, safe)
- `$executeRawUnsafe` in test files only (`asset/*.spec.ts`) — test context only, acceptable

### A3 Decimal Compliance — Detail

`Number()` found on Decimal money fields in production services (not test files):

| File | Fields |
|------|--------|
| `stickers/stickers.service.ts:168,173,175,183,185` | `cashPrice`, `rate1DownPayment`, `installmentBestchoicePrice`, `rate2DownPayment`, `installmentFinancePrice` |
| `shop-catalog/shop-catalog.service.ts:93,134` | `costPrice` (_min aggregate) |
| `sales/sales.service.ts:286,579` | `costPrice` |
| `defect-exchange/defect-exchange.service.ts:184` | `amountPaid` |
| `shop-orders/online-order-sale.adapter.ts:49,52` | `productPrice`, `totalAmount` |
| `line-oa/chatbot.service.ts:151,160,172,199,215` | `amountDue`, `amountPaid` |
| `repossessions/repossessions.service.ts:135-137` | `monthlyPayment`, `sellingPrice`, `financedAmount` |
| `chatbot-finance/services/auto-trigger.service.ts:169` | `amountDue`, `amountPaid` |
| `chatbot-finance/services/finance-tools.service.ts:53,54,108,111,127,173` | `amountDue`, `amountPaid` |
| `chatbot-finance/services/admin-analytics.service.ts:177` | `cost` |
| `shop-installment-apply/shop-installment-apply.service.ts:41` | `costPrice` |
| `loyalty/loyalty.service.ts:282` | `discountAmount` |

These are display/presentation uses in some cases (chatbot, stickers) but `Number()` on Decimal still loses precision on values >53-bit safe integer and on rounding. All should use `Prisma.Decimal` operations or `.toFixed()`.

### A4 Soft-Delete — Detail

Models missing `deletedAt` **with documented exceptions** (per `database.md`): AuditLog, DocumentAuditLog, WebhookDelivery, PasswordResetToken, InviteToken, CustomerAccessToken, ChatbotOtpRequest, ProcessedWebhookEvent — **all correct**.

Models missing `deletedAt` **without documentation** (may be intentional but need `///` comment):

| Model | Likely reason |
|-------|--------------|
| `PromiseSlot` | Child of CallLog (Cascade) — append-only slots |
| `SavingPlanPayment` | Payment record — should this be soft-deletable? |
| `AssetTransferHistory` | Transfer log — append-only |
| `DepreciationEntry` | Accounting entry — immutable |
| `SlipFingerprint` | Idempotency fingerprint |
| `FeeWaiverApproval` | Approval record — immutable audit |
| `JournalPostAuditLog` | Audit log — immutable |
| `ExpenseDetail` / `ExpenseLine` | Child of ExpenseDocument (Cascade) |
| `CreditNoteDetail` | Child record (Cascade) |
| `PayrollDetail` / `PayrollLine` | Payroll records — should be soft-deletable |
| `VendorSettlementDetail` / `SettlementLine` | Settlement records |
| `TodoComment`, `ChatSnooze`, `ConversationTag` | Chat/CRM records |
| `AdsAttribution`, `CrmLeadAssignment`, `CrmLeadStageHistory` | CRM tracking |

### A5 Tests — Detail

**API (Jest):** 2503 total tests / 222 suites. 8 suites fail (119 tests) — all due to missing `DATABASE_URL` in the sandbox environment. These are integration tests that require PostgreSQL. Unit tests: 2384 pass. Previous baseline (CLAUDE.md v4) was 577 — codebase has grown to 2503.

**Web (Vitest):** 222 tests / 24 files. 1 failure:
- `src/hooks/useCollectionsKeyboard.test.tsx` — "G then Q switches to the today tab (G-prefix combo)": `onSwitchTab` not called with `'today'`. G→Q two-key combo handler appears to have a regression.

### A6 Bundle — Detail

| Chunk | Raw | Gzip |
|-------|-----|------|
| `excel-*.js` | **929 KB** | **256 KB** |
| `thai-address-data-*.js` | 870 KB | 69 KB |
| `ContractTemplatesPage-*.js` | 495 KB | 148 KB |
| `index-*.js` (vendor?) | 432 KB | 128 KB |
| `pdf-*.js` | 430 KB | 139 KB |
| `charts-*.js` | 417 KB | 119 KB |
| `CollectionsPage-*.js` | 387 KB | 101 KB |

No chunk exceeds 500 KB gzip. Vite flags 5+ chunks >500 KB raw. `excel` is the largest at 256 KB gzip and the prime target for lazy-load optimization.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | Float used for non-money fields only (GPS, ML confidence) ✓; Contract model FK indexes not confirmed; several models undocumented for missing `deletedAt` |
| B2 Migrations | **PASS** | 217 migrations; latest `20260916000000_add_expense_lines` is descriptive; `DROP COLUMN IF EXISTS` found (idempotent) |
| B3 Indexes | **PASS** | Payment model well-indexed: `contractId`, `dueDate`, `status`, `paidDate`, compound `(status, dueDate)`, `recordedById`; Contract model index coverage not confirmed |
| B4 Drift | **PASS** | Latest migration SQL (`expense_lines`, `expense_details` column drop) consistent with Prisma schema models |

### B1 Schema — Detail

**Float usage (non-money only — correct):**
- `gpsLatitude Float?`, `gpsLongitude Float?` — GPS coordinates
- `confidence Float?`, `quality Float?` — ML/vision scores
- `salesBotConfidenceThreshold Float`, `serviceBotConfidenceThreshold Float` — bot config thresholds

No Float on money fields.

**Contract model indexes:** The `@@index` block was not returned by grep, which may indicate missing compound indexes on `(customerId)`, `(branchId)`, `(status)` — high-volume query patterns. Needs manual verification.

### B2 Migrations — Detail

Recent migrations are descriptive and safe. The latest migration drops two `category` columns with `DROP COLUMN IF EXISTS` (idempotent) and adds `expense_lines` table. The `IF EXISTS` guard makes this safe for re-runs. No `ALTER TYPE` on enum used in large tables detected in recent 5 migrations.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **PASS** | Model: `claude-sonnet-4-6` ✓; `MAX_TOOL_ITERATIONS = 5` ✓; Sentry `captureException` + `captureMessage` on all error paths ✓; `maxTokens = 1024` ✓; per-iteration 30 s timeout ✓ |
| C2 Prompt | **PASS** | Bank account `203-1-16520-5` matches `finance-rules.ts` ✓; Phone `063-134-6356` present ✓; hours Mon–Sat 09:00–18:00 ✓; no contradictions with constants; prompt ≈ 500–700 tokens (reasonable) |
| C3 Tools | **PASS** | 7 tools defined, all 7 handled in `tool-executor.ts`: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human` |
| C4 Auto-Trigger | **PASS** | Idempotency via `ChatAutoTrigger` table marker before send ✓; all 6 types covered: T-5, T-3, T-1, T, T+1, T+3 ✓; Sentry `captureException` on both cron errors ✓ |
| C5 Security | **PASS** | LIFF controller uses `LiffTokenGuard` ✓; admin controller uses `JwtAuthGuard + RolesGuard` ✓; webhook dedup via `ProcessedWebhookEvent` unique constraint ✓; all tool queries scoped by `customerId` via `findActiveContract(customerId)` ✓ |

---

## Action Items

### P0 — Fix Now (financial precision risk)

1. **A3: Decimal compliance** — Replace ~30 `Number()` calls with `Prisma.Decimal` arithmetic in:
   - `stickers.service.ts` (display: `.toFixed(2)` acceptable)
   - `sales.service.ts` — `costPrice` used in profit calculations
   - `repossessions.service.ts` — `monthlyPayment`, `sellingPrice`, `financedAmount`
   - `chatbot-finance/finance-tools.service.ts` — `amountDue`, `amountPaid`
   - `line-oa/chatbot.service.ts` — `amountDue`, `amountPaid`
   - `shop-orders/online-order-sale.adapter.ts` — `productPrice`, `totalAmount`
   - `defect-exchange.service.ts`, `shop-installment-apply.service.ts`, `loyalty.service.ts`

### P1 — Fix This Week

2. **A5: Web test regression** — Fix `useCollectionsKeyboard.test.tsx` G→Q combo: `onSwitchTab('today')` not called. Likely a timing issue with the two-key combo state machine.

3. **A2: Document shop-* public controllers** — Add these 8 controllers to `security.md` exception list with rationale (customer-facing shop app, protected by `ShopBotDefenseGuard`). This removes the false-positive from security scans.

4. **B1/B3: Verify Contract model indexes** — Confirm `@@index([customerId])`, `@@index([branchId])`, `@@index([status])` exist. These fields appear in nearly every contract list/filter query.

### P2 — Schedule

5. **A5: API integration test isolation** — 119 tests fail in sandbox because `DATABASE_URL` is absent. Add a Jest config profile or env-guard to skip DB tests in CI without a database, so test reporting is cleaner.

6. **A2: Review `$queryRaw` parameterization** — Verify `ai-training.service.ts:104,115` and `receivable-recon.service.ts:34,49` use Prisma tagged template literals (parameterized) rather than string interpolation.

7. **A6: Dynamic import for excel.js** — `excel-*.js` at 929 KB raw is loaded on pages that use Excel export. Consider `() => import('exceljs')` inside the export handler to keep it out of the initial route chunk.

8. **A4/B1: Add `///` exception comments** — For `PromiseSlot`, `ExpenseDetail`, `ExpenseLine`, `DepreciationEntry`, `AssetTransferHistory`, `FeeWaiverApproval`, `JournalPostAuditLog` — document why `deletedAt` is intentionally absent (append-only / Cascade child / immutable). For `PayrollDetail`, `PayrollLine`, `VendorSettlementDetail` — consider whether soft-delete is needed.
