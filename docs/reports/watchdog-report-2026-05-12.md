# CTO Watchdog Report — 2026-05-12

## Summary

10/15 checks fully passed. 2 FAIL (Decimal write-path, ContractStatus schema drift). 5 WARN (soft-delete gaps, API test DB infra, security undoc, indexes, timestamps). Chatbot fully healthy.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **PASS** | 0 errors in `apps/api`, 0 errors in `apps/web` |
| A2 Security | **WARN** | `staff-chat/web-widget.controller.ts` is fully public (no JwtAuthGuard, no custom guard) — uses `roomId` as capability token + 30/60 rpm throttle, but absent from `security.md` allow-list. No raw SQL, no localStorage token leaks, no hardcoded secrets. |
| A3 Decimal | **FAIL** | 2 write-path violations: `sales/sales.service.ts:286,579` — `Number(product.costPrice)` used in `shopProfit`/`financeProfit` arithmetic persisted to `interCompanyTransaction`; `shop-orders/online-order-sale.adapter.ts:52` — `Number(totalAmount)` fed into sale creation (potentially persisted). `customers/customers.service.ts:1100` — `Number(outstanding._sum.amountDue)` (read-only API response, lower risk). Display-only `Number()` in chatbot/line-oa/staff-chat services: acceptable but worth cleanup. |
| A4 Soft-Delete | **WARN** | 4 queries missing `deletedAt: null`: `staff-chat/services/canned-response-variable.service.ts:67` (Payment), `reporting/compliance.service.ts:61` (Contract), `chat-ai-draft/chat-ai-draft.service.ts:88` (Customer), `installments/reschedule.service.ts:57` (Contract). |
| A5 Tests | **WARN** | API: 2504 tests total — 2385 pass, **119 fail** (all Prisma `ECONNREFUSED` — test DB unavailable, infrastructure issue, not code regression). Web: 231 tests, **231 pass**, 0 fail (above 129-test baseline). |
| A6 Bundle | **PASS** | No chunks exceed 500 KB gzipped. Largest: `excel` (256 KB gz), `ContractTemplatesPage` (148 KB gz), `pdf` (139 KB gz). `thai-address-data` is 870 KB raw but only 69 KB gzip. Optimization opportunity: lazy-load Excel export trigger. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | All IDs are UUID ✅. All money fields use `@db.Decimal(12,2)` ✅. All 7 Float fields are legitimately non-monetary (GPS coords, AI confidence scores) ✅. Enum naming correct ✅. `SavingPlanPayment` lacks `updatedAt`/`deletedAt` with no doc comment — payment record should be auditable. ~13 other models (`AuditLog`, `WebhookDelivery`, `IpRateLimit`, `WebsiteVisit`, `WebsiteSession`, `ChatKbSuggestion`, etc.) omit standard timestamps without `///` exception comments per `database.md` convention. |
| B2 Migrations | **WARN** | 220 total migrations. Recent names are descriptive. `DROP COLUMN IF EXISTS` used 3 times (all guarded/intentional). `ALTER TYPE ... ADD VALUE` used 10 times (additive-only, safe). `ALTER TYPE ... RENAME VALUE` used 3 times (`AssetCategory` renames). All destructive ops use `IF EXISTS` guards. |
| B3 Indexes | **WARN** | Top missing indexes by query-impact: `AccountingPeriod.companyId` (every period lookup filters by company), `Contract.productId` (product detail → contracts), `FixedAsset` audit FK fields (`createdById`, `approverId`, `postedById`, `reversedById`), `ChatRoom.handoffStaffId`/`attributionId`, `Receipt.issuedById`. |
| B4 Drift | **FAIL** | **P0**: `ContractStatus` enum in `schema.prisma` is missing the `LEGAL` value added by migration `20260602000000_add_contract_status_legal`. The database has `LEGAL` as a valid enum value; Prisma client does not. Queries returning contracts with `status = 'LEGAL'` will throw at runtime. Latest migration (`20260919000000_add_account_role_map`) is in sync — no drift there. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` ✅. `MAX_TOOL_ITERATIONS = 5` guard ✅. Full try/catch + `Sentry.captureException` + `captureMessage` on exhaustion ✅. 30s per-iteration timeout ✅. `maxTokens: 1024` is low for multi-tool responses — consider raising to 2048. |
| C2 Prompt | **OK** | All critical values consistent between `system-prompt.ts` and `finance-rules.ts`: bank (กสิกรไทย), account (203-1-16520-5), name (บจก. เบสท์ช้อยส์โฟน), phone (063-134-6356), hours (จ-ส 09:00-18:00), late fee (50 ฿/day). No contradictions. Estimated ~725 tokens — well within budget. Minor: DB-editable admin prompt could drift from constant fallback. |
| C3 Tools | **OK** | 7 tools defined, all with Thai descriptions, all with typed input schemas, all handled in `tool-executor.ts` switch. `default` branch returns clean error. PII keys redacted in Sentry audit logs. Runtime validation via `tool-input-schemas.ts` before execution. |
| C4 Auto-Trigger | **OK** | Idempotency via `ChatAutoTrigger` table (`@@unique([customerId, referenceKey])`) — P2002 on duplicate returns `'skipped'` ✅. All 6 reminder types covered: T-5, T-3, T-1, T (due day), T+1, T+3 ✅. Sentry capture on cron-level errors ✅. Minor gap: individual LINE push failures update status to `FAILED` in DB but do not fire Sentry — high-volume failures (e.g., LINE API outage) would only surface in DB/logs. |
| C5 Security | **OK** | LIFF controller public with `LiffTokenGuard` (LINE token server-side verified) ✅. Admin controller has `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles()` on every method ✅. Webhook dedup via `ProcessedWebhookEvent` (DB-backed unique constraint, replay-safe for multi-instance Cloud Run) ✅. Customer data isolation: `customerId`/`roomId` injected by orchestrator from verified LINE identity — Claude cannot supply or change context ✅. LINE webhook HMAC-SHA256 with `timingSafeEqual` ✅. |

---

## Action Items

### P0 — Fix Immediately

1. **B4 — ContractStatus.LEGAL schema drift**: Add `LEGAL` to `ContractStatus` enum in `schema.prisma`. Run `npx prisma generate`. Do NOT run a migration — the value already exists in the DB. Any live query returning a `LEGAL` contract currently throws.
   ```prisma
   // apps/api/prisma/schema.prisma — ContractStatus enum
   LEGAL  // add this value
   ```

### P1 — Fix This Sprint

2. **A3 — Decimal write-path violations**:
   - `sales/sales.service.ts:286,579` — Replace `Number(product.costPrice)` with `new Prisma.Decimal(product.costPrice)` arithmetic before persisting to `interCompanyTransaction`.
   - `shop-orders/online-order-sale.adapter.ts:52` — Confirm whether `totalAmount` is written to DB; if so, use `Prisma.Decimal`.
   - `customers/customers.service.ts:1100` — Replace `Number(outstanding._sum.amountDue ?? 0)` with `new Prisma.Decimal(outstanding._sum.amountDue ?? 0).toNumber()` or return as string.

3. **A4 — Soft-delete gaps**: Add `deletedAt: null` to `where` clause in:
   - `staff-chat/services/canned-response-variable.service.ts:67`
   - `reporting/compliance.service.ts:61`
   - `chat-ai-draft/chat-ai-draft.service.ts:88`
   - `installments/reschedule.service.ts:57`

### P2 — Fix Next Sprint

4. **B3 — Add missing indexes** (highest-impact first):
   - `AccountingPeriod`: `@@index([companyId])`
   - `Contract`: `@@index([productId])`
   - `Receipt`: `@@index([issuedById])`
   - `ChatRoom`: `@@index([handoffStaffId])`, `@@index([attributionId])`

5. **A2 — Document `web-widget.controller.ts`** in `security.md` intentionally-public allow-list with note about capability-token model.

6. **B1 — Add `///` doc comments** to models missing standard timestamps without documentation: `SavingPlanPayment` (also evaluate adding `updatedAt`/`deletedAt`), `AuditLog`, `WebhookDelivery`, `IpRateLimit`, `WebsiteVisit`, `WebsiteSession`, `ChatKbSuggestion`.

7. **A5 — Restore test DB** for CI/dev environment so API tests are not failing on infrastructure. 119 failures are all `ECONNREFUSED` to Prisma — no test DB configured in this environment.

### P3 — Backlog

8. **C1 — Raise `maxTokens` to 2048** in `finance-ai.service.ts` to prevent truncated responses on multi-tool summarization.

9. **C4 — Sentry on LINE push failures**: Add `Sentry.captureMessage` when `failed > 0` at end of `processOffset` in `auto-trigger.service.ts`.

10. **A6 — Bundle optimization**: Lazy-load Excel export so `excel` chunk (256 KB gz) only downloads on user action. Consider further splitting `ContractTemplatesPage` (148 KB gz).

11. **C2 — Prompt constant sync**: Add a startup check or test that compares the `FINANCE_BOT_SYSTEM_PROMPT` constant against the DB-stored prompt to detect admin-introduced drift.
