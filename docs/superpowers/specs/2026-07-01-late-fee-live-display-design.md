# Late-fee live display — design (2026-07-01)

## Problem

Editing late-fee settings (`/settings` → finance → `LateFeeSettingsCard`) has **no
visible effect** on the ค่าปรับ shown in the payment-recording modal
(`RecordPaymentWizard`) for an already-overdue installment. Owner report:
"ปรับเงื่อนไขแล้ว ผลลัพท์เหมือนเดิม" — the fee stayed at **183.55** (= 5% × ค่างวด
3,671.00, the PER_DAY `cap_pct` branch) no matter what was changed.

## Root cause (verified on origin/main = the running code)

`payment.lateFee` is a **stored stamp**, written at seed time and by the nightly
overdue cron. The payment-queue read path
`PaymentQueryService.getPendingPayments` returns this stored value **verbatim**
(`prisma.payment.findMany`), and `RecordPaymentWizard` displays it directly
(`new Decimal(payment.lateFee)`). It is **never recomputed from current
SystemConfig on read**.

The fee only refreshes when:
- (a) the payment is **recorded** — `PaymentReceiptOrchestrator` recomputes from
  live config via `resolveLateFee` and re-stamps
  (`payment-receipt-orchestrator.ts` ~lines 236-251), or
- (b) the **nightly overdue cron** re-stamps.

So a config change is invisible in the modal until (a) or (b) happens.

The settings card itself is **correct** — `LateFeeSettingsCard` writes every key
the engine reads (`late_fee_mode`, `late_fee_per_day_rate`,
`late_fee_max_amount`, `late_fee_cap_pct`, `late_fee_tier1_amount`,
`late_fee_tier2_amount`, `late_fee_tier2_min_days`). There is **no key-mapping
bug**. (An earlier "key mismatch" theory was an artifact of analysing a local
checkout that was 6 commits behind `origin/main`; local has since been
fast-forwarded to `origin/main` = `aba09369`.)

## Goal

The ค่าปรับ shown for **unpaid** installments reflects the current late-fee
config immediately (on modal open / queue load), matching what will actually be
charged at record time.

## Scope decisions (owner-approved)

- **Late-fee model:** keep BOTH modes (PER_DAY / BRACKET). No engine/cron change.
- **Fix layer:** display only — recompute-on-read.
- **KPI consistency:** recompute the pending KPI summary too, so the "ค่าปรับ
  ค้างเก็บ" card does not contradict the live per-row values.
- Chosen over the heavier alternative (re-stamp all overdue installments on
  settings-save) to keep the change low-risk and off the money-path.

## Design

### 1. New shared helper — `resolveLivePaymentLateFee`

A single pure function mapping one payment + config → its live late fee. Mirrors
the orchestrator's record-time logic so display == charge.

- **Input:** `payment: { dueDate: Date; amountDue: Decimal|number; lateFeeWaived: boolean; }`,
  `cfg: LateFeeConfig`, `asOf: Date`.
- **Rules:**
  - `lateFeeWaived === true` → `0`
  - `dueDate >= asOf` (not past due, day-granular) → `0`
  - else → `resolveLateFee(cfg, daysOverdue, amountDue)` where
    `daysOverdue = max(0, floor((asOf − dueDate) / 1 day))`
- **Location:** `apps/api/src/utils/late-fee.util.ts`, beside `resolveLateFee`
  (single source of truth, unit-testable, no Prisma dependency).

Rationale for the gross base = `amountDue`: matches the orchestrator
(`resolveLateFee(cfg, daysOverdue, payment.amountDue)`) and the seed. `amountDue`
excludes late fee by schema, so it is the installment principal+interest+VAT —
the correct 5%-cap base.

### 2. `getPendingPayments` — the fix target

After `findMany`, load config once (`loadLateFeeConfig(this.prisma)`), then map
`data`, overriding each row's `lateFee = resolveLivePaymentLateFee(row, cfg, now)`.
Page-limited (`take` ≤ 100) → negligible cost, config loaded once.

### 3. `getPendingSummary` — KPI consistency

`outstandingLateFee` currently sums stored `_sum.lateFee` for the PENDING bucket
(whole-system). Replace with: select the minimal fields
(`dueDate, amountDue, lateFeeWaived`) for the **same PENDING-bucket where-clause**,
load config once, and sum `resolveLivePaymentLateFee` per row.

Trade-off: converts a DB aggregate into a row-scan over the pending bucket
(whole-system, not page-limited). Acceptable at shop volume; flagged for
revisit if the bucket grows large (thousands+). The other summary figures
(`outstandingPrincipal`, `waivedLateFee`, `overdue60Count`, `collected*`) are
unchanged.

### 4. Explicitly unchanged

- `getDailySummary.totalLateFees` — sums lateFee for **PAID** installments =
  the *actual charged* fee finalized at record time, not an estimate. **Keep
  stored. No recompute.**
- `PaymentReceiptOrchestrator`, overdue cron, `resolveLateFee`/`compute*` engine,
  `LateFeeSettingsCard`, `RecordPaymentWizard`, `/payments/preview-journal`.
  The wizard + preview inherit the live value via the list; the orchestrator
  already recomputes at record.
- Stored `payment.lateFee` column — untouched by this change; still refreshed by
  cron/record.

## Data flow (after fix)

```
owner saves config (LateFeeSettingsCard → SystemConfig)
  → getPendingPayments recomputes lateFee live on next queue load
    → RecordPaymentWizard pre-fills the live lateFee
      → /payments/preview-journal uses it (BALANCED)
        → record: orchestrator recomputes from config (same value) + re-stamps DB
```

## Edge cases

- **Backdated `paidDate` at record:** orchestrator computes days from the
  backdated date → may differ from the modal's today-based estimate.
  Pre-existing; record is authoritative. Not a regression.
- **PARTIALLY_PAID:** recompute applies (matches the orchestrator, which
  recomputes for partial installments too).
- **Not-overdue / waived rows:** helper returns `0` → no spurious fee shown.
- **PER_DAY cap binds:** changing `per_day_rate` while `cap_pct` binds shows no
  change — correct behaviour (the cap dominates). The settings card's own
  `estimateLateFee` preview already surfaces this in-page.
- **Read-path lag elsewhere:** collections page + LIFF still read stored
  `payment.lateFee` until cron/record. Converges within a day. Out of scope to
  change now (documented, not silently ignored).

## Testing

- **Unit (`late-fee.util.spec.ts`):** `resolveLivePaymentLateFee` — waived→0,
  not-due→0, PER_DAY with cap binding, BRACKET tier1/tier2, day-count boundary
  (dueDate == asOf → 0; dueDate == asOf−1 → 1 day).
- **Service (DB) `getPendingPayments`:** overdue row returns live lateFee that
  tracks config; waived row → 0; not-due row → 0.
- **Service (DB) `getPendingSummary`:** `outstandingLateFee` reflects live config
  (change cap_pct → total changes).
- **Regression:** `getDailySummary.totalLateFees` unchanged (stored, PAID).
- **CI note:** the "Test API" gate is currently red on an unrelated payments
  spec, and API DB specs are flaky under parallel runs (project memory) → verify
  new specs with `--runInBand` / single-suite before trusting the batch.

## Out of scope

- Removing BRACKET / making PER_DAY the only model.
- Re-stamp-on-save (the "B2" single-source-of-truth alternative).
- Live display on the collections page and LIFF customer history.
- VAT on late fee (none today; unchanged).
