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

- [ ] Complete four serial independently reviewed units: identity/origin/basic10, derived history/export11, merge/contact/document6 and journey4. Preserve original all31 scope, sensitive and source-safe behaviors; no omitted adapter counts as completion.
- [ ] Reconcile31 runtime registrations, legitimate positive/denial evidence and source/alias/current-authority/transaction contracts with prior consumers and downstream FINANCE/chat. No guessed historical origin or real employee migration; final full guards/browser/local:check belongs to8.

### Task 4.1.5.1: Shared identity origins and basic customer/contact boundaries

**Files:** Reusable party/current-source/query/projection contracts; customers query/write/facade/controller, Contacts service/resolver/controller, PII helpers and additive source schema/DTO/migration as needed. Ten methods: CustomersController.create, update, remove, findAll, findDetail, findOne, search; ContactsController.list, findOne, ensureRole.

- [ ] RED owned PostgreSQL/Nest HTTP legitimate scoped success/no-grants for all10, original tuples, current authority/source waits and actual same-party relationships. New unlinked leads must be usable through authenticated explicit company/origin or genuine persisted assignment; never infer from actor primary branch/creator or guess historical backfill. Missing sources deny even OWNER; valid COMPANY and real ASSIGNED positives must work.
- [ ] Extend/reuse partyAllows/currentCustomerReadWhere and actual historical source predicates. Publish reusable typed identity/current origin/assignment/alias/field contracts and integrate earlier trade-in, sale/booking and repair/after-sales consumers so freshly created parties are selectable only in authorized scope. Existing live historical Sale, service/warranty, TradeIn and genuine FINANCE source evidence stays distinct from current Product and must not grant unrelated history. Explicit no-tuples predicates stay false.
- [ ] Scope findAll/search/detail/Contact relations before filters, counts, pagination and nested aggregation. Existing list filters include purchase, credit, overdue, assignment, chat-contact time/channel and tier; derive from authorized contributing sources only, preserving legitimate capabilities and nullable unavailable versus true zero. Nested actual Contract/Payment/Sale/Product/chat/referral/supplier/trade-in data needs its own source/action/sensitive authority. A safe customer identity does not grant all aliases or history. Publish precise FINANCE/chat source seams rather than declaring those downstream adapters done.
- [ ] Preserve canonical normalization, encryption/hash, national-ID/phone/email uniqueness, phone-before-contact-code lock order, global P-N numbering, ghost revival and stub-upgrade semantics. Reusing an opaque natural-key identity is not authority to overwrite/revive a hidden Customer, add a new origin that reveals unrelated history, or return duplicate-party details/counts. Actual ensureRole child creation independently requires child capability/source and gives the new Customer/Supplier proven usable origin. All real writes/PII and required audit use the actual outer retryable transaction; no internal root commit or swallowed required evidence.
- [ ] Preserve Customer.salary as customer income, not employee payroll. Add owner-editable sensitive.customer-identity.read (ดูเลขประจำตัวลูกค้าและผู้ปกครองเต็มเลข) for full customer/guardian national IDs, independently paired with base read at the same proven source. Without it retain safe masking; never primary role or raw ciphertext/hash. Future BRANCH_MANAGER, FINANCE_MANAGER and ACCOUNTANT templates include the key; OWNER retains persisted universal authority, other templates do not receive it by default, and saved positions remain unchanged. Apply actual scope to masked/full fields, search and duplicate responses as well as normal reads; document/file references require independent current documents/source authority. Preserve unmanaged and public/customer authentication behavior. Mutation acknowledgements must not imply broad read grants.
- [ ] Types/migration/shared tests/lint/coverage and meaningful affected consumer regressions, exact producer contract and owner-editable sensitive defaults, self-review/report/commit. No existing position migration. Publish UI explicit origin/input/masking and Tasks5/6/4.2/4.3 contracts; root owns independent review and final8.

#### Serial execution of Task 4.1.5.1

Execute the following three units with independent review. All ten parent methods and requirements above remain binding. Catalog/default changes add zero routes; the parent completes after four canonical writes and six basic queries are reconciled.

