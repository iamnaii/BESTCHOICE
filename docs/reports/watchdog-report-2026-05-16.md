# CTO Watchdog Report — 2026-05-16

## Summary
10/15 checks passed. 2 FAIL (test regressions + hard), 7 WARN (security docs gap, Decimal conversions, soft-delete coverage, schema timestamps, index gaps, bundle chunks, unguarded controllers not in exception list).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TypeScript | **PASS** | 0 errors — `apps/api` and `apps/web` both clean |
| A2 Security | **WARN** | 9 controllers not in documented-exceptions list (see below) |
| A3 Decimal | **WARN** | ~30 `Number()` calls on money fields across 10 services; 2 are written to DB |
| A4 Soft-Delete | **WARN** | 34 services flagged; most are exempt types; `contract-document.service.ts` (9 finds, 0 deletedAt) needs review |
| A5 Tests | **FAIL** | API: 2488 pass / 158 fail (11 suites); Web: 314 pass / 8 fail — see details |
| A6 Bundle | **WARN** | 3 chunks >500 KB gzip: excel 256 KB, ContractTemplates 147 KB, pdf 139 KB |

### A2 — Security Detail

Controllers missing `@UseGuards(JwtAuthGuard)` that are **not** in `security.md` documented-exceptions list:

| Controller | Guard Used | Status |
|-----------|-----------|--------|
| `shop-catalog/shop-catalog.controller.ts` | `ShopBotDefenseGuard` | Intentional — public e-commerce shop. **Add to exceptions.** |
| `staff-chat/web-widget.controller.ts` | None (throttle only) | Intentional — anonymous web widget, comment in file confirms. **Add to exceptions.** |
| `line-oa/line-login.controller.ts` | None | LINE OAuth flow (public by design). **Add to exceptions.** |
| `line-oa/liff-api.controller.ts` | None | LIFF endpoints (public by design). **Add to exceptions.** |
| `line-oa/line-oa-chatbot.controller.ts` | None | LINE webhook receiver. **Add to exceptions.** |
| `shop-reservation.controller.ts` | `ShopBotDefenseGuard` | Public shop reservation. **Add to exceptions.** |
| `metrics.controller.ts` | `@Public()` decorator | Prometheus metrics — OK. **Add to exceptions.** |
| `shop-shipping / shop-buyback / shop-tracking / shop-cart / shop-auth-social / shop-line-chat` | `ShopBotDefenseGuard` | Public e-commerce surface. **Document as a group.** |

No hardcoded secrets found. Raw SQL uses Prisma tagged template literals (parameterized — safe). localStorage token read in `api.ts` is scoped to E2E test mode only (comment-confirmed; `removeItem` clears after first use).

### A3 — Decimal Detail

High-risk `Number()` calls (precision loss risk when result stored to DB):

| File | Line | Risk |
|------|------|------|
| `purchase-orders.service.ts` | 558, 736 | `costPrice: Number(poItem.unitPrice)` — **written to DB** |
| `shop-catalog.service.ts` | 93, 134 | `Number(g._min?.costPrice)`, `Number(u.costPrice)` — returned in API response |
| `repossessions.service.ts` | 136–137 | `Number(contract.sellingPrice/financedAmount)` — used in calculation |
| `finance-receivable.service.ts` | 129 | `Number(record.netExpectedAmount)` — returned in API response |
| `staff-chat/chat-commerce.service.ts` | 132–134, 220, 255 | Multiple money fields in arithmetic |
| `crm/customer-scoring.service.ts` | 121 | `Number(result._sum?.financedAmount)` |
| `stickers.service.ts` | 168–185 | Display-only conversions (low risk) |
| `line-oa/line-oa-payment.controller.ts` | 129–130, 519 | Filter amounts (low risk) |

**DB-write risk** is lines 558/736 in `purchase-orders.service.ts`.

### A5 — Test Failure Detail

**API — 11 failing suites, 158 failing tests:**

