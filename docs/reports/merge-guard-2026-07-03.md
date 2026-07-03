# Pre-Merge Guard Report — 2026-07-03

**Run date**: 2026-07-03  
**Branches reviewed**: 3 (most recently updated, non-guard/non-watchdog)  
**Reviewer**: Pre-Merge Guard Agent (automated)

---

## Branch 1: `fix/reschedule-qa-test-slip-contract`

**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commit**: `de4613ef` — `test(web): update reschedule QA test to the ref+slip contract (post #1343)`  
**Age**: ~8 hours ago  

### Changes Summary
- **1 file changed**: `apps/web/src/pages/PaymentsPage/components/__tests__/RescheduleOverlay.test.tsx` (+22 lines)

### What Changed
The TRANSFER payment flow in `RescheduleOverlay` previously required only `transactionRef` to enable submit. PR #1343 added `needSlip` gating (requiring a slip upload for BANK_TRANSFER), but the test was not updated. This branch syncs the test to reflect the real behaviour:
- Adds a mock for `GET /shop/upload/signed-url` (presigned S3 PUT)
- Spies on `globalThis.fetch` for the actual S3 upload
- Asserts submit stays disabled after ref is typed until slip is also uploaded
- Asserts `slipUrl` appears in the POST `/payments/record` payload

### Issues Found

#### Critical
None.

#### Warning
- The test spies on `globalThis.fetch` directly (line 265). This is acceptable for S3 presigned PUT (which bypasses the `api` client by design), but the comment clarifying this intent is good. No action needed.

#### Info
- `amount: 75.79` is asserted as a plain JavaScript number in the test payload comparison. This is a test concern only (the actual service converts to `Prisma.Decimal`), so no real financial precision risk.

### Recommendation: **APPROVE** ✅