### Task 4.1.5.1.1: Configurable full customer identity capability defaults

**Files:** Shared employee-access catalog/defaults/tests and focused EmployeeAccessService saved-template tests only. Zero runtime routes, schema or source-policy changes.

- [ ] RED/GREEN add GRANT key sensitive.customer-identity.read with Thai label ดูเลขประจำตัวลูกค้าและผู้ปกครองเต็มเลข in sensitive group; future BRANCH_MANAGER, FINANCE_MANAGER and ACCOUNTANT include it, other assignable defaults do not. Persisted OWNER remains universal through existing evaluator.
- [ ] Owner can configure this key by position; no source/base customer/contact capability accompanies it. Prove initializing future templates does not rewrite existing saved positions/grants or migrate real employees. Do not implement PII projections or change source/read behavior in this catalog-only unit.
- [ ] Shared tests/build, affected lint and focused saved-template regression; self-review/report/commit. Publish exact key/default contract for later source/read/write/UI consumers, no route count.

### Task 4.1.5.1.2: Explicit party origins and canonical customer/contact writes

**Files:** Same shared engine plus Customer/Contact source resolver, additive scalar-origin/assignment schema/DTO/migration, canonical CustomerWrite/ContactResolver/Contacts ensureRole helpers and narrow managed write adapters. Four methods: CustomersController.create, update, remove; ContactsController.ensureRole.

- [ ] RED real owned PostgreSQL/Nest HTTP legitimate scoped success/no-grants for all4, original tuples and source/current-authority changes. New genuine explicit-origin leads must be usable in earlier trade-in/sales/booking/repair/after-sales selection through reusable party predicates; no arbitrary/global party fallback or fake actor/branch. Producer tests do not complete the later six public queries.
- [ ] Add nullable immutable scalar Customer/Contact company/branch origins. SHOP requires actual live SHOP branch; FINANCE permits true central null branch or explicit live SHOP origin branch. Stamp only genuinely new identities from authenticated authorized destination. Preserve existing origins on natural-key reuse, ghost revival and stub upgrade; no guessed historical backfill or new multi-origin editor. Reuse same-party persisted historical source evidence and explicitly false no-tuples behavior.
- [ ] No autoassignment. Explicit choice/change of active non-system business assignee requires corresponding customers.update/contacts.update through COMPANY or BRANCHES authority at actual source independent of proposed/current assignee, plus actual create/child authority when provisioning. ASSIGNED-only cannot self-capture/reassign to gain scope. This changes business assignment, never employee positions/grants. Current assignment changes must be audited and rechecked; historical assignment is not current authority.
- [ ] Preserve normalization/validation/encryption/hash and canonical national-ID/phone/email uniqueness, lock order, global contact numbering and actual ghost/stub rules. Existing revival/enrichment needs read/update on actual proven existing source; narrow deleted-record revival retains source proof. Unknown duplicate identity returns generic conflict without identity/history/counts. EnsureRole independently authorizes actual Customer/Supplier child action/source, creates usable origin and preserves idempotent relationships. Reuse opaque natural keys without overwriting hidden records or stamping new visibility on existing Contact.
- [ ] Actual raw business loads and all canonical child/status/PII/required audit writers join the same owned retryable transaction. No broad read projection/legacy role as mutation authority, inner commit, compensation or swallowed required evidence. Prove late failure rollback and real concurrency/unique behavior. Managed action response is narrow/source-safe, never raw ciphertext/hash/hidden history; full-ID output uses reviewed independent capability on same proven source.
- [ ] Publish reusable typed origin/assignment/alias/current-source/party query/PII/action/transaction contracts. Ordinary FINANCE history source is live FINANCE plus actual live SHOP Contract origin, with genuine Contract.assignedToId valid for ordinary case reads; independent child reads required, no expansion of exchange approval. Narrow chat read provenance uses canonical WORK_CHANNELS and actual room assignment; branchless rooms require COMPANY or unrestricted ASSIGNED, not staffbranch/alias. Broad child queries remain .1.3/4.2/4.3, never complete by helper alone.
- [ ] Shared/API types/migration/changed lint/coverage and meaningful affected prior party-consumer regressions, report/self-review/commit. No real users/positions migrated. Final fullJWT/browser/local:check remains8; six query adapters and parent10 remain pending.