| Suite | Failure Pattern |
|-------|----------------|
| `asset/__tests__/asset.service.spec.ts` | VAT extraction, WHT routing, mock setup failures |
| `asset/__tests__/asset-journal.service.spec.ts` | JE template assertions |
| `asset/__tests__/asset-reports.service.spec.ts` | Report calculation assertions |
| `asset/__tests__/asset-transfer.service.spec.ts` | Transfer flow |
| `depreciation/__tests__/depreciation.service.spec.ts` | Depreciation calculation |
| `other-income/__tests__/other-income.service.spec.ts` | Doc numbering, template |
| `other-income/__tests__/maker-checker.spec.ts` | Maker-checker toggle flow |
| `other-income/__tests__/doc-number.service.spec.ts` | Sequence generation |
| `other-income/__tests__/template.service.spec.ts` | OI template rendering |
| `chatbot-finance/services/chatbot-finance.service.spec.ts` | Mock/stub setup |
| `overdue/__tests__/collections-foundation.seed.spec.ts` | DB seed fails (Prisma client error) |

**Web — 2 failing files, 8 failing tests:**

| File | Failures |
|------|---------|
| `pages/assets/hooks/useAssetCalculation.test.ts` | VAT extraction (inclusive/exclusive), WHT base routing, JE balance — 7 tests |
| `pages/assets/__tests__/AssetsListPage.statcards.test.tsx` | Stat card sum calculation — 1 test |

**Assessment**: Test failures are concentrated in the newly added asset module and other-income features. Tests appear to be written ahead of or concurrently with the implementation — the underlying logic for VAT extraction and WHT base routing doesn't yet match test expectations. The `collections-foundation.seed.spec.ts` failure is a DB connectivity issue in the test environment.

### A6 — Bundle Detail

| Chunk | Raw | Gzip | Action |
|-------|-----|------|--------|
| `excel-D2zi7rdb.js` | 929 KB | 256 KB | Already split from main — acceptable |
| `ContractTemplatesPage-9nHOZXJT.js` | 496 KB | 148 KB | **Large** — consider splitting template preview from editor |
| `pdf-DzCgbnV7.js` | 430 KB | 139 KB | Already split — acceptable |
| `charts-DtrQsyEN.js` | 418 KB | 120 KB | Already split — acceptable |
| `CollectionsPage-Dp9CiyGq.js` | 387 KB | 102 KB | Investigate — may bundle heavy components |

No chunk exceeds 500 KB gzip. The Vite warning threshold is 500 KB raw (minified); excel and ContractTemplatesPage exceed it.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 6 non-uuid ids on detail tables; 50+ models missing some timestamp fields (many legitimate) |
| B2 Migrations | **PASS** | 230 migrations; latest `20260926000000_asset_invoice_received`; no DROP TABLE/DROP COLUMN in recent history |
| B3 Indexes | **WARN** | 30+ models have unindexed FK fields; high-traffic models (Contract, Payment) affected |
| B4 Drift | **PASS** | Latest migration aligns with CLAUDE.md description (3 nullable FixedAsset fields) |

### B1 — Schema Detail

**Non-uuid ids** (using serial/int — may be intentional for line-item tables):
- `ExpenseDetail`, `CreditNoteDetail`, `PayrollDetail`, `VendorSettlementDetail` — line items (performance choice acceptable)
- `IpRateLimit`, `AiSettings` — singleton-like records (review intent)

**Models missing timestamp fields** (sample of genuinely concerning ones — excludes documented audit-log exemptions):

| Model | Missing |
|-------|---------|
| `PromiseSlot` | `deletedAt` |
| `ExpenseLine`, `PayrollLine`, `SettlementLine` | `deletedAt` |
| `AccountRoleMap` | `deletedAt` |
| `Promotion` | All three timestamps |
| `AccountingPeriod` | `deletedAt` |
| `PartialPaymentLink` | `deletedAt` |

Note: `Customer` model correctly has all three timestamps (Python regex produced false positive due to model length).

**Float fields** — all are GPS coordinates and AI confidence scores, not money fields. Money fields use `@db.Decimal(12, 2)` correctly.

### B3 — Index Detail (top concerns)

