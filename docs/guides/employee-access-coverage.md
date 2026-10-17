# Employee access runtime coverage

Task 3 adds an authenticated boundary and a checked inventory. It does **not** complete domain query scoping, sensitive-data redaction, approval rules or managed realtime delivery. Do not enable real employee migration based on this inventory alone.

Run `node tools/check-access-coverage.mjs` from the repository root. The TypeScript AST scanner inventories actual decorated controller methods across all API source files, HTTP file/export routes, subscribed socket commands and current gateway connection/disconnection/output methods. It checks exact controller/method identity, file, transport and a fingerprint of authentication/route decorators. New, stale, duplicate, re-routed or newly unclassified entrypoints fail the command. It does not infer permissions from HTTP verbs at runtime, silently classify new routes, or prove service/query enforcement.

At Task 3: **1,394 entrypoints in 178 files**: 1,294 staff, 48 public, 31 customer, 11 integration and 10 self-service. All staff entries have catalog capabilities. **1,092 entries require domain integration**. The complete reviewable registry is `apps/api/src/modules/employee-access/access-policy.manifest.json`; every row includes capability, resource requirement, record/collection resolution, company source, original file and transport. Source metadata can declare `@AccessPolicy`, but the checker still requires an inventory entry. When changing a surface, review its policy and recompute its `surface` fingerprint using the same expression in the checker; there is deliberately no auto-accept switch.

## Current implementation checkpoint

The sections below record contracts as their units were introduced; this checkpoint supersedes historical remaining-work counts. Through the independently reviewed after-sales exchange action unit (`1301fc9da`), **203 SHOP domain adapters** have actual authorized-success and denial evidence:

| Reviewed unit | Adapters | Final implementation commit |
| --- | ---: | --- |
| Products / QC | 49 | `3cb9ca826` |
| Procurement / suppliers | 32 | `90fb3b5f3` |
| Inventory / approved receiving lookup | 22 | `4f7e6767c` |
| Stock adjustments | 10 | `b7920d6ad` |
| Trade-in | 38 | `7bbd1e957` |
| Sales / bookings | 18 | `595c5c26f` |
| Repair / warranty | 15 | `7fb1c9df6` |
| After-sales reads | 6 | `0533afd3e` |
| After-sales repair/photo actions | 6 | `77412da46` |
| After-sales exchange actions | 7 | `1301fc9da` |

Reviewed exchange source/transaction and customer-quote provenance producers add **zero exposed routes** by themselves. After-sales still needs one intake/create operation and four document/photo streams. Shared customer/contact/journey 31, residual SHOP 39, FINANCE 544, operations 267 and audit 4 domain allocations remain, plus the separately inventoried 202 staff routes without domain resource classification. These 202 include privileged settings/provisioning and ordinary reads; classification does not establish their appropriate current capability/source boundary. Seven employee-access owner-management routes were reviewed in Task 2, separately from the 203 SHOP count.

The receiving lookup increased the inventory to **1,395 classified HTTP/socket entrypoints**, including 1,093 domain rows. The scanner does not enumerate Cron/queue/bootstrap methods; those require their own source, system/initiator, current employee authority, recipient and durable-evidence reconciliation. Existing actor-fixture HTTP tests do not establish actual JWT/guard/browser integration. Full audit, immutable approvals, UI, whole-program coverage/performance and final local:check/verified preview remain pending. No real account migration is authorized by this checkpoint.

After-sales managed views use exact-transaction source facts and nullable independently authorized children. `stageVerified:false` means stored case metadata; current-stage age/staleness values are unavailable and summaries expose `currentStageUnavailable`. Raw internal getCase is not a public/renderer authorization contract. Authorized exchange tier/approverRole metadata remains compatible; action execution must independently check current capabilities. The final focused read suite records 24/24 real PostgreSQL/HTTP tests plus 267 covering regressions from the implementation run; independent review closed the metadata compatibility finding.

The six repair/photo actions use a separate exact-action internal loader and retain narrow `{id,stage}` or `{photoCount,stage}` acknowledgements without granting general case reads. Five lifecycle operations require after-sales.update; addPhoto uses after-sales.create. Actual canonical repair/financial drafts, case/status and existing durable evidence share the owned outer transaction. Photo staging occurs once outside its lock, reauthorizes on write and cleans only newly owned failed keys; LINE effects run after the actual commit. The owned-PG suite passed 23/23 and affected regressions 207/207; final actual guards/browser remain pending. Future SALES/BM template repair.read/create/update dependencies were separately reviewed at `a7f64c4d1`; saved positions are unchanged.

