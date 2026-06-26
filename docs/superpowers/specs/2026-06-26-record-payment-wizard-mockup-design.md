# RecordPaymentWizard — Mockup Alignment (Phases 1–3)

**Date:** 2026-06-26
**Status:** Draft for owner review
**Scope:** `รับชำระค่างวด` modal + its preview/save backend. Match the new 2-column mockup (left form, right live 2-block balanced JE). Phases 1–3 in this PR; Phase 4 (document state machine + reversal) deferred to a separate PR.

---

## 0. Decisions locked (owner/CPA gates)

| Gate | Decision | Consequence |
|---|---|---|
| **D1** | **Gross waiver** — CPA signed off | Cr 42-1103 full + Dr 52-1105 waived portion (Phase 2) |
| **D2** | **Phase 1–3 now, defer Phase 4** | No `Payment` posting-state machine / reversal this PR |
| **D3** | Card = channel; money → selectable **bank account** (11-120x) | No new GL account; needs a `PaymentMethod` enum decision (§5, Open Q1) |
| **D4** | Backdated `paidDate` **allowed if period open** | Period-lock blocks closed periods; `paidDate` honored end-to-end (§3.D4) |

## 1. Goal

Reproduce the mockup: a 2-column modal whose **right panel is a live, balanced journal preview split into two blocks** — **2A (ถึงกำหนดงวด / accrual)** and **2B (รับเงิน + อนุโลม / receipt)** — that exactly mirrors what the save posts. The golden case:

```
ค่างวด 1,515.83 + ค่าปรับเต็ม 50 − อนุโลม 25 − หักเครดิตงวดก่อน 84.17 = เงินสดรับจริง 1,456.66
2A balanced = 2,115.00   2B balanced = 1,565.83
```

## 2. Code-grounded facts (verified against real code)

- **2A template already emits the mockup's 7 lines** (`installment-accrual-2a.template.ts:148-191`): Dr 11-2103 1,515.83 / Dr 21-2102 99.17 / Dr 11-2106 500.00 / Cr 11-2101 1,416.66 / Cr 11-2105 99.17 / Cr 41-1101 500.00 / Cr 21-2101 99.17 = **2,115.00**. It also posts a **second** advance-consume JE (Dr 21-1103 / Cr 11-2103) when `advanceBalance>0` at accrual (`:220-259`).
- **2B path** = `PaymentReceiptTemplate.execute` (`payment-receipt.template.ts`) using pure `splitReceipt` (`split-receipt.ts`). Emits Dr cash / Dr 21-1103 consume / Dr 52-1104 underpay-close / Cr 11-2103 / Cr 42-1103 / Cr 53-1503 overpay / Cr 21-1103 credit. **No 52-1105 today.**
- **Preview** (`payment-journal-preview.service.ts`) is a **separate hand-written reimplementation** — it does NOT call `splitReceipt` / `reconstructPrior`, and assumes a full clear (`:267`). Lines carry no `block` field; `accrualMode ∈ {2B_ONLY, CONSOLIDATED_PAYING_AHEAD, CONSOLIDATED_BACKFILL}`.
- **Orchestrator** (`payment-receipt-orchestrator.ts`) computes `remaining` with **gross** late fee (`:209-211`), recomputes late fee from `Date.now()` (`:200`), stamps `paidDate=new Date()` (`:278`), and calls `validatePeriodOpen(prisma, new Date(), …)` (`:112`).
- **`Payment.status`** = PENDING/PAID/PARTIALLY_PAID/OVERDUE (no DRAFT/POSTED/REVERSED). Waiver fields exist: `lateFeeWaived` (bool), `waivedById/At/Reason`, `waivedApprovedById`, `waivedAmount`. **`lateFeeWaived` boolean means "entire fee waived"** and is read in 3 places (`orchestrator:199`, `autoAllocate:584`, `applyCreditBalance:864`).
- **`JournalEntryStatus`** = DRAFT/POSTED/VOIDED (no REVERSED). **`createReversalJournal` is a throw-stub** (`journal-auto.service.ts:206`). → confirms Phase 4 = real work, deferred.
- **52-1105** exists (`finance-coa.csv:109` = `ส่วนลดให้ลูกค้า`). **`PaymentMethod` Prisma enum** = CASH/BANK_TRANSFER/QR_EWALLET/CREDIT_BALANCE/ONLINE_GATEWAY — **no CARD**.

## 3. Phase 1 — UI/UX + 2-block preview (no revenue-recognition change)

