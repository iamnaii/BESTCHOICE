# CTO Watchdog Report — 2026-04-16

## Summary
9/15 checks clean pass · 4 warn · 2 fail (A3 Decimal, A4 Soft-delete). Tests above baseline (920 vs 706). No critical security vulnerabilities. Two systemic issues require immediate attention: Decimal precision in arithmetic and P&L soft-delete gaps.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | 0 errors in apps/api, 0 errors in apps/web |
| A2 Security | **WARN** | See details below |
| A3 Decimal | **FAIL** | 86 `Number()` calls on money fields — 15 high-severity (arithmetic) across 15 services |
| A4 Soft-Delete | **FAIL** | 7 violations — 2 HIGH pollute P&L/daily-summary reports |
| A5 Tests | **PASS** | API: 777 (↑200 vs baseline 577), Web: 143 (↑14 vs baseline 129) — 920 total, 0 failures |
| A6 Bundle | **PASS** | No chunks >500KB gzipped. Largest: excel 256KB gz, ReceiptModal 226KB gz, ContractTemplatesPage 148KB gz |

### A2 Security — Details

**PASS — No actual violations.** All findings are either intentional patterns or stale references.

- **Controllers missing `JwtAuthGuard`** (3 files): All are expected public endpoints:
  - `chatbot-finance-liff.controller.ts` — uses `LiffTokenGuard` (LINE LIFF token verification)
  - `health.controller.ts` — public health probe
  - `sms-webhook.controller.ts` — public webhook callback
- **paysolutions controller**: Intentionally public webhook per inline comment; no `JwtAuthGuard` at class level but uses `@SkipCsrf()` on each endpoint. Correctly implemented.
- **`address` module**: Referenced in `security.md` as a public-exception module but does **not exist** in the codebase — stale rule entry.
- **`$queryRaw` / `$executeRaw`** (16 occurrences): All use `Prisma.sql` tagged template literals — fully parameterized, no string concatenation. Safe.
- **`localStorage` in `apps/web/src/lib/api.ts`** (lines 10–13): E2E-only pattern. Playwright `addInitScript` injects token; code reads it once, moves to in-memory variable, then immediately removes from `localStorage`. Intentional and correctly documented.
- **`localStorage` elsewhere**: `useDraftStorage.ts` (contract form draft — not tokens), `LayoutContext.tsx` (sidebar UI state — not tokens). Both acceptable.
- **Hardcoded secrets**: None found.

### A3 Decimal — High-Severity Violations (arithmetic, precision loss risk)

| Service | Lines | Pattern |
|---------|-------|---------|
| `payments/payments.service.ts` | 128,137,138,208,223,306,308,309,339,636,638,639,772,773 | `Number(amountDue/amountPaid/lateFee)` in arithmetic |
| `accounting/bad-debt.service.ts` | 91, 245 | `Number(p.amountDue) - Number(p.amountPaid)` in reduce |
| `contracts/contract-payment.service.ts` | 62, 139, 148 | `Number(payment.amountPaid/amountDue)` |
| `paysolutions/paysolutions.service.ts` | 116 | 3-operand `Number()` arithmetic |
| `repossessions/repossessions.service.ts` | 202, 205 | accumulation reduce |
| `notifications/scheduler.service.ts` | 116, 229, 396 | sum accumulation in reduce |
| `notifications/notifications.service.ts` | 1042 | 3-operand arithmetic |
| `exchange/exchange.service.ts` | 66,76,81,82,137 | balance calculations |
| `products/products-stock.service.ts` | 566,585,599,664,673,674,819 | `Number(p.costPrice)` in stock value |
| `inter-company/inter-company.service.ts` | 276 | `Number(t.costPrice)` |
| `receipts/receipts.service.ts` | 81, 82 | `sum + Number(amountPaid)`, balance calc |
| `accounting/accounting.service.ts` | 190, 290, 405 | stored back into responses |
| `asset/asset.service.ts` | 173, 214, 340 | depreciation arithmetic |
| `sales/sales.service.ts` | 377 | `Number(product.costPrice)` |
| `staff-chat/chat-commerce.service.ts` | 106, 108 | balance arithmetic |

Medium-severity (display/notification only, no write-back): chatbot services, overdue-chat, stickers, ocr — 71 additional occurrences.

### A4 Soft-Delete — Violations

