# CTO Watchdog Report — 2026-05-28

## Summary

**7 PASS / 6 WARN / 2 FAIL** across 15 checks.
Critical blocker: `@prisma/client-finance` not generated — causes 7 TS errors and 144 test failures across 14 suites.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors — all from `@prisma/client-finance` module not found in `prisma-finance.service.ts`. Web: 0 errors (clean). |
| A2 Security | **PASS** | No unexpected unguarded controllers. 13 controllers use alternative guards (ShopBotDefenseGuard, LiffTokenGuard, LineWebhookGuard, HMAC, X-Metrics-Token). No `$queryRawUnsafe`, no localStorage token storage (E2E escape hatch is intentional + scoped), no hardcoded secrets. |
| A3 Decimal | **WARN** | 141 `Number()` calls on money fields across production services. Highest risk: `paysolutions.service.ts` (12 hits — amounts sent to payment gateway), `sales.service.ts` (lines 291, 506, 597 — contract calculations), `customers.service.ts` (7 hits). Display/chatbot usages are cosmetic risk only. |
| A4 Soft-Delete | **WARN** | 492 raw grep hits; most are false positives (immutable/append-only models). One confirmed gap: `compliance.service.ts:61` — `contract.findMany({ where: { id: { in: ids } } })` missing `deletedAt: null`. Blast radius limited (IDs pre-filtered at line 50) but soft-deleted contracts could appear in compliance reports. |
| A5 Tests | **FAIL** | API: 3,745 passed / **144 failed** / 8 skipped across 3,897 total (14 failing suites). Root cause: missing `@prisma/client-finance` cascades into asset, other-income, depreciation, health, and CLI specs. `collections-foundation.seed.spec` fails on live DB seed. Web: 0 TS errors; Vitest result pending (timed out in environment). |
| A6 Bundle | **PASS** | Build succeeded (5.78s). No chunk exceeds 500 KB gzipped. Largest: `excel` 256 KB gz, `LettersPage` 220 KB gz, `ContractTemplatesPage` 145 KB gz. Total bundle ~2.0 MB gzipped. `LettersPage` appears to inline some ExcelJS/jsPDF — worth investigating a dynamic import. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 184 models total. 5 models missing required timestamps without a `///` doc comment: **`SavingPlanPayment`** (missing `updatedAt` + `deletedAt` — financial record, no soft-delete path), **`CustomerScore`** (missing `deletedAt` — orphaned on customer soft-delete), **`AccountingPeriod`** (missing `deletedAt`), **`IpRateLimit`** (non-UUID PK + no timestamps — likely intentional for upsert efficiency but undocumented), **`ProductReservation`** (missing `deletedAt`). Money fields: all `@db.Decimal(12,2)` — no `Float` violations. Enums: all PascalCase/SCREAMING_SNAKE_CASE — clean. |
| B2 Migrations | **PASS** | 269 total migrations. Latest 5 are additive only (new columns, `ADD VALUE IF NOT EXISTS` on enums). No `DROP TABLE`, `TRUNCATE`, or destructive `ALTER TYPE` in recent history. |
| B3 Indexes | **WARN** | 5 FK fields missing `@@index` on queried-field patterns: `Repossession.appraisedById` + `.soldContractId`, `MdmLockRequest.rejectedById`, `ProductPhoto.uploadedById`, `SmsTemplate.variantOf` (self-ref), `ExternalFinanceCommission.customerId`. These will cause full scans on staff/customer-scoped reports. |
| B4 Drift | **PASS** | Latest migration (`phase3_bubble_rich_types`) aligns with schema.prisma exactly — SQL types match Prisma types. No column renames or type mismatches detected. Note: several models (`BroadcastMessage`, `StockCount`, `KycVerification`, `BadDebtProvision`) use `String` for status fields instead of typed enums — pattern-wide, not new drift, no DB-level value constraints enforced. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5` guard present — hits Sentry `captureMessage` on limit. Full `try/catch` + `Sentry.captureException` on Claude API errors. `maxTokens = 1024` with 30s per-iteration timeout (150s worst-case). Note: 1024 is tight if a long tool response + formal template are emitted in the same turn — monitor for silent truncation. |
| C2 Prompt | **WARN** | ~621 tokens — well within limits. No contradictions between system prompt and `finance-rules.ts` constants (bank account `203-1-16520-5`, phone `063-134-6356`, hours Mon–Sat 09:00–18:00 match). However: bank account and phone are **hardcoded in the system prompt text** — if admin updates via SystemConfig UI, `get_bank_info` tool will serve new values but the system prompt stays stale until manually edited. Risk is mitigated if Claude calls the tool rather than reciting the prompt, but not guaranteed. |
| C3 Tools | **OK** | All 7 tools defined with Thai descriptions and proper input schemas (`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`). All 7 have matching `case` entries in `tool-executor.ts`. Runtime schema validation layer (`validateToolInput`) + PII redaction on audit logs. `daysOverdue` capped at 3650 (abuse guard). |
| C4 Auto-Trigger | **WARN** | Idempotency: `ChatAutoTrigger` unique constraint `[customerId, referenceKey]` — safe for multi-instance Cloud Run. 6 reminder types covered: T-5, T-3, T-1, T-day, T+1, T+3. Top-level `Sentry.captureException` on `runDailyReminders` / `runDailyEscalations`. Gap: **individual per-customer LINE send failures** are logged to DB (`status: FAILED`) but NOT reported to Sentry — a full LINE API outage affecting all customers for a day would be invisible in Sentry alerts. |
| C5 Security | **OK** | LIFF controller: `LiffTokenGuard` (server-side LINE verify against `api.line.me`) + throttling (5/min OTP, 10/min verify, 30/min status) + `@SkipCsrf()`. Admin controller: `JwtAuthGuard + RolesGuard` on all routes. Webhook: HMAC-SHA256 timing-safe verification; manual test endpoints require `OWNER`/`FINANCE_MANAGER`. Dedup: `ProcessedWebhookEvent` DB unique constraint, 7-day retention cron. Tool executor: `customerId` injected from verified session — Claude cannot request another customer's data. |

---

## Action Items

### P0 — Fix Immediately (blocking CI)

1. **Generate `@prisma/client-finance`** — Run `npx prisma generate --schema=apps/api/prisma/schema-finance.prisma` (or equivalent). This single issue causes all 7 TS errors and 144 test failures across 14 suites. Check `apps/api/package.json` postinstall scripts — the finance client may have been added to schema but generation step not wired into the startup hook.

### P1 — High Risk (production financial accuracy)

2. **`paysolutions.service.ts`** — Replace `Number()` wrapping on payment gateway amounts with `Prisma.Decimal` or `.toFixed(2)` string serialization. Floating-point rounding on amounts sent to PaySolutions can cause ±1 satang mismatches that are hard to reconcile.

3. **`sales.service.ts` lines 291, 506, 597** — `Number(product.costPrice)` and `Number(interestRate)` in contract calculations. Use `new Prisma.Decimal(value)` throughout to preserve precision through the calculation chain.

### P2 — Medium (correctness / compliance)

4. **`compliance.service.ts:61`** — Add `deletedAt: null` to the inner `contract.findMany` call to prevent soft-deleted contracts appearing in compliance reports.

5. **`SavingPlanPayment` model** — Add `deletedAt DateTime?` and `updatedAt DateTime @updatedAt`. This is a financial payment record with no soft-delete path.

6. **Add `///` comments or `deletedAt`** to `CustomerScore`, `AccountingPeriod`, `ProductReservation`, `IpRateLimit` explaining the intentional exception per `database.md` rules.

### P3 — Low (performance / observability)

7. **Missing FK indexes** — Add `@@index([appraisedById])` and `@@index([soldContractId])` to `Repossession`; `@@index([rejectedById])` to `MdmLockRequest`; `@@index([uploadedById])` to `ProductPhoto`; `@@index([variantOf])` to `SmsTemplate`; `@@index([customerId])` to `ExternalFinanceCommission`.

8. **Chatbot auto-trigger** — Add `Sentry.captureException` inside `sendReminder`'s per-customer catch block so LINE API outages surface as Sentry alerts, not silent DB `FAILED` rows.

9. **Chatbot system prompt** — Consider loading bank account and phone from `FinanceConfigService` at prompt-build time so the system prompt stays consistent with SystemConfig without manual edits.

10. **`LettersPage` chunk** (220 KB gz) — Investigate whether ExcelJS/jsPDF are being bundled inline rather than split into the separate `excel`/`pdf` chunks. A dynamic import on the export action could halve this chunk.