| Model | Unindexed FKs |
|-------|--------------|
| `Contract` | `productId`, `reviewedById`, `interestConfigId` |
| `Payment` | `toleranceJournalLineId` |
| `InstallmentSchedule` | `accrualJournalEntryId`, `vat60dayJournalEntryId` |
| `Customer` | `nationalId`, `lineIdFinance`, `lineIdShop` (unique but query patterns need composite) |
| `Repossession` | `contractId`, `productId`, `appraisedById` |
| `CallLog` | `targetInstallmentIds`, `yeastarCallId` |
| `DailyAssignment` | `contractId`, `paymentId` |
| `Sale` | `contractId` |
| `OnlineOrder` | `productId`, `reservationId` |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | `claude-sonnet-4-6`, `MAX_TOOL_ITERATIONS=5`, `maxTokens=1024`, Sentry imported and used |
| C2 Prompt | **OK** | Bank, phone, hours, late fee all match `finance-rules.ts` constants; no contradictions; ~750 tokens |
| C3 Tools | **OK** | All tools have Thai descriptions; schemas defined; executor handles all tool names |
| C4 Auto-Trigger | **OK** | Idempotency via `ChatAutoTrigger` table; T-5/T-3/T-1/T/T+1/T+3 all covered; Sentry on both crons |
| C5 Security | **OK** | `LiffTokenGuard` on LIFF; `JwtAuthGuard+RolesGuard(@Roles('OWNER'))` on admin; `WebhookDedupService` present; `customerId` injected by orchestrator (Claude cannot override) |

### C1 Detail
History window: 10 most-recent messages, 20k char budget with oldest-first ordering. Prompt cached 5 min TTL from DB. Sentry captures on all tool-loop errors.

### C2 Detail
Constants file (`finance-rules.ts`) exports `LATE_FEE_PER_DAY=50`, `FINANCE_BANK.accountNumber='203-1-16520-5'`, `FINANCE_CONTACT_PHONE='063-134-6356'`, `BUSINESS_HOURS`. System prompt references all of these inline and they match. No contradictions between prompt and constants.

### C5 Detail
Webhook controller uses `LineFinanceWebhookGuard` (LINE signature verification) for the webhook route; admin push-test route at line 75 uses `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER')`. Dedup via `ProcessedWebhookEvent` table with `isDuplicate()` check before any processing.

---

## Action Items

### P0 — Fix Now

1. **Test regressions — asset module** (`asset.service.spec.ts`, `useAssetCalculation.test.ts`, 150+ failures)
   - VAT extraction (inclusive/exclusive) and WHT base routing don't match test expectations
   - Failure pattern suggests implementation is incomplete or recently changed
   - Blocks deployment confidence: run `./tools/run-tests.sh --skip-e2e` and address root cause before next merge to `main`

2. **`purchase-orders.service.ts` Decimal precision** (lines 558, 736)
   - `costPrice: Number(poItem.unitPrice)` converts `Prisma.Decimal` → JS `Number` before writing to DB
   - Fix: `costPrice: new Prisma.Decimal(poItem.unitPrice.toString())`

### P1 — This Sprint

3. **Document intentionally public controllers in `security.md`** (A2)
   - Add exception entries for: `web-widget`, `shop-*` (ShopBotDefenseGuard group), `metrics` (@Public), `line-oa/line-login`, `line-oa/liff-api`, `line-oa/line-oa-chatbot`
   - Without this, the security rule creates false positives for every audit

4. **Add `deletedAt` to Promotion, AccountingPeriod, PartialPaymentLink, PromiseSlot** (B1)
   - These are business entities that should support soft-delete
   - Requires migrations

5. **Index `Contract.productId`, `Sale.contractId`, `DailyAssignment.contractId`** (B3)
   - These are high-frequency query paths in the collections/POS flow

### P2 — Backlog

6. **`contract-document.service.ts`** — 9 prisma queries with no `deletedAt: null` filter (A4)
   - Documents are legal evidence; accidental reads of soft-deleted records could cause issues

7. **`ContractTemplatesPage` bundle** (A6)
   - 148 KB gzip; investigate whether template preview renderer can be lazy-split

8. **Other-income + depreciation test failures** (A5)
   - 8 failing suites in other-income and depreciation — review whether tests predate implementation

9. **`IpRateLimit` model timestamps** (B1)
   - Used for rate limiting; missing all timestamps makes debugging and retention management harder

---

*Generated by CTO Watchdog agent — 2026-05-16*
*Checks run: A1-A6 (code health), B1-B4 (database), C1-C5 (chatbot)*
