# Payment History — Receipt-Level View (redesign) — Design

**Date:** 2026-06-28
**Goal:** Redesign the per-contract "ประวัติการชำระ" modal (`PaymentHistorySheet`) from an
installment-grouped view into a **receipt-level table + 4 summary cards**, matching the
owner's mockup (receipt#, date, งวด n/12, ยอดต้องชำระ, ยอดรับจริง, ค่าปรับ/อนุโลม 3-line, CASE
badge, ช่องทาง, สถานะ incl. VOIDED, ผู้บันทึก, ผู้อนุมัติ, ใบเสร็จ PDF + void).

**Scope:** per-contract (one contract), replacing the existing modal. NOT per-customer aggregate.

## Approach (post-/scrutinize): REUSE + ENRICH — no new endpoint
The frontend already fetches `/payments/contract/:id` AND `/receipts/contract/:id` and already
joins them (`receiptsByPaymentId`) and computes a summary client-side. So we reuse that flow and
enrich only the missing fields, rather than add a redundant 3rd endpoint.

### Backend enrichment (additive — safe for existing callers)
1. **`GET /receipts/contract/:id`** (`receipt-query.service.getContractReceipts`):
   - Add `includeVoided` query param (**default false** → existing callers unchanged). The modal
     calls with `includeVoided=true` so VOIDED receipts appear (strikethrough). The current hard
     `isVoided: false` filter becomes conditional.
   - Add `issuedBy: { select: { id, name } }` (ผู้บันทึก for receipts whose payment is null).
2. **`GET /payments/contract/:id`** (`payment-query.service.getContractPayments`):
   - Response already returns all Payment scalars (`amountDue`, `lateFee`, `lateFeeWaived`,
     `waivedAmount`, `waivedApprovedById`, `depositAccountCode`, `paymentMethod`, `status`) +
     `recordedBy{name}`. ADD: a top-level `contract` block `{ contractNumber, customerName,
     productName, totalMonths, advanceBalance }` (header + 2 summary cards) and a per-payment
     `waivedApprovedByName` (batch-resolve `waivedApprovedById` → User.name; **no schema change /
     relation** — collect ids, one `user.findMany`, attach).

### Frontend — rebuild `PaymentHistorySheet.tsx`
- Fetch both (receipts with `includeVoided=true`), build **one row per receipt** (incl. voided),
  joined to its Payment by `paymentId`.
- **4 summary cards** (computed client-side): งวดที่ชำระแล้ว `paidInstallmentCount/totalMonths` ·
  ยอดชำระสะสม `Σ amountPaid (non-voided)` · ค่าปรับ/อนุโลม `Σ lateFee / −Σ waivedAmount` · เครดิต
  (21-1103) `contract.advanceBalance`.
- **Row columns** ← sources:
  | column | source |
  |---|---|
  | เลขที่ใบเสร็จ | receipt.receiptNumber |
  | วันที่ | receipt.paidDate |
  | งวด | receipt.installmentNo `/` contract.totalMonths |
  | ยอดต้องชำระ | payment.amountDue (— if no payment) |
  | ยอดรับจริง | receipt.amount |
  | ค่าปรับ/อนุโลม (3 บรรทัด) | payment.lateFee / `−`payment.waivedAmount / net = lateFee−waived + reason (waivedReason). แสดงเฉพาะ lateFee>0 |
  | CASE | derived (below) |
  | ช่องทาง | payment.depositAccountCode (— if no payment) |
  | สถานะ | receipt.isVoided → VOIDED (strikethrough) ; else PAID/PARTIAL |
  | ผู้บันทึก | payment.recordedBy.name ?? receipt.issuedBy.name |
  | ผู้อนุมัติ | payment.waivedApprovedByName (— if none) |
  | actions | ใบเสร็จ PDF (existing downloadReceiptPdf) ; X = void (existing ReceiptVoidService, only if !isVoided) |
- **CASE derive** (no stored field): `PARTIAL` if receipt.paymentStatus==='PARTIAL' · `OVER` if
  receipt.amount > payment.amountDue · else `NORMAL`. receiptType override: `EARLY_PAYOFF`→"ปิดยอด",
  `DOWN_PAYMENT`→"ดาวน์", `CREDIT_NOTE`→"ใบลดหนี้". Badge colors: NORMAL=success, OVER=primary/violet,
  PARTIAL=info, special=warning.
- **Null-payment receipts** (EARLY_PAYOFF created with `paymentId=null`): ยอดต้องชำระ/ค่าปรับ/ช่องทาง
  show "–", CASE = receiptType label, ยอดรับจริง = receipt.amount, ผู้บันทึก = receipt.issuedBy.name.
- **Void = soft** (audit): reuse existing receipt-void flow; never DELETE. Voided row rendered struck-through + VOIDED badge.

## Out of scope (YAGNI)
- Per-customer (all-contracts) aggregate · new schema fields/relations (CASE derived; approver
  name batch-resolved) · new void flow · changing other callers of the 2 endpoints (additive only).

## Risks / limitations
- CASE can't distinguish OVERPAY_ADVANCE (จ่ายล่วงหน้า) from OVER — no persisted `case`; both read
  as OVER when amount>amountDue. Acceptable (mockup shows only NORMAL/OVER/PARTIAL); label
  conservatively.
- `includeVoided` must default false so existing `/receipts/contract/:id` callers are unaffected.
- Batch user-name resolve for approver avoids a migration; one extra `user.findMany` per call.

## Verification
- check-types all = 0. Existing payments/receipts specs stay green (additive changes).
- Manual: open the modal on a contract with normal + over + partial + voided + payoff receipts →
  matches mockup; 4 cards correct; voided struck-through; PDF + void work.
