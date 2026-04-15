# Pre-Merge Guard Report: feature/chatbot-finance

**Date**: 2026-04-15  
**Branch**: `feature/chatbot-finance`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Notable commits ahead of feature base**: 5 (incl. merge commit)  
**Recommendation**: 🟡 REVIEW — no critical blockers; verify TODO comment resolution

---

## Commit Summary (unique to branch)

| Hash | Message |
|------|---------|
| `0cb5e72` | feat(chart-of-accounts): multi-entity support + PEAK mapping fields |
| `d0cb6ee` | Merge remote-tracking branch 'origin/main' into feature/chatbot-finance |
| `d5da1ad` | feat(trade-in): walk-in seller, expense voucher PDF, anti-stolen-goods |
| `9f35741` | fix(db): add missing chart_of_accounts migration |
| `acd92d5` | feat(chatbot-finance): น้องเบส — full Finance Bot (Phases A1–E) |

---

## Files Changed (key TS/TSX)

- `apps/api/src/modules/chatbot-finance/chatbot-finance.controller.ts` — new
- `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts` — new
- `apps/api/src/modules/chatbot-finance/chatbot-finance-liff.controller.ts` — new
- `apps/api/src/modules/accounting/accounting.service.ts` — modified
- `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts` — modified
- `apps/api/prisma/schema.prisma` — modified (756 line delta)

---

## Issues

### 🔴 Critical — None found ✅

#### Auth guards review — PASS

| Controller | Guard | Justification |
|-----------|-------|--------------|
| `chatbot-finance.controller.ts` | `@UseGuards(LineFinanceWebhookGuard)` for webhook POST; `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('OWNER')` for admin trigger | ✅ Correct — webhook uses custom guard; admin endpoint gated |
| `chatbot-finance-admin.controller.ts` | `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER', 'FINANCE_MANAGER')` | ✅ Fully guarded |
| `chatbot-finance-liff.controller.ts` | No JWT guard | ✅ **Intentionally public** — LIFF endpoints use LINE LIFF token, explicitly allowed in security rules (`chatbot-finance-liff`) |

No `Number()` on financial Decimal fields detected in chatbot service code reviewed.

No hardcoded secrets or raw `$queryRaw` found.

---

### 🟡 Warning (should fix)

#### W-001 — Unresolved TODO in chatbot code
**Context**: The commit message for `acd92d5` mentions:
> "TODO: gate with JwtAuthGuard + Roles(OWNER) before production"

The diff shows this was addressed in the admin controller, but the TODO comment may still exist as a comment in the code. **Verify no `// TODO:` guards comments remain** before merge by running:

```bash
grep -r "TODO.*gate\|TODO.*JwtAuth\|TODO.*guard" apps/api/src/modules/chatbot-finance/
```

#### W-002 — Large Prisma schema delta (756 lines changed)
**File**: `apps/api/prisma/schema.prisma`  
The schema has a 756-line delta. This branch adds `ChatSession`, `ChatMessage`, `KnowledgeBaseEntry`, and related models. Verify:
- All new models include `deletedAt DateTime?`
- All money fields use `@db.Decimal(12, 2)`
- New FK relations use `onDelete: Restrict` (not `Cascade`) for legal evidence tables

---

### 🔵 Info

#### I-001 — Anti-stolen-goods safeguard ✅
`d5da1ad` adds IMEI duplicate detection to trade-in walk-in flow — important for fraud prevention.

#### I-002 — Chart of accounts multi-entity ✅
`0cb5e72` adds `companyCode` / `entityType` fields for SHOP vs FINANCE separation in CoA — consistent with the dual-entity accounting architecture.

---

## Action Required

1. Run `grep -r "TODO.*gate\|TODO.*JwtAuth" apps/api/src/modules/chatbot-finance/` and remove any unresolved TODO guards.
2. Spot-check new Prisma models (`ChatSession`, `KnowledgeBaseEntry`) for `deletedAt`, Decimal money fields, and `onDelete: Restrict` on evidence-linked FKs.
3. Confirm migration file for the chart-of-accounts change (`9f35741`) applies cleanly to production database.
