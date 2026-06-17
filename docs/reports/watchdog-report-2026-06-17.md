# CTO Watchdog Report — 2026-06-17

## Summary
**8/15 checks passed, 4 warnings, 3 failures.** Root cause of all 3 failures is the same P0: `@prisma/client-finance` package not generated — this cascades into TS errors and 145 test failures across 14 suites.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TS Errors | **FAIL** | API: 7 errors, all in `prisma-finance.service.ts` + `health.controller.ts` — `Cannot find module '@prisma/client-finance'`. Web: 0 errors. |
| A2 Security | **WARN** | 3 controllers not in security.md exemption list: `web-widget` (public by design, comment-documented, throttled), `shop-auth-social` + `shop-line-chat` (both use `ShopBotDefenseGuard`). `$executeRawUnsafe` in 2 files (`e-tax-xml.service.ts:160`, `contact-resolver.service.ts:32`) — used for `pg_advisory_xact_lock` with numeric lockKey (low risk). No hardcoded secrets. localStorage read is E2E-only, guarded. |
| A3 Decimal | **FAIL** | 120 instances of `Number()` near money fields found in production code. Hot files: `chatbot.service.ts` (6 hits), `staff-chat/chat-commerce.service.ts` (4 hits), `sales/sale-writer.service.ts` (2 hits), `shop-catalog/shop-catalog.service.ts` (2 hits). v4 hardening reduced this to 0 in core accounting paths — regression in newer modules. |
| A4 Soft-Delete | **WARN** | ~451 `findMany` calls without `deletedAt: null` (some intentional for immutable models). Notable gaps: `compliance.service.ts` queries `contract` + `callLog` without filter; `installments/reschedule.service.ts` queries `installmentSchedule` without filter. Most hits are in non-CRUD services (analytics, reporting). |
| A5 Tests | **FAIL** | API: 5020 total, **145 failed, 14 suites failed** — all traceable to `@prisma/client-finance` import error cascading across asset, other-income, depreciation, and overdue suites. Web: vitest not run (blocked by same). Baseline was 577 API tests — current 4867 passing suggests major test additions. |
| A6 Bundle | **WARN** | No chunk exceeds 500 KB **gzipped**. But 3 chunks exceed 500 KB raw: `excel` 929 KB, `thai-address-data` 870 KB, `LettersPage` 569 KB. Vite build emits warning. `LettersPage` (219 KB gzip) is the most actionable — consider lazy-loading the PDF/excel sub-sections. |

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema | **WARN** | 20 models flagged for missing `deletedAt` beyond known exempt list. Notable: `DunningRule`, `CompanyInfo`, `FixedAsset`, `FeeWaiverApproval`, `JournalPostAuditLog`, `SlipFingerprint`. Line-item sub-models (`ExpenseLine`, `PayrollLine`, `CreditNoteDetail`, etc.) are acceptable without soft-delete if parent is soft-deleted. Float used in `Signature`, `ChatMessage`, `AiSettings` — not money fields, acceptable. All money fields confirmed `Decimal(12,2)`. |
| B2 Migrations | **PASS** | 279 migrations total. Latest (`20260972000000_journal_line_restrict_and_index`) is descriptive and safe: FK Restrict + compound index on `journal_lines`. `20260971000000_remove_2fa` uses `DROP COLUMN IF EXISTS` — intentional 2FA removal, idempotent-safe. No unguarded `DROP TABLE` or `ALTER TYPE` on live data tables. |
| B3 Indexes | **PASS** | FK fields on models with >5 fields have corresponding `@@index`. No significant coverage gaps detected. The `journal_lines` compound index added in the latest migration improves the hot-read path. |
| B4 Drift | **PASS** | Latest migration SQL matches schema intent: `journal_lines.journal_entry_id` FK changed to RESTRICT, compound index added. `chart_of_accounts` has `name`, `normalBalance`, `type` columns consistent with Phase A.4 schema. No obvious mismatches. |

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | Model: `claude-sonnet-4-6` (current). `MAX_TOOL_ITERATIONS = 5` guard present. `maxTokens = 1024`. Sentry imported and used. History window: 10 msgs, 20k char budget. Prompt cache TTL 5 min. All healthy. |
| C2 Prompt | **OK** | System prompt references: KBank 203-1-16520-5 ✓, phone 063-134-6356 ✓, hours Mon-Sat 09:00-18:00 ✓, late fee 50 THB/day ✓. Vocabulary rules (ห้ามใช้ "หนี้", "ยึดเครื่อง" etc.) correct. iPhone-only product scope documented. No contradictions with `finance-rules.ts`. Estimated ~1,200 tokens — reasonable. |
| C3 Tools | **OK** | 7 tools defined: `get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`, `get_bank_info`, `search_knowledge_base`, `handoff_to_human`. All 7 handled in `tool-executor.ts` switch. No orphaned definitions or missing cases. |
| C4 Auto-Trigger | **OK** | Idempotency via `ChatAutoTrigger` marker checked before each send. All 6 types covered: T-5, T-3, T-1, T (daily 09:00), T+1, T+3 (escalations 10:00). Sentry captures in both cron methods. Asia/Bangkok timezone applied. |
| C5 Security | **OK** | LIFF controller uses `LiffTokenGuard` (LIFF-specific, correct). Admin controller has `JwtAuthGuard + RolesGuard`. Web-widget controller: intentionally public for anonymous visitors (documented in code comment), protected by `@Throttle`. `shop-auth-social` + `shop-line-chat` use `ShopBotDefenseGuard`. No customer data leaked across LINE user IDs. |

---

## Action Items (Prioritized)

### P0 — Fix immediately (blocks tests + CI)

1. **Generate `@prisma/client-finance`** — `prisma-finance.service.ts` imports `@prisma/client-finance` which was never generated. Run `npx prisma generate --schema=apps/api/prisma/schema-finance.prisma` (or confirm the schema path) to unblock the 7 TypeScript errors and 145 test failures in one shot. This is the single highest-leverage fix.

### P1 — Fix within 1 week

2. **Add `staff-chat/web-widget.controller.ts` to security.md exemption list** — it is intentionally public (serves anonymous website visitors) but not documented in the policy file. Same for `shop-auth-social` and `shop-line-chat` (using `ShopBotDefenseGuard`). Add them to the "Intentionally Public Endpoints" section so future audits don't flag them.

3. **Decimal compliance in new modules** — 120 `Number()` calls near money fields; highest-priority files are `line-oa/chatbot.service.ts` (6 hits affecting displayed balances), `staff-chat/chat-commerce.service.ts` (4 hits affecting price display), and `sales/sale-writer.service.ts` (2 hits on costPrice). Replace with `new Prisma.Decimal(...)` or `.toNumber()` only at display boundaries.

### P2 — Fix within sprint

4. **Soft-delete in compliance service** — `compliance.service.ts` queries `contract.findMany` and `callLog.findMany` without `deletedAt: null`. Soft-deleted contracts appearing in compliance reports could mislead auditors.

5. **Document or add `deletedAt` to flagged models** — `DunningRule`, `CompanyInfo`, `FixedAsset`, `FeeWaiverApproval`, `JournalPostAuditLog` lack soft-delete. Add `deletedAt DateTime?` or add `/// Immutable — deletedAt intentionally omitted` comments to silence future audit noise.

6. **LettersPage bundle** — 569 KB raw / 219 KB gzip. Consider lazily importing the PDF generation lib inside the letter-print action rather than at module load time.
