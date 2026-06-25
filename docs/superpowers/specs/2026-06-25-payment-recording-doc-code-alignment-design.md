# Payment-Recording: Doc → Code Alignment (3 features)

**Date:** 2026-06-25
**Status:** Design — pending user spec review → implementation plan
**Owner decision:** Implement in code to match the spec CSV "ขั้นตอนการบันทึกรับชำระ (ฉบับสมบูรณ์)".
Owner explicitly confirmed this **reverses two recent same-day decisions** (D2 flat-bracket late
fee, D3 shop-collect drop). See Risks.

---

## 1. Motivation

A careful audit (2026-06-25) of the payment-recording spec CSV against the live code found **three
things the document specifies that the code does NOT implement**. All three live in the document's
*note/description* columns (the JE debit/credit lines themselves all match code):

| # | Document says | Code reality | Where in doc |
|---|---------------|--------------|--------------|
| 1 | `consecutive_missed` counter (`++` on partial/missed, reset on full) drives ECL stage | No schema field; only a dead `try/catch` reference in `reschedule.service.ts:120`. ECL = aging buckets only | Case 5 (note) — **not flagged by the doc's own appendix** |
| 2 | Shop-collect early payoff → `Dr 11-2107 ลูกหนี้-หน้าร้าน` instead of cash | `11-2107` exists nowhere in chart or code (chart ends at 11-2106); early payoff is FINANCE-direct only | Case 7 (note) + appendix D3 |
| 3 | Late fee = `min(วันเกิน × rate/วัน, เพดาน฿, 5% × ค่างวด)` (per-day + ceiling + 5% cap), config key `late_fee_per_day` | Flat bracket only (50/100), no per-day, no ceiling, no 5% cap; keys `late_fee_tier1/2_amount`, `late_fee_tier2_min_days` | Case 6 (note) + appendix D2 |

The owner chose to implement all three in code. The three are independent (different modules), so
this is **one spec → three implementation plans / PRs**.

---

## 2. Scope & Packaging

- **One design doc** (this file), **three implementation plans / PRs** — independent, separately
  reviewable and deployable.
- Sequencing recommendation: **#1 first** (no gate), then **#2** and **#3** (both behind a CPA
  sign-off gate before production merge — see Risks).

Out of scope: re-architecting the consolidated 2A+2B preview↔posting divergence found during the
audit (separate bug, tracked elsewhere); SHOP-side paired JE for #2 (FINANCE-side `11-2107` only).

---

## Section 1 — `consecutiveMissed` counter feeding ECL

### Goal
Track consecutive non-full-paid installments per contract and let it **escalate** (never
de-escalate) the ECL stage, supplementing the existing aging-bucket logic.

### Schema
```prisma
// Contract model
consecutiveMissed Int @default(0)
```
Migration: add column with default `0` (safe on populated table). Removes the dead-code branch in
`reschedule.service.ts:120-126` (the `try/catch (as any)` guard) — the field now exists.

### Counter lifecycle
- **Increment (`+1`)**:
  - Overdue lifecycle cron (`overdue-lifecycle-cron.service.ts`) — when an installment passes its
    due date still not PAID. Increment **once per installment that goes overdue** (idempotent: guard
    so a single overdue installment doesn't increment on every cron tick — key off a per-installment
    marker, e.g. only increment when the installment first transitions to OVERDUE).
  - `recordPayment` partial clear (`isPartialClear`) — keep counter (no reset; a partial is still
    not a full clear).
- **Reset (`0`)**:
  - `recordPayment` full clear (`isPaidInFull`) of an installment.
  - Advance-consume-on-accrual full clear (2A template path) when it flips a Payment to PAID.
  - `reschedule.service.ts` already intends to reset on reschedule — wire it for real.

### ECL supplement (max severity)
`bad-debt.service.ts` currently computes `getAgingBucket(daysOverdue)` →
`'1-30' | '31-60' | '61-90' | '91-180' | '180+'` (B1–B5). Add a **counter→bucket** map (config
`consecutive_missed_bucket_map`, defaults below) and take the **more severe** of (aging bucket,
counter bucket) when selecting the provision rate.

Default `consecutive_missed_bucket_map`:
| consecutiveMissed | min bucket |
|---|---|
| 0–1 | (none / aging only) |
| 2 | `31-60` (B2) |
| 3 | `61-90` (B3) |
| 4 | `91-180` (B4) |
| 5+ | `180+` (B5) |

