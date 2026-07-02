# Pre-Merge Guard Report — 2026-07-02

**Agent:** Pre-Merge Guard (automated)
**Scope:** Top 3 branches by recency (of 392 total unmerged branches)

---

## Summary

| Branch | Files | ±Lines | Verdict |
|--------|-------|--------|---------|
| `fix/late-fee-split-reschedule-collect-first` | 33 | +2244 / -273 | **REVIEW** |
| `feat/ai-hardening-followups` | 30 | +672 / -111 | **APPROVE** |
| `fix/inbox-eslint-no-unused-expressions` | 3 | +6 / -3 | **APPROVE** |

---

## Branch 1: `fix/late-fee-split-reschedule-collect-first`

- **Author:** iamnaii <akenarin.ak@gmail.com>
- **Updated:** 2026-07-02
- **Commits:** 1 (large atomic commit)
- **Verdict:** ⚠️ REVIEW (2 warnings — no blockers)

### What It Does

Implements the "collect-first" reschedule directive: **เงินไม่เข้า ดิวไม่เลื่อน** (money must clear before due dates shift). Replaces the old fire-and-forget `RESCHEDULE` branch in the payments controller with a new `RescheduleCollectService` that runs everything in a single Serializable transaction: collect JE → reset lateFee → shift due dates → audit log. Also adds a QR path where the webhook triggers the reschedule atomically on payment confirmation.

### Key New Files

| File | Lines | Purpose |
|------|-------|---------|
| `reschedule-collect.service.ts` | 424 | Core collect-first logic |
| `reschedule-collect.service.spec.ts` | 304 | Test coverage |
| `paysolutions-intent.service.ts` | 808 (+184) | QR creation for reschedule |
| `RescheduleOverlay.tsx` | 546 (+362 net) | Frontend overlay UI |
| `reschedule-qr.flex.ts` | new | LINE Flex message for QR |
| `reschedule-quote.util.ts` | 54 | Pure quote computation util |

### Issues Found

#### ⚠️ Warning W1 — Missing `deletedAt: null` on `installmentSchedule.findUnique`

**File:** `apps/api/src/modules/payments/services/reschedule-collect.service.ts`

```ts
const instSched = await tx.installmentSchedule.findUnique({
  where: {
    contractId_installmentNo: {
      contractId: input.contractId,
      installmentNo: input.installmentNo,
    },
  },
  select: { id: true },
});
```

`InstallmentSchedule` has `deletedAt DateTime?`. This query does not filter it out and does not check `instSched?.deletedAt` after the call. If a soft-deleted schedule exists for the same `(contractId, installmentNo)` unique key (unlikely given the unique constraint, but possible after schema migrations or admin operations), the query would return the deleted row and proceed.

**Fix:** Add `deletedAt: null` to where clause, or add `if (!instSched || instSched.deletedAt) throw new NotFoundException(...)` guard.

---

#### ⚠️ Warning W2 — `@IsNumber()` and `@IsString()` decorators without Thai error messages

**File:** `apps/api/src/modules/payments/payments.controller.ts`

```ts
class CreateRescheduleQrDto {
  @IsNumber()       // ← no message
  @Min(1, { message: 'จำนวนวันต้องมากกว่า 0' })
  daysToShift!: number;

  @IsString()       // ← no message
  @IsIn(['SINGLE', 'SPLIT'], { message: 'splitMode ต้องเป็น SINGLE หรือ SPLIT' })
  splitMode!: 'SINGLE' | 'SPLIT';
}
```

The existing `CreatePartialQrDto` above has the same pattern (`@IsNumber()` without message). This is an existing pattern but inconsistent with the Thai-message rule. The `@Min` and `@IsIn` have messages; the base type validators do not.

**Fix:** `@IsNumber({}, { message: 'จำนวนวันต้องเป็นตัวเลข' })` and `@IsString({ message: 'splitMode ต้องเป็น string' })`.

---

#### ℹ️ Info I1 — `Number(link.amount)` in confirmation webhook (acceptable)

**File:** `apps/api/src/modules/paysolutions/services/paysolutions-confirmation.service.ts` (line ~227)

```ts
amount: Number(link.amount),   // link.amount = Prisma Decimal
```

