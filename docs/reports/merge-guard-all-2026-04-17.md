# Pre-Merge Guard Report — 2026-04-17

**Reviewer**: Pre-Merge Guard Agent (automated)  
**Date**: 2026-04-17  
**Branches reviewed**: 3 of 17 non-deps unmerged branches (top by impact)  
**Total unmerged branches**: 45 (excluding deps/reports/watchdog)

---

## Branch 1: `feat/accounting-audit-fixes`

**Author**: iamnaii (Akenarin Kongdach), BESTCHOICE Developer, Claude  
**Commits ahead of main**: 5+  
**Scale**: 1261 files changed — 43,164 insertions / 483,623 deletions

### File Changes Summary (top by size)
| File | Lines |
|------|-------|
| `apps/api/src/modules/accounting/accounting.service.ts` | +large |
| `apps/api/src/modules/address/thai-address-data.ts` | +7,533 |
| `apps/web/src/pages/DashboardPage.tsx` | +1,364 |
| `apps/web/src/pages/PaymentsPage.tsx` | +927 |
| `apps/web/src/pages/CreditChecksPage.tsx` | +888 |
| `apps/web/src/pages/POSPage.tsx` | +797 |

### Issues

#### 🔴 Critical — MUST fix before merge

**C-001: `Number()` on monetary/financial fields — 133 violations in `accounting.service.ts`**

The entire accounting service converts Prisma `Decimal` values to JavaScript `Number` before performing financial calculations. This causes floating-point precision loss on monetary amounts — the opposite of what an accounting service requires.

Affected: `accounting.service.ts` — all P&L, cash flow, balance sheet, and receivable calculations.

Examples:
```typescript
// ❌ These all strip Decimal precision:
const cashSales = Number(cashSalesAgg._sum.netAmount || 0);
const installmentDownPayments = Number(installmentSales._sum.downPaymentAmount || 0);
const grossReceivables = Number(hpReceivables._sum.amountDue || 0);
const allowanceForDoubtful = Number(provisions._sum.provisionAmount || 0);
installmentPayments += Number(p.amountPaid);
interestIncome += Number(p.contract.interestTotal) / p.contract.totalMonths;
// ... 133 more
```

Required fix: Use `Prisma.Decimal` arithmetic throughout. Per project rules (v4 hardening — 53 `Number()` → `Prisma.Decimal` across 12 services). This branch introduces 133 new violations in the most sensitive service.

**Severity**: P0 — financial calculation engine with floating-point accumulation errors.

---

#### 🟡 Warning

**W-001: DTO validators missing Thai error messages — 2 instances**

In a new DTO within `feat/accounting-audit-fixes`, two `@IsIn()` validators lack the required Thai `message` option:

```typescript
// ❌ Missing { message: 'กรุณาระบุ...' }
@IsIn(['SALES', 'BRANCH_MANAGER', 'ACCOUNTANT', 'OWNER'])
role: string;
```

Per project convention, all validation messages must be in Thai.

---

#### 🟢 Info — No action required

- All new and modified controllers have proper `@UseGuards(JwtAuthGuard, RolesGuard)` at class level
- `address` controller is intentionally public (whitelisted in security rules)
- No hardcoded secrets or API keys found
- No unparameterized `$queryRaw` (SQL injection risk) found
- No raw `fetch()` calls in React frontend components

### Recommendation: 🔴 **BLOCK**

**Do not merge** until C-001 is resolved. 133 `Number()` violations in the accounting service undermine the financial integrity of P&L, cash flow, and balance sheet reports. This directly contradicts the v4 hardening work that eliminated these patterns from 12 other services.

---

## Branch 2: `feat/chatbot-production-ready`

**Author**: iamnaii (Akenarin Kongdach), Claude  
**Commits ahead of main**: 174  
**Scale**: 792 files changed — 17,905 insertions / 165,402 deletions

### File Changes Summary (top by size)
| File | Lines |
|------|-------|
| `apps/web/src/pages/POSPage.tsx` | +1,015 |
| `apps/web/src/pages/NotificationsPage.tsx` | +984 |
| `apps/web/src/pages/AssetManagementPage.tsx` | +914 |
| `apps/web/src/components/layout/Sidebar.tsx` | ±631 |
| `apps/web/src/pages/UsersPage.tsx` | +791 |
| `apps/web/src/pages/SuppliersPage.tsx` | +778 |

**Key features**: Chatbot production-readiness — feedback Quick Reply, admin prompt editor, KB seed, CHATCONE removed.

### Issues

#### 🔴 Critical

**C-001: `Number()` on `amountDue` — 2 instances in chatbot service**

```typescript
// ❌ apps/api/src/modules/chatbot-finance/services/*.service.ts
amountDue: Number(payment.amountDue),  // appears twice
```

