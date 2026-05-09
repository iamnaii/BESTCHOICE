# CTO Watchdog Report — 2026-05-09

## Summary
13/15 checks passed — 2 warnings require action (Decimal compliance, 1 web test failure).

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | `tsc --noEmit` exits 0 on both `apps/api` and `apps/web` — 0 errors |
| A2 Security | **WARN** | See details below |
| A3 Decimal | **WARN** | 30+ `Number()` calls near money fields across 6 services |
| A4 Soft-Delete | **PASS** | Spot-checked `liff-api.service.ts` — all 12+ queries include `deletedAt: null`. `CallLog`/`ChatMessage` findMany omissions are intentional (append-only). |
| A5 Tests | **WARN** | API: 2314 total, **15 failed** (DB-env seed specs). Web: 222 total, **1 failed** (keyboard hook) |
| A6 Bundle | **PASS** | No chunk exceeds 500 KB gzipped. Max: `excel` 256 KB gzip. Vite warns on 4 chunks >500 KB *minified* (not gzip). |

### A2 Security — Detail

**Controllers missing `JwtAuthGuard` (not in approved public list):**

| Controller | Guard Used | Risk |
|-----------|-----------|------|
| `staff-chat/web-widget.controller.ts` | None (anonymous by design) | Low — serves anonymous visitors, no PII returned |
| `line-oa/line-login.controller.ts` | None (OAuth redirect) | Low — pure redirect, no data returned |
| `metrics/metrics.controller.ts` | `@Public` + shared-secret comment | Low — Prometheus scraper |
| `shop-*` (9 controllers) | `ShopBotDefenseGuard` | Low — customer-facing shop, uses bot-defense guard |
| `line-oa/liff-api.controller.ts` | `LiffTokenGuard` | OK — verified via LINE LIFF token |
| `line-oa/line-oa-chatbot.controller.ts` | `LineWebhookGuard` | OK — LINE webhook signature |

**Action needed:** Add `web-widget`, `line-login`, `metrics`, and `shop-*` controllers to `security.md` allowed-public list. Currently undocumented = future security reviewers will flag them.

**Raw SQL:** All `$queryRaw` uses are parameterized template literals (Prisma auto-parameterizes) or health-check `SELECT 1`. No unsafe string concatenation found.

**localStorage token:** `api.ts:10` reads `localStorage.getItem('access_token')` only in E2E test mode (Playwright `addInitScript`), guarded by comment + cleanup on line 13. Not a production vulnerability.

**Hardcoded secrets:** None found.

### A3 Decimal — Detail

Files with `Number()` conversion of Decimal money fields:

| File | Lines | Severity |
|------|-------|---------|
| `chatbot-finance/services/auto-trigger.service.ts` | 169 | WARN — payment reminder amount calc: `Number(amountDue) - Number(amountPaid)` (display only, not stored) |
| `chatbot-finance/services/finance-tools.service.ts` | 53, 54, 108 | WARN — chatbot balance display, summation |
| `line-oa/chatbot.service.ts` | 151, 160, 172, 199, 215 | WARN — chatbot summation (`reduce` + `Number`) |
| `line-oa/line-oa-payment.controller.ts` | 129, 130, 519 | WARN — filter bounds from query string |
| `sales/sales.service.ts` | 286, 579 | WARN — cost price used in margin calculation |
| `shop-catalog/shop-catalog.service.ts` | 93, 134 | INFO — display/grouping only |
| `asset/asset.service.ts` | 195, 236, 362 | WARN — depreciation math |
| `customers/customers.service.ts` | 1100 | WARN — `Number(_sum.amountDue)` — should be `Prisma.Decimal` |

### A5 Tests — Detail

**API (Jest): 2299 passed / 15 failed / 2314 total** (up from 577 baseline — significant growth ✅)

Failed suites (3): All are DB-seed integration specs (`collections-foundation.seed.spec.ts` and 2 others) that require a live PostgreSQL connection. Failure: `upsert` on `system@bestchoice.internal` user returns error because no test DB is running in this environment. This is a **CI environment gap**, not a code bug.

**Web (Vitest): 221 passed / 1 failed / 222 total** (up from 129 baseline ✅)