`Number()` is used here to pass the Decimal DB value into `RescheduleCollectInput.amount: number`. The `amount` field is used **only for cross-validation** against the server-side quote (±0.01 tolerance) — it is never written back to the DB as-is. The actual DB writes use `Prisma.Decimal` from the recomputed quote. This is acceptable but worth noting.

---

#### ℹ️ Info I2 — Large files

- `RescheduleOverlay.tsx`: **546 lines** (threshold: 500). Contains the full UI flow for both cash and QR paths. Consider extracting the QR confirmation panel into a child component.
- `paysolutions-intent.service.ts`: **808 lines** total (existing file grown by +184 with the `createRescheduleQR` method). This file now owns 3 different QR-creation flavors (early payoff, partial, reschedule). Consider splitting.

---

### What Looks Good

- ✅ All new controller endpoints (`GET /payments/reschedule-quote`, `POST /payments/:id/reschedule-qr`) have `@Roles(...)` with the full allowed role set.
- ✅ The existing `@UseGuards(JwtAuthGuard, RolesGuard)` at class level covers new methods.
- ✅ Decimal arithmetic is correct throughout `RescheduleCollectService` — all money stored via `Prisma.Decimal`, no raw float writes to DB.
- ✅ React Query patterns are correct: `useQuery` / `useMutation`, `api.get()` / `api.post()`, full `invalidateAll()` after mutation.
- ✅ The "collect-first" business logic is architecturally correct: webhook + direct-cash paths both route through the same `executeWithCollect` with the frozen quote pattern.
- ✅ Good test coverage: 304-line spec file + `reschedule-quote.util.spec.ts` (104 lines).
- ✅ Sentry capture on QR-expired-but-paid (`paysolutions-confirmation.service.ts`) is a good ops safety net.

---

## Branch 2: `feat/ai-hardening-followups`

- **Author:** iamnaii <akenarin.ak@gmail.com>
- **Updated:** 2026-07-02
- **Commits:** 7
- **Verdict:** ✅ APPROVE

### What It Does

Follow-up hardening for the AI module: adds `AiUsageService.record()` calls to OCR, CreditCheck-AI, SalesBot, EmbeddingBackfill, and ai-auto-reply services so every Claude/Vertex API call is tracked for cost visibility. Also fixes a model-prefix matching bug (longer keys now win over shorter prefixes, preventing `gemini-2.5-flash` from shadow-matching `gemini-2.5-flash-lite`). Improves embedding backfill cron with poison-row detection and per-row fallback.

### Issues Found

None.

### What Looks Good

- ✅ No new controllers, guards, or DB writes — pure service/cron hardening.
- ✅ Correct `toolFailed` flag distinguishes DB errors from provider errors in SalesBot AiUsage records.
- ✅ `EMBED_FAILED_MARKER` pattern in backfill cron prevents infinite retry loops on poison rows without permanently losing non-poisoned rows from the same batch (fallback to one-at-a-time).
- ✅ `if (failures.length === rows.length)` guard correctly distinguishes a systemic outage from isolated poison rows and avoids stamping `EMBED_FAILED` on temporarily-down rows.
- ✅ `as any` usage is confined to test files only.
- ✅ Good test coverage added: `embedding-backfill.cron.spec.ts` (123 lines), `sales-bot.service.spec.ts` (+65 lines), ai-auto-reply spec (+38 lines).

---

## Branch 3: `fix/inbox-eslint-no-unused-expressions`

- **Author:** iamnaii <akenarin.ak@gmail.com>
- **Updated:** 2026-06-30
- **Commits:** 1
- **Verdict:** ✅ APPROVE

### What It Does

Converts 3 ternary expressions with side-effects (Set mutations, toast calls) into explicit `if/else` blocks to satisfy the `no-unused-expressions` ESLint rule. Pure mechanical fix, no logic change.

### Issues Found

None.

---

## Recommendations

### `fix/late-fee-split-reschedule-collect-first` — REVIEW before merge

Fix W1 (soft-delete guard on `installmentSchedule.findUnique`) before merge. W2 (missing Thai messages on base-type validators) is low priority but easy to fix in the same pass.

### `feat/ai-hardening-followups` — Ready to merge

No issues. Solid AI usage tracking rollout.

### `fix/inbox-eslint-no-unused-expressions` — Ready to merge

Trivially safe ESLint compliance fix.