`amountDue` is a `Decimal` HP receivable field. Converting to JS `Number` is a precision violation.

---

#### 🟢 Info

**I-001: 10 uses of `: any` type in new code**

Spread across new files. Not blocking but reduces type safety. Each should be typed explicitly where the shape is known.

**I-002: Backend `fetch()` in chatbot service**

Two `fetch()` calls exist in `chatbot-finance.service.ts` via `getBaseUrl()` — these are NestJS backend calls to an external API, not React frontend violations. No action needed.

---

#### No issues found
- All new controllers have proper `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles()`
- No hardcoded secrets
- No unparameterized `$queryRaw`
- No missing `invalidateQueries` found in mutation hooks

### Recommendation: 🟡 **REVIEW**

Fix C-001 (2 `Number()` on `amountDue`) before merging. The `: any` usages are info-level — address in a follow-up if time-constrained.

---

## Branch 3: `fix/hardening-non-accounting`

**Author**: iamnaii (Akenarin Kongdach), Claude  
**Commits ahead of main**: 2 commits on top of `feat/chatbot-production-ready`  
**Scale**: 780 files changed (built on top of `feat/chatbot-production-ready`)

**New commits**:
1. `feat(chat): complete Phase 2 — WS events, file upload, read receipts, KB suggestions`
2. `fix: hardening — security, DTOs, FINANCE_MANAGER, SMS retry, Dashboard MoM`

### File Changes Summary (incremental vs chatbot-production-ready)
| File | Lines |
|------|-------|
| `chatbot-finance-admin.controller.ts` | +36 |
| `chatbot-finance-liff.controller.ts` | ±41 |
| `dashboard.service.ts` | +39 |
| `line-oa/dto/evidence.dto.ts` | +58 |
| `line-oa/dto/liff.dto.ts` | +13 |

### Issues

#### 🔴 Critical

**C-001 (inherited)**: Same 2 `Number(payment.amountDue)` violations inherited from `feat/chatbot-production-ready`.

---

#### 🟢 Info — No incremental issues

The 2 new commits on this branch are clean:

- New KB suggestion endpoints (`GET/PATCH /chatbot/finance/admin/kb-suggestions`) have proper `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER', 'FINANCE_MANAGER')`
- New file upload endpoint (`POST /staff-chat/sessions/:id/upload`) has proper guards + `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')`
- New LIFF endpoints use `@UseGuards(LiffTokenGuard)` (intentionally public, correct)
- Dashboard MoM service additions use no new `Number()` conversions
- No hardcoded secrets, no SQL injection risk

---

#### No issues found (incremental)
- All new endpoints guarded correctly
- No new `Number()` violations beyond the inherited ones
- No raw `$queryRaw`
- No hardcoded secrets

### Recommendation: 🟡 **REVIEW**

This branch depends on `feat/chatbot-production-ready`. Merge order should be:
1. Fix C-001 in `feat/chatbot-production-ready` → merge
2. Rebase `fix/hardening-non-accounting` on updated main → merge

The incremental commits on this branch are high quality — clean guards, correct FINANCE_MANAGER role additions.

---

## Summary Table

| Branch | Commits Ahead | Critical | Warning | Info | Verdict |
|--------|--------------|----------|---------|------|---------|
| `feat/accounting-audit-fixes` | 5+ | 1 (133 violations) | 1 | 0 | 🔴 BLOCK |
| `feat/chatbot-production-ready` | 174 | 1 (2 violations) | 0 | 2 | 🟡 REVIEW |
| `fix/hardening-non-accounting` | 2 (incremental) | 1 (inherited) | 0 | 0 | 🟡 REVIEW |

## Required Actions Before Merge

### `feat/accounting-audit-fixes`
1. **Replace all 133 `Number()` calls in `accounting.service.ts`** with `Prisma.Decimal` arithmetic. Pattern: `new Prisma.Decimal(x || 0)` and use `.add()`, `.mul()`, `.div()` methods. Reference: v4 hardening (commission.service.ts, repossessions.service.ts).
2. Add Thai `message` options to the 2 `@IsIn()` validators in the new DTO.

### `feat/chatbot-production-ready` + `fix/hardening-non-accounting`
1. **Replace `Number(payment.amountDue)`** with `new Prisma.Decimal(payment.amountDue || 0)` in the chatbot finance service (2 occurrences).
2. Consider typing the 10 `: any` usages explicitly (info-level, not blocking).

---

*Generated by Pre-Merge Guard Agent — BESTCHOICE monorepo*  
*Checks performed: JWT guards, Decimal precision, soft-delete filters, SQL injection, hardcoded secrets, DTO validators, raw fetch() in React, missing invalidateQueries*
