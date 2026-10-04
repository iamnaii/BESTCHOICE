# BESTCHOICE — remaining acceptance and decisions

Prepared 4 October 2026. The owner authorized the remaining non-accounting work and normal release after verification. Formal repository review gates and unresolved accounting decisions still apply.

## CPA decision packet (Task 5/6)

User confirmed no latest answer yet. Reuse the existing accounting review questions; do not invent a posting or silently change a golden fixture.

| Decision | Concrete scenario to decide | Required answer |
|---|---|---|
| Advance representation (Q7) | Customer deposits money now and it is applied to a later installment | Confirm gross-balance approach X versus net-of-VAT approach Y, with exact account legs and receipt treatment |
| General overpayments (Q8) | Cash/online receipt exceeds the installment; remainder goes into general advance | Confirm when VAT is recorded, what document is issued at receipt, and how reuse avoids recording VAT twice |
| Advance exceeding remaining debt (Q9) | Two advance collections total 2,000; only 1,500 of contractual debt remains (illustrative amounts) | State disposition and owner of remaining 500, VAT/documents for that remainder, refund/retention procedure and account codes |
| Early-payoff receipt (question 16) | Admin payoff JE is correct but receipt presentation still has a separately documented policy gap | Confirm taxable base, VAT source, discount, late-fee and rounding lines, and how a void/correction copies the original document |
| QR authorization | Customer obtains a discounted payoff quote through LIFF | Confirm whether approval is required before issuing QR and who can approve |
| QR changed/expired quote after money received | Another payment changes debt after QR creation; provider still confirms payment | Confirm how to recognize and surface received funds, reconcile/refund/complete payoff, and who resolves the exception |

For each answer record approver, date, wording and a balanced example. Amounts in this packet are questions, not suggested accounting policy. No historical backfill or production test contracts are authorized by these examples.

### PR4/PR7 acceptance matrix to implement after answers

- Receive advance; consume all/part later; consume after multiple advances.
- Combined parked fee/general advance, overpayment beyond debt, zero payoff and residual customer money.
- Void one of several receipts, void the final receipt, correction across a closed accounting period.
- Admin payoff, shop collection, LIFF, repossession and bad-debt write-off reconcile to the same approved treatment.
- For every step: cash received, contract balances, GL debit/credit, receipt VAT, credit note and tax report reconcile independently.
- TEST-…-017 expected values require renewed confirmation if the new decision changes the old example.

### QR design boundary

Current `paysolutions-webhook.service.ts` processes the received amount FIFO across installments. Simply changing the quote UI does not make it a correct payoff transaction.

After policy decisions, specify an explicit payoff intent referencing a server-side quote/version/expiry, share the existing transaction-safe payoff core, and retain normal installment intents. Test duplicate callbacks, two callbacks racing, partial/over amounts, expired quote, closed contract/period and a competing shop payment. A paid-but-unresolved intent must remain visible and reconcilable; never discard already-received money because a quote is stale. Use provider sandbox and fixture outbound notifications before live acceptance.

## Production readiness already established

- `TEST_MODE_BYPASS=false` since 2 October, verified read-only on 4 October. Do not toggle it as part of checking the issue.
- Bot persona/KB/rate-card setting already match the 27 September patch. Do not apply the patch again.
- Real bot evaluation requires replenished model credit; the first synthetic attempt was rejected for insufficient balance. Resume changed scenarios S22/S23/S24/S26/S27, NS1, E12–E15/E27 with fixture tools and documented stock modes after credit is available.

## Staging/storage (#1572)

User is unsure whether staging exists. Read-only discovery on 4 October in `bestchoice-prod` found one Cloud Run service (`bestchoice-api`), one Cloud SQL instance (`bestchoice-db`) and buckets `bestchoice-documents` / `bestchoice-prod_cloudbuild`. `.firebaserc` points at production admin/shop hosting. No separate staging was identified within that project; A follow-up project inventory found `bestchoice-hermes` (one `hermes-vm`, no buckets; Cloud Run/Cloud SQL Admin APIs not enabled) and unrelated `naitha-prod`. No application staging was identified in the inspected BESTCHOICE projects.

Proposed isolated acceptance environment, if no existing environment is identified:

| Resource | Proposed setup | Acceptance boundary |
|---|---|---|
| Project / identity | Separate staging project and dedicated service account | No IAM grants on production database, bucket or secrets |
| API | Cloud Run from the reviewed commit; min instances 0 and capped maximum | Do not attach production LINE/SMS/email/payment credentials |
| SHOP / FINANCE | Two staging databases on a dedicated PostgreSQL 16 instance with required extensions | Migrate from the repository and seed synthetic fixtures; no customer-data copy |
| Documents | Dedicated private GCS bucket with explicit `GCS_BUCKET` | Match production storage code path; verify signed URL expiry/CORS/persistence |
| Web | Separate admin preview hostname, exact built ref | API URL must point to staging; separate test accounts/roles |
| Lifecycle | Time-boxed acceptance window, budget alert and named owner | Retain evidence; agree deletion date before creating billable resources |

The billable scope is Cloud SQL uptime/storage, Cloud Run usage and bucket storage/operations. A numeric estimate still needs region, instance size, availability mode and test duration; no resources or charges were created. Existing local tests already provide a no-cloud-cost baseline, but cannot certify GCS signed URLs or deployment persistence.

