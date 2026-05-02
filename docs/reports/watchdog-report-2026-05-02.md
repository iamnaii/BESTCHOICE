# CTO Watchdog Report — 2026-05-02

## Summary
12/15 checks passed — 3 WARNs (Decimal compliance, Bundle size, Schema soft-delete gaps); 0 critical failures; 1 flaky test (infrastructure, not code regression).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | 0 errors in both `apps/api` and `apps/web` |
| A2 Security | **WARN** | See notes below |
| A3 Decimal | **WARN** | ~15+ `Number()` calls on Decimal money fields |
| A4 Soft-Delete | **PASS** | All business-model `findMany/findFirst` include `deletedAt: null`; `findUnique` by singleton key (SystemConfig, AiSettings) correctly exempt |
| A5 Tests | **PASS** | API: 2285 tests (1 flaky — DB seed, not code); Web: 222 tests ↑ from 129 baseline |
| A6 Bundle | **WARN** | 2 chunks >500 KB raw (see below) |

### A2 Security — Detail
- **No raw SQL** (`$queryRaw/$executeRaw`) found.
- **No hardcoded secrets** detected.
- **localStorage**: `apps/web/src/lib/api.ts` reads `access_token` from localStorage **only in E2E test mode** (guarded by `typeof` check, removed immediately after read). Acceptable.
- **Unguarded controllers** not in `security.md` allowlist — all are intentional but undocumented:
  - `staff-chat/web-widget.controller.ts` — public widget for anonymous website visitors (documented inline but not in `security.md`)
  - `yeastar/yeastar-webhook.controller.ts` — PBX CDR webhook (HMAC-verified)
  - `chat-adapters/facebook-webhook.controller.ts` — Facebook Messenger webhook
  - `line-oa/line-login.controller.ts` — LINE OAuth callback
  - `metrics/metrics.controller.ts` — has `@Public()` decorator
- **Risk**: If `web-widget.controller.ts` ever exposes customer data routes, the missing guard becomes a security bug. Currently it only creates/fetches anonymous chat rooms — low risk today.

### A3 Decimal — Violations (by service)
| File | Violations |
|------|-----------|
| `repossessions/repossessions.service.ts` | 5× `Number(contract.*)` on monthlyPayment, sellingPrice, financedAmount, resellPrice, appraisalPrice |
| `staff-chat/services/chat-commerce.service.ts` | 4× `Number(payment.amountDue/lateFee/amountPaid)` + price display |
| `sales/sales.service.ts` | 2× `Number(product.costPrice)` used in sale record creation |
| `shop-orders/online-order-sale.adapter.ts` | 2× `Number(order.productPrice/totalAmount)` written to Sale record |
| `line-oa/chatbot.service.ts` | 5× `Number(payment.*)` for balance calculations |
| `asset/asset.service.ts` | 3× `Number(asset.costValue/salvageValue)` in depreciation math |
| `shop-catalog/shop-catalog.service.ts` | 2× `Number(costPrice)` for min price grouping |
| `stickers/stickers.service.ts` | 2× `Number(amount/costPrice)` in sticker data |
| `finance-receivable/finance-receivable.service.ts` | 1× `Number(netExpectedAmount)` |
| `crm/customer-scoring.service.ts` | 1× `Number(result._sum?.financedAmount)` |
| `purchase-orders/purchase-orders.service.ts` | 3× `Number(po.netAmount/poItem.unitPrice)` |
| `defect-exchange/defect-exchange.service.ts` | 1× `Number(p.amountPaid)` |

Most critical: `sales.service.ts` and `shop-orders/online-order-sale.adapter.ts` write `Number()` results back into DB records — precision loss risk.

### A5 Tests — Flaky Test
`apps/api/src/modules/overdue/__tests__/collections-foundation.seed.spec.ts` fails with Prisma connection error during `upsert` of system user. This is an infrastructure issue (test attempts real DB write without proper test DB setup), not a logic regression.

### A6 Bundle
| Chunk | Raw | Gzip | Status |
|-------|-----|------|--------|
| `excel-*.js` | 929 KB | 256 KB | WARN (raw >500 KB) |
| `thai-address-data-*.js` | 870 KB | 69 KB | WARN (raw >500 KB) |
| `ContractTemplatesPage-*.js` | 495 KB | 147 KB | OK |
| `pdf-*.js` | 430 KB | 139 KB | OK |
| `charts-*.js` | 417 KB | 119 KB | OK |
| `index-*.js` (vendor split) | 417 KB | 124 KB | OK |
| `CollectionsPage-*.js` | 396 KB | 104 KB | OK |

