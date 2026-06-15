# Pre-Merge Guard Report — 2026-06-15

**Run date**: 2026-06-15  
**Reviewer**: Automated guard (claude-sonnet-4-6)  
**Branches reviewed**: 3 most-recently-updated unmerged branches with new work  
**Total unmerged branches in repo**: 379

---

## Summary

| Branch | Author | Age | Critical | Warning | Info | Recommendation |
|---|---|---|---|---|---|---|
| `fix/ci-pre-existing-test-failures` | iamnaii | 7 days | **2** | 0 | 2 | 🔴 BLOCK |
| `feat/payroll-backfill` | iamnaii | 10 days | **2** | 0 | 1 | 🔴 BLOCK |
| `feat/payroll-employee-link` | iamnaii | 10 days | **2** | 0 | 1 | 🔴 BLOCK |

**Root cause of all Critical issues**: Both branches were last updated before 2026-06-11 when two security fixes landed on `main`. Merging any of these branches as-is would revert those security fixes.

**Required action before merging**: `git rebase origin/main` on each branch, then re-verify.

---

## Shared Critical Issues (all 3 branches)

### C1 — CRM leads missing branch-scope guard (IDOR risk)

**File**: `apps/api/src/modules/crm/crm.controller.ts`  
**Fix landed in main**: commit `38ee5cb2` on 2026-06-11 (`fix(security+money): F1 F2 F4 F17 F18 F21`)  

**What main has**:
```typescript
import { hasCrossBranchAccess } from '../auth/branch-access.util';
// ...
const effectiveBranchId = hasCrossBranchAccess(user)
  ? branchId
  : user.branchId ?? '__no_branch__';
// effectiveBranchId passed to service
```

**What all 3 branches have** (old version — missing the fix):
```typescript
// hasCrossBranchAccess check absent; raw branchId passed directly
branchId, // any caller can supply any branch ID
```

**Impact**: Any authenticated `SALES` or `BRANCH_MANAGER` user can call  
`GET /crm/leads?branch=<other-branch-id>` and enumerate leads from any branch, not just their own. This is an IDOR (Insecure Direct Object Reference) data isolation bypass.

---

### C2 — Public customer-access token endpoint missing per-IP throttle

**File**: `apps/api/src/modules/customer-access/customer-access.controller.ts`  
**Fix landed in main**: commit `470b5fbe` on 2026-06-11 (`fix(F26 F27): webhooks SSRF private-IP block + customer-access per-IP throttle`)

**What main has**:
```typescript
@Get('customer-access/:token')
@Public()
@Throttle({ short: { limit: 20, ttl: 60_000 } })
async getCustomerAccess(...)
```

**What all 3 branches have** (old version):
```typescript
@Get('customer-access/:token')
@Public()
// @Throttle removed — no per-IP rate limiting
async getCustomerAccess(...)
```

**Impact**: The `GET /customer-access/:token` endpoint is public (no JWT). Removing the per-IP rate limit removes the defense-in-depth layer that blocks rapid token probing from a single IP. The 256-bit token makes brute-force infeasible, but the throttle guards against endpoint hammering and provides observability into abuse patterns.

---

## Branch 1: `fix/ci-pre-existing-test-failures`

**Author**: iamnaii  
**Last updated**: 2026-06-08 (7 days ago, before the June-11 security fixes)  
**Unique commits not in main**: 10

### Branch-specific work (beyond the shared C1/C2 concerns above)

This branch adds valuable fixes and test coverage:
- Fixes early-payoff 100x multiplier bug in payment service
- Fixes manual-JE balance check (Wave 1 money fixes)
- Adds Wave-2/3 test characterization (+189 tests for regulated money paths)
- Adds refund ledger reversal JE
- Adds P&L expenses-from-journal endpoint (COGS section)
- Extracts shared `thaiBahtText` util
- Fixes chatbot late-fee quote accuracy (capped to match actual charge)
- Removes dead `BankReconciliationService`

### Additional Info-level findings (branch-specific)

**I-1: `$queryRawUnsafe` in dev scripts**  
Files: `apps/api/scripts/test-retrieval.ts`, `apps/api/src/cli/wipe-accounting.cli.ts`  
Both usages are safe: the pgvector query properly passes the embedding vector as `$1` parameter binding (not interpolated). The schema-probe usage is a static SQL string with no user input. Neither is a production HTTP endpoint. Recommend adding a comment explaining why tagged-template `$queryRaw` can't be used for the pgvector type cast.

**I-2: Pre-existing `Number()` arithmetic on Decimal money fields**  
File: `apps/api/src/modules/chatbot-finance/services/finance-tools.service.ts` (lines 55–57)  
`Number(amountDue) - Number(amountPaid)` for float arithmetic. This code exists identically in `origin/main` — **not introduced by this branch**. The branch's `d6ef53b3` commit actually improves the late-fee cap accuracy. Flagged for a future cleanup PR.

