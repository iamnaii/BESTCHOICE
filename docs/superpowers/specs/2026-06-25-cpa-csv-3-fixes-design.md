# CPA CSV ↔ Code: 3 Late-Fee / Overpay / Shop-Payoff Fixes

- **Date:** 2026-06-25
- **Status:** Approved (owner sign-off 2026-06-25), scrutinized
- **Author:** Claude + owner (พี่นาย)
- **Branch:** `fix/cpa-csv-3-fixes`

## Context

The owner maintains a CPA golden-reference CSV documenting payment-recording journal entries
(`ขั้นตอนการบันทึก รับชำระ (ฉบับสมบูรณ์ UTF-8).csv`, on Desktop; recovered + verified
2026-06-25). Cross-checking the 2B (payment-receipt) scenarios against the code found that
1A/2A and most 2B cases match the templates + golden fixtures exactly, but **three points where
the CSV spec and the implementation diverge**. The owner directed: make the code match the CSV.

A `/scrutinize` pass on the first-draft design surfaced integrity gaps that reshaped all three
fixes (typo guardrail, phantom receivable, late-fee path inconsistency). The decisions below are
post-scrutiny and owner-approved.

## Decisions locked (owner, 2026-06-25)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Overpay >1฿ | Auto-route to advance (21-1103) **with a ceiling**; over the ceiling still requires explicit `OVERPAY_ADVANCE` confirmation (typo guard) |
| D2a | Late-fee model | Flat brackets: 0 / 50฿ (1–2 days) / 100฿ (≥3 days). **No per-day accumulation.** |
| D2b | 5% legal cap | **Removed** per owner decision. Late fee = flat bracket only. Reversible via config; CPA to review. |
| D2c | Existing fees | Brackets apply **retroactively** — cron downgrades open overdue fees to ≤100; both paths consistent. |
| D3a | Account 11-2107 | Add `ลูกหนี้-หน้าร้าน` to FINANCE chart. |
| D3b | Shop-collect early payoff | Add `collectedByShop` flag + checkbox → Dr 11-2107 instead of cash. |
| D3c | Clearing | Add a "หน้าร้านนำส่งเงินปิดยอด" settlement action → Dr cash / Cr 11-2107 (no phantom receivable). |

---

## D1 — Auto-route overpayment >1฿ to advance (21-1103), bounded

### Current behavior (verified)
`PaymentReceiptOrchestrator.recordPayment` ([payment-receipt-orchestrator.ts:219-232](../../../apps/api/src/modules/payments/services/payment-receipt-orchestrator.ts)):
when `overage > 1฿` it throws unless the caller passes `paymentCase='OVERPAY_ADVANCE'`, in which
case it sets `advanceCredit = overage`, increments `Contract.advanceBalance`, and the template
emits `Cr 21-1103`. The 2A accrual template already **auto-consumes** the advance on the next
installment's due date (`Dr 21-1103 / Cr 11-2103` for `min(advanceBalance, installmentTotal)`,
serializable + idempotent — [installment-accrual-2a.template.ts:202-259](../../../apps/api/src/modules/journal/cpa-templates/installment-accrual-2a.template.ts)). **No accrual changes needed.**

### Change
In `recordPayment`, when `overage > 1฿`:
- Compute ceiling = `overpayAutoMaxMultiplier × installmentTotal` (SystemConfig
  `overpay_advance_auto_max_multiplier`, default **2**).
- If `overage ≤ ceiling`: auto-set `advanceCredit = overage` (no `paymentCase` required) and write
  an INFO log + the existing `OVERPAY_ADVANCE_RECORDED` audit entry.
- If `overage > ceiling`: keep throwing (fat-finger guard) unless `paymentCase='OVERPAY_ADVANCE'`
  is explicitly passed (UI can still force large legitimate prepayments).

Everything downstream (`Cr 21-1103`, `Contract.advanceBalance`, 2A auto-consume) is unchanged.

### Tests
- `payments.service.advance.spec.ts`: (a) overage ≤ ceiling, no case → auto-parks as advance;
  (b) overage > ceiling, no case → throws; (c) overage > ceiling + explicit case → parks.
- Confirm existing `OVERPAY_ADVANCE` explicit path still passes.

