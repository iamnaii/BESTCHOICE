# Task 4.1.1 — scope foundation, products and quality control

Status: implemented unit, awaiting root review. Base `cf00921ab`. No production DB/network mutation, migration, push, merge or deploy. No subagents. Umbrella 4.1 remains incomplete. Root explicitly owns `npm run local:check` and the verified same-checkout preview at the integrated Task 8 handoff; this unit did not start or stop any preview processes.

## Changes and decisions

- Added tuple-preserving query predicates, persisted product/branch resolvers, source-aware cost/profit projection, a domain-only transaction client adapter, and an explicit 49-route registrar. No readiness marker, representative-branch collection authorization or post-pagination filtering.
- Existing controllers/services still execute their workflow logic. Record wrappers keep original Nest pipes/interceptors and default HTTP statuses. Collection executors validate pagination/sort/group/filter/status/category/date input explicitly and invoke existing handlers. Photo routes retain JSON/base64 behavior; this unit has no PDF/stream route. Gallery storage is called only after current authorization inside the surrounding operation; the existing external upload remains outside database rollback semantics.
- Product company comes from active `ownedBy`, or active `branch.company` only when `ownedByCompanyId` is null (documented legacy default in schema). Explicit FINANCE ownership overrides SHOP-origin branch company. Missing/inactive company or branch denies. Product ASSIGNED has no genuine assignment relation and therefore cannot authorize products.
- Transfer creation requires current source and destination authority. Dispatch uses persisted source; confirm/reject uses persisted destination. Record transfer reads allow an authorized actual endpoint; nested product cost remains checked against the product's current source. Product workflow transfer history has its own endpoint predicate.
- New `products.cost.update` is required with the primary create/update capability when `costPrice` is supplied. Its purchasing default does not auto-update existing persisted positions. Cost read never implies cost write. Price-row add/update/remove use `pricing.update` as their primary authority, without requiring product creation/deletion authority. Generic product create/update retain their own primary capability plus `pricing.update` for price fields. QC/status paths do not write purchase cost. Future procurement/sales adapters must carry these distinct write semantics into their own transactions rather than infer write from sensitive read.
- Templates are safe reference definitions, not case data. Historical null-origin templates remain readable before first use, with independently scoped inspection counts. Historical shared edits require explicit COMPANY grants for the action in **both** companies; a linked case is insufficient. New managed templates carry authenticated company origin and cannot be applied to a product of another company. Inspection result item IDs must belong to the inspection's template, preventing cross-template substitution.

## Additive schema

`InspectionTemplate.accessCompanyCode: String?` references `CompanyInfo.companyCode`, with an index and Restrict FK. Inverse `CompanyInfo.inspectionTemplates` relation. Migration `20261024000000_inspection_template_access_origin` adds only nullable column/FK/index; no defaults/backfill/updates of historical data. New managed template creates write origin from execution context. Unmanaged creates remain null/global under the explicit old path. Prisma generated locally; migration applied only by the isolated harness.

## Typed exported contracts for later units

### Query predicates

- `ScopePredicates<W> = { company(company: Company): W | null; branch(ids: readonly string[]): W; assigned?(userId: string): W }`.
- `scopeWhere<W>(scope: CollectionScope, source: ScopePredicates<W>): { AND: [W, { OR: unknown[] }] }`. Requires nonempty source company predicate, then ORs complete original tuples. BRANCHES empty and missing ASSIGNED semantics contribute nothing. ASSIGNED keeps its identity and optional branch restriction in the same alternative. COMPANY uses a real company predicate, **not `{}`**, because Prisma drops empty OR objects.
- `productCompanyWhere(company): Prisma.ProductWhereInput`, `productScopeWhere(scope): Prisma.ProductWhereInput` implement the concrete product provenance above.
- `productScopeSql(scope, alias?: 'p'|'p2'): Prisma.Sql` implements the same product semantics for SQL. Runtime alias whitelist; values bound. `inspectionTemplateScopeWhere(scope): Prisma.InspectionTemplateWhereInput` is only the safe-definition reference predicate.
- `transferScopeWhere(scope): Prisma.StockTransferWhereInput` combines actual product company with the OR of actual transfer endpoints. It is not an authorization rule for transfer writes; resolver stages supply those.

### Resource execution

