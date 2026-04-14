# Merge Guard Report — feature/chatbot-finance

**Date**: 2026-04-14  
**Branch**: `feature/chatbot-finance`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits**: 10+ (includes full chatbot-finance Phases A1–E, trade-in walk-in, chart-of-accounts multi-entity)  
**Merge Base**: `feat/accounting-audit-fixes` (this branch is a strict superset)

## File Changes Summary

This branch encompasses all changes in `feat/accounting-audit-fixes` plus additional commits:

| Commit | Description |
|--------|-------------|
| `0cb5e72e` | `feat(chart-of-accounts)`: multi-entity support + PEAK mapping fields |
| `d5da1ad5` | `feat(trade-in)`: walk-in seller, expense voucher PDF, anti-stolen-goods safeguards |
| `acd92d58` | `feat(chatbot-finance)`: น้องเบส — full Finance Bot Phases A1–E |
| `085da4d3` | `chore(chatbot-finance)`: pre-deploy hardening — auth gates + env docs |
| `bb17d7bf` | `fix(chatbot-finance)`: 5 critical + 8 warning code review fixes |
| `fd7a7666` | `fix(chatbot-finance)`: remaining Info fixes (I-1 to I-6) |

Additional unique changes beyond `feat/accounting-audit-fixes`:
- Trade-in walk-in seller flow with expense voucher PDF
- Chart of accounts multi-entity + PEAK accounting mapping
- Full chatbot-finance module (LINE Finance Bot, LIFF auth, tool execution, admin UI)
- `ChatconeController` present (not yet removed — removed in `feat/chatbot-production-ready`)

---

## Issues

### Critical

**C-1 — Inherits all C-1 violations from `feat/accounting-audit-fixes`**

72+ `Number()` on Decimal financial fields across service files. See `merge-guard-feat-accounting-audit-fixes-2026-04-14.md` for full detail.

Additional unique violation in this branch:
- `apps/api/src/modules/accounting/accounting.service.ts`: `Number(p.monthlyPrincipal)`, `Number(p.monthlyInterest)`, `Number(p.amountPaid)` used in income calculation reduce loops

**C-2 — Inherits all C-2 violations from `feat/accounting-audit-fixes`**

176+ Prisma queries without `deletedAt: null`. See parent report for detail.

### Warning

**W-1 — `ChatbotFinanceLiffController` intentionally public but schema should confirm throttling**

`ChatbotFinanceLiffController` (intentionally public, as per security rules) has `@Throttle({ short: { ttl: 60000, limit: 30 } })` on the status check endpoint — ✅. However, OTP endpoints (`request-otp`, `verify-otp`) should also be explicitly throttled to prevent OTP brute-force.

Check: `/home/user/BESTCHOICE/apps/api/src/modules/chatbot-finance/chatbot-finance-liff.controller.ts`

**W-2 — `ChatconeController` still present (not deleted)**

`feature/chatbot-finance` still includes the `ChatconeController` / `ChatconeModule` that is deleted in `feat/chatbot-production-ready`. The chatcone controller uses `Number(page)` / `Number(limit)` for pagination params (acceptable for pagination) but the module itself appears to be deprecated. Merging this branch would retain dead code.

**W-3 — Trade-in expense voucher PDF uses `Number()` on cost fields**

`apps/api/src/modules/trade-in/trade-in.service.ts` (unique to this branch) converts `Decimal` fields with `Number()` when building PDF data. Should use `.toString()` or `Prisma.Decimal` for consistency.

**W-4 — `feature/chatbot-finance` has not merged recent `main` commits**

The last merge from `origin/main` was at commit `d0cb6eef`. There are subsequent commits on `main` (forced-updated) that may include security patches. Recommend rebasing or merging latest `main` before final review.

### Info

- **I-1** — `ChatbotFinanceController` webhook endpoint uses `LineFinanceWebhookGuard` (not `JwtAuthGuard`) — correct for LINE webhook. Admin endpoints on the same controller use `@UseGuards(JwtAuthGuard, RolesGuard)` per-method. ✅
- **I-2** — Chart of accounts multi-entity adds `companyId` FK — migration present. ✅
- **I-3** — Anti-stolen-goods check in trade-in is a notable security feature (IMEI serial check against repossessed/flagged list). Logic looks sound.
- **I-4** — This branch is very large and combines multiple independent features. Consider a staged merge approach: chatbot-finance → chart-of-accounts → trade-in, each as separate PRs.

---

## Security Checks

| Check | Result |
|-------|--------|
| `@UseGuards` on all new controllers | ✅ All guarded (LIFF/webhook use appropriate non-JWT guards) |
| `@Roles()` on controller methods | ✅ Present on admin/authenticated endpoints |
| `Number()` on financial Decimal fields | ❌ **Critical — inherits 72+ violations + additional** |
| `deletedAt: null` in new queries | ❌ **Critical — inherits 176+ missing filters** |
| Hardcoded secrets | ✅ None |
| SQL injection | ✅ None found |
| OTP throttling on LIFF endpoints | ⚠️ Status endpoint throttled; verify OTP endpoints |
| LINE webhook signature verification | ✅ `LineFinanceWebhookGuard` confirmed |

---

## Recommendation

**🔴 BLOCK**

This branch inherits all critical issues from `feat/accounting-audit-fixes` (72+ `Number()` on financial Decimals, 176+ queries missing `deletedAt: null`) and adds additional violations.

Recommended path to merge:
1. Fix C-1 (`Number()` → `Prisma.Decimal`) across all service files
2. Fix C-2 (add `deletedAt: null` to all soft-deletable model queries)
3. Rebase/merge latest `origin/main`
4. Address W-1 (OTP throttle verification) and W-3 (trade-in PDF)
5. Re-run `./tools/check-types.sh all` + `./tools/run-tests.sh`
6. Consider splitting into smaller PRs for reviewability
