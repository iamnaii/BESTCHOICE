# Merge Guard Report — fix/gemini-multi-tool-grouping

**Date**: 2026-05-21  
**Branch**: `fix/gemini-multi-tool-grouping`  
**Author**: Akenarin Kongdach  
**Latest commit**: `fix(gemini): group multi-tool functionResponses into one user turn (prod 400)`

---

## File Changes Summary

| File | +Lines | -Lines |
|------|--------|--------|
| `apps/api/src/modules/sales-bot/providers/gemini.provider.ts` | +56 | -18 |
| `apps/api/src/modules/sales-bot/providers/gemini.provider.spec.ts` | +117 | 0 |

**Total**: 2 files changed, 173 insertions, 18 deletions.  
Production file: 368 lines (under 500). Spec file: 428 lines (under 500).

---

## Issue Analysis

### Critical
_None found._

- `GeminiProvider` is not a NestJS controller — no `@UseGuards` / `@Roles` concern.
- No money calculations — no `Number()` / `Prisma.Decimal` concern.
- No Prisma queries — no `deletedAt: null` concern.
- No hardcoded secrets or API keys. `GOOGLE_CLOUD_PROJECT: 'bestchoice-prod'` in tests is a project identifier, not a secret.
- No SQL touched.

### Warning
_None found._

- No DTOs modified.
- No raw `fetch()` in React components.
- No `queryClient.invalidateQueries()` concern — purely backend provider.

### Info

**`any` types in spec file** (3 occurrences, test-only):

```typescript
// gemini.provider.spec.ts — test assertions only
expect(body.contents[1].parts.every((p: any) => 'functionCall' in p)).toBe(true);
expect(body.contents[2].parts.every((p: any) => 'functionResponse' in p)).toBe(true);
expect(body.contents[2].parts.map((p: any) => p.functionResponse.name)).toEqual([...]);
```

These are in `expect()` assertions on deserialized JSON (`JSON.parse(body)`), which is `any` by nature. Production code (`gemini.provider.ts`) correctly types its output as `{ role: string; parts: unknown[] }[]` — no `any` in the fix itself. Acceptable in test context.

---

## Change Summary

### Root Cause (Production Bug)
Gemini API's `functionResponse` contract requires that when an assistant turn contains N `functionCall` parts, the immediately following user turn must contain all N `functionResponse` parts in a **single** user turn. The previous implementation pushed each tool result as a separate user turn, causing Gemini to return `400 INVALID_ARGUMENT` for any multi-tool call pattern.

This was triggered in production when a customer sent "15 ธรรมดา" → the persona's "3-Combo Anchor Pricing" playbook called `search_products` + `calculate_installment` × 3 in one assistant turn → 4 separate user turns were pushed → Gemini 400 → bot went silent.

### Fix (`gemini.provider.ts`)

`projectMessages()` return type narrowed from `unknown[]` to `{ role: string; parts: unknown[] }[]`, enabling the grouping logic:

```typescript
const isOpenToolResultTurn =
  last !== undefined &&
  last.role === 'user' &&
  last.parts.length > 0 &&
  last.parts.every(
    (p) => p !== null && typeof p === 'object' && 'functionResponse' in p,
  );

if (isOpenToolResultTurn) {
  last.parts.push(responsePart);   // group into existing user turn
} else {
  out.push({ role: 'user', parts: [responsePart] });  // new user turn
}
```

The defensive `every()` check prevents accidentally appending a `functionResponse` into a turn that also contains text parts — correct boundary enforcement.

### Tests (`gemini.provider.spec.ts`)

Three new tests added in `describe('multi-tool-call response grouping')`:

| Test | What it verifies |
|------|-----------------|
| N tool results → one user turn (the Nai case) | 4 tool results grouped into 1 user turn with 4 `functionResponse` parts |
| Single tool result → no regression | 1 tool result still gets its own user turn (1 part) |
| Tool result after text turn → no grouping | `functionResponse` starts a fresh user turn, does not merge into a text turn |

Coverage is thorough — happy path + no-regression + defensive edge case.

---

## Recommendation

**✅ APPROVE**

Production bug fix with correct root cause analysis, minimal-scope change, and strong test coverage (3 targeted regression tests). The implementation is defensive and well-commented. No security, financial, or architectural concerns.