| Severity | File | Lines | Issue |
|----------|------|-------|-------|
| HIGH | `accounting/accounting.service.ts` | 543, 764, 785 | `sale.findMany` missing `deletedAt: null` — soft-deleted sales pollute P&L and monthly summaries |
| HIGH | `reports/reports.service.ts` | 373 | `payment.findMany` in `getDailyPaymentSummary` missing `deletedAt` |
| MEDIUM | `reports/reports.service.ts` | 284, 449 | `branch.findMany` filters `isActive: true` only — ignores `deletedAt` |
| MEDIUM | `suppliers/suppliers.service.ts` | 184 | `purchaseOrder.findMany` in `getPurchaseHistory` missing `deletedAt: null` |
| MEDIUM | `products/products.service.ts` | 228 | `stockTransfer.findMany` missing `deletedAt: null` |
| LOW | `purchase-orders/purchase-orders.service.ts` | 366 | `goodsReceiving.findMany` missing `deletedAt: null` |
| LOW | `notifications/notifications.service.ts` | 520 | batch contract fetch by IDs missing `deletedAt: null` |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 5 models missing `updatedAt` without justification; 1 missing `createdAt` |
| B2 Migrations | **PASS** | 92 migrations, latest 3 clean (April 2026), no dangerous ops in recent history |
| B3 Indexes | **WARN** | 3 high-priority missing FK/enum indexes; 7+ medium-priority |
| B4 Drift | **PASS** | All 3 recent migration tables perfectly reflected in schema.prisma |

### B1 Schema — Violations

**Models missing `updatedAt` (no justification):** `PaymentLink`, `PromotionUsage`, `ChatMessage`, `ChatAutoTrigger`, `WebhookDelivery`

**Acceptable exceptions (intentionally immutable/lifecycle-managed):** `AuditLog`, `DocumentAuditLog` (append-only), `PasswordResetToken`, `InviteToken`, `CustomerAccessToken` (use `usedAt`/`expiresAt`), `ChatbotOtpRequest`

**`CustomerLineLink`**: Missing `createdAt` (uses `linkedAt` instead — semantically equivalent but deviates from convention).

**Money fields**: All `@db.Decimal(12, 2)` — no `Float` on money. Three `Float` fields are appropriate: `gpsLatitude`, `gpsLongitude`, `confidence`.

**Enums**: All 60+ enums follow PascalCase / SCREAMING_SNAKE_CASE — PASS.

### B2 Migrations — Details

- **92 total migrations** (descending from `20260412`)
- **Latest 3**: `add_commission_payout_collection_peak`, `add_trade_in_valuation_table`, `add_webhook_subscriptions_deliveries` — all descriptive, no dangerous ops
- **Historical note**: Migration `20260316100000` used `ALTER TABLE "receipts" DROP COLUMN "receipt_type"` without `IF EXISTS` guard — already applied in production, no current risk, but flagged as anti-pattern for future

### B3 Indexes — Missing (by priority)

**HIGH** (high-traffic queries):

| Model | Missing index | Reason |
|-------|--------------|--------|
| `Contract` | `productId` | Every contract page joins on product |
| `Contract` | `planType`, `dunningStage` | Collection/overdue filtering |
| `User` | `role` | Role-based filtering on every auth request |
| `Repossession` | `appraisedById`, `soldContractId` | Collections report queries |

**MEDIUM**:

| Model | Missing index |
|-------|--------------|
| `JournalEntry` | `postedById`, `createdById` |
| `SalesCommission` | `commissionRuleId`, `approvedById` |
| `CommissionPayout` | `approvedById`, `paidById` |
| `Sale` | `contractId` |
| `Payment` | `paymentMethod` |
| `PurchaseOrder` | `createdById`, `paymentStatus` |
| `StockTransfer` | `confirmedById`, `dispatchedById` |
| `Receipt` | `issuedById`, `voidApprovedById` |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **PASS/WARN** | Model `claude-sonnet-4-5-20250514` ✓, MAX_TOOL_ITERATIONS=5 ✓, Sentry ✓; `maxTokens=1024` is low |
| C2 Prompt | **WARN** | Correct values (bank, phone, hours) ✓; constants duplicated as literals — drift risk |
| C3 Tools | **PASS** | 7 tools, all Thai descriptions ✓, all schemas defined ✓, all tool names handled in executor ✓ |
| C4 Auto-Trigger | **PASS** | All 6 reminder types covered ✓, idempotency via unique constraint ✓, Sentry on errors ✓ |
| C5 Security | **PASS** | LIFF: `LiffTokenGuard` ✓; Admin: `JwtAuthGuard+RolesGuard` ✓; Webhook: HMAC-SHA256 `timingSafeEqual` ✓; Dedup: DB unique on `eventId` ✓; Customer isolation: orchestrator-injected `customerId` ✓ |

