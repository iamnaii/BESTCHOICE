# Payment history: receipt actions and installment allocations

The reported bundled reschedule receipt collected 5,516 baht: 4,472 for installment 4/10 and 1,044 prepaid toward installment 10/10. The history sheet previously compared the whole receipt against one installment and displayed `OVER`, with no allocation detail.

## Result

- Keep one row per receipt and show both installment allocations in that row. Cash totals count 5,516 once; the prepaid last installment does not increase the paid-installment count.
- Replace `CASE` with `ลักษณะการชำระ`. Labels include ตรงดิว, แบ่งชำระ, ปรับดิว, ปิดยอด, คืนเครื่อง and ชำระล่วงหน้า for an ordinary advance.
- Use the receipt's journal entry and reschedule audit records to identify the action and allocated amounts. Exclude collected late fees from installment allocations.
- Support fee-first rescheduling: a 1,144 receipt shows 1,044 toward the last installment and a separate collected late fee of 100.
- Derive fee/waiver summary cards from the same receipt fee data displayed in the table, retaining fees collected before rescheduling resets the installment's live fee.

## Historical attribution

`getContractReceipts` adds `paymentCase` and `installmentAllocations`. Other receipt query endpoints retain their prior behavior.

Explicit receipt-to-journal links take priority. Legacy matches require a unique receipt and forward journal entry with matching payment, contract, cash amount, paid business date and reversal state. Linked entries are reserved and cannot be borrowed by another receipt.

Bundled reschedule attribution requires a unique collection audit matching that receipt's payment, contract, amount and transaction reference. A phase-two retry may occur on another day or be completed by another cashier. Park and schedule evidence must belong to that collection event. Ambiguous evidence remains unknown.

New reschedule collection and park audits record the contractual last-installment target. Legacy targets require agreement between the old shift audit, the contract term and the surviving consecutive schedule. Current credit balances are never assigned to historical receipts. Missing allocation evidence produces no invented split; an unknown action displays ไม่ระบุ.

New standalone reschedule receipts also save their source journal link, validated against the receipt type, contract and payment. These additions do not change collection amounts or journal lines. No schema migration was added for this task.

## Validation

- API and web builds, including TypeScript checks, passed.
- ESLint passed for the changed API/web files; `git diff --check` passed.
- API: 85 Jest tests covering receipt history, fee history, issuance, receipts and reschedule collection.
- Web: 88 tests covering history rendering, labels, fee attribution, summaries and related payment components.
- Isolated PostgreSQL: 3 existing park-consumption/void/restore regression tests passed.
- Local fixtures use the actual payment orchestrator and reschedule collection service. Bundled collection reproduces 5,516 = 4,472 + 1,044. Fee-first collection verifies 1,144 = 1,044 + 100, the source journal link, and the current installment remaining unpaid.

Local preview: http://localhost:5197/payments. Fixtures: `TEST-HISTORY-RESCHEDULE` and `TEST-HISTORY-RESCHEDULE-SPLIT`. The bundled fixture's first three receipts have no late fees, so its cumulative cash is 18,932; the screenshot's three 100-baht fees and 19,232 cumulative total are covered by the component regression fixture.

Evidence is under `.tmp/payment-preview/history-*` and `.tmp/payment-preview/check-history-*`. The preview uses an isolated local database and simulated authentication/integrations. No production records were changed or deployed.