### Edge cases / notes
- Pre-existing "advance consumed on accrual with no Payment row" alert
  (2A:286-298) becomes hotter as more overpays park; the ceiling limits exposure. Not fixed here.
- Webhook (PaySolutions, exact-QR) rarely overpays; this primarily affects cashier entry.

---

## D2 — Late fee → flat brackets 50/100, no cap, retroactive

### Current behavior (verified)
Three separate implementations compute the late fee, all currently
`round2(min(feePerDay × days, flatCap, amountDue × 5%))`:
1. `computeCappedLateFee` util ([late-fee.util.ts](../../../apps/api/src/utils/late-fee.util.ts)) — used by the LIFF chatbot ×2.
2. **Inline copy** at [payment-receipt-orchestrator.ts:204](../../../apps/api/src/modules/payments/services/payment-receipt-orchestrator.ts) (does NOT call the util) — recordPayment, **never downgrades** (`if calculatedFee.gt(lateFee)`).
3. Raw SQL `LEAST(...)` in [overdue-lifecycle-cron.service.ts:59-76](../../../apps/api/src/modules/overdue/services/overdue-lifecycle-cron.service.ts) — **downgrades** (unconditional `SET`).

The util exists specifically because the chatbot used to over-quote (3,000 vs 100 charged).

### Change
**New single function** `computeBracketLateFee({ daysOverdue, tier1Amount, tier2Amount, tier2MinDays })`
in `late-fee.util.ts`, returning:
- `daysOverdue ≤ 0` → 0
- `1 ≤ daysOverdue < tier2MinDays` → `tier1Amount`
- `daysOverdue ≥ tier2MinDays` → `tier2Amount`

(`computeCappedLateFee` is replaced; the 5% `capPct` / `flatCap` / per-day inputs are removed.)

**SystemConfig keys** (new): `late_fee_tier1_amount`=50, `late_fee_tier2_amount`=100,
`late_fee_tier2_min_days`=3. **Deprecate**: `late_fee_per_day`, `late_fee_cap`, and remove
`BUSINESS_RULES.LATE_FEE_CAP_PCT` usage. Add a `BUSINESS_RULES` default block for the new keys.

**Update all three paths to the one function:**
1. Orchestrator: delete the inline `min(...)`, call `computeBracketLateFee`, and **set
   `lateFee = bracket`** (not `max(stored, bracket)`) so it agrees with the cron's retroactive
   downgrade. Keep the `lateFeeWaived` guard.
2. Cron SQL: replace `LEAST(...)` with
   `CASE WHEN days >= ${tier2MinDays} THEN ${tier2} WHEN days >= 1 THEN ${tier1} ELSE 0 END`
   (parameterized). Still unconditional `SET` (downgrades old fees on next tick = retroactive).
3. `finance-tools.service.ts` ×2: call `computeBracketLateFee`; **rewrite the explanation string**
   to "ค่าปรับล่าช้า 1–2 วัน 50฿, ตั้งแต่ 3 วัน 100฿ (เหมาจ่าย)".

**Accounting unchanged:** late fee still posts `Cr 42-1103`.

**Governance:** comment at the bracket function + this doc record that the 5% Thai-law cap was
removed by owner decision 2026-06-25; brackets are config-driven (reversible); recommend CPA sign-off
before production rollout. Behavioral note: max late fee per installment is now 100฿ (flat, does not
grow), materially more lenient than the old linear model.

### Tests
- Rewrite `late-fee.util.spec.ts`: boundaries 0d→0, 1d→50, 2d→50, 3d→100, 100d→100.
- `payments.service.late-fee.spec.ts`: retroactive — stored 200฿ → recordPayment recomputes to ≤100.
- `overdue.late-fee-escalation.spec.ts` + `e2e/overdue-late-fee.e2e-spec.ts`: SQL CASE brackets,
  including the cron downgrading an existing higher fee.
- `finance-tools.service.spec.ts`: bot quote == charged amount (no regression of the over-quote bug).

### Migration / rollout
- One-time: on first cron run post-deploy, open overdue fees >100฿ drop to ≤100฿ (intended,
  retroactive). Announce internally before deploy. No data migration script needed (cron self-heals).

---

## D3 — Account 11-2107 + shop-collect early payoff + settlement