### Task 4.1.5.1.3: Basic customer/contact queries and parent10 closure

**Files:** Reviewed party origin/source/projection engine plus CustomerQuery, CustomerPurchaseSummary, CustomerChatRooms, CustomerTier and necessary real contributor helpers; Contact reads and actual adapters. Six methods: CustomersController.findAll, findDetail, findOne, search; ContactsController.list, findOne.

- [ ] RED real owned PostgreSQL/Nest HTTP all6 positives/no-grants, current source/assignment and original company/branch tuple isolation, new origin and historical same-party evidence. Read authority is independent of action-only write acknowledgements and does not expose whole alias-family histories.
- [ ] Scope actual contributing Contract/Payment/Sale/Product/credit/chat/referral/supplier/trade-in/tag records before filters, counts, pagination, ranking and nested details. Preserve complete existing findAll purchase/credit/overdue/assignment/contact-time/channel/tier/KPI semantics through authorized inputs; no masked fields over unscoped filter/aggregate. COMPANY and real ASSIGNED positives work; genuinely unresolvable old room origins remain unavailable, with explicit4.3 origin seam rather than invented staffbranch.
- [ ] Reuse genuine FINANCE Contract origin and case-assignment read contract, preserving independent actual child permissions and current Product versus historical Sale semantics. SHOP warranty identity/status alone never grants FINANCE balances. Scope room-derived filters/metadata through canonical WORK_CHANNELS, actual room assignment and live company; no legacy role or prospective customer branch as history authority. Distinguish unavailable/incomplete from true zero/none while preserving legitimate filtered outcomes.
- [ ] Full customer/guardian national IDs require sensitive.customer-identity.read and base read on the same proven source; preserve masking otherwise, no primaryrole fallback. Apply to search and nested/referrer/duplicate/Contact projections; ciphertext/hash never projected. Customer.salary is customer income, not payroll. Document links and sensitive product/financial values need independent source/field rights before inclusion.
- [ ] Actual current snapshot/exact client and captured child queries use existing execution contract. Existing PII/evidence capture reflects real masked/full behavior without secrets or fake actors. Recheck shared helper changes against prior trade-in/sales/repair/after-sales and canonical write4 consumers.
- [ ] Types/lint/coverage/focused regressions; reconcile exact10=write4+query6 registrations and actual success/denial evidence, with zero catalog-only route credit. Report precise producer/API/PII/new-origin/UI and remaining derived11/merge6/journey4/FINANCE/chat/audit/approval/fullguard contracts; self-review/commit. Root marks parent after independent review.

### Task 4.1.5.2: Customer derived histories, analytics and export

**Files:** Reviewed identity/source engine plus customer query/analytics/purchase/chat/credit-insight/tier helpers. Eleven methods: CustomersController.exportRows, getChatSummary, getContracts, getInsights, getReferrals, getReferralStats, getRiskFlag, getSummary, getTier, getUpsellCandidates, getWatchList.

- [ ] RED real owned PostgreSQL/Nest HTTP positive/no-grants across11, independent current child sources, original tuples/alias isolation and sensitive output/search/export. Reuse reviewed identity/source contracts; customer existence permission never grants complete FINANCE/chat/history.
- [ ] Scope actual Contract/Sale/Payment/call/credit/referral/chat/points contributors before counts, statistics, status/risk/tier, ranking, limits and exports. Preserve canonical financial/state formulas, dates/cursors and contributor identity. Authorized filtered outcomes and unverified/incomplete outcomes must be distinguished; no hidden-source existence/count leaked via labels, negatives, default zero or rankings.
- [ ] Export uses exact domain export plus independently required source/document/sensitive grants and the existing consistent-snapshot/row-limit behavior. CSV/JSON/HTML inputs, free text, national IDs and links use the same source-safe field contract; no masked display over unscoped search/aggregate. Current Product cost/profit stays separate from historical sales and real contract balances.
- [ ] Actual captured child queries and required evidence join the existing owned execution; no parallel engine. Publish named actual FINANCE/chat source predicates/adapters still pending, without permanently suppressing legitimate data. Cover earlier basic detail/list/search consumers if shared contributors change.
- [ ] Focused covering tests/types/lint/coverage, source and Task5/6/7/8 handoff, self-review/report/commit. Eleven-route registration/evidence count only after independent review.

