# Merge Guard Report — feat/accounting-audit-fixes

**Date**: 2026-04-16  
**Branch**: `feat/accounting-audit-fixes`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits ahead of main**: 5 unique commits  
**Files changed**: 17 new, 298 modified (TypeScript/TSX)

---

## Summary

This branch adds inter-company accounting (SHOP↔FINANCE), Thai accounting standards fixes, and test corrections. It introduces a new `address` module (intentionally public, per security rules) and a large volume of new financial calculation code. The critical issue is widespread `Number()` usage on Decimal money fields across income and P&L calculation services.

---

## Issues by Severity

### 🔴 CRITICAL — Must fix before merge

#### C-001 · `Number()` on money/financial Decimal fields (96 instances)
**Files**: income-calculation service, P&L service, reports service, and others  
**Pattern**: `Number(e.totalAmount)`, `Number(p.lateFee)`, `Number(s.product.costPrice)`, `Number(hpReceivables._sum.amountDue)`, etc.

```ts
// ❌ Wrong — loses Decimal precision, can cause cent-level rounding errors
const cashSales = Number(cashSalesAgg._sum.netAmount || 0);
interestIncome += Number(p.contract.interestTotal) / p.contract.totalMonths;

// ✅ Correct
import { Prisma } from '@prisma/client';
const cashSales = new Prisma.Decimal(cashSalesAgg._sum.netAmount ?? 0);
interestIncome = interestIncome.add(new Prisma.Decimal(p.contract.interestTotal).div(p.contract.totalMonths));
```

This is especially dangerous in P&L and income aggregation — rounding errors compound across many transactions and produce incorrect financial reports.

**Count**: 96 occurrences across the branch.

#### C-002 · `paymentEvidence.findMany` missing `deletedAt: null` filter
**File**: slip-review / payment evidence service  
**Location**: `getEvidenceList` method — `where` object built dynamically but never includes `deletedAt: null`

```ts
// ❌ Soft-deleted evidence records will be returned in queries
const where: Record<string, unknown> = {};
// ... adds status, search, dateFrom, dateTo, amount filters
// MISSING: where.deletedAt = null;
return this.prisma.paymentEvidence.findMany({ where, ... });
```

#### C-003 · Multiple `findFirst` queries missing `deletedAt: null` on Customer and Contract
**Count**: ~10 `findFirst` queries on `customer` and `contract` models in new chatbot/LIFF service methods where the `where` clause does not include `deletedAt: null`.

---

### 🟡 WARNING — Should fix

#### W-001 · Hardcoded `text-gray-*` / `bg-gray-*` CSS classes in new TSX files
**Violates**: `.claude/rules/frontend.md` — design token rule  
Multiple new pages use hardcoded gray tokens instead of semantic design tokens:

```tsx
// ❌ Wrong
<span className="text-xs text-gray-500">ค่าโฆษณารวม</span>
<p className="text-xl font-bold text-gray-900">...</p>
<thead className="bg-gray-50">

// ✅ Correct
<span className="text-xs text-muted-foreground">ค่าโฆษณารวม</span>
<p className="text-xl font-bold text-foreground">...</p>
<thead className="bg-muted">
```

#### W-002 · Amount filter in `getEvidenceList` uses raw `Number()` for Decimal comparison
**File**: payment evidence query builder

```ts
if (amountMin) amountFilter.gte = Number(amountMin); // should be new Prisma.Decimal(amountMin)
```

---

### 🔵 INFO

#### I-001 · New `address` controller is intentionally public (acceptable)
`AddressController` has no `@UseGuards` — this is correct. It serves static read-only Thai province/district data and is listed in `.claude/rules/security.md` as an intentionally public endpoint.

#### I-002 · Large file count
298 modified TypeScript files. Recommend checking that changes to existing P&L/income calculation tests correctly cover the Decimal-related regressions.

---

## Recommendation

```
🔴 BLOCK
```

96 `Number()` calls on Decimal money fields is a critical precision issue that will cause incorrect financial reports and P&L calculations. This is the exact class of bug fixed in hardening v2 (Commission Decimal precision, PR #432) and must not be reintroduced.

**Required before merge**:
1. Replace all `Number(_sum` and `Number(Decimal fields)` with `new Prisma.Decimal(...)` and `.toNumber()` only at presentation layer
2. Add `deletedAt: null` to `paymentEvidence.findMany` where clause (C-002)
3. Add `deletedAt: null` to chatbot `findFirst` queries on Customer/Contract (C-003)
4. Replace `text-gray-*` / `bg-gray-*` with design tokens (W-001)