- `ResolvedAccessResources = { company: Company; resources: readonly AccessResource[]; productIds: readonly string[]; reference?: 'INSPECTION_TEMPLATE'; emptySelection?: true }`.
- `PersistedAccessResolver = (tx: AccessClient, snapshot: AccessSnapshot, lock: boolean) => Promise<ResolvedAccessResources>`.
- Injectable/exported `AccessResourceService.product(tx,id,lock?)`, `.branch(tx,id,lock?)`, `.assert(snapshot,permission,resolved)`, `.preflight(snapshot,permission,resolver)` and `.execute<T>(userId,permission,company,resolver|undefined,handler,scopeReads=true): Promise<{result:T;snapshot:AccessSnapshot;resolved?:ResolvedAccessResources}>`.
- `execute` owns one interactive PostgreSQL transaction. It acquires Task 2's access advisory lock, reloads active persisted staff/current assignments (including managed owners), resolves/locks sources and asserts again before handler execution. Product rows lock in sorted ID order; transfer/inspection/template parent row is locked first when applicable. Product branch/company provenance and destination branch/company rows use shared locks to prevent provenance changing under a mutation. Unmanaged transition during a managed execution rejects rather than falling back.
- `.scopedProductIds(...)` is a **product bulk-visibility-specific bounded selector**, currently using the existing Apple/phone/in-stock/MAX2000 domain criteria and sorted IDs; it is not a generic selector for other modules.
- `emptySelection` is accepted only with zero resources/IDs, a real current permission scope and `scopeReads=true`. The client is pinned to `id in []`, so a zero-result bulk request cannot call an unscoped mutator. Nonempty bulk target IDs are pinned too, preventing a limit/order mismatch between lock selection and service execution.

### Runtime decisions and service transaction facade

- Existing `AccessDecision.resource` now optionally carries `execute(handler:()=>Promise<unknown>):Promise<unknown>`. `ACCESS_RESOURCE_EXECUTE` is a server-only symbol; interceptor wraps `lastValueFrom(next.handle())`, preserving original argument pipes and default response behavior.
- Added mandatory-executor `kind:'reference'` for safe definition-only record data and `kind:'selection'` for the exact empty target-set case. Both have `company` and an execution wrapper and require an actual permission-specific tuple. They are not valid for collection policies. Collections still require `kind:'collection'` and replace the handler entirely.
- `DomainAccessExecution = { snapshot; scope: CollectionScope; client: Prisma.TransactionClient; scopeReads:boolean; authorizedProductIds?: readonly string[] }`, `domainAccessExecution: AsyncLocalStorage<DomainAccessExecution>`, `currentDomainAccess()`.
- `domainAccessClient(base: PrismaService): PrismaService` is used only by the explicitly changed product/QC services, via their local getter. It does **not** patch the global Prisma provider. Outside context, it returns the original client, preserving unmanaged/internal legacy behavior. Inside context it routes to the owned transaction.
- Nested `$transaction(async tx => ...)` callbacks join the same outer transaction through this facade; inner options do not establish a separate transaction/isolation/commit boundary. **Array `$transaction([...])` is deliberately rejected**; future consumers must use interactive propagation. The tests prove a real nested pricing write rolls back when the outer execution fails.
- With `scopeReads=true`, reviewed delegate predicates cover `product`, `stockTransfer`, `inspection`, `inspectionTemplate`, `branch`, `purchaseOrder`, `supplier`. Query operation allowlist: `findMany`, `findFirst`, `findUnique`, `findUniqueOrThrow`, `findFirstOrThrow`, `count`, `aggregate`, `groupBy`. Existing AND arrays are flattened correctly. Purchase metrics also require `purchase-orders.read` and all linked products/receiving items to have resolvable authorized sources.
- Write operations are **not** generically rewritten. Record execution uses `scopeReads=false` after all affected sources have been checked/locked, so internal business invariants and destination moves are not broken by a read filter. Bulk visibility uses scoped reads plus pinned exact IDs. Do not use this record mode for a collection or unknown target set.
- Unknown delegates are **not automatically protected** by this product adapter. They are existing internal workflow queries, not a reusable global permission engine. New domain adapters must explicitly define predicates/resolvers and independent nested output rules. Raw SQL is **never automatically rewritten**: `currentProductScopeSql(alias?)` is inserted into grouped-stock base queries, group lookup and both outer/last-cost accessory queries before grouping/count/paging. New raw SQL must add its own reviewed predicate.
- Managed owners go through registered wrappers and fresh transaction checks, and collection company filters. The prior trusted-owner bypass remains only for other, not-yet-integrated routes. Unmanaged actors remain on the explicit legacy path.

### Projection and downstream extension seams

