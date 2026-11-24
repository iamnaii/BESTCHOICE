# Owner Access Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for Tasks 1–2 and controller execution for verification Task 3.

**Goal:** Deliver a working local owner permissions console with reviewable role and assignment changes, effective access explanation and durable history.
**Architecture:** Reuse EmployeeAccessService for writes, add bounded owner read projections, render React Query tabs in the existing settings shell; enforce policy on the server and preview only in the browser.
**Tech Stack:** NestJS, Prisma/PostgreSQL, shared TypeScript, React/TanStack Query, Vitest/Jest/Playwright.
**Spec:** `docs/superpowers/specs/2026-11-24-owner-access-console.md`

## Global Constraints

- Work only in this isolated worktree; preserve other sessions and never merge, push, deploy or mutate production data.
- Read AGENTS.md, .claude/CLAUDE.md and applicable rules/workflows. Use existing components, semantic tokens, Thai copy, current API client and authentication.
- Server checks persisted owner authority; never rely on hidden buttons. Owner authority is implicit and not assignable. No schema migration or business workflow rollout in this slice.
- Keep grants as independent position/company/scope/branch tuples. ASSIGNED requires actual resource assignment; never claim that a catalog preview proves workflow availability.
- Existing mutations retain optimistic concurrency, atomic audit, legacy-override removal and revision invalidation. No silent migration, extra grants or template overwrite. Explain immediate effects before confirmation.
- Read-only history uses an allowlisted projection and pagination. No unrelated audit payloads, secrets, tokens, or customer records.
- All DB execution uses an explicitly created isolated synthetic PostgreSQL database, never inherited application DATABASE_URL.
- Meaningful RED→GREEN tests per behavior; focused suites and type checks, isolated persistence plus browser flow. Run npm run local:check and keep this checkout's verified preview running. No exhaustive unrelated suites against live services.

## Review Focus

Inspect stale or deleted positions and branches, concurrent editor changes, inactive/owner targets, malicious audit JSON and pagination inputs, duplicate assignment tuples, mixed company/branch scope, empty grant removal, failed preview/history queries, hidden selection after catalog search, stale confirmations after form changes, managed conversion warnings and real server enforcement. Verify that the browser preview cannot connect to production or relax production auth. Verify position changes revoke existing staff access and history accurately reflects persisted changes.

## Task 1: Owner console API and response contracts

**Files:** shared `employee-access-console.ts` and index export; API `employee-access-console.service.ts`, `.spec.ts`, existing employee-access controller/module, DTOs, service and integration spec; access-coverage manifest file as discovered by scanner.

**Interfaces:** Existing positions/employees/catalog/migration-preview writes unchanged, except reject assignment edits targeting OWNER. New `GET context` returns active `branches: {id,name,companyCode}[]` plus companies. New `GET employees/:id/effective-access` returns `AccessSnapshot` (service validates active target). New `GET history?page&limit` returns `{items,total,page,limit}` with typed safe entries `{id,createdAt,actor:{id,name}|null,action,entity,entityId,before,after}`. Safe before/after supports known position fields (id/code/name/permissions/isActive/revision), assignments (positionId/company/scope/branchIds) and managed/revision flags; no arbitrary JSON. Templates creation projects position list. Preserve removedLegacyGrants only as boolean/present counts if useful; never dump arbitrary config values. Share exact types with frontend.

- [ ] Write failing API unit tests for persisted-owner enforcement, projection ignores injected unrelated fields/events, bounded pagination, active context and snapshot, owner-target mutation rejection. Run Jest focused files, expect new assertions fail for missing behavior.
- [ ] Implement minimal read service/DTO/controller methods and owner-target protection; register module/provider and exact access manifest entries. Follow existing naming and current snapshot validation.
- [ ] Extend existing PostgreSQL integration spec: save position/assignments then query effective snapshot/history, edit permission and verify revoked snapshot, reject stale/owner/nonowner edits; unrelated history absent. Run `bash tools/test-employee-access-persistence.sh` with its isolated database, expect pass.
- [ ] Run focused employee-access unit tests and API/shared type/build checks; `node tools/check-access-coverage.mjs` must pass. Record RED/GREEN commands and output, self-review, commit only task files.

## Task 2: Owner-facing three-tab console

**Files:** `apps/web/src/pages/EmployeeAccessPage/` index, API hook/types adapter, PositionsTab, EmployeesTab, HistoryTab, PermissionPicker, AccessReviewDialog, pure preview helpers and tests as needed; route `App.tsx`, actual settings registry discovered via rg, associated registry tests.

**Interfaces:** Consume Task 1 shared API contract and current existing service DTOs. Route `/settings/access/employee-permissions`, owner-only, link from access settings. Cache prefix `employee-access`; invalidate all affected queries after successful write. All mutations retain expectedRevision captured when editor opened. On 409 preserve draft and require explicit reload; do not silently rebase. Effective snapshot from server for existing managed users; pending edits distinctly labelled proposed.

- [ ] Write failing UI/pure preview tests: reserved permissions cannot select; search preserves selections; clone code differs; edit preview lists added/removed rights and affected staff; independent tuples and conditional ASSIGNED; BRANCHES empty rejected; owner/inactive locked; stale confirmation cleared on edits; legacy migration requires explicit confirmation and override-removal warning; API failures/retry and 409 preserve draft; history read output. Run Vitest, expect missing-feature failures.
- [ ] Implement responsive Thai page with three tabs and existing settings/navigation components. Group catalog by groupLabel and support search. Explicit seed templates, create/edit/clone/activate/deactivate with impact review. Include sensitive permission labels and small explicit advisory dependency warnings without automatic grants.
- [ ] Employee detail uses authoritative snapshot plus source tuples; assignments editable independently with active work/branch options, before/after scope and permission review and legacy override warning. Empty grants and COMPANY choices need visible warning; save only after review. Owner authority locked. Do not claim this activates every legacy page.
- [ ] Add safe paginated history with loading/empty/error/retry and labelled before/after detail. No arbitrary JSON rendering.
- [ ] Run focused Vitest suite and web type check, existing settings/navigation tests; fix issues and commit task files. Record test evidence and self-review.

## Task 3: Local live-service verification and handoff

**Files:** isolated local owner-access preview harness under `tools/`, browser smoke spec/config if appropriate, `docs/superpowers/reports/2026-11-24-owner-access-console.md`; minimal fixes needed by observed failures.

**Interfaces:** Serve actual app frontend with actual employee-access Nest controller/service and isolated synthetic PostgreSQL. Explicit loopback only. Synthetic auth may be provided only by separate test harness, never production bypass. Record its limitation. Keep app auth client response shape and CSRF conventions. Root local-check default preview is separate and does not certify this console.

- [ ] Start fresh isolated backend and this worktree's frontend on free loopback ports. Seed synthetic owner, manager, branches, legacy overrides and managed staff. Use only own cluster/process files and cleanup own processes only when necessary.
- [ ] Browser verify owner navigation, role creation/edit/clone, branch-specific assignment with review, legacy conversion, snapshot/source explanation, revocation, history and narrow/mobile layout; non-owner API denied. Assert persisted DB state via real service. Failures drive regression test then minimal fix.
- [ ] Run `npm run local:check` with unused LOCAL_PREVIEW_PORT and appropriate focused type/test commands. Inspect outputs and screenshots. Report scope and any pre-existing failures honestly.
- [ ] Fresh whole-branch review using review-package and requesting-code-review prompt. Fix material issues with reproducing tests; document decisions and remaining limits. Commit scoped changes. Leave verified preview running and report clickable URL, branch/commit, plan/report links and no production change.
