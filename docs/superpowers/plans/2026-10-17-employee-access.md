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

Task 4 is executed as four serial, separately reviewed phases because the checked inventory contains 1,092 domain entrypoints. Task 4 is complete only after 4.1–4.4 pass; no phase may claim whole-program coverage alone.

**Files:** Create focused `access-query-scope.ts`, `access-resource.service.ts`, `access-sensitive.service.ts`, `access-shop-boundaries.ts` and tests under `apps/api/src/modules/employee-access/`; modify EmployeeAccessModule and SHOP/customer domain files identified by the checked manifest, particularly products, sales, bookings, inventory, purchase-orders, suppliers, quality-control, trade-in, after-sales, repairs, customer-journey, customers and contacts. Add source-origin schema/migration only where existing relations cannot safely scope newly created records.

**Interfaces:** Consume Task 3 `CollectionScope`, `AccessDecision`, `ACCESS_BOUNDARIES`, current snapshots and `assertAccess`. Produce reusable scope-predicate helpers, persisted record resolver, source-aware sensitive projector and injectable boundary registrar. Each helper must have a typed exported contract documented in the phase report for 4.2/4.3; registration alone must never authorize an unscoped handler. Domain adapters may use ModuleRef to reach existing services without introducing module import cycles.

- [ ] Write RED tests for permission-specific branch OR predicates, assigned ownership, company isolation, list/count/pagination parity, ID substitution, source/destination transfers, and purchasing cost access vs ordinary sales. Include manager A + sales B and accountant A + sales B positive/negative controls.
- [ ] Build shared query machinery from original tuples: explicit COMPANY, BRANCHES with nonempty allowed IDs, ASSIGNED with persisted assignment and optional branch restriction. Require a source-specific company predicate; unknown model/ownership semantics deny. Never pick a representative branch or filter after pagination.
- [ ] Implement actual SHOP record and collection adapters, preserving existing service behavior, validation, statuses/file headers and independent business constraints. Collection executors bypass controller pipes, so explicitly validate DTO/filter inputs. Convert conflicting role-only checks to capabilities. Resolve record company from existing ownership/Entity semantics, not module names.
- [ ] Scope shared customer/contact identities through permitted source relationships, and independently scope nested history. Persist authenticated origin/assignment for newly created unlinked leads when necessary; do not expose all customers or make fresh records inaccessible. No guessed backfill of historical ownership.
- [ ] Add source-aware SHOP cost/profit projections including nested purchase documents and file boundaries; sensitive capabilities stay configurable and scoped. Internal floor calculations may use cost without returning it. Do not blindly treat Customer.salary as employee payroll.
- [ ] Run meaningful isolated HTTP/service/query tests, API types and coverage checks; update the coverage guide with enabled adapters and exact remaining domains; self-review and commit.

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

- [ ] Complete Task 4.1.4.1 and Task 4.1.4.2 serially, each with independent review.
- [ ] Reconcile every baseline route against current registered methods and legitimate success plus denial evidence; preserve all parent workflow, sensitive-data and financial requirements.

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

- [ ] Complete canonical exchange prerequisite 4.1.4.2.1, then all 24 after-sales routes/documents in 4.1.4.2.2, each independently reviewed. Producer work alone earns no completed route count.
- [ ] Preserve every original 24-route after-sales requirement in the consumer and reconcile all 39 parent repair/after-sales routes only after both units pass. Direct exchange endpoint adapters remain in their allocated later units and must consume the same canonical producer, never another executor.

### Task 4.1.4.2.1: Canonical exchange source and transaction producer

**Files:** Same source/current-snapshot/execution infrastructure plus ContractExchangeService, ExchangeCancelService and DefectExchangeService and narrowly necessary captured journal/company/product/credit/repair helper seams; focused owned PostgreSQL tests. No direct endpoint or after-sales route completion is claimed by this prerequisite.