### C1 AI Service — Warning Detail
`maxTokens = 1024` (`finance-ai.service.ts` line 38) is low for multi-tool-call chains (up to 5 iterations). Complex queries (e.g., balance + schedule + fine in one turn) risk truncation. Recommend raising to 2048.

### C2 Prompt — Warning Detail
`prompts/system-prompt.ts` hardcodes bank account (`203-1-16520-5`), phone (`063-134-6356`), and business hours (`จันทร์-เสาร์ 09:00-18:00`) as string literals. The canonical values live in `constants/finance-rules.ts`. Currently in sync, but a change to `finance-rules.ts` won't update the system prompt automatically. **Recommend**: import `FINANCE_BANK`, `FINANCE_CONTACT_PHONE`, `BUSINESS_HOURS` from `finance-rules.ts` in the system prompt builder.

### C5 Security — Info
`WebhookDedupService.cleanupOldEvents` (cleanup cron) has no `Sentry.captureException` on cleanup errors — logs only. Consistent with low-risk cleanup ops, but noted for completeness.

---

## Action Items (Prioritized)

### P0 — Critical (financial correctness at risk)

1. **[A3] Fix `Number()` arithmetic in payments.service.ts** — 14 occurrences converting `Decimal` to float before arithmetic. Use `Prisma.Decimal` arithmetic (`new Prisma.Decimal(x).plus(y)`) or keep values as `Decimal` throughout. Precision loss on ฿ amounts is a hard financial bug.

2. **[A4-HIGH] Add `deletedAt: null` to `sale.findMany` in `accounting/accounting.service.ts`** (lines 543, 764, 785) — soft-deleted sales currently pollute P&L summaries and monthly comparative reports.

3. **[A4-HIGH] Add `deletedAt: null` to `payment.findMany` in `reports/reports.service.ts`** (line 373) — daily payment summary includes voided/soft-deleted payments.

### P1 — High (data integrity)

4. **[A3] Fix `Number()` arithmetic in remaining 14 high-severity services** — same pattern as #1: bad-debt, contract-payment, paysolutions, repossessions, scheduler, notifications, exchange, products-stock, inter-company, receipts, accounting, asset, sales, chat-commerce.

5. **[A4-MEDIUM] Fix 3 remaining soft-delete violations** — `reports.service.ts` branch queries (lines 284, 449), `suppliers.service.ts` line 184, `products.service.ts` line 228.

6. **[B3-HIGH] Add missing high-priority indexes** via Prisma migration:
   ```prisma
   // Contract
   @@index([productId])
   @@index([planType])
   @@index([dunningStage])
   // User
   @@index([role])
   // Repossession
   @@index([appraisedById])
   @@index([soldContractId])
   ```

### P2 — Medium (maintainability / hygiene)

7. **[B1] Add `updatedAt` to 5 models**: `PaymentLink`, `PromotionUsage`, `ChatMessage`, `ChatAutoTrigger`, `WebhookDelivery` — run migration with `@default(now())` backfill.

8. **[B3-MEDIUM] Add medium-priority indexes** — `JournalEntry`, `CommissionPayout`, `SalesCommission`, `Sale.contractId`, `StockTransfer` (see B3 table above).

9. **[C1] Raise `maxTokens` from 1024 → 2048** in `finance-ai.service.ts` line 38.

10. **[C2] Remove duplicate constants from system prompt** — import from `finance-rules.ts` instead of hardcoding bank account / phone / hours.

11. **[A4-LOW] Fix 2 low-severity soft-delete gaps** — `purchase-orders.service.ts` line 366, `notifications.service.ts` line 520.

### P3 — Low / Info

12. **[A2] Update `security.md`** — remove stale `address` module from public-exception list (module does not exist).

13. **[B1] Add `createdAt` to `CustomerLineLink`** (or document `linkedAt` as the canonical equivalent).

14. **[B2] Establish migration linting rule**: require `IF EXISTS` on all `DROP COLUMN` operations.

15. **[C5] Add `Sentry.captureException`** to `WebhookDedupService.cleanupOldEvents` catch block for consistency.
