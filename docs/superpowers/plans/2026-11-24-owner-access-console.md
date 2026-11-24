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

- [x] Write failing API unit tests for persisted-owner enforcement, projection ignores injected unrelated fields/events, bounded pagination, active context and snapshot, owner-target mutation rejection. Run Jest focused files, expect new assertions fail for missing behavior.
- [x] Implement minimal read service/DTO/controller methods and owner-target protection; register module/provider and exact access manifest entries. Follow existing naming and current snapshot validation.
- [x] Extend existing PostgreSQL integration spec: save position/assignments then query effective snapshot/history, edit permission and verify revoked snapshot, reject stale/owner/nonowner edits; unrelated history absent. Run `bash tools/test-employee-access-persistence.sh` with its isolated database, expect pass.
- [x] Run focused employee-access unit tests and API/shared type/build checks; `node tools/check-access-coverage.mjs` must pass. Record RED/GREEN commands and output, self-review, commit only task files.

## Task 2: Owner-facing three-tab console

**Files:** `apps/web/src/pages/EmployeeAccessPage/` index, API hook/types adapter, PositionsTab, EmployeesTab, HistoryTab, PermissionPicker, AccessReviewDialog, pure preview helpers and tests as needed; `config/settings-registry.tsx` and associated registry tests. Reuse existing `SettingsItemRoute` registration in `App.tsx`; add a direct App route only if needed.

**Interfaces:** Consume Task 1 shared API contract and current existing service DTOs. Route `/settings/access/employee-permissions`, owner-only, link from access settings. Cache prefix `employee-access`; invalidate all affected queries after successful write. All mutations retain expectedRevision captured when editor opened. On 409 preserve draft and require explicit reload; do not silently rebase. Effective snapshot from server for existing managed users; pending edits distinctly labelled proposed.

- [x] Write failing UI/pure preview tests: reserved permissions cannot select; search preserves selections; clone code differs; edit preview lists added/removed rights and affected staff; independent tuples and conditional ASSIGNED; BRANCHES empty rejected; owner/inactive locked; stale confirmation cleared on edits; legacy migration requires explicit confirmation and override-removal warning; API failures/retry and 409 preserve draft; history read output. Run Vitest, expect missing-feature failures.
- [x] Implement responsive Thai page with three tabs and existing settings/navigation components. Group catalog by groupLabel and support search. Explicit seed templates, create/edit/clone/activate/deactivate with impact review. Include sensitive permission labels and small explicit advisory dependency warnings without automatic grants.
- [x] Employee detail uses authoritative snapshot plus source tuples; assignments editable independently with active work/branch options, before/after scope and permission review and legacy override warning. Empty grants and COMPANY choices need visible warning; save only after review. Owner authority locked. Do not claim this activates every legacy page.
- [x] Add safe paginated history with loading/empty/error/retry and labelled before/after detail. No arbitrary JSON rendering.
- [x] Run focused Vitest suite and web type check, existing settings/navigation tests; fix issues and commit task files. Record test evidence and self-review.

## Task 2.1: Bind confirmation to reviewed position revisions and affected count

**Files:** `apps/api/src/modules/employee-access/employee-access.dto.ts`, `.service.ts`, `.service.spec.ts`, `.integration.spec.ts`; `apps/web/src/pages/EmployeeAccessPage/api.ts`, `AssignmentEditor.tsx`, `PositionEditor.tsx`, `MigrationReview.tsx`, `EmployeeAccessPage.test.tsx`.

**Interfaces:** Add optional integer >=0 `expectedPositionRevision` to each `AccessAssignmentDto`. The console always supplies it from the exact position set shown at review. Existing API callers without it keep current behavior. Inside the serialized owner transaction, compare with persisted position revision before any legacy cleanup or assignment write; mismatch returns409. This metadata is neither persisted as an assignment field nor shown in audit tuples. Client409 handling retains draft and explicit reload.

Add optional integer >=0 `expectedAffectedEmployeeCount` to UpdateAccessPositionDto. Console position edits/status changes always send the count shown in review. Compare against affectedCount inside the serialized transaction before any writes; mismatch409. Also fix Task2 review: review legacy-override removal for managed accounts as well, preserving distinct first-time conversion wording and requiring renewed acknowledgement if the pre-save summary changes. Execute these together with Task2 fix round1; one scoped review covers the complete confirmation fix.

- [x] RED: a newly selected position changes after review, employee revision stays unchanged; console save must fail409 with no account/override/assignment/audit mutation. Prove on isolated PostgreSQL. Add UI assertion that each reviewed tuple sends its position revision, not a guessed employee revision.
- [x] RED: new assignment changes position affected count without changing position revision; stale impact edit fails409 with no mutation. UI sends reviewed count. Managed override review includes false reversal override and resets acknowledgement on changes.
- [x] GREEN: DTO validation and lock-protected comparison, console payload revision binding. A matching revision succeeds and omitted field remains compatible. Shared snapshot/history types remain unchanged.
- [x] Run targeted API and web tests plus isolated persistence; self-review, commit scoped changes and task review. Subsequent full localcheck and browser rerun verify integration.

## Task 3: Local live-service verification and handoff

**Files:** isolated local owner-access preview harness under `tools/`, browser smoke spec/config if appropriate, `docs/superpowers/reports/2026-11-24-owner-access-console.md`; minimal fixes needed by observed failures.

**Interfaces:** Serve actual app frontend with actual employee-access Nest controller/service and isolated synthetic PostgreSQL. Explicit loopback only. Synthetic auth may be provided only by separate test harness, never production bypass. Record its limitation. Keep app auth client response shape and CSRF conventions. Root local-check default preview is separate and does not certify this console.

- [x] Start fresh isolated backend and this worktree's frontend on free loopback ports. Seed synthetic owner, manager, branches, legacy overrides and managed staff. Use only own cluster/process files and cleanup own processes only when necessary.
- [x] Browser verify owner navigation, role creation/edit/clone, branch-specific assignment with review, legacy conversion, snapshot/source explanation, revocation, history and narrow/mobile layout; non-owner API denied. Assert persisted DB state via real service. Failures drive regression test then minimal fix.
- [x] Run `npm run local:check` with unused LOCAL_PREVIEW_PORT and appropriate focused type/test commands. Inspect outputs and screenshots. Report scope and any pre-existing failures honestly.
- [x] Fresh whole-branch review using review-package and requesting-code-review prompt. Fix material issues with reproducing tests; document decisions and remaining limits. Commit scoped changes. Leave verified preview running and report clickable URL, branch/commit, plan/report links and no production change.

### Final review fix wave

Bind override removal to a server-generated per-user fingerprint returned by migration-preview and the optional `expectedLegacyGrantsFingerprint` assignment DTO field (always sent by the new console). Acquire the target user row lock before reading reversal state, and reuse both legacy map writers' advisory locks in deterministic order before reading/replacing maps, including absent-row creation. Compare reviewed state inside the same transaction before any writes. RED→GREEN isolated tests cover all three override changes, no side effects on conflict, current token success, omitted-token compatibility and initially absent maps. UI tests cover the reviewed token and reload/acknowledgement path. Root browser asserts outgoing token, then reruns current-source localcheck and the desktop/mobile smoke. One scoped re-review verifies the fix wave.
