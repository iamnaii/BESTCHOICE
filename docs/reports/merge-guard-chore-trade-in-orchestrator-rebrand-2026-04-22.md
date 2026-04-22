# Pre-Merge Guard Report

**Branch:** `chore/trade-in-orchestrator-rebrand`  
**Date:** 2026-04-22  
**Reviewer:** Pre-Merge Guard Agent (automated)  
**Recommendation:** 🔴 BLOCK — fix 1 critical issue before merging

---

## Branch Summary

| Field | Value |
|-------|-------|
| Unique commits | 15 |
| Files changed (TS/TSX) | 40+ |
| New controllers | 2 (chatbot-finance LIFF, chatbot-finance admin) |
| New services | 4 |
| New frontend components | 2 |
| Legacy-import endpoint | Deleted ✅ (commit d7457580) |

### Commits Reviewed
1. `5f6468cf` refactor(trade-in): quickBuy orchestrator + rebrand modal as primary flow
2. `d5fdd241` feat(trade-in): Quick Buy wizard + seller history + working search
3. `d693daec` feat: chatbot-finance + trade-in voucher with anti-stolen-goods
4. `acd92d58` feat(chatbot-finance): น้องเบส — full Finance Bot (Phases A1–E)
5. `b4c49d17` feat(legacy-import): temporary admin endpoint ← **DELETED** in `d7457580` ✅
6. `d7457580` chore(legacy-import): remove temporary migration endpoint

---

## Issues Found

### Critical — 1 issue

**C-001: `Number()` used on financial Decimal fields in trade-in.service.ts**
- **File:** `apps/api/src/modules/trade-in/trade-in.service.ts`
- **Lines:** 479 and 549
- **Code:**
  ```typescript
  // Line 479 — sellerHistory response:
  amount: Number(r.agreedPrice ?? 0),

  // Line 549 — verifyByVoucherNumber response:
  amount: Number(tradeIn.agreedPrice ?? tradeIn.offeredPrice ?? 0),
  ```
- **Risk:** `agreedPrice` and `offeredPrice` are `@db.Decimal(12, 2)` fields. Converting via `Number()` can cause IEEE 754 floating-point precision loss on values above ~1 million baht (15+ significant digits). Violates codebase rule: "ใช้ `Decimal` เท่านั้น — ห้ามใช้ `Float` หรือ `Int`".
- **Fix (2-line change):**
  ```typescript
  // Line 479:
  amount: r.agreedPrice?.toNumber() ?? 0,

  // Line 549:
  amount: (tradeIn.agreedPrice ?? tradeIn.offeredPrice)?.toNumber() ?? 0,
  ```
- **Estimated fix time:** 5 minutes

### Warning — 1 issue

**W-001: trade-in.service.ts exceeds 500-line guideline**
- **File:** `apps/api/src/modules/trade-in/trade-in.service.ts` — 571 lines
- **Recommendation:** Consider splitting into `QuickBuyService` (orchestrator) and `TradeInQueryService` (reads) in a follow-up PR. Not a blocker for this merge.

### Info — 2 items

**I-001: Legacy-import module confirmed deleted**
- Commit `d7457580` properly removes: controller, service, module, and app.module.ts registration.
- No residual references detected. ✅

**I-002: chatbot-finance LIFF endpoints are intentionally public**
- `chatbot-finance-liff.controller.ts` has no JwtAuthGuard — correct.
- Uses SMS OTP verification with rate-limiting (`@Throttle({ short: { ttl: 60000, limit: 5 } })`).
- Listed in intentionally public allowlist (`chatbot-finance-liff`). ✅

---

## Positive Findings

- ✅ All non-LIFF controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` at class level
- ✅ All methods have `@Roles()` decorators
- ✅ All new Prisma queries include `deletedAt: null` filters
- ✅ No hardcoded secrets — LINE tokens from `process.env`
- ✅ No unparameterized `$queryRaw`
- ✅ All new DTOs have class-validator decorators with Thai error messages
  - "กรุณาระบุยี่ห้อเครื่อง", "IMEI ต้องเป็นตัวเลข 15 หลัก", "เลขบัตรประชาชนต้อง 13 หลัก"
- ✅ QuickBuyModal uses `api.post('/trade-ins/quick-buy')` — no raw `fetch()`
- ✅ `queryClient.invalidateQueries({ queryKey: ['trade-ins'] })` called after mutation
- ✅ chatbot-finance LINE webhook uses `LineFinanceWebhookGuard` (signature verification)
- ✅ LIFF endpoints have proper rate limiting (brute-force protection on OTP)
- ✅ Legacy-import endpoint fully removed before merge

---

## Required Fix Before Merge

```typescript
// apps/api/src/modules/trade-in/trade-in.service.ts

// Line 479 — change:
amount: Number(r.agreedPrice ?? 0),
// to:
amount: r.agreedPrice?.toNumber() ?? 0,

// Line 549 — change:
amount: Number(tradeIn.agreedPrice ?? tradeIn.offeredPrice ?? 0),
// to:
amount: (tradeIn.agreedPrice ?? tradeIn.offeredPrice)?.toNumber() ?? 0,
```

After this fix, run `./tools/check-types.sh all` to verify no regressions.

---

## Pre-Merge Checklist

- [ ] **🔴 Fix C-001** — `Number()` → `.toNumber()` in trade-in.service.ts lines 479, 549
- [ ] Run `npx prisma migrate dev` (chart-of-accounts migration)
- [ ] Run `./tools/check-types.sh all`
- [ ] Run `./tools/run-tests.sh`
- [ ] Verify chatbot-finance OTP flow tested in staging
- [ ] Confirm LINE Finance bot token configured for production