The seven exchange actions require current after-sales.update plus each actual canonical child source/action. They return only `{id,stage}`, join real financial/repair/case/audit writes, and notify only after outer commit. Physical delivery uses narrow warranty/current Product reads; financial approval and reversal remain independently authorized. Applied/finalized cancellation remains current-owner-reserved, while true no-money draft cancellation follows canonical update authority. The actual owned-PG suite passed 22/22 with final focused refresh, rollback/concurrency/current-wait controls and combined 278 affected regressions. A shared COMPANY origin predicate was corrected with positive and empty/foreign/assigned negative controls. Historical pre-change RED evidence is narrower than all-seven final GREEN coverage and is recorded as a review limitation; actual activation/direct FINANCE adapters remain pending.

Intake/create now has a concrete implementation pending independent review (Task4.1.4.2.2.3.4); it is not yet added to the reviewed count above. The actual destination needs after-sales.create, while canonical repair/exchange actions and historical Sale/warranty Contract/customer/current Product reads stay independent. Internal business lookup chooses actual latest history before authorization and never converts a hidden source into WALK_IN. Pending same-model and priced submissions may use create authority past the window; execution still requires separate approval. Prepared files are authorized/validated before storage, staged once outside the authority lock, then reauthorized and fingerprint-checked in the actual retryable creation transaction. Case, canonical child, request link and required durable evidence commit together; success returns only `{id,stage}` and LINE runs after actual commit.

The narrow exported `authorizeChatServiceRequest` contract requires `chat.update` only in the actual live room company at each proven source origin branch, or via a genuine live request Todo assignment. Referenced resources independently require their own actual-company read/action capabilities; their company does not add a chat permission requirement. Unanchored requests require COMPANY or unrestricted ASSIGNED; creator, staff branch, room assignment, aliases and prospective case do not grant request authority. All fourteen mutation registrations (six repair/photo, seven exchange, one intake) now have focused actual HTTP evidence across their reports. Four document/photo streams, direct FINANCE/activation, broad chat adapters, audit5, approvals6, UI7 and full guards/browser/local preview8 remain separate. The shared Serializable authority fence now also locks soft-retired assignment versions before reading snapshots; branch junctions remain immutable under their assignment version.


## Authentication order and compatibility

`JwtStrategy` loads the persisted staff profile and `AccessSnapshotService.forUser` on every request, with no user/role/access cache. It attaches `user.access` without rewriting `user.role`. Inactive/deleted accounts fail and current snapshot validation also excludes system/nonstaff accounts. Managed company fields are derived from grants; an empty managed grant list remains empty. Login, both refresh-token implementations and `/auth/me` return the snapshot and normalized companies. Managed legacy personal reverse flags are hidden from login and `/me` responses.

`JwtAuthGuard` runs Passport first, then `AccessPolicyService.authorize` before RolesGuard/BranchGuard. The latter accept managed authorization only through a server-owned Symbol marker for the exact controller and method. They never treat a legacy role as a substitute for a managed policy. Global `AccessPolicyInterceptor` is a second boundary after all guards. This avoids the existing Nest ordering trap where global guards see no `req.user`. Global throttling, CSRF and audit remain installed.

An authenticated snapshot with `managed=false` gets `req.accessMode='LEGACY_UNMIGRATED'` and retains existing roles/company/branch handling. Managed accounts get `MANAGED`; missing snapshots, customer principals on staff routes, unclassified routes and unresolved managed resources deny. Persisted owners retain universal capability authority; unmanaged owners stay on the explicit legacy path. Only shared catalog owner-only capabilities are permanently reserved—there are no ad hoc route owner-only exceptions based solely on old `@Roles('OWNER')` declarations.

Public, tokenized customer, LIFF, storefront and provider routes retain their existing independent authentication/bot-defense/throttle checks. The policy classification does not replace those checks. The checker rejects customer classifications with staff-role decorators and public classifications carrying JWT without an explicit Public decorator. It also rejects the inverse mismatch: an explicit Public endpoint classified as staff/self-service.

## Task 4 integration API

The global EmployeeAccessModule exports AccessPolicyService, AccessSnapshotService and AccessSocketBoundary. Add an injectable domain registrar (for example an `OnModuleInit` provider in EmployeeAccessModule with Prisma/domain dependencies) that installs functions in `ACCESS_BOUNDARIES`. Both the JWT guard and interceptor consume this shared registry. Task 3 installed no production resource resolvers. The current implementation checkpoint above lists reviewed adapters; other missing entries remain deliberately closed for managed non-owners.

