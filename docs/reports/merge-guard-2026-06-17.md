# Pre-Merge Guard Report — 2026-06-17

**Agent**: Pre-Merge Guard (automated)
**Run date**: 2026-06-17
**Branches reviewed**: 3 most-recently-updated unmerged feature branches

---

## Summary

| Branch | Last commit | Critical | Warning | Info | Recommendation |
|--------|-------------|----------|---------|------|----------------|
| `feat/payroll-backfill` | 2026-06-05 | 0 | 2 | 2 | **REVIEW** |
| `worktree-feat+sp7.1-dual-prisma-foundation` | 2026-06-13 | 0 | 1 | 2 | **REVIEW** |
| `worktree-feat-shop-sales-ai-phase-a` | 2026-05-20 | 0 | 0 | 1 | **APPROVE** |

---

## Branch 1: `feat/payroll-backfill`

**Author**: Akenarin Kongdach  
**Last commit**: `b92ecc24` — 2026-06-05  
**Commits ahead of main**: 6  
**Scope**: Employee Master module (PR-A backend + PR-B UI + PR-C payroll link + PR-D backfill CLIs)

### File changes summary
- `apps/api/src/modules/employees/` — new module: controller, service, 3 DTOs, tests
- `apps/api/src/modules/sso-config/sso-config.controller.ts` — new controller
- `apps/api/src/cli/backfill-employee-profiles.cli.ts` — one-time backfill CLI
- `apps/api/src/cli/backfill-payroll-user-fk.cli.ts` — one-time backfill CLI
- `apps/web/src/components/employees/EmployeeCombobox.tsx` — new component
- `apps/web/src/lib/api/employees.ts` — new API client module
- `apps/api/prisma/schema.prisma` — EmployeeProfile model + PayrollLine.userId FK

### Critical issues (must fix before merge)

None.

### Warning issues (should fix)

**W1** — `EmployeesService.list()`: user sub-filter on search path is missing `deletedAt: null` and `isActive: true` guards  
File: `apps/api/src/modules/employees/employees.service.ts`  

```ts
// Current (when search is provided):
where.user = {
  OR: [
    { name: { contains: dto.search, mode: 'insensitive' } },
    ...
  ],
};
// Missing: deletedAt: null + isActive: true inside the user sub-filter
```

Profiles linked to soft-deleted or inactive users will appear in search results for OWNER/ACCOUNTANT. The `pickable()` and `provisionable()` methods correctly add `isActive: true, deletedAt: null` to their user sub-filters — `list()` should be consistent.

Fix: add `is: { deletedAt: null, isActive: true, ... }` wrapper around the OR block.

---

**W2** — Misleading comment: `// Decimal → string in JSON; FE parseFloat`  
File: `apps/api/src/modules/employees/employees.service.ts`, `pickable()` return map  

The comment on `baseSalary` suggests frontend should `parseFloat()`, which loses Decimal precision. The frontend type (`baseSalary: string | null`) is correct for display; if arithmetic is ever needed it should use `new Prisma.Decimal()` (FE: `parseDecimal` from a decimal lib). Comment should be corrected before future devs read it.

Fix: change comment to `// Decimal serialised as string — keep as string unless arithmetic needed`.

### Info

**I1** — Backfill CLI PII exposure via stdout  
File: `apps/api/src/cli/backfill-payroll-user-fk.cli.ts`  
The CLI dumps the full `matched-by-name.csv` to stdout (including `employeeName`, `employeeTaxId`) for Cloud Run log retrieval. This is acknowledged in a comment and acceptable for a one-time admin CLI. Ensure Cloud Logging for the run job is access-controlled before executing on prod.

**I2** — `$queryRaw` usage (parameterized, safe)  
The `SELECT current_database()` usage is a tagged template literal (parameterized) — not a SQL injection risk.

### Checklist
- [x] `@UseGuards(JwtAuthGuard, RolesGuard)` on all 3 new controllers
- [x] `@Roles()` on all methods
- [x] `Prisma.Decimal` used for `baseSalary`
- [x] `deletedAt: null` in queries (except W1 gap in `list()` search path)
- [x] Thai validation messages on DTOs
- [x] Frontend uses `api.get()` via `employeesApi` — no raw `fetch()`
- [x] `useQuery` used correctly, `invalidateQueries` present in mutations
- [ ] W1: `list()` missing user soft-delete guard on search path

**Recommendation: REVIEW** — fix W1 before merge; W2 is cosmetic but worth fixing.

---

## Branch 2: `worktree-feat+sp7.1-dual-prisma-foundation`

**Author**: Akenarin Kongdach  
**Last commit**: `73efef41` — 2026-06-13 (CI nudge)  
**Commits ahead of main**: 2571 (large branch — SP7.1 through SP7.10)  
**Scope**: SHOP/FINANCE legal entity split foundation — dual Prisma, EntityScope middleware, ExternalFinanceCompany, OutboxProcessor, year-end closing, MaintenanceModeMiddleware, dual-DB health/backup