### 3.1 Preview returns blocks (`payment-journal-preview.service.ts` + `JePreviewPanel`)
- Each line gains `block: '2A' | '2B'` and `posted: boolean`. Return adds `subtotals: { '2A': {dr,cr,balanced}, '2B': {dr,cr,balanced} }`.
- **`2B_ONLY` (the mockup case — accrued):**
  - **2A block** = the **actually-posted accrual JE**, fetched read-only via `inst.accrualJournalEntryId` (+ the advance-consume-on-accrual JE if present). NOT reconstructed — this avoids drift vs the residual adjustment and accrual-time consume (scrutiny Major #2). Rendered "2A — ถึงกำหนดงวด (ACCRUAL) · โพสต์แล้วโดยระบบ".
  - **2B block** = lines the save posts now. **Phase 1** keeps the existing preview line logic and only adds the `block`/`subtotals` tagging + the real-2A fetch above (low risk). Full preview==save fidelity (shared builder + `reconstructPrior` so `Cr 11-2103` = actual remaining, not a blind full clear) lands in **Phase 2 §4.1** — noted as a known Phase-1 limitation, not a regression.
- **`CONSOLIDATED_*` (paying ahead, 2A not fired):** save folds 2A+2B and skips the 11-2103 bridge. Render a **single block "2A+2B (โพสต์รวมตอนนี้)"** with a note. **Defer** restructuring the consolidated posting to route through 11-2103 (out of Phase-1 budget). Mockup case unaffected.

### 3.2 Form (left column)
- **Credit banner** (`AdvanceBalanceBanner.tsx`): copy "มีเครดิตคงเหลือ {x}฿ จากชำระงวดก่อนเกิน · พักใน 21-1103 · ระบบจะหักอัตโนมัติ" + checkbox to toggle deduction. When credit exists, default `amountReceived = ค่างวด − เครดิต`.
- **`detectCase()`**: credit-deducted payment classifies as `NORMAL` (not OUT_OF_RANGE).
- **Quick tiles:** เต็มงวด (= net ค่างวด−เครดิต) / ปิดขึ้น (round net up to whole baht; +residual ≤1฿ → 53-1503/52-1104) / กำหนดเอง. Verify the round-up tile interacts correctly when advance legs are present (preview currently skips rounding then — `:283`).
- **Payment-type buttons → existing case enum:** ปกติ=NORMAL, แบ่งชำระ=PARTIAL, ล่วงหน้า=OVERPAY_ADVANCE, ปิดยอด→EarlyPayoffOverlay (verify exists), ปรับงวด=RESCHEDULE, คืนเครื่อง→link to repossession (not in this form).
- **State legend:** show only NEW actions (บันทึก / บันทึก+ลงบัญชี). REVERSED greyed = "Phase 4".

### 3.3 Channels + card (D3)
- Add "บัตร" channel button. Reconcile the existing string mismatch (`PreviewJournalDto.method` = CASH/TRANSFER/QR vs `RecordPaymentDto.paymentMethod` regex = CASH/BANK_TRANSFER/QR_EWALLET) so a single channel→method map is used.
- Money lands in a selectable bank account (11-120x). **Persisting "card" requires Open Q1 (enum).**

### 3.4 Backdated paidDate (D4) — full footprint
Thread an optional `paidDate` DTO→orchestrator and honor it consistently:
1. `validatePeriodOpen(prisma, paidDate, financeCompanyId)` (replaces `new Date()` at `:112`).
2. Late-fee `daysOverdue` computed from `paidDate` (not `Date.now()` at `:200`).
3. `paidDate`/`paidAt` stamps use the chosen date (`:278`).
4. Receipt JE `postedAt` = chosen date.
Default = now when omitted (current behavior preserved). Guard: `paidDate` not in the future.

## 4. Phase 2 — Gross waiver + 52-1105 (CPA-approved, D1)

### 4.1 Shared pure line builder (prerequisite — scrutiny Major #1)
Extract `buildReceiptLines(split, { debitAccountCode, advanceConsume, lateFeeWaived })` → `{accountCode, dr, cr, description}[]`, consumed by **both** `PaymentReceiptTemplate.execute` and the preview. Preview also calls `splitReceipt` + `reconstructPrior`. Eliminates the two-copies drift before waiver legs are added.

### 4.2 JE mechanics (keeps `splitReceipt` unchanged)
- `PaymentReceiptTemplate` (and `buildReceiptLines`) gain `lateFeeWaived?: Decimal`. Pass **net** (`gross − waived`) to `splitReceipt` (principal-protection preserved), then append a non-cash pair: **`Dr 52-1105 = waived` / `Cr 42-1103 = waived`**.
- Net result: `Cr 42-1103 = gross`, `Dr 52-1105 = waived`.
- Golden (traced end-to-end): `splitReceipt(delta=1456.66, instTotal=1515.83, lateFee=net 25, advanceConsume=84.17, isFinalReceipt=true)` → principalCleared 1515.83, lateFeePortion 25, overpay 0. Lines: Dr 11-1201 1456.66 + Dr 21-1103 84.17 + Dr 52-1105 25 = **1,565.83** = Cr 11-2103 1515.83 + Cr 42-1103 (25+25=**50**) = **1,565.83** ✅.

### 4.3 Orchestrator (the blocker fix — scrutiny 🔴)
Accept `lateFeeWaiverAmount / lateFeeWaiverReasonCode / waiverApproverId`. **Reduce the cash obligation by the waiver before the shortage/overage checks:** effective `amountDue = payment.amountDue + (gross − waiver)`. Re-traced golden: remaining 1540.83 → advanceConsume 84.17 → shortage 0 → closes, `isPaidInFull=true`. Forward `lateFee=gross` + `lateFeeWaived=waiver` to the template. Write `FeeWaiverApproval` + `LATE_FEE_WAIVED` AuditLog + set `Payment.waived*` fields **in the same `$transaction`**.
- **Validation:** `0 < waiver ≤ recomputed gross` (server is source of truth; reject otherwise). UI %/เต็ม buttons compute off the **preview's** returned gross (scrutiny Major #6).
- **`lateFeeWaived` boolean rule (scrutiny Major #3):** partial waiver sets `waivedAmount` only; set `lateFeeWaived=true` **only** for a 100% waive. Integration test covers waive-then-touch-again.
- **SoD:** reuse the 4-eyes check from `late-fee-waiver.service.ts` (approver ≠ recorder; role OWNER/FM/BM).

### 4.4 Config + preview + scope
- `seed.ts`: `late_fee_waiver_reasons` SystemConfig (loyal_customer / first_time / system_error / goodwill / other), following `reverse_reasons` pattern.
- DTO + preview mirror the waiver inputs/legs (now trivial via the shared builder).
- **Scope boundary:** Phase 2 = inline waive-at-receipt (the mockup). The post-hoc `PATCH /waive-late-fee` (net model, waives after posting) is **left as-is**; retroactive gross-up needs a separate adjusting JE — flagged as follow-up, not silently divergent.
- **Test:** golden as a **`recordPayment` integration test** (`*.integration.spec.ts`, jest) — must traverse the orchestrator, not just `splitReceipt`.

## 5. Phase 3 — Approval matrix (inline)
Extend `approval-config.util.ts` to cover payment actions (อนุโลม / ปิดยอด / คืนเครื่อง / กลับรายการ / ยอดเกินวงเงิน). Gate submit when an action needs approval but no approver is chosen. UI: read-only recorder + approver dropdown + matrix banner.

## 6. Phase 4 — Deferred (D2)
Document state machine (DRAFT/POSTED/REVERSED) + reversal endpoint. Genuine schema + reversal work (`createReversalJournal` is a stub; `Payment.status` lacks posting states). Separate PR.

## 7. Open questions for owner

1. **Card persistence (D3 detail):** add `CARD` to the `PaymentMethod` enum (one-line additive migration, recommended) **or** map card→`BANK_TRANSFER`/`ONLINE_GATEWAY` with the card distinction in metadata? (Affects whether "card" is reportable for EDC reconciliation.)
2. **Backdate late fee:** when backdating, compute late fee **as of `paidDate`** (recommended, §3.D4) — confirm this is the intended behavior vs "always as of today."

## 8. Acceptance criteria
- `./tools/check-types.sh all` = 0 errors.
- Preview: 2A balanced 2,115.00 + 2B balanced 1,565.83, matching the mockup.
- Phase-2 golden passes as a `recordPayment` integration test; existing payment tests stay green.
- No account code outside `finance-coa.csv`; Decimal + accounting.md rounding modes throughout.
- `code-reviewer` finds no Critical.
- Per-phase: TDD on money math → `code-reviewer` → check-types → owner sign-off before next phase.

## 9. Files touched
**FE:** `RecordPaymentWizard.tsx`, `AdvanceBalanceBanner.tsx`, `JePreviewPanel` (same file), `PaymentsPage/index.tsx`, `PaymentsPage/types.ts`
**BE:** `payments.controller.ts`, `dto/payment.dto.ts`, `services/payment-receipt-orchestrator.ts`, `services/payment-journal-preview.service.ts`, `services/late-fee-waiver.service.ts`, `journal/cpa-templates/payment-receipt.template.ts`, `journal/split-receipt.ts` (unchanged — confirm), new `journal/build-receipt-lines.ts`, `prisma/seed.ts`, (Open Q1) `prisma/schema.prisma` + migration
