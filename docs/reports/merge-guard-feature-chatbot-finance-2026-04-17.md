# Merge Guard Report — `feature/chatbot-finance`

**Date**: 2026-04-17  
**Reviewer**: Pre-Merge Guard (automated)  
**Branch**: `feature/chatbot-finance`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Status relative to main**: 17 commits ahead · 328 commits behind  
**Latest commit**: `0cb5e72e` (2026-04-08)

---

## File Changes Summary

The three-dot diff (unique branch additions vs merge base) covers 16 files, ~2,244 insertions / 84 deletions:

| File | Change |
|------|--------|
| `apps/api/src/modules/trade-in/services/voucher.service.ts` | NEW — 1,058 lines: expense voucher PDF generation |
| `apps/web/src/pages/TradeInPage.tsx` | NEW — 513 insertions: trade-in UI (flat file, conflicts with main's directory structure) |
| `apps/api/src/modules/trade-in/trade-in.service.ts` | +287 lines: walk-in seller flow, IMEI check, verifyByVoucherNumber |
| `apps/api/src/modules/trade-in/trade-in.controller.ts` | +84 lines: new endpoints (check-imei, verify, voucher, id-card-photo) |
| `apps/api/src/modules/trade-in/dto/trade-in.dto.ts` | +105 lines: UpdateTradeInDto, AcceptTradeInDto, anti-theft fields |
| `apps/api/src/modules/chart-of-accounts/dto/chart-of-account.dto.ts` | allowedCompanies + peakAccountCode fields |
| `apps/api/src/modules/journal/journal.service.ts` | +35 lines: per-company account validation |
| `apps/api/src/main.ts` | Removed `forbidNonWhitelisted: true` |
| `apps/api/prisma/schema.prisma` | +12 lines: new fields on TradeIn, ChartOfAccount |
| `apps/api/prisma/seeds/chart-of-accounts.ts` | allowedCompanies + peakAccountCode in seed data |
| Migrations (×2) | trade_in_voucher, chart_of_accounts_multi_entity |

> **Note**: Many of these changes appear to have been **already merged into main** (voucher.service.ts, trade-in.service.ts orchestrator, controller routes, QuickBuyModal). The branch is 328 commits behind main and has not been rebased.

---

## Issues by Severity

### ⛔ CRITICAL

**C-1: Raw `fetch()` to hardcoded localhost URL** — `apps/web/src/pages/TradeInPage.tsx`
```ts
// Line ~386 of branch version
const res = await fetch('http://localhost:3457/api/read-card');
```
- **Rule violated**: Frontend rules require `api.get()` / `api.post()` only; raw `fetch()` is prohibited.
- **Additional concern**: Hardcoded `http://localhost:3457` will silently fail in staging/production. Should be an env var or a backend proxy endpoint.
- **Fix**: Expose a `/api/trade-ins/card-reader` proxy endpoint in the API, or use an env-configured URL via the `api` client.

---

### ⚠️ WARNING

**W-1: `Number()` on Decimal money fields** — `voucher.service.ts` + `trade-in.service.ts`
```ts
// voucher.service.ts:53, :99
const amount = Number(tradeIn.agreedPrice ?? tradeIn.offeredPrice ?? 0);

// trade-in.service.ts (~line 380)
amount: Number(tradeIn.agreedPrice ?? tradeIn.offeredPrice ?? 0),
```
- **Rule violated**: Database rules require `Prisma.Decimal` for all money arithmetic — `Number()` on Decimal fields causes floating-point precision loss.
- **Context**: These same patterns exist in `origin/main` (i.e., they were merged previously), making this a **pre-existing issue** in main as well. However, they originated from this branch and should be corrected before any future work on these files.
- **Fix**: `new Prisma.Decimal(tradeIn.agreedPrice ?? tradeIn.offeredPrice ?? 0)`

**W-2: `generateVoucherNumber` findFirst missing `deletedAt: null`** — `voucher.service.ts:29`
```ts
const last = await tx.tradeIn.findFirst({
  where: { voucherNumber: { startsWith: prefix } },
  // no deletedAt: null
```
- Intentionally omitted (soft-deleted records should still hold their voucher number to prevent collisions), but the omission should be documented with a comment to make the intent clear and avoid future "fix" that would break idempotency.

**W-3: Branch is 328 commits behind main — rebase required**
- The branch has not been rebased since ~early April.
- `apps/web/src/pages/TradeInPage.tsx` (flat file) conflicts structurally with `apps/web/src/pages/TradeInPage/` (directory) in main.
- Merging without rebase will produce hundreds of conflicts and may revert changes already in main.

---

### ℹ️ INFO

**I-1: `voucher.service.ts` is 1,058 lines** — exceeds the 500-line recommended limit. Consider splitting PDF rendering logic into a `voucher-pdf.renderer.ts` utility.

**I-2: `main.ts` removes `forbidNonWhitelisted: true`** with documented rationale (mixed `@Query()` patterns). Main has already adopted this change. The comment in the file explains the tradeoff adequately.

**I-3: `AcceptTradeInDto` validation messages partially missing** — `idCardVerified` and `sellerConsentSigned` have Thai messages, but `policeReportAcknowledged`, transfer fields do not.

---

## Recommendation

### 🚫 BLOCK

**Do not merge.** Two blockers must be resolved first:

1. **Rebase the branch onto current `origin/main`** — the 328-commit gap and structural conflict with `TradeInPage/` directory make a direct merge unworkable.
2. **Fix C-1 (raw fetch to localhost:3457)** — replace with a backend proxy endpoint or env-configured URL using the `api` client.

After rebase, re-run this guard to identify any new issues introduced by the rebase diff.

---

*Generated by Pre-Merge Guard on 2026-04-17*