```ts
ACCESS_BOUNDARIES.set('ProductsController.findOne', async request => {
  const product = await prisma.product.findUnique(/* validated ID */);
  // Resolve source company, branch and assigned staff from persisted relationships.
  return { kind: 'resource', resource: resourceFromProduct(product) };
});
```

Record policies accept only `kind:'resource'`. `assertAccess(user, permission, resource)` evaluates the exact permission/company/branch/assignment tuple; record context must come from persisted records, never caller-supplied ownership/branch claims. Missing source context denies. Multi-source operations must check every source/destination, not just one representative record. Mutations must also use `AccessSnapshotService.forUserInTransaction` or `assertInTransaction` and applicable privilege locks/business checks inside their write transaction; a pre-handler snapshot is not a financial approval or race-proof write authorization.

Collection policies accept only `kind:'collection'`:

```ts
ACCESS_BOUNDARIES.set('ProductsController.findAll', async request => ({
  kind: 'collection',
  company: resolveAndValidateCompany(request),
  execute: async scope => {
    const filters = await validateProductFilters(request.query);
    const where = productPredicateFromTuples(scope, filters);
    // The same constrained predicate must drive rows, totals and aggregates.
    const rows = await prisma.product.findMany({ where, ...pagination(filters) });
    return redactProductRows(rows, request.user, scope);
  },
}));
```

These names illustrate domain functions Task 4 must implement; they are not supplied implementations. `CollectionScope` contains `{userId, company, permission, tuples:[{scope,branchIds,userId}]}`. `permissionScopes(user, permission, company)` returns the original capability-specific scopes, including ASSIGNED ownership. Never union permissions then branches. Never interpret `[]` as “no filter”. COMPANY is explicitly company-bound. FINANCE branch IDs are originating/related SHOP branches and **do not** change the tuple company to SHOP. ASSIGNED requires the current user in the domain's persisted assignment relation, with optional branch restriction.

The collection executor replaces the original unscoped controller handler; a single returned branch resource cannot unlock a collection. It must validate raw route/query/body input, apply OR scope predicates **before** pagination/count/aggregate/search/export, redact every nested/sensitive result, and preserve response status/content headers/file semantics. It executes from the policy interceptor, so controller parameter pipes and downstream interceptors are not a substitute for this validation. There is no readiness boolean. Registration alone cannot make the old collection handler run.

`activity.read` may obtain a company-wide safe-summary scope even without position grants, matching the shared evaluator. Task 5 must provide the safe summary implementation; this never authorizes raw audit payloads or source details.

## Realtime boundary and remaining adapters

`StaffChatGateway` and `EventsGateway` independently verify signed staff JWTs and reject customer/other audiences. `AccessSocketBoundary.allowLegacy` loads current snapshots and persisted role/branch, checks token expiry, and disconnects managed/disabled/deleted identities or changed legacy role/branch subscriptions. Every staff chat command rechecks. Every gateway outgoing room delivery fetches recipients and rechecks each before emitting; a user changed from legacy to managed does not retain access through an old subscription. Public WebWidgetGateway remains independent.

**Managed sockets, including managed owners, currently disconnect.** Task 4 must supply permission/resource authorization for connect and seven staff commands (join, leave, send, typing start/stop, read, view), and recipient-specific authorization/redaction for room messages, inbox room updates, send failures, notes, personal staff events, viewers/presence, typing and collisions. EventsGateway requires source checks for user/role/branch/all delivery, payment data and dashboard invalidations. A subscription check at connect is insufficient: revalidate each recipient's current grants on outgoing delivery and revoke stale subscriptions. Room membership alone never proves permission. Existing legacy message broadcasts retain their old audience while their current account/subscription identity is rechecked.

## Other unfinished domain work

Task 4 must integrate all domain rows, including aggregate/export/download/signed-URL paths, costs/profits/salary redaction, customer cross-domain relationships, source/destination transfers and staff actions which launch background jobs. Existing role checks in services must be replaced or explicitly retained as independent business invariants; changing a guard does not remove a service veto. Legacy per-user accounting/payment/reversal readers and writers must not authorize or reintroduce grants for managed users. New staff account creation must initialize managed/no grants rather than silently opting into the legacy path.

Task 5 must wire `AccessPolicyService.onDenied(event)` to safe durable capture. The current hook receives only `{userId,route,permission,reason}`; it does not contain body/query/token/PII. Capture errors cannot turn a denial into success. The hook is tested but is not yet a production audit sink. Tasks 5/6 must finish safe activity data, approval snapshots, maker-checker, idempotent refunds and transactional audit.