- [ ] RED real isolated PostgreSQL controls for permitted canonical managed exchange operations and absent/foreign original-tuple denial, including current authority/source after actual waits. Resolve actual FINANCE Contract financial source separately from narrow SHOP warranty view; Contract has no company column. Use persisted live origin branch, independently authorized current Product/party/source/destination relationships and real workflow identity. No creator/collections assignment inferred as exchange authority.
- [ ] Publish explicit source/capability and same-transaction contracts for submit/preview/approve/reject/cancel, defect eligibility/execute and activation finalization seam. Raw managed callers need the current actor and owned execution/client; no alternate root transaction or supplied role/branch as authority. Convert captured children to the reviewed actual-client contract and whole-attempt retry; no approval bypass via internal AUTO calls. Actual affected source and destination authority is independently resolved before mutation.
- [ ] Preserve canonical MEMO ownership swap, PRICED draft/finalization, defect replacement, cancellation state/CAS/period/Decimal/JE/input-VAT/credit/maker-checker/tier rules and test-data fence. No new financial executor, formula, real bank transfer or guessed cap. Current owner is additionally required for reversal of an already applied MEMO or finalized exchange; genuine pre-finalization no-money draft cancellation remains scoped update. Decide from locked persisted state, never request claims. Final persisted approval workflows remain Task6.
- [ ] Existing durable mutation/status/audit evidence must join the actual financial transaction; post-commit notifications/effects only after actual commit. Prove actual canonical ownership/Contract/JE/links/audit rollback on late failure and duplicate/concurrent once-only state. Preserve unmanaged compatibility. Do not add a userId to the currently inert finalization audit call without also joining its exact tx; publish correct activation caller contract for4.2.
- [ ] Prove independent SHOP repair/after-sales authority does not grant FINANCE exchange or other Product-source authority, and valid explicitly granted cross-source operations succeed. Type/lint/coverage and focused existing canonical financial regressions; report exact reusable source/tx/caller/output contracts, all unresolved public/controller/UI/approval/audit consumers, self-review and commit. Root owns integrated fullguard/browser/local:check.

### Task 4.1.4.2.2: After-sales cases, exchange integration and documents

**Files:** Same access engine plus `after-sales` facade and case/query/lookup/exchange/repair/document helpers; actual ContractExchange, DefectExchange, repair, chat-case, photo and storage dependencies; isolated tests. Current surface: AfterSalesController (24).

- [ ] Consume reviewed repair/warranty, canonical exchange producer and sales/product source contracts. RED isolated DB/HTTP tests for all 24 routes with legitimate managed success and persisted no-grants denial, source substitution, tuple/company/branch isolation before counts, and current-source mutation checks. Resolve persisted raw linked IDs rather than trusting client input or assuming a foreign-key relation exists.
- [ ] Preserve physical receipt, WALK_IN, repair forwarding, same-model and priced exchange, rejection/cancellation/delivery and existing maker/checker/state rules. Authorize each actual affected source and required workflow capability, including replacement product and contract; service-case access alone does not confer money execution authority. Extend canonical child services to join actual transactions rather than add competing executors; publish direct endpoint seams for later FINANCE/SHOP closure.
- [ ] Preserve source-room idempotency and global IMEI case exclusion without disclosing other-source case identifiers or granting all room/customer history. Any read-side stage reconciliation must affect only an authorized source, join appropriate durable evidence, and preserve retry semantics. Existing source lookup must remain useful with safe fields and accurate current capability-derived outcomes.
- [ ] Use the reviewed preauthorization/staging/retry contract for intake and extra photos: validate DTOs/files, authorize before storage, stage each operation once outside the global DB lock, reauthorize actual sources in the transaction, clean only newly owned unused/failed keys. Queue LINE and other external effects only after actual outer commit; test with mocked transport.
- [ ] Protect document HTML/PDF and image streams before reading, signing or rendering each actual source. Independent documents/read/export and sensitive checks apply to source and copied purchase photos, contract/sale/product/replacement/payment content. JSON projection alone is insufficient; send bytes only after successful actual commit. Record print requests/generation honestly, not proof of paper printing.
- [ ] Prove actual canonical exchange/repair/financial rollback and concurrent/idempotent protection, source-safe error responses and permitted document output. Types/lint/coverage/focused regressions, exact contracts and Task5/6/7 seams in report, self-review and commit; reconcile all 39 parent routes after both independent reviews.

