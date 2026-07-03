# Merge Guard Report — 2026-07-03

**Run time**: 2026-07-03 (automated)
**Branches reviewed**: 3 (most recently updated feat/fix branches, excluding guard/watchdog/worktree)
**Total unmerged branches**: 525

---

## Branch 1: `fix/reschedule-qa-test-slip-contract`

**Author**: iamnaii <akenarin.ak@gmail.com>
**Commits**: 1 — `test(web): update reschedule QA test to the ref+slip contract (post #1343)`

### File Changes Summary
```
apps/web/src/pages/PaymentsPage/__tests__/RescheduleOverlay.test.tsx
  1 file changed, 22 insertions(+), 1 deletion(-)
```

### Issues Found

None. Test-only change: adds a TRANSFER-mode scenario that verifies the submit button stays disabled until both a reference number AND a slip file are provided, then asserts the POST includes `slipUrl`. The `fetch` spy is correctly scoped to the S3 presigned PUT (which is intentionally a raw fetch for binary upload — an established pattern in the codebase). No production code changed.

### Recommendation: ✅ APPROVE

---

## Branch 2: `fix/late-fee-split-reschedule-collect-first`

**Author**: iamnaii <akenarin.ak@gmail.com>
**Commits**: 1 — `fix(payments): fee-first late-fee split + reschedule collect-first (ปรับดิว)`

### File Changes Summary
```
33 files changed, 2244 insertions(+), 273 deletions(-)

Key files:
  apps/api/prisma/schema.prisma                                    (new columns: purpose, metadata on PartialPaymentLink)
  apps/api/prisma/migrations/20260979000000_partial_link_.../migration.sql
  apps/api/src/modules/payments/payments.controller.ts             (2 new endpoints)
  apps/api/src/modules/payments/payments.service.ts
  apps/api/src/modules/payments/services/reschedule-collect.service.ts  (NEW)
  apps/api/src/modules/journal/reconstruct-prior.ts               (NEW — shared primitive)
  apps/api/src/modules/journal/split-receipt.ts                   (fee-first allocation logic)
  apps/api/src/modules/paysolutions/services/paysolutions-confirmation.service.ts
  apps/web/src/pages/PaymentsPage/components/RescheduleOverlay.tsx (362 lines added)
```

### Issues Found

#### Warning
- **`Number(link.amount)` on Prisma Decimal** (`paysolutions-confirmation.service.ts`)
  `link.amount` is `Decimal @db.Decimal(12,2)` (PartialPaymentLink schema). Converted to JS `number` via `Number()` before passing to `rescheduleWithCollect()`. The target interface `RescheduleCollectInput.amount` is typed as `number` (intentional — service uses it for quote validation comparison), so this conversion is required. However, precision loss is theoretically possible for values >2^53 (not realistic for THB amounts, but is a deviation from the `Prisma.Decimal` rule). The `Sentry extra` field also uses `Number(link.amount)` — here it's safe (display only). **Recommend**: cast via `.toFixed(2)` + `parseFloat()` or accept as-is given the THB ceiling of ฿12M (within safe integer range).

- **Large files** — several pre-existing files grew past 500 lines in this PR:
  - `RecordPaymentWizard.tsx`: 1,691 lines
  - `payments.service.spec.ts`: 1,467 lines
  - `paysolutions-intent.service.ts`: 808 lines
  - These are PRE-EXISTING size issues (not introduced in this PR). No action needed now but worth tracking for future splits.

#### Info
- **`as any` on Prisma JSON path queries** (`reconstruct-prior.ts:3 usages`) — `{ metadata: { path: ['tag'], equals: '...' } } as any`. This is the established project pattern (191 existing instances across the codebase) for Prisma JSON field filtering. Not an issue.

### Security Checks
- ✅ `payments.controller.ts` has `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level
- ✅ Both new endpoints (`GET /payments/reschedule-quote`, `POST /payments/:id/reschedule-qr`) have `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')`
- ✅ No hardcoded secrets
- ✅ No raw `$queryRaw` with unparameterized input
- ✅ `findUnique({ where: { id } })` without `deletedAt:null` is followed immediately by `if (!contract || contract.deletedAt) throw new NotFoundException(...)` — correct manual soft-delete guard
- ✅ `queryClient.invalidateQueries()` present after reschedule success (5 query keys invalidated)
- ✅ Migration is additive-only (`ADD COLUMN IF NOT EXISTS`) — safe on live table

