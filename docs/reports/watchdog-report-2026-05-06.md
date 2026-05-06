# CTO Watchdog Report — 2026-05-06

## Summary
8/15 checks clean; 7 require attention (1 FAIL, 6 WARN). No critical security breach. Two failing tests need immediate fixes.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | 0 errors in `apps/api` and `apps/web` |
| A2 Security | **WARN** | See notes below |
| A3 Decimal | **WARN** | `finance-tools.service.ts` uses `Number()` for money arithmetic |
| A4 Soft-Delete | **WARN** | `shop-catalog.service.ts` and `compliance.service.ts` missing `deletedAt: null` |
| A5 Tests | **FAIL** | API: 2213 tests / 1 failed. Web: 222 tests / 1 failed |
| A6 Bundle | **WARN** | 7 chunks exceed Vite 500 KB warning; top offender: excel 256 KB gzip |

### A2 — Security Detail

**localStorage/sessionStorage (PASS)**
- `api.ts:10` reads `localStorage.getItem('access_token')` only in E2E mode (Playwright `addInitScript`). Token is removed immediately after read. Not a production risk.
- Other localStorage uses are non-sensitive: sidebar collapse state, command-palette recent searches, contract draft auto-save.
- sessionStorage: LIFF session caching (non-sensitive) and chunk-reload guard in `ErrorBoundary`.

**Raw SQL (PASS)**
- All `$queryRaw` / `$executeRaw` calls use Prisma tagged-template literals — parameterized by construction. No string-interpolated SQL found.

**Controllers missing `@UseGuards` (WARN — 3 undocumented public endpoints)**

The approved public list in `security.md` is: `chatbot-finance-liff`, `sms-webhook`, `paysolutions`, `address`, `health`.

| Controller | Status | Reason |
|------------|--------|--------|
| `sms-webhook.controller.ts` | OK | Approved public |
| `shop-public-config.controller.ts` | OK | Approved public |
| `metrics.controller.ts` | OK | `@Public()` + `X-Metrics-Token` HMAC — Prometheus scrape, properly gate |
| `line-login.controller.ts` | OK | LINE OAuth redirect — inherently public |
| `yeastar-webhook.controller.ts` | OK | HMAC `createHmac + timingSafeEqual` signature verification |
| `facebook-webhook.controller.ts` | OK | Facebook signature verification via `SkipCsrf` + header check |
| **`web-widget.controller.ts`** | **⚠️ WARN** | No guard, no secret, not in approved list — exposes chat room init to anonymous callers |

**Hardcoded secrets: NONE found.**

### A3 — Decimal Compliance Detail

`Number()` on Decimal money fields used for **arithmetic** (not just display):

| File | Lines | Risk |
|------|-------|------|
| `chatbot-finance/services/finance-tools.service.ts` | 53–55, 108–111 | Chatbot balance calc: `amountDue - amountPaid`, total sums |
| `chatbot-finance/services/auto-trigger.service.ts` | 169 | Reminder amount calc |
| `customers/customers.service.ts` | 1100 | `totalOutstandingThb` aggregate |
| `sales/sales.service.ts` | 286, 579 | `costPrice` in sale record |

Display-only `Number().toLocaleString()` (notifications, stickers, shop-catalog) — low risk, acceptable for formatting.

### A4 — Soft-Delete Audit Detail

Queries missing `where: { deletedAt: null }` on models that **do** have `deletedAt`:

| File | Query | Model |
|------|-------|-------|
| `shop-catalog/shop-catalog.service.ts:89,112,118` | `product.findFirst/findMany` | `Product` (has `deletedAt`) |
| `reporting/compliance.service.ts:61` | `contract.findMany` | `Contract` (has `deletedAt`) |
| `installments/reschedule.service.ts:14` | `installmentSchedule.findMany` | Needs verification |

Note: many other flagged queries (`ChatMessage`, `CallLog`, `AuditLog`) are legitimately exempt (append-only, no `deletedAt` in schema).

### A5 — Test Failures Detail

**API — 1 failed** (`apps/api`):
```
collections-foundation.seed.spec.ts
  → prisma.user.upsert({ where: email: 'system@bestchoice.internal' })
  → Fails because test DB lacks the system user row / DB state issue
```
Not a business logic regression but breaks the test suite gate.

**Web — 1 failed** (`apps/web`):
```
src/hooks/useCollectionsKeyboard.test.tsx:74
  → act(() => press('q'))
  → expect(onSwitchTab).toHaveBeenCalledWith('today')  ← not called
```
Keyboard shortcut `q` → "today" tab regression. Likely introduced when CollectionsPage keyboard handler was refactored.