### File changes summary (key new files)
- `apps/api/src/middleware/entity-scope.middleware.ts` — new global middleware
- `apps/api/src/guards/entity-scope.guard.ts` — new auth guard
- `apps/api/src/decorators/entity.decorator.ts` — `@Entity()` decorator
- `apps/api/src/modules/external-finance/external-finance.controller.ts` — new controller
- `apps/api/src/middleware/maintenance-mode.middleware.ts` — maintenance mode
- `apps/web/src/contexts/EntityScopeContext.tsx` — new React context
- `apps/web/src/lib/api.ts` — adds `?company=` interceptor

### Critical issues (must fix before merge)

None.

### Warning issues (should fix)

**W1** — `cancelCommission` uses inline body type, not a class-validator DTO  
File: `apps/api/src/modules/external-finance/external-finance.controller.ts:86`

```ts
cancelCommission(@Param('id') id: string, @Body() body: { reason: string }) {
```

An inline type object `{ reason: string }` bypasses class-validator — the `reason` field receives no length, content, or presence validation. NestJS's `ValidationPipe` ignores plain object types.

Fix: create `CancelCommissionDto` with `@IsString()` + `@MinLength(5, { message: 'กรุณาระบุเหตุผลที่ยกเลิก' })`.

### Info

**I1** — `localStorage` for entity scope preference  
File: `apps/web/src/contexts/EntityScopeContext.tsx`, `apps/web/src/lib/api.ts`  
`localStorage.getItem('bc-entity-scope')` stores `'SHOP'` or `'FINANCE'` (a UI preference, not a security token). The security rule prohibits storing JWT tokens in localStorage; this is not a token. However, it is worth confirming ownership is aware that entity scope can be read/written by XSS scripts — malicious scope switching would affect which entity's data is queried. The backend `EntityScopeGuard` validates that the user actually has access to the requested company, so the blast radius is limited to the user's own authorized companies.

**I2** — SP7 is a major architectural change requiring extended QA  
This branch introduces dual Prisma instances, entity-scoped middleware on every request, OutboxProcessor for cross-entity JE sagas, year-end closing, and a cutover orchestrator. The branch has thorough tests (29 specs), but production deployment requires the owner sign-off documented in `docs/runbooks/sp7-cutover-playbook.md` and `sp7-year-end-closing-pre-cutover.md`.

### Checklist
- [x] `@UseGuards(JwtAuthGuard, RolesGuard)` on `ExternalFinanceController`
- [x] `@Roles()` on all methods
- [x] `Prisma.Decimal` for `financedAmount` and `commissionRate`
- [x] `EntityScopeGuard` validates `accessibleCompanies` before entity-scoped routes
- [x] `MaintenanceModeMiddleware` correctly whitelists `/api/health` and `/api/version`
- [x] No hardcoded secrets or API keys
- [ ] W1: `cancelCommission` inline body type — no DTO validation

**Recommendation: REVIEW** — fix W1 (missing DTO); remainder looks architecturally sound. Merge after owner sign-off per cutover playbook.

---

## Branch 3: `worktree-feat-shop-sales-ai-phase-a`

**Author**: Akenarin Kongdach  
**Last commit**: `2749f18e` — 2026-05-20  
**Commits ahead of main**: 2609 (large branch, mostly Shop AI feature)  
**Scope of latest commits**: Minor ESM import fix, PromptPay QR wiring, TikTok block stub

### File changes (last 5 commits)
- `apps/api/src/modules/sales-bot/tools/capture-lead.tool.ts` — ESM import fix
- `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` — TikTok block
- `apps/api/prisma/schema.prisma` — `acquisitionSource` VarChar(50) + partial index

### Critical issues

None.

### Warning issues

None.

### Info

**I1** — ESM import switch: `require('promptpay-qr')` → `import generatePayload from 'promptpay-qr'`  
This is a correct lint fix for `@typescript-eslint/no-require-imports`. Low risk. Previously had an `eslint-disable` comment which is now removed.

### Checklist
- [x] No new controllers in recent commits (service-layer only)
- [x] No `fetch()` usage
- [x] No hardcoded secrets
- [x] ESM import fix is correct

**Recommendation: APPROVE** — latest commits are low-risk fixes. (Full branch review for initial merge was previously done; this covers only what's new since last review.)

---

## Unreviewed branches (excluded from this run)

The following branches exist but were out of scope (docs-only, chore/deps, or already reviewed):
- `chore/a1-settings-audit-phase2` — audit report docs only, no new code
- `chore/deps-tier3-chunk*` — dependency upgrade branches
- `docs/*` — documentation only
- `E2E-TEST` — test-only branch

---

*Report generated by Pre-Merge Guard agent — 2026-06-17*
