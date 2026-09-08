# Receipt amounts, remaining debt and rescheduled dates

The reported receipt collected 5,516 baht but described all of it as installment 4/10. The same contract's paid table displayed the settled installment amount instead of the cash received. Rescheduled dates also drifted between calendar days, and a standalone 6a advance appeared against the current installment instead of the last installment.

## Result

- Receipt PDF separates installment 4/10, 4,472 baht, from the 1,044 baht reschedule advance for installment 10/10. Total cash remains 5,516. The document's existing VAT treatment is preserved: taxable documents distribute their original tax across the displayed rows, while standalone RESCHEDULE_FEE receipts retain their existing non-VAT treatment. This change does not introduce a new tax-recognition policy.
- Remaining debt includes all billed installments and subtracts settled debt and unused customer funds. It does not subtract gross receipts from financed principal. With six installments of 4,472 and 1,044 already prepaid, remaining debt is 25,788 baht.
- The paid table and its Excel export use actual active installment-receipt cash: 5,516 for the bundled receipt and 3,428 for the last installment after consuming 1,044 prepaid. Partial receipts are summed; standalone reschedule-fee receipts are shown separately in receipt history. Missing receipt evidence displays an unknown amount instead of substituting the settled balance.
- A posted cash journal can reveal a missing partial receipt after a post-commit issuance failure. The existing fee query now also checks known cash totals; a provably incomplete receipt total is not displayed as the cash received.
- Reschedules use a fixed Bangkok calendar-day anchor. Each future installment advances by its installment-number offset in calendar months. An October 11 anchor produces November 11, December 11, etc. A 31st anchor clamps to the month's last day and returns to the 31st when available. Paid installments and gaps retain their place.
- A standalone 6a advance of 1,714 on a 12-installment contract displays installment 12/12 in history. The later regular payment remains against installment 5/12.

## Historical receipt evidence

Legacy document balances are reconstructed from receipt-linked postings and reversal history. Current `Payment.amountPaid`, payment status and advance balances are not used as historical balances. Unproved historical balances are shown as unknown; ambiguous installment/advance splits require inspection before printing.

The reconstruction handles late fees separately, partial payments, advance consumption, prior reversals and later reversals. Whole-baht billing residuals are closed only when the canonical journal debt is cleared and a valid historical PAID receipt proves completion. Genuine small partial balances remain outstanding.

New document balances are frozen with explicit versioned provenance inside receipt issuance, including unknown values. This prevents a later transaction with an earlier transaction-start timestamp from changing an old receipt when it is printed again.

## Existing date corrections

The code fixes future reschedules. It does not rewrite dates already stored for production contracts TEST-20260827-018 or TEST-20260827-019.

A read-only repair planner is available at `.tmp/payment-preview/plan-reschedule-calendar-repair.ts`, with instructions in `.tmp/payment-preview/reschedule-calendar-repair.md`. It was exercised against the isolated local 6a fixture and produced an auditable before/after plan without writes. It requires an exact contract, source audit and database name, preserves paid/posted rows, and rejects ambiguous evidence.

Do not invoke the reschedule collection service to repair old dates: that creates another reschedule event and can charge money again. A subsequent repair must only update proven unpaid schedule/payment dates, recheck their expected state atomically, and write its own audit.

## Verification

Evidence and local fixture scripts are in `.tmp/payment-preview/`:

- `receipt-calendar-*`: API/web builds, scoped lint, receipt and cash tests, isolated PostgreSQL regressions.
- Final receipt/cash Jest run: 187 tests in 18 suites passed, including preservation of the document's original VAT totals while splitting its rows. Isolated PostgreSQL: 13 tests in 3 suites passed. Scoped API/web lint has no errors; legacy/test typing warnings remain.
- `next-web-tests.log`: 204 payment-page/component tests passed.
- `next-api-tests.log`: 65 receipt-history, payment, reschedule and calendar tests passed before the final receipt snapshot addition.
- `pdf-before/` and `pdf-after/`: actual generated PDFs and rendered pages. Both corrected bundled and fee-first receipts fit on one page and were visually inspected.
- `paid-cash-fixture.json`: actual collection through installment 10, remaining debt before/after later collections, final advance consumption and matching monthly dates in both database tables.
- `paid-cash-snapshot-fixture.json`: a second independent contract issued on the final snapshot code. All 10 receipts have matching immutable document snapshots. The bundled receipt remains 25,788 / 6 months after contract completion; the final receipt records zero remaining debt.

The final standard API build encountered `ENOTEMPTY` while clearing `dist`, which another session's existing Nest watcher was writing. That process was preserved. The equivalent final Nest/TypeScript compilation uses the same source and configuration with an isolated output directory under `.tmp/payment-preview/api-build`; Prisma clients were generated through the standard build command.

The PostgreSQL lifecycle regression was updated to expect the existing shared last-installment rounding (1,515.87), and verifies total receivable debits equal credits after consuming 354 and receiving the remaining 1,161.87.

Local preview: http://localhost:5197/payments. The preview uses an isolated database, synthetic customers, simulated authentication and disabled external delivery/device integrations. No production records were changed or deployed.
