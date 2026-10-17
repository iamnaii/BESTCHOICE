# Task 4.1.3.2 — sales and bookings consumer

Status: DONE_WITH_CONCERNS — implementation, focused verification and self-review complete; pending independent review and the explicit later-task seams below. Independent review is root-owned. Work is confined to the employee-access worktree/branch, consuming reviewed producer `7bbd1e957`; no subagents, parent plan/ledger edits, schema changes, production migration, push, merge or deploy.

## Source and execution contract

All 18 SalesController/BookingsController boundaries use AccessResourceService.execute, current persisted snapshot after the global advisory lock, original capability/company/scope tuples, a Serializable outer transaction and at most three whole-attempt retries. Global serialization remains intentional until 4.4. Collection executors validate string/query shape, pagination/overflow, booleans/enums and calendar dates explicitly because they bypass Nest pipes. Mutation handlers retain Nest DTO validation within the execution. Selected company must be SHOP and live. Unknown delegates, raw SQL and relation expansion do not gain automatic authorization.

`access-sales-scope.ts` exports typed `saleSource`, `saleScopeWhere`, `currentSaleWhere`, `bookingSource`, `bookingScopeWhere`, `currentBookingWhere`, `currentCustomerReadWhere`. Sale source is the persisted historical SHOP branch and salesperson, not today's Product owner/branch. It mirrors the reviewed inventory Sale provenance while deliberately retaining voided Sale history: ordinary list/summary eligibility still excludes voided sales; findOne and includeVoided retain existing archive access. Record mutations lock actual Sale/Booking and source branch. Booking creator is never assignment; ASSIGNED-only booking authority denies. No origin or assignment field was invented.

New sale/booking requires explicit live SHOP branch. Every main/bundle/booking-item/locked product and current destination is independently resolved; products.read and the primary action must both authorize the source. Booking.convert also requires sales.create at the actual booking source. Current product changes do not rewrite Sale history. Known customer selection/expansion uses only reviewed same-party TradeIn or historical Sale evidence; COMPANY is not a fallback for unlinked parties. No arbitrary sourceRoomId grants room or customer history. Existing free-text/walk-in trade-in producer behavior is untouched; the current booking/sale workflows already require a customer and physical product.

Sales collection predicates precede count, sums, grouping, pagination and export. Customer-name/phone and product-name/IMEI search branches independently scope the searched relation. Top-product grouping scopes the current product before ranking/limit. Salesperson suggestions enumerate active eligible identities using current sales.create at the actual intersecting source; legacy role names are not the eligibility shortlist. Responses provide only id/name, and selection grants no employee-detail access. Internal numbering uses the unscoped joined transaction, preserving global uniqueness; scoped reads are explicit and never wrap numbering delegates.

## Actual transactions and effects

Sales facade and its captured SalesQuery/SaleCreation/SaleWriter helpers, SaleVoidService and BookingsService resolve domainAccessClient at call time. Every nested callback transaction joins the exact outer client. SaleWriter's local retry and SaleVoid's P2034 translation are bypassed only in managed execution so the engine retries the whole attempt with fresh authorization; aborted transactions are not queried/caught as successful partial work. Existing journal/template/tender helpers receive that same client. Sales export uses the already-owned snapshot and database transaction_timestamp, rather than issuing SET TRANSACTION READ ONLY after access locks; the durable existing export audit receives the exact outer tx.

Root's explicit ruling: **managed loyalty redemption is atomic with sale discount, stock, journal, tender and redemption**. It uses a conditional current balance debit; inability to debit or any late SQL failure rolls back the sale. Outer retry discards the failed attempt's redemption and effects, so it cannot double-debit. Legacy unmanaged best-effort behavior remains unchanged. Managed responses never expose `_loyaltyRedemptionFailed`. UI consequence: managed users receive a failed sale, not a partially successful discounted sale, and may retry after resolving the underlying failure. This does not repair legacy partial successes.