### Task 4.1.5: Shared customers, contacts and journey boundaries

**Files:** Extend same infrastructure; modify `customers`, `contacts`, `customer-journey`; additive source-origin schema/migration where required. Current manifest: CustomersController, ContactsController and CustomerJourneyController (31 domain entries).

- [ ] RED and real isolated DB tests for shared identities visible through an allowed source without exposing other-company/branch histories; new unlinked leads remain accessible only to permitted origin/assignment; no guessed historical backfill.
- [ ] Implement all record/query/search/analytics/bulk/file boundaries and nested source scopes before pagination/count/aggregation. Authenticated explicit origin and genuine case assignment support new records without broadening old unlinked records.
- [ ] Preserve Customer.salary as customer income context, distinct from employee payroll. Redact sensitive product/document values using their own source scope; hiding columns after an unscoped count is insufficient.
- [ ] Types/migrations/coverage/focused tests, report with source schema contracts for FINANCE/chat phases, self-review, commit.

### Task 4.1.6: SHOP scope closure

**Files:** Remaining SHOP controllers/services from checked manifest and common scope/projector infrastructure, guide and regression tests.

- [ ] Reconcile Task 4.1.1–4.1.5 registrations against actual runtime methods and finish adjacent SHOP domains omitted by named-module inventory. No absent adapter counted as complete.
- [ ] Cross-unit authorized-success and denial checks for tuple combinations, transferred records, shared sources and sensitive nested/file/aggregate output; current changes apply on next operation.
- [ ] Types/coverage/isolated regressions and complete SHOP integration evidence; document clearly remaining FINANCE/operations phases. Self-review/commit; umbrella Task 4.1 complete after independent review.

### Task 4.2: FINANCE, accounting and financial reporting scope

**Files:** Extend employee-access scope/resolver/projector infrastructure; add `access-finance-boundaries.ts` and focused tests. Modify manifest-listed contracts, credit-check, payments, receipts, refunds, collections-session, overdue, legal-case, repossessions, finance-receivable, external-finance, expense-documents, journal, accounting, chart-of-accounts, bank-accounts, tax, reporting, analytics and finance-report service paths as required.

**Interfaces:** Consume Task 4.1 scope and projection contracts plus Task 3 decision/executor registry. Extend those contracts instead of introducing a second access engine. Approval policy changes themselves remain Task 6; authorization must already prevent scope/legacy personal-grant bypass.

- [ ] RED tests for assigned FINANCE cases, explicit central grants, SHOP origin-branch filters without granting SHOP access, payment/refund access through parent records, scoped balances/counts/reports and prohibited cross-company joins.
- [ ] Implement real record/query/export adapters across FINANCE/accounting. Use actual Entity/company resolver behavior: external finance retail receivables are not automatically company FINANCE merely because of their name. ASSIGNED requires a real case assignment; recordedBy/createdBy alone is not silently equivalent to ownership.
- [ ] Scope joins, totals, searches, file/signature URLs and raw SQL before aggregation. Separate revenue/report access from profit/cost/export permissions; preserve Decimal calculations and financial state transitions.
- [ ] Replace managed role vetoes/personal permission readers with capabilities, preserving maker-checker, accounting period, approved-state and transactional invariants. Task 6 will enforce the new reserved approvals at actual money commits.
- [ ] Isolated financial/query regressions, API types and coverage; document exact integrations, self-review, commit.

### Task 4.3: Communication, people, settings and realtime scope

**Files:** Add `access-operations-boundaries.ts` and focused tests; extend scope/projector/registrar; modify manifest-listed staff-chat, notifications, chat AI/automation, employees, commission, settings, integrations, users, storage and remaining operational domains, plus both staff gateways and AccessSocketBoundary.