### Task 4.1.5.3: Identity merge, contact enrichment and customer documents

**Files:** Reviewed party/source and canonical CustomerMerge/CustomerWrite/SkipTracing/ContactResolver/Contacts helpers; document/storage consumers and actual transaction audit. Six methods: CustomersController.absorbInto, fillContact, updateContact, uploadDocument, deleteDocument; ContactsController.merge.

- [ ] RED real owned PostgreSQL/Nest HTTP all6 legitimate/no-grants with both parties, original tuple/current source controls, true alias relationships and hidden-source/forged-key denials. Shared identity selection does not authorize merging all histories.
- [ ] Independently authorize both parties and all genuinely affected source relationships before canonical merge/absorb/enrichment. Preserve unique/conflict rules, duplicate phone/ID checks, alias cycle/depth guards, actual old/new immutable historical origins and canonical rollback. Re-resolve pointers after changes; no privilege elevation by aliases, actor identity or a supplied destination branch. Basic create stub/ghost and ensureRole producer contracts stay consistent.
- [ ] Join all real linked updates/journey/PII/required audit in the actual retryable outer transaction; late failure leaves no partial merge/identity mutation. Audit summaries never expose raw PII/hash/ciphertext. Real concurrent/idempotent merge/enrichment must keep canonical invariants and safe errors.
- [ ] Document metadata/keys/links need actual current party and document action/source authority; validate persisted provenance, not path prefix or caller-supplied URL. Preauthorize before storage/signing; reuse owned preparation/cleanup/effect hooks where I/O occurs. Never delete preexisting shared/source files due to another operation's failure; truthful generated/requested effects, no real providers in tests.
- [ ] Focused regressions for basic and derived consumers, types/lint/coverage; exact source/alias/document/atomicity and UI/audit downstream contracts, self-review/report/commit. Parent remains pending journey4.

### Task 4.1.5.4: Customer journey and parent closure

**Files:** Reviewed party/source engine plus customer-journey source adapters/state/summary/manual entry helpers. Four methods: CustomerJourneyController.createEntry, list, removeEntry, summary.

- [ ] RED owned PostgreSQL/Nest HTTP all4, authorized multi-source success and absent/foreign-source denial, genuine alias-family scope, current authority and search/cursor/aggregate boundaries.
- [ ] Resolve each actual Sale, Contract, Payment, collection, credit, service, points, chat and manual-entry source before pagination/count/stage/summary/activity probes. Visible customer/merged identity does not grant every history. Preserve existing order/timezone/cursors and public/customer/cron separation. Project dynamic free text, files, IDs and derived snippets from current authorized contributors.
- [ ] Manual create/remove requires actual current source and action; preserve canonical creator/business checks and durable immutable evidence. Captured child queries/writes use the existing owned transaction, no best-effort success for required mutation evidence. Distinguish legitimate filtered summaries from genuinely unproven sources.
- [ ] Reconcile all31 runtime adapters/positive-denial evidence and cross-unit current/source/alias/sensitive/atomicity contracts, including prior shop consumers. Publish remaining named FINANCE/chat/automation/audit/approval/UI/fullguard obligations precisely; no missing source or internal helper counted as complete.
- [ ] Covering regressions/types/lint/coverage, final parent report/guide, self-review/commit. Root marks parent only after independent review and owns final8 checks.

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