Warranty notification is registered with onDomainCommit and runs outside the actual outer transaction/ALS. Booking cancel's unlock-skipped warning also waits for outer commit. Callback failure follows the engine's existing logged effectFailures contract and cannot replay committed financial work; no durable delivery queue was added. Tests mock the notifier and assert that a committed Sale exists on its separate client, outside ALS. No actual provider sends/uploads occur.

Canonical financial paths remain: cash/external SaleWriter, SaleVoid reversal/credit release/tender refund, Booking payDeposit, full-deposit cancel refund through ShopBookingRefundTemplate plus ShopTenderRecorder split reversal, and Booking.convert direct cash Sale creation/deposit application. No alternate refund/bank/credit/points executor was created. Existing state, product-lock/CAS, amount, tax/accounting period, source/target and duplicate rules remain. SQL-only `bookings_locked_product_active_unique` is preserved and exercised. INSTALLMENT Sales.create still rejects; /contracts activation remains canonical.

## Sensitive output and producer correction

AccessSalesProjectionService resolves each Sale/Booking/Product independently. Historical costSnapshot/costPriceSnapshot uses actual Sale source sensitive.cost.read; current product cost separately uses current Product source. Profit requires both cost and profit authority on all Sale sources contributing to the exact effective aggregate predicate before disclosure (corrected in review round 1 below). Party/product IDs and nested expansions require independent reads. Booking receipt navigation requires bookings.read; converted Sale navigation requires actual saleSource plus sales.read. Contract, financeReceivable, commissions, online-order and source-room navigation are suppressed pending their own source integrations. Booking audit events preserve actor/action/time but dynamic data is suppressed rather than granting historical party/product references from raw JSON.

Trade credit is consumed from raw persisted values, never projected null amounts. Snapshot projection independently checks actual TradeIn source/read and cost; base/bonus/cashDown/totalDown amounts are hidden without its cost capability. Existing seller-bank and journal-source producer rules remain independent. `currentRedemptionId` is restored only when its actual TradeInCreditRedemption belongs to this TradeIn, points to an actual historical SHOP Sale, and sales.read authorizes that Sale. `currentRedemptionSaleId` then provides legitimate Sale navigation. FINANCE Contract redemptions remain suppressed.

**Shared producer bug found by consumer RED:** a bookings.read-only actor's explicit customer filter returned200 despite having zero customers.read tuples. `AccessTradeInProjectionService.partyAllows` reached its historical Sale fallback without an explicit no-tuples guard. The narrow producer fix rejects absent/unusable independent party tuples before either evidence query. `currentCustomerReadWhere` likewise emits explicit false for absent tuples before search counts. Positive separate A/B grants and ASSIGNED semantics remain unchanged. Producer integration now directly proves no-party-grant false, nested customer/id hidden, direct selected-customer create denied, foreign-branch customer grant insufficient, and correct-branch grant restores both read/create. This is a shared contract change, not a booking-only workaround; reviewer should inspect it alongside the new consumer.

## Task 6 seams and temporary policy

Root explicitly ruled that until Task6 provides configured caps and immutable approval records, **managed discretionary `CreateSaleDto.discount > 0` requires the current owner**. Neither discounts.approve nor a caller-supplied secondApproverId substitutes for approval. New trimmed `discountReason` is bounded to3–500 characters. The actual outer tx writes existing AuditLog action `SALE_DISCOUNT_OWNER_APPROVED`, entity sale, requester=approver=current owner, reason, Sale id, sellingPrice/baseDiscount/totalDiscount/netAmount. It contains no cost. Failure rolls it back with money. Unmanaged caps/approval behavior stays unchanged. Canonical points/trade-bonus calculations and existing independent product/discount checks remain; old role caps are not configured managed approval authority. Cost-floor error text no longer discloses hidden cost/floor in managed responses.

All direct seams for Task6:

1. SaleCreation.create: caller sellingPrice, discretionary discount, secondApproverId, combined loyalty/trade bonus and net calculation; owner interim audit above. Price changes with discount0, promotion baseline and allocation/snapshot approval remain Task6.
2. SaleWriter.createCashSale/createExternalFinanceSale: actual financial executions, bundle allocation, trade-credit claim, cost snapshot, tender recording, commission/receivable writes. Root current-owner gate is in canonical orchestration, not a competing sale writer.
3. SaleVoid.voidSale/run: owner-reserved sales.cancel.approve, original restrictions, current products, canonical JE reversal, TradeInCredit.release and ShopTenderRecorder.recordRefund. No approval-request/execution record invented.
4. Bookings.create/update: caller item unitPrice/quantity/total/deposit and later edits. These prices feed convert directly; Task6 must not assume all discounts enter SaleCreation.
5. Bookings.payDeposit: actual receipt/lock, exact canonical tender evidence.
6. Bookings.cancel: direct pending cancellation or paid full-deposit refund. Scoped bookings.update permits pending/no-money cancellation; current owner is required only when the locked persisted booking is PAID with a positive deposit, matching the canonical refund condition (corrected in review round 1 below). Paid refund mirrors actual tender split once; staff refunds need Task6's owner-approved exact execution chain.
7. Bookings.convertToSale: separate direct CASH Sale creation/deposit application/balance collection, requires bookings.update plus sales.create. Task6 must bind approved prices/quantities/conditions here, without rerouting into another money path.
8. Bookings.remove: only pending-deposit soft-delete; no paid-money cancellation bypass. Existing expiry/forfeit scheduled path remains unchanged and is not an owner-approved discretionary refund.

This is not completion of the full approval workflow. Task6 must replace the temporary owner gate with the agreed configured limits, immutable snapshot/reapproval, requester/approver separation and approved refund execution once, before overall completion.

## Consumer handoffs (4.2, 4.1.5, chat, Task7)

- **Task4.2 FINANCE:** extend AccessSalesProjectionService fields `contractId`, `contract`, `financeReceivable`, `commissions` only after independent actual sources/permissions. Extend AccessTradeInProjectionService's currentRedemption branch for actual Contract redemption; preserve existing Sale branch. `AccessSalesBoundaries.validateQuery` explicitly rejects managed `contractStatus` filtering until actual Contract scope can constrain it before counts/exports. Tests cover normal historical Sale read/list/void history and explicit contractStatus403. Existing completedSaleWhere remains internal historical Sale eligibility, distinct from caller-selectable Contract history. Neither restriction is final whole-program completion.
- **Task4.1.5 parties:** extend the narrow partyAllows/currentCustomerReadWhere contract with verified new-party origins; rerun both producer and sales/booking consumers. Known TradeIn/Sale-linked customer is usable now; unlinked customer is denied even with COMPANY grant. Preserve same-party identity and original tuples.
- **Chat:** booking sourceRoomId is origin metadata, not room/history authority. Source-room navigation remains null pending its own source resolver; do not infer assignment from createdById.
- **Task7:** retain selected SHOP company and send explicit branchId for new sale/booking. Handle nullable nested IDs/cost/profit/credit fields; use creditRedeemed and authorized currentRedemptionSaleId. Configurable positions use the current salesperson selector. Managed owner discretionary discounts need discountReason; staff approval requests come with Task6. Failed managed points sale is fully rolled back; no partial-success flag. Keep /contracts for installments.

## Verification evidence

Owned harness: `tools/test-employee-access-sales-bookings.sh` creates its own mktemp PG16 socket cluster, overrides **both DATABASE_URL and DATABASE_URL_FINANCE**, deploys existing migrations only into that isolated DB, and tears down only that cluster. Real Nest HTTP, services, PostgreSQL journals/audits/tenders execute. Injected test identity and overridden legacy JWT/Roles/Branch guards are **not actual JWT/guards/browser evidence**. Root owns Task8 full guards/local:check and same-worktree preview. No application DB, production identity or real external provider used.

