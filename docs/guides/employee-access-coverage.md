# Employee access runtime coverage

Task 3 adds an authenticated boundary and a checked inventory. It does **not** complete domain query scoping, sensitive-data redaction, approval rules or managed realtime delivery. Do not enable real employee migration based on this inventory alone.

Run `node tools/check-access-coverage.mjs` from the repository root. The TypeScript AST scanner inventories actual decorated controller methods across all API source files, HTTP file/export routes, subscribed socket commands and current gateway connection/disconnection/output methods. It checks exact controller/method identity, file, transport and a fingerprint of authentication/route decorators. New, stale, duplicate, re-routed or newly unclassified entrypoints fail the command. It does not infer permissions from HTTP verbs at runtime, silently classify new routes, or prove service/query enforcement.

At Task 3: **1,394 entrypoints in 178 files**: 1,294 staff, 48 public, 31 customer, 11 integration and 10 self-service. All staff entries have catalog capabilities. **1,092 entries require domain integration**. The complete reviewable registry is `apps/api/src/modules/employee-access/access-policy.manifest.json`; every row includes capability, resource requirement, record/collection resolution, company source, original file and transport. Source metadata can declare `@AccessPolicy`, but the checker still requires an inventory entry. When changing a surface, review its policy and recompute its `surface` fingerprint using the same expression in the checker; there is deliberately no auto-accept switch.

## Authentication order and compatibility

`JwtStrategy` loads the persisted staff profile and `AccessSnapshotService.forUser` on every request, with no user/role/access cache. It attaches `user.access` without rewriting `user.role`. Inactive/deleted accounts fail and current snapshot validation also excludes system/nonstaff accounts. Managed company fields are derived from grants; an empty managed grant list remains empty. Login, both refresh-token implementations and `/auth/me` return the snapshot and normalized companies. Managed legacy personal reverse flags are hidden from login and `/me` responses.

`JwtAuthGuard` runs Passport first, then `AccessPolicyService.authorize` before RolesGuard/BranchGuard. The latter accept managed authorization only through a server-owned Symbol marker for the exact controller and method. They never treat a legacy role as a substitute for a managed policy. Global `AccessPolicyInterceptor` is a second boundary after all guards. This avoids the existing Nest ordering trap where global guards see no `req.user`. Global throttling, CSRF and audit remain installed.

An authenticated snapshot with `managed=false` gets `req.accessMode='LEGACY_UNMIGRATED'` and retains existing roles/company/branch handling. Managed accounts get `MANAGED`; missing snapshots, customer principals on staff routes, unclassified routes and unresolved managed resources deny. Persisted owners retain universal capability authority; unmanaged owners stay on the explicit legacy path. Only shared catalog owner-only capabilities are permanently reserved—there are no ad hoc route owner-only exceptions based solely on old `@Roles('OWNER')` declarations.

Public, tokenized customer, LIFF, storefront and provider routes retain their existing independent authentication/bot-defense/throttle checks. The policy classification does not replace those checks. The checker rejects customer classifications with staff-role decorators and public classifications carrying JWT without an explicit Public decorator. It also rejects the inverse mismatch: an explicit Public endpoint classified as staff/self-service.

## Task 4 integration API

The global EmployeeAccessModule exports AccessPolicyService, AccessSnapshotService and AccessSocketBoundary. Add an injectable domain registrar (for example an `OnModuleInit` provider in EmployeeAccessModule with Prisma/domain dependencies) that installs functions in `ACCESS_BOUNDARIES`. Both the JWT guard and interceptor consume this shared registry. Task 3 installed no production resource resolvers. Task 4.1.1 now installs the 49 explicit product/QC adapters listed below; other missing entries remain deliberately closed for managed non-owners.

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

Remaining named SHOP units: 4.1.2 procurement/inventory (63 rows); 4.1.3 sales/bookings/trade-in (56); 4.1.4 after-sales/repair-tickets (39); 4.1.5 customers/contacts/customer-journey (31); 4.1.6 residual SHOP manifest sweep. These 189 named rows plus residual SHOP, FINANCE/accounting, operational/realtime domains, audit and approval work remain pending. Umbrella Task 4.1 and Task 4 are not complete. Full local/browser verification is reserved by the root agent for the integrated Task 8 handoff.
