# CTO Watchdog Report — 2026-06-30

## Summary
7/15 checks pass cleanly; 5 warnings; 3 failures. **Critical blocker**: `@prisma/client-finance` module missing crashes 17 API test suites (148 tests) and produces 7 TypeScript errors. Decimal compliance has 119+ violations. Bundle is healthy (no chunks >500 KB gzipped).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors — all in `prisma-finance.service.ts` + `health.controller.ts` (missing `@prisma/client-finance` module). Web: 0 errors. |
| A2 Security | **WARN** | See notes below. |
| A3 Decimal | **FAIL** | 119 `Number()` calls on money fields in services. |
| A4 Soft-Delete | **WARN** | 1 349 `findMany/findFirst/findUnique` without `deletedAt: null`; many are on models without `deletedAt` by design, but warrants review of core entities. |
| A5 Tests | **FAIL** | API: 5 004 passed / 5 160 total — **148 failed, 17 suites failed** (root cause: `@prisma/client-finance` not generated). Web: 820/820 passed (128 files). |
| A6 Bundle | **PASS** | Largest gzip chunk: `excel` 256 KB, `LettersPage` 220 KB, `index` 175 KB. No chunk exceeds 500 KB gzipped. Vite warns on 5 minified chunks >500 KB (pre-gzip) — `ContractTemplatesPage`, `LettersPage`, `index`, `thai-address-data`, `excel`. |

### A2 Security — Details

**$executeRawUnsafe — numeric injection risk (LOW)**
- `apps/api/src/modules/e-tax-xml/e-tax-xml.service.ts:160` — `$executeRawUnsafe(\`SELECT pg_advisory_xact_lock(${lockKey})\`)`
- `apps/api/src/modules/contacts/contact-resolver.service.ts:32` — same pattern
- `lockKey` is derived from `charCodeAt()` arithmetic so the value is a computed integer, not user-supplied. Risk is low but `$executeRaw`` template literal (parameterised) is the correct pattern used elsewhere (see `journal-auto.service.ts:133`).

**localStorage — E2E test only (INFO)**
- `apps/web/src/lib/api.ts:10-13` reads `access_token` from localStorage, but ONLY when set by Playwright's `addInitScript`. Token is immediately removed after reading. This is intentional and safe.

**Unguarded controllers outside whitelist (WARN)**
The following controllers have no `JwtAuthGuard` and are NOT in the documented public whitelist in `security.md`:
- `staff-chat/web-widget.controller.ts` — comments say "public for anonymous visitors"; uses `@Throttle`. Not in whitelist.
- `line-oa/line-login.controller.ts`, `liff-api.controller.ts`, `line-oa-chatbot.controller.ts` — LINE OAuth/webhook flows; legitimately public but undocumented.
- `shop-reservation/shop-reservation.controller.ts`, `shop-shipping/shop-shipping.controller.ts`, `shop-tracking/shop-tracking.controller.ts`, `shop-cart/shop-cart.controller.ts`, `shop-line-chat/shop-line-chat.controller.ts` — shop storefront family; covered by `ShopBotDefenseGuard` pattern but not individually listed in whitelist.
- `metrics/metrics.controller.ts` — protected by `X-Metrics-Token` header + timing-safe compare; legitimately public but undocumented.
- `shop-auth-social/shop-auth-social.controller.ts` — uses `ShopBotDefenseGuard`; public for social login flows.

Recommendation: extend the `security.md` whitelist to document all intentionally-public controllers.

### A3 Decimal Compliance — Key Violations

```
apps/api/src/modules/chatbot-finance/services/finance-tools.service.ts
  :53  Number(nextPayment.amountDue)
  :54  Number(nextPayment.amountPaid)
  :68  Number(resolveLateFee(...))
  :113 Number(p.amountDue) in reduce
  :116 Number(p.amountPaid) in reduce
  :132 Number(nextUnpaid.amountDue)

apps/api/src/modules/line-oa/chatbot.service.ts
  :151 Number(p.amountDue) in reduce
  :160 Number(nextPayment.amountDue)
  :172 Number(p.amountPaid)
  :199 Number(next.amountDue)
  :215 Number(p.amountDue) in reduce

apps/api/src/modules/customers/services/customer-query.service.ts
  :341 Number(outstanding._sum.amountDue)

apps/api/src/modules/sales/services/sale-writer.service.ts
  :245 Number(await getRateForMonths(...))
  :336 Number(product.costPrice)
