# Payment Recording Wizard with Live JE Preview

**Date:** 2026-05-05
**Author:** owner + Claude
**Status:** Design (approved post-implementation, retroactive)

## 1. Goal

Replace single-form `RecordPaymentModal` with a 4-step wizard that shows a live journal-entry preview while user fills in the form. User confirms the preview before submission. Reduces JE-related errors and gives owners audit-grade visibility of every payment recording.

Mockup provided by owner is the ground truth for visuals.

## 2. Wizard Steps

| Step | Name | Content |
|------|------|---------|
| 1 | ข้อมูล | Read-only contract info: contractNumber, customer, installment N/total, due date (red if overdue), installment amount, late fee, total due, net exposure, status |
| 2 | กรณี | Case selector (6 buttons) + amount input + cash account selector (6 chips) + late fee input |
| 3 | ช่องทาง | Payment method (cash/transfer/QR/PaySolutions) + reference number (required for non-cash) + slip upload (required for transfer/QR) + memo (optional) |
| 4 | Journal | Final JE preview + confirm button |

Live JE preview panel always visible at bottom (across all steps) so user sees impact as they type.

## 3. Cases (Step 2)

| Case | UI label | Behavior |
|------|----------|----------|
| NORMAL | ปกติ (จ่ายครบยอด) | amountReceived = installmentTotal + lateFee, no tolerance |
| OVERPAY | จ่ายเกิน (ปัดเศษขึ้น) | overpay ≤1฿ → `Cr 53-1503` (auto, no approver) |
| UNDERPAY | จ่ายขาด (ยกให้ ≤1฿) | underpay ≤1฿ → `Dr 52-1104`, requires `toleranceApproverId` |
| PARTIAL | แบ่งชำระ (บางส่วน) | uses `PaymentReceipt2BSplitTemplate` partial leg |
| EARLY_PAYOFF | ปิดยอด (ก่อนกำหนด) | uses `EarlyPayoffJP4Template` — wizard collects discount % |
| RESCHEDULE | ปรับดิว (เลื่อนวัน) | step 3 expands to collect days-to-shift; uses `RescheduleJP6Template` |

## 4. Late Fee (Q1: manual user input)

Owner decision: **B** — user enters late fee manually each time. No auto-computation, no per-contract rate.

UI:
- "ค่าปรับ" input pre-filled with `0` initially (or last computed external value if available — TBD; for now default 0)
- User edits → JE preview updates `Cr 42-1103 ค่าปรับชำระล่าช้า`
- `0` = no late fee line in JE

API:
- Request body includes `lateFee: Decimal` (string-encoded)
- Backend trusts the value (no recomputation)

## 5. JE Posting Strategy (Q4: consolidated)

Owner decision: **C** — consolidated 2A+2B+late fee in single JE row when 2A not yet posted.

Detection logic (already in PR #752):
```typescript
if (installmentSchedule.accrualJournalEntryId === null) {
  // 2A not yet posted (cron didn't run, or payment received same day as due)
  // → emit consolidated 2A+2B+lateFee in one JournalEntry
} else {
  // 2A already posted by cron
  // → emit just 2B + lateFee in this JournalEntry
}
```

Consolidated JE shape (NORMAL case, vatPerInst=99.17, interestPerInst=500, principal+commission/inst=916.66, total inst=1515.83, lateFee=54):
```
Dr <depositAccountCode>     1,569.83  (installmentTotal + lateFee)
Dr 21-2102                     99.17  (clear deferred VAT)
Dr 11-2106                    500.00  (clear deferred interest)
  Cr 11-2101                1,416.66  (gross receivable)
  Cr 11-2105                   99.17  (VAT receivable asset)
  Cr 21-2101                   99.17  (VAT output ภ.พ.30)
  Cr 41-1101                  500.00  (interest income)
  Cr 42-1103                   54.00  (late fee income — only if lateFee>0)
```

Σ Dr === Σ Cr always; preview UI shows balance check.

2B-only JE shape (when 2A already posted): just `Dr cash + Cr 11-2103 + Cr 42-1103 (if lateFee)`.

## 6. Step 3 Channel + Evidence (Q2)

Owner decision: **method + reference + slip + memo**. Step 3 covers "how customer paid" (separate from cash account in step 2 = "where money goes").

Fields:
- `method`: enum CASH / TRANSFER / QR / PAYSOLUTIONS
- `referenceNumber`: string — required when method !== CASH
- `slipUrl`: S3 URL — required when method ∈ TRANSFER / QR; optional CASH
- `memo`: text — optional always

Validation: form blocks "ถัดไป" button until requirements met.

## 7. Reschedule Inline (Q3: option A)

Owner decision: **A** — wizard handles reschedule end-to-end.

Flow when case=RESCHEDULE:
- Step 2 stays as-is, but amount field becomes optional
- Step 3 expands to add:
  - "เลื่อนกี่วัน" — number input
  - "แบ่งจ่าย" — radio: ครั้งเดียว / 2 ครั้ง (split/bundled per Phase A.4 6a/6b)
  - Auto-computed reschedule fee = `installmentTotal ÷ 30 × daysToShift` (display-only)
- JE preview updates with `Cr 21-1103 เงินรับล่วงหน้า`
- On submit: backend calls `RescheduleService.execute()` + emits paired JE via `RescheduleJP6Template`

Note: this is the most complex case; if implementation effort blows up, defer reschedule case to a separate page (option C from Q3) and remove the case button from step 2 in this PR.

## 8. Net Exposure Display

`netExposure = (totalMonths - paidCount) × installmentTotal + cumulativeUnpaidLateFees`

Shown as a subtitle on Step 1 info panel: "฿X,XXX.XX (Net Exposure)" — informational, not editable.

## 9. Open Risks / Items not in this design

- **Slip upload UX** — assumes existing S3 upload helper (`useUpload` or similar). If absent, MVP can skip slip upload + add follow-up PR.
- **PaySolutions reference** — when method=PAYSOLUTIONS, reference may auto-populate from gateway response. For wizard MVP, treat as plain text input.
- **Multi-installment payment** — wizard handles single installment per submission. Multi-installment use-case stays on existing batch payment flow (separate page).
- **Audit log** — every wizard submission writes `AuditLog{ action: 'PAYMENT_RECORDED' }` with payload (case, channel, ref, slip, lateFee, JE entryNo). Backend already logs Payment.create — verify wizard inherits.

## 10. Acceptance Criteria

- [ ] Wizard renders 4 steps with progress indicator
- [ ] Live JE preview updates as user types (debounced ~300ms)
- [ ] Preview shows balance check (Dr === Cr indicator)
- [ ] Late fee field is user-editable, posted as `Cr 42-1103` when > 0
- [ ] Consolidated JE used when `accrualJournalEntryId IS NULL`
- [ ] All 6 cases work end-to-end (incl. RESCHEDULE inline)
- [ ] Step 3 enforces ref+slip for TRANSFER/QR
- [ ] Net exposure displayed correctly
- [ ] No regression: existing tolerance approval modal still triggers when |diff| ≤ 1
- [ ] TSC clean (api + web)

## 11. Implementation Status

Pre-emptive PR #752 from initial dispatch covered:
- Q1 (late fee from frontend) ✓
- Q4 (consolidated 2A+2B) ✓
- Wizard 4-step UI structure ✓
- Preview endpoint ✓

PR #752 needs verification for:
- Q2 step 3 content — implementer may have used placeholder, must verify includes method+ref+slip+memo
- Q3 reschedule inline — implementer may have just rendered case button without full flow; must check

Action: review PR #752 against this spec; fix gaps in same PR or as follow-up.