Test-only fix, no production code changed. Aligns the test with the behaviour already live in main (from #1343). Safe to merge.

---

## Branch 2: `fix/late-fee-split-reschedule-collect-first`

**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commit**: `893c2a89` — `fix(payments): fee-first late-fee split + reschedule collect-first (ปรับดิว)`  
**Age**: ~28 hours ago  

### Context
This branch was the **source of PR #1326** (squash-merged into main). The branch remains open post-squash. The diff vs `origin/main` shows ~2,244 lines added across 33 files.

### Changes Summary (vs main)
- **New**: `reschedule-collect.service.ts` (424 lines), `reschedule-collect.service.spec.ts` (304 lines), `reschedule-quote.util.ts` (54 lines), `reschedule-quote.util.spec.ts` (104 lines), `paysolutions-intent.service.ts` (184 lines)
- **Modified**: `payments.service.ts`, `payments.controller.ts`, `payment-journal-preview.service.ts`, `paysolutions-confirmation.service.ts`, `paysolutions.service.ts`, `RescheduleOverlay.tsx`, and others

### Issues Found

#### Critical
1. **`Number()` on `Prisma.Decimal` financial field** (`paysolutions-confirmation.service.ts`, lines ~54, 75, 84, 91, 206, 227)
   - `amount: Number(payment.amountDue)` and `amount: Number(link.amount)` — these are Decimal fields from the DB
   - **Line ~206 is most critical**: `amount: Number(link.amount)` is passed into `rescheduleWithCollect()` as `input.amount` (type: `number`)
   - Inside `rescheduleWithCollect`, `input.amount` is used in `d(input.amount).minus(q.collectAmount)` — `d()` re-wraps to Decimal, so precision IS recovered for the comparison. The JE always uses `q.collectAmount` (Decimal) not `input.amount`
   - **Assessment**: The `Number()` conversion is a code-smell per project rules but does NOT cause actual financial precision loss in this implementation. The validation uses re-wrapped Decimal; the JE uses `q.collectAmount`. However this pattern violates `database.md` rule ("use `Decimal` never `Float`") and is a warning-level issue in production service code
   
2. **`Number()` on `payment.amountDue`** in status check response (lines ~54): Returns display amount for confirmation UI — not stored or used in JEs. Low financial risk.

#### Warning
1. **`RescheduleCollectInput.amount` typed as `number`** (`reschedule-collect.service.ts`, line 32): The interface uses `number` for `amount`. Should use `Prisma.Decimal` or `string` to avoid JS float precision issues when callers pass large Decimal values. The `d()` wrapper at the call site is a band-aid.

2. **`generateReceipt(...)` takes `amount: number`** (receipts.service.ts line 49, confirmed pre-existing): The `d(txResult.quote.collectAmount).toNumber()` conversion at line ~360 of `reschedule-collect.service.ts` is required by the existing signature. This is a pre-existing service interface issue, not introduced by this branch.

3. **Missing `deletedAt: null` on `installmentSchedule.findUnique`** (`reschedule-collect.service.ts` line 174, `payment-journal-preview.service.ts` line 75): `InstallmentSchedule` has a `deletedAt` field, but `findUnique` by composite key doesn't filter soft-deleted rows. **This pattern pre-exists in main** (same issue in `payment-journal-preview.service.ts`). Risk is low (installments are rarely soft-deleted), but should be corrected systematically.

4. **`RescheduleOverlay.tsx` `confirmMutation.onSuccess` calls `invalidateAll()` indirectly** (via function at line 188): `confirmMutation`'s `onSuccess` calls `invalidateAll()` correctly. `qrMutation`'s `onSuccess` also calls `invalidateAll()`. No cache invalidation gap.

#### Info
- The `installmentSchedule.findUnique` without `deletedAt: null` is a pre-existing codebase issue, not introduced by this branch

### Recommendation: **REVIEW** ⚠️

> **Note**: This branch's core content was already squash-merged as PR #1326. The branch is likely a stale feature branch. If re-merging, the `Number()` → `Prisma.Decimal` pattern on `RescheduleCollectInput.amount` and in `paysolutions-confirmation.service.ts` should be addressed before re-merge. Since content is already in main, **no immediate action needed** — branch can be closed/deleted.

**If treating as a fresh PR**: Block on `Number()` usage in production service code; fix `RescheduleCollectInput.amount` type to `string` and use `new Prisma.Decimal(amount)` inside the service.

---

## Branch 3: `feat/ai-hardening-followups`

**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits**: 7 commits (most recent: `30e3e8ac`)  
**Age**: ~34 hours ago  

### Context
This branch was the **source of PR #1325** (squash-merged into main as "AI hardening follow-ups"). Branch remains open post-squash.

### Changes Summary (vs main)
- 30 files changed, 672 insertions, 111 deletions — all modifications, no new files
- Key services: `ai-pricing.ts`, `knowledge-extractor.service.ts`, `vision.service.ts`, `credit-check.service.ts`, `ocr.service.ts`, `anthropic-ocr.client.ts`, `sales-bot.service.ts`, `embedding-backfill.cron.ts`, `ai-assistant.service.ts`, `ai-auto-reply.service.ts`

### Issues Found

#### Critical
None.

#### Warning
None. All changes are in AI/ML instrumentation, error handling improvements, and test coverage.

#### Info
1. **`as any` in spec files** (`embedding-backfill.cron.spec.ts`): `prisma as any`, `embedding as any` — acceptable in test mocks.
2. **7 commits not squashed into one clean commit**: Multi-commit branch. Minor style point.

### Recommendation: **APPROVE** ✅ (content already in main)

> **Note**: This branch's content was already squash-merged as PR #1325. The branch is a stale feature branch. The changes are well-structured: systemic-outage breaker in backfill, honest `errorKind` tagging in sales-bot, per-room rolling 24h window for AI reply cap, full LLM usage instrumentation. No security, financial precision, or guard issues found.

**Branch can be closed/deleted** — content is live in main.

---

## Summary Table

| Branch | Recommendation | Critical Issues | Warnings | Notes |
|--------|---------------|-----------------|----------|-------|
| `fix/reschedule-qa-test-slip-contract` | **APPROVE** ✅ | 0 | 0 | Test-only fix, safe to merge |
| `fix/late-fee-split-reschedule-collect-first` | **REVIEW** ⚠️ | 0 (1 code smell) | 3 | Content already in main (#1326); branch likely stale |
| `feat/ai-hardening-followups` | **APPROVE** ✅ | 0 | 0 | Content already in main (#1325); branch likely stale |

---

## Actionable Findings (if branches are to be re-merged)

1. **`fix/late-fee-split-reschedule-collect-first`**: Change `RescheduleCollectInput.amount: number` → `amount: string | Prisma.Decimal`; update `paysolutions-confirmation.service.ts` to use `new Prisma.Decimal(link.amount.toString())` instead of `Number(link.amount)` when passing to `rescheduleWithCollect`.

2. **Systemic**: Add `deletedAt: null` filter to `installmentSchedule.findUnique` calls across the codebase (pre-existing issue, not branch-specific).