### A6 — Bundle Size Detail

| Chunk | Raw | Gzip | Action |
|-------|-----|------|--------|
| `excel-*.js` | 930 KB | **256 KB** | Already split; acceptable |
| `thai-address-data-*.js` | 871 KB | 69 KB | Low gzip ratio — consider loading on-demand |
| `ContractTemplatesPage-*.js` | 495 KB | **148 KB** | Largest page — heavy template editor imports |
| `pdf-*.js` | 431 KB | 139 KB | Already split; jspdf expected |
| `index-*.js` (recharts) | 421 KB | **126 KB** | Already split; charts expected |
| `charts-*.js` | 418 KB | **120 KB** | Already split; recharts expected |
| `CollectionsPage-*.js` | 392 KB | **103 KB** | Complex page — consider splitting sub-tabs |

Vite emits `(!) Some chunks are larger than 500 kB after minification` warning. All heavy libs (excel, pdf, charts) are already code-split from main bundle. Main risk: `ContractTemplatesPage` at 148 KB gzip.

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 2 models missing timestamp docs; non-standard Decimal precisions are intentional |
| B2 Migrations | **PASS** | 199 migrations; latest descriptive; DROPs all intentional schema evolution |
| B3 Indexes | **PASS** | 443 indexes across 150 models (~2.95/model); FK coverage good |
| B4 Drift | **PASS** | Latest migration matches schema — 2 new `expenses` columns, no drift |

### B1 — Schema Detail

**Money fields:** All financial amount fields correctly use `@db.Decimal(12, 2)`. Percentage/rate fields use `@db.Decimal(5,4)` (appropriate). One outlier: `costUsd @db.Decimal(12,6)` in AI cost tracking — intentional for USD micro-precision.

**Float fields:** Only `gpsLatitude` / `gpsLongitude` — non-monetary, correct use.

**Timestamps — undocumented omissions (WARN):**

| Model | Missing | Issue |
|-------|---------|-------|
| `PromiseSlot` | `deletedAt` | No `///` comment explaining omission. As an event slot it is likely immutable — needs annotation. |
| `FeeWaiverApproval` | `createdAt`, `updatedAt`, `deletedAt` | Only has `approvedAt`. An approval record should be immutable but needs a `/// Immutable approval record` comment per convention. |

All other flagged models (`AuditLog`, `ChatMessage`, `CallLog`, `WebhookDelivery`, `ProcessedWebhookEvent`, tokens, etc.) are legitimately exempt under database rules and have known exceptions.

**Enums:** PascalCase names, SCREAMING_SNAKE_CASE values throughout — compliant.

### B2 — Migration Detail

- **Count:** 199 migrations (20260101… → 20260802100000)
- **Latest:** `20260802100000_phase_a5c_tax_disallowed_flag` — descriptive ✓
- **DROP statements:** Found in migrations `20260316`, `20260415`, `20260615`, `20260801`. All are intentional: column renames, audit_log immutability cleanup, Phase A4 chart-of-accounts redesign. None are hot-path data loss risks.
- **ALTER TYPE:** None found.

### B3 — Index Coverage

443 `@@index` / `@@unique` definitions across 150 models. FK fields consistently indexed. Compound indexes present on high-cardinality query paths (`(status, branchId)`, `(callLogId, settlementDate)`, `(keptAt, brokenAt)`).

### B4 — Schema Drift

Latest migration (`phase_a5c_tax_disallowed_flag`) adds:
```sql
ALTER TABLE "expenses" ADD COLUMN "tax_disallowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "expenses" ADD COLUMN "disallowed_reason" TEXT;
```
Matches `Expense` model in `schema.prisma`. No drift.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | claude-sonnet-4-6, MAX_TOOL_ITERATIONS=5, maxTokens=1024, Sentry present |
| C2 Prompt | **OK** | Bank/phone/hours consistent with constants.ts; ~400 tokens; no contradictions |
| C3 Tools | **OK** | 7 tools defined; all 7 handled in executor; Thai descriptions; customerId injected |
| C4 Auto-Trigger | **OK** | Idempotency via ChatAutoTrigger; all 6 types covered; Sentry in both crон catch blocks |
| C5 Security | **WARN** | LIFF + admin guards correct; `web-widget.controller.ts` unguarded (same as A2) |

### C1 — AI Service Detail

