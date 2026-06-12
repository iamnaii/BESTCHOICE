# CTO Watchdog Report — 2026-06-12

## Summary
**9/15 checks passed** — 2 critical failures (TypeScript errors + API test regressions both root-caused to missing `@prisma/client-finance` generation); 4 warnings requiring attention.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | `apps/api`: 8 errors — `Cannot find module '@prisma/client-finance'` (SP7.1 finance DB). Session startup only ran `prisma generate` (main schema); finance schema client was not generated. Fix: `npm run prisma:finance:generate`. `apps/web`: 0 errors ✓ |
| A2 Security | **WARN** | No SQL injection, no localStorage token leaks, no hardcoded secrets. **3 undocumented public controllers** not in security.md's allow-list: `metrics.controller.ts` (X-Metrics-Token header for Prometheus), `staff-chat/web-widget.controller.ts` (anonymous chat widget, no guards), `yeastar-webhook.controller.ts` (HMAC-SHA256 verified PBX events). Shop-family controllers (cart, line-chat, reservation, shipping, tracking) use `ShopBotDefenseGuard` — covered by existing shop-* documentation. |
| A3 Decimal | **FAIL** | **109 instances** of `Number()` wrapping `Prisma.Decimal` fields across 40+ files. Critical paths: `paysolutions-confirmation.service.ts` (lines 54, 75, 84, 91, 177, 197, 302), `finance-tools.service.ts` (lines 55, 56, 125, 128, 144, 213), `document-rendering.service.ts` (lines 238, 324, 325, 553), `notification-reminder.service.ts` (lines 123, 131, 143, 165, 256), `tax-export.service.ts` (lines 56, 67, 73, 77). These cause silent precision loss on financial calculations. |
| A4 Soft-Delete | **WARN** | 4 queries missing `deletedAt: null`: `reporting/compliance.service.ts:61` (contract findMany → compliance reports may include deleted contracts), `staff-chat/services/canned-response-variable.service.ts:85` (payment findFirst), `staff-chat/services/lead-scoring.service.ts:17` (chatMessage findMany), `staff-chat/services/ai-suggest.service.ts:40` (chatMessage findMany). |
| A5 Tests | **FAIL** | **API**: 14 suites failed, 145 tests failed, 4867 passed (5020 total). All failures cascade from A1 (`@prisma/client-finance` not generated — `backfill-user-companies.cli.spec.ts` and dependents). **Web Vitest**: 627 tests passed (96 files) ↑ from 129 baseline ✓ |
| A6 Bundle | **WARN** | No chunks exceed 500 KB gzipped. Raw-size Vite warnings: `excel` 929 kB (gzip 256 kB), `thai-address-data` 871 kB (gzip 69 kB), `LettersPage` 569 kB (gzip 220 kB). The excel and LettersPage chunks are candidates for further lazy-loading if initial load time degrades. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **PASS** | All money fields use `@db.Decimal(12,2)`. All enums: PascalCase names, SCREAMING_SNAKE_CASE values ✓. Documented exceptions correct: `AuditLog`/`DocumentAuditLog` omit `updatedAt`/`deletedAt` (immutable); token models omit `updatedAt` (use-once); `PromiseSlot` omits `deletedAt` with explicit comment (cascade from CallLog). Two `Float` fields found (`confidence`, `quality`) — both are OCR/ML confidence scores, not money fields ✓. |
| B2 Migrations | **PASS** | **279 migrations** total. Latest 3 names are descriptive. No `DROP TABLE` found. `DROP COLUMN` only appears with `IF EXISTS` guards (2FA removal in `20260971000000_remove_2fa` is intentional and well-commented). `ALTER TYPE` additions all use `ADD VALUE IF NOT EXISTS` (safe, additive only). |
| B3 Indexes | **WARN** | 503 `@@index` entries overall — excellent coverage. **6 missing FK indexes** identified: `Contract.productId`, `Contract.reviewedById`, `Contract.interestConfigId` (high-cardinality FK on a core query-heavy table); `Payment.toleranceJournalLineId`; `Product.poId`, `Product.inspectionId`. Contract is the most-queried model; missing indexes on productId and reviewedById will cause seq scans under load. |
| B4 Drift | **PASS** | Latest migration `20260972000000_journal_line_restrict_and_index` (FK Cascade→Restrict + compound index on `journalEntryId, deletedAt`) matches schema.prisma lines 3793–3795. No drift detected. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` ✓ (current). `MAX_TOOL_ITERATIONS = 5` ✓. `maxTokens = 1024` ✓. 30-second per-iteration timeout via AbortController. Sentry captures on max-iterations, API errors, and empty responses. Prompt caching enabled (`cache_control: ephemeral`). |
| C2 Prompt | **OK** | ~251 tokens (lean). Bank account, phone number, business hours (Mon–Sat 09:00–18:00) present. Clear safety rules: no PII echo, no guessing, escalation triggers defined. No contradictions between system prompt and `finance-rules.ts`. |
| C3 Tools | **OK** | 7 tools defined, all in Thai. All 7 handled in `tool-executor.ts` switch with default fallback. Input validation enforced: day bounds (0–3650), query length (1–500 chars), priority enum check. PII keys (`password`, `token`, `secret`, `national_id`) redacted in audit logs. |
| C4 Auto-Trigger | **OK** | DB-backed idempotency via `ChatAutoTrigger(customerId, referenceKey)` unique constraint; P2002 violation → skip safely. All 6 reminder types covered: T-5, T-3, T-1, T (09:00 BKK), T+1, T+3 (10:00 BKK). Sentry capture on both cron jobs. |
| C5 Security | **OK** | LIFF controller: `LiffTokenGuard` + `@LiffChannel(FINANCE)` + per-endpoint throttle (5/min OTP). Admin controller: `JwtAuthGuard + RolesGuard` on all routes. Webhook dedup: `ProcessedWebhookEvent` unique on `eventId`, 7-day retention cron. Customer data isolation: `customerId` injected by orchestrator, never from Claude input — no cross-customer data leak path. |

---

## Action Items

### P0 — Fix immediately (blocks CI + tests)

1. **Update session startup hook to generate finance Prisma client**
   - Root cause of A1 (8 TS errors) + A5 (14 failed suites, 145 tests).
   - Fix: add `npx prisma generate --schema=prisma-finance/schema.prisma` to `.claude/session-start-hook.sh` (or equivalent startup script) after the existing `prisma generate` call.
   - Command: `cd apps/api && npm run prisma:finance:generate`

### P1 — Fix this sprint (financial correctness risk)

2. **Decimal precision — 109 `Number()` coercions on money fields** (A3)
   - Highest risk: `paysolutions-confirmation.service.ts` (payment amounts), `finance-tools.service.ts` (chatbot balance display), `document-rendering.service.ts` (contract PDF figures).
   - Fix: use `new Prisma.Decimal(value)`, `.toDecimalPlaces(2)`, or native Prisma Decimal arithmetic. For display-only formatting, use `.toFixed(2)` (string, never feed back into calculations).
   - Track with: `grep -rn "Number(" apps/api/src --include="*.service.ts" | grep -E "amount|price|cost|total|balance|interest|commission"` should return 0.

3. **Add 6 missing FK indexes** (B3)
   - `Contract`: add `@@index([productId])`, `@@index([reviewedById])`, `@@index([interestConfigId])`
   - `Payment`: add `@@index([toleranceJournalLineId])`
   - `Product`: add `@@index([poId])`, `@@index([inspectionId])`
   - Add in a single migration: `20260973000000_add_missing_fk_indexes`

### P2 — Fix next sprint (data integrity)

4. **Add `deletedAt: null` to 4 queries** (A4)
   - `reporting/compliance.service.ts:61` — compliance anomaly reports may count deleted contracts
   - `staff-chat/services/canned-response-variable.service.ts:85`
   - `staff-chat/services/lead-scoring.service.ts:17`
   - `staff-chat/services/ai-suggest.service.ts:40`

5. **Document 3 new public controllers in security.md** (A2)
   - Add to "Intentionally Public Endpoints" list:
     - `metrics` — Prometheus scraper (X-Metrics-Token header)
     - `staff-chat/web-widget` — anonymous public chat widget for website visitors
     - `yeastar-webhook` — PBX event webhook (HMAC-SHA256 signature verified)

### P3 — Nice to have

6. **Bundle: consider lazy-splitting `LettersPage`** (A6)
   - 569 kB raw / 220 kB gzip is the largest user-facing page chunk. Letters/bulk-print is an infrequent workflow — consider splitting the PDF generation library import.

---

*Report generated by CTO Watchdog agent · 2026-06-12 · 15 checks across Code, Database, and Chatbot health.*