Severity order = bucket order B1<B2<B3<B4<B5. Provision uses `max(agingBucket, counterBucket)`.
`reverseStageOnPayment` already recomputes max-aging on payment — extend it to also read the
(now-reset-or-lower) counter so a paid-up contract releases over-provision correctly.

### Files
- `apps/api/prisma/schema.prisma` + migration
- `apps/api/src/modules/accounting/bad-debt.service.ts` (counter→bucket, max severity, reverse)
- `apps/api/src/modules/overdue/services/overdue-lifecycle-cron.service.ts` (increment)
- `apps/api/src/modules/payments/services/payment-receipt-orchestrator.ts` (reset on full, keep on partial)
- `apps/api/src/modules/installments/reschedule.service.ts` (remove dead guard; real reset)
- `apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.ts` (reset on advance-consume full clear)

### Tests
- Counter increments once per overdue installment (no double-count on repeated cron ticks)
- Counter resets to 0 on full payment / reschedule
- `bad-debt` provision uses `max(aging, counter)` — counter escalates a low-aging contract; never
  lowers a high-aging one
- `reverseStageOnPayment` releases provision after counter reset

### Gate
None (new feature, reverses nothing).

---

## Section 2 — `11-2107` shop-collect early payoff

### Goal
Allow an early payoff to be **collected at the SHOP branch**: FINANCE books `Dr 11-2107 ลูกหนี้-หน้าร้าน`
(a receivable from the shop) instead of `Dr cash`, then clears it when the shop remits to FINANCE.