### New controller security check (branch-specific additions)
| Controller | Class Guard | All Methods Have `@Roles`? |
|---|---|---|
| `SsoConfigController` | `@UseGuards(JwtAuthGuard, RolesGuard)` ✅ | Yes ✅ |
| `EmployeesController` | `@UseGuards(JwtAuthGuard, RolesGuard)` ✅ | Yes ✅ |

### Recommendation: 🔴 BLOCK

Rebase onto `origin/main` to pick up the June-11 security fixes (C1, C2). The branch's own new work is clean; no branch-introduced critical issues.

---

## Branch 2: `feat/payroll-backfill`

**Author**: iamnaii  
**Last updated**: 2026-06-05 (10 days ago)  
**Unique commits not in main**: 6 payroll/employee commits

### Branch-specific work

- `feat(employees)`: `EmployeeProfile` model (1:1 with `User`), employees module backend
- `feat(employees)`: Employee Master page `/employees`
- `feat(payroll)`: `PayrollLine.userId` optional FK + server-side snapshot
- `feat(backfill)`: CLI to provision employee profiles for active staff
- `feat(backfill)`: CLI to backfill `PayrollLine.userId` (tier-1: taxId auto-match; tier-2: name match, requires manual review)

### Additional Info-level findings (branch-specific)

**I-1: Tier-2 backfill name-match requires BACKFILL_ACTOR_USER_ID env var**  
The `--apply` flag for tier-2 matches requires a real user UUID as the audit actor. The CLI validates this. Dry-run output must be human-reviewed before applying. This is intentional and well-documented in the spec.

### New controller security check
| Controller | Class Guard | All Methods Have `@Roles`? |
|---|---|---|
| `EmployeesController` | `@UseGuards(JwtAuthGuard, RolesGuard)` ✅ | Yes ✅ |
| `SsoConfigController` | `@UseGuards(JwtAuthGuard, RolesGuard)` ✅ | Yes ✅ |

### Service patterns
| Pattern | Status |
|---|---|
| `deletedAt: null` in all queries | ✅ |
| `Prisma.Decimal` for `baseSalary` | ✅ |
| PII masking for non-OWNER/ACCOUNTANT | ✅ |
| Soft-delete only | ✅ |
| No raw `fetch()` in frontend components | ✅ |

### Recommendation: 🔴 BLOCK

Rebase onto `origin/main` to pick up the June-11 security fixes (C1, C2). The payroll/employee feature work itself is clean and well-structured.

---

## Branch 3: `feat/payroll-employee-link`

**Author**: iamnaii  
**Last updated**: 2026-06-05 (10 days ago)  
**Unique commits not in main**: 15 commits (superset of branch 2 + more)

### Branch-specific work

All of branch 2, plus:
- `feat(payroll-ui)`: `EmployeeCombobox` in `PayrollLinesSection` + base/SSO pre-fill
- `feat(expense-documents)`: `GET :id/audit` — per-document audit timeline endpoint
- `feat(expense-documents)`: `GET :id/voucher.pdf` — ใบสำคัญจ่าย PDF
- `fix(contacts)`: Repair-ticket FK hardening, `@IsUUID` guards on contact pickers
- `feat(contacts)`: Party Master Mandatory P0–P4 — durable FK on expense/trade-in/customer pickers

### Additional Info-level findings (branch-specific)

Same I-1 backfill concern as branch 2.

### New/modified endpoint security check
| Endpoint | Guard | `@Roles` |
|---|---|---|
| `GET /expense-documents/:id/audit` | `JwtAuthGuard + RolesGuard + BranchGuard` (class) ✅ | `OWNER, BM, FM, ACC` ✅ |
| `GET /expense-documents/:id/voucher.pdf` | `JwtAuthGuard + RolesGuard + BranchGuard` (class) ✅ | `OWNER, BM, FM, ACC` ✅ |
| `GET /employees/pickable` | `JwtAuthGuard + RolesGuard` ✅ | `OWNER, ACC, FM` ✅ |
| `GET /sso-config/effective` | `JwtAuthGuard + RolesGuard` ✅ | `OWNER, BM, FM, ACC` ✅ |

### Recommendation: 🔴 BLOCK

Rebase onto `origin/main` to pick up the June-11 security fixes (C1, C2). The payroll-employee-link feature work is otherwise clean.

---

## Action Required

All 3 branches need a rebase before merge:

```bash
# For each branch:
git checkout fix/ci-pre-existing-test-failures
git rebase origin/main
# resolve conflicts, then re-run this guard

git checkout feat/payroll-backfill
git rebase origin/main

git checkout feat/payroll-employee-link
git rebase origin/main
```

After rebase, the two security fixes will be included and these branches can be re-reviewed.
