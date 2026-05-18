# Pre-Merge Guard Report — feat/sidebar-sp6

**Branch**: `feat/sidebar-sp6`
**Author**: Akenarin Kongdach
**Date reviewed**: 2026-05-18
**Changes**: 24 files changed, +4,624 / -1 lines

---

## File Changes Summary

| Area | Files | Lines |
|------|-------|-------|
| API — new `bank-accounts` module | 5 | +1,038 |
| API — schema + migration | 2 | +87 |
| API — `app.module.ts` registration | 1 | +3 |
| Web — `BankAccountsPage.tsx` | 1 | +542 |
| Web — `mask.util.ts` + tests | 2 | +47 |
| Web — routing + menu | 2 | +16 |
| Web — E2E spec | 1 | +58 |
| Docs / design specs | 8 | +2,833 |

---

## Security Checks

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on all new controllers | ✅ Present at class level |
| `@Roles(...)` on every controller method | ✅ All 5 endpoints decorated |
| `deletedAt: null` in all new Prisma queries | ✅ 8/8 queries filtered |
| `Number()` on financial/Decimal fields | ✅ None — pagination only |
| Raw SQL / unparameterized `$queryRaw` | ✅ None |
| Hardcoded secrets or API keys | ✅ None |
| Raw `fetch()` in frontend (instead of `api.get/post`) | ✅ None — uses `api.*` + `useQuery` |
| `localStorage` / `sessionStorage` for sensitive data | ✅ None |

---

## Issues

### Critical
_None._

### Warning
_None._

### Info

1. **`BankAccountsPage.tsx` is 542 lines** — slightly over the 500-line guideline. Not blocking, but worth noting for a future split (list vs. detail panels).

---

## Notes

- New `BankAccount` model correctly mirrors the 6 CoA cash/bank codes (11-1101..1203) and enforces `accountCode` uniqueness.
- `maskAccountNumber` utility properly masks PII before display — good practice for account numbers.
- `bank-accounts.service.spec.ts` has 346 lines covering CRUD + `getBalance` + `getTransactions` paths — solid coverage.
- `@Roles('OWNER')` on write operations, `@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')` on reads — role mapping is correct per business model.

---

## Recommendation

**✅ APPROVE**

No security or correctness issues. Safe to merge.