### Key simplification
`EarlyPayoffJP4Template` already does `Dr depositAccountCode` for the settlement amount (it debits
whatever account code it's handed). So the payoff JE needs **no template change** — shop-collect
just passes `depositAccountCode = '11-2107'`.

### Chart
Add to `finance-coa.csv` + `seed-coa-finance.ts`:
```
11-2107, ลูกหนี้-หน้าร้าน, สินทรัพย์, Dr, ลูกหนี้, ...
```
(Reverses the archived D3 drop — tag `d3-shop-payoff-archived`.)

### Flow
1. `EarlyPayoffOverlay.tsx`: add a "เก็บที่หน้าร้าน" toggle (`collectedByShop`). Default off =
   FINANCE-direct (unchanged behaviour). Owner-confirmed default since the doc only specifies the
   accounting, not the trigger; toggle = least-assumption, reversible.
2. Early-payoff service (`contracts/contract-payment.service.ts` → `compute-early-payoff-je.ts`):
   when `collectedByShop`, set `depositAccountCode = '11-2107'`.
3. **Guard**: the payoff path validates `depositAccountCode` against `CASH_ACCOUNT_CODES`. Allow
   `11-2107` **only** on the shop-collect payoff path (not on ordinary receipts).
4. **Clearing step**: new settlement endpoint — when the shop remits the collected amount to
   FINANCE, post `Dr cash / Cr 11-2107` (mirrors the existing `vendor-clearance` pattern). Button on
   the contract / a shop-settlement view; OWNER / FINANCE_MANAGER / ACCOUNTANT.

### Files
- `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv`
- `apps/api/prisma/seed-coa-finance.ts`
- `apps/api/src/modules/contracts/contract-payment.service.ts` + `apps/api/src/modules/journal/compute-early-payoff-je.ts` (pass `11-2107` when shop-collect) + deposit-account guard
- New shop-collect settlement endpoint + JE template (mirror `vendor-clearance.template.ts`)
- `apps/web/src/components/contract/ContractEarlyPayoff.tsx` (EarlyPayoffOverlay toggle)
- Contract / settlement UI for the clearing action

### Tests
- Payoff with `collectedByShop=true` debits `11-2107`, balances, no cash line
- Guard rejects `11-2107` on ordinary receipt path
- Clearing JE `Dr cash / Cr 11-2107` zeroes the `11-2107` balance for that contract
- TB(FINANCE) balances before and after clearing

### Gate
CPA sign-off (inter-company receivable reintroduction). Merge held until approved.

---

## Section 3 — Per-day late fee + 5% cap (⚠️ CPA gate)

### Goal
Replace the flat-bracket late fee with the document's per-day model, **config-switchable** back to
bracket because this reverses a same-day owner decision.

### Formula (D2, exact)
```
lateFee = min( daysOverdue × ratePerDay,
               maxAmount,                       // absolute ฿ ceiling
               capPct/100 × installmentGross )  // 5% of ค่างวด (incl VAT)
```
- `installmentGross` = the monthly installment incl VAT (the "ค่างวด" the customer sees, e.g.
  1,515.83). **Decision to confirm in review:** 5% base = gross installment (incl VAT).
- Worked example: `5% × 1,515.83 = 75.79฿`. The cap therefore makes the document's Case-6 `100฿`
  illustration **impossible** under this formula (100฿ is the old bracket value). The spec's correct
  figure is **75.79฿** (when days × rate and maxAmount both exceed it). This will be called out in
  the doc update.

### Config keys
| Key | Default | Meaning |
|---|---|---|
| `late_fee_mode` | `PER_DAY` | `PER_DAY` \| `BRACKET` — keep bracket reachable for instant rollback |
| `late_fee_per_day_rate` | (owner to set) | ฿ per overdue day |
| `late_fee_max_amount` | (owner to set) | absolute ฿ ceiling |
| `late_fee_cap_pct` | `5` | % of installment gross |

Existing bracket keys (`late_fee_tier1_amount`, `late_fee_tier2_amount`, `late_fee_tier2_min_days`)
retained for `BRACKET` mode.

### Implementation
- `late-fee.util.ts`: add `computePerDayLateFee(input)`; a `resolveLateFee(mode, …)` dispatcher
  picks per-day vs bracket. Single source of truth.
- **Sync all 4 call sites** (must resolve identically so quote == charge):
  1. `payment-receipt-orchestrator.ts` (recordPayment)
  2. `overdue/services/overdue-lifecycle-cron.service.ts` — **includes raw SQL**; the per-day calc
     must be reproduced in SQL or the cron must call the util per row
  3. `chatbot-finance/services/finance-tools.service.ts` (LIFF customer quote)
  4. `chatbot-finance/services/auto-trigger.service.ts`

### Files
- `apps/api/src/utils/late-fee.util.ts` (+ spec)
- the 4 call sites above
- SystemConfig seed/defaults for the new keys

### Tests
- `computePerDayLateFee` honours all three caps (the binding cap wins)
- `late_fee_mode=BRACKET` reproduces today's behaviour exactly (rollback safety)
- All 4 call sites return identical late fee for the same input (quote == charge)
- Golden: 75.79฿ for the canonical contract once the 5% cap binds

### Gate
CPA sign-off on the 5% cap reintroduction. Merge held until approved. `late_fee_mode` lets prod
stay on `BRACKET` until sign-off even after the code merges.

---

## Cross-cutting

- **Docs/memory updates:** `.claude/rules/accounting.md` (late fee → per-day; 11-2107 reinstated),
  memory `project_cpa_csv_spec_code_gaps.md` (D2/D3 reversed).
- **Spec CSV:** re-export UTF-8-with-BOM (current file is mojibake); update the now-stale appendix
  (D1 already auto-routes; D2/D3 now implemented); fix Case-6 figure to 75.79฿.
- **No security/guard regressions:** keep `@UseGuards` + `@Roles` on every new endpoint; new
  settlement endpoint OWNER/FM/ACC.

## Risks

1. **#3 reverses an owner decision from today** (flat bracket, owner-signed) and the 5% cap is
   CPA-pending. `late_fee_mode` default `PER_DAY` in code but prod can run `BRACKET` until CPA signs.
2. **#2 reintroduces an inter-company receivable** (11-2107) that was deliberately dropped (D3).
   Needs the clearing flow or `11-2107` accumulates unreconciled. CPA sign-off before prod.
3. **#3 raw-SQL drift**: the overdue cron's SQL must match the util exactly, or quote ≠ charge —
   the precise failure the bracket model was meant to prevent. Anti-drift test required.
4. **#1 double-count**: cron increment must be idempotent per installment, not per tick.

## Decisions made by default (reviewer may veto)

- #1 increment on first OVERDUE transition (not per tick); reset on any full installment clear.
- #1 counter→bucket map defaults (table above).
- #2 trigger = toggle in EarlyPayoffOverlay (doc is silent on trigger).
- #2 clearing = manual settlement endpoint mirroring vendor-clearance.
- #3 5% base = gross installment incl VAT.
- #3 keep `BRACKET` mode reachable via `late_fee_mode`.