- Injectable/exported `AccessSensitiveService.permitsProductAggregate(permission, filter?: Prisma.ProductWhereInput): Promise<boolean>` and `.projectProductResult<T>(input:T, source?:AccessResource):Promise<T>`.
- Concrete `PRODUCT_COST_FIELDS` / `PRODUCT_PROFIT_FIELDS` classify current product/QC output. Per-product and nested stock-group fields use persisted source, not role. Purchasing can read scoped costs with legacy SALES role. Missing sensitive tuples explicitly deny even on empty aggregates. Aggregate values are conservatively hidden when any contributing read scope is not sensitive-authorized; explicit branch cost sorting checks that filtered branch. Hidden value sorting is removed from stock status summaries. This may hide more aggregate detail than a future per-group projector, never less.
- Internal calculations keep full cost; projection runs only after domain execution, within its transaction. No cost is returned just because legacy `canSeeCost(role)` allowed it. Customer.salary is not classified as employee payroll.
- Product `activeContract`, `lockedByBookings` and `receivingItem` detail expansions remain null/empty for managed non-owners until their owning source adapters are supplied by later units. PO metadata is permitted only when every linked product authorizes `purchase-orders.read`; otherwise null. Product workflow PO descriptions use the same independent procurement source check. This is a documented pending source-expansion seam, not whole-program nested FINANCE/customer completion.
- Template reference outputs include definitions/items, never inspection results or linked source products. Their inspection counts are scoped independently. New consumers must not reuse `reference` for case rows, customer identities, money, files or unscoped counts.

## Enabled rows (49)

| Boundary | Primary capability | Policy resolution |
|---|---|---|
| `InspectionsController.addTemplateItem` | `inspections.create` | record |
| `InspectionsController.completeInspection` | `inspections.update` | record |
| `InspectionsController.createInspection` | `inspections.create` | record |
| `InspectionsController.createTemplate` | `inspections.create` | record |
| `InspectionsController.deleteTemplate` | `inspections.update` | record |
| `InspectionsController.deleteTemplateItem` | `inspections.update` | record |
| `InspectionsController.findAllInspections` | `inspections.read` | collection |
| `InspectionsController.findAllTemplates` | `inspections.read` | collection |
| `InspectionsController.findOneInspection` | `inspections.read` | record |
| `InspectionsController.findOneTemplate` | `inspections.read` | record |
| `InspectionsController.overrideGrade` | `inspections.update` | record |
| `InspectionsController.updateInspection` | `inspections.update` | record |
| `InspectionsController.updateTemplate` | `inspections.update` | record |
| `InspectionsController.updateTemplateItem` | `inspections.update` | record |
| `ProductPhotosController.completePhotos` | `product-photos.update` | record |
| `ProductPhotosController.deletePhoto` | `product-photos.delete` | record |
| `ProductPhotosController.getPhotos` | `product-photos.read` | collection |
| `ProductPhotosController.uploadPhoto` | `product-photos.create` | record |
| `ProductsController.addPrice` | `pricing.update` | record |
| `ProductsController.bulkOnlineVisibility` | `products.update` | record |
| `ProductsController.bulkTransfer` | `stock-transfers.create` | record |
| `ProductsController.confirmTransfer` | `stock-transfers.receive` | record |
| `ProductsController.create` | `products.create` | record |
| `ProductsController.dispatchTransfer` | `stock-transfers.update` | record |
| `ProductsController.findAccessorySkus` | `products.read` | collection |
| `ProductsController.findAll` | `products.read` | collection |
| `ProductsController.findOne` | `products.read` | record |
| `ProductsController.getBrands` | `products.read` | collection |
| `ProductsController.getInTransitTransfers` | `products.read` | collection |
| `ProductsController.getPendingTransfers` | `products.read` | collection |
| `ProductsController.getReadiness` | `products.read` | record |
| `ProductsController.getStock` | `products.read` | collection |
| `ProductsController.getStockDashboard` | `products.read` | collection |
| `ProductsController.getSupplierPerformance` | `products.read` | collection |
| `ProductsController.getTransferById` | `products.read` | record |
| `ProductsController.getTransferHistory` | `products.read` | collection |
| `ProductsController.getWarrantyExpiring` | `products.read` | collection |
| `ProductsController.getWorkflowStatus` | `products.read` | record |
| `ProductsController.promoteListingPhoto` | `products.update` | record |
| `ProductsController.rejectTransfer` | `stock-transfers.approve` | record |
| `ProductsController.remove` | `products.delete` | record |
| `ProductsController.removePrice` | `pricing.update` | record |
| `ProductsController.reserve` | `products.update` | record |
| `ProductsController.returnToStock` | `products.update` | record |
| `ProductsController.transfer` | `stock-transfers.create` | record |
| `ProductsController.unreserve` | `products.update` | record |
| `ProductsController.update` | `products.update` | record |
| `ProductsController.updateOnlineListing` | `products.update` | record |
| `ProductsController.updatePrice` | `pricing.update` | record |

## RED / GREEN and isolation evidence

