# Task 2 — position persistence and current snapshots

Status: implemented; focused verification passed. No production data, automatic user migration, merge, push or deployment. Final integrated `local:check`/browser/API preview belongs to the controller after runtime/UI tasks.

## RED / GREEN evidence

- Initial `npm test --workspace=@installment/api -- --runTestsByPath src/modules/employee-access/employee-access.service.spec.ts`: RED, missing `EmployeeAccessService`/`AccessSnapshotService` modules (TS2307). Added persistence boundary implementation; permission, scope, stale-revision and non-owner tests GREEN.
- Controller-confirmed FINANCE interpretation got a behavioral RED: integration test `FINANCE branch scope uses SHOP origin branches without granting SHOP access` failed with `BadRequestException: สาขาไม่พร้อมใช้งานหรือไม่อยู่ในส่วนงานที่เลือก` (9 pass / 1 fail). Changed assignment validation and snapshot validation to permit active SHOP origin branches within FINANCE tuples. Same test GREEN, SHOP resource still denied.
- Final unit/regression run: `npm test --workspace=@installment/api -- --runTestsByPath src/modules/employee-access/employee-access.service.spec.ts src/modules/employee-access/access-snapshot.service.spec.ts src/modules/users/users.service.spec.ts src/modules/auth/auth.service.spec.ts` — 4 suites / 69 tests passed.
- Additional users regression run: `npm test --workspace=@installment/api -- --runTestsByPath src/modules/users/__tests__/users-update-full.spec.ts src/modules/users/__tests__/reverse-override.service.spec.ts` — 2 suites / 15 tests passed. Total focused unit/regression coverage: 84 tests.
- `tools/test-employee-access-persistence.sh` — fresh isolated PostgreSQL 16, all 368 migrations applied, 11 integration tests passed. Covers idempotent explicit template seed, read-only proposals/personal grants, assignment replacement cleanup, immediate position propagation, stale/concurrent revisions, audit-failure rollback of position + user revision + assignments, FINANCE origin-branch scope, inactive/deleted staff, both existing account mutation paths, concurrent last-owner removals.
- `npx prisma generate --schema apps/api/prisma/schema.prisma` passed; shared build (each test prehook) passed; `npx tsc --noEmit -p apps/api/tsconfig.json` passed; `git diff --check` passed.
- Integration fixture problems encountered and fixed: required CompanyInfo.directorName omitted initially; Prisma proxy inheritance caused test-only recursive `$transaction` when injecting audit failures. Replaced it with an explicit wrapper around a real transaction. Final failure injection verifies real PostgreSQL rollback.

## Persistence / invariants

Additive migration `20261017100000_employee_access_positions`:

- `User.accessManaged` defaults false, `User.accessRevision` defaults 0. Legacy role/company/branch fields untouched.
- `AccessPosition`: unique immutable code, name, permission strings, isActive, revision, timestamps/deletedAt.
- `EmployeeAccessAssignment`: user/position FKs, `companyCode` FK to CompanyInfo.companyCode, enum scope BRANCHES/ASSIGNED/COMPANY, timestamps/deletedAt.
- `EmployeeAccessAssignmentBranch`: compound-key assignment/branch FK junction. Its lifecycle follows the soft-retired assignment version; existing assignment versions retained.
- Position changes increment that position revision and every assigned user's accessRevision. Assignment replacement marks previous rows deleted, creates new tuples and increments the target accessRevision. Empty assignment list deliberately manages the account with no assigned permissions; owner authority remains independent.
- Owner mutation authority always reads current persisted active staff `User.role === OWNER`; neither position name/code nor a supplied role establishes owner status. OWNER code is reserved and never seeded/assigned.
- A PostgreSQL transaction advisory lock serializes all new privilege mutations and existing UsersService.update/updateFull account changes. Both existing paths check the last active non-system owner inside their mutation transaction. Helpers exported for subsequent sensitive paths.
- Company/position/branches must be active and undeleted. SHOP accepts SHOP branches. FINANCE accepts SHOP or FINANCE branches as origin/related-record filters, while retaining company=FINANCE. Empty BRANCHES denies; COMPANY must have no branchIds; ASSIGNED=[] still requires record ownership through shared evaluator.
- Durable ACCESS_* audit records are awaited via `tx.auditLog.create` in the same transaction. Null-chain rows remain compatible with existing verification; no old audit hashes changed.
- Assignment migration clears User.canReverseOverride and removes this user from system_config `accounting_permissions` and `payment_approval_permissions`, preserving other users' values. Removed grants are returned and audited. Malformed legacy maps block migration with a Thai conflict error instead of silently dropping evidence.

## Injectable contracts

`AccessSnapshotService.forUser(userId): Promise<AccessSnapshot>` uses an uncached RepeatableRead transaction. Snapshot is exactly `{ userId, isOwner, managed, revision, grants }`; each grant is `{ positionId, permissions, company, scope, branchIds }`. Disabled/deleted/system/unknown-role accounts fail. Unmigrated accounts return managed=false and empty grants. Active position/company/branch states are loaded currently; unknown/reserved stored permissions are filtered. If any formerly selected branch becomes invalid, the entire tuple is omitted (especially to prevent ASSIGNED from broadening to an empty branch filter).

Also exports `forUserInTransaction(tx,userId)`, `assertInTransaction(tx,userId,permission,resource)`, `assertActiveStaff(tx,userId)`, `assertCurrentOwner(tx,userId)`, `lockEmployeeAccess(tx)`, `assertNotLastOwner(tx,userId,next)` and `branchCompanyCodesForAccess(company)`. Call lock before sensitive state reads/writes that must serialize with access edits. Module is Global and has no AuthModule import, avoiding JWT/auth dependency cycles.

