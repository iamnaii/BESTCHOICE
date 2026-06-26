# Payment-Type In-Page Overlays (ปรับงวด + คืนเครื่อง)

**Goal:** Make every "ประเภทการชำระ" button in `RecordPaymentWizard` complete IN the modal — no
`toast`-pointing-elsewhere, no `navigate()` away.

**Status today**
- ปกติ / แบ่งชำระ / ล่วงหน้า → `caseOverride` toggle (in-page ✅)
- ปิดยอด → `EarlyPayoffOverlay` via `createPortal(document.body)` (in-page ✅) — the canonical pattern
- **ปรับงวด** → `toast.info('ทำผ่านเมนูสัญญา/งวด')` ❌
- **คืนเครื่อง** → `onClose(); navigate('/repossessions')` ❌

**Decision (owner, 2026-06-26):** คืนเครื่อง = **full in-page** (all fields + full P&L preview + complete repossession in-modal). ปรับงวด = full overlay.

## Architecture
Two new overlay components, each self-portaling to `document.body` (mirrors `EarlyPayoffOverlay`),
mounted from the wizard, receiving `onClose` + `onSuccess` (success closes the wizard + invalidates).

### Task 1 — `RescheduleOverlay.tsx`
- **Files:** Create `apps/web/src/pages/PaymentsPage/components/RescheduleOverlay.tsx`; Modify `RecordPaymentWizard.tsx` (state + button + mount).
- **Inputs:** `daysToShift` (≥1, quick 7/14/30) + `splitMode` (`SINGLE`=6b bundled / `SPLIT`=6a fee-advance).
- **Fee (display):** `ROUND_DOWN(monthlyPayment / 30 × days, 2)` via decimal.js — mirrors `RescheduleService.execute` + preview service exactly (`contract.monthlyPayment` is the installment total incl. commission+VAT).
- **No JE preview** — reschedule posts NO JE at reschedule time (DB-only: shift due dates + set last installment `amountDue = monthlyPayment − fee`); JP6 posts at the next payment. Effects section states this.
- **Submit:** `POST /payments/record` `{ contractId, installmentNo, amount: 1, paymentMethod: 'CASH', case: 'RESCHEDULE', daysToShift, splitMode }`. `amount`/`paymentMethod` are `RecordPaymentDto` validation placeholders — the controller's RESCHEDULE branch returns before using them. Branch access + roles already enforced (OWNER/BM/SALES/FM/ACC).

### Task 2 — `RepossessionOverlay.tsx`
- **Files:** Create `apps/web/src/pages/PaymentsPage/components/RepossessionOverlay.tsx`; Modify `RecordPaymentWizard.tsx`.
- **Inputs:** `repossessedDate`, `conditionGrade` (A-D), `appraisalPrice`, `repairCost`, `marketValue`, `discountPct` (default 50), `customerRefundEnabled`, `depositAccountCode`, `notes`.
- **Live preview:** `GET /repossessions/preview/:contractId?marketValue&discountPct&customerRefundEnabled` → `{ contract, calculation }`; render the P&L breakdown (outstanding / principalExVat / remainingCost / discount / closingAmount / marketValue / customerRefund / profitLoss). Product info comes from `preview.contract.product`.
- **Submit:** `POST /repossessions` (full create — JP5 + status changes, atomic server-side).
- **Role gating (from backend):** create = **OWNER only**; preview = OWNER/BM/FM. Non-OWNER: submit disabled + notice. Non-(OWNER/BM/FM): skip preview + notice.

### Task 3 — Wire into `RecordPaymentWizard.tsx`
- Add `showRescheduleOverlay` / `showRepoOverlay` state (reset in `handleOpenChange`).
- RESCHEDULE button → `setShowRescheduleOverlay(true)` (was toast).
- REPO button → `setShowRepoOverlay(true)` (was `onClose(); navigate(...)`).
- Mount both near the payoff overlay; `onSuccess` → `onClose()` (close wizard).

## Verification
- `tools/check-types.sh all` = 0.
- Adversarial code-review workflow (correctness / accounting-role-guards / UI-conventions-a11y / pattern-consistency) → verify findings.
- Owner visual smoke (no DB here).

## Out of scope
- Repossession post-create lifecycle (repair / resale / status) stays on `/repossessions` (asset management, not a payment task).
- Reschedule JP6 JE preview (posts at next payment; would need a placeholder deposit account → confusing).