- Initial RED `/tmp/bc-sales-bookings-red.log`: owned PostgreSQL harness exits1 for missing new source contract. Compilation corrections were typed BookingWhereInput/selector-array annotation; not claimed as business RED.
- First all18 actual HTTP GREEN `/tmp/bc-sales-bookings-http3.log`:2/2 tests,18 successes +18 persisted no-grants denials.
- Expanded money/current-authority GREEN `/tmp/bc-sales-bookings-http4.log`:9/9.
- Full credit/discount/external/bundle GREEN `/tmp/bc-sales-bookings-http7.log`:12/12. Earlier http6 fixture used arbitrary UUID Sale numbers, which could lexically dominate the global SL counter and create repeated collisions; fixtures now use valid SL900000/SL900001. Global production numbering was not changed. Earlier credit-line fixture used dr/cr instead of actual debit/credit; corrected.
- **Actual privacy RED** `/tmp/bc-sales-bookings-final-http.log`:12 passed/1 failed, expected customer-filter403/received200; narrow shared empty-tuple fix described above. Focused GREEN `/tmp/bc-sales-bookings-party-fix.log`:1/1 relevant test, includes physical lock and malformed calendar/Contract filters.
- Final full consumer and producer runs, types/lint outcomes recorded in final section below.
- Focused legacy service tests initially244/246 in11 suites (`/tmp/bc-sales-bookings-units.log`). Unmanaged booking search now preserves original query shape; one preexisting fixed expiry date had elapsed on the real clock, so its test uses a relative future date. Focused rerun **29/29 in4 suites** (`/tmp/bc-sales-bookings-final-units.log`): bookings events/list filters, sale creation/query. The initial9 passing suites include all sale writer/void/product/read/service and booking service/summary regressions; no irrelevant broader suite claimed.
- Coverage checker and checker regression exit0:1395 classified entrypoints/178 files,1093 domain classifications;1/1 node:test. This is route classification inventory, not whole-program authorization/line coverage. git diff --check passes.

## Exact18 and parent56 reconciliation

Each row has real successful HTTP plus the identical route/method/body replayed as persisted no-grants403. Standard POST201 and GET/PATCH/DELETE200. No manifest primary permission changes were needed. Cancellation's reserved current-owner check and conversion's additional sales.create are explicit independent requirements.

| Controller.method | Transport | Primary | Resolution |
|---|---|---|---|
| BookingsController.cancel | Post(':id/cancel') | bookings.update; current owner for actual paid refund | record |
| BookingsController.convert | Post(':id/convert') | bookings.update + sales.create | record |
| BookingsController.create | Post() | bookings.create | record |
| BookingsController.findAll | Get() | bookings.read | collection |
| BookingsController.findOne | Get(':id') | bookings.read | record |
| BookingsController.payDeposit | Post(':id/pay-deposit') | bookings.update | record |
| BookingsController.remove | Delete(':id') | bookings.delete | record |
| BookingsController.summary | Get('summary') | bookings.read | collection |
| BookingsController.update | Patch(':id') | bookings.update | record |
| SalesController.create | Post() | sales.create | record |
| SalesController.exportRows | Get('export') | sales.export | collection |
| SalesController.findAll | Get() | sales.read | collection |
| SalesController.findOne | Get(':id') | sales.read | record |
| SalesController.getDailySummary | Get('daily-summary') | sales.read | collection |
| SalesController.getPosConfig | Get('config') | sales.read | collection |
| SalesController.getSalespersons | Get('salespersons') | sales.read | collection |
| SalesController.getTopProducts | Get('top-products') | sales.read | collection |
| SalesController.voidSale | Post(':id/void') | sales.cancel.approve (OWNER) | record |

Parent surface reconciles exactly **Sales9 + Bookings9 + reviewed TradeIn38 =56**. Producer's exact38 table is in task-4.1.3.1-report.md (with review fix appendices), and its full HTTP regression is rerun because this consumer changed shared party/redemption projection. Consumer independent review is still root-owned; this report does not claim parent4.1.3 independently approved/completed.

## Self-review and limits