`GET /auth/me` preserves existing properties and adds `access: AccessSnapshot`. Existing legacy accessibleCompanies/primaryCompany response behavior is preserved; runtime/UI tasks should consume the new current snapshot for managed permission decisions.

## REST contract

All routes require JWT staff authentication. Owner-only services re-check persisted owner status themselves.

| Route | Request | Response |
|---|---|---|
| GET /employee-access/me | none | AccessSnapshot |
| GET /employee-access/catalog | none | `{permissions: PERMISSION_CATALOG, templates: DEFAULT_ACCESS_POSITIONS, scopes: ['BRANCHES','ASSIGNED','COMPANY'], companies: ['SHOP','FINANCE']}` |
| GET /employee-access/positions | owner | Array of undeleted position rows, each with `affectedEmployeeCount` (distinct assigned undeleted users) |
| POST /employee-access/positions | `{code,name,permissions:string[]}` | Created position row + affectedEmployeeCount=0; code is uppercase identifier, cannot be OWNER |
| POST /employee-access/positions/seed-templates | owner, no body | `{createdCount,affectedEmployeeCount:0}`; creates 8 assignable defaults only, idempotent, never overwrites owner edits |
| PATCH /employee-access/positions/:id | `{expectedRevision,name?,permissions?,isActive?,deleted?}` | Updated position row + affectedEmployeeCount; `deleted:true` soft-deletes and disables, no hard delete |
| GET /employee-access/employees | owner | Array `{id,name,email,role,branchId,isActive,accessManaged,accessRevision,accessibleCompanies,primaryCompany,canReverseOverride,accessAssignments}`; assignments include position, branches as `{branchId}` and stored companyCode/scope/id |
| PUT /employee-access/employees/:id/assignments | `{expectedRevision, assignments:[{positionId,company:'SHOP'|'FINANCE',scope,branchIds:string[]}]}` | AccessSnapshot + `{affectedEmployeeCount:1,removedLegacyGrants}` |
| GET /employee-access/migration-preview | owner | Array of staff summary fields above (no assignments), plus `{managed,isOwner,proposedPositionCode,proposedCompanies,proposedBranchIds,proposedScope,personalGrants,warnings,requiresReview:true,reservedRightsRemoved}`; missing branch yields proposedScope=null, never implicit COMPANY |

Expected-revision conflicts return 409 with Thai reload guidance; invalid permissions/scopes/branches 400; current non-owner/disabled staff 403. DTOs reject unknown malformed array/UUID/enum values through existing global validation.

## Files and downstream concerns

Added 8 employee-access files (module/controller/service/DTO/snapshot + 3 specs), additive migration and isolated harness. Modified schema, AppModule, AuthService + auth test DI fixture, UsersService + transaction test fixtures. No unrelated schema formatting or production migrations.

- This task supplies persistence and current snapshots only. Tasks 3/4 must enforce managed snapshots on all existing HTTP/socket/domain paths, including old accounting/payment/reverse permission read and write endpoints. Existing legacy writers can otherwise reintroduce personal grants after migration; the new management service itself does not preserve them.
- Task 5 can centralize durable audit append without changing null-chain compatibility. Full auditing of existing user-profile mutations remains the existing behavior; scoped position/assignment mutations added here are transactional and durable.
- Migration preview deliberately proposes legacy role/company/branch mappings and reports personal grants; it cannot infer real employee duties or assert a complete live effective-permission diff. Owners must review before enabling.
- Controller/DTO live HTTP/browser verification and local:check remain final integration work, not claimed by these service/DB tests.
- Test harness owns a mktemp cluster and stops/removes it on EXIT. Earlier baseline-clone database `bc_access_task2` was dropped, and restarted baseline PostgreSQL `/tmp/bc-access-baseline.JkcPJV/data` was stopped. Baseline databases retained unchanged. No owned test DB server left running.

## Review fix round 1 — atomic account changes and token revocation

Base: `a431c2f0b`. Reviewer found that UsersService.update caught a token-revocation write failure inside the new PostgreSQL transaction. A SQL error aborts that transaction even when caught in JavaScript, so the caller could receive a success result for a rolled-back password change or deactivation.

Fix: removed that catch. Account mutation and refresh-token revocation now commit together or reject together, matching updateFull's existing atomic behavior. No best-effort password/account change remains in this path.

Added two focused failure cases to users.service.spec.ts, two to users/__tests__/users-update-full.spec.ts, and four real-DB cases to employee-access.integration.spec.ts. The integration fixture installs an isolated BEFORE UPDATE trigger on refresh_tokens that raises a PostgreSQL exception; this is a real aborted SQL transaction, not a mocked JS rejection. Each case checks the reported outcome and verifies that the original password/active state and live token remain unchanged on failure. Trigger/function cleanup uses finally; the harness stops/removes its owned cluster.

Observed RED before implementation:

- `npm test --workspace=@installment/api -- --runTestsByPath src/modules/users/users.service.spec.ts src/modules/users/__tests__/users-update-full.spec.ts`: 28 passed / 2 failed. Both update() cases resolved instead of rejecting; updateFull cases already passed.
- `tools/test-employee-access-persistence.sh`: 13 passed / 2 failed. PostgreSQL rolled back both update() account changes and left tokens live, but outcome.status was fulfilled instead of rejected. This reproduces the review finding exactly.

Observed GREEN after removing the catch:

- Same focused unit command: 2 suites / 30 tests passed.
- Same isolated PostgreSQL harness: 1 suite / 15 tests passed, including deactivation and password-change failures through both update() and updateFull().
- `npx tsc --noEmit -p apps/api/tsconfig.json`: passed.
- `git diff --check`: passed.

Only the covering suites were run for this fix. No API contracts changed. No owned test database server remains running; full preview verification remains final integration work.