### Architecture Notes
The `collect-first` constraint ("เงินไม่เข้า ดิวไม่เลื่อน") is enforced via a single Serializable transaction in `RescheduleCollectService`. The `reconstruct-prior.ts` primitive correctly widens its discriminator to cover legacy `tag:'2B'` JEs while guarding against double-counting full-clear entries. The fee-first allocation in `split-receipt.ts` matches the CPA directive (42-1103 credited before 11-2103). Logic appears sound.

### Recommendation: ⚠️ REVIEW

Suggest addressing the `Number(link.amount)` conversion before merge (or documenting it as intentional given the safe THB ceiling). No blockers.

---

## Branch 3: `feat/ai-hardening-followups`

**Author**: iamnaii <akenarin.ak@gmail.com>
**Commits**: 5
```
fix(ai): systemic-outage breaker in backfill, honest sales-bot errorKind, rolling-window wording
chore: remove accidentally committed node_modules symlinks
fix(ai-usage): longest-prefix match in ratesFor; add gemini-2.5-flash-lite rate
fix(sales-bot): record error usage rows with accumulated tokens on provider throw
fix(staff-chat): embedding backfill survives poison rows — per-row fallback + permanent skip
```

### File Changes Summary
```
30 files changed, 672 insertions(+), 111 deletions(-)

Key files:
  apps/api/src/modules/sales-bot/sales-bot.service.ts             (tool-failure tagging, grounding guard)
  apps/api/src/modules/staff-chat/cron/embedding-backfill.cron.ts (poison-row fallback + EMBED_FAILED marker)
  apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts
  apps/api/src/modules/ocr/ocr.service.ts
  apps/api/src/modules/credit-check/credit-check.service.ts
  apps/web/src/pages/AiSettingsPage.tsx                           (wording: rolling-window label)
  .gitignore                                                       (exclude symlinked node_modules)
```

### Issues Found

#### Info
- **`as any` in test files** — `embedding-backfill.cron.spec.ts` uses `prisma as any` and `embedding as any` for mock injection. Standard pattern for NestJS service mocks in this project. Not a production concern.
- **Large files**: `ocr.service.spec.ts` at 933 lines, `ocr-extractors.service.ts` at 645 lines — these are PRE-EXISTING. Not changed in a way that should trigger a split now.

### Security Checks
- ✅ No new controllers added — no guard review needed
- ✅ No hardcoded secrets (test referencing `ANTHROPIC_API_KEY` is checking for missing-key behavior)
- ✅ No `fetch()` or raw `axios` in frontend changes (only UI label wording updated in `AiSettingsPage.tsx`)
- ✅ No Prisma queries added (AI services use Prisma only for logging — existing patterns)
- ✅ No financial Decimal fields involved — AI services deal with token counts (integers)

### Architecture Notes
The **poison-row strategy** in `EmbeddingBackfillCron` is well-designed: batch-level failure triggers per-row retry; rows that fail per-row retry get stamped `EMBED_FAILED` (permanent skip marker) only when other rows in the batch succeed (proving it's a data problem, not a systemic outage). When ALL rows fail per-row, the run throws instead of stamping (systemic outage path — one Sentry capture per run, not per row). The **`toolFailed` flag** in `SalesBotService` correctly distinguishes Prisma-side tool failures from LLM provider failures in `AiUsage` error records.

### Recommendation: ✅ APPROVE

---

## Summary Table

| Branch | Files | +Lines | Recommendation |
|--------|-------|--------|----------------|
| `fix/reschedule-qa-test-slip-contract` | 1 | +22 | ✅ APPROVE |
| `fix/late-fee-split-reschedule-collect-first` | 33 | +2,244 | ⚠️ REVIEW |
| `feat/ai-hardening-followups` | 30 | +672 | ✅ APPROVE |

### Action Items Before Merge

**`fix/late-fee-split-reschedule-collect-first`**:
1. (Optional but recommended) Change `amount: Number(link.amount)` to `amount: parseFloat(link.amount.toFixed(2))` in `paysolutions-confirmation.service.ts` to avoid implicit Decimal→float cast and stay consistent with project conventions.

No Critical blockers found across all three branches.