HTTP authorization tests use a real Nest server and signed JWTs with mocked current profile/snapshot storage. They demonstrate ordering and bypass/revocation behavior, not full database-backed domain enforcement. The existing isolated PostgreSQL persistence suite validates snapshots, privilege changes and atomicity. Full `local:check`, browser/UI behavior and end-to-end integrated domain verification remain final integration work.


## Task 4.1.1 implemented unit — products and quality control

The explicit `SHOP_PRODUCT_BOUNDARY_ROUTES` allowlist in `access-shop-boundaries.ts` enables **49** real adapters: ProductsController (31), InspectionsController (14), ProductPhotosController (4). New methods never inherit a generic adapter merely because their controller is in this unit. The isolated real Nest HTTP/PostgreSQL suite captures successful executions for all 49 and replays each against a persisted managed/no-grants principal expecting 403. The inventory checker still counts 1,092 domain requirements; **49 are implemented here and 1,043 remain outside this unit**. The checker itself proves classification, not runtime enforcement.

Products use persisted legal ownership, falling back to the active branch's company only when ownership is null, matching the schema's legacy default. Unknown company/ownership denies. FINANCE-owned devices at SHOP-origin branches remain FINANCE. Products have no employee assignment relation, so ASSIGNED product scopes contribute no rows. Tuple predicates apply before Prisma rows/counts/aggregates and grouped/accessory SQL. Source/destination transfer stages resolve persisted endpoints. Managed owners also use current transaction authorization and requested-company filtering on these adapters; unmanaged principals retain the explicit migration path.

Record decisions may attach an execution wrapper preserving the original Nest pipes. A separate `reference` decision admits only safe template definition reads; it does not turn templates into branch-owned cases. `selection` handles an exact empty bulk selection with a mandatory executor and pinned empty product IDs. Collections retain mandatory replacement executors with explicit DTO/filter validation. See the phase report for the typed transaction/client contracts.

New `products.cost.update` is separate from `sensitive.cost.read` and from the primary create/update capability. Purchasing defaults include this new write key; existing saved positions are unchanged. Price-row add/update/remove use `pricing.update` as primary authority; they do not require product create/delete. Generic product DTO price writes retain the primary product action plus `pricing.update`. Cost/profit reads remain source-scoped and configurable; aggregate values and cost ordering require coverage of all contributing source scopes. Product contract/booking/receiving detail expansion stays suppressed for managed non-owners pending the corresponding source adapters; permitted PO metadata uses all linked source products. Customer.salary is untouched.

Inspection definitions are safe shared reference data: historical null-origin templates remain readable before first use, without case results or unscoped inspection counts. New managed templates persist nullable `accessCompanyCode` from authenticated execution, not request body. No historical backfill. Applying a company-owned template requires the product's persisted company to match. Editing historical global definitions requires current permission-specific COMPANY authority in both SHOP and FINANCE; a single related case never authorizes the shared edit.

At the original Task 4.1.1 checkpoint, the later SHOP/domain units were pending. See Current implementation checkpoint for the reviewed counts and remaining work. Umbrella Task 4.1 and Task 4 remain incomplete; full local/browser verification belongs to the integrated Task 8 handoff.

Review fix 1: stock list/dashboard require independent `inventory.read`, while product details retain `products.read`. Inspection history and template counts use stable `Inspection.productId` through `sourceProduct` plus all additional linked products, including owner company filtering. The additive NOT VALID FK retains unresolved legacy source IDs without rewriting data; those rows fail closed. Typed collection controller arguments and generated model predicate types tighten the adapter contract. See the phase report for isolated migration/history evidence and the remaining fixture uncertainty.

## Task 4.1.2.2 — inventory and approved receiving selector

The four inventory controllers now have 22 managed boundaries (21 existing routes and the new `GET /branch-receiving/approved-purchase-orders`). `reorder-points/check-stock` requires `reorder-points.update`; its exact target set and stock aggregates use that capability's original company/branch tuples. Counts and alerts use persisted branch provenance, count items recheck current product ownership, and forecast Sale inputs use their own persisted SHOP branch/salesperson independently of current Product ownership. Transfer history is readable from either authorized endpoint; receiving mutates only at the authorized destination.

