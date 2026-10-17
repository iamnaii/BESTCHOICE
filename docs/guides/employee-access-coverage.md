# Employee access runtime coverage

Task 3 adds an authenticated boundary and a checked inventory. It does **not** complete domain query scoping, sensitive-data redaction, approval rules or managed realtime delivery. Do not enable real employee migration based on this inventory alone.

Run `node tools/check-access-coverage.mjs` from the repository root. The TypeScript AST scanner inventories actual decorated controller methods across all API source files, HTTP file/export routes, subscribed socket commands and current gateway connection/disconnection/output methods. It checks exact controller/method identity, file, transport and a fingerprint of authentication/route decorators. New, stale, duplicate, re-routed or newly unclassified entrypoints fail the command. It does not infer permissions from HTTP verbs at runtime, silently classify new routes, or prove service/query enforcement.

At Task 3: **1,394 entrypoints in 178 files**: 1,296 staff, 46 public, 31 customer, 11 integration and 10 self-service. All staff entries have catalog capabilities. **1,092 entries require domain integration**. The complete reviewable registry is `apps/api/src/modules/employee-access/access-policy.manifest.json`; every row includes capability, resource requirement, record/collection resolution, company source, original file and transport. Source metadata can declare `@AccessPolicy`, but the checker still requires an inventory entry. When changing a surface, review its policy and recompute its `surface` fingerprint using the same expression in the checker; there is deliberately no auto-accept switch.

## Authentication order and compatibility

`JwtStrategy` loads the persisted staff profile and `AccessSnapshotService.forUser` on every request, with no user/role/access cache. It attaches `user.access` without rewriting `user.role`. Inactive/deleted accounts fail and current snapshot validation also excludes system/nonstaff accounts. Managed company fields are derived from grants; an empty managed grant list remains empty. Login, both refresh-token implementations and `/auth/me` return the snapshot and normalized companies. Managed legacy personal reverse flags are hidden from login and `/me` responses.

`JwtAuthGuard` runs Passport first, then `AccessPolicyService.authorize` before RolesGuard/BranchGuard. The latter accept managed authorization only through a server-owned Symbol marker for the exact controller and method. They never treat a legacy role as a substitute for a managed policy. Global `AccessPolicyInterceptor` is a second boundary after all guards. This avoids the existing Nest ordering trap where global guards see no `req.user`. Global throttling, CSRF and audit remain installed.

An authenticated snapshot with `managed=false` gets `req.accessMode='LEGACY_UNMIGRATED'` and retains existing roles/company/branch handling. Managed accounts get `MANAGED`; missing snapshots, customer principals on staff routes, unclassified routes and unresolved managed resources deny. Persisted owners retain universal capability authority; unmanaged owners stay on the explicit legacy path. Only shared catalog owner-only capabilities are permanently reserved—there are no ad hoc route owner-only exceptions based solely on old `@Roles('OWNER')` declarations.

Public, tokenized customer, LIFF, storefront and provider routes retain their existing independent authentication/bot-defense/throttle checks. The policy classification does not replace those checks. The checker rejects customer classifications with staff-role decorators and public classifications carrying JWT without an explicit Public decorator.

## Task 4 integration API

The global EmployeeAccessModule exports AccessPolicyService, AccessSnapshotService and AccessSocketBoundary. Add an injectable domain registrar (for example an `OnModuleInit` provider in EmployeeAccessModule with Prisma/domain dependencies) that installs functions in `ACCESS_BOUNDARIES`. Both the JWT guard and interceptor consume this shared registry. No production resource resolver is installed by Task 3; missing entries are deliberately closed for managed non-owners.

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