1. Query-scope spec first run: RED TS2307 for missing `access-query-scope`; after implementation GREEN 4 tests. Covers original tuple/ASSIGNED identity, missing ownership semantics, empty branches and concrete product company.
2. First isolated HTTP run after fixture compile fix: **2 failed / 12 passed**. Hidden `costPrice` write returned 200 instead of 403; bracketed unsupported query key returned 200 instead of 400. Added distinct cost-write gate and explicit filter-shape validation; GREEN.
3. Expanded real DB controls: **2 failed / 21 passed**. Explicit COMPANY query omitted C because Prisma discarded `{}` in OR; absent profit grant returned aggregate profit values. Replaced COMPANY alternative with actual company predicate and explicit no-sensitive-tuple denial; GREEN.
4. Pricing-only positive control was RED (**1 failed / 30 passed**): adding a price returned 403 despite scoped `pricing.update`. Corrected the three price-row manifest policies; positive control covers add/update/remove without product create/delete, denies out-of-scope price changes and unrelated product creation/deletion. Final `tools/test-employee-access-shop.sh`: **31 tests** in a real Nest HTTP fixture and real migrated PostgreSQL 16. Successful response tracking asserts all 49 registered routes ran successfully, then replays every route with a persisted no-grants actor expecting 403. Fixtures use actual controllers/services/Prisma/transactions and class-validator pipes. JWT identity selection and legacy role/branch guards are fixture substitutes; separate Task 3 runtime suite covers JWT/guard ordering. Storage upload is mocked (no network); no external-delivery claim.
5. DB coverage includes SQL/Prisma equivalence, manager A+sales B, cost A+sales B with legacy SALES role, pre-pagination counts/grouping, accessor SKU subquery, COMPANY/FINANCE-origin controls, missing company, absent product ASSIGNED, direct-ID/inspection-template-item substitution, source/destination transfer stages, all mutation adapters, template first-use/global-edit/company checks, fresh position/owner/source revocation, real service rollback, nested pricing rollback, empty bulk write and owner requested-company filtering.
6. Harness creates an owned mktemp `/tmp/bc-access-shop.*` PG16 cluster, Unix socket, fixed port 55491 scoped by unique socket directory, rejects TCP, creates `bc_access_task2`, applies migrations and exports an explicit test URL. Tests reject any URL not matching the isolated convention. EXIT trap stops/removes only that cluster; no inherited application DATABASE_URL, production database or external messages.
7. Focused API runtime/query + existing product/QC regression command: **11 suites / 180 tests passed**. Shared `employee-access.test.ts`: **39 tests passed**. API `tsc --noEmit`, changed-file ESLint and coverage checker run; API changed-file lint: **0 errors / 27 warnings**, versus **0 errors / 2 warnings** in the same file set at HEAD (new files have no baseline). Exact delta: **+25 `@typescript-eslint/no-explicit-any` warnings**. Current rules: 26 explicit-any and 1 unchanged no-unused-vars; baseline: 1 explicit-any and 1 no-unused-vars. Dynamic adapters/projection and test fixtures retain these explicit-any limitations. `git diff --check` passes. Baseline lint uses original HEAD file contents via `eslint --stdin --stdin-filename <same absolute path>`, under the same API configuration; new files contribute zero baseline warnings.
8. Inventory checker: **1,394 entries / 178 files**, staff 1,294 / public 48 / customer 31 / integration 11 / self-service 10. All 1,092 domain rows remain labeled as domain requirements; this unit implements 49, leaving 1,043 elsewhere. No route decorators changed. Coverage checker regression test passes (1 test).

## Exact remaining scope / concerns

- 4.1.2 purchase-orders/suppliers/inventory: 63 named rows. Needs real PO/supplier origins for records without product relationships, not guessed creator ownership. Current product attachment/metrics paths deny unresolved linked source ownership; owner remains trusted. New lead/party origin design still belongs to later units.
- 4.1.3 sales/bookings/trade-in: 56 named rows. 4.1.4 after-sales/repair-tickets: 39. 4.1.5 customers/contacts/customer-journey: 31. 4.1.6 residual SHOP coverage sweep. Total named remainder 189; broader FINANCE/accounting/operational/realtime adapters and Task 5 audit/Task 6 approval work remain untouched.
- This unit deliberately does not claim managed customer/contract/booking source expansions, full PDF/export/storage/realtime coverage or safe global audit payloads. No real employees migrated.
- The global access advisory lock is reused throughout these transactions for revocation safety. This serializes integrated operations; no production throughput benchmark is claimed. Projection currently performs cached per-ID provenance reads and conservative aggregate coverage checks. Later optimization must preserve source/tuple checks.
- Gallery storage uploads cannot be rolled back by PostgreSQL if a later DB write fails; this preserves the existing external side-effect behavior, with current authorization established before upload. Isolated tests mock storage and never send files outside the fixture.
- Parent/root owns full local browser preview and integrated broader checks at Task 8, per explicit instruction. No verified preview claim is made here.