Reviewed all18 controller methods, every captured Prisma helper, transaction/catch/retry/notification boundaries, original assignment tuples, actual source/destination/bundle/credit substitutions, every exposed nested relation and cost/profit field, aggregate/search predicates before counts/ranking, direct money executors and archive behavior. Financial computations use raw source values; output projection runs only after canonical handler work. No per-user overrides, sensitive position-name allowlist, cross-product grant flattening or new bank integration.

Limits: global exclusive serialization; uncapped per-user/per-row source reads (4.4 throughput); no durable external-effect delivery retry; dynamic JSON projector boundary; pending party/FINANCE/chat integrations as enumerated; legacy unmanaged best-effort points not repaired; existing Jest forceExit and expected injected-failure logs remain. No final actual JWT/guard/browser/local-preview claim. Existing independent period/state constraints are preserved in canonical services and focused regressions; no new accounting policy was invented.


## Final verified checks and files

All commands below exited0 on the final source:

- `bash tools/test-employee-access-sales-bookings.sh > /tmp/bc-sales-bookings-verified-http.log 2>&1`: **13/13**, actual18 route success/denial pairs, source/tuple/query privacy, canonical credit and monetary rollback/duplicate/current-authority controls described above.
- `bash tools/test-employee-access-trade-in.sh > /tmp/bc-sales-bookings-verified-producer.log 2>&1`: **15/15**, actual38 route success/denial pairs plus producer shared no-party-grant regression.
- API cwd `npx tsc --noEmit > /tmp/bc-sales-bookings-verified-types.log 2>&1`: zero errors.
- API cwd `npx eslint src/modules/employee-access/access-sales*.ts src/modules/employee-access/access-trade-in-projection.service.ts src/modules/employee-access/access-trade-in.integration.spec.ts src/modules/employee-access/employee-access.module.ts src/modules/bookings/bookings.service.ts src/modules/bookings/__tests__/bookings.events.spec.ts src/modules/sales/sales.service.ts src/modules/sales/dto/sale.dto.ts src/modules/sales/services/{sale-creation.service,sale-product-policy,sale-void.service,sale-writer.service,sales-query.service,sales-read-policy,discount-policy.util}.ts`: **zero errors/warnings**, `/tmp/bc-sales-bookings-verified-lint.log`.
- `node tools/check-access-coverage.mjs`, `node --test tools/check-access-coverage.test.mjs`, `git diff --check`: pass. No source mutations followed the final consumer/producer/types/lint results; only this report was completed.

Changed files:
- `apps/api/src/modules/bookings/__tests__/bookings.events.spec.ts`
- `apps/api/src/modules/bookings/bookings.service.ts`
- `apps/api/src/modules/employee-access/access-trade-in-projection.service.ts`
- `apps/api/src/modules/employee-access/access-trade-in.integration.spec.ts`
- `apps/api/src/modules/employee-access/employee-access.module.ts`
- `apps/api/src/modules/sales/dto/sale.dto.ts`
- `apps/api/src/modules/sales/sales.service.ts`
- `apps/api/src/modules/sales/services/discount-policy.util.ts`
- `apps/api/src/modules/sales/services/sale-creation.service.ts`
- `apps/api/src/modules/sales/services/sale-product-policy.ts`
- `apps/api/src/modules/sales/services/sale-void.service.ts`
- `apps/api/src/modules/sales/services/sale-writer.service.ts`
- `apps/api/src/modules/sales/services/sales-query.service.ts`
- `apps/api/src/modules/sales/services/sales-read-policy.ts`
- `apps/api/src/modules/employee-access/access-sales-bookings.integration.spec.ts`
- `apps/api/src/modules/employee-access/access-sales-boundaries.ts`
- `apps/api/src/modules/employee-access/access-sales-projection.service.ts`
- `apps/api/src/modules/employee-access/access-sales-scope.ts`
- `tools/test-employee-access-sales-bookings.sh`
- This task report (forced-add only; other ignored parent artifacts untouched).


## Review round 1 fix (base 227e56c8a)