```

These should use `Prisma.Decimal` arithmetic or `.toNumber()` with explicit precision awareness.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | `Customer` model is missing `createdAt`, `updatedAt`, `deletedAt` — critical core entity. Several detail/line/log models also missing timestamps; many are legitimate (append-only logs, join tables) but `Customer`, `FixedAsset`, and `Promotion` should be reviewed. No Float money fields detected. All IDs use UUID. |
| B2 Migrations | **PASS** | 286 migrations total. Latest (`20260978000000_purchasing_v2_foundation`) uses safe `ALTER TYPE ... ADD VALUE`, proper 2-step pattern for new NOT NULL column (`gr_number`: add nullable → backfill → NOT NULL + UNIQUE). No `DROP TABLE`, `DROP COLUMN`, or destructive `ALTER TYPE`. |
| B3 Indexes | **WARN** | Missing FK indexes on key models: `Contract` (productId, reviewedById, interestConfigId, pdpaConsentId, exchangedFromContractId), `Customer` (nationalId), `Sale` (contractId, onlineOrderId), `ExpenseDocument` (vendorTaxId, journalEntryId, createdById, approvedById), `OtherIncome` (7 FK fields), `RepairTicket` (4 FK fields). These will cause sequential scans on common joins. |
| B4 Drift | **PASS** | Latest migration columns (`ordered_at`, `is_direct_receive`, `gr_number`, `defect_reason`) align with expected schema additions for purchasing v2. No obvious mismatch. |

### B1 Notable Missing Timestamps

Models that likely **should** have standard timestamps (not append-only/immutable by design):

| Model | Missing |
|-------|---------|
| `Customer` | `createdAt`, `updatedAt`, `deletedAt` |
| `FixedAsset` | `createdAt`, `updatedAt` |
| `Promotion` | `createdAt`, `updatedAt` |
| `CompanyInfo` | `createdAt`, `updatedAt` |
| `AiSettings` | `createdAt`, `deletedAt` |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current) + `claude-haiku-4-5-20251001` for cost routing. `MAX_TOOL_ITERATIONS = 5` guard present. `maxTokens = 1024`. Sentry imported and available. API key loaded from `IntegrationConfigService` (not hardcoded). |
| C2 Prompt | **WARN** | Bank account, phone, business hours in system prompt match `finance-rules.ts` constants ✅. **Late fee is hardcoded as "50 บาท/วัน"** in `system-prompt.ts:51` — the actual late fee is now driven by `late_fee_per_day_rate` SystemConfig key (D2 model); the prompt will give wrong info if the config changes. |
| C3 Tools | **OK** | 7 tools defined, all 7 handled in `tool-executor.ts` switch. All have Thai descriptions. `customerId` intentionally NOT in tool schema — injected by orchestrator, preventing cross-customer data access. |
| C4 Auto-Trigger | **OK** | Idempotency via `ChatAutoTrigger` table marker checked before each send. All 6 types covered: T-5, T-3, T-1, T, T+1, T+3. Sentry `captureException` present in both cron error handlers (`runDailyReminders`, `runDailyEscalations`). |
| C5 Security | **OK** | LIFF controller: `LiffTokenGuard` ✅. Admin controller: `JwtAuthGuard + RolesGuard` ✅. Webhook dedup: DB unique constraint on `eventId` with 7-day retention cron ✅. Customer isolation via orchestrator-injected `customerId` ✅. |

---

## Action Items (Prioritised)

### P0 — Must Fix (Blocking CI)

1. **Generate `@prisma/client-finance`** — `prisma-finance.service.ts` imports `@prisma/client-finance` which doesn't exist (likely a planned dual-DB client not yet generated). This causes 7 TS errors, 17 API test suite failures, and 148 failing tests. Run `npx prisma generate --schema=apps/api/prisma/schema-finance.prisma` or remove the stale service if the dual-DB approach was cancelled.
   - Files: `apps/api/src/prisma/prisma-finance.service.ts`, `apps/api/src/modules/health/health.controller.ts`

### P1 — High Priority

2. **Decimal compliance** — 119 `Number()` calls on `Decimal` money fields. The highest-risk are in `finance-tools.service.ts` (chatbot payment calculations) and `customer-query.service.ts` (outstanding balance aggregation). Replace with `new Prisma.Decimal(value)` or `.toNumber()` only for display.

3. **Late fee prompt divergence** — `system-prompt.ts:51` hardcodes "50 บาท/วัน". This will silently give customers wrong information if `late_fee_per_day_rate` SystemConfig changes. The prompt should say the fee may vary and always use the `calculate_fine` tool, or be refreshed from DB (the existing 5-min prompt cache mechanism supports this if the value is pulled from config).

### P2 — Medium Priority

4. **Document public controllers in `security.md`** — 9 controllers without `JwtAuthGuard` are not in the whitelist. Each is either legitimately public (shop storefront, LINE webhooks) or protected by alternative means (ShopBotDefenseGuard, LiffTokenGuard, metrics token). Add them to the whitelist with the rationale, as required by the security rule "ถ้าพบ controller ที่ไม่มี guard ที่ไม่อยู่ในรายการนี้ → ถือว่าเป็น security bug".

5. **`$executeRawUnsafe` → `$executeRaw`` template** — Low actual risk (lockKey is computed integer) but violates the safer pattern. Two instances: `e-tax-xml.service.ts:160` and `contacts/contact-resolver.service.ts:32`.

### P3 — Low Priority

6. **Missing FK indexes** — Add indexes on high-traffic FK fields: `Contract.productId`, `Customer.nationalId`, `Sale.contractId`, `OtherIncome` FK fields. Will reduce sequential scans on common join queries.

7. **Bundle split for `LettersPage`** — 568 KB minified (220 KB gzip). Second-largest page chunk. Consider lazy-loading the letter-generation library it pulls in.

8. **`Customer` model timestamps** — Verify whether `createdAt`, `updatedAt`, `deletedAt` were intentionally omitted from the `Customer` model. If so, add a `/// Immutable` comment explaining why; if not, add the columns via migration.

---

*Generated by CTO Watchdog automated run — 2026-06-30*