Task 7 can populate its STOCK receiving selector with `GET /branch-receiving/approved-purchase-orders?company=SHOP&branchId=<actual-warehouse-id>&page=1&limit=50`. `branchId` is optional but, when present, must equal the active main warehouse/fallback selected by the receiving workflow. The result is `{destination:{id,name},data:[{id,poNumber,status,items:[{id,brand,model,color,storage,category,accessoryType,accessoryBrand,quantity,receivedQty,remainingQty}]}],total,page,limit}`. Only approved/order/partially received SHOP POs with outstanding live items appear, using the reviewed actual PO-source predicate before paging/counts. No PO-read or cost capability is required; no supplier/payment/document-history or monetary fields are included. Submit the chosen PO/item identifiers through the existing approved goods-receiving endpoint, which rechecks destination, current state and quantities in its owning transaction. This lookup grants no general PO-history access.

The adapter reuses the current-snapshot transaction engine, source resolver, scoped client and cost projector. Nested count/receive transactions join the Serializable outer transaction. Internal stock-count numbering uses a bound, locked global numeric maximum, including soft-deleted reserved numbers; user-visible counts remain scoped. Reorder notifications are registered after commit; aborted attempts send none. Notification failure has the existing non-durable effect-hook limitation.

`tools/test-employee-access-inventory.sh` owns an isolated PostgreSQL cluster and runs actual HTTP/services with synthetic data. The unit report records route-by-route evidence and limitations. Whole-program authorization, root `local:check`, browser integration, later domain integrations and Task 7 UI remain separate work.

## Task 4.1.2.3 — stock adjustments

`AccessAdjustmentsBoundaries` registers all ten existing StockAdjustmentsController routes. Current persisted authority is reloaded inside the shared Serializable execution; approval/rejection retain the explicit owner-only policy. Cancellation additionally requires the requester or current owner. No role is substituted. Original request branch and actual current Product company/location must both be permitted; ownership uses `Product.ownedBy` before branch company. ASSIGNED grants do not imply requester ownership. Collections apply explicit adjustment/product predicates before paging, counts and totals. The narrow `adjustmentProduct` resolver supports historical evidence and FOUND soft-delete recovery without changing ordinary product resolution.

The `adjustments` execution domain joins existing service callback transactions to the outer client. Internal numbering and booked-inventory evidence remain unfiltered; these internal reads run only inside an authorized source transaction. User-facing collections and expansions have explicit predicates/projections. Request, product, journal, Todo and existing hash-chain AuditLog writes commit or roll back together. Warnings run after the real outer commit and are discarded on retry/rollback. Global SA numbering includes deleted reservations. No new financial formula, schema, catalog default or backfill was introduced.

The shared upload preparation seam now optionally performs a current source check after multipart parsing and before staging. Adjustment evidence is staged once outside the authority lock, retained through retries, and cleaned only on terminal failure. Existing six-file, 5MB, JPEG/PNG/WebP and required DAMAGED photo rules remain. `documents.read` on original/current source is required before signing links, as well as before returning photo keys/URLs. Storage and warnings are mocked in the isolated HTTP harness.

Task 7 should retain the existing DTOs and company query/header selection. Cost fields require configurable `sensitive.cost.read`; nested product details independently require `products.read`. Summary amounts are null unless every contributing source permits cost. Journal identifiers/notes require independent `journal.read` on the actual stamped journal company/branch, and original FOUND amounts require cost authority on the original adjustment/journal source. Missing historical journal branch is company-only, never inferred from the product's current branch. GR identifiers are omitted here; receipt navigation belongs to the separately authorized procurement route. The lookup is a nonmonetary adjustment product selector unless cost is independently permitted. Hidden photo arrays are empty; hidden nested products and monetary/reference fields are null, and hidden journal lines are empty.

The SHOP accounting workflow does not support FINANCE-owned LOST/WRITE_OFF, including zero/unbooked cases: even its non-JE path would persist SHOP account classification and accounting instructions. Request, preview and approval reject this with a nonmonetary business error. Source-authorized reads, cancel/reject recovery, DAMAGED, CORRECTION/OTHER and genuinely nonposting FOUND recovery remain valid; FOUND preserves sold/installment/repossessed states. A financial FOUND reversal requires compatible current SHOP ownership plus the original SHOP journal's product/adjustment provenance. No FINANCE accounting policy is invented.

Route reconciliation: original procurement/inventory parent **63 = procurement/suppliers 32 + inventory 21 + adjustments 10**. The safe receiving lookup adds one, giving **64 = 32 + 22 + 10**, with no new adjustment route. These boundaries plus the prior product/QC 49 total 113 implemented adapters in those units. This is not whole-program authorization completion; independent review, other domain units, Task 5 activity, Task 7 UI and root Task 8 integrated preview/checks remain separate. `tools/test-employee-access-adjustments.sh` owns an isolated PG16 cluster and tests real HTTP/services, with a test identity and legacy role/branch guards overridden; it does not prove full-guard/browser behavior.