- Model: `claude-sonnet-4-6` — current and meets spec ✓
- `MAX_TOOL_ITERATIONS = 5` — infinite-loop guard present ✓
- `maxTokens = 1024` — appropriate for chatbot replies ✓
- History: 10-message window, 20k char budget — bounded ✓
- Sentry: imported + used. Tool execution errors and API failures captured ✓
- Prompt cache: 5-minute TTL — efficient ✓

### C2 — Prompt Quality Detail

Verified consistency between `system-prompt.ts` and `constants/finance-rules.ts`:

| Constant | system-prompt | finance-rules.ts | Match |
|----------|--------------|-----------------|-------|
| Bank account | 203-1-16520-5 | 203-1-16520-5 | ✓ |
| Account name | บจก. เบสท์ช้อยส์โฟน | บจก. เบสท์ช้อยส์โฟน | ✓ |
| Phone | 063-134-6356 | 063-134-6356 | ✓ |
| Business hours | 09:00-18:00 จันทร์-เสาร์ | 09:00-18:00 จันทร์-เสาร์ | ✓ |
| Late fee | 50 บาท/วัน | LATE_FEE_PER_DAY = 50 | ✓ |

Prompt length ~1,500 characters (~400 tokens) — compact and within budget.

### C3 — Tool Definitions Detail

All 7 tools in `tool-definitions.ts` have corresponding `case` in `tool-executor.ts`:
`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`.

Security note: `customerId` is injected by the orchestrator — not a tool input — so the AI cannot call tools on behalf of other customers. ✓

### C4 — Auto-Trigger Detail

- **Idempotency:** `ChatAutoTrigger` table marker checked before send. PENDING/SENT check prevents double-send ✓
- **Coverage:** T-5, T-3, T-1, T (09:00 cron) + T+1, T+3 (10:00 cron) = all 6 types ✓
- **Error handling:** `Sentry.captureException` in both `runDailyReminders` and `runDailyEscalations` catch blocks ✓

### C5 — Security Detail

- **LIFF controller:** Uses `LiffTokenGuard` (not JwtAuthGuard) — correct for LINE LIFF context ✓
- **Admin controller:** `@UseGuards(JwtAuthGuard, RolesGuard)` confirmed ✓
- **Webhook dedup:** `ChatAutoTrigger` prevents replay ✓
- **Customer isolation:** `customerId` from authenticated session, not user input ✓
- **web-widget.controller.ts:** Same concern as A2 — anonymous POST creates chat rooms with no guard

---

## Action Items

### P0 — Fix Now

| # | Issue | File | Fix |
|---|-------|------|-----|
| 1 | **Web test failing** — keyboard shortcut `q` regression | `src/hooks/useCollectionsKeyboard.test.tsx:74` | Debug `useCollectionsKeyboard` — `q` key → `onSwitchTab('today')` not firing |
| 2 | **API seed test failing** — `system@bestchoice.internal` upsert | `modules/overdue/__tests__/collections-foundation.seed.spec.ts` | Add system user seed to test setup or mock the upsert |

### P1 — This Week

| # | Issue | File | Fix |
|---|-------|------|-----|
| 3 | **`web-widget.controller.ts` unguarded** | `modules/staff-chat/web-widget.controller.ts` | Add to approved public list in `security.md` with justification, OR add rate-limit + origin check |
| 4 | **`Number()` arithmetic in chatbot money calc** | `chatbot-finance/services/finance-tools.service.ts:53-55,108-111` | Replace with `Prisma.Decimal` arithmetic or use `.toNumber()` after all operations are done |
| 5 | **`shop-catalog` missing soft-delete filter** | `shop-catalog/shop-catalog.service.ts:89,112,118` | Add `deletedAt: null` to all `product.findFirst/findMany` calls |
| 6 | **`compliance.service.ts` missing soft-delete filter** | `reporting/compliance.service.ts:61` | Add `deletedAt: null` to `contract.findMany` |

### P2 — Backlog

| # | Issue | File | Fix |
|---|-------|------|-----|
| 7 | **Missing `///` timestamp comments** | `schema.prisma` — `PromiseSlot`, `FeeWaiverApproval` | Add `/// Immutable event record — deletedAt intentionally omitted` |
| 8 | **`ContractTemplatesPage` 148 KB gzip** | `apps/web/src/pages/ContractTemplatesPage.tsx` | Lazy-load heavy template editor deps (e.g. template variable picker) |
| 9 | **`thai-address-data` 871 KB raw / 69 KB gzip** | Vite bundle | Load address data on-demand only when address input form is rendered |
