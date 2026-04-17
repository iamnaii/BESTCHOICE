# Pre-Merge Guard Report — `refactor/ui-design-tokens-2026-04-17`

**Date**: 2026-04-17  
**Branch**: `refactor/ui-design-tokens-2026-04-17`  
**Author**: Akenarin Kongdach \<iamnaii@MacBook-Pro-khxng-Akenarin.local\> / \<akenarin.ak@gmail.com\>  
**Base**: `origin/main`  
**Recommendation**: ✅ **APPROVE** (minor warnings noted below)

---

## File Changes Summary

| Category | Files | Insertions | Deletions |
|----------|-------|-----------|----------|
| Frontend pages/components | ~145 | ~1,750 | ~1,200 |
| Backend (chat engine, adapters) | 5 | 95 | 32 |
| E2E helpers | 2 | 40 | 25 |
| ESLint config | 1 | 30 | 2 |
| DESIGN.md (new) | 1 | 47 | 0 |
| Migration SQL | 1 | 10 | 0 |
| **Total** | **159** | **1,952** | **1,292** |

---

## What This Branch Does

### Frontend — Design Token Migration
Mass migration of hardcoded Tailwind color scales → semantic CSS variable tokens across all pages and components:
- `text-green-600` → `text-success`
- `text-red-600` / `text-red-500` → `text-destructive`
- `bg-gray-*` → `bg-muted` / `bg-card`
- `text-gray-*` → `text-muted-foreground` / `text-foreground`
- `border-gray-*` → `border-border`

Adds `DESIGN.md` — design system reference document with color tokens, typography, spacing, and component patterns.

Adds ESLint `no-restricted-syntax` rule to block future hardcoded color scale usage (with appropriate exclusion for `PrintableReceipt.tsx` and `MobileReceipt.tsx` which need raw colors for print output).

### Backend — Chat Engine Improvements
1. **`MessageRouterService.sendStaffMessage()`** — return type changed from `void` to `{ success: boolean; error?: string }`. Only caller is `StaffChatGateway` which now emits `chat:message:send-failed` event to the sending staff's socket when LINE/FB push fails.
2. **`ChatAdaptersModule`** — implements `OnModuleInit` to self-register adapters via `messageRouter.registerAdapter()`, working around circular module import limitation.
3. **`FacebookDomainModule`** — same pattern, self-registers `FacebookDomainHandler` via `registerDomainHandler()`.
4. **Bug fix**: `lineClient.isConfigured` was previously accessed as a property reference (always truthy!). Fixed to `await this.lineClient.isConfigured()` — correct async method call.
5. **Migration** `20260430000000_add_canned_response_type_media`: adds `response_type TEXT NOT NULL DEFAULT 'text'` and `media_url TEXT` columns to `canned_responses` (schema drift fix — columns existed in Prisma schema but were missing from DB).

### E2E — Auth Helper Refactor
`global-setup.ts` and `e2e/helpers/auth.ts` refactored with `ROLE_ACCOUNTS` constant map — same dev credentials documented in CLAUDE.md, just de-duplicated.

---

## Issues by Severity

### 🔴 Critical
_None found._

### 🟡 Warning

**W-01 — `Number()` on Decimal fields in display layer**  
Files: `apps/web/src/pages/liff/LiffPayment.tsx`, payment history components  
```tsx
// Used for comparison and toLocaleString display — NOT for arithmetic
Number(p.amountPaid) > 0 ? 'text-success' : ''
Number(p.lateFee).toLocaleString()
```
These are view-layer display operations and carry no financial risk, but they should ideally use `parseFloat(p.amountPaid.toString())` or a shared Decimal formatter helper for consistency with the rest of the codebase.

**Severity rationale**: No Decimal precision is lost in display formatting, but if a future developer copies this pattern into a calculation context it becomes a bug. Consider addressing in a follow-up.

### 🔵 Info

**I-01 — `type: 'TEXT' as any`** in `message-router.service.ts`  
The `as any` cast for message type is pre-existing and carried over. A typed `MessageType` enum value would be cleaner.

**I-02 — No `registerAdapter` idempotency test**  
The new `registerAdapter()` and `registerDomainHandler()` methods have idempotency guards (`if (existing === adapter) return`), but there are no unit tests covering the self-registration path. Low risk since `onModuleInit()` is only called once, but worth covering.

**I-03 — `chat:message:send-failed` event not documented in API contract**  
The new WebSocket event type is correct and properly wired (backend → `useChatSocket` → `onSendFailed` → toast), but there is no event schema documentation. The `ChatSendFailedEvent` interface in `useChatSocket.ts` serves as implicit documentation.

---

## Security Check

| Check | Result |
|-------|--------|
| New controllers missing `@UseGuards` | ✅ None added |
| `Number()` on financial arithmetic | ✅ Display/comparison only |
| Missing `deletedAt: null` | ✅ No new queries added |
| Hardcoded secrets | ✅ None (ROLE_ACCOUNTS are documented dev test credentials) |
| Raw `$queryRaw` | ✅ None |
| Raw `fetch()` in React | ✅ None (all use `api.get/post`) |
| Missing `invalidateQueries` after mutations | ✅ `onSendFailed` correctly invalidates `chat-messages` |

---

## Final Recommendation

**✅ APPROVE** — The branch delivers a well-scoped design-token migration with correct semantic token usage throughout. The ESLint rule addition prevents regressions. Backend chat improvements are sound (the `isConfigured` bug fix is particularly important). No critical or blocking issues found.

Follow-up items (non-blocking):
- Replace `Number(decimal)` display pattern with a shared formatter utility
- Add unit test for `registerAdapter` / `registerDomainHandler` idempotency
- Document `chat:message:send-failed` WebSocket event in API reference
