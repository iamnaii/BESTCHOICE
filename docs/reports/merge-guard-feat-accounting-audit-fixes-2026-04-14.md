# Merge Guard Report — feat/accounting-audit-fixes

**Date**: 2026-04-14  
**Branch**: `feat/accounting-audit-fixes`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits**: 5  
**Merge Base**: `origin/main`

## File Changes Summary

718 files changed — 322,360 insertions, 30,877 deletions  
*(This is a very large branch encompassing chatbot-finance, trade-in, inter-company accounting, chart-of-accounts, asset management, analytics, CRM, and numerous other subsystems.)*

Key new modules added:
- `accounting`, `ads-tracking`, `analytics`, `asset`, `broadcast`, `chart-of-accounts`, `chat-adapters`, `chat-analytics`, `chatbot-finance`, `crm`, `csat`, `loyalty`, `staff-chat`, `todos`

---

## Issues

### Critical

**C-1 — `Number()` on Decimal financial fields (72 occurrences across 20+ service files)**  
Violates database rule: *"ใช้ Decimal เท่านั้น — ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน"*

Affected files and representative lines:

| File | Violation |
|------|-----------|
| `apps/api/src/modules/contracts/contract-payment.service.ts` | `Number(p.amountDue)`, `Number(p.amountPaid)`, `Number(contract.monthlyPayment)`, `Number(contract.sellingPrice)`, `Number(contract.downPayment)`, `Number(contract.vatPct)`, `Number(p.lateFee)` |
| `apps/api/src/modules/contracts/contracts.service.ts` | `Number(created.sellingPrice)`, `Number(created.downPayment)`, `Number(created.financedAmount)`, `Number(created.monthlyPayment)` |
| `apps/api/src/modules/accounting/accounting.service.ts` | `Number(expense.totalAmount)`, `Number(voided.totalAmount)` |
| `apps/api/src/modules/accounting/bad-debt.service.ts` | `Number(p.amountDue)`, `Number(p.amountPaid)`, `Number(p.provisionAmount)` |
| `apps/api/src/modules/finance-receivable/finance-receivable.service.ts` | `Number(nextPayment.amountDue)`, `Number(nextPayment.amountPaid)` |
| `apps/api/src/modules/repossessions/repossessions.service.ts` | `Number(c.financedAmount)`, `Number(c.interestTotal)`, `Number(c.monthlyPayment)` |
| `apps/api/src/modules/chatbot-finance/services/finance-tools.service.ts` | `Number(c.sellingPrice)`, `Number(c.financedAmount)`, `Number(c.vatAmount)`, `Number(c.interestTotal)`, `Number(pm.amountDue)` |
| `apps/api/src/modules/chatbot-finance/services/auto-trigger.service.ts` | `Number(p.amountDue)`, `Number(p.amountPaid)` |
| `apps/api/src/modules/payments/payments.service.ts` | `Number(args.payment.amountDue)`, `Number(args.payment.amountPaid)` |
| `apps/api/src/modules/overdue/overdue-chat.service.ts` | `Number(nextUnpaid.amountDue)`, `Number(p.amountPaid)` |

All of these should use `new Prisma.Decimal(value)` for arithmetic and `.toDecimal()` / `Prisma.Decimal.add()` for aggregation. `toNumber()` is acceptable *only* in the final serialization step (return value to API consumer).

**C-2 — Missing `deletedAt: null` in new Prisma queries (176 occurrences in service files)**

Many new `findMany` and `findFirst` calls lack `where: { deletedAt: null }`, which means soft-deleted records will appear in results.

Representative files:
- `apps/api/src/modules/accounting/accounting.service.ts` — `adsCampaign.findMany({})`, `fixedAsset.findMany({})`  
- `apps/api/src/modules/asset/asset.service.ts` — `fixedAsset.findMany({})`, `fixedAsset.findFirst({})`  
- `apps/api/src/modules/chat-analytics/chat-analytics.service.ts` — `chatSession.findMany({})` multiple times  
- `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts` — `chartOfAccount.findMany({})`, `chartOfAccount.findUnique({})`  
- `apps/api/src/modules/loyalty/loyalty.service.ts` — `customerLineLink.findMany({})`

**Note**: Some of these tables may not have soft-delete (`deletedAt`) in their schema. However, per project convention all models include `deletedAt DateTime?`. Each query should be audited to confirm it either (a) adds `deletedAt: null`, or (b) is for a model explicitly without soft-delete.

### Warning

**W-1 — New controllers not confirmed in security-intentional-public allow-list**

- `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` — no `@UseGuards(JwtAuthGuard)`, uses HMAC-SHA256 `FB_APP_SECRET` verification instead. This is correct for a Facebook webhook but is **not listed** in `.claude/rules/security.md` as an intentionally public endpoint. Should be added to the allow-list to prevent future false positives.

**W-2 — `apps/api/scripts/import-legacy/` files use `Number()` on financial data**

`check-sample.ts` and `validate.ts` are one-off migration scripts, but they use `Number()` on financial Decimal fields. While not production service code, precision loss could affect migration accuracy.

**W-3 — `chatbot-finance/services/slip-processing.service.ts` arithmetic**

Uses `Number()` on slip amount fields for comparison logic. Slip amounts are financial values and should use Decimal.

### Info

- **I-1** — Branch is 718 files, which is difficult to review meaningfully as a single unit. Consider splitting into logical sub-PRs (chatbot-finance, accounting, CRM/ads, asset management) for future work.
- **I-2** — `snapshot.txt` (345 lines) and `*.csv` sample data files are committed. These are likely test/migration artifacts and should be in `.gitignore` or removed before merge.
- **I-3** — `apps/api/prisma/backfill-coa-companies.sql` — raw SQL backfill script committed to repo. Should include a header comment documenting when/how it was run.
- **I-4** — Multiple new services use `toNumber()` after proper `Prisma.Decimal` arithmetic (e.g., `accounting.service.ts` lines 204–239). This pattern is **correct** for API response serialization and should not be confused with the C-1 violations.

---

## Security Checks

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on new controllers | ✅ All guarded except FacebookWebhookController (intentionally public, HMAC-verified) |
| `@Roles()` on controller methods | ✅ Present on reviewed methods |
| `Number()` on financial Decimal fields | ❌ **72 violations in service files** (Critical) |
| `deletedAt: null` in new queries | ❌ **176 findMany/findFirst without filter** (Critical) |
| Hardcoded secrets | ✅ None (test credentials in spec files only) |
| SQL injection (`$queryRaw`) | ✅ None found |
| DTO validation decorators | ✅ Present on new DTOs reviewed |

---

## Recommendation

**🔴 BLOCK**

Two critical categories of issues must be resolved before merge:

1. **72 `Number()` violations on Decimal financial fields** across core payment, contract, accounting, and finance-receivable services. These risk silent precision loss on monetary amounts ≥ 2^53 satang (≈ ฿90T, so practically safe for current scale), but violate the explicit project rule and undermine consistency.

2. **176 Prisma queries without `deletedAt: null`** — soft-deleted records will appear in API responses, reports, and chatbot data for multiple modules.

Fix strategy:
- Replace `Number(decimalField)` with `new Prisma.Decimal(decimalField.toString())` for arithmetic; use `.toNumber()` only in the final return/serialization step.
- Add `deletedAt: null` to `where` clauses (or document why a specific model is exempt).
- Add `FacebookWebhookController` to the intentionally-public allow-list in `.claude/rules/security.md`.
