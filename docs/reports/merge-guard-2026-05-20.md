# Pre-Merge Guard Report — 2026-05-20

**Generated**: 2026-05-20  
**Branches reviewed**: 3 (top by recency from 545 unmerged branches)  
**Reviewer**: Pre-Merge Guard agent

---

## Summary

| Branch | Files Changed | Insertions | Deletions | Recommendation |
|--------|-------------|-----------|----------|----------------|
| `feat/sp5p2-wizard` | 24 | +2226 | -47 | **REVIEW** |
| `feat/sp5p2-warranty-check-unify` | 12 | +1048 | -579 | **APPROVE** (merge after wizard) |
| `feat/ai-menu-separate` | 2 | +17 | -13 | **APPROVE** |

---

## Branch 1: `feat/sp5p2-wizard`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-20 11:29 BKK  
**Description**: CreateInsuranceWizardPage — 5-step wizard for repair/exchange creation. Adds two new endpoints (`GET /repair-tickets/warranty-preview`, `GET /repair-tickets/warranty-lookup`), makes `nationalId` optional in `CreateCustomerDto` (walk-in quick-create path), and updates default CoA codes to SHOP chart (`S42-1101`, `S51-1105`).

### File Changes Summary
- `apps/api/src/modules/repair-tickets/repair-tickets.controller.ts` — 2 new GET endpoints
- `apps/api/src/modules/repair-tickets/repair-tickets.service.ts` — `warrantyPreview()`, `warrantyLookup()`, `computeWarrantyWindows()` private helper
- `apps/api/src/modules/repair-tickets/dto/warranty-lookup.dto.ts` — new DTO
- `apps/api/src/modules/repair-tickets/dto/warranty-preview.dto.ts` — new DTO
- `apps/api/src/modules/customers/customers.service.ts` — `nationalId` optional path
- `apps/api/src/modules/customers/dto/customer.dto.ts` — `@IsOptional()` on `nationalId`
- `apps/web/src/pages/insurance/CreateInsuranceWizardPage.tsx` — main wizard page
- `apps/web/src/pages/insurance/WizardSteps/` — 5 step components
- `apps/api/prisma/seed.ts` + `seed-production.ts` — REPAIR_*_ACCOUNT_CODE SystemConfig values
- Test files: `repair-tickets.service.spec.ts`, `CreateInsuranceWizardPage.test.tsx`, `repair-config-defaults.spec.ts`

---

### Critical Issues: NONE

