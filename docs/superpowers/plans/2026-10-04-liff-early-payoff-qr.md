# LIFF early-payoff QR — implementation preparation

Status: source trace complete; design draft. Financial implementation remains gated on PR4 and the accounting/approval decisions below. Prepared 4 October 2026; no new payment endpoint, schema, QR or posting has been enabled by this document. The independent create-intent identity-binding fix has been implemented in the follow-up: verified `request.liffUserId` is required and a mismatched body identity is rejected.

## Observed path

| Stage | Actual implementation | Consequence |
|---|---|---|
| Quote | `line-oa/liff-api.controller.ts#getLiffEarlyPayoffQuote` → `ContractPaymentService.getEarlyPayoffQuote` | Admin and LIFF use the shared quote calculation |
| Browser | `LiffEarlyPayoff.tsx` posts amount/contract/LINE identity to `/paysolutions/create-intent`; no installment number | The UI's payoff quote alone does not identify a settlement type |
| HTTP | `PaySolutionsController.createPaymentIntent`, `CreatePaymentIntentDto`, `LiffTokenGuard` | Existing input has amount and optional installment number; no quote ID/version |
| Construction | `PaySolutionsService.services()` lazily constructs plain GatewayClient, Intent, Confirmation and Webhook classes | Thread new dependencies through this factory; do not assume the sub-services are Nest providers |
| Gateway intent | `PaySolutionsIntentService.createPaymentIntent` creates provider intent, then stores `PaymentLink` in a transaction | DB failure after provider success currently raises an orphan-intent alert; account for this lifecycle in the design |
| Storage | `PaymentLink`: token, optional contract/payment/saving-plan links, Decimal amount, ACTIVE/USED/EXPIRED status, expiry/use timestamps | No explicit payoff intent kind or immutable quote snapshot exists |
| Settlement | `PaySolutionsWebhookService.handlePaymentCallback` claims ACTIVE link in Serializable transaction and distributes paid amount FIFO | Discounted payoff money can leave installment debt; this route does not invoke the admin payoff posting |
| Existing admin core | `ContractPaymentService.earlyPayoff` owns transaction, approval/slip-match checks, fresh quote comparison, period check and accounting | Calling this from an existing webhook transaction would create the wrong transaction boundary; extract a shared transaction-aware core deliberately |

The expired-link branch currently ignores callbacks; unknown successful callbacks raise an alert but have no corresponding link record. These require durable reconciliation as part of this work. This is source evidence, not a completed end-to-end reproduction or provider-sandbox result.

## Required decisions

1. CPA Q7/Q8/Q9 and receipt question 16: use the balanced examples in the [decision packet](../../runbooks/2026-10-04-remaining-work-acceptance.md). Do not derive a new tax treatment from this QR design.
2. Must payoff approval be complete before QR issuance? Record approver, authority, validity and exact amounts approved. A system identity is not an approval substitute.
3. What happens to money already received against an expired/changed quote, a closed contract/period, or a short/over payment? Specify the holding/refund/reconciliation entries, permitted operator actions and customer wording.

Without these answers, do not select account codes, accept an old discount, turn a payoff into an ordinary installment, or silently discard a paid callback.

## Work after decisions

- [ ] **Reproduce in isolated SHOP/FINANCE PostgreSQL.** Seed a synthetic contract with independently calculated discount/advance amounts. Drive shared quote → current intent → successful fixture callback. Assert the observed residual installment balance against the intended payoff result. Retain the reproduction evidence before changing posting.
- [ ] **Define schema and rollout.** Choose explicit intent type and a server-owned quote snapshot containing contract, currency, exact cash amount, discount, applied credits/advances, expiry and approval/version reference. Define durable provider-event/reconciliation storage, uniqueness keys and state transitions. Review both Prisma schemas and all existing installment/savings/order/partial-link consumers. Existing untyped links retain a defined legacy path; never infer payoff by amount or description.
- [ ] **Bind customer and quote server-side.** Use verified `request.liffUserId`, validate contract ownership and company, and reject altered contract/amount/quote/approval data. The follow-up now rejects a mismatched body `lineId`; retain and extend its HTTP regression tests. Do not trust a body identity merely because a separate LIFF token verified. Requote/version checks must include new payments, advance changes and approval expiry.
- [ ] **Make issuance recoverable.** Persist a local issuance record before calling the provider; use provider-supported idempotency and unique references. Handle timeout/unknown result without issuing duplicate collectible intents. Define recovery when the provider accepts but local persistence fails. Confirm capabilities in current official provider documentation/sandbox before relying on them.
- [ ] **Extract shared settlement.** Keep admin authorization at the entry point and share the reviewed payoff accounting inside one supplied transaction. Claim event/intent, consume required approval, recompute/compare quote, post JE, apply balances and close contract atomically. Never forge a staff approval or weaken the existing 409 quote-change guard. Receipt/notification work remains recoverable after commit and tied to the same journal entry.
- [ ] **Handle paid exceptions durably.** Authenticate callback, validate provider transaction/reference, amount and currency, and record already-received funds even when automatic payoff cannot proceed. Use the approved exception treatment; provide an operator-visible reconciliation state. Repeated/out-of-order callbacks and process crashes must neither lose money nor post it twice.
- [ ] **Update LIFF states.** Show approval required, awaiting payment, confirmed payoff and received-but-needs-review states. Display final closure only after server settlement. Preserve the owner-approved combined-credit/savings presentation until explicitly changed. Cover zero payable separately; the current DTO requires at least one baht.
- [ ] **Verify and release.** Pass the matrix below on isolated databases, review migration/backward compatibility, then run provider sandbox acceptance on a separated environment. Live rollout requires exact-ref checks and acceptance evidence; no production test contracts or customer notifications are implicit.

## Acceptance matrix

| Scenario | Independent assertion |
|---|---|
| Approved current quote, with/without advances | Admin and QR have identical final balances, JE and approved receipt values |
| Forged LINE identity/contract/amount or missing approval | No provider intent issued and no financial state changed |
| Repeated and concurrent successful callbacks | One cash recognition, one settlement, one journal/receipt relationship |
| Callback after UI expiry, manual expiry, new shop payment or advance change | Received money retained in the approved reconciliation path; no stale discount silently applied |
| Short/over payment, zero payable, reversed provider order | Explicit approved outcome, no inferred intent type and no lost residual |
| Closed contract/period, missing system actor | Visible durable exception; no forged actor or forced period reopening |
| Provider accepted/local DB failed; timeout; crash after commit | Recoverable reference and idempotent replay without duplicate receipt or notifications |
| Installment, partial, savings and online-order payments | Existing independent flows retain their approved behavior |
| Retry after receipt/notification failure | Financial transaction stays committed exactly once; delivery can recover |

Do not implement deferred e-Tax (X6) or QR printed on receipts (X7) as part of this payment-settlement task.