Addressed both Important findings in `task-4.1.3.2-review1.md`. The original blanket owner gate was an incorrect restriction, not an authorized Task 6 deferral. `AccessSalesBoundaries` now derives refund execution from the locked persisted Booking (`status === PAID && depositAmount > 0`), after the existing source lock and before execution. Authorized non-owner pending cancellation follows the canonical no-money path, including stock unlock. Actual paid-deposit refunds retain the current-owner restriction. Request-body status/amount cannot override this condition. Current snapshot, scoped primary authority, canonical state constraints and the same actual transaction remain intact.

The previous summary projection checked all readable sales, incorrectly allowing unrelated records to suppress valid sensitive reads. `SalesQueryService.findAll` now associates the summary object with its exact effective, unpaged aggregate predicate through a server-only WeakMap in `access-sales-aggregate-context.ts`. That predicate includes original source tuples, requested branch/date/search/type/payment/salesperson/archive filters and normal completed-sale eligibility. The projector retrieves it by object identity and checks independent cost AND profit authority on every contributing Sale source using the same actual transaction client. It cannot be supplied through HTTP or serialized into the response; absent context fails closed. Retry response objects are attempt-local and weakly held. No SQL formulas, money paths or unmanaged behavior changed.

### Covering evidence on final source

From the worktree root:

- RED: `bash tools/test-employee-access-sales-bookings.sh --testNamePattern=review1` — **2 failed, 13 skipped** before either fix. Pending cancellation expected 201 but received 403; A-only summary expected 4000 but received null. Captured `/tmp/bc-sales-bookings-review1-red.log`.
- Focused GREEN: the same command — **2 passed, 13 skipped**, exit 0. Captured `/tmp/bc-sales-bookings-review1-green.log`.
- Final real isolated PG/HTTP regression: `bash tools/test-employee-access-sales-bookings.sh` — **1 suite, 15/15 tests passed**, exit 0, 9.782 s. Captured `/tmp/bc-sales-bookings-review1-verified-http.log`. Harness owns its isolated PostgreSQL and replaces both DATABASE_URL and DATABASE_URL_FINANCE; no real sends/uploads. Includes final spoofed paid-cancel request fields.

From `apps/api`:

- `node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --runInBand --forceExit --runTestsByPath src/modules/sales/services/sales-query.service.spec.ts src/modules/bookings/__tests__/bookings.service.spec.ts` — **2 suites, 72/72 tests passed**, exit 0, 5.536 s. Captured `/tmp/bc-sales-bookings-review1-units.log`.
- `npx tsc --noEmit` — exit 0, no diagnostics (`/tmp/bc-sales-bookings-review1-types.log`).
- `npx eslint src/modules/employee-access/access-sales-bookings.integration.spec.ts src/modules/employee-access/access-sales-projection.service.ts src/modules/employee-access/access-sales-boundaries.ts src/modules/employee-access/access-sales-aggregate-context.ts src/modules/sales/services/sales-query.service.ts` — exit 0, no diagnostics (`/tmp/bc-sales-bookings-review1-lint.log`).

The new HTTP controls prove non-owner pending cancellation succeeds with unchanged journal/tender counts and restored IN_STOCK product; paid cancellation remains denied even with caller-supplied pending/zero fields, leaves PAID state and creates no OUT tender. Aggregate controls prove A-only sensitive success, mixed A+B denial even when B is outside the returned page, and success when B is excluded by date, sale-number search, sale type or default archive filtering; includeVoided restores mixed-source denial while an explicit A branch filter still succeeds.

Self-review: checked lock-before-state-load ordering and exact canonical refund condition; traced the effective aggregate predicate from all query consumers to projection, including off-page sources and completed-sale eligibility; checked missing-context denial and non-serialized identity transport. `git diff --check` passed. No producer, schema, route count or later-task seam changes; the existing 18-route/parent-56 reconciliation still applies. No unrelated domain reruns. Review's Minor expected failure logs/forceExit and pre-existing stale comments remain recorded observations; clean process teardown is not claimed. Existing JWT/browser/Task 6/FINANCE/party/throughput limits above remain. Root owns scoped independent re-review.