Inputs still needed: an existing staging location or a decision on this proposed environment, environment owner and test roles.

- [ ] Confirm no production database or bucket and no customer recipients; use synthetic fixtures.
- [ ] Deploy reviewed ref to staging after environment authorization.
- [ ] Produce each document group from real API flow, persist bytes, download and compare hashes.
- [ ] Restart/redeploy; previously stored files remain accessible.
- [ ] Signed URL valid before expiry and refused after expiry; staff bearer tokens do not travel to storage.
- [ ] Browser CORS works; wrong company/branch and deleted documents return expected denial.
- [ ] Signature replacement invalidates/reversions the old document correctly.
- [ ] Storage error produces a visible retryable failure; no silent regeneration/success.
- [ ] Record retention/lifecycle policy and test evidence with ref, timestamp and environment.

## Printer pack (#1571)

Prepared pack: `.tmp/remaining-work/BESTCHOICE-EPSON-print-pack-2026-10-04.zip` (69 PDF samples). Extract and open `epson-print-pack/index.html`; each row links the sample and records the physical result. It includes complete source-run/retest evidence and checksums. Select short/long and original/copy samples in each group, and record the pages actually printed. This is synthetic acceptance material, not CPA approval of pending early-payoff receipt policy.

User identified **EPSON**, then chose printer-independent A4 PDF output. The final portable pack is `output/pdf/BESTCHOICE-A4-print-samples.pdf` (69 documents, 232 A4 pages) and `output/pdf/BESTCHOICE-A4-print-pack.zip` (separate PDFs, Thai index and verification). All source text is preserved, general pages have 10 mm safe layout margins (some content scales down to 90.38%); 50×30 mm stickers sit at actual size on one A4 sheet. The dividend-register source was corrected so all reference numbers print. Local printer inventory has no configured destination or default printer. Physical output is not certified. Record scale and margins used at the shop; no model-specific setting is assumed. Fill the following per document group:

| Group | Short | Long/multipage | Original/copy | Thai glyphs/bounds | Total/signature kept together | Result/operator |
|---|---|---|---|---|---|---|
| Contract / PDPA | | | | | | |
| Receipts / credit notes / final installment | | | | | | |
| Receiving / trade-in | | | | | | |
| Expenses / petty cash | | | | | | |
| Payroll / withholding certificates | | | | | | |
| Other income / assets / dividends | | | | | | |
| Collections letters / reports | | | | | | |
| 50×30 mm sticker, complete model name | | | | | n/a | |

Also check native PDF print/download and return focus. A failed row gets a synthetic sample and exact print settings. No physical operator means waiting for acceptance, not passed. Use A4, actual size 100%, automatic orientation; do not apply additional scaling to sticker sheets. The portable pack preserves existing page breaks and embedded fonts; it does not constitute accounting approval.

## OTP and credit acceptance (#1602)

The owner designated a test recipient and confirmed receipt of one real SMS probe on 4 October at 11:58 Bangkok (Ref 114C). The full AppModule KYC/credit flow now passes on disposable SHOP/FINANCE PostgreSQL with real login and guards, private local file storage and a recorded synthetic SMS transport. This is separate from the confirmed real SMS delivery probe; a production contract was not created. A working credential alone does not prove delivery.

- [x] Authorized recipient receives a real OTP test SMS via the application transport. This was a delivery probe, without a production KYC/contract record.
- [x] Wrong and expired OTP rejected; correct synthetic SMS code reaches upload; exact image bytes persist before VERIFIED. Storage failure and concurrent resend cannot falsely verify the record.
- [x] Real authenticated POST /contracts rejects unapproved credit; verified affordability + approval permits creation, consumes approval and creates 12 installments.
- [x] SALES cannot enable bypass (403).
- [x] API readback confirms bypass=false before and after acceptance. Production readback remains false; this test does not certify a live browser banner.
- [x] Evidence separates the real SMS probe from synthetic AppModule acceptance: `.tmp/docs-integration/kyc-credit-accepted-20261004` (5/5); decoder/unit regressions (39/39).

If live flow fails, stop new onboarding and fix its cause; do not enable bypass as automatic rollback for real customers.

## Orphan configuration (#1606)

Completed in the authorized follow-up. The obsolete `credit_precheck_ai_enabled=false` row was soft-deleted once; native database deletion/update time `2026-10-04 05:04:19.150`. Readback verified it and confirmed `TEST_MODE_BYPASS=false`. Snapshot, guarded SQL and conditional restore are described in the [cleanup runbook](2026-10-04-credit-precheck-config-cleanup.md). Twelve disposable PostgreSQL checks passed before the operation. The feature remains retired.

## Release packet

- New integration branch preserves original #1665/#1667 heads. Local merge conflicts were version-only; release version candidate is 26.10.6, recheck before merge.
- PR #1672 is the prepared integration candidate; never merge both equivalent change sets independently. Main requires one code-owner approval, currently REVIEW_REQUIRED. No review gate has been bypassed.
- Require checks on the exact release head, preview evidence, migration summary and queued-approval impact. Quote changes may require existing approval requests to be resubmitted under the existing 409 guard.
- Normal release is owner-authorized. Wait for exact-head CI and the required GitHub review before merge/deploy; no deployment has occurred.
- Rollback can revert code/config when appropriate; it cannot reverse posted accounting entries by rewriting history.
- X6 e-Tax and X7 receipt QR remain deferred under the previous owner decision.