- ✅ `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level on controller
- ✅ Both new endpoints have `@Roles(...)` decorators
- ✅ All Prisma queries include `deletedAt: null`
- ✅ No `Number()` on financial/money fields
- ✅ No hardcoded secrets or API keys
- ✅ No raw SQL / unparameterized `$queryRaw`
- ✅ No raw `fetch()` in frontend — uses `api.get()` / `api.post()` from `@/lib/api`
- ✅ Backend enforces `bypassWindowCheck` role guard server-side (`OWNER/BRANCH_MANAGER` only, throws `ForbiddenException` otherwise)

---

### Warning Issues

**W1 — Untyped `any` in `warrantyLookup` production service code**

File: `apps/api/src/modules/repair-tickets/repair-tickets.service.ts`

```ts
let contracts: any[] = [];
let customer: any = null;
// ...
contracts = product.contracts.map((c: any) => ({ ...c, product }));
.map((c: any) => {
.filter((d: any) => d.product !== null);
```

These `any` types are in the production `warrantyLookup()` method — not just in tests. The service handles 3 search modes (by `customerId`, `imei`/`serial`, `contractNumber`) and the union type is awkward, but using `any[]` means TypeScript gives no safety on the shape of contracts passed to `computeWarrantyWindows()`. A mistyped field (e.g., `deviceReceivedAt` → `receivedAt` in a future Prisma model rename) would silently return `null` warranty windows with no type error.

Suggested fix: define a local `ContractWithProduct` type or inline the relevant Prisma select shape:

```ts
type ContractWithProduct = Prisma.ContractGetPayload<{
  include: { product: true; customer: true };
}>;
let contracts: ContractWithProduct[] = [];
let customer: Prisma.CustomerGetPayload<Record<never, never>> | null = null;
```

**W2 — `nationalId` made optional without downstream guard review**

File: `apps/api/src/modules/customers/dto/customer.dto.ts` + `customers.service.ts`

`nationalId` is now optional (walk-in path). The service correctly skips dedup + checksum when omitted. However, callers that previously relied on `nationalId` being required (e.g., credit check integration, PDPA export, PII encryption pipeline) should be audited to confirm they handle `null` nationalId gracefully. No issue found in this diff, but it's a cross-module surface that warrants a manual review pass.

---

### Info

**I1 — `@Req() req: any` on both new controller endpoints**

Standard NestJS pattern — acceptable. Could be typed as `RequestWithUser` from the existing auth types if consistency with other controllers is desired.

**I2 — `computeWarrantyWindows` duplicates `detectWarrantyStatus` UTC+7 logic**

The private helper re-implements BKK calendar-day arithmetic (`bkkCalendarDay`) already present in `detectWarrantyStatus`. This is intentional (returns numeric day counts vs. status enum) and the comment in the diff explains it. Consider extracting `bkkCalendarDay` to a shared date utility in `apps/api/src/utils/` to avoid drift if the offset changes.

**I3 — Test `any` types**

`let prisma: any; let audit: any;` in test files — acceptable for mock objects in specs.

---

### Recommendation: **REVIEW**

Fix W1 (untyped `any[]` in production service) before merging. W2 requires a verbal sign-off from the owner/tech lead that walk-in customers without NID are expected in downstream integrations (credit check, PDPA). No blockers on security or financial correctness.

---

## Branch 2: `feat/sp5p2-warranty-check-unify`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-20 11:45 BKK  
**Description**: Unifies the SP5 Phase 2 insurance entry point — single sidebar parent, `/defect-exchange` redirect to `/insurance`, detail page button rename, new `WarrantyCheckPage` with 3 search modes, E2E smoke specs for wizard repair/exchange/warranty-check flows. Deletes the now-superseded `CreateRepairTicketPage.tsx` (529 lines).

**Note**: This branch sits on top of `feat/sp5p2-wizard`. It should be merged **after** the wizard branch.

### File Changes Summary
- `apps/web/src/pages/insurance/WarrantyCheckPage.tsx` — new page (+172 lines)
- `apps/web/src/pages/insurance/WarrantyCheckPage.test.tsx` — 215-line test file
- `apps/web/src/pages/insurance/CreateRepairTicketPage.tsx` — **deleted** (consolidated into wizard)
- `apps/web/src/App.tsx` — routing updates
- `apps/web/src/config/menu.ts` — sidebar unification
- `apps/web/src/components/DefectExchangeRedirect.tsx` — redirect component (+13 lines)
- `apps/web/e2e/insurance-*.spec.ts` — 3 new E2E smoke specs (+558 lines)
- `.claude/rules/accounting.md` — minor doc update

---

### Critical Issues: NONE

- ✅ No new backend controllers — frontend-only changes
- ✅ Uses `useQuery` from `@tanstack/react-query` (not raw `fetch`)
- ✅ Uses `api.get()` from `@/lib/api` for all requests
- ✅ No `Number()` on financial fields
- ✅ No hardcoded hex colors
- ✅ No `bg-gray-*` / `text-gray-*` / `bg-white` tokens (uses semantic tokens)
- ✅ No hardcoded secrets

---

### Warning Issues: NONE

---

### Info

**I1 — Merge dependency on `feat/sp5p2-wizard`**

`WarrantyCheckPage` calls `GET /repair-tickets/warranty-lookup` and `CreateInsuranceWizardPage` (both introduced in the wizard branch). Merging this branch before the wizard branch would cause runtime 404s on the warranty-lookup endpoint.

**Merge order**: `feat/sp5p2-wizard` → `feat/sp5p2-warranty-check-unify`

---

### Recommendation: **APPROVE** (after wizard branch merges)

No security, financial, or structural issues. Clean frontend consolidation with good test coverage (3 E2E specs + unit tests).

---

## Branch 3: `feat/ai-menu-separate`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-20 11:45 BKK  
**Description**: Moves the AI submenu from a child of the "ตั้งค่า" section to its own top-level section in the sidebar gear zone. Pure config change, no API changes.

### File Changes Summary
- `apps/web/src/config/menu.ts` — 28-line reorganization
- `apps/web/package.json` — dependency bump (minor)

---

### Critical Issues: NONE

- ✅ No controllers, services, or DTOs changed
- ✅ No security surface
- ✅ No financial logic

---

### Warning Issues: NONE

---

### Recommendation: **APPROVE**

Trivial sidebar config reorganization. Low risk, no blockers.

---

## Overall Findings

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 0 | — |
| Warning | 2 | W1: untyped `any[]` in production service; W2: optional `nationalId` cross-module impact |
| Info | 4 | Helper duplication, test types, merge ordering, controller `req: any` |

**Merge order recommendation**: 
1. `feat/ai-menu-separate` — independent, approve now
2. `feat/sp5p2-wizard` — after W1 fix (and W2 verbal sign-off)
3. `feat/sp5p2-warranty-check-unify` — after wizard merges