**Interfaces:** Consume same current snapshots and scope engine. Managed realtime must become usable with source-room/message permissions and per-recipient current checks; retain public web-widget/integration authentication independently.

- [ ] RED tests for assigned/scoped chat rooms, managed connect/send/read/delivery, revocation before next delivery, forged room joins, payroll scope, secret settings projection, and legacy override reintroduction.
- [ ] Enable legitimate managed HTTP and websocket operations with current source permissions and sensitive projection. Check every recipient for outgoing messages/notes/events/presence; preserve expiry/account checks and do not broadcast restricted payloads globally. Client claims are not room ownership proof.
- [ ] Make new non-system employee accounts managed with no grants until owner assignment; retain explicit reviewed migration for existing legacy accounts. Prevent old accounting/payment/reverse configuration endpoints from granting personal exceptions to managed accounts. Owner status remains separately protected.
- [ ] Enforce employee/payroll, shared settings, integrations/storage/document links and staff-initiated job scope. Machine jobs retain explicit system actor/authority; do not impersonate an employee. Keep public routes usable with their existing authentication.
- [ ] Run focused HTTP/socket/service tests, API types/coverage; update guide and commit with evidence.

### Task 4.4: Domain closure and cross-channel sensitive-data regression

**Files:** Any remaining manifest-listed domain adapter/service; `tools/check-access-coverage.mjs`, coverage guide, focused end-to-end scope/export tests and shared catalog when real capabilities need correction.

**Interfaces:** All existing staff domain policies must have a working validated adapter or an explicit owner-reserved business capability justified by the spec. A denial because an adapter is absent is a pending feature, never completed integration.

- [ ] Reconcile every inventory row against registered runtime adapters and downstream query/mutation enforcement; finish remaining domains (including assets, intercompany, reporting, search, documents, import/export and on-behalf-of-user automation). Add coverage assertions for registered domain boundaries and new route drift.
- [ ] Prove end-to-end authorized success as well as denial for representative paths across each adapter family. Check counts/aggregates, nested relations, CSV/PDF/files, search snippets, error text and realtime for cost/profit/payroll or cross-scope leakage. Actual audit history projection remains Task 5.
- [ ] Verify no managed route uses legacy roles/personal grants as an alternative authorization source, no UI-configurable capability is permanently vetoed by an unexplained old role check, and current position changes apply to next operations.
- [ ] Run isolated relevant API regression and types; leave zero unexplained domain-integration gaps, update guide with precise evidence, self-review and commit. Mark umbrella Task 4 complete only after independent review.

### Task 5: All-staff safe activity history and durable event capture

**Files:** Modify audit interceptor/service/controller/module/query DTO/sanitizer and auth events; add focused activity capture/redaction files and tests; update schema additively only if required.

**Interfaces:** Keep existing AuditLog and chain compatibility. Provide all-staff `GET /audit/activity` and safe statistics/details with filters (actor, dates, action, company, branch, archived); source data details require current resource permissions. Add authenticated `POST /audit/activity/client-event` only for allowlisted UI events with source='CLIENT'; it cannot assert a financial success. Expose awaited durable mutation audit helper for Task 6.

- [ ] Test ordinary employees can see owner/colleague summary events but cannot leak raw values, free-text secrets, cross-scope document IDs, search matches, stats or exports; archived entries use same redaction. Test failed login/denied access attribution without fabricated staff identity and no audit recursion.
- [ ] Capture read/search/export/download and denied/failed attempts at appropriate server boundaries, and login/logout/reset events. Existing mutation capture must label request intent rather than claim request bodies are persisted before/after. Important financial/access operations use transactional audit/outbox; preserve legacy hash chain and retention behavior.
- [ ] Capture automation actor kind and initiator when known. Include stable actor identifiers/name snapshots, company/branch, event/result/source/correlation context; never store tokens/passwords/OTP or raw confidential search strings. Handle anonymous login failures without creating fake users.
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