### Current behavior (verified)
Early-payoff debit is caller-supplied via `depositAccountCode` (default `11-1101`) —
[contract-payment.service.ts](../../../apps/api/src/modules/contracts/contract-payment.service.ts) `getEarlyPayoffQuote` / `earlyPayoff`. The template
(`computeEarlyPayoffJE` / `EarlyPayoffJP4Template`) is account-generic. Account `11-2107` does not
exist; chart is CSV-driven and seeded non-destructively
([seed-coa-finance.ts:5-8](../../../apps/api/prisma/seed-coa-finance.ts), upsert from
`__tests__/fixtures/cpa-cases/finance-coa.csv`). No "shop collects" concept exists anywhere.

### Change
**(a) Add account.** Insert into `finance-coa.csv` after `11-2106` (before the `11-31XX` group),
matching the existing 9-column format `[code,name,type,normalBalance,category,vatApplicable,notes,status,peakCode]`:
`11-2107,ลูกหนี้-หน้าร้าน,สินทรัพย์,Dr,ลูกหนี้,ไม่,หน้าร้านรับชำระปิดยอดแทน FINANCE (รอนำส่ง),ใช้งาน,`
(peakCode left empty — owner fills via UI). No migration; production runs `npm run seed:coa`
(non-destructive upsert). vatApplicable = ไม่ (inter-company receivable).

**(b) Shop-collect routing.** Add `collectedByShop?: boolean` to `EarlyPayoffDto`. In
`contract-payment.service.earlyPayoff` + `getEarlyPayoffQuote`:
`depositAccountCode = dto.collectedByShop ? '11-2107' : (dto.depositAccountCode ?? '11-1101')`.
No change to `computeEarlyPayoffJE` / template. Frontend early-payoff dialog: checkbox
"หน้าร้านรับเงินแทน (Dr 11-2107)".

**(c) Settlement / clearing.** New action so 11-2107 can return to zero when the shop remits cash
to FINANCE: `ShopPayoffRemittanceTemplate` posting `Dr <cash 11-11xx/11-12xx> / Cr 11-2107` for the
remitted amount, idempotent via `metadata.flow='shop-payoff-remittance'`. Endpoint
`POST /contracts/:id/shop-payoff-remittance { amount, depositAccountCode }` (Roles: OWNER,
FINANCE_MANAGER, ACCOUNTANT), referencing the contract for traceability. Small UI action on the
contract / payoff view. FINANCE-side only; the SHOP-side double entry (S-account payable to FINANCE)
stays deferred, consistent with the deferred shop-JE wiring.

### Tests
- `seed-coa-finance.spec.ts`: 11-2107 loads + creates.
- `contract-payment.service.early-payoff-exec.spec.ts`: `collectedByShop=true` → Dr 11-2107.
- New `ShopPayoffRemittanceTemplate` spec: Dr cash / Cr 11-2107 balanced + idempotent.

---

## Cross-cutting

- **Approach:** TDD (red → green → refactor) per fix. Golden fixtures in
  `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/` are authoritative — update the late-fee
  expectations there if any fixture pins a fee amount.
- **Order:** D2 (most call sites, highest risk) → D1 (small, bounded) → D3 (additive).
- **Verify:** `./tools/check-types.sh all` + affected jest suites + the overdue e2e, before commit.
- **Reviewer:** `code-reviewer` agent before merge.

## Out of scope / deferred

- SHOP-side double entry for 11-2107 (S-account payable to FINANCE) — deferred with the broader
  shop-JE wiring.
- Reinstating any legal late-fee cap — explicitly removed; revisit only on CPA advice.
- `autoAllocatePayment` (21-5101 credit) path — unchanged; D1 covers only `recordPayment`.

## Risks

- **R1 (legal):** removing the 5% cap on late fees is outward-facing to customers. Mitigated by
  config-reversibility + CPA review recommendation; amounts are small (≤100฿/installment).
- **R2 (retroactive):** the first post-deploy cron tick mass-adjusts open overdue fees downward.
  Intended; announce internally.
- **R3 (three late-fee paths):** missing one reintroduces the chatbot over-quote bug. Mitigated by
  consolidating to one function + the chatbot-matches-charge test.