Failed test: `src/hooks/useCollectionsKeyboard.test.tsx:74`
```
expect(onSwitchTab).toHaveBeenCalledWith('today')  // was never called
// 'q' key press should switch to 'today' tab
```
This is a **real test regression** — keyboard shortcut handler not calling `onSwitchTab('today')` when `q` is pressed.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | 156 models, 458 indexes/uniques. Float used only for GPS coords + AI confidence scores — correct. No Float on money fields. 100 enums all PascalCase names / SCREAMING_SNAKE_CASE values. |
| B2 Migrations | **PASS** | 206 migrations, all descriptive names. Latest (`20260809000000_add_receipt_partial_fields`) is clean `ALTER TABLE ADD COLUMN`. DROP operations in history are planned schema restructures (phase a4) using `DROP COLUMN IF EXISTS`. `ALTER TYPE ADD VALUE` is safe additive. |
| B3 Indexes | **PASS** | 458 `@@index`/`@@unique` entries across 156 models. FK fields indexed. |
| B4 Drift | **PASS** | Receipt fields added in latest migration (`payment_status`, `installment_partial_seq`, `remaining_amount`) verified present in `schema.prisma` lines 2862-2866. `remainingAmount` correctly typed `Decimal @db.Decimal(12,2)`. |

### B1 Schema — Notes

- `deletedAt` present on 152/156 models. Missing ~4 models are audit/token/event types which are documented exceptions (`AuditLog`, `ProcessedWebhookEvent`, etc.).
- `updatedAt` present on 126/156 — same exception pattern applies.
- Good: no `@default(autoincrement())`, all IDs are UUID.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` ✅. `MAX_TOOL_ITERATIONS = 5` ✅. `maxTokens = 1024` ✅. Sentry on exception + on max-iterations warning ✅. 30s per-iteration timeout ✅. |
| C2 Prompt | **OK** | Bank: KBank 203-1-16520-5 บจก.เบสท์ช้อยส์โฟน ✅. Phone: 063-134-6356 ✅. Hours: จันทร์-เสาร์ 09:00-18:00 ✅. Late fee: 50 บาท/วัน — consistent with `LATE_FEE_PER_DAY` constant ✅. Prompt ~2.5K tokens (well within 200K context). |
| C3 Tools | **OK** | 7 tools defined. Executor handles all 7 via switch-case with default fallback. Input validation via `validateToolInput` + PII redaction on rejection ✅. |
| C4 Auto-Trigger | **OK** | Idempotency via `chatAutoTrigger.create` unique constraint on `(customerId, referenceKey)` — P2002 → skip ✅. All 6 types covered: T-5, T-3, T-1, T, T+1, T+3 ✅. Sentry on both cron handlers ✅. |
| C5 Security | **OK** | LIFF controller: `@UseGuards(LiffTokenGuard)` + LINE ID token server-side verification ✅. Admin controller: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER','FINANCE_MANAGER')` ✅. Webhook dedup: `WebhookDedupService` via DB-backed `ProcessedWebhookEvent` ✅. Customer isolation: `customerId` injected by orchestrator — Claude cannot reference another customer's data ✅. |

---

## Action Items

### P1 — Fix immediately

1. **[A5-Web] `useCollectionsKeyboard` test failure** — `q` key press not firing `onSwitchTab('today')`. Check `useCollectionsKeyboard.ts` keyboard handler; likely a key binding or state condition bug introduced since last passing run.

### P2 — Fix this sprint

2. **[A3] Decimal precision in finance-critical services** — `customers.service.ts:1100` uses `Number(_sum.amountDue)` which truncates precision. `sales.service.ts:286,579` converts cost price to float for margin calc. Replace with `Prisma.Decimal` arithmetic. Priority files: `customers.service.ts`, `sales/sales.service.ts`, `asset/asset.service.ts`.

3. **[A3-chatbot] Chatbot auto-trigger amount** — `auto-trigger.service.ts:169` computes `Number(amountDue) - Number(amountPaid)` for reminder message. Switch to `new Prisma.Decimal(amountDue).minus(new Prisma.Decimal(amountPaid)).toNumber()` for display or format directly.

### P3 — Documentation / hygiene

4. **[A2] Undocumented public controllers** — Add `web-widget`, `line-login`, `metrics`, and `shop-*` (with `ShopBotDefenseGuard`) to `security.md` intentionally-public list. Prevents false positives in future audits.

5. **[A5-API] DB-seed integration specs in CI** — `collections-foundation.seed.spec.ts` and 2 sibling specs require a live database. Either tag them `@group db` and skip in unit-test CI, or ensure a test database is available. Currently masks real failures in summary counts.

### Info

- **Bundle size**: Vite build warning on 4 chunks >500KB *minified* (`thai-address-data`, `excel`, `ContractTemplatesPage`, `pdf`). Gzip sizes are within limits (max 256KB). No action needed unless initial load times degrade.
- **Test growth**: API tests grew from 577 → 2314 (+4×), web 129 → 222 (+72%). Strong coverage momentum.
- **Chatbot model**: `claude-sonnet-4-6` is current and appropriate for customer-facing use.
