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

- [ ] Write behavioral tests proving manager A + sales B cannot approve B, accountant A + sales B cannot see B cost, company isolation, assigned-case access, missing resource context deny, and configurable cost/profit defaults. Observe RED.
- [ ] Implement catalog covering current application domains (inspect menus/settings and controller modules), read/create/update/delete/approve/export where applicable, sensitive cost/profit/salary permissions, reserved owner operations, and nine default positions. Give catalog Thai labels and group metadata. Reserve owner rights structurally; reject unknown permissions. No guessed discount caps.
- [ ] Implement tuple-preserving evaluator and branch extraction. Empty scoped branch lists deny. Company-wide access requires explicit COMPANY grant. All active staff may see activity summaries independently of positions; details use source grants.
- [ ] Run shared tests and build; record GREEN, self-review, commit.

### Task 2: Position persistence, owner management, current snapshots, migration proposals

**Files:** Modify `apps/api/prisma/schema.prisma`; create additive migration and `apps/api/src/modules/employee-access/{employee-access.module,employee-access.controller,employee-access.service,access-snapshot.service,employee-access.dto}.ts` with focused specs; modify `apps/api/src/app.module.ts` and auth `/me` response where appropriate.

**Interfaces:** Consume Task 1 types. Export injectable `AccessSnapshotService.forUser(userId): Promise<AccessSnapshot>` and assertion helpers usable in transactions. REST under `/employee-access`: `GET me`, `GET catalog`, owner `GET/POST positions`, `PATCH positions/:id`, `GET employees`, `PUT employees/:id/assignments`, `GET migration-preview`. Version mutations and use expected revision conflict checks. `GET me` returns the current snapshot to active staff. Owner CRUD responses include affected employee counts; migration preview is read-only.

- [ ] Write failing tests for non-owner denial including forged position code, invalid scope/company/branches, permission validation, protected last-owner status, stale revision conflict, rollback when durable audit fails, and position edits taking effect for all assignments.
- [ ] Add positions with permission arrays, active/deleted state, revision; assignment tuples tied to users and branches/company with explicit scope; managed flag/revision on users. Preserve legacy fields and data. No automatic account migration based on guessed real duties. Seed default templates idempotently through an owner action or isolated fixtures; never seed new users with OWNER rights.
- [ ] Implement scoped assignment replacement and position edits in transactions with durable existing audit entries; validate referenced active positions/branches. Return clear Thai errors. Disable/delete positions safely and prevent reserved rights being granted by editable templates.
- [ ] Build current uncached snapshots, including account disabled/deleted checks. For unmigrated users, return explicit managed=false and proposals based on legacy role/company/branch and enumerate legacy personal grants requiring review. Management changes must not silently retain per-user overrides for managed users.
- [ ] Generate Prisma, build shared/API types, focused tests; commit and report schemas/endpoints for downstream consumers.

### Task 3: Authenticated runtime boundary and complete route inventory

**Files:** Create `apps/api/src/modules/employee-access/{access-policy,access-policy.interceptor,access-context,access-policy.registry}.ts` and focused tests; modify JWT strategy, RolesGuard, BranchGuard, entity-scope guard/interceptor, app module, gateway authentication/authorization as required; create `tools/check-access-coverage.mjs` and `docs/guides/employee-access-coverage.md`.

**Interfaces:** Use current snapshot from Task 2. Attach `user.access: AccessSnapshot` without changing user.role. Expose `assertAccess(user, permission, resource)` and permission-specific scope helpers for services. Route policy metadata declares required permission, company resolution and resource resolver; include explicit public/customer/integration/self-service classifications. A managed staff request may not silently fall back to legacy role authorization.

- [ ] Test role-vs-position independence, direct URL/API bypass, revocation on next request, unmapped managed staff route denial, CUSTOMER token rejection on staff routes, preserved public webhook authentication, and denied access capture integration hook.
- [ ] Inventory all controller methods, exports/files and socket commands from actual code. Implement checked registry/metadata; a coverage command must fail for newly unclassified entrypoints. Avoid inferring sensitive actions solely from HTTP verb or mapping everything to OWNER.
- [ ] Resolve current snapshots after authentication; guard ordering must work (global guards run before controller JWT guards). For managed users enforce capability at the proper boundary and remove legacy RolesGuard veto after a successful explicit policy check; no role spoofing. Preserve legacy path only for explicitly unmigrated accounts and expose that status.
- [ ] Define resource/scope requirements for domains and fail closed if context cannot be resolved; Task 4 completes actual list/query and ID-record enforcement before delivery. Socket operations using staff identities must revalidate current grants; maintain public integrations separately.
- [ ] Record current coverage and remaining domain integrations in the guide, run tests/types, commit. Do not claim whole-program enforcement while Task 4 is incomplete.

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
