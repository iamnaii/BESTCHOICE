# Employee access implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner manage employee access across BESTCHOICE through scoped positions, enforce the agreed approval rules, and let all staff see safe activity summaries.

**Architecture:** Use a shared permission catalog and tuple-preserving evaluator; persist positions and company/scope assignments in PostgreSQL. Resolve current access on each staff request, enforce permissions and resource scope on the server, and expose the same snapshot to React for navigation. Extend existing financial flows and audit records rather than creating disconnected alternatives. Unmigrated accounts remain explicitly identified until the owner reviews their proposed mapping.

**Tech Stack:** Existing NestJS, Prisma/PostgreSQL, React/TypeScript, React Query, Tailwind/shadcn, Jest/Vitest/Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-employee-access-design.md`

## Global Constraints

- Owner alone manages positions, assignments, and reserved financial approvals. No per-user permission overrides; one user can hold multiple scoped positions.
- Never flatten positions and branches into a cross product. Manager A plus sales B is not manager B. SHOP and FINANCE remain separate work contexts; FINANCE central access is explicit.
- Cost defaults: owner/accountant/purchasing. Profit defaults: owner/accountant. Owner may change these position permissions later; names must not become permanent sensitive-data allowlists.
- Every extra discount needs approval; both configured baht and percentage caps must pass. Missing caps route to owner. Non-owner cannot self-approve. Owner self-approval requires reason and durable audit.
- Owner alone approves cancellation/refund/interest reduction/penalty waiver. Finance staff or owner execute only the approved refund once, with no new bank integration.
- Every staff member can see safe summaries of everyone's activity; source details and sensitive values remain permission- and scope-filtered at the API, search, statistics, and export boundary. No secrets in audit; no editing/deleting audit content.
- Preserve public/customer/integration authentication, financial calculations, existing archive retention, source data, and existing company selector. No production migration, merge, push, or deploy in this task.
- Read AGENTS.md, .claude/CLAUDE.md and relevant rules/workflows. All work stays in this worktree. Use isolated PostgreSQL for database/financial tests; never use inherited application DATABASE_URL.
- Red/green behavioral tests for authorization and monetary changes. Run npm run local:check and exercise the new page/API on a backend from this checkout. Leave a verified local preview running and state simulation boundaries.

## Review Focus

- A scoped assignment with missing branch/company/record ownership must deny instead of silently becoming global (Tasks 1, 3, 4).
- Revocation, position deactivation, user deactivation, and a concurrently open form must use current server authorization (Tasks 2, 3, 8).
- Cost/profit values must not escape via nested responses, search snippets, error strings, audit reasons, or file responses (Tasks 4, 5, 6).
- Existing privileged settings, websocket commands, direct service paths, and per-user legacy grants must not bypass managed positions (Tasks 3, 4, 8).
- Retry/concurrent approval/refund attempts and changed approved records must not create additional money effects or unaudited changes (Tasks 2, 6, 8).

## File and responsibility map

- `packages/shared/src/employee-access.ts`: catalog, DTO types, default templates, pure tuple evaluator; exported from shared index.
- `apps/api/src/modules/employee-access/`: current snapshot loader, owner CRUD, validation, explicit route policies, resource scoping, redaction, migration proposals; focused files for each responsibility.
- `apps/api/prisma/schema.prisma` and additive migration: positions, assignments, revisions, approval snapshots as needed.
- Existing auth guards/strategy, company scope, controllers/services, socket guards: consume access rather than impersonating a legacy role.
- Existing audit module: durable event capture and safe activity feeds.
- Existing sale/refund/waiver services: enforce approval snapshots at the actual mutation.
- `apps/web/src/pages/EmployeeAccessPage.tsx`, related components/hooks: position and assignment management; existing AuditLogsPage becomes safe all-staff history.
- `tools/test-employee-access.sh`, API e2e, local preview support, browser checks: isolated integration and reviewable demo.

### Task 1: Shared permission model and executable scope contract

**Files:** Create `packages/shared/src/employee-access.ts`, `packages/shared/src/employee-access.test.ts`; modify `packages/shared/src/index.ts`.

**Interfaces:** Export `PermissionKey`, `PERMISSION_CATALOG`, `DEFAULT_ACCESS_POSITIONS`, `AccessGrant`, `AccessSnapshot`, `AccessResource`, `canAccess(snapshot, permission, resource): boolean`, `accessibleBranchIds(snapshot, permission, company): string[] | 'ALL'`. A grant binds positionId, permissions, company ('SHOP'|'FINANCE'), scope ('BRANCHES'|'ASSIGNED'|'COMPANY'), branchIds. Resource carries company, optional branchId and assignedUserIds. Snapshot carries userId, isOwner, managed, revision, grants. Owner is a trusted persisted account property, never a configurable position code.

- [x] Write behavioral tests proving manager A + sales B cannot approve B, accountant A + sales B cannot see B cost, company isolation, assigned-case access, missing resource context deny, and configurable cost/profit defaults. Observe RED.
- [x] Implement catalog covering current application domains (inspect menus/settings and controller modules), read/create/update/delete/approve/export where applicable, sensitive cost/profit/salary permissions, reserved owner operations, and nine default positions. Give catalog Thai labels and group metadata. Reserve owner rights structurally; reject unknown permissions. No guessed discount caps.
- [x] Implement tuple-preserving evaluator and branch extraction. Empty scoped branch lists deny. Company-wide access requires explicit COMPANY grant. All active staff may see activity summaries independently of positions; details use source grants.
- [x] Run shared tests and build; record GREEN, self-review, commit.

### Task 2: Position persistence, owner management, current snapshots, migration proposals

**Files:** Modify `apps/api/prisma/schema.prisma`; create additive migration and `apps/api/src/modules/employee-access/{employee-access.module,employee-access.controller,employee-access.service,access-snapshot.service,employee-access.dto}.ts` with focused specs; modify `apps/api/src/app.module.ts` and auth `/me` response where appropriate.

**Interfaces:** Consume Task 1 types. Export injectable `AccessSnapshotService.forUser(userId): Promise<AccessSnapshot>` and assertion helpers usable in transactions. REST under `/employee-access`: `GET me`, `GET catalog`, owner `GET/POST positions`, `PATCH positions/:id`, `GET employees`, `PUT employees/:id/assignments`, `GET migration-preview`. Version mutations and use expected revision conflict checks. `GET me` returns the current snapshot to active staff. Owner CRUD responses include affected employee counts; migration preview is read-only.

- [x] Write failing tests for non-owner denial including forged position code, invalid scope/company/branches, permission validation, protected last-owner status, stale revision conflict, rollback when durable audit fails, and position edits taking effect for all assignments.
- [x] Add positions with permission arrays, active/deleted state, revision; assignment tuples tied to users and branches/company with explicit scope; managed flag/revision on users. Preserve legacy fields and data. No automatic account migration based on guessed real duties. Seed default templates idempotently through an owner action or isolated fixtures; never seed new users with OWNER rights.
- [x] Implement scoped assignment replacement and position edits in transactions with durable existing audit entries; validate referenced active positions/branches. Return clear Thai errors. Disable/delete positions safely and prevent reserved rights being granted by editable templates.
- [x] Build current uncached snapshots, including account disabled/deleted checks. For unmigrated users, return explicit managed=false and proposals based on legacy role/company/branch and enumerate legacy personal grants requiring review. Management changes must not silently retain per-user overrides for managed users.
- [x] Generate Prisma, build shared/API types, focused tests; commit and report schemas/endpoints for downstream consumers.

### Task 3: Authenticated runtime boundary and complete route inventory

**Files:** Create `apps/api/src/modules/employee-access/{access-policy,access-policy.interceptor,access-context,access-policy.registry}.ts` and focused tests; modify JWT strategy, RolesGuard, BranchGuard, entity-scope guard/interceptor, app module, gateway authentication/authorization as required; create `tools/check-access-coverage.mjs` and `docs/guides/employee-access-coverage.md`.

**Interfaces:** Use current snapshot from Task 2. Attach `user.access: AccessSnapshot` without changing user.role. Expose `assertAccess(user, permission, resource)` and permission-specific scope helpers for services. Route policy metadata declares required permission, company resolution and resource resolver; include explicit public/customer/integration/self-service classifications. A managed staff request may not silently fall back to legacy role authorization.

- [x] Test role-vs-position independence, direct URL/API bypass, revocation on next request, unmapped managed staff route denial, CUSTOMER token rejection on staff routes, preserved public webhook authentication, and denied access capture integration hook.
- [x] Inventory all controller methods, exports/files and socket commands from actual code. Implement checked registry/metadata; a coverage command must fail for newly unclassified entrypoints. Avoid inferring sensitive actions solely from HTTP verb or mapping everything to OWNER.
- [x] Resolve current snapshots after authentication; guard ordering must work (global guards run before controller JWT guards). For managed users enforce capability at the proper boundary and remove legacy RolesGuard veto after a successful explicit policy check; no role spoofing. Preserve legacy path only for explicitly unmigrated accounts and expose that status.
- [x] Define resource/scope requirements for domains and fail closed if context cannot be resolved; Task 4 completes actual list/query and ID-record enforcement before delivery. Socket operations using staff identities must revalidate current grants; maintain public integrations separately.
- [x] Record current coverage and remaining domain integrations in the guide, run tests/types, commit. Do not claim whole-program enforcement while Task 4 is incomplete.

### Task 4: Domain scope integration and sensitive data protection

**Files:** Modify permission-relevant controllers/services under `apps/api/src/modules/{products,sales,customers,contracts,payments,inventory,purchase-orders,refunds,finance-receivable,collections-session,accounting,journal,employees,reports,reporting,dashboard,analytics,search,staff-chat,settings}` and other inventory-listed modules as necessary; create focused resource-resolution/redaction files under employee-access and regression tests.

**Interfaces:** Consume assertAccess and scope helpers from Task 3. Domain list queries must constrain data before pagination/count/aggregate; record mutations resolve persisted company/branch/assignment, never trust a supplied branchId. Sensitive response handling consumes current AccessSnapshot per resource. Return omitted/redacted numeric fields rather than values disguised in text.

- [ ] Write failing behavioral tests for list/count/ID cross-branch access, asymmetric multi-position rights, finance assigned/central scope, shared-customer relations, transfers checking both endpoints, and cost/profit nested/export/search leaks.
- [ ] Integrate all classified staff domains with capability-specific resource scope. Replace direct legacy role business authorization where it conflicts with position grants; preserve ownership, workflow, accounting-period, maker-checker and other independent business constraints. Do not grant managed users old personal accounting/payment/reverse overrides.
- [ ] Apply cost/profit/salary access at source serializers/queries and reports/downloads; audit is handled in Task 5. Configurable position permissions must work regardless of legacy role name. Unknown/unscoped export aggregates must deny rather than leak. Retain intended public catalog prices.
- [ ] Close coverage inventory gaps for staff commands, reports, realtime and on-behalf-of-user automation; system automation retains its own explicit principal rather than impersonating a person.
- [ ] Run focused integration/unit tests and type checks, update coverage evidence, commit. Enumerate any blocked feature accurately; do not silently call denied-but-unimplemented features complete.

### Task 4.1: Scope foundation and SHOP domain integration

Task 4 is executed as four serial, separately reviewed phases because the checked inventory now contains 1,095 domain entrypoints (1,092 at baseline plus the reviewed approved-PO lookup and two Customer document routes). Task 4 is complete only after 4.1–4.4 pass; no phase may claim whole-program coverage alone.

**Files:** Create focused `access-query-scope.ts`, `access-resource.service.ts`, `access-sensitive.service.ts`, `access-shop-boundaries.ts` and tests under `apps/api/src/modules/employee-access/`; modify EmployeeAccessModule and SHOP/customer domain files identified by the checked manifest, particularly products, sales, bookings, inventory, purchase-orders, suppliers, quality-control, trade-in, after-sales, repairs, customer-journey, customers and contacts. Add source-origin schema/migration only where existing relations cannot safely scope newly created records.

**Interfaces:** Consume Task 3 `CollectionScope`, `AccessDecision`, `ACCESS_BOUNDARIES`, current snapshots and `assertAccess`. Produce reusable scope-predicate helpers, persisted record resolver, source-aware sensitive projector and injectable boundary registrar. Each helper must have a typed exported contract documented in the phase report for 4.2/4.3; registration alone must never authorize an unscoped handler. Domain adapters may use ModuleRef to reach existing services without introducing module import cycles.

- [x] Write RED tests for permission-specific branch OR predicates, assigned ownership, company isolation, list/count/pagination parity, ID substitution, source/destination transfers, and purchasing cost access vs ordinary sales. Include manager A + sales B and accountant A + sales B positive/negative controls.
- [x] Build shared query machinery from original tuples: explicit COMPANY, BRANCHES with nonempty allowed IDs, ASSIGNED with persisted assignment and optional branch restriction. Require a source-specific company predicate; unknown model/ownership semantics deny. Never pick a representative branch or filter after pagination.
- [x] Implement actual SHOP record and collection adapters, preserving existing service behavior, validation, statuses/file headers and independent business constraints. Collection executors bypass controller pipes, so explicitly validate DTO/filter inputs. Convert conflicting role-only checks to capabilities. Resolve record company from existing ownership/Entity semantics, not module names.
- [x] Scope shared customer/contact identities through permitted source relationships, and independently scope nested history. Persist authenticated origin/assignment for newly created unlinked leads when necessary; do not expose all customers or make fresh records inaccessible. No guessed backfill of historical ownership.
- [x] Add source-aware SHOP cost/profit projections including nested purchase documents and file boundaries; sensitive capabilities stay configurable and scoped. Internal floor calculations may use cost without returning it. Do not blindly treat Customer.salary as employee payroll.
- [x] Run meaningful isolated HTTP/service/query tests, API types and coverage checks; update the coverage guide with enabled adapters and exact remaining domains; self-review and commit.

**SHOP phase completion:** All serial implementation gates through ae906c234 pass independent spec/quality review. Root independently reconciled actual registration bodies/providers with the current manifest complement:280SHOPdomain, no missing/duplicate/unexpected/unclassified route, disjoint FINANCE544/operations267/audit4. Exactly7employee-management and3promotionowner staff surfaces stay separate; owner7 has reviewed service/ownedDB evidence, its livecontroller/DTO/fullJWT verification remains8. Source/quote/exchange/promotion/loyalty producers earn0routes. Qualified per-unit positive/denial/current-source/financial/file/aggregate evidence is recorded in task-4.1-shop-parent-reconciliation.md and unit reports; this is not a fresh all280 suite or whole-program/JWT/UI/preview claim. All named downstream FINANCE/system/audit/approval/UI/performance/final8 and deferred-minor obligations remain mandatory.

### Task 4.1.1: Scope foundation, products and quality control

This is the first serial unit of Task 4.1. The SHOP allocation contains 277 baseline domain entrypoints (278 after the approved-PO lookup addition), so 4.1.1–4.1.6 each get implementation and review; umbrella Task 4.1 is complete only when all pass.

**Files:** Create the Task 4.1 scope-query, persisted-resource and source-aware projection infrastructure plus focused product/QC boundary registrars and tests. Modify `modules/products` and `modules/quality-control` services/controllers and shared access wiring as required. Current manifest surface: ProductsController, InspectionsController and ProductPhotosController (49 domain entries).

**Interfaces:** Produce the reusable typed contracts described in Task 4.1 for later units and FINANCE/operations phases. Use Task 3 discriminated decisions and validated scoped executors; no representative branch, unscoped collection fallback, role impersonation or ready-flag authorization. Record paths also require sensitive projection; writes recheck current scope transactionally.

- [x] RED tests for permission-specific tuple OR predicates, missing ownership/company, assigned identity, manager A + sales B, accountant A + sales B, scoped list/count/pagination and ID substitution. Prove representative predicates with isolated PostgreSQL, not only query mocks.
- [x] Implement products read/search/filter/grouped stock and raw-SQL aggregates with scope before rows/count/aggregation. Resolve existing source-company semantics explicitly. Preserve existing response shapes, DTO/filter validation and service workflows.
- [x] Implement product create/update/status/bulk/photo/inspection and transfer actions. Check all affected products and required source/destination scopes for each stage; caller branch is not proof. Preserve independent transfer/quality-control workflow and file behavior.
- [x] Implement configurable source-aware product cost/profit projection for nested records and errors/files; purchasing cost capability works regardless of legacy role. Permit internal cost calculations without returning sensitive values.
- [x] Register every in-scope entrypoint with working adapters, tests for authorized success and denial, types/coverage; document exact contracts and remaining scope, self-review, commit.

### Task 4.1.2: Procurement and inventory boundaries

**Files:** Extend the same scope/projector/registrar contracts; modify `purchase-orders`, `suppliers`, `inventory`. Current manifest: PurchaseOrdersController, SuppliersController, BranchReceivingController, InventoryForecastController, ReorderPointsController, StockAdjustmentsController, StockCountController (63 domain entries).

- [x] RED and isolated DB tests for scoped procurement, count/receive/adjustment authorization, branch/company isolation, and default purchasing-versus-stock cost visibility.
- [x] Implement all listed record/collection/bulk/export boundaries, preserving actual workflows and DTO/file contracts. Scope supplier visibility through permitted procurement sources or explicit origin as needed; no broad shared-data fallback.
- [x] Protect nested purchase costs, inventory valuations and forecasts, including count/aggregate/export; no legacy role veto or personal override bypass. Current transactional assertions on writes.
- [x] Types/coverage/focused tests, contract report, self-review, commit; other SHOP units remain pending.

### Task 4.1.2.1: Procurement, suppliers and receiving transaction contract

Task 4.1.2 is executed as three serial reviewable units (32 + 21 + 10 routes); the phase remains incomplete until all three pass. Preserve all parent scope, projection, success/denial and financial regression obligations.

**Files:** Same access engine/registrar plus `purchase-orders`, `suppliers`, goods-receiving/input-VAT services and narrowly necessary audit/transaction helpers. Current surface: PurchaseOrdersController (25) and SuppliersController (7).

- [x] RED real DB/HTTP tests for all in-scope boundary families, pre-pagination source/count parity, scoped PO/supplier histories/GL/payment data, purchasing cost visibility, unauthorized cost overrides and caller-selected company/branch substitution.
- [x] Add genuine authenticated source/origin handling where PO/supplier rows lack resolvable existing relationships; no guessed historical backfill. Preserve usable new-record creation and describe required UI inputs. Implement safe nested procurement/receiving projections consumed by existing product workflows.
- [x] Extend outer execution with an explicit isolation/retry/effect contract before joining services that require Serializable. Do not silently discard inner isolation requirements, retry inside an aborted transaction, or commit dependent work separately. Prove current authority after waiting for access locks under Serializable with real concurrent revocation; restart whole authorization/source resolution on retry.
- [x] Preserve original PO receive, late input-VAT, supplier payment/GL and journal state machines. Scope JSON-tag/raw-SQL journal lookups through real company/source provenance before balances/aggregates. A supplier permission alone must not expose all cross-scope journal history or confer payment authority.
- [x] Keep durable financial evidence in the existing AuditLog/outbox within the actual mutation transaction; no premature success event from an inner transaction that has only joined an outer one. Handle post-commit notifications/effects and cleanup of newly uploaded files on outer failure explicitly. No new bank transfer integration or changed money formulas.
- [x] Verify all 32 routes with authorized success and denial, financial rollback/retry/isolation semantics, types/lint/coverage. Document reusable transaction/projection/origin contracts and remaining UI/source seams, self-review and commit. Root owns integrated local:check/preview.

### Task 4.1.2.2: Branch receiving, stock counts, reorder and forecast

**Files:** Same access engine plus `inventory` BranchReceivingController (4), InventoryForecastController (1), ReorderPointsController (10), StockCountController (6): 21 routes.

- [x] Consume reviewed procurement/receiving source contracts from 4.1.2.1. RED isolated tests for count/receive scope, record/branch substitution, exact bulk targets, before-count aggregation and forecast related Sale reads.
- [x] Add the missing safe approved-PO lookup for STOCK-only receiving users under stock-receiving.read, using the real selected destination and reviewed PO company/state/projection contracts. Return required PO/item identifiers and approved outstanding quantities without costs or unrelated receiving history; validate current scope, update the checked inventory, and cover success/denial. This new route is additional to the 21 existing entries and must be ready for Task7 UI consumption.
- [x] Implement every listed record/query/bulk boundary with current source assertions and scoped projection. Stock staff may receive approved quantities with server-derived cost kept internal; unauthorized cost override fields must not pass through.
- [x] Preserve count/receive/reorder workflows and concurrency; scope reorder batches before mutation and forecast inputs before calculation, including their original company/source semantics.
- [x] All in-scope authorized-success/denial evidence, rollback where relevant, types/lint/coverage, downstream contract report, self-review, commit.

### Task 4.1.2.3: Stock adjustment financial boundaries

**Files:** Same access engine plus StockAdjustmentsController and adjustment/journal/document services: 10 routes.

- [x] RED isolated tests for scoped requests/approval/execution, source and destination substitution, sensitive valuation/file output and duplicate/concurrent adjustment behavior.
- [x] Implement actual capability-aware former role gates, current transactional source authorization, accounting/journal/document boundaries, and independent workflow constraints. Do not grant monetary approval merely from generic stock access.
- [x] Preserve financial math, serializable/retry and durable evidence contract; prove money/stock/journal/audit rollback together on failure and exact authorized success.
- [x] Types/lint/coverage/focused regressions and complete reconciliation of the original 63 parent routes plus the added safe receiving lookup and any newly introduced routes, report, self-review, commit. Mark parent 4.1.2 complete only after independent review of all units.

### Task 4.1.3: Sales, bookings and trade-in boundaries

**Files:** Extend same infrastructure; modify `sales`, `bookings`, `trade-in`. Current manifest: SalesController, BookingsController, TradeInController (56 domain entries).

Execute as two serial reviewed units: trade-in/source-credit producer (38 routes), then sales/bookings consumer (18 routes). The parent remains incomplete until both pass; all obligations below apply to both units.

- [x] RED and isolated service/DB tests for scoped reads/writes, source-product/customer linkage, duplicate requests and nested cost leakage with authorized success controls.
- [x] Implement all listed boundaries and pre-aggregation scopes with validated inputs, file behavior and actual service workflows. Check each referenced source and destination. Convert conflicting managed role-only checks while preserving damage acknowledgement and independent business constraints.
- [x] Preserve financial math and existing transaction state until Task 6 implements the new approval rules. Document concrete approval seams for Task 6; do not add a parallel sale/refund execution path.
- [x] Source-aware sensitive projections, current transaction assertions, types/coverage/focused tests, report, self-review, commit.

### Task 4.1.3.1: Trade-in intake, credit, vouchers and valuation references

**Files:** Same scope/resolver/projector/execution engine plus `trade-in` facade, lifecycle/query/credit/voucher/valuation services, their concrete contact/storage/journal seams and focused tests. Current surface: TradeInController (38 routes).

- [x] RED and real isolated DB/HTTP tests for record/collection/source substitution, actual company/branch scope before pagination/counts, authorized success, current authority and nested cost/document protection across all 38 routes.
- [x] Resolve nullable branch/customer/product sources and new-record origin explicitly; preserve existing public/customer online submissions without treating unassigned historical cases as globally shared. Creator/appraiser/retry identity is not automatically an ASSIGNED case relationship. Define global valuation/question/configuration reference operations separately from case access with concrete capability and scope semantics.
- [x] Preserve actual intake/appraisal/accept/reject/complete/quick-buy state machines, immutable appraisal/owner override rules, credit issue/redemption identities, journal math and voucher numbering. All child services use the actual outer transaction, current source checks, durable existing audit and operation-owned file/effect lifetime; no parallel credit/payment path.
- [x] Protect monetary/nested output and voucher/download bodies using their actual source and configurable sensitive grants; retain usable authorized operations. Record required UI origin inputs and approval seams for Task6. Publish reusable trade-in/credit source/projector contracts for sales/bookings and FINANCE consumers.
- [x] All in-scope success/denial evidence, exact duplicate/concurrent/rollback controls, relevant existing regressions, types/lint/coverage, contract report, self-review and commit. Root owns integrated preview/local:check.

### Task 4.1.3.2: Sales and bookings

**Files:** Same access engine plus `sales` and `bookings` facades/helper services, concrete product/customer/trade-credit/receipt/journal seams and focused tests. Current surface: SalesController (9) and BookingsController (9).

- [x] Consume reviewed historical SHOP Sale provenance, current product and trade-in/credit contracts. RED real isolated DB/HTTP tests for all 18 routes, tuple/company/source isolation before counts/exports, nested sensitive output and source substitution with legitimate success controls.
- [x] Preserve actual sale creation/void and booking creation/deposit/update/cancel/convert/remove flows, exact product locking and existing partial unique indexes. Sales.create continues to reject INSTALLMENT; /contracts remains the internal installment creation path. Validate every referenced/bundled product and independent linked source; no representative branch or caller-selected scope proof.
- [x] Join the actual child service transactions and existing durable audit/journal flows; preserve money formulas and duplicate/concurrent/state/period constraints. Post-commit notifications/loyalty or other effects require explicit retry/failure semantics. Record all cancellation/refund/discount approval seams for Task6, including Booking.convert's direct Sale creation, without adding a competing executor.
- [x] Implement source-aware nested/read/export projections and capability-aware managed gates, keeping independent business constraints. Do not treat booking creator as assignment or room origin as permission to all room/customer history. Publish concrete contracts for later customer/FINANCE/chat/UI integration.
- [x] All 18 success/denial controls, current-authority and financial rollback/duplicate evidence, types/lint/coverage/regressions, report, self-review and commit. Reconcile all 56 parent routes after both independent reviews.

### Task 4.1.4: After-sales and repair boundaries

**Files:** Extend the same access infrastructure; modify `repair-tickets` and `after-sales`, including their actual financial, source and file dependencies. Baseline manifest: RepairTicketsController (15) and AfterSalesController (24), 39 domain entries.

- [x] Complete Task 4.1.4.1 and Task 4.1.4.2 serially, each with independent review.
- [x] Reconcile every baseline route against current registered methods and legitimate success plus denial evidence; preserve all parent workflow, sensitive-data and financial requirements.

### Task 4.1.4.1: Repair tickets and warranty source contract

**Files:** Same access engine plus `repair-tickets` facade, lifecycle/query/warranty/numbering helpers; concrete linked customer, product, sale, contract, supplier and financial-draft seams; isolated tests. Current surface: RepairTicketsController (15).

- [x] RED real isolated DB/HTTP tests for all 15 routes with legitimate managed success and persisted no-grants denial. Test original tuple boundaries, actual company/source, scoped search/count/pagination, nested estimates/costs/documents, source substitution and current-authority changes. A creator or event actor is not a genuine case assignment.
- [x] Preserve explicit branch intake and WALK_IN tickets without invented product/contract dependencies. Every supplied linked record must be resolved from persisted source and independently authorized where required. Keep historical Sale source distinct from current Product ownership; establish a narrow reusable actual Contract source contract where needed for warranty or replacement, with real company/origin semantics and no inferred user branch. Publish it for later FINANCE integration.
- [x] Implement record, collection, lookup and lifecycle boundaries using the reviewed execution engine and dynamic transaction clients in captured child helpers. Preserve status/CAS, warranty date arithmetic, global internal numbering and immutable original-source relationships. Source-scoped warranty lookup must not expose unrelated contracts, sales, customer histories, products or open service cases.
- [x] Preserve READY_FOR_PICKUP closure and exactly-once canonical ExpenseDocument or OtherIncome draft creation according to payer, positive Decimal amount, supplier presence and existing rules. Join actual outer transaction, existing durable audit and source assertions; prove rollback of status/document/link/audit on late failure and duplicate/concurrent protection. This authorized internal draft operation does not grant unrelated financial posting rights.
- [x] Apply independent source/sensitive projections and capability-aware managed gates while retaining business constraints. Expose a safe reusable repair/warranty contract for after-sales callers, including createInTx and markReplaced. Do not grant authority merely because another service calls the raw child helper.
- [x] Types/lint/coverage and focused regressions, report with exact source/transaction/projection contracts and remaining Task5/6/7 integration seams, self-review and commit. Root owns integrated fullguard/browser/local:check.

### Task 4.1.4.2: After-sales cases and canonical exchange integration

**Files:** Same access engine and after-sales consumer plus its actual canonical ContractExchangeService, ExchangeCancelService and DefectExchangeService producers.

- [x] Complete canonical exchange prerequisite 4.1.4.2.1, then all 24 after-sales routes/documents in 4.1.4.2.2, each independently reviewed. Producer work alone earns no completed route count.
- [x] Preserve every original 24-route after-sales requirement in the consumer and reconcile all 39 parent repair/after-sales routes only after both units pass. Direct exchange endpoint adapters remain in their allocated later units and must consume the same canonical producer, never another executor.

### Task 4.1.4.2.1: Canonical exchange source and transaction producer

**Files:** Same source/current-snapshot/execution infrastructure plus ContractExchangeService, ExchangeCancelService and DefectExchangeService and narrowly necessary captured journal/company/product/credit/repair helper seams; focused owned PostgreSQL tests. No direct endpoint or after-sales route completion is claimed by this prerequisite.

- [x] RED real isolated PostgreSQL controls for permitted canonical managed exchange operations and absent/foreign original-tuple denial, including current authority/source after actual waits. Resolve actual FINANCE Contract financial source separately from narrow SHOP warranty view; Contract has no company column. Use persisted live origin branch, independently authorized current Product/party/source/destination relationships and real workflow identity. No creator/collections assignment inferred as exchange authority.
- [x] Publish explicit source/capability and same-transaction contracts for submit/preview/approve/reject/cancel, defect eligibility/execute and activation finalization seam. Raw managed callers need the current actor and owned execution/client; no alternate root transaction or supplied role/branch as authority. Convert captured children to the reviewed actual-client contract and whole-attempt retry; no approval bypass via internal AUTO calls. Actual affected source and destination authority is independently resolved before mutation.
- [x] Preserve canonical MEMO ownership swap, PRICED draft/finalization, defect replacement, cancellation state/CAS/period/Decimal/JE/input-VAT/credit/maker-checker/tier rules and test-data fence. No new financial executor, formula, real bank transfer or guessed cap. Current owner is additionally required for reversal of an already applied MEMO or finalized exchange; genuine pre-finalization no-money draft cancellation remains scoped update. Decide from locked persisted state, never request claims. Final persisted approval workflows remain Task6.
- [x] Existing durable mutation/status/audit evidence must join the actual financial transaction; post-commit notifications/effects only after actual commit. Prove actual canonical ownership/Contract/JE/links/audit rollback on late failure and duplicate/concurrent once-only state. Preserve unmanaged compatibility. Do not add a userId to the currently inert finalization audit call without also joining its exact tx; publish correct activation caller contract for4.2.
- [x] Prove independent SHOP repair/after-sales authority does not grant FINANCE exchange or other Product-source authority, and valid explicitly granted cross-source operations succeed. Type/lint/coverage and focused existing canonical financial regressions; report exact reusable source/tx/caller/output contracts, all unresolved public/controller/UI/approval/audit consumers, self-review and commit. Root owns integrated fullguard/browser/local:check.

### Task 4.1.4.2.2: After-sales cases, exchange integration and documents

**Files:** Same access engine plus after-sales facade and case/query/lookup/exchange/repair/document/LINE helpers, customer LIFF consumer and actual captured dependencies. Current surface: AfterSalesController (24).

- [x] Complete the four serial units below with independent review: customer-charge provenance producer (zero route completion), source/query/lookup (6), canonical mutations/staging (14), document/photo streams (4). Preserve all original24 requirements; no missing adapter counts as complete.
- [x] Reconcile all39 repair/after-sales routes and producer-consumer contracts after the final unit: current original tuples, actual canonical rollback/duplicate protection, source-safe JSON/search/count/errors/rendering, owned-file lifetime and postcommit effects. Direct exchange adapters/activation, whole-program audit, final approvals and UI remain explicitly allocated later.

### Task 4.1.4.2.2.1: Customer-facing repair-charge provenance

**Files:** Existing after-sales query/document/LINE selectors and mappers, document composer, LINE-copy helper, customer LIFF after-sales service and focused existing tests. Reuse reviewed repair-charge-visibility helpers; no new schema or route adapter in this unit.

- [x] RED/GREEN actual consumer composition tests for receipt/handover HTML, all LINE moments and LIFF where current payer=CUSTOMER but retained estimate provenance is null/SHOP/SUPPLIER_CLAIM. Carry RepairTicket.estimatedCostPayer through actual selectors/mappers; verify CUSTOMER-provenance estimates and fresh CUSTOMER actual charges remain useful.
- [x] Customer-facing content never borrows the staff initiator's cost grant, including OWNER. Use unavailable/awaiting-quote text for unproven/internal estimates, never false zero/no-charge. Preserve money/formulas, existing customer auth, document layout and normal customer quotes.
- [x] Use shared repairEstimateIsCustomerCharge/repairActualIsCustomerCharge rather than competing field-name policy. Verify selector-to-renderer/notification/LIFF composition with mocked external transport/renderer, no real sends/uploads. These unit checks are not DB/HTTP enforcement evidence and earn no completed route count.
- [x] Focused tests/types/lint, publish exact nullable field/output contracts and all remaining source/transaction/public-route work, self-review/report/commit. No default template/saved permission changes in this narrow producer.

### Task 4.1.4.2.2.2: After-sales source, query and lookup boundaries

**Files:** Same reviewed access engine, focused after-sales source/query/projector boundary files and existing facade/query/lookup/reconciliation helpers plus actual repair/warranty/exchange/product/party/photo lookup dependencies. Six methods: lookup, list, byTicket, previewExchange, replacementProducts, get.

- [x] RED real owned PostgreSQL/Nest HTTP success and persisted no-grants denial for all6 methods. Resolve actual persisted SHOP case branch and raw linked Contract/Sale/Product/customer/replacement IDs independently, with same-party/device consistency; event actors are not assignment. Reuse reviewed narrow warranty and explicit FINANCE exchange source/action contracts, no guessed company or flattened tuples.
- [x] Scope before search/paging/count/summary and each nested source/capability/sensitivity projection; preserve authorized rows behind newer foreign histories. Historical Sale differs from current Product. A safe initial lookup does not authorize fresh ProductPhotos, eligibility, LINE-link or open-case loads. Lookup/current capability outcomes remain useful; no unrelated party/history/Contract-finance navigation or hidden cost/floor errors.
- [x] Publish reusable exact-client/current-source/lock/query/projection helpers for subsequent mutation and document consumers, using original tuples and current persisted snapshots. Keep managed actor/owned execution across real children; captured clients join the actual transaction. Do not add a competing engine or claim later mutation/document routes complete.
- [x] Preserve canonical derived-stage reconciliation and global IMEI exclusion. Managed CAS maintenance may mirror already-completed child state only after current case plus actual linked read/source authority, in the actual transaction with durable derived-event/initiator evidence; it is not new child money execution or a user cancellation. Foreign global-IMEI candidates can be classified read-only for exclusion, never reconciled/returned without source authority. Keep copied cancellation free text out of unapproved projections.
- [x] Current-authority/source wait controls and safe query/renderer-input source contracts, focused regressions/types/lint/coverage; self-review/report/commit. Report action dependencies/default needs to mutation unit andUI7. Root owns final fullguards/browser/local:check.

### Task 4.1.4.2.2.3: Canonical after-sales mutations, intake staging and effects

**Files:** Existing after-sales case/exchange/repair facade and helpers, chat-service-case link, source boundary producer, actual canonical child services and reviewed preparation/effect hooks; focused actual PG/HTTP tests. Fourteen methods: create, confirmExchange, deliverExchange, rejectExchange, switchToRepair, approveExchange, rejectPricedExchange, cancelSwap, addPhoto, send, markRepaired, sendBack, ret, cancel.

- [x] RED actual owned PostgreSQL/Nest HTTP success/no-grants pairs for all14 methods, source substitution, original tuple isolation and current-authority/source changes. Consume reviewed6 read/source helpers plus canonical repair/exchange producers; parent case access never implies child financial, repair or affected Product-source authority.
- [x] Preserve physical receipt/WALK_IN, repair forwarding, same-model/priced exchange, rejection/cancellation/delivery and original maker-checker/Decimal/state/CAS/period/credit rules. Case+canonical child+financial/status/link/durable evidence must join one actual outer attempt; replace managed post-inner-commit compensation with coherent rollback, no second financial executor or aborted-tx catch-success.
- [x] Source-room/service-request idempotency checks actual current provenance and authorized reuse without granting whole room/customer history. Preserve global IMEI exclusion and actual concurrent once-only state; foreign open case conflicts are generic, terminal foreign candidates remain unmodified. Query maintenance mirrors completed state under reviewed contract, no new money approval just to reconcile.
- [x] Validate DTOs/files and preauthorize actual sources before storage; stage intake/copied purchase/extra photos once outside DB/global lock, reauthorize sources inside and clean only newly owned failed/unused keys across retries/idempotent reuse. Current copied purchase source permission is independent. LINE/notifications/external effects only after actual outer commit, mocked in tests; no real uploads/sends.
- [x] Add repair-tickets.read/create/update to future default SALES and BRANCH_MANAGER templates with tests because canonical children require them; never mutate saved positions or add cost/profit/exchange approval/posting rights. Publish exact UI action dependencies. Preserve reviewed customer-charge provenance across all effects regardless of staff cost grants.
- [x] Prove actual canonical financial/repair rollback, duplicate/concurrency, current revocation, owned-file lifetime and source-safe errors/outputs; final covering tests/types/lint/coverage, exact Task5/6/7 seams, self-review/report/commit. Final immutable approvals remain6, full actual activation/direct exchange adapters remain allocated later.

#### Serial execution of Task 4.1.4.2.2.3

The fourteen mutations require three distinct canonical integration rewrites. Execute the following units in order with independent review; all parent requirements above remain binding. Default templates add zero routes. The parent completes only after all fourteen actual entrypoints and cross-unit contracts are reconciled.

**Parent review evidence:** Defaults `a7f64c4d1` add zero routes; runtime units `77412da46` (6), `1301fc9da` (7) and `7ed064a2a` (1) complete all fourteen mutations with independent review and actual HTTP allow/deny evidence. The exchange unit records narrower historical RED evidence explicitly below. Document streams, direct FINANCE adapters, full audit/approvals/UI and final integrated checks remain separately allocated.

### Task 4.1.4.2.2.3.1: Future sales/manager repair capability defaults

**Files:** `packages/shared/src/employee-access.ts` and its focused shared tests. Zero runtime routes.

- [x] RED/GREEN proving future SALES and BRANCH_MANAGER templates include repair-tickets.read, repair-tickets.create and repair-tickets.update, while other positions and configurable sensitive/exchange/posting rights remain unchanged.
- [x] Add only those canonical child capabilities to the two future templates; no saved-position/user migration, owner authority, cost/profit or financial approval grants. Preserve the shared catalog/evaluator and no guessed discount caps.
- [x] Shared tests/build, changed lint/diff checks, self-review/report/commit. Publish the precise default dependency to UI7; make no claim of mutation-route implementation.

### Task 4.1.4.2.2.3.2: Existing-case action boundary, repair lifecycle and extra photos

**Files:** Focused after-sales action/source/raw-business response contracts, existing repair lifecycle/case query/extra-photo helpers and current preparation/effect engine. Six methods: send, markRepaired, sendBack, ret, cancel, addPhoto.

- [x] RED actual owned PostgreSQL/Nest HTTP positive/no-grants pairs for all six, current-source/action/tuple isolation and actual child repair dependencies. Raw managed business loading requires exact owned execution/action/source, never legacy role authority or a nullable presentation DTO as business input. Publish reusable current raw-load and safe mutation-acknowledgement contracts for exchange/intake consumers.
- [x] Preserve actual canonical repair/receipt/return/cancel states, amounts, customer quote provenance, maker-checker and financial draft rules. Case, repair, ExpenseDraft/OtherIncome/status/Todo and required durable audit effects commit/rollback in the same actual outer attempt. Query-read stage maintenance remains separate; canonical mutation checks still use actual current child state.
- [x] For addPhoto, validate/preauthorize before storage, stage once outside global lock, reauthorize inside and clean only newly owned failed/unused keys. LINE/notification effects occur only after actual outer commit and do not repeat on serialization retry. All transports/storage mocked in tests.
- [x] Safe full response needs current after-sales.read; action-only acknowledgement exposes only the actual operation's permitted case/result metadata, no hidden child IDs/amounts/notes. Re-resolve facts after pointer/source changes. Prove actual repair/financial rollback, concurrent once-only/CAS, permission/source waits, file ownership and effect timing with real writers.
- [x] Focused covering regressions/types/lint/coverage, exact producer/default/action/response contracts and remaining exchange7/intake1/document4/audit/approval/UI/fullguard obligations, self-review/report/commit.

### Task 4.1.4.2.2.3.3: Existing-case exchange mutations

**Files:** Existing after-sales exchange facade, reviewed canonical exchange/defect/repair services, preceding action/raw-load/source/effect contracts and focused real PG/HTTP tests. Seven methods: confirmExchange, deliverExchange, rejectExchange, switchToRepair, approveExchange, rejectPricedExchange, cancelSwap.

- [x] RED actual owned PostgreSQL/Nest HTTP positive/no-grants pairs for all seven, current case and every real child source/action, original tuple isolation and source changes. Consume reviewed action/raw-business contracts; no parent case grant substitutes for FINANCE, affected current/destination Product or repair capabilities.
- [x] Preserve same-model/priced exchange, rejection/switch/cancel/delivery, actual canonical Decimal/state/CAS/period/credit/JE/input-VAT and maker-checker rules. All case/child/financial/link/audit writes join the actual outer attempt; no parallel executor or post-inner-commit compensation. Managed AUTO create-only stays pending unless actual all-source approval authority is present. Applied/finalized cancellation remains current-owner-reserved; true no-money draft behavior stays distinct.
- [x] Recheck current sources before canonical mutations overwrite ownership/pointers; refresh read facts after changes, preserve typed action-only versus source-safe readable responses and customer quote provenance. External effects only after actual outer commit, mocked.
- [x] Prove real canonical financial rollback on late failure, once-only/concurrency, current authority/source waits and source-safe output/error paths. Final focused regressions/types/lint/coverage and report exact contracts for intake/documents, self-review/commit. Direct FINANCE activation/adapters and final immutable approval workflow remain their allocated later units.

**Review evidence note:** Completed at `1301fc9da`, independent spec/quality review approved with no Critical/Important findings. Final actual HTTP allow/deny evidence covers all seven. Historical behavioral RED was observed for one representative missing adapter and the shared COMPANY predicate defect, rather than seven separate pre-change route failures; this explicit Minor deviation and inherited Jest forceExit noise remain recorded for final review.

### Task 4.1.4.2.2.3.4: Intake staging, source request linking and mutation closure

**Files:** Existing after-sales case creation, ChatServiceCaseLinkService and narrow request-source contract, reviewed preparation/current-source/repair/exchange/action/effect helpers and actual PG/HTTP tests. One method: create, plus reconciliation of all fourteen mutation entrypoints.

- [x] RED real owned PostgreSQL/Nest HTTP legitimate create/no-grants, WALK_IN/physical receipt and priced/same-model intake, original tuple/source substitution and current changes. Consume all reviewed canonical children; one actual outer attempt commits or rolls back case, ticket/exchange, request link, financial/status and required durable evidence. Replace managed compensation after an inner commit; preserve existing canonical formulas and workflow gates.
- [x] Preauthorize current lookup/request/copy-photo sources and validate files before storage. Prepare operation-owned intake once outside DB/global lock, then reauthorize and consume in the actual retryable attempt; fingerprint/source changes must not consume stale prepared inputs. Clean only newly owned failed/unused keys on failure or idempotent reuse, never preexisting source keys. Effects occur after actual commit once.
- [x] Narrow source-request linking requires current chat.update in the actual room company at each proven request-origin branch, plus independent actual-company referenced-child read/action and after-sales action. Genuine unanchored requests need explicit COMPANY or actual request-Todo ASSIGNED scope; branch-restricted tuples need proven origin. Never infer origin from creator, staff primary branch, prospective case or family alias. Preserve feature flag, canonical party/device/fingerprint/revision/unique-link checks; publish a reusable narrow source contract for4.3 without granting full room/customer history.
- [x] Consume reviewed global IMEI boolean classifier under the same actual advisory-locked transaction through insertion. Prove foreign open generic conflict, terminal foreign candidate permitting intake without foreign mutation/audit, actual concurrent same-IMEI once-only creation and source-request idempotent reuse without duplicate files/children/effects.
- [x] Reconcile six repair/photo plus seven exchange plus create = fourteen exact runtime registrations and legitimate success/denial evidence; cover shared-source/action/raw-load/transaction/preparation/projection/effect contracts across units. No producer-only helper or missing adapter counts as an exposed operation.
- [x] Final covering tests/types/lint/coverage, exact fourteen-route report and document4/FINANCE/audit/approval/UI/fullguard dependencies, self-review/commit. Mark parent only after independent review.

**Review evidence note:** Complete through `7ed064a2a` after full review and scoped Fix1 review. The fix removes an extra chat grant in a referenced resource company while retaining independent child-source authority. Real owned-PG intake coverage includes rollback, staging, concurrency and observed current-authority waits; final Fix1 has 11 focused passing controls. The combined fourteen-route reconciliation uses each reviewed child report; it does not imply fourteen distinct historical pre-change RED failures.

### Task 4.1.4.2.2.4: After-sales document/photo streams and parent closure

**Files:** Existing document loader/HTML/PDF renderer/controller streams and photo/storage consumers, source/projector helpers and focused actual PG/HTTP tests. Four methods: photo, purchasePhoto, receiptPdf, handoverPdf.

- [x] RED actual owned PostgreSQL/Nest HTTP legitimate success and persisted no-grants denial for all4 methods. Authorize each actual case/source and independent document/sensitive permission before storage read/sign/render: photos require after-sales.read + documents.read at the case; PDFs require after-sales.export + documents.read at the case, with genuinely needed child reads independently required and no additional general case-read/generic document-export gate merely for helper reuse, including copied original purchase photos and freshly loaded Contract/Sale/Product/replacement/payment inputs. A prior safe getCase JSON is not authority for later renderer loads.
- [x] Preserve receipt/handover output/layout and customer-charge provenance; internal/unknown estimates remain unavailable even for OWNER initiator, legitimate verified customer charges remain. Protect both HTML/renderer inputs and final byte streams, not only JSON. No unauthorized IDs/free text/cost/floor/party/source navigation in output/errors.
- [x] Stage rendered bytes/effects appropriately and send only after successful actual commit; prove renderer/storage not called before authorization and late failure does not emit protected bytes. Record print requested/generated honestly, not paper printed. Preserve auth and external storage lifetime constraints, no real upload/render transport in tests where mocked.
- [x] Reconcile all24 consumer and39 repair/after-sales route registrations and positive/denial evidence, cross-unit source/tx/projection/current-change contracts, actual canonical once-only and owned-file/postcommit behavior. No absent adapter or internal producer counted as exposed-path completion.
- [x] Types/lint/coverage/focused regressions, final source/API/default dependency and Task5/6/7/8 report/guide, self-review/commit. Mark parent only after independent review; root owns fullguard/browser/local:check/preview.

**Review evidence note:** Complete at `10f99f0b1`, independent spec/quality review approved, no Critical/Important findings. Actual four-stream evidence is 43 full PostgreSQL/HTTP tests plus two added focused controls and two refreshed export-only assertions; 161 covering regressions. Exact registered24/39 matches reviewed prior execution reports. External storage/renderer mocks and fixture guards do not replace final actual JWT/browser/preview8; inherited validation noise is recorded for final review.

### Task 4.1.5: Shared customers, contacts and journey boundaries

**Files:** Shared source/query/projector engine and customers, contacts, customer-journey; additive explicit origin/assignment migration where required. Baseline CustomersController23 + ContactsController4 + CustomerJourneyController4 =31 domain methods.

- [x] Complete four serial independently reviewed units: identity/origin/basic10, derived history/export11, merge/contact/document6 and journey4. Preserve original all31 scope, sensitive and source-safe behaviors; no omitted adapter counts as completion.
- [x] Reconcile33 current runtime registrations (31 baseline plus two document additions), legitimate positive/denial evidence and source/alias/current-authority/transaction contracts with prior consumers and downstream FINANCE/chat. No guessed historical origin or real employee migration; final full guards/browser/local:check belongs to8.

### Task 4.1.5.1: Shared identity origins and basic customer/contact boundaries

**Files:** Reusable party/current-source/query/projection contracts; customers query/write/facade/controller, Contacts service/resolver/controller, PII helpers and additive source schema/DTO/migration as needed. Ten methods: CustomersController.create, update, remove, findAll, findDetail, findOne, search; ContactsController.list, findOne, ensureRole.

- [x] RED owned PostgreSQL/Nest HTTP legitimate scoped success/no-grants for all10, original tuples, current authority/source waits and actual same-party relationships. New unlinked leads must be usable through authenticated explicit company/origin or genuine persisted assignment; never infer from actor primary branch/creator or guess historical backfill. Missing sources deny even OWNER; valid COMPANY and real ASSIGNED positives must work.
- [x] Extend/reuse partyAllows/currentCustomerReadWhere and actual historical source predicates. Publish reusable typed identity/current origin/assignment/alias/field contracts and integrate earlier trade-in, sale/booking and repair/after-sales consumers so freshly created parties are selectable only in authorized scope. Existing live historical Sale, service/warranty, TradeIn and genuine FINANCE source evidence stays distinct from current Product and must not grant unrelated history. Explicit no-tuples predicates stay false.
- [x] Scope findAll/search/detail/Contact relations before filters, counts, pagination and nested aggregation. Existing list filters include purchase, credit, overdue, assignment, chat-contact time/channel and tier; derive from authorized contributing sources only, preserving legitimate capabilities and nullable unavailable versus true zero. Nested actual Contract/Payment/Sale/Product/chat/referral/supplier/trade-in data needs its own source/action/sensitive authority. A safe customer identity does not grant all aliases or history. Publish precise FINANCE/chat source seams rather than declaring those downstream adapters done.
- [x] Preserve canonical normalization, encryption/hash, national-ID/phone/email uniqueness, phone-before-contact-code lock order, global P-N numbering, ghost revival and stub-upgrade semantics. Reusing an opaque natural-key identity is not authority to overwrite/revive a hidden Customer, add a new origin that reveals unrelated history, or return duplicate-party details/counts. Actual ensureRole child creation independently requires child capability/source and gives the new Customer/Supplier proven usable origin. All real writes/PII and required audit use the actual outer retryable transaction; no internal root commit or swallowed required evidence.
- [x] Preserve Customer.salary as customer income, not employee payroll. Add owner-editable sensitive.customer-identity.read (ดูเลขประจำตัวลูกค้าและผู้ปกครองเต็มเลข) for full customer/guardian national IDs, independently paired with base read at the same proven source. Without it retain safe masking; never primary role or raw ciphertext/hash. Future BRANCH_MANAGER, FINANCE_MANAGER and ACCOUNTANT templates include the key; OWNER retains persisted universal authority, other templates do not receive it by default, and saved positions remain unchanged. Apply actual scope to masked/full fields, search and duplicate responses as well as normal reads; document/file references require independent current documents/source authority. Preserve unmanaged and public/customer authentication behavior. Mutation acknowledgements must not imply broad read grants.
- [x] Types/migration/shared tests/lint/coverage and meaningful affected consumer regressions, exact producer contract and owner-editable sensitive defaults, self-review/report/commit. No existing position migration. Publish UI explicit origin/input/masking and Tasks5/6/4.2/4.3 contracts; root owns independent review and final8.

#### Serial execution of Task 4.1.5.1

Execute the following three units with independent review. All ten parent methods and requirements above remain binding. Catalog/default changes add zero routes; the parent completes after four canonical writes and six basic queries are reconciled.

### Task 4.1.5.1.1: Configurable full customer identity capability defaults

**Files:** Shared employee-access catalog/defaults/tests and focused EmployeeAccessService saved-template tests only. Zero runtime routes, schema or source-policy changes.

- [x] RED/GREEN add GRANT key sensitive.customer-identity.read with Thai label ดูเลขประจำตัวลูกค้าและผู้ปกครองเต็มเลข in sensitive group; future BRANCH_MANAGER, FINANCE_MANAGER and ACCOUNTANT include it, other assignable defaults do not. Persisted OWNER remains universal through existing evaluator.
- [x] Owner can configure this key by position; no source/base customer/contact capability accompanies it. Prove initializing future templates does not rewrite existing saved positions/grants or migrate real employees. Do not implement PII projections or change source/read behavior in this catalog-only unit.
- [x] Shared tests/build, affected lint and focused saved-template regression; self-review/report/commit. Publish exact key/default contract for later source/read/write/UI consumers, no route count.

### Task 4.1.5.1.2: Explicit party origins and canonical customer/contact writes

**Files:** Same shared engine plus Customer/Contact source resolver, additive scalar-origin/assignment schema/DTO/migration, canonical CustomerWrite/ContactResolver/Contacts ensureRole helpers and narrow managed write adapters. Four methods: CustomersController.create, update, remove; ContactsController.ensureRole.

- [x] RED real owned PostgreSQL/Nest HTTP legitimate scoped success/no-grants for all4, original tuples and source/current-authority changes. New genuine explicit-origin leads must be usable in earlier trade-in/sales/booking/repair/after-sales selection through reusable party predicates; no arbitrary/global party fallback or fake actor/branch. Producer tests do not complete the later six public queries.
- [x] Add nullable immutable scalar Customer/Contact company/branch origins. SHOP requires actual live SHOP branch; FINANCE permits true central null branch or explicit live SHOP origin branch. Stamp only genuinely new identities from authenticated authorized destination. Preserve existing origins on natural-key reuse, ghost revival and stub upgrade; no guessed historical backfill or new multi-origin editor. Reuse same-party persisted historical source evidence and explicitly false no-tuples behavior.
- [x] No autoassignment. Explicit choice/change of active non-system business assignee requires corresponding customers.update/contacts.update through COMPANY or BRANCHES authority at actual source independent of proposed/current assignee, plus actual create/child authority when provisioning. ASSIGNED-only cannot self-capture/reassign to gain scope. This changes business assignment, never employee positions/grants. Current assignment changes must be audited and rechecked; historical assignment is not current authority.
- [x] Shared Customer core update/delete/revival/enrichment requires base read and actual action at every proven affected current source, including explicit origin and all genuine linked sources across companies. Contact global identity/role mutation likewise checks its own origin plus linked Customer/Supplier/direct seller sources. Explicit origin is not an override for other affected sources. Business reassignment requires non-ASSIGNED update authority over the same set; Contract/room assignments never substitute for Customer/Contact assignment. Pure idempotent reuse without mutation may use actual scoped parent action/read and child read. A linked global ExternalFinanceCompany additionally requires COMPANY Contact read/update in both live SHOP and FINANCE for shared Contact mutation, pending finer provenance in owning4.2; it grants no lender-sensitive read.
- [x] Preserve normalization/validation/encryption/hash and canonical national-ID/phone/email uniqueness, lock order, global contact numbering and actual ghost/stub rules. Existing revival/enrichment needs read/update on actual proven existing source; narrow deleted-record revival retains source proof. Archived natural-key Contacts are existing identities: narrowly revive a unique active archived Contact only under all-source Contact read/update, preserving its origin/code/assignment; exact ghost-link evidence may prove original source. Conflicting live matches, multiple archived candidates, inactive Contact or unresolved origin must not create replacement visibility or silently merge/reactivate. Unknown duplicate identity returns generic conflict without identity/history/counts. EnsureRole independently authorizes actual Customer/Supplier child action/source, creates usable origin and preserves idempotent relationships. Reuse opaque natural keys without overwriting hidden records or stamping new visibility on existing Contact.
- [x] Actual raw business loads and all canonical child/status/PII/required audit writers join the same owned retryable transaction. No broad read projection/legacy role as mutation authority, inner commit, compensation or swallowed required evidence. Prove late failure rollback and real concurrency/unique behavior. Managed action response is narrow/source-safe, never raw ciphertext/hash/hidden history; full-ID output uses reviewed independent capability on same proven source.
- [x] Publish reusable typed origin/assignment/alias/current-source/party query/PII/action/transaction contracts. Ordinary FINANCE history source is live FINANCE plus actual live SHOP Contract origin, with genuine Contract.assignedToId valid for ordinary case reads; independent child reads required, no expansion of exchange approval. Narrow chat read provenance uses canonical WORK_CHANNELS and actual room assignment; branchless rooms require COMPANY or unrestricted ASSIGNED, not staffbranch/alias. Broad child queries remain .1.3/4.2/4.3, never complete by helper alone.
- [x] Shared/API types/migration/changed lint/coverage and meaningful affected prior party-consumer regressions, report/self-review/commit. No real users/positions migrated. Final fullJWT/browser/local:check remains8; six query adapters and parent10 remain pending.

**Review evidence note:** Complete through `52b92e244` after full review and scoped Fix1 review. Four actual write adapters, immutable origin/current business assignment, all-source shared mutation and archived Contact preservation are covered by owned PostgreSQL/Nest HTTP evidence. Fix1 proves read-only referrer selection with invalid sibling provenance and correct Prisma relation inputs. Evidence is a full30 pre-final-additions run, archive7/lender3 and final referral7 focused runs, not a final full41 run. Prior consumer95 and canonical103 regressions passed with affected refreshes. Earlier initialPOST404 remains unexplained/unreproduced; final actual JWT/guards/browser/local preview belongs to8. Query6 and parent10 were pending at that checkpoint and are completed by the following reviewed unit.

### Task 4.1.5.1.3: Basic customer/contact queries and parent10 closure

**Files:** Reviewed party origin/source/projection engine plus CustomerQuery, CustomerPurchaseSummary, CustomerChatRooms, CustomerTier and necessary real contributor helpers; Contact reads and actual adapters. Six methods: CustomersController.findAll, findDetail, findOne, search; ContactsController.list, findOne.

- [x] RED real owned PostgreSQL/Nest HTTP all6 positives/no-grants, current source/assignment and original company/branch tuple isolation, new origin and historical same-party evidence. Read authority is independent of action-only write acknowledgements and does not expose whole alias-family histories.
- [x] Scope actual contributing Contract/Payment/Sale/Product/credit/chat/referral/supplier/trade-in/tag records before filters, counts, pagination, ranking and nested details. Preserve complete existing findAll purchase/credit/overdue/assignment/contact-time/channel/tier/KPI semantics through authorized inputs; no masked fields over unscoped filter/aggregate. COMPANY and real ASSIGNED positives work; genuinely unresolvable old room origins remain unavailable, with explicit4.3 origin seam rather than invented staffbranch.
- [x] Reuse genuine FINANCE Contract origin and case-assignment read contract, preserving independent actual child permissions and current Product versus historical Sale semantics. An actual currently assigned Contract/room may provide read-only same-customer identity evidence with customers.read plus the actual child read on that same source; no redundant direct Customer assignment is required. Keep this separate from all-source global identity mutation/assignment, and do not inherit Contact master assignment or sibling histories. SHOP warranty identity/status alone never grants FINANCE balances. Scope room-derived filters/metadata through canonical WORK_CHANNELS, actual room assignment and live company; no legacy role or prospective customer branch as history authority. Distinguish unavailable/incomplete from true zero/none while preserving legitimate filtered outcomes.
- [x] Preserve a separate SHOP warranty/purchase projection in these Customer queries: actual same-customer historical SHOP Contract identity/status/dates and independently authorized current Product may support visible purchase/latest/warranty and view membership. Reuse the narrow warranty producer without requiring repair capability solely for helper reuse. Full FINANCE histories, balances, payments/collections/MDM/tier remain independently authorized; a warranty number does not authorize full Contract navigation.
- [x] CreditCheck history needs a genuine same-customer Contract or RoomCreditAnalysis/room source with independent child and credit-checks.read authority. Unlinked historical rows remain unavailable, not guessed global FINANCE; owning4.2 must supply explicit new origin and a reviewable historical repair/migration seam, then integrate it here before whole-program closure. Manual tag enum needs same-proof customer/tag read; AUTO tags use canonical read-only recomputation only under explicit COMPANY FINANCE contracts/collections/device-returns/repossessions read coverage, independent of hidden-row presence, with actual contributor/backlink validation and unknown distinct from empty. No stored AUTO reasons or broad annotation text is exposed.
- [x] Global Customer credit-status completeness requires fixed COMPANY coverage of all linked Contract/room credit-source domains before actual provenance validation; do not infer broad coverage from actual-versus-readable row counts. Keep scoped latest-check status/score useful. checkingCredit/prechecked KPIs are null if any Customer in the full scoped filtered set lacks verified complete global status; zero only for complete counts. Prove hidden-check insertion cannot alter scoped status/filter/KPI/availability and retain full-COMPANY and unlinked-unknown controls.
- [x] Linked global lender reference is narrow id/name/isActive with paired COMPANY contacts.read and external-finance.read in either live work company; global Contact mutation still needs both. Recognized persisted CHAT_channel acquisition labels use matching currently readable room or COMPANY chat.read in the encoded live company; AI_CHAT without channel requires actual room proof. Customer origin does not substitute for historical room provenance. Use identical source/availability policy in response, filters and KPI.
- [x] Managed list view and negative relation membership uses the authorized contributor set: permit partial prospects for assigned-room workers without FINANCE access, with explicit typed purchase/view incompleteness and unknown global fields/counts. Never assert globally never-purchased from an empty authorized subset. Prove hidden purchase changes do not change membership/count/coverage, while newly authorized purchases can. Publish required UI7 partial-view labels; global AUTO-tag completeness remains separate.
- [x] Reuse canonical query/helper behavior with explicit typed contributor predicates and availability. Any bounded CustomerWhere composition must enumerate supported shapes, fail closed on unknown nodes and preserve correlated AND/OR/NOT/some/none/every semantics; no generic Prisma proxy or duplicated managed query pipeline. Test hidden-contributor noninterference and actual negative/nullable filter behavior.
- [x] Full customer/guardian national IDs require sensitive.customer-identity.read and base read on the same proven source; preserve masking otherwise, no primaryrole fallback. Apply to search and nested/referrer/duplicate/Contact projections; ciphertext/hash never projected. Customer.salary is customer income, not payroll. Document links and sensitive product/financial values need independent source/field rights before inclusion. The unclassified Customer.documents array additionally needs same-proof full-ID authority; otherwise expose typed unavailable without counts/URLs. Document6 must close validated attachment/storage provenance and usable upload/remove behavior.
- [x] Actual current snapshot/exact client and captured child queries use existing execution contract. Existing PII/evidence capture reflects real masked/full behavior without secrets or fake actors. Recheck shared helper changes against prior trade-in/sales/repair/after-sales and canonical write4 consumers.
- [x] Types/lint/coverage/focused regressions; reconcile exact10=write4+query6 registrations and actual success/denial evidence, with zero catalog-only route credit. Report precise producer/API/PII/new-origin/UI and remaining derived11/merge6/journey4/FINANCE/chat/audit/approval/fullguard contracts; self-review/commit. Root marks parent after independent review.

**Review evidence note:** Query6 and parent10 are complete through `bf7b21b57` after full review and scoped Fix1 PASS. The six actual query routes have real owned PostgreSQL/Nest success/denial evidence; source-scoped filters/counts/ranking/PII and separate SHOP warranty remain in canonical helpers. Fix1 excludes archived current Products while preserving historical purchases and replaces unnecessary per-Customer credit reads with filtered batches and fixed-authority short circuits. Evidence: full57 plus final8 focused after the last cache edit, affected canonical48; the initial query unit also ran prior consumer76 and canonical129. Parent10 is exactly write4 plus query6, with catalog/default work adding zero routes. M1 nullable inferred types is carried to derived/UI work; M2 runner noise and actual JWT/guards/browser/preview remain final checks. Derived11, merge6 and journey4 are still pending.

### Task 4.1.5.2: Customer derived histories, analytics and export

**Files:** Reviewed identity/source engine plus customer query/analytics/purchase/chat/credit-insight/tier helpers. Eleven methods: CustomersController.exportRows, getChatSummary, getContracts, getInsights, getReferrals, getReferralStats, getRiskFlag, getSummary, getTier, getUpsellCandidates, getWatchList.

- [x] RED real owned PostgreSQL/Nest HTTP positive/no-grants across11, independent current child sources, original tuples/alias isolation and sensitive output/search/export. Reuse reviewed identity/source contracts; customer existence permission never grants complete FINANCE/chat/history.
- [x] Scope actual Contract/Sale/Payment/call/credit/referral/chat/points contributors before counts, statistics, status/risk/tier, ranking, limits and exports. Preserve canonical financial/state formulas, dates/cursors and contributor identity. Authorized filtered outcomes and unverified/incomplete outcomes must be distinguished; no hidden-source existence/count leaked via labels, negatives, default zero or rankings.
- [x] Correct the demonstrated derived read-model defects without changing canonical formulas: watch counts include each scoped Payment once and next-due date/amount use the same eligible row; both summary balances reuse UNPAID_INSTALLMENT_WHERE/outstandingOf exactly. Select recent five distinct authorized installments before fetching their complete validated receipt partials. Preserve unrelated thresholds/status/eligibility/tier and money writers; actual baseline/canonical regression evidence must distinguish the corrected1800 expectation from the initial untested1700 text.
- [x] Export uses exact domain export plus independently required source/document/sensitive grants and the existing consistent-snapshot/row-limit behavior. Managed export uses the exact owned Serializable transaction and transaction_timestamp without nested READ ONLY; a finite internal60000ms option is selected only by this export adapter, leaving other domain requests at30000ms and standalone export behavior intact. Preserve whole-attempt current checks and release results only after commit. CSV/JSON/HTML inputs, free text, national IDs and links use the same source-safe field contract; no masked display over unscoped search/aggregate. Current Product cost/profit stays separate from historical sales and real contract balances.
- [x] Actual captured child queries and required evidence join the existing owned execution; no parallel engine. Publish named actual FINANCE/chat source predicates/adapters still pending, without permanently suppressing legitimate data. Cover earlier basic detail/list/search consumers if shared contributors change.
- [x] Focused covering tests/types/lint/coverage, source and Task5/6/7/8 handoff, self-review/report/commit. Eleven-route registration/evidence count only after independent review.

### Task 4.1.5.3: Identity merge, contact enrichment and customer documents

**Files:** Reviewed party/source and canonical CustomerMerge/CustomerWrite/SkipTracing/ContactResolver/Contacts helpers; document/storage consumers and actual transaction audit. Six methods: CustomersController.absorbInto, fillContact, updateContact, uploadDocument, deleteDocument; ContactsController.merge.

- [x] RED real owned PostgreSQL/Nest HTTP all6 legitimate/no-grants with both parties, original tuple/current source controls, true alias relationships and hidden-source/forged-key denials. Shared identity selection does not authorize merging all histories.
- [x] Independently authorize both parties and all genuinely affected source relationships before canonical merge/absorb/enrichment. Preserve unique/conflict rules, duplicate phone/ID checks, alias cycle/depth guards, actual old/new immutable historical origins and canonical rollback. Re-resolve pointers after changes; no privilege elevation by aliases, actor identity or a supplied destination branch. Basic create stub/ghost and ensureRole producer contracts stay consistent.
- [x] Join all real linked updates/journey/PII/required audit in the actual retryable outer transaction; late failure leaves no partial merge/identity mutation. Audit summaries never expose raw PII/hash/ciphertext. Real concurrent/idempotent merge/enrichment must keep canonical invariants and safe errors.
- [x] Document metadata/keys/links need actual current party and document action/source authority; validate persisted provenance, not path prefix or caller-supplied URL. Preauthorize before storage/signing; reuse owned preparation/cleanup/effect hooks where I/O occurs. Never delete preexisting shared/source files due to another operation's failure; truthful generated/requested effects, no real providers in tests.
- [x] Focused regressions for basic and derived consumers, types/lint/coverage; exact source/alias/document/atomicity and UI/audit downstream contracts, self-review/report/commit. The broader Customer parent remains pending journey4.

#### Serial execution of Task 4.1.5.3

The six-route parent is implemented in three reviewed units below. Enrichment establishes the current transaction and identity-write contract; merging consumes it for genuinely affected relationships; documents owns the actual storage/provenance contract and closes the parent. No route is omitted or counted twice. Any necessary new authenticated file route must be explicitly added to the manifest and total, with positive/denial evidence.

### Task 4.1.5.3.1: Placeholder and skip-tracing contact enrichment

**Files:** Existing CustomerWriteService.fillPlaceholderContact, SkipTracingService.updateContact, CustomersController.fillContact/updateContact, reviewed party boundary/source helpers and the exact two-handler managed AuditInterceptor projection. Exactly two existing routes.

- [x] RED owned PostgreSQL/Nest HTTP both legitimate and no-grants outcomes; genuine current identity sources across SHOP/FINANCE, original tuples, exact business assignment, unknown provenance and hidden duplicate identities. A room/case read assignment alone cannot authorize changing shared identity.
- [x] Reuse canonical phone normalization/locking/encryption/uniqueness and placeholder rules. Authorize customers.read/update on every actual affected identity source inside the reviewed owned transaction; do not reintroduce managed legacy-role exceptions or broaden origins/assignments. Preserve the distinct same-phone repair and secondary-phone fallback behavior while preventing disclosure of an inaccessible phone owner's identity.
- [x] Join required audit and CONTACT_ADDED journey evidence to the actual retryable transaction, with safe field-change metadata and current actor. Generic conflicts must not expose hidden customer/contact IDs, names, hashes or ciphertext. Return a precise narrow acknowledgement; any optional visible duplicate suggestion needs its own actual read proof.
- [x] For skip-tracing, CONTACT_ADDED via UPDATE records only a genuine absent-to-present primary phone using canonical decrypted prior state; replacement, encrypted-only same-phone repair, secondary fallback, LINE and LOST changes use safe durable audit without a false contact-added event. Retain required reason validation, but reasonProvided is only interim safe metadata, not retained reason meaning. Task5/UI7 must complete meaningful safe reason capture before whole-program rollout; explicitly report that remaining dependency.
- [x] Close the actual outer AuditInterceptor bypass for these two exact managed handlers: generic success/error request evidence contains only known present-field names and safe outcome/status/duration/reasonProvided, no raw body/response/free-text error. Preserve legacy/other-route behavior and distinguish this request evidence from the required atomic mutation evidence. Exercise actual outer AuditInterceptor/inner AccessPolicyInterceptor with allowed, denied and late-failure controls; central audit redesign remains Task5.
- [x] Cover late evidence rollback, canonical duplicate/conflict races, current authority waits, unchanged legacy/customer callers and relevant reviewed write/query regressions. Publish managed response types and UI/audit handoff, self-review/report/commit. Parent merge/document work remains pending.

Completed at `ba54a9692` after independent spec/quality review (0 Critical, 0 Important, 1 deferred test-hygiene Minor). Final amendment evidence: enrichment42 + legacy/audit85; earlier basic/query/derived140 retained separately. Task5/UI7 meaningful safe reason capture and root full-guard/browser/preview verification remain mandatory later gates.

### Task 4.1.5.3.2: Canonical customer absorption and contact merge

**Files:** CustomerMergeService, ContactsService.merge, existing alias/journey/identity writers and reviewed source helpers. Exactly CustomersController.absorbInto and ContactsController.merge.

- [x] RED real PostgreSQL/Nest HTTP both permitted and no-grants paths, both parties, original tuples, actual alias family and every genuinely changed child source. Inventory canonical changed relations before choosing their required actions; visibility of the two identities does not authorize moving their histories.
- [x] Authorize current source and destination identities and each changed relationship, preserve immutable origin/current assignment, existing blocking relations, partial-unique ordering, placeholder direction, alias cycle/depth rules and canonical deduplication. Preserve distinct public/customer/system linking principals. Existing classification keys are inventory evidence, not proof that a secondary child action is authorized.
- [x] Apply the finite reviewed-source matrix for each actual moved child, including archived rows and bounded20 alias maintenance, without broadening ordinary live readers. Pure identity-link/cache/dedup maintenance cannot change business state or infer source from JSON/actor; preserve source-paired child capabilities, canonical room-linked Product-click provenance and generic denial for unsupported references.
- [x] Join all real linked updates, required journey/PII/audit to the existing owned retryable transaction; defer best-effort cache recomputation/effects until actual commit. Late evidence failure leaves no partial reparenting, alias or soft-delete. Use safe conflicts and narrow acknowledgements with no hidden source counts/details.
- [x] Verify real concurrency/idempotency, current authority, generic hidden blockers and regressions of enrichment/basic/derived consumers. Publish exact alias and source contract for journey4, self-review/report/commit; no document adapter credit.

Completed through `df56757c5` after independent full review and scoped Fix1 review. The current-evidence row-lock finding is closed with real PostgreSQL RED7/GREEN7 and final69/69; API types and owned-file lint pass. One test-hygiene Minor and the explicitly assigned journey/activity/UI/full-authentication checks remain later gates. Exactly two merge adapters are counted.

### Task 4.1.5.3.3: Customer document provenance and usable file flow

**Files:** Existing CustomerWriteService document helpers and DTOs, canonical storage, reviewed party projection/boundary, necessary additive schema and explicit authenticated file read surface. Own existing CustomersController.uploadDocument/deleteDocument plus any explicitly justified new route.

- [x] RED actual permitted/no-grants upload/remove and source-authorized file read using isolated local bytes; forged URLs/keys, source changes, full-ID/document pairing, unconfigured storage and actual rollback/cleanup. Current UI dataURL versus HTTPS DTO mismatch and absent persisted file provenance must be resolved with a concrete usable contract.
- [x] Design and implement persisted attachment provenance before exposure or storage/signing/deletion; a caller URL, filename, MIME label or path prefix is not authority. Preserve legacy files/metadata and distinguish unclassified legacy documents from verified new attachments. Reconcile correct identity/document action keys explicitly; never silently grant customers.create/delete merely because those were heuristic route classifications.
- [x] Stage owned bytes only after authorization, use bounded actual file validation and existing preparation/cleanup/effect hooks, and release authorized file responses only after required current evidence commits. No arbitrary external fetch, fabricated local signed URL, success with absent storage, or deletion of preexisting/shared files on failure.
- [x] Preserve immutable attachment origin and verified typed source; discover through a bounded verified alias family without reparenting files or copying target authority. Support the seven existing genuine source families in R54, with exact child read, current assignment and original/current scope checks; source/correlation evidence is locked before use.
- [x] For arbitrary unclassified Customer files, require same-source customers.read + documents.read and all five existing sensitive-read keys before identifiable metadata/content; this supersedes the prior full-ID-only legacy array projection. No caller label certifies content. Preserve legacy arrays as unverified metadata without trusted download URLs or arbitrary fetching. No saved/default grants are changed.
- [x] Keep blind upload usable with base Customer/typed-child read plus documents.create, without requiring file-read/sensitive grants solely to submit bytes. The list/source-selector boundary must return only independently authorized minimal uploadSources even when file metadata is unavailable. Return narrow acknowledgements; soft-remove uses documents.update plus full visibility, retaining bytes.
- [x] New validated byte flow accepts1..10MiB JPEG/PNG/WebP/PDF and explicitly rejects HEIC/GIF without claiming conversion. Preserve one owned staged object across retries, conditionally clean only provably owned terminal-failure objects, and release private buffered content after required evidence commits. Per R59, retain local objects and S3 objects without a genuine version identity rather than risk deleting a replacement; report a finite safe cleanup outcome and document resulting retained storage. GCS uses generation and versioned S3 deletes only the verified version. Add exactly the justified list/content authenticated surfaces and reconcile totals.
- [x] Apply safe request evidence to the exact managed upload/delete/list/content handler identities: no raw file/body/key/URL/name/error text. Required canonical document evidence is transaction-owned; general audit/denial consolidation remains Task5.
- [x] Provide exact typed list/upload/remove/download contracts for UI7 and actual local preview8; update shared query projection and covering regressions without bypassing full-ID protection of unclassified files. Reconcile manifest/route totals if adding a new surface, self-review/report/commit. Close six existing parent adapters only after every subunit review passes.

Completed through `23bb232ae` after independent full review and scoped Fix1 review. The replacement-deletion finding is closed under R59: local failed staging is retained, S3 cleanup requires an exact genuine VersionId, and GCS uses generation. Safe cleanup results preserve the original request error; retained storage has no automatic collector. Final Fix1 evidence is46 owned document HTTP tests plus100 unit tests; earlier296 integration/93 unit evidence remains separately recorded, not added as a new final run. Existing upload/remove plus two new list/content routes add four reviewed adapters. The six baseline enrichment/merge/document adapters and two additions are complete; journey4 and the broader Customer parent remain pending. Stream acquisition/fence timing4.4, safe activity5, UI7 and real JWT/browser/preview8 remain explicit later gates.

### Task 4.1.5.4: Customer journey and parent closure

Checkpoint R60–65 is recorded in the progress ledger and `task-4.1.5.4-checkpoint-rulings.md`: finite linked business sources; all-source shared manual facts with independently proven original identity; minimal COMPANY loss-complete gate for create and undo; configurable moderation; canonical filtered CTE with nullable source coverage; exact owned evidence and postcommit recompute. No current-Product or PaymentLink origin fallback.

**Files:** Reviewed party/source engine plus customer-journey source adapters/state/summary/manual entry helpers. Four methods: CustomerJourneyController.createEntry, list, removeEntry, summary.

- [x] RED owned PostgreSQL/Nest HTTP all4, authorized multi-source success and absent/foreign-source denial, genuine alias-family scope, current authority and search/cursor/aggregate boundaries.
- [x] Resolve each actual Sale, Contract, Payment, collection, credit, service, points, chat and manual-entry source before pagination/count/stage/summary/activity probes. Visible customer/merged identity does not grant every history. Preserve existing order/timezone/cursors and public/customer/cron separation. Project dynamic free text, files, IDs and derived snippets from current authorized contributors.
- [x] Manual create/remove requires actual current source and action; preserve canonical creator/business checks and durable immutable evidence. Captured child queries/writes use the existing owned transaction, no best-effort success for required mutation evidence. Distinguish legitimate filtered summaries from genuinely unproven sources.
- [x] Reconcile all33 current runtime adapters (31 baseline plus two document additions)/positive-denial evidence and cross-unit current/source/alias/sensitive/atomicity contracts, including prior shop consumers. Publish remaining named FINANCE/chat/automation/audit/approval/UI/fullguard obligations precisely; no missing source or internal helper counted as complete.
- [x] Covering regressions/types/lint/coverage, final parent report/guide, self-review/commit. Root marks parent only after independent review and owns final8 checks.

**Review evidence note:** Journey4 and the broader Customer parent are complete through `9b98ba828`. Independent full review found six Important source/completeness/chronology defects; one fix wave and scoped rereview closed all six with no new Critical/Important/Minor findings. Final Fix1 evidence is38 owned HTTP tests and359 canonical tests across35 suites, plus types/lint; earlier covering297 integration/100 unit and producer/shared runs remain separate historical evidence. Exact actual manifest33 = registered33 = disjoint reviewed units33 (Customer25 + Contact4 + Journey4). Managed summary is an authorized-sources nullable facts contract, not the global cached summary. Finite source/canonical/manual/moderation rules R60–66 and immutable original identity remain binding. Inherited runner noise, full JWT/guards/browser/preview8, named FINANCE/chat/automation/audit/approval/UI and performance obligations remain open in their own tasks.

### Task 4.1.6: SHOP scope closure

**Files:** Remaining SHOP controllers/services from checked manifest and common scope/projector infrastructure, guide and regression tests.

- [x] Reconcile Task 4.1.1–4.1.5 registrations against actual runtime methods and finish adjacent SHOP domains omitted by named-module inventory. No absent adapter counted as complete.
- [x] Cross-unit authorized-success and denial checks for tuple combinations, transferred records, shared sources and sensitive nested/file/aggregate output; current changes apply on next operation.
- [x] Types/coverage/isolated regressions and complete SHOP integration evidence; document clearly remaining FINANCE/operations phases. Self-review/commit; umbrella Task 4.1 complete after independent review.

### Task 4.1.6.1: Tender close/deposit and imported SHOP reports

**Files:** Canonical ShopTender/CashClose/CashHolding services/controllers, actual tender/Sale/Booking/Contract/accounting sources, scoped queries/projections, existing storage/document/effect hooks and ImportedSale provenance. Fourteen domain routes: ShopTenders12 + ImportedSales2, exactly as recorded in `residual-shop-planning-partition.json` in the plan workspace.

- [x] Owned PostgreSQL/Nest HTTP RED/GREEN for all14 authorized/denied routes, original tuples/current authority/source changes, independent child reads and scope before count/overview/history/sum/limit. Resolve genuine tender ASSIGNED semantics from canonical workflow; creator/receivedBy/legacy role is not inferred assignment. Empty branch scope denies.
- [x] Preserve canonical cash-close counter-versus-confirmer checks, states, Decimal counts/held balances/partial posting, period-checked SHOP journals and CAS/concurrent once-only effects. Discount owner self-approval does not waive other maker/checker rules. Actual tender/deposit/journal/required-audit writes join the owned transaction; stage slips once with owned cleanup. Prove late audit/journal failure rollback and concurrent duplicate behavior. No bank integration or real provider calls.
- [x] Slip reads require the actual record plus document authority at its persisted source/key before storage. Bound bytes and release them only after the actual commit using the reviewed stream contract; no caller path authority or false paper/delivery claims.
- [x] ImportedSales remains historical POS statistics without journals on read. Verify server-owned TOOLTIFY provenance before explicit central SHOP COMPANY authority; never guess a branch from shopLabel, salespersonName or actor. Unknown source denies. Apply independent cost/profit policy to rows, buckets and totals. No production import/backfill.
- [x] Focused current-authority/financial/file regressions, types/lint/coverage and precise producer/UI/Tasks5/6/8 handoff; self-review/report/commit. Root independently reviews before counting14 complete.

#### Serial execution of Task4.1.6.1

Checkpoints R67–74 and R76 are recorded in the progress ledger and task-4.1.6.1-checkpoint-rulings.md. Parent14 splits into read/source7 and money/file7. Stable cost-complete financial decisions coexist with useful blind count; actual owner receipt is distinct from configurable OWNER_HOLD deposit. Original tuples/current source history remain binding, and cost-only purchasing remains distinct from profit-report rights. New action templates never mutate saved positions.

### Task 4.1.6.1.1: Tender source/read projections and imported history

**Files:** Reviewed shared executor/source/projector, canonical ShopTender read services, ImportedSales provenance/service, ordinary catalog/shared contracts. Exactly7 domain routes: ShopTendersController.getDailySummary/getCashCloseStatus/getCashCloseHistory/getCashCloseOverview/getCashCloseReminder and ImportedSalesController.list/summary.

- [x] Owned persistent marked PostgreSQL/Nest HTTP RED/GREEN all7 with useful positive/no-grant/foreign/current/original-tuple controls; preserve actual archived money provenance, finite kind/document/reversal correlation and scope before limits/counts/groups/duplicate probes.
- [x] Publish reusable exact-client source-complete versus visible-source contracts for later writes. Preserve canonical full drawer math; missing cost yields stable nullable expected/variance/net/holdings/settlement projections, never filtered subtotal presented as complete. Counter selectors use current configured action scope, never historical operator/legacy role as ASSIGNED.
- [x] Add R67 ordinary count/confirm/deposit/deposit-owner-hold capabilities and future-only template changes, no automatic saved-grant migration. Their writes/streams remain childB scope and receive zero completion credit here.
- [x] Imported genuine TOOLTIFY uses explicit central SHOP COMPANY, immutable source/no insert default/no backfill, unknown excluded before rows/buckets/totals. Cost requires cost; profit requires both cost and profit; preserve UTC months/Decimal/statistics-only semantics. No formula/real importer/journal change.
- [x] Exact safe request projection, shared nullable/API contract and UI7/source-B/audit5/closure4.4/final8 handoff. Relevant canonical regressions/types/lint/coverage, self-review/report/commit and independent gate; root owns full JWT/browser/localcheck/preview8.

**Review evidence note:** Complete at `73263bef3`; initial independent review found a blind-overview settlement leak through representative selection, fixed and independently re-reviewed with no new Critical/Important findings. Final48 owned HTTP and19 canonical PostgreSQL tests passed; earlier60 unit tests and initial scoped coverage remain separate evidence. Shared47 is prior tool-reported evidence without a retained test log. Exact7 reads only; parent14, money/file B7 and all downstream gates remain open. Inherited forced-exit/fixture warnings are recorded for Task8.

### Task 4.1.6.1.2: Cash lifecycle, private slips and parent14 closure

**Files:** ChildA source/projection contract, canonical ShopCashClose/Holding state machine, immutable narrow slip evidence/storage hooks and actual SHOP journal/audit/effect paths. Exactly7 domain routes: countCashClose, confirmCashClose, sendBackCashClose, attachDepositSlip, createCashDeposit, getCloseDepositSlip and getCashDepositSlip.

- [x] Owned marked PostgreSQL/Nest HTTP RED/GREEN all7 with useful blind count and configured reviewer/executor positives, absent/foreign/current original tuple negatives, source-row waits, counter!=checker including owner and actual OWNER_HOLD receipt versus extra configurable deposit custody capability.
- [x] Fixed trimmed5–500 managed counting note validated before hidden expected queries and retained independently of variance; narrow fixed acknowledgement. Complete branch/current cost authority for decision/deposit and actual valid full drawer inputs. Preserve canonical Decimal math, movements, states, locks, CAS, period-checked SHOP journals and partial historical posting.
- [x] Stage slips once outside the fence, independently require documents.create, final current reauthorization, immutable source/content identity metadata and actual-tx audit. Retain prior committed evidence and close-slip bytes across managed and unmanaged replacements/unused destinations (R76); R59 owned cleanup only on terminal failed staging. Both read routes require source plus tender/documents.read and same-source sensitive.cost.read, with bounded private verified bytes released after commit. Distinguish authorized slip presence from current canReadSlip content authority. No caller paths, real provider, physical-print/delivery/bank claim.
- [x] Required actual transaction rollback on late journal/audit failures, current source after lock waits, duplicate/concurrent once-only effects. Fixed generic per-event owner review tasks after commit, no variance-dependent public signal or sensitive payload; explicit Todo4.3.12 and Audit5 contracts.
- [x] Final relevant canonical/read7 regressions/types/lint/coverage, precise nullable/blind/file/UI and4.4/5/6/7/8 handoffs, exact14 actual registration/positive-denial reconciliation and report/self-review/commit. Root marks parent only after independent gate; no whole-program/real-user rollout claim.

**Review evidence note:** Complete through `4b70582ba`; initial independent review found legacy operations could delete committed slip bytes, corrected under R76 and independently re-reviewed with0 new Critical/Important/Minor findings. Final B33 owned HTTP and19 canonical PostgreSQL tests passed with types/lint/diff0. Earlier A48/unit60/shared47 and initial B29 coverage are separately qualified retained runs. Both disjoint7-route children reconcile exactly14 actual registrations with useful authorized/denied evidence. Parent14 is complete; Todo4.3.12, storage/performance4.4, audit5, reserved approvals6, UI7 and real JWT/browser/localcheck8 remain required.

### Task 4.1.6.2: Sticker output, pricing and promotion references

**Files:** Stickers7, PricingTemplates7 and Promotions4 domain routes plus three adjacent owner staff CRUD routes. Actual Product/Sale/Customer/PromotionUsage sources, explicit reference policy, narrow output and canonical promotion writer.

- [x] Actual HTTP positive/no-grants controls for all18 domain routes and adjacent3, current authority/original tuples, scoped batches/order/limits and empty-scope denial. Distinguish global template CRUD from per-Product output; explicit global/company policy cannot be replaced by invented branches or legacy roles.
- [x] Sticker batches up to100 resolve/deduplicate actual ID/IMEI inputs while preserving requested order and canonical missing-item behavior. Empty remains empty. Check every current Product source and output/document field; preserve its actual price without a central template fallback. Required print/request evidence must describe observed effects honestly.
- [x] Keep canonical pricing template validations, selling price/down payment/term formulas. Template monetary fields are not acquisition cost merely by name. Protect actual cost/profit fields independently; template authority does not grant Product usage/counts.
- [x] Global promotion definitions do not grant Sale/Customer usage history. Apply-to-sale verifies actual Sale/Customer backlinks, eligibility and any independently required Product authority. Canonical usage-limit CAS, usage row and required audit join the owned transaction. Prevent caller discount amounts or stale approval bypass; consume the reviewed interim discount contract and publish Task6 fingerprint integration. Preserve public ShopPromotions authentication/projection and reconcile the three owner-reserved CRUD routes separately.
- [x] Cover affected Product/sales/customer behavior, types/lint/coverage; report18 domain plus3 adjacent staff routes without counting21 as SHOP domain coverage. Publish UI/approval/audit/source contracts; self-review/commit and independent gate.

#### Serial execution of Task4.1.6.2

R75 splits this parent into reference/output14 and promotion4 plus adjacent owner CRUD3. Reference policy/import integrity and promotion-benefit provenance are distinct review surfaces. Neither child earns the other's route credit. Global source/action and producer decisions still require each child's finite checkpoint; the split itself changes no business authorization. Binding design section1 permits staff to use owner-configured standard promotions immediately; extra discounts remain approval-controlled.

### Task 4.1.6.2.1: Physical stickers and shared pricing references

**Files:** StickersController7 and PricingTemplatesController7, actual Product sources, shared definition policy/catalog and canonical template CRUD/import; exactly14 SHOP domain routes.

- [x] First finite checkpoint: actual global reference read/write versus per-Product output authority, explicit correction of physical stickers' chat-library capability mapping, configurable actions/future-only defaults and exact source/tuple requirements. No invented company/branch/ASSIGNED or saved-position migration.
- [x] Owned marked PostgreSQL/HTTP RED/GREEN all14, useful authorized and current/no-grants/foreign/original-tuple controls; actual Product filtering before output/order/limits,100-key ID/IMEI dedup/order/missing/empty behavior. Preserve actual device price/warranty and truthful generated/requested evidence, no physical-print assertion.
- [x] Preserve selling/down/term template validation/default/formula behavior and independent sensitive fields; shared definitions grant no Product usage/history. Resolve bounded bulk-import complete/partial semantics, safe per-row errors and current actual-tx audit before implementation; catching a poisoned PostgreSQL statement is not recovery.
- [x] Current authority/source/config locking, useful mutations and late-evidence rollback; finite safe request/business audit and shared response contract. Canonical Product/pricing/sticker regressions, types/lint/coverage with honest retained evidence.
- [x] Self-review/report/commit and independent gate; publish UI7 StickerPrint/Pricing/ProductCreate/PurchaseOrders, SalesBot4.3/system4.4, audit5/full8 contracts. Parent18+3 remains open until promotion child and exact reconciliation.

**Checkpoint R77–R79:** Physical definitions retain stickers.read/pricing.read in a valid selected work scope. New sticker-templates.create/update/delete and pricing-templates.update require COMPANY grants in both SHOP and FINANCE; no saved/default position changes. Writes return {id}. Device data requires stickers.create plus actual same-source products.read, source-filtered ID/IMEI ordering and100 supplied nonblank keys before dedup; no arbitrary-file or physical-print claim. Both managed and legacy pricing import use bounded0–100 fully atomic batches, canonical validation/money/defaults and safe structural results/errors; invalid rows commit nothing. Full ordered rulings and costs are in the progress ledger and task-4.1.6.2.1-checkpoint-rulings.md.

**Reviewed completion:** `41b09acba..d7bbda6ef`; full review found one single-key parsing/source-lock race, observed RED then corrected and independently passed scoped Fix1. Final focused48/48 plus API types/touched lint/diff pass. Earlier canonical104/Product35/shared99/web20 and pre-Fix1 five-file coverage are separate evidence. Exact14 bring reviewed SHOP to269 of280; promotion4 and loyalty/defect7 remain. Full JWT/guards/browser/localcheck8, audit5, UI7 and bot/system4.3/.4 handoffs remain required.

### Task 4.1.6.2.2: Promotion eligibility, canonical benefit and usage

**Files:** PromotionsController4 domain routes and3 adjacent owner-reserved CRUD, genuine Sale/Customer/Product sources, canonical three-type CASH/EXTERNAL_FINANCE sale benefit producer/immutable provenance and usage CAS; exactly4 SHOP domain plus3 separate staff routes.

- [x] First finite checkpoint (resolved R80–R84): source/action matrix, global owner configuration versus definitions and scoped usage, finite supported conditions/types and genuine server-established benefit producer. Owner-configured standard promotions are immediately usable by authorized staff; arbitrary caller amounts or scalar Sale.discount never prove a named benefit. Extra discount retains reviewed approval boundary and final6 fingerprint integration.
- [x] Owned marked PostgreSQL/HTTP RED/GREEN all4+3 useful positives/denials/current/original tuples; actual active Sale/Customer/Product correlation and current definition eligibility. Scope usage counts/history before aggregates/limits; no hidden transactions from global definitions. Preserve separate public active/quota-safe projection.
- [x] Reuse canonical money writer with minimal typed immutable promotion evidence, no second repricing/journal executor or guessed old backfill. Usage recording cannot change completed sale economics. Current definition/source lock and cap CAS, once-only benefit/usage/required audit in owned transaction; duplicate/concurrent edit/max/date/source changes and late audit rollback.
- [x] Preserve canonical finite money/type behavior; unsupported historical arbitrary conditions are explicit, never silently applied. Exact UI7 and source4.4/approval6 producer contracts, relevant Sales/Customer/promotion regressions/types/lint/coverage; self-review/report/commit.
- [x] Reconcile exact4 domain+3 adjacent routes against independently reviewed useful authorized/denied evidence. Parent18+3 remains open until the required SPECIAL_RATE producer4.1.6.2.3 also passes; no helper-only or unsupported-type completion.

**Checkpoint R80–R84:** New future-only promotions.apply, current original-source tuples and safe visible usage counts; finite typed conditions and exact accessory benefit; atomic immutable named benefit/usage/quota with canonical Sale money writer. Idempotent verification preserves completed evidence after config changes while rechecking current access. Actual locked Product/Price baseline, standard promotion separate from extra discount. Full ordered rulings/costs are in the ledger and task-4.1.6.2.2-checkpoint-rulings.md.

### Task 4.1.6.2.3: Genuine special-rate Contract promotion producer

**Files:** Canonical Contract create/calculation/signing/activation and installment Sale linkage; shared named promotion definition/evidence/usage contract from4.1.6.2.2. Producer slice earns zero additional domain route credit.

- [x] First finite checkpoint (resolved R86–R89): actual Contract rate producer, named selection/reservation/expiry/config-change/cancellation and signing semantics; current SHOP/FINANCE/source/action transitions and ordinary staff standard-promotion use. No fabricated proof from equal scalar interestRate, no completed Sale repricing or new calculation engine.
- [x] Implement genuine immutable named SPECIAL_RATE evidence bound to canonical Contract financial terms and actual activation-created INSTALLMENT Sale; current locks/eligibility/cap CAS, once-only required actual-tx usage/audit and no duplicate stock/JE/benefit. Preserve existing formulas, signing integrity and reserved extra interest-reduction approval; no historical backfill.
- [x] Owned isolated PG RED/GREEN real canonical producer success/denial/current-source/config/date/cap and concurrent/signature invalidation/activation rollback evidence, relevant Contract/Sale/promotion regressions/types/lint. Publish exact4.2.1/6/7/system4.4 contracts; actual managed Contract HTTP integration remains required4.2.1, no helper route credit.
- [x] Independent review, then reconcile parent18 actual SHOP domain = reference14+promotion4 and adjacent owner CRUD3 separately; all four declared promotion types must have genuine producers. Parent and SHOP phase remain incomplete while this producer is missing.

**Checkpoint R86–R89:** Financial DRAFT reserves occupied capacity and immutable complete rate/price/schedule terms; campaign changes cannot reprice committed terms. Actual draft cancellation releases once; activation consumes once; active cancellation retains history/quota. Separate FINANCE contracts.approve and new contracts.activate, with future FINANCE_MANAGER activation default only; independent current Customer/SHOP Product sources still required, no saved grant changes. Existing protected-owner Contract self-approval preservation requires a review reason and atomic audit, not an inferred general exception. Historical typed proof independently checks current FINANCE Product/Contract permissions alongside SHOP Sale/campaign authority. Minimal named-only joined canonical lifecycle and signature changes, original monetary RED, zero route credit; full ordered decisions and costs are in the ledger and task-4.1.6.2.3-checkpoint-rulings.md.

**Reviewed producer completion:** 925a0a1e4..c92fa98a3; independent spec/quality PASS under R86–R91,0Critical/0Important/2Minor. Original monetary/authority RED preceded runtime; full54 ownedPG before R91, then privacy RED4fail2pass and focused9+supplementaltradecredit1, amendedcanonical40, earliercanonical397/priorpromotion70/shared47/types/lint all qualified retained passes. No combined61 or finalupdatedcoverage claim. R90 current preparation/staff capture and R91 currentowner-only legacy business exceptions plus safe active-contract errors are binding; scoped exception migration still requires4.2.1/4.4. Parent reference14+promotion4 reconciles18domain and3adjacentowner separately; all four finite promotion types now have reviewed genuine producers. SPECIAL_RATE adds0routes. SHOP remains273/280; loyalty/defect7 and FINANCE/operations/audit/approval/UI/finalverification remain open.

### Task 4.1.6.3: Loyalty and direct defect exchange; SHOP closure

**Files:** Loyalty4 and DefectExchange3 domain routes, reviewed atomic loyalty debit and canonical exchange producer, source-safe eligibility/history/financial/points writers.

- [x] Owned PostgreSQL/HTTP positive/no-grants for all7, current authority/original tuples and independent Customer/Contract/Payment/Product/destination/referral/points sources. Inspect actual loyalty ledger/expiry/balance semantics. Never present a partial subtotal as global spendable points or fabricate origin for unknown history.
- [x] Reuse canonical once-only redemption/debit and the owned sale/money/audit transaction, preserving expiry/duplicate/discount/business gates. No second executor or best-effort managed balance write. Prove rollback/concurrency and publish Task6 approval fingerprint integration.
- [x] Direct Defect eligibility/execute/list reuse reviewed FINANCE Contract at its actual SHOP origin, independent current/replacement Product/destination and sensitive-source contracts. Preserve state/window/override/approval invariants; no caller price, fake actor or representative branch. Narrow responses and actual financial/required-audit writes join existing canonical effects. These3 routes belong here; ContractExchange7 and activation remain4.2.
- [x] Reconcile the278 baseline SHOP domain registrations plus explicitly introduced surfaces (currently two authenticated Customer document routes,280total) against actual reviewed success/denial evidence, including the31 baseline customer routes plus those additions. Separately reconcile seven employee-management and three promotion owner staff routes without double counting. Cover affected cross-unit source/tuple/sensitive/file/aggregate/current-revocation behavior; missing-adapter denial is not completion.
- [x] Types/coverage/isolated checks, report/self-review/commit and independent gate before completing the SHOP parent. Publish remaining FINANCE544/operations267/audit4/other-staff/automation and Tasks4.4–8 accurately. Root retains final JWT/guards/browser/local:check/verified-preview work.

#### Serial execution of Task4.1.6.3

R92–96 separate the genuine global account/debit producer from four loyalty HTTP consumers and three direct defect consumers. No original requirement or route is removed. Exact global account versus scoped history, canonical once-only Sale debit, immutable new provenance, Bangkok5000cap and verification-only direct redeem are binding in the ledger/checkpoint rulings. No ordinary saved/future grants are silently expanded.

### Task 4.1.6.3.1: Typed loyalty account and canonical Sale debit producer

**Files:** Existing managed canonical SaleCreation debit/actual outer transaction, LoyaltyRedemption additive provenance, minimal loyalty account/source helper and Journey redemption consumer, shared capability catalog; zero additional HTTP routes.

- [x] Original ownedPG monetary and authority RED before runtime; exact R93 COMPANY SHOP global account rights plus independent current Customer/Sale/Product sources and no hidden balance/error probes.
- [x] Preserve canonical money/stock/JE/tender/discount executor, add required read+redeem authority, positive integral1:1points, exact net ceiling and Bangkok cumulative5000cap under current Customer/account lock in owned Serializable max3. Required evidence, typed unique immutable Sale redemption and conditional balance debit commit/rollback together; race/duplicate/revocation/lateaudit behavior.
- [x] No guessed historical backfill/reason parsing/repricing/new expiry or recredit. Preserve canonical global balance despite incomplete history. Minimal genuine typed Journey consumer and publish exact direct verification/history/approval6/FINANCEearning4.2.4/system4.4/UI7 contracts.
- [x] Cover actual Sale monetary/discount/promotion/tradecredit/Journey regressions, shared/API/Web types and touched lint/coverage honestly; report/self-review/commit, independent gate before consumers. No route/wholeSHOP/UI/JWT claim.

**Reviewed producer completion:** 23ebb1780..dbe784a92; independent spec/quality PASS,0Critical/0Important/1Minor (expected-failure test logging). Original monetary/authority RED was contemporaneously observed before runtime. Final26 owned canonical Sale tests and scoped helper coverage91.75/87.14/100/94.31 pass; priorSales15/Journey38/canonical128/shared47, promotion69of70 plus affected amended1, largerheapalltypes/finalAPI/lint are qualified retained evidence. Explicit global account rights have no default expansion. Typed immutable actual-Sale proof, Bangkok5000cap, current-source/authority, atomic debit/evidence and minimal Journey consumer are reviewed. Direct Loyalty4/Defect3 remain open; zero routecredit, SHOP273/280, no full JWT/UI/preview claim.

### Task 4.1.6.3.2: Loyalty account projection, scoped history and exact verification

**Files:** LoyaltyController4, actual source/query/projector/verification helpers, DTO/current capability manifest boundaries and meaningful owned HTTP/PG tests; exactly4 SHOP routes.

- [x] Consume reviewed typed producer. Four useful authorized/denied actual marked HTTP paths, original tuples/current revocation; independently current Customer, earningPayment/FINANCEContract, typedSale/redemption and referralCustomer/Contract sources.
- [x] R93 explicit global balance or null/unavailable; scoped visible history/totals before counts/limits/ranking, no false global/lifetime/expiry claims, nullable referral hasContract when coverage incomplete.
- [x] Direct POST redeem verifies only genuine exact typed selected Sale redemption under R94 action/source rights. Arbitrary target/amount/customer/Contract/approver text cannot debit, reprice or createproof; duplicates zeroeffects. Explicit VERIFIED/alreadyRedeemed contract; current balance onlywithaccountread.
- [x] Preserve public/system/auth and canonical money paths, safe evidence and significant read contract; publish brokenCustomerDetail form migration, nullable metrics/UI7 and approval/audit/final8 obligations. Exact4registrations/evidence, types/lint/regressions/report/commit and independent gate.

**Reviewed consumer completion:** db22914b8..cb88087dd; independent spec/quality PASS,0Critical/0Important/1Minor inherited Jest forceExit advisory. Final50 marked owned HTTP, separateaudit17/legacyloyalty6, shared/API/Webtypes andlint pass. Exactly4 real registrations with useful authorized/current-denial controls; scoped visible history/referral/nullaccount semantics and exact existing-Sale verification preserve money. SHOP277/280; only directDefect3 remains inthisparent. ActualJWT/browser/preview8 and allFINANCE/operations/audit/approval/UI/system obligations remain open.

### Task 4.1.6.3.3: Direct defect exchange and SHOP parent reconciliation

**Files:** DefectExchangeController3 and existing reviewed AccessExchangeSourceService/canonical helpers, focused boundary/projection tests; exactly3 SHOP routes.

- [x] Actual eligibility/execute/list markedHTTP positive/no-grants/foreign/currenttuples, passing currentactor. Preserve FINANCE Contract at trueSHOPorigin, independent original/replacementProduct/destination/Customer and sensitive authority, scopebeforelistlimits.
- [x] Reuse existing canonical current owned transaction/executor, read vscreate+approve and genuine approval/state/window/override constraints. No alternatefinancialwriter/rolegrant; rollback/concurrent/lateaudit and aftercommit effects withmockproviders.
- [x] Relevant Sale/exchange/after-sales regressions/types/lint/coverage/report/commit/independent gate. Root reconciles disjoint280SHOP actualregistered+reviewedpositive/denial, separate7employee+3promotionadjacent, and everyoriginalparentrequirement. FINANCE544/operations267/audit4/otherstaff/system/tasks4.4–8 remain pending; no actualJWT/browser/preview claim.

**Reviewed direct completion:** 9a1d7a4d9..ae906c234 independent PASS0Critical/0Important/1Minor inheritedforceExit. Final32HTTP, canonical17, after-sales22, unit40, shared/API/Webtypes andlint pass; adapter/history scopedcoverage98.24/91.66/100/100. R97 finitecurrentcorrelatedhistory/photounavailable isbeforevisible200; originalaudit/notes/canonicalcallersretained. Loyaltyproducer0+Loyalty4+Defect3 close parent7; tender14+references/promotion18+loyalty/defect7 close residual39, SHOP280. Root reconciles separateadjacent7/3 and explicit final8 ownerHTTP evidence limitation. Remaining wholeprogram work is not completed by this phase.

### Task 4.2: FINANCE, accounting and financial reporting scope

**Files:** Extend employee-access scope/resolver/projector infrastructure; add `access-finance-boundaries.ts` and focused tests. Modify manifest-listed contracts, credit-check, payments, receipts, refunds, collections-session, overdue, legal-case, repossessions, finance-receivable, external-finance, expense-documents, journal, accounting, chart-of-accounts, bank-accounts, tax, reporting, analytics and finance-report service paths as required.

**Interfaces:** Consume Task 4.1 scope and projection contracts plus Task 3 decision/executor registry. Extend those contracts instead of introducing a second access engine. Approval policy changes themselves remain Task 6; authorization must already prevent scope/legacy personal-grant bypass.

- [ ] RED tests for assigned FINANCE cases, explicit central grants, SHOP origin-branch filters without granting SHOP access, payment/refund access through parent records, scoped balances/counts/reports and prohibited cross-company joins.
- [ ] Implement real record/query/export adapters across FINANCE/accounting. Use actual Entity/company resolver behavior: external finance retail receivables are not automatically company FINANCE merely because of their name. ASSIGNED requires a real case assignment; recordedBy/createdBy alone is not silently equivalent to ownership.
- [ ] Scope joins, totals, searches, file/signature URLs and raw SQL before aggregation. Separate revenue/report access from profit/cost/export permissions; preserve Decimal calculations and financial state transitions.
- [ ] Replace managed role vetoes/personal permission readers with capabilities, preserving maker-checker, accounting period, approved-state and transactional invariants. Task 6 will enforce the new reserved approvals at actual money commits.
- [ ] Isolated financial/query regressions, API types and coverage; document exact integrations, self-review, commit.

#### Serial execution of Task 4.2

The544 current financial-family domain rows are partitioned into the fifteen reviewed units below; allocation names do not establish company ownership. An additional47 adjacent staff routes are explicitly assigned to their owning units and counted separately. All parent requirements remain. Each unit consumes the same reviewed scope/transaction engine and prior producer contracts, records actual source/action/projection/effect behavior, and receives an independent gate before the next. Refine a large unit serially when actual canonical dependencies require it, retaining every allocated route. Reconcile owned Cron/queue/bootstrap callers and public/customer/integration counterparts with explicit principals; HTTP inventory does not establish automation coverage. Root retains integrated local:check/full JWT/guards/browser/preview.

### Task 4.2.1: Contract workflow and exchanges

**Files:** Shared employee-access scope/source/projector/execution infrastructure and contracts, contract-exchange and the staff CustomerAccess route. Exact baseline slice: `finance-planning-partition.json` → `contract_workflow_and_exchange` (38 rows; ContractsController 30, ContractExchangeController 7, CustomerAccessController 1).

- [x] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [x] Resolve actual Contract financial/workflow provenance, persisted origin branch and genuine assigned case identities; Contract has no company column, so distinguish FINANCE debt authority from reviewed narrow SHOP warranty and any explicitly justified SHOP application workflow. Creation must authorize real customer/product/destination sources. Preserve canonical activation, sale/stock/commission/journal writes, exchange state machines and current source-aware children. Consume reviewed after-sales exchange seams instead of creating a second executor. Record actual approval and cancellation paths forTask6.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [x] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.
- [x] Separately reconcile 7 adjacent staff resource=none routes in `non-domain-staff-partition.json` → `finance_contract_config` without counting them as domain adapters. Reconcile actual read versus owner configuration semantics for interest configuration; a settings classification alone is not final runtime policy. Restore independently authorized Sale Contract-status filtering/navigation and TradeIn Contract navigation suppressed by earlier producers; no general SHOP financial view. Activation must resolve original financial/SHOP-origin/current-Product source before changing Product ownership, consuming reviewed exchange transactions and journal invariants.

**Parent reconciliation at5fe7ca45d:** All38 original domain adapters and seven adjacent InterestConfig methods have independent gates and exact disjoint registration/evidence accounting. Parent11 is complete. The actual positive protected-owner payoff approval consumer remains mandatory in4.2.4/6; parent9/9.2 and this financial/execution obligation remain open. Source-aware UI7, durable audit5, system4.4 and actual full-auth/backend/browser/localcheck/verified-preview8 remain required. Reviewed318domain=280SHOP+38FINANCE;506FINANCE remain. No registration-only or missing-adapter credit.

#### Serial execution of Task4.2.1

R98 partitions the exact38domain+7adjacent surface below; R99 governs the first read-core producer. R100–108 settle financial status, global reference, preparation, review, delegation, exchange, payoff, cancellation and derived-source contracts. R109 bounds read-core contributor work and requires set-based canonical source locks with measured scale/contention evidence. Root rulings control the checkpoint proposals; implementation must preserve the binding design. Root owns final parent reconciliation and actualJWT/browser/localcheck/preview8.

### Task 4.2.1.1: Ordinary FINANCE Contract read core

**Files/scope:** ContractsController.findAll and findOne; exactly2domain. Amend existing Sale contractStatus filtering and Sale/TradeIn Contract navigation with zero additional route credit.

- [x] Meaningful owned PostgreSQL/marked HTTP RED with exact authorized success/no-grants/foreign/current and asymmetric tuple controls; explicitly isolated both DB URLs, mocked external effects. Fixture/compiler failures are not behavioral RED.
- [x] R99 actual FINANCE/liveSHOPorigin/current assignedToId read source; paired original tuples; independent finite child/source/sensitive projection and authorization-aware search/filter/sort/count/pagination; explicit null/coverage semantics. Reuse existing canonical party helpers, keep mutation business reads separate.
- [x] R109: ordered set-based canonical source locking for up to 10,000 distinct SQL-proven Contract contributors; probe 10,001 only to reject overflow with a generic narrow-filter 400 before partial output. Preserve current source, off-page contributors, maximum page 200 and Serializable max-three attempts. Record supported-bound success, overflow/narrowing, query count, synthetic portfolio latency and unrelated managed-request contention; no production SLA claim.
- [x] Cover actual changed authorization/money/file behavior, relevant canonical regressions, types/touched lint and scoped coverage. Record exact commands/exits, self-review/commit and independent gate; preserve remaining audit5/approval6/UI7/system4.4/final8 obligations.

**Read-core completion:** `71c26e196` plus independently approved I1 fix `89ddcf680`; exact two FINANCE routes, source-authorized Sale/TradeIn links and Sale status filtering add no routes. Final owned Contract33/Party57/Sales15, shared/API types and focused lint pass. R109 measured support covers 10,000 distinct contributors with generic overflow rejection and source/actor/off-page waits. One earlier pre-ANALYZE narrowed Sale expiration remains unexplained and assigned to4.4/8; no production SLA, clean teardown, actualJWT/browser/preview or whole-program claim. Parent remains incomplete.

### Task 4.2.1.2: Interest reference and owner configuration

**Files/scope:** InterestConfigController.findAll, findByCategory, resolveConfig, findOne, create, update, remove; exactly7adjacentstaff and0domain.

- [x] Meaningful owned PostgreSQL/marked HTTP RED with exact authorized success/no-grants/foreign/current and asymmetric tuple controls; explicitly isolated both DB URLs, mocked external effects. Fixture/compiler failures are not behavioral RED.
- [x] R101 shared-reference read uses selected live SHOP/FINANCE and permission-specific COMPANY or nonempty live BRANCHES; ASSIGNED alone denies. Future SALES/BM/FM/ACCOUNTANT/STOCK defaults only, no saved grant expansion. Owner writes remain current protected-owner settings.finance.manage with actual transaction audit; canonical scoped quotes keep internal dependency reads.
- [x] R110 preserves consistent oldest-active createdAt/id selection across named reference and ProductQuote consumers, matching ContractQuote; validate merged min/max on partial owner update in the actual transaction. Preserve formulas, fallback values, rates and active/deleted eligibility; no arbitrary new limits or backfill.
- [x] Cover actual changed authorization/money/file behavior, relevant canonical regressions, types/touched lint and scoped coverage. Record exact commands/exits, self-review/commit and independent gate; preserve remaining audit5/approval6/UI7/system4.4/final8 obligations.

**Reference completion:** 18c66d231 independently passes spec/quality, exact7 adjacent and0domain. Owned HTTP39/canonical67/shared47/internal quote1 with60 skipped, API/Web types, lint and inventory pass; scoped100%statements/functions/lines and96.42%branches. Required owner-write audit rollback/current authority proven; actualJWT/STOCK/fullguards/UI/global-label/localcheck/preview remain7/8, forced-exit Minor goes to final review. Parent4.2.1 remains36domain pending.

### Task 4.2.1.3: Contract application preparation

**Files/scope:** ContractsController.quote, create, update, updateBundles, validateForSubmit; exactly5domain.

- [x] Meaningful owned PostgreSQL/marked HTTP RED with exact authorized success/no-grants/foreign/current and asymmetric tuple controls; explicitly isolated both DB URLs, mocked external effects. Fixture/compiler failures are not behavioral RED.
- [x] Actual SHOP application sources, independent current Customer/Product/bundles/destination and salesperson/room links; preserve canonical quote/calculator, immutable named promotion terms and source/reservation locks. Resolve legacy exceptions as configurable capabilities without hidden cost/error leakage or guessed migration grants.
- [x] Cover actual changed authorization/money/file behavior, relevant canonical regressions, types/touched lint and scoped coverage. Record exact commands/exits, self-review/commit and independent gate; preserve remaining audit5/approval6/UI7/system4.4/final8 obligations.

R111 splits this parent into two serial independently reviewed subunits. The existing two read GET amendments add zero routes; the original five preparation actions remain the parent allocation. No SHOP-to-FINANCE permission expansion or new route count is inferred. UI7 and genuine signing/document/KYC dependencies remain required before whole-flow completion.

### Task 4.2.1.3.1: Own SHOP preparation source and read mode

**Files/scope:** Amend existing ContractsController.findAll/findOne through focused preparation source/projection modules and shared response types; zero new route credit. Read R111/R112 and task-4.2.1-preparation-read-checkpoint.md for exact authority, bounded same-parent Customer lanes, finite surface and downstream consumers.

- [x] Meaningful owned PostgreSQL/marked HTTP RED before runtime, explicit both DB URLs, current-maker SHOP-only list/detail positives, owner positive, other-maker/branch/no-update/ASSIGNED/active denials; no test fixture or compiler failure counted as RED.
- [x] Explicit view=preparation only with selected SHOP, typed SHOP_PREPARATION/PRE_ACTIVATION response. Require same-source contracts.read+contracts.update, current salesperson or protected owner, actual live SHOP origin and nondeleted DRAFT across all workflow states. Preserve ordinary selected-FINANCE behavior and R99/R100 projection exactly.
- [x] SQL predicates before search/filter/count/page, independent current Customer/Product/document source and nullable availability, no financial history/status/counts or raw private fields. Use ordered bounded contributor locking/current snapshots and retries under R109 with no fabricated FINANCE source; maximum page200, 10,000 supported contributors and generic overflow rejection before partial output.
- [x] Prove reassignment/revocation/activation after observed waits, hidden-child query noninterference, current origins and unchanged FINANCE/off-page behavior; API/shared/Web types and touched lint as affected, scoped coverage and reusable preparation source contract. Self-review, commit, independent gate. UI7 cache/render and real document/KYC/lessor signing dependencies stay explicitly incomplete.

**Preparation read completion:** fbab7ad19 independently passes spec/quality, zero new routes. Owned preparation23 and FINANCE33 pass with actual source/actor/child/off-page waits and own10k/overflow/narrowing/contention evidence. Exact-parent Customer lanes remain separate; no default FINANCE change. Existing forced-exit Minor and unexplained earlier Sale timeout remain explicit. The original five actions are now independently reviewed in3.2 below; UI7 and real signing/full-auth/preview8 remain pending.

### Task 4.2.1.3.2: Canonical preparation actions and exceptions

**Files/scope:** Original ContractsController.quote/create/update/updateBundles/validateForSubmit, exactly5domain. Consume the approved3.1 preparation source/read contract and R102/R110/R111; no new route credit for read amendments.

- [x] Meaningful owned PostgreSQL/marked HTTP RED and exact five authorized/no-grant/foreign/current controls; actual SHOP-only create→explicit preparation reload/list success without FINANCE grants after the adapters are implemented.
- [x] Preserve all parent3 source, quote/calculator, credit/reservation/stock/down-money/transaction/audit constraints. Add R102 configurable active-contract/damaged exceptions with no defaults or saved grants; preserve current maker/protected-owner edit boundary and independent affected old/new sources.
- [x] Checklist finite source-authorized availability, canonical validation, current actor/source after wait, same-transaction required evidence and rollback/retry/aftercommit correctness. Preserve existing named immutable terms and no external side effects during tests.
- [x] Relevant canonical regressions, API/shared/Web types and touched lint as affected, scoped coverage, report, self-review/commit and independent gate. Root reconciles the original five methods plus zero-credit read-mode integration before closing parent3; full signing/document/KYC/UI remains in its owning tasks.

**Preparation actions and parent completion:** c9a05dc0e independently passes spec/quality with0Critical/0Important/2Minor. Original five actions plus zero-credit read amendment reconcile parent3; FINANCE allocation7of544 reviewed/537remaining, Contract parent7of38domain/31pending and7of7adjacent. R113 genuine same-Customer room-credit source preserves canonical affordability and single-use claim; configurable active-contract/damaged exceptions add no default/saved grants. Actual SHOP-only create-to-explicit-reload/list, current source waits, audit rollback and whole-attempt retry/aftercommit pass. Retained37actions+61named+397canonical+23prepread=518passes, API/shared/Web types and lint zero errors/four preexisting warnings. Scoped coverage is not whole-API coverage. Forced-exit/error noise and lint cleanup remain final-review inputs; actual JWT/fullguards/localcheck/preview8, UI7, genuine signing/document/credit origins, audit5/approval6/system4.4 remain required.

### Task 4.2.1.4: Contract review workflow

**Files/scope:** ContractsController.submitForReview, approve, reject; exactly3domain.

- [x] Meaningful owned PostgreSQL/marked HTTP RED with exact authorized success/no-grants/foreign/current and asymmetric tuple controls; explicitly isolated both DB URLs, mocked external effects. Fixture/compiler failures are not behavioral RED.
- [x] Separate actual SHOP preparation/submit workflow and FINANCE review authority; preserve genuine maker/checker and explicitly adjudicated existing owner exception, never generalize discount-only selfapproval. Current source, named terms, state/CAS and required audit in actual transaction.
- [x] Cover actual changed authorization/money/file behavior, relevant canonical regressions, types/touched lint and scoped coverage. Record exact commands/exits, self-review/commit and independent gate; preserve remaining audit5/approval6/UI7/system4.4/final8 obligations.

**Review workflow completion:** ad846a7c7 independently passes spec/quality after one fix round. Exactly three methods; current-source canonical submit proof is shared by HTTP/direct execution, including merged-Customer rejection and contributing source locks. FINANCE review is assignment-free and current-maker/checker; owner own approval needs bounded reason/atomic evidence. Final80review+75canonical+37preparation+61named=253passes, API/shared/Web types and lint0errors/four preexisting warnings; initial572 is separate historical evidence. Contract parent10of38domain/28pending and7of7adjacent; FINANCEallocated10of544/534remaining. ExistingM1 remains finalreview, R114 legacy compatibility and PDPA link-presence limitation are explicit; actualJWT/fullguards/preview8, consentchild6, audit5/approval6/UI7/system4.4 remain required.

### Task 4.2.1.5: Canonical Contract activation

**Files/scope:** ContractsController.activate; exactly1domain.

- [x] Meaningful owned PostgreSQL/marked HTTP RED with exact authorized success/no-grants/foreign/current and asymmetric tuple controls; explicitly isolated both DB URLs, mocked external effects. Fixture/compiler failures are not behavioral RED.
- [x] Separate contracts.activate capability and original FINANCE/SHOPorigin/currentProduct sources before ownership transfer; existing canonical Sale/stock/commission/journal/period/outbox/signatures/promotion reservation consumption exactly once. Current source/actor after locks and owned rollback; effects only after actual commit.
- [x] Cover actual changed authorization/money/file behavior, relevant canonical regressions, types/touched lint and scoped coverage. Record exact commands/exits, self-review/commit and independent gate; preserve remaining audit5/approval6/UI7/system4.4/final8 obligations.

**Activation completion:** d08ffb011 independently passes spec/quality with0Critical/0Important/2deferredMinors. Exactly1method, distinct FINANCE contracts.activate plus pre-transfer current sources, explicit actor admission, same-attempt opaque exchange proof, canonical money/required audit and actual outercommit effects. Final54ownedPG cases and final75affected/87policy-controller/27legacyPG/17credit cases pass; earlier canonical/named/preparation/review/exchange regressions are separate retained evidence. APItypes pass; lint0errors47existingwarnings. No durable outbox/crossDB claim; actual eligibleVAT/positiveECL/existingSale variants and realdelivery/fullJWT/guards/UI/localpreview remain owningintegration tasks. Parent11of38domain/27pending,7of7adjacent; FINANCEallocated11of544/533remaining.

### Task 4.2.1.6: Contract consent, QR and customer delegation

**Files/scope:** ContractsController.getQrData, recordPdpaConsent, getPdpaConsent and CustomerAccessController.generateAccessToken; exactly4domain.

- [x] Meaningful owned PostgreSQL/marked HTTP RED with exact authorized success/no-grants/foreign/current and asymmetric tuple controls; explicitly isolated both DB URLs, mocked external effects. Fixture/compiler failures are not behavioral RED.
- [x] Finite source and independent document/identity/delegation authority; secret-free audit and genuine signer/evidence, preserve public customer authentication separately. Explicit recipient/expiry/current authority and private proof, no fabricated consent or guessed file provenance.
- [x] Cover actual changed authorization/money/file behavior, relevant canonical regressions, types/touched lint and scoped coverage. Record exact commands/exits, self-review/commit and independent gate; preserve remaining audit5/approval6/UI7/system4.4/final8 obligations.

**Consent/delegation completion:** e5e856bb2 independently passes spec/quality0Critical/0Important/3Minor. Exactly4staffmethods; current exact-source authority, genuine notice/version handshake, atomic capture/recapture/audit, future-only immutable token provenance and atomic50-use customer access. Public QR financial status is uniformly null. Final57ownedPG,89review,63activation,61named,33read,154focusedregressions pass; APItypes0/lint0errors7existingwarnings. Unchanged helper evidence supports R122 composition, while isolated FINANCE-only issuance/currentcase/no-sibling HTTP remains explicit final8 verification. UI7 must replace signature-only notice capture; no end-to-end/JWT/browser/localpreview completion claim. Parent15of38domain/23pending; FINANCEallocated15of544/529remaining.

### Task 4.2.1.7: Direct Contract exchange callers

**Files/scope:** ContractExchangeController.submit, preview, listPending, listRecent, approve, cancel, reject; exactly7domain.

- [x] Meaningful owned PostgreSQL/marked HTTP RED with exact authorized success/no-grants/foreign/current and asymmetric tuple controls; explicitly isolated both DB URLs, mocked external effects. Fixture/compiler failures are not behavioral RED.
- [x] Consume reviewed canonical exchange source/action/state/window/override/current original+replacement Product/Customer/destination and actual financial executor. Lists scope before limit/count and sensitive fields. No second executor, fake actor, legacy role grants or reimplementation of reviewed Defect3.
- [x] Cover actual changed authorization/money/file behavior, relevant canonical regressions, types/touched lint and scoped coverage. Record exact commands/exits, self-review/commit and independent gate; preserve remaining audit5/approval6/UI7/system4.4/final8 obligations.

**Direct exchange completion:** df421dd2f plus56fc7c322 independently pass spec/quality after one scoped fix for asynchronous error redaction. Exactly7direct routes, selectedSHOP with independently checked actual FINANCE/Customer/Product/destination sources; same canonical financial executor, atomic creation/decision evidence, current posting-period checks and replacement linkage. Final78direct,64activation (including actual positiveECL),22after-sales,17producer pass; canonical199 covered across196initialpasses and4focusedpasses after3arity expectation corrections, not a single final199rerun. APItypes0; fixlint clean, prior118existingwarnings/forcedexit remain2Minors. Parent22/38domain,16pending; FINANCEallocation22/544,522remaining. ActualJWT/fullguards/browser/localcheck/preview8, system4.4/audit5/approval6/UI7 remain mandatory.

### Task 4.2.1.8: Contract schedule and payoff reads

**Files/scope:** ContractsController.getSchedule and getEarlyPayoffQuote; exactly2domain.

- [x] Meaningful owned PostgreSQL/marked HTTP RED with exact authorized success/no-grants/foreign/current and asymmetric tuple controls; explicitly isolated both DB URLs, mocked external effects. Fixture/compiler failures are not behavioral RED.
- [x] Actual FINANCE Contract and independent Payment/current monetary source, exact existing formulas and labelled projection; internal grossProfit/cost remain sensitive. Distinguish contractual payoff calculation from discretionary interest reduction and preserve later approval fingerprint integration.
- [x] Cover actual changed authorization/money/file behavior, relevant canonical regressions, types/touched lint and scoped coverage. Record exact commands/exits, self-review/commit and independent gate; preserve remaining audit5/approval6/UI7/system4.4/final8 obligations.

**Schedule/payoff read completion:** c3b4b7b52 independently passes spec/quality0Critical/0Important/1Minor. Exactly2FINANCE reads, current ordinary Contract/Payment authority, finite schedule and R129–131 payoff projection; shared internal/customer math/defaults preserved and hidden GL skipped. Full journal preview requires fixed complete COMPANY journal/cost/profit authority on both live books, then actual contributor proof. Owned41 andcanonical178/14suites pass; shared/API/Webtypes pass, finalfocused1/40skip covers addedassertion, touchedlint0errors1existingwarning. Parent24/38domain14pending; FINANCEallocation24/544520remaining. Actualexecution/approval9/6, system4.4/audit5/UI7/final8 remain required; no universal contractual-margin non-inference orpreviewclaim.

### Task 4.2.1.9: Payoff and SHOP settlement execution

**Files/scope:** ContractsController.earlyPayoff, earlyPayoffSlipVerify, earlyPayoffSlipConfirm, shopCollectSettlement; exactly4domain.

- [ ] Meaningful owned PostgreSQL/marked HTTP RED with exact authorized success/no-grants/foreign/current and asymmetric tuple controls; explicitly isolated both DB URLs, mocked external effects. Fixture/compiler failures are not behavioral RED.
- [ ] R106: direct earlyPayoff is an honest request-only bridge into existing EARLY_PAYOFF approval creation, PENDING_APPROVAL with no money claim; actual queue approval/execution4.2.4/6 remains a required dependency. Positive computed reduction including default policy requires owner approval; OCR is payment evidence only. Preserve actual immutable money/source snapshot, canonical tx/JE/period/CAS/idempotency/late-audit rollback,15-minute ticket/formulas and staged verified files with final current checks and controlled aftercommit effects. SHOP settlement checks both actual FINANCE and SHOP payments.create.
- [ ] Cover actual changed authorization/money/file behavior, relevant canonical regressions, types/touched lint and scoped coverage. Record exact commands/exits, self-review/commit and independent gate; preserve remaining audit5/approval6/UI7/system4.4/final8 obligations.

R132 splits parent9 into the following three serial gates after actual producer/transaction inspection. The parent stays incomplete until all four original routes and downstream approval integration are proved; R133/R134 bind settlement source and new pending-source compatibility.

### Task 4.2.1.9.1: Genuine payoff request producer and direct bridge

**Files/scope:** Shared existing EARLY_PAYOFF PaymentApprovalRequest producer and ContractsController.earlyPayoff; exactly1domain, with existing request-controller producer reuse adding zero route credit.

- [x] Meaningful owned PostgreSQL/marked HTTP RED and root contemporaneous inspection before runtime; explicit both DB URLs, real canonical snapshot/quote, current/no-grant/foreign/asymmetric controls.
- [x] R106/R132/R134: selected FINANCE, independent actual Contract/Payment read and assignment-free payments.create, explicit bounded reason, server-only versioned current source envelope and genuine snapshot, same-client PENDING dedupe/request/safe audit. Response only requestId/PENDING_APPROVAL; no money, forged context or arbitrary slipUrl evidence. Existing shared consumer fails closed for this managed envelope until4.2.4/6 supplies the genuine current-owner consumption contract; legacy snapshots/defaults remain compatible.
- [x] Actual concurrent once-only pending creation, source/grant lock waits, required-audit rollback, no money/effects, forged body and compatibility-consumer tests; affected regressions/types/touched lint/scoped coverage, self-review/commit and independent gate.

**Payoff request completion:** 009949a8f plus9afa5a08a independently pass spec/quality after one scoped audit-race fix. Exactly1direct FINANCE request bridge; actual shared canonical producer, current independent reads/assignment-free write, server-only source envelope and same-tx PENDING dedupe/audit. Legacy managed creator and consumer bypasses are blocked until genuine queue integration. Final44owned+116canonical pass; fix44owned+32auditunit/APItypes/touchedlint pass; initialshared/API/Webtypes pass. Expectedlogs/forcedexit remain1Minor. Parent25/38domain13pending; FINANCE25/544519remaining,total305revieweddomain. No money/receipt/slip/settlement execution or UI/preview claim;9.2/9.3/4.2.4/4.4/5/6/7/8 remain required.

### Task 4.2.1.9.2: Private payoff evidence and atomic execution

**Files/scope:** ContractsController.earlyPayoffSlipVerify/earlyPayoffSlipConfirm plus actual shared receipt/canonical money producer seams; exactly2domain.

- [ ] Meaningful owned marked multipart HTTP/PG RED before runtime; actual FileInterceptor ordering,5MB/MIME validation and controlled private storage/OCR staging once.
- [ ] R106/R129/R132/R134: fresh source/read/create/documents authority, actual immutable effective quote/fingerprint/15-minute evidence; positive reductions enter genuine pending owner review with explicit reason and never gain executable OCR authority. Zero-reduction or genuinely approved execution uses the canonical money writer, exact-client receipt/PaymentEvidence/fingerprint/audit and current period/CAS/idempotency; controlled effects only after actual outer commit. No alternate approval/money/receipt engine.
- [ ] Real money/receipt/ownership rollback, duplicate/concurrent confirmation, current revocation/expiry/quote change, late file denial/no leaked bytes and aftercommit effect evidence; affected regressions/types/lint/coverage and independent gate.

R136 splits9.2 into the following serial gates. Its two HTTP routes remain pending until9.2.2; R137 binds actual actor/book/date and R138 binds positive-request privacy and genuine evidence semantics.

### Task 4.2.1.9.2.1: Canonical payoff and receipt atomic producer

**Files/scope:** Actual ContractPaymentService.earlyPayoff, shared receipt issuance, bounded JournalAuto/ECL provenance and owned effects; zero route credit. No evidence schema, OCR/HTTP adapters, queue consumer or settlement runtime.

- [x] Meaningful owned PostgreSQL canonical monetary RED and root contemporaneous acceptance before runtime; actual shared receipt/snapshot/sequence/journal/ownership, controlled effects, explicit equal bothDBURLs and fixture guard.
- [x] R106/R117/R132/R136/R137/R139/R140: exact trusted current owned client/actor/source; one canonical money and receipt implementation; same-tx Payment/evidence/fingerprint/JP4/ECL/ownership/receipt/required audit with managed failure rollback. Explicit actual FINANCE/creator/checked Date, existing receipt math/no-JP4 link, legacy caller defaults preserved. Effects only after actual outer commit; no positive-reduction OCR authority or managed request consumption bypass. All managed PaymentApprovalContext inputs, including old unmarked requests, remain closed until4.2.4/6 supplies genuine current-owner/source/money execution; genuine unmanaged approval compatibility remains.
- [x] Actual success, ownership/receipt/audit failure rollback, exact once/concurrency and aftercommit/retry effects, actual positive-ECL and required source/date/provenance controls; affected shared regressions/types/touched lint/scoped coverage, full report/commit and independent gate. HTTP2 remain9.2.2 and final approval consumer4.2.4/6 stays required.

**Atomic producer completion:** `13b7f5c53` independently passes spec/quality with zero Critical/Important findings and one deferred warning/forced-exit Minor. One canonical money/receipt path on the exact owned client; actual actor/FINANCE/checked Date, required audit/ownership/receipt rollback and outer-commit effects. All managed approval contexts stay closed under R140; genuine unmanaged approved execution remains. Owned31-case run plus6 focused R140 checks and composed143 shared regressions pass; shared/API/Web types and final touched lint pass. Zero route credit: FINANCE25/544,total305domain and Contract25/38 remain unchanged. Evidence/HTTP9.2.2 and all named owning integration tasks remain required.

### Task 4.2.1.9.2.2: Private payoff evidence and multipart integration

**Files/scope:** Actual immutable operation-specific payoff evidence producer and ContractsController.earlyPayoffSlipVerify/earlyPayoffSlipConfirm; exactly2domain. Reuse reviewed canonical producer9.2.1.

- [x] Meaningful actual FileInterceptor/ParseFilePipe marked multipart HTTP/ownedPG RED before runtime;5MB/MIME/actual bytes, write-once private storage/OCR staging once and current authorization before/after provider work.
- [x] R129/R134/R135/R138: positive-effective requests uniformly pending with explicit reason and genuine verified-or-unverified attachment, no hidden checks/amount/token oracle. Explicitzero uses opaque actor/source-bound15-minute ticket and exact fingerprint/current once-only confirmation; actualimmutable evidence, private object/hash and no generic PaymentEvidence approval authority. Preserve pending evidence beyond ticketexpiry; currentowner/exactapproval consumer remains4.2.4/6.
- [x] Actual money/receipt/ownership/audit rollback, duplicate/current revocation/expiry/changedquote/hiddenzero-loss/unreadableOCR/content-replay cases, genuine private byte preservation/cleanup outcomes and outercommit effects; regressions/types/lint/coverage and independent gate. No newbyte route/publicURL or fake cloudACL proof.

**R143 verification correction:** The initial pre-runtime fixture sent the wrong company-selector header, so its zero403 is not selected-FINANCE RED evidence. Preserve its logs and chronology. A corrected fixture was run retrospectively against independently verified pristine BASE96346de99 and reproduces2behavioralstatusfailures/2multipart-preprovidercontrols; corrected current-source GREEN and independent review remain required. This process deviation is explicit, not a contemporaneous RED claim or waiver of runtime invariants.

**Private evidence completion:** `6933143a4` plus `d76f11969` pass independent spec/quality after one actual-provider privacy fix. Two existing routes use current source/read/create/documents authority, immutable private evidence, uniform positive pending and opaque zero-only15-minute execution with canonical atomic money/receipt/content replay/audit. Actual Vision diagnostics now omit private values and original provider exceptions. Evidence is47composedowned cases plus1focusedreal-Vision case, affected75thenlegacy7/sharedrequest43+1 andfix29, types/touchedlint pass; no pristineall48run. R143weaker initial chronology and expectedwarning/forcedexit remain2Minors. FINANCE27/544,total307domain,Contract27/38;517FINANCE/11Contract remain. Parent9.2/9 approval dependency4.2.4/6,settlement9.3,system4.4,audit5,UI7 andactualJWT/fullguards/CSRF/browser/localcheck/preview8 remain mandatory.

### Task 4.2.1.9.3: SHOP collection settlement

**Files/scope:** ContractsController.shopCollectSettlement; exactly1domain.

- [x] Meaningful owned marked HTTP/PG RED before runtime and real canonical financial success (11-case RED accepted contemporaneously at ea6d; final56 owned cases pass).
- [x] R106/R133: actual FINANCE case payments.create without ASSIGNED plus actual live SHOP COMPANY payments.create uniformly, no borrowed collection branch. Exact contributor/current period/checked-date/no-negative/requestId dedupe and required same-transaction evidence; preserve canonical formulas and no bank integration.
- [x] Actual money/rollback/concurrency/current-source/both-book/no-payable controls, affected regressions/types/lint/coverage and independent gate; reconcile parent four routes and remaining4.4/5/6/UI7/final8 obligations.

**Settlement completion:** `1f576c129` independently passes spec and quality with0Critical/Important and1inherited regression-noiseMinor. Actual current FINANCE case plus SHOP COMPANY authority applies uniformly; real contributor books/interco provenance, exact transaction, canonical amounts/dedupe, same checkedDate/actualcreator/company and posting-specific period checks are proved. Final56owned plusfocusedrealP2002 assertion pass; canonical32+correctedtyped4+Jest18 composed regressions, APIsharedtypes and touchedlint pass. New runner exits naturally. Exactly1route adds FINANCE28/544,total308domain and Contract28/38;516FINANCE/10Contract remain. Parent9four original routes are independently gated, but9/9.2 positiveownerconsumer4.2.4/6 remains required. System4.4/audit5/UI7/fullJWTguardsCSRFfreshbackendbrowserlocalcheckrunningpreview8 remain incomplete.

### Task 4.2.1.10: Cancellation and draft disposal

**Files/scope:** ContractsController.softDelete, listPendingCancellations, requestCancellation, approveCancellation, rejectCancellation; exactly5domain.

- [x] Meaningful owned PostgreSQL/marked HTTP RED with exact authorized success/no-grants/foreign/current and asymmetric tuple controls; explicitly isolated both DB URLs, mocked external effects. Fixture/compiler failures are not behavioral RED.
- [x] Classify genuine no-money draft disposal separately from applied cancellation/refund; owner-reserved approval, exact source/snapshot/current/once execution and actual canonical reversal/audit. Preserve named reservation release only for eligible unsigned draft, no recrediting committed loyalty or clearing evidence.
- [x] Cover actual changed authorization/money/file behavior, relevant canonical regressions, types/touched lint and scoped coverage. Record exact commands/exits, self-review/commit and independent gate; preserve remaining audit5/approval6/UI7/system4.4/final8 obligations.

**Cancellation/draft completion:** `802ae4c62` independently passes spec and quality with 0 Critical/Important and 3 deferred Minors. Exactly five methods: current scoped request/queue, immutable v1 source evidence, different protected-owner approval, bounded private rejection and canonical SHOP draft disposal. Actual reversal/stock/C2/trade-credit/commission/archive rules remain; real postings use current books, creator, checked Date and exact owned transaction, with safe required audit and outer-commit effects. Final 59 owned HTTP/PG cases, separate canonical25/promotion62/unit84/policy8 runs, API/shared types and touched lint pass (six pre-existing warnings). FINANCE33/544, total313 domain and Contract33/38 are reviewed; 511 FINANCE and five Contract methods remain. All six cross-task review items are explicitly dispositioned; actual refunds4.2.4/6, system4.4, all-staff audit5, UI7 and real JWT/fullguards/CSRF/freshbackend/browser/localcheck/runningpreview8 remain required. No production migration or provider action.

### Task 4.2.1.11: Derived Contract reads and exports

**Files/scope:** ContractsController.exportRows, getDocumentDashboard, getMilestonesSummary, getSnapshot, listJournalEntries; exactly5domain.

- [x] Meaningful owned PostgreSQL/marked HTTP RED with exact authorized success/no-grants/foreign/current and asymmetric tuple controls; explicitly isolated both DB URLs, mocked external effects. Fixture/compiler failures are not behavioral RED.
- [x] Consume child1 source/query/projection and independent actual child sources before aggregates/CTEs/counts/limits/export; separate export/detail/sensitive capabilities, completeness/nulls and buffered files. Root parent reconciles38domain+7adjacent and restored consumers without duplicated route credit.
- [x] Cover actual changed authorization/money/file behavior, relevant canonical regressions, types/touched lint and scoped coverage. Record exact commands/exits, self-review/commit and independent gate; preserve remaining audit5/approval6/UI7/system4.4/final8 obligations.

#### Serial execution of Task4.2.1.11

R150 retains all five original methods in two serial children. R149 defines independent dashboard categories, finite staff attribution, complete authorized milestone totals and snapshot contact/promise semantics. The parent remains pending until both child gates and exact source/evidence reconciliation.

### Task 4.2.1.11.1: Contract aggregates, snapshot and buffered export

**Files/scope:** ContractsController.exportRows, getDocumentDashboard, getMilestonesSummary, getSnapshot; exactly4domain. Reuse child1 source/query/projectors and canonical outstanding/signature/export helpers.

- [x] Meaningful actual marked owned PostgreSQL/HTTP RED before runtime, explicit both DB URLs, real selector/app/request markers, authorized/no-grants/foreign/current/asymmetric controls. Fixture/compiler failures are not behavioral RED.
- [x] R99/R100/R108/R109/R149: independent original tuple/category/current-source checks before filter/count/rank/limit; exact export-read intersection and bounded batch projection; truthful null/availability and complete authorized milestone totals with five previews; separate document-family metrics/history and actual chat/contact/promise sources. No alternate financial formula or new global identity authority.
- [x] Useful positive/denial/current-source/rollback/boundary/performance evidence for all four, relevant canonical/read regressions, API/shared/Web types as affected, touched lint/scoped coverage; exact commands/exits, self-review/commit and independent gate. ActualJWT/fullguards/CSRF/freshbackend/browser/localcheck/preview8, source-aware UI7, audit5/system4.4 and approvals6 remain required.

**R151 review correction:** The shared ordinary FINANCE list and export salespersonId filter must use the same independently authorized current staff-source predicate as attribution projection. Preserve all valid Customer identity provenance alternatives with sufficient bounded current-source locks. Apply the10,000 distinct Contract contributor union to the complete request, including milestone aggregate candidates and preview-label dependencies; no new route credit. Focused list/export/source-wait/union-bound regressions and scoped independent re-review are required.

**Reviewed checkpoint:** b879a356e plus scoped fix1 f61581164; I1–I3 all addressed, no new findings. Final46derived/34ordinary tests and API/sharedtypes/lint pass; six CannotVerify dispositions retained in owning tasks. Exactlyfour domain routes credited, no shared-list duplicate credit. Parent11/journal11.2 and final integration remain open.

### Task 4.2.1.11.2: Contract journal source proof and independent books

**Files/scope:** ContractsController.listJournalEntries; exactly1domain. Actual canonical producers, ContractJournalQueryService and shared toContractJeView formatting; no duplicate money engine.

- [x] Concrete complete source-family matrix and root ruling before runtime, then meaningful actual marked owned PostgreSQL/HTTP RED; explicit both DB URLs/no providers. Retain all recognized current top-level contractId/reversal families; source-less history is not permission and unimplemented known families are not completion.
- [x] R108/R150: parent current Contract read plus independently genuine journal/cost/profit authority per real book, COMPANY when no genuine persisted branch source. Prove actual template/reference/typed parent/backlinks/current book without inventing universal AUTO/reference or reversal markers; scope before selection/limits and return finite typed category availability. Preserve canonical money formatting, deterministic order and intentional INTERCO-items/newContractId-only exclusions.
- [x] Canonical producer fixtures and positive/poisoned-parent/reversal/cross-book/current-source controls, bounded query/lock/response behavior, affected regressions/types/lint/coverage, exact commands/exits/self-review/commit and independent gate. Root reconciles parent11 five and parent4.2.1 exact38domain+7adjacent with all downstream obligations retained.

**R153–R155 implementation checkpoint:** Correct token-versus-approval identity and include both genuine SHOP interco cash-settlement families plus actual Contract trade-credit application/release; the earlier trade-credit exclusion was a source-inspection error. Use independent actual-book accounting/sensitive authority, only genuine same-book source branches, internal typed proof distinct from navigable links, safe fixed descriptions, authority-derived availability with explicit authorized-proven-source subset, and measured finite discovery/source/line bounds. Actual initial owned HTTP/PG RED inspected; final35/35 source/family/poison/current-wait/bound cases and independent initial-plus-fix1 gate now pass at5fe7ca45d.

**R156 initial-gate correction:** The first independent review at84fbce42b requires four fixes: actual cancellation ECL CANCEL-to-CANCEL source, exchange C2-origin recall settlement, consistent nonrecursive historical/reversal pair identity, and every-line account-code bounds before lookup/fallback. Fix1 retained8actualRED failures and final35/35 covering cases; scoped independent re-review at5fe7ca45d addresses allfour withno newCritical/Important findings. The initial27/27 run alone did not close them; final gate earns exactlyonejournalroute. All initial cross-task verification limits and the inherited forced-exit minor remain recorded.

**Journal completion:** 4cbcade7a..5fe7ca45d; exactoneContractsController.listJournalEntries route. Current FINANCE Contract plus independently actual-book journal/cost/profit authority; genuine typed source and safe canonical money projection, authority-derived subset availability, bounded discovery/lines/source work and shared nonrecursive historical pair proof. Final35ownedHTTP/PG, APItypes andtouchedlintpass; earlier21canonical qualified separately. Root FULL read finalreports/logs and scopedreview; allCVdispositionshave requiredowners. M5forcedexit remains deferred tofinalreview/final8. Rootreconciles parent11five and original38domain+7adjacent; allremainingconsumer/audit/UI/system/finalpreview duties preserved.

### Task 4.2.2: Contract and customer documents

**Files:** Shared employee-access scope/source/projector/execution infrastructure and contract-documents and documents. Exact baseline slice: `finance-planning-partition.json` → `contract_documents` (27 rows; ContractDocumentsController 8, DocumentsController 19).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Authorize parent case and independently linked source before returning HTML/PDF/file/signature or issuing links. Preserve document state, signature/customer authentication and HTTP headers. Sensitive projection must reach the rendered source rather than JSON only; no authorization by guessed route IDs or file keys.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.

#### Serial execution of Task4.2.2

R152 preserves all27 original methods as6+8+10+3 serial gates. Each child inherits the parent source/privacy/transaction/current-actor/storage/byte-release/audit and canonical-workflow duties. Counts remain uncredited until useful actualHTTP/PG evidence and independent review. Source-policy proposals and contemporaneous marked owned RED precede runtime.

### Task 4.2.2.1: Global template catalog and OCR generation

**Files/scope:** DocumentsController.findAllTemplates/findOneTemplate/createTemplate/updateTemplate/deleteTemplate/generateTemplateFromFile; exactly6 original domain-allocation methods with global-reference runtime policy (R157/R158). Global ContractTemplateService/OcrService inputs, existing catalog keys and owner-reserved settings.documents.manage must be reconciled explicitly.

- [x] Propose current global template/read/create/update/delete/OCR policy, selected-work and exact existing capability mapping; no invented source branch or raw-template lossy owner editor. Root ruling and actual marked isolatedHTTP/PG RED before runtime. R157 and actual18-test owned baseline accepted; initial713db23d8 plus fix59f3e473f independently gated.
- [x] Preserve template CRUD/active/deleted validation, internal render resolution, arbitrary HTML/settings/blocks classification and safe finite lookup versus editor contracts. Template access is not authority to render a Customer or issue private bytes. OCR has explicit actor/current authority, bounded input/controlled provider and genuine effect/audit lifetime.
- [x] Useful positive/denied/current-source/invalid-input/provider-failure/required-evidence proof for all6, relevant canonical regressions/types/lint/coverage, exact report/freeze and independent gate. No provider calls or production edits; fullJWT/UI/final8 remain.

Checkpoint: final103 owned cases, executor6, types/lint and localcheck39 pass. I1 actual DB lifetime fixed underR159/R160; independent scoped spec/quality approved, zero new C/I/M. Initial historical-output/type bounds M1/M2 and validation-noise M3 remain explicit final-review carryovers. CV1 UI7/final8, CV2 audit5 and CV3 next3children remain required. These6countonce toward originalFINANCE allocation underR158: reviewed324domain=280SHOP+44FINANCE;500FINANCEremain, adjacent17/202unchanged. No whole-program/editor/full-auth claim.

### Task 4.2.2.2: Uploaded Contract documents and guarded evidence

**Files/scope:** all8ContractDocumentsController methods: findByContract/getDocumentChecklist/getDocumentAuditTrail/upload/recordView/content/recordDownload/remove. Consume actual current Contract/Customer/preparation and source-sensitive file policy, including genuine ContractFileAccessGuard before interceptor.

- [ ] Concrete parent/document/sensitive/classification/provenance and selectedSHOP-preparation/FINANCE policy plus marked ownedHTTP/PG RED before runtime. Preserve all original file validation/DTO/query/version/state/immutable evidence; no blanket managed guard bypass, guessed historical file source or filename authority.
- [ ] Scope metadata/checklist/history before counts/limits; finite activity labels and genuine retained document-to-parent audit relationship. Separate VIEW/download intent from actual delivery; private headers and buffered/authenticated content must release no byte before final current authorization/required audit commit. Writes join canonical owned transaction and operation-owned staging/cleanup.
- [ ] All8 useful allowed/denied/source substitution/current-wait/malicious bytes/header/hash/rollback/delivery tests, source/storage interface for rendering child3, types/lint/coverage/report/freeze and independent gate. Preserve customer/public/system callers and retained originals; no real provider.

### Task 4.2.2.3: Generated documents, rendering and authenticated delivery

**Files/scope:** DocumentsController.generateDocument/generatePdpaDocument/generateSignedDocuments/previewContract/downloadPdf/regenerateSignedContractPdfs/getDocument/getDocuments/downloadDocument/getSignedUrl; exactly10domain. Consume gated template/source/uploaded-evidence infrastructure.

- [ ] Propose actual renderer inputs/current independent sensitive sources, preview versus immutable canonical signed artifact, generated-record/file proof, finite batch bounds and signed-URL compatibility; marked ownedHTTP/PG RED and root policy ruling before runtime.
- [ ] Preserve canonical documentSourceRevision/state/signature retention; no redacted viewer DTO persisted as official original. Bound renderer/acquisition/staging, final current-source/required-evidence commit before response bytes, actual @Res/stream headers/terminal failures, operation-owned cleanup and postcommit effects. Existing customer/public authentication and old artifacts remain.
- [ ] Useful all10 positives/denials/current revocation and source change during render/store, malicious source/HTML/file substitution, batchpartial/failure semantics and realno-byte-before-commit evidence; controlled providers/canonical regressions/types/lint/coverage/report/freeze/gate. Publish reviewed aftercommit canonical generator for signature child4 and explicit UI7 file/share contract.

### Task 4.2.2.4: Signature evidence and automatic signed-document consumer

**Files/scope:** DocumentsController.signContract/getSignatures/deleteSignature; exactly3domain. Consume reviewed current file/source guard and canonical generated-document producer after actual outer commit.

- [ ] Propose exact capture/read/delete/current actor/independent source/sensitive signature policy, SHOP preparation versus FINANCE, actual customerLIFF counterpart and signature payload validation; marked ownedHTTP/PG RED before runtime.
- [ ] Preserve DRAFT/workflow/state/STAFF=COMPANY alias/current canonical hash and immutable evidence; finite acknowledgement and independently authorized read. Required audit uses owned transaction, and automatic official generation runs only after actual outer commit with genuine principal/initiator/current source, once across retry/rollback; no viewer-redacted canonical output or legacy salesperson impersonation.
- [ ] All3 allowed/denied/current wait/duplicate/state/customer-auth/rollback/effect/renderer integration proofs, canonical regressions/types/lint/coverage/report/freeze and independent gate. Root reconciles exact27/allchild contracts; actualfullJWT/browser/UI7/localcheck/final8 remain.

### Task 4.2.3: Credit checks and KYC

**Files:** Shared employee-access scope/source/projector/execution infrastructure and credit-check, customer-credit-check, global-credit-check and kyc. Exact baseline slice: `finance-planning-partition.json` → `credit_kyc` (19 rows; CreditCheckController 4, CustomerCreditCheckController 5, GlobalCreditCheckController 6, KycController 4).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Close the reviewed CreditCheck origin dependency: newly created unlinked credit needs explicit authenticated immutable source provenance; historical unknown/unlinked credit stays unavailable until an explicitly reviewed repair. No creator/company-name inference or guessed backfill. Reconcile query6/derived and merge maintenance consumers with genuine correlated Contract/RoomCreditAnalysis proofs; a missing adapter or permanently denied ordinary create path is not completion.
- [ ] Constrain search/candidates/results through actual customer/application/case provenance before counts; preserve public/customer authentication. Staff-triggered external checks require current case authority, explicit initiator and postcommit effect handling; mock external providers and avoid real submissions. Protect identity documents and source-sensitive values.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.

### Task 4.2.4: Payments, refunds, receipts and fee-waiver boundaries

**Files:** Shared employee-access scope/source/projector/execution infrastructure and payments, payment-approval, refunds, receipts and late-fee-waiver. Exact baseline slice: `finance-planning-partition.json` → `payments_refunds_receipts_waivers` (47 rows; PaymentApprovalController 5, PaymentsController 23, RefundsController 7, ReceiptsController 8, LateFeeWaiverController 4).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Resolve real parent contract/payment/receipt and source company, preserving allocation, Decimal sums, accounting period and original transaction/executor boundaries. No managed legacy personal approvals; enumerate direct execution paths forTask6. Verify exact duplicate/retry/rollback/no duplicate money, current authority and rendered receipts; no new bank-transfer integration.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.
- [ ] Separately reconcile 13 adjacent staff resource=none routes in `non-domain-staff-partition.json` → `finance_payment_config` without counting them as domain adapters. Resolve current safe own-permission views, payment-method and reversal-reason lookups separately from owner setting writes. Existing managed personal approval/reversal overrides cannot grant an alternative path; publish every actual execution seam for immutable Task6 approvals.


### Task 4.2.5: Collections case work and sessions

**Files:** Shared employee-access scope/source/projector/execution infrastructure and the exact case-work OverdueController slice and collections-session. Exact baseline slice: `finance-planning-partition.json` → `collections_case_work` (32 rows; OverdueController 25, CollectionsSessionController 7).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Use real Contract.assignedTo and applicable case assignments, explicit FINANCE central scopes and SHOP origin filters. Scope queues/counts, bulk assignments, promises and sessions before operations; preserve promise slot/CAS/state/MDM hooks and actual initiator. Never use caller-supplied collector identity as authority.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.

### Task 4.2.6: Collections automation and letters

**Files:** Shared employee-access scope/source/projector/execution infrastructure and the exact automation/letter OverdueController slice. Exact baseline slice: `finance-planning-partition.json` → `collections_automation_letters` (32 rows; OverdueController 32).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Staff-triggered bulk/dunning/escalation/letters require current permission and complete actual target set; source-filter content before documents/delivery. Preserve explicit job/system principal versus staff initiator, original delivery retry/idempotency and effect lifetime; no real sends in tests. An asynchronous accepted request is not proof of delivery.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.

### Task 4.2.7: Recovery, legal cases and device returns

**Files:** Shared employee-access scope/source/projector/execution infrastructure and repossessions, legal-case and device-returns. Exact baseline slice: `finance-planning-partition.json` → `recovery_legal_returns` (24 rows; RepossessionsController 8, LegalCaseController 6, DeviceReturnsController 10).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Reuse actual contract/return/recovery source identities and canonical receive/confirm/reject/settlement flows. Preserve prior contract-state restoration conditions, ownership changes and real SHOP/FINANCE journal/outbox effects. Independent nested/legal/document/financial evidence projection; current authority and duplicate/reversal rollback tests.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.

### Task 4.2.8: Device management

**Files:** Shared employee-access scope/source/projector/execution infrastructure and MDM and the exact OverdueController MDM slice. Exact baseline slice: `finance-planning-partition.json` → `device_management` (27 rows; OverdueController 7, MdmController 20).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Resolve actual device/contract/case sources for requests, approvals, lock/unlock/status and bulk operations. Preserve maker/checker and system-auto-lock semantics without impersonating employees. Current authority for staff commands plus scoped per-device results; mock remote device API, no live lock/unlock.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.

### Task 4.2.9: Accounting, journal and reference boundaries

**Files:** Shared employee-access scope/source/projector/execution infrastructure and accounting, consolidated, journal, reconcile, chart-of-accounts and bank-accounts. Exact baseline slice: `finance-planning-partition.json` → `accounting_journal_references` (52 rows; AccountingClosingController 3, AccountingController 23, ConsolidatedController 3, JournalController 5, ReconcileController 2, ChartOfAccountsController 10, BankAccountsController 6).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Scope persisted source joins and raw-SQL totals before aggregation, including actual company, source pointers and trusted branch metadata; determine manual DTO writability rather than trusting arbitrary tags. Explicit COMPANY authority for genuinely central references/closing. Preserve period/JE balancing/reconciliation/outbox semantics and independently protect cost/profit/payroll expansions.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.
- [ ] Separately reconcile 3 adjacent staff resource=none routes in `non-domain-staff-partition.json` → `finance_accounting_config` without counting them as domain adapters. Replace managed getMyPermissions/personal settings authority with current position capabilities while preserving owner-only management. Explicitly review field sensitivity and current-source totals; no old personal flags as grants.


### Task 4.2.10: Expense and other-income workflows

**Files:** Shared employee-access scope/source/projector/execution infrastructure and expense-documents, expense templates/categories and other-income. Exact baseline slice: `finance-planning-partition.json` → `expenses_income` (57 rows; ExpenseDocumentsController 24, ExpenseTemplatesController 6, TemplateCategoriesController 1, OtherIncomeController 26).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Resolve actual company/origin/parent source; scope AP/AR aging and statements before sums, independently gate documents/payment evidence and sensitive lines. Preserve draft/approve/post/pay/void state machines, Decimal and exactly-once journal effects; consume repair-generated draft provenance from4.1.4. Global templates have explicit reference scope.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.

### Task 4.2.11: Tax, electronic documents and accounting exports

**Files:** Shared employee-access scope/source/projector/execution infrastructure and tax, finance-tax, e-tax/XML and PEAK. Exact baseline slice: `finance-planning-partition.json` → `tax_exports` (32 rows; TaxController 14, FinanceTaxController 3, ETaxController 3, ETaxXmlController 9, PeakController 3).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Use source company and actual receipt/journal/expense links for tax inputs before totals, CSV/XLSX/XML/PDF and external-export bodies. Preserve formats/calculations and approved-state/idempotency. Separate read/export/integration authority; current source check before constructing or scheduling output, mock external publishing.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.

### Task 4.2.12: External finance and receivables

**Files:** Shared employee-access scope/source/projector/execution infrastructure and external-finance, finance-receivable, finance-applications including room applications, company contacts, contact logs and reconciliation. Exact baseline slice: `finance-planning-partition.json` → `external_finance_receivables` (44 rows; ExternalFinanceController 6, FinanceReceivableController 6, FinanceApplicationsController 16, RoomFinanceApplicationsController 3, FinanceCompanyContactsController 5, FinanceReceivableContactLogsController 6, ReceivableReconController 2).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Determine real company from retail/financial provenance, not module name. Source-filter applications/receivables/contact histories/rooms and nested commissions before pagination and balances; chat linkage is not blanket room authority. Preserve settlement/accrual/reconcile and canonical sale-derived amounts, current authority and real rollback evidence.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.
- [ ] Separately reconcile 21 adjacent staff resource=none routes in `non-domain-staff-partition.json` → `finance_external_config` without counting them as domain adapters. Reconcile useful GFIN read/preview versus genuine owner configuration and provider-test effects. Consume reviewed Contact global-lender identity-link maintenance separately from lender settings mutation; no implicit settings grant or module-name company inference. Mock every provider/send.


### Task 4.2.13: Assets, depreciation and equity

**Files:** Shared employee-access scope/source/projector/execution infrastructure and assets, asset journals/reports/transfers, depreciation and equity. Exact baseline slice: `finance-planning-partition.json` → `assets_depreciation_equity` (45 rows; AssetController 20, AssetJournalController 1, AssetReportsController 1, AssetTransferController 1, DepreciationController 4, EquityController 18).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Resolve persisted company and actual branch/asset ownership; transfers require correct stage-specific endpoints. Scope schedules/reports before aggregates and independently protect acquisition/cost/payroll-like evidence where applicable. Preserve depreciation/equity formulas, periods, posting/void/idempotency and cross-company transfer invariants.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.

### Task 4.2.14: Intercompany and settlements

**Files:** Shared employee-access scope/source/projector/execution infrastructure and inter-company, intercompany and interco-settlement. Exact baseline slice: `finance-planning-partition.json` → `intercompany_settlements` (26 rows; InterCompanyController 8, IntercompanyController 2, IntercoSettlementController 16).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Authorize each actual source/destination company with original tuples and persisted batch members; never let a grant in one company expose the other company ledger. Preserve explicit agreed bilateral workflow, reconciliation, contract/device-return pointers, Decimal totals and real outbox transaction semantics; no invented cross-database atomicity.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.

### Task 4.2.15: Reports, dashboards, analytics and search

**Files:** Shared employee-access scope/source/projector/execution infrastructure and the exact overdue analytics slice plus reports, compliance, analytics, dashboard and search. Exact baseline slice: `finance-planning-partition.json` → `reports_dashboards_search` (42 rows; OverdueController 5, ReportsController 16, ComplianceController 4, AnalyticsController 3, DashboardController 13, SearchController 1).

- [ ] RED real isolated PG/HTTP tests for authorized success and denial, current tuple/company/record authority, ID substitution, scoped collections/counts and sensitive/nested/file boundaries for every listed route. No inherited application DB or external effects.
- [ ] Consume reviewed domain predicates/projectors for all joins before rows/counts/aggregates and search snippets. Keep read/export/profit/cost/payroll independent; label scoped results accurately rather than presenting partial company totals. No raw sensitive text/hidden numeric sort channels; exact source/selected-work filters and central grants, useful permitted positives and forbidden negatives.
- [ ] All financial/access writes and existing durable evidence join the actual canonical transaction; recheck after lock waits and whole-attempt retries. Convert managed legacy role/personal-grant vetoes to capabilities while retaining independent workflow/accounting constraints. Preserve file validation, DTO/query/HTTP contracts and operation-owned effects.
- [ ] Run focused relevant regressions, API types, changed-file lint and coverage; reconcile every allocated route with usable positive and denied controls, publish source/projection/transaction/UI/approval contracts, self-review and commit. Missing adapters remain incomplete, never count as enabled.
- [ ] Separately reconcile 3 adjacent staff resource=none routes in `non-domain-staff-partition.json` → `finance_reporting_delivery` without counting them as domain adapters. Authorize actual report generation and source/sensitive projection separately from recipient management and delivery; record observed generated/queued/sent states accurately. No real delivery in tests.


### Task 4.3: Communication, people, settings and realtime scope

**Files:** Add `access-operations-boundaries.ts` and focused tests; extend scope/projector/registrar; modify manifest-listed staff-chat, notifications, chat AI/automation, employees, commission, settings, integrations, users, storage and remaining operational domains, plus both staff gateways and AccessSocketBoundary.

**Interfaces:** Consume same current snapshots and scope engine. Managed realtime must become usable with source-room/message permissions and per-recipient current checks; retain public web-widget/integration authentication independently.

- [ ] RED tests for assigned/scoped chat rooms, managed connect/send/read/delivery, revocation before next delivery, forged room joins, payroll scope, secret settings projection, and legacy override reintroduction.
- [ ] Enable legitimate managed HTTP and websocket operations with current source permissions and sensitive projection. Check every recipient for outgoing messages/notes/events/presence; preserve expiry/account checks and do not broadcast restricted payloads globally. Client claims are not room ownership proof.
- [ ] Make new non-system employee accounts managed with no grants until owner assignment; retain explicit reviewed migration for existing legacy accounts. Prevent old accounting/payment/reverse configuration endpoints from granting personal exceptions to managed accounts. Owner status remains separately protected.
- [ ] Enforce employee/payroll, shared settings, integrations/storage/document links and staff-initiated job scope. Machine jobs retain explicit system actor/authority; do not impersonate an employee. Keep public routes usable with their existing authentication.
- [ ] Run focused HTTP/socket/service tests, API types/coverage; update guide and commit with evidence.

**Serial implementation:** Complete the fourteen review units below in order (4.3.6 has three serial children). The current partition is 267 domain entries plus 145 adjacent staff entries, checked against the actual manifest without duplicate ownership. Use `operations-planning-partition.json`, its exact channel split `operations-channel-partition.json`, and `non-domain-staff-partition.json` in this plan's SDD workspace. Refresh drift before dispatch. These are implementation requirements, not completed coverage or final policy decisions.

**Shared contracts:** Reuse the existing current snapshot, tuple-preserving scope and owned transaction/executor; no second authorization engine. Consume final reviewed party/document/journey/FINANCE producers, not preliminary assumptions. Reconcile each unit's Cron/queue/bootstrap/direct-service paths and public/customer/integration counterparts with explicit system principal or staff initiator, genuine source and observed effect state. Initialization/access registration is distinct from a business mutation. Root Tasks4.4/5/6/7/8 retain cross-domain closure, general audit, financial approvals, UI and full-auth/browser preview obligations.

### Task 4.3.1: Room source, inbox, messages and private conversation

**Files:** Shared source/snapshot/execution/projector contracts and actual facades/helpers for `room_core` in operations-planning-partition.json: 27 baseline domain entries; RoomAssistanceController (1), RoomNotesController (5), SideConversationController (3), StaffChatController (15), StaffInboxController (3).

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Establish actual channel/company, origin/routing and genuine room assignment sources for managed staff. No branch inferred from assigned employee primary branch or null-as-global fallback. Implement useful incoming queue/assigned/branch workflows and independently scope customer family, messages, notes, assistance and side conversations. Scope before list counts, snippets and unread derivation; publish source/current-recipient contracts for every later chat consumer.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.
- [ ] Consume reviewed canonical WORK_CHANNELS, current room assignment and independent Customer/child read proof. Shared Customer alias maintenance fallback is not room/history authority. Branchless incoming work needs explicit supported COMPANY/ASSIGNED or genuine persisted routing origin; resolve its usable intake contract before inventing branch attribution.

### Task 4.3.2: Room assignment, handoff, follow-up and workflow

**Files:** Shared source/snapshot/execution/projector contracts and actual facades/helpers for `room_workflows` in operations-planning-partition.json: 30 baseline domain entries; ChatAiDraftController (2), ChatFollowUpController (2), ChatHandoffController (3), ChatWorkController (2), SessionOpsController (2), SnoozeController (3), StaffChatController (16).

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Consume the reviewed room source engine. Current capability/source decides eligible staff and assignment/handoff/snooze/session transitions, not fixed legacy role lists. Preserve real workflow identity, CAS/idempotency and current actor; no forged assignee or room reference. Staff-triggered follow-up and AI draft work retains initiator and rechecks actual sources at execution, with effects only after commit.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.
- [ ] Use the same current room source and publish the eligibility/assignment contract for realtime, AI and staff selectors; assignment must not capture wider employee authority or flatten original position tuples.

### Task 4.3.3: Room commerce, credit, service and linked library

**Files:** Shared source/snapshot/execution/projector contracts and actual facades/helpers for `room_commerce_credit_service` in operations-planning-partition.json: 27 baseline domain entries; ChatCommerceController (4), ChatLibraryController (7), ChatSalesContextController (3), ChatServiceRequestController (8), RoomCreditController (5).

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Consume room plus reviewed customer/Contract/Product/Sale/Booking/repair/after-sales source contracts. A room link grants no entire customer or financial history. Protect every source in context cards, library/file URLs, credit files, orders, service requests and state synchronization; current source-room idempotency is not authority. Restore independently authorized Booking source-room/online-order navigation and any earlier deferred consumer seams, documenting exact remaining gaps.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.
- [ ] Consume final reviewed after-sales request-link source helper, paired full-ID policy, document byte/provenance contract and FINANCE credit/Contract producers. Preserve actual request-room company authority and independent child action; do not duplicate chat.update into another company solely because a referenced Product is owned there.

### Task 4.3.4: Canned responses and staff content

**Files:** Shared source/snapshot/execution/projector contracts and actual facades/helpers for `canned_content` in operations-planning-partition.json: 17 baseline domain entries; StaffChatController (17).

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Separate shared definition scope from actual room/source use. Canned templates, attachments, placeholders and dynamic product/contract inserts require independent source and sensitive projection before rendering or sending. Keep real system principal and staff initiator distinct; inactive isSystemUser with a historical OWNER role is not staff authority. Preserve canonical send/idempotency and postcommit effect semantics; mock transports.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.
- [ ] Separately reconcile 7 adjacent staff resource=none entries in `non-domain-staff-partition.json` → `operations_canned_sms`; do not count them as domain adapters. Decide actual read/self-service/owner-write semantics from source and effects, not heuristic classification or legacy roles/personal overrides.
- [ ] Adjacent SMS configuration/template reads and mutations need their actual settings/source policy; preview/render/sending are separate actions and may contain independently protected substitutions.

### Task 4.3.5: AI conversation, tools and knowledge boundaries

**Files:** Shared source/snapshot/execution/projector contracts and actual facades/helpers for `chat_ai` in operations-planning-partition.json: 10 baseline domain entries; StaffChatController (10).

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Authorize actual room/customer/document/product sources before constructing model context, retrieving knowledge or invoking tools. Staff-initiated automation retains current actor authority without role impersonation; recheck mutating tool sources and use existing canonical executors and durable evidence. Do not grant AI all data from a room reference. Distinguish queued/proposed/applied outcomes, sanitize tool errors and mock external models/transports.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.
- [ ] Separately reconcile 29 adjacent staff resource=none entries in `non-domain-staff-partition.json` → `operations_chat_ai_admin`; do not count them as domain adapters. Decide actual read/self-service/owner-write semantics from source and effects, not heuristic classification or legacy roles/personal overrides.
- [ ] Separately reconcile AI settings, knowledge and tool configuration routes; secrets, model context and tool results remain independently scoped. An owner configuration grant is not automatic authority to impersonate a staff user or system principal.

### Task 4.3.6: Channel integrations umbrella

- [ ] Complete 4.3.6.1–4.3.6.3 serially with independent review. Their disjoint union is the original 30 channel domain entries plus 62 adjacent staff entries; do not count adjacent rows as domain adapters.

### Task 4.3.6.1: LINE actions, campaigns and channel configuration

**Files:** Actual controllers/services in `channel_line` of `operations-channel-partition.json` (13 current domain entries) and `operations_channel_line` of `non-domain-staff-partition.json` (27 adjacent staff entries); consume reviewed source/executor/current-actor contracts.

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Resolve actual source company/channel, room/customer/case and recipient target set for LINE/Facebook/broadcast/campaign/link invites/payment commands/telephony. Scoped definition access is not permission to every recipient or Contract. Preserve external/public authentication, callback/idempotency/state behavior and existing outbox. Staff jobs recheck actual source/initiator at execution; no live messages, calls, payment-provider submissions or uploads in tests.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.
- [ ] Preserve independently authenticated public/provider callbacks and exact existing idempotency/effect lifetime. Staff operational reads, owner configuration writes, actual provider sends and financial evidence actions require separate semantic review; no live provider calls. Reuse reviewed FINANCE payment/receipt/approval consumers and retain original initiator/current source at job execution.

### Task 4.3.6.2: Facebook comments, channel actions and configuration

**Files:** Actual controllers/services in `channel_facebook` of `operations-channel-partition.json` (12 current domain entries) and `operations_channel_facebook` of `non-domain-staff-partition.json` (24 adjacent staff entries); consume reviewed source/executor/current-actor contracts.

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Resolve actual source company/channel, room/customer/case and recipient target set for LINE/Facebook/broadcast/campaign/link invites/payment commands/telephony. Scoped definition access is not permission to every recipient or Contract. Preserve external/public authentication, callback/idempotency/state behavior and existing outbox. Staff jobs recheck actual source/initiator at execution; no live messages, calls, payment-provider submissions or uploads in tests.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.
- [ ] Preserve independently authenticated public/provider callbacks and exact existing idempotency/effect lifetime. Staff operational reads, owner configuration writes, actual provider sends and financial evidence actions require separate semantic review; no live provider calls. Reuse reviewed FINANCE payment/receipt/approval consumers and retain original initiator/current source at job execution.

### Task 4.3.6.3: Broadcast media, telephony, integrations and webhook administration

**Files:** Actual controllers/services in `channel_transport` of `operations-channel-partition.json` (5 current domain entries) and `operations_integrations_webhooks` of `non-domain-staff-partition.json` (11 adjacent staff entries); consume reviewed source/executor/current-actor contracts.

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Resolve actual source company/channel, room/customer/case and recipient target set for LINE/Facebook/broadcast/campaign/link invites/payment commands/telephony. Scoped definition access is not permission to every recipient or Contract. Preserve external/public authentication, callback/idempotency/state behavior and existing outbox. Staff jobs recheck actual source/initiator at execution; no live messages, calls, payment-provider submissions or uploads in tests.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.
- [ ] Preserve independently authenticated public/provider callbacks and exact existing idempotency/effect lifetime. Staff operational reads, owner configuration writes, actual provider sends and financial evidence actions require separate semantic review; no live provider calls. Reuse reviewed FINANCE payment/receipt/approval consumers and retain original initiator/current source at job execution.

### Task 4.3.7: Communication analytics, satisfaction and AI usage

**Files:** Shared source/snapshot/execution/projector contracts and actual facades/helpers for `communication_analytics` in operations-planning-partition.json: 20 baseline domain entries; AiUsageController (4), ChatAnalyticsController (15), CsatController (1).

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Scope each contributing room/message/campaign/case/actor source before counts, ranking, buckets, period comparison and export. Exact filtered contributors govern sensitive access; unrelated foreign data must neither leak nor suppress an otherwise permitted filtered result. Prevent text/search/statistical oracles and separate safe employee identity from payroll; preserve original timezone/cursor/aggregation semantics.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.

### Task 4.3.8: Managed realtime commands and per-recipient delivery

**Files:** Shared source/snapshot/execution/projector contracts and actual facades/helpers for `realtime_delivery` in operations-planning-partition.json: 22 baseline domain entries; EventsGateway (8), StaffChatGateway (14).

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Enable legitimate managed StaffChatGateway and EventsGateway paths using reviewed room/source/capability projection. Check current account/token expiry/position/source for connect, join, command and each recipient before outgoing notes/messages/events/presence; no broad room/role/branch/global emission bypass. Preserve customer/widget/integration auth independently. Prove forged joins, revocation before next delivery and authorized current multi-source output with real socket tests.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.

### Task 4.3.9: Notification subscriptions, inbox and delivery

**Files:** Shared source/snapshot/execution/projector contracts and actual facades/helpers for `notification_delivery` in operations-planning-partition.json: 17 baseline domain entries; NotificationsController (17).

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Scope actual notification source and intended recipient for list/count/read/subscribe/configuration/dispatch, preserving current actor and private payload boundaries. Do not leak source details through preview text, push or websocket delivery. Scheduled/system work retains explicit actor and initiator, canonical delivery/idempotency/outbox semantics and current recipient eligibility. No real external delivery in tests.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.
- [ ] Separately reconcile 2 adjacent staff resource=none entries in `non-domain-staff-partition.json` → `operations_notification_templates`; do not count them as domain adapters. Decide actual read/self-service/owner-write semantics from source and effects, not heuristic classification or legacy roles/personal overrides.
- [ ] Template administration and actual recipient delivery need separate current authority; source redaction applies before queued/push/websocket preview payloads, not merely the on-screen inbox.

### Task 4.3.10: Employee, payroll and commission scope

**Files:** Shared source/snapshot/execution/projector contracts and actual facades/helpers for `people_commission` in operations-planning-partition.json: 16 baseline domain entries; CommissionController (12), EmployeesController (4).

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Use actual employee/company/branch and commission Contract/Sale provenance. Employee salary/payroll is sensitive; Customer.salary remains customer income. Source-specific primary and sensitive rights apply before aggregate/export, related documents and payout/rule changes. Safe staff selectors do not grant employee detail. Preserve canonical commission/payout/math/state and approval seams; source assignment is not inferred from historical recordedBy.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.
- [ ] Separately reconcile 15 adjacent staff resource=none entries in `non-domain-staff-partition.json` → `operations_people_provisioning`; do not count them as domain adapters. Decide actual read/self-service/owner-write semantics from source and effects, not heuristic classification or legacy roles/personal overrides.
- [ ] Own the adjacent Users/Invite account-provisioning routes here, including the independently authenticated public Invite.register counterpart. All new non-system employee accounts are managed with no grants until owner assignment; preserve current-owner/last-owner/revision locks and existing reviewed migration for old users. Safely project findApprovers/getMyPermissions without legacy per-user grants.

### Task 4.3.11: Administration, configuration and reference data

**Files:** Shared source/snapshot/execution/projector contracts and actual facades/helpers for `administrative_references` in operations-planning-partition.json: 23 baseline domain entries; AppController (1), BranchesController (2), CompanyController (3), DataAuditController (8), HealthController (1), MigrationController (1), SettingsController (7).

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Reconcile all listed domain rows AND adjacent settings/company/migration/health entrypoints; consume the account provisioning and safe staff-selector contract from 4.3.10. Preserve last-owner and current access write lock/revision contracts. Old personal accounting/payment/reverse settings cannot grant managed exceptions. Explicit company/global scope and secret-safe configuration/status output; data-audit/migration results independently protect source details, never run live repair/import actions during tests.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.
- [ ] Separately reconcile 17 adjacent staff resource=none entries in `non-domain-staff-partition.json` → `operations_admin_references`; do not count them as domain adapters. Decide actual read/self-service/owner-write semantics from source and effects, not heuristic classification or legacy roles/personal overrides.
- [ ] Account provisioning belongs to 4.3.10; this unit owns actual company/branch/admin/reference/migration status and configuration surfaces. Owner-only classification is a starting inventory, not proof that every ordinary useful read must require owner or expose secrets.

### Task 4.3.12: Files, OCR, privacy, tags, presets and todos

**Files:** Shared source/snapshot/execution/projector contracts and actual facades/helpers for `files_privacy_todos` in operations-planning-partition.json: 28 baseline domain entries; CustomerTagsController (4), FilterPresetsController (3), OcrController (6), PDPAController (3), ShopUploadController (1), TodosController (10), VoiceMemoRestoreController (1).

- [ ] RED real isolated DB/HTTP or socket controls appropriate to each boundary, with actual permitted success and absent/foreign/current-revoked tuple denial. Every baseline and newly introduced staff route must be reconciled; classification or missing-adapter denial is not completion.
- [ ] Authorize actual source before upload association, download/stream/sign/render/restore/OCR or file-key reuse. Client URL/key is not ownership proof, and already-issued external links are not a claim of instant revocation. Scope customer tags/filter presets/todos/privacy records through actual source/owner semantics; no creator-as-universal-assignment guess. Preserve operation-owned staging/cleanup, current authority and canonical retention/public auth, with no new destruction policy or real uploads.
- [ ] Preserve canonical business state, actor/public/integration contracts and captured actual transaction ownership. Significant writes and existing durable evidence commit together; no best-effort success or independent inner commit. External/file effects use the reviewed staging/retry/after-commit lifetime and mocks in tests. No inherited application DB, production migration, real-user assignment, push/merge/deploy.
- [ ] Relevant focused regressions, types/lint/coverage and all allocated boundary success/denial evidence. Report exact reusable source/caller/output/UI/audit/approval contracts and remaining consumers, self-review and commit. Resolve concrete policy uncertainty with root before inventing source or authority.
- [ ] Separately reconcile 13 adjacent staff resource=none entries in `non-domain-staff-partition.json` → `operations_privacy_migration`; do not count them as domain adapters. Decide actual read/self-service/owner-write semantics from source and effects, not heuristic classification or legacy roles/personal overrides.
- [ ] Use reviewed document provenance/storage release and genuine manual/AUTO tag source rules; no target-customer origin inferred for formerly unanchored merged dependencies. Privacy/export/encryption/restore/migration jobs preserve actual principal, initiator, retention and source authority; test only isolated synthetic data.

### Task 4.4: Domain closure and cross-channel sensitive-data regression

**Files:** Any remaining manifest-listed domain adapter/service; `tools/check-access-coverage.mjs`, coverage guide, focused end-to-end scope/export tests and shared catalog when real capabilities need correction.

**Interfaces:** All existing staff domain policies must have a working validated adapter or an explicit owner-reserved business capability justified by the spec. A denial because an adapter is absent is a pending feature, never completed integration.

- [ ] Reconcile every inventory row against registered runtime adapters and downstream query/mutation enforcement; finish remaining domains (including assets, intercompany, reporting, search, documents, import/export and on-behalf-of-user automation). Add coverage assertions for registered domain boundaries and new route drift.
- [ ] Prove end-to-end authorized success as well as denial for representative paths across each adapter family. Check counts/aggregates, nested relations, CSV/PDF/files, search snippets, error text and realtime for cost/profit/payroll or cross-scope leakage. Actual audit history projection remains Task 5.
- [ ] Verify no managed route uses legacy roles/personal grants as an alternative authorization source, no UI-configurable capability is permanently vetoed by an unexplained old role check, and current position changes apply to next operations.
- [ ] Measure representative large authorized histories/exports with isolated synthetic data, including source-ID materialization, complete receipt partials, the 60-second customer export and authority-fence/revocation waits. Resolve demonstrated bottlenecks and the derived11 redundant Payment load/quadratic receipt preparation; report sizes, timings and limits without claiming production measurements.
- [ ] Bound verified document stream acquisition as well as buffered read, including abort/late-resource cleanup and stalled-provider authority-fence/revocation timing. Preserve required commit-before-byte-release; report local provider contracts versus actual cloud privacy and process-death orphan limitations honestly.
- [ ] Run isolated relevant API regression and types; leave zero unexplained domain-integration gaps, update guide with precise evidence, self-review and commit. Mark umbrella Task 4 complete only after independent review.

### Task 5: All-staff safe activity history and durable event capture

**Files:** Modify audit interceptor/service/controller/module/query DTO/sanitizer and auth events; add focused activity capture/redaction files and tests; update schema additively only if required.

**Interfaces:** Keep existing AuditLog and chain compatibility. Provide all-staff `GET /audit/activity` and safe statistics/details with filters (actor, dates, action, company, branch, archived); source data details require current resource permissions. Add authenticated `POST /audit/activity/client-event` only for allowlisted UI events with source='CLIENT'; it cannot assert a financial success. Expose awaited durable mutation audit helper for Task 6.

- [ ] Test ordinary employees can see owner/colleague summary events but cannot leak raw values, free-text secrets, cross-scope document IDs, search matches, stats or exports; archived entries use same redaction. Test failed login/denied access attribution without fabricated staff identity and no audit recursion.
- [ ] Capture read/search/export/download and denied/failed attempts at appropriate server boundaries, and login/logout/reset events. Existing mutation capture must label request intent rather than claim request bodies are persisted before/after. Important financial/access operations use transactional audit/outbox; preserve legacy hash chain and retention behavior.
- [ ] Capture automation actor kind and initiator when known. Include stable actor identifiers/name snapshots, company/branch, event/result/source/correlation context; never store tokens/passwords/OTP or raw confidential search strings. Handle anonymous login failures without creating fake users.
- [ ] Complete meaningful safe reason capture for managed skip-tracing and other reason-required operations. A reasonProvided flag is not the reason. Reconcile a validated structured business-reason contract or appropriately protected business-detail source with UI7 and source-filtered audit detail; do not put arbitrary secret-bearing free text into safe activity payloads or claim omitted text can be recovered. Cover actual reason recording/retrieval/denial and keep legacy stored history intact.
- [ ] Return safe activity summaries to all staff; expose details only through whitelist and source-specific grants. Deny raw legacy log endpoints/exports to viewers lacking source access. No content-edit/delete endpoints. Existing archive updates remain possible.
- [ ] Focused tests/types, commit. Identify server-observed versus client-requested events accurately.

### Task 6: Discount and financial approval enforcement

**Files:** Modify sales discount policy and actual sale writer/DTO/controller, existing refunds/refund permission helper, late-fee-waiver, cancellation and interest-reduction mutation paths; create focused approval service/DTO/tests and schema additive migration if needed.

**Interfaces:** Approval snapshots bind requester, source identity, items/quantity/prices/promotion/extra discount or refund amount, approver, reason, status and consumed revision. Provide owner-managed discount cap configuration and request/approve/reject APIs under employee-access approvals or existing domains, keeping transaction execution in existing services. Reuse existing refund bookkeeping and bank-reversal evidence; do not initiate bank payments.

- [ ] Test manager A cannot approve B; both baht/% caps required; missing cap and below-floor route owner; employee self-approval denied, owner self-approval requires reason; changed snapshot invalidates approval; no floor/cost in errors.
- [ ] Replace legacy role-based discount percentages/client-provided secondApproverId claims with persisted approval validation. Use Decimal; normal price and valid owner-configured promos need no extra approval. Support product/category caps with restrictive applicable rules and allocate invoice discounts consistently.
- [ ] Require persisted owner authorization for actual cancellation/refund/interest reduction/penalty waiver commits, across all inventory-listed entrypoints. Finance staff/owner execute an approved refund only once and only its immutable items/amount; changes require a new approval. Preserve existing financial formula and transactional state machines.
- [ ] Add atomic audit with mutation, concurrency/duplicate checks and stale approval protection. Prove failures cannot leave money changed without durable evidence.
- [ ] Run focused unit tests and isolated financial integration tests, commit. Document actual API contracts for frontend.

### Task 7: Position management, employee assignment, approvals and history UI

**Files:** Create `apps/web/src/pages/EmployeeAccessPage.tsx`, focused `components/employee-access/` and `hooks/useEmployeeAccess.ts`; modify AuthContext, ProtectedRoute, app route registration, menu/work-navigation/settings-registry, UsersPage/UserDetailPage, AuditLogsPage, relevant sale/refund/approval UI; add meaningful component tests.

**Interfaces:** Consume server endpoints and shared snapshot/catalog. Route `/employee-access` owner-only with tabs positions/employees/approvals as appropriate; `/audit-logs` safe history for all staff. Preserve the single SHOP/FINANCE sidebar selector; show assignment scope context clearly.

- [ ] Test non-owner cannot edit, multiple scope tuples remain separate, position changes show affected count/sensitive grants, stale edits show conflict, and loading/error/no-access/empty states. Test safe history and approval reason requirements.
- [ ] Build owner position list/editor grouped by business area, explicit permission checkboxes/actions, cost/profit warnings, clone/deactivate and affected employees preview; reserved owner actions cannot become editable grants. Owner changes apply to all assigned people.
- [ ] Build username assignment editor with position + company + scope/branch per row, current effective access/explanation, migration preview and differences; saving applies reviewed positions, no per-user permission toggles. Make legacy status visible. Allow multiple positions per branch/context.
- [ ] Connect frontend navigation/action availability to effective scoped access. Build all-staff activity table with safe filters, archived option, expandable authorized details; no raw sensitive payload rendering. Integrate discount requests/caps/owner reason and refund approval/execution controls with actual APIs.
- [ ] Use existing Thai typography/tokens/PageHeader/forms, keyboard labels and responsive layouts. Build/tests/types, commit. No static fake interactions presented as working backend.

### Task 8: Isolated end-to-end verification and working local preview

**Files:** Create `tools/test-employee-access.sh`, `apps/api/e2e/employee-access.e2e-spec.ts`, `tools/check-local-employee-access.mjs`; extend preview support and `tools/local-check.mjs` to exercise actual feature services; write `docs/guides/employee-access.md`.

**Interfaces:** Dedicated PostgreSQL cluster/temporary DB and test users; use same checkout API and web. Report `.tmp/local-preview/employee-access-check.json` and screenshots. Feature preview data is synthetic and clearly labelled. Never inherit an application DATABASE_URL.

- [ ] Exercise owner create/edit/assign positions, manager A + sales B, accountant A + sales B, reassign/revoke live session, costs/profits, approval/rejection/selfapproval/refund duplicate, all-staff audit visibility and archived redaction through HTTP and browser rather than mocks alone.
- [ ] Exercise coverage checker and public/customer/integration boundaries. Include representative export/realtime and automated actor tests. Verify durable audit failure rolls back sensitive mutations. Confirm no unexplained inventory gaps.
- [ ] Run isolated regression appropriate to finance changes, then `npm run local:check` with a free LOCAL_PREVIEW_PORT. Fix failures with focused reproduction; only rerun broad checks after changes justify it. Feature smoke must use real services; existing unrelated fixture routes may remain synthetic and documented.
- [ ] Inspect desktop/mobile screenshots, verify route navigation and mutation persistence, leave preview running. Write configuration/migration guide including review required before live user migration and no guessed caps.
- [ ] Commit verification/support changes, record precise results and limitations for final independent review. No merge/push/deploy.
