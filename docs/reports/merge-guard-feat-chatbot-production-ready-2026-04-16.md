# Merge Guard Report — feat/chatbot-production-ready

**Date**: 2026-04-16  
**Branch**: `feat/chatbot-production-ready`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits ahead of main**: 2 unique commits  
**Files changed**: 11 new, 254 modified (TypeScript/TSX)

---

## Summary

This branch makes the chatbot feature production-ready: adds customer feedback Quick Reply, an admin prompt editor, knowledge base seed, and removes CHATCONE dependency. It adds a fallback to a hardcoded prompt when the DB fails. Security posture on controllers is good — existing guards are in place. The critical issue is `Number()` on `amountDue` (a Decimal field) inside LINE notification cron jobs.

---

## Issues by Severity

### 🔴 CRITICAL — Must fix before merge

#### C-001 · `Number(payment.amountDue)` in LINE cron notification (2 instances)
**File**: LINE notification cron / payment reminder service  
**Context**: Used when building Flex Message payloads for overdue and upcoming payment LINE notifications

```ts
// ❌ Wrong — amountDue is Decimal; Number() loses precision
amountDue: Number(payment.amountDue),  // payment reminder flex
amountDue: Number(payment.amountDue),  // overdue flex
lateFee: Number(payment.lateFee),
```

For display-only use in LINE messages this may seem harmless, but:
1. It sets a bad pattern that propagates to future code
2. Amounts in LINE messages must exactly match what customers owe — rounding errors erode trust
3. Consistent rule: `Prisma.Decimal` everywhere, `.toNumber()` only at JSON serialization boundary

```ts
// ✅ Correct
amountDue: payment.amountDue.toNumber(),
lateFee: payment.lateFee?.toNumber() ?? 0,
```

---

### 🟡 WARNING — Should fix

#### W-001 · Hardcoded `text-gray-*` and `text-white` in new TSX components
**Violates**: `.claude/rules/frontend.md` — design token rule  
Multiple new components (sidebar, navigation, mobile menu) use hardcoded gray/white:

```tsx
// ❌ Wrong
className="text-sm text-gray-300 hover:text-white"
className="text-gray-400 text-xs"
className="text-gray-900"  // will break in dark mode

// ✅ Correct
className="text-sm text-muted-foreground hover:text-foreground"
className="text-xs text-muted-foreground"
className="text-foreground"
```

Note: `text-white` inside dark sidebar panels (dark background guaranteed) may be acceptable — evaluate per component. `text-gray-900` and `text-gray-*` in non-dark contexts must use tokens.

---

### 🔵 INFO

#### I-001 · Guard coverage is good
All protected controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`. The LIFF endpoint correctly uses `LiffTokenGuard`. The `chatbot/finance/admin` endpoint has `@UseGuards(JwtAuthGuard, RolesGuard)` with appropriate roles.

#### I-002 · Mutation/invalidation balance is correct
48 `useMutation` hooks with 49 `invalidateQueries` calls — all mutations properly invalidate cache.

#### I-003 · No raw `fetch()` in frontend
All data fetching goes through `api.get()` / `api.post()` from `@/lib/api` — correct.

#### I-004 · Dev-only LINE secret bypass is properly guarded
```ts
// SECURITY: dev-only bypass. In production, missing secret = hard reject
if (process.env.NODE_ENV === 'production') {
  this.logger.error('LINE Finance channel secret missing — refusing webhook');
}
```
Pattern is acceptable for dev convenience, production path is safe.

---

## Recommendation

```
🟡 REVIEW
```

Only 2 critical instances of `Number()` on Decimal fields — small fix. Gray token violations are widespread but cosmetic. Once C-001 is fixed and W-001 addressed in non-dark contexts, this branch is mergeable.

**Required before merge**:
1. Replace `Number(payment.amountDue)` and `Number(payment.lateFee)` with `.toNumber()` in cron (C-001)
2. Replace `text-gray-*` / `text-gray-900` in non-dark contexts with semantic design tokens (W-001)