No chunk exceeds 500 KB **gzip** threshold. Excel and thai-address exceed 500 KB raw — Vite warns but these were intentionally split in v3. Thai-address gzip is only 69 KB so likely fine.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | Float on 6 non-monetary fields (GPS, confidence, thresholds) — acceptable; ~10 business models missing `deletedAt` |
| B2 Migrations | **PASS** | 195 migrations, latest `20260703000000_update_templates_to_flex` — descriptive name, no DROP/ALTER TYPE in recent 3 |
| B3 Indexes | **PASS** | 441 `@@index`/`@@unique` declarations; FK fields appear indexed |
| B4 Drift | **PASS** | Latest migration matches notification template schema additions in schema.prisma |

### B1 Schema — Float Fields
All Float fields are non-monetary (acceptable):
- `Branch.gpsLatitude`, `Branch.gpsLongitude` — GPS coordinates
- `CreditCheck.confidence` — ML confidence score
- `ProductPhoto.quality` — image quality score
- `Inspection.confidence` — inspection ML score
- `SystemConfig.salesBotConfidenceThreshold`, `serviceBotConfidenceThreshold` — bot thresholds

### B1 Schema — Missing `deletedAt` (business models, may need review)
The following business-logic models lack soft-delete (not audit/token/log models):
`Promotion`, `Todo`, `TodoComment`, `FeeWaiverApproval`, `ConversationTag`, `PromiseSlot`, `AccountingPeriod`, `CustomerScore`, `CrmNote`, `CrmLeadAssignment`, `ProductReservation`, `BroadcastApproval`, `WebsiteVisit`, `WebsiteSession`

Several (AuditLog variants, OTP tokens, ChatMessages, ProcessedWebhookEvent) correctly omit `deletedAt` per database.md exceptions.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | `claude-sonnet-4-6`, `MAX_TOOL_ITERATIONS=5`, Sentry on errors, `maxTokens=1024`, 30s per-iteration timeout |
| C2 Prompt | **OK** | Bank account `203-1-16520-5`, phone `063-134-6356`, hours `09:00-18:00 จ-ส` — all consistent with `finance-rules.ts` |
| C3 Tools | **OK** | 7 tools defined; tool-executor handles all: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human` |
| C4 Auto-Trigger | **OK** | T-5/-3/-1/T at 09:00 + T+1/T+3 at 10:00 ✅; ChatAutoTrigger idempotency via P2002 unique constraint ✅; Sentry on cron failure ✅ |
| C5 Security | **OK** | LIFF controller uses `LiffTokenGuard`; admin controller has `JwtAuthGuard + RolesGuard + @Roles`; `customerId` injected by orchestrator (AI cannot cross-tenant); webhook dedup via unique constraint |

---

## Action Items

### Priority 1 — Fix (affects correctness / data integrity)
1. **A3 — Decimal precision in write paths**: `sales/sales.service.ts` lines 286, 579 and `shop-orders/online-order-sale.adapter.ts` lines 49, 52 write `Number(Decimal)` results into `costPrice`/`sellingPrice` DB fields. Replace with `new Prisma.Decimal(value)` to prevent precision loss on financial records.
2. **A5 — Fix flaky test**: `collections-foundation.seed.spec.ts` needs `jest.mock` for Prisma or a proper test DB fixture — currently causes 1/196 suite failure that muddies CI signal.

### Priority 2 — Harden (security posture)
3. **A2 — Document public controllers in security.md**: Add `web-widget`, `yeastar-webhook`, `facebook-webhook`, and `line-login` to the "Intentionally Public Endpoints" section with their authentication mechanism (signature, OAuth callback, anonymous visitor).
4. **A3 — Decimal in calculation paths**: Fix remaining `Number()` calls in `repossessions.service.ts`, `staff-chat/chat-commerce.service.ts`, `line-oa/chatbot.service.ts`, `asset/asset.service.ts` — these affect displayed balances and late-fee calculations.

### Priority 3 — Hygiene
5. **B1 — Soft-delete on business models**: Add `deletedAt DateTime?` to `Promotion`, `Todo`, `FeeWaiverApproval`, `ConversationTag`, `ProductReservation` — these are mutable entities that users can logically "delete".
6. **A6 — Excel chunk**: Consider dynamic import `() => import('exceljs')` with a loading state instead of eager chunk — 256 KB gzip only loads on export pages but still lands in initial parse budget for routes that happen to be split into `index.js`.
