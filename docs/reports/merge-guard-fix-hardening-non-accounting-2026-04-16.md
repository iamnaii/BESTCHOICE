# Merge Guard Report — fix/hardening-non-accounting

**Date**: 2026-04-16  
**Branch**: `fix/hardening-non-accounting`  
**Author**: Akenarin Kongdach `<iamnaii@MacBook-Pro-khxng-Akenarin.local>`  
**Reviewed against**: `origin/main`  
**Unique tip commits analyzed** (2 commits unique beyond `feat/chatbot-production-ready` merge):

| Commit | Message |
|--------|---------|
| `16a18376` | feat(chat): complete Phase 2 — WS events, file upload, read receipts, KB suggestions |
| `17c1c9f9` | fix: hardening — security, DTOs, FINANCE_MANAGER, SMS retry, Dashboard MoM |

---

## File Changes Summary

**Scope**: 34 files changed (678 insertions, 281 deletions) in app source code

| Area | Files Changed |
|------|---------------|
| Backend — chatbot-finance | `chatbot-finance-admin.controller.ts`, `chatbot-finance-liff.controller.ts`, `chatbot-finance.module.ts`, `guards/line-finance-webhook.guard.ts`, `services/auto-trigger.service.ts`, `services/finance-tools.service.ts`, `services/chatbot-finance.service.spec.ts` |
| Backend — chat-engine | `chat-engine.module.ts`, `interfaces/chat-gateway.interface.ts`, `services/assignment.service.ts`, `services/handoff-manager.service.ts`, `services/message-router.service.ts`, `services/session-manager.service.ts` |
| Backend — staff-chat | `staff-chat.controller.ts`, `staff-chat.gateway.ts`, `staff-chat.module.ts` |
| Backend — line-oa | `dto/evidence.dto.ts` (NEW), `dto/liff.dto.ts`, `liff-api.controller.ts`, `line-oa-payment.controller.ts` |
| Backend — other controllers | `pdpa.controller.ts`, `pricing-templates.controller.ts`, `products.controller.ts`, `quality-control/inspections.controller.ts`, `suppliers.controller.ts` |
| Backend — dashboard | `dashboard.service.ts` |
| Frontend — web | `ChatbotFinanceKnowledgePage.tsx`, `DashboardPage/components/DashboardKPIs.tsx`, `DashboardPage/types.tsx`, `UnifiedInboxPage/index.tsx`, `liff/LiffFinanceVerify.tsx`, `liff/LiffRegister.tsx` |

---

## Issues by Severity

### 🚨 Critical — Must Fix Before Merge

No critical issues found.

---

### ⚠️ Warning — Should Fix

#### W-001: `MessageRole.BOT` used for staff file uploads (logic bug)
**File**: `apps/api/src/modules/staff-chat/staff-chat.controller.ts` — `uploadFile()` method  
**Issue**: When staff uploads a file via `POST /staff-chat/sessions/:id/upload`, the message is saved with `role: MessageRole.BOT`. The correct role is `MessageRole.STAFF`.  
**Impact**: Chat history will incorrectly attribute staff-uploaded files as bot messages. Affects message display in UI (wrong sender label) and any analytics that group by sender role.  
**Fix**:
```ts
// Change:
role: MessageRole.BOT,
// To:
role: MessageRole.STAFF,
```

#### W-002: `ApproveEvidenceDto.amount` uses `@IsNumber()` for a money field
**File**: `apps/api/src/modules/line-oa/dto/evidence.dto.ts`  
**Issue**: `ApproveEvidenceDto.amount` is typed as `number` with `@IsNumber()`. The same file's `SlipUploadBodyDto.amount` correctly uses `@IsString() + @Matches(/^\d+(\.\d{1,2})?$/)` to avoid floating-point precision issues.  
**Impact**: Float precision risk when amount is compared against Prisma Decimal values (`Math.abs(body.amount - expectedAmount) > 100`). Inconsistent with project convention.  
**Fix**: Change to string-based validation matching the pattern in `SlipUploadBodyDto`:
```ts
@IsString({ message: 'กรุณาระบุจำนวนเงิน' })
@Matches(/^\d+(\.\d{1,2})?$/, { message: 'จำนวนเงินต้องเป็นตัวเลขทศนิยมที่ถูกต้อง' })
amount!: string;
```
Then convert `body.amount` → `new Prisma.Decimal(body.amount)` in the service logic.

#### W-003: Hardcoded Tailwind colors in new `SuggestionsTab` component
**File**: `apps/web/src/pages/ChatbotFinanceKnowledgePage.tsx` — `SuggestionsTab` component  
**Issue**: Multiple hardcoded color utilities violate the design token rule:  
- `bg-gray-50`, `text-gray-400`, `text-gray-500`, `bg-gray-100`, `bg-white`  
- `bg-blue-600`, `text-blue-700`, `bg-blue-50`  
- `bg-yellow-100`, `text-yellow-700`, `bg-green-100`, `text-green-700`, `bg-red-100`, `text-red-700`  

**Rule** (`rules/frontend.md`): Use CSS design tokens — `bg-muted`, `text-muted-foreground`, `bg-background`, `bg-card`, `hover:bg-accent`, etc.  
**Impact**: Component will not respect light/dark theme switching; visual inconsistency with rest of app.

#### W-004: Missing Thai validation messages on several DTO decorators
**File**: `apps/api/src/modules/line-oa/dto/evidence.dto.ts`  
**Issue**: `BatchApproveEvidenceDto` and `BatchRejectEvidenceDto` have `@IsString({ each: true })` and `@IsOptional()` decorators without Thai `message:` text. Project convention requires Thai messages on all validators.  
**Affected lines**:
```ts
// BatchApproveEvidenceDto
@IsString({ each: true })   // missing message
ids!: string[];

// BatchRejectEvidenceDto  
@IsString({ each: true })   // missing message
ids!: string[];

@IsOptional()               // fine (optional has no message)
@IsString()                 // missing message for reviewNote
reviewNote?: string;
```

---

### ℹ️ Info

#### I-001: Positive — LIFF security hardening (significant improvement)
`chatbot-finance-liff.controller.ts` was previously relying on the client-supplied `lineUserId` from request body. This branch correctly adds `@UseGuards(LiffTokenGuard)` and sources `lineUserId` from `req.liffUserId` (server-verified LINE ID token). This eliminates user impersonation risk. The frontend (`LiffFinanceVerify.tsx`) is updated correspondingly to remove the client-sent `lineUserId`.

#### I-002: Positive — FINANCE_MANAGER role gaps closed
7 controllers now include `FINANCE_MANAGER` in `@Roles()` where it was previously missing: `pdpa`, `pricing-templates`, `products`, `quality-control/inspections`, `suppliers`. This prevents FINANCE_MANAGER users from being blocked on pages they need access to.

#### I-003: Positive — All new endpoints have proper guards
All new controller endpoints checked — `chatbot-finance-admin`, `staff-chat` (file upload endpoint), `line-oa-payment` — have correct `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles()`. Public endpoints (`pay/:token`, `slip-upload`) are intentionally public (token-based auth, rate-limited).

#### I-004: WebSocket CORS `origin: '*'` is pre-existing (not introduced by this branch)
The `StaffChatGateway` CORS wildcard was already in `main`. WebSocket connections are protected by JWT verification in `handleConnection()`. Not a regression.

#### I-005: Dashboard MoM queries are correct
New `dashboard.service.ts` MoM queries properly include `deletedAt: null` and the `branchFilter` spread. Decimal-safe via `computeMoM` returning `number | null`.

#### I-006: `IChatGateway` interface breaks circular dependency cleanly
The new `interfaces/chat-gateway.interface.ts` + `CHAT_GATEWAY_TOKEN` injection token pattern with `@Optional()` is a clean solution to the circular dependency between `ChatEngineModule` and `StaffChatModule`. The `forwardRef()` usage in `chat-engine.module.ts` is appropriate.

---

## Recommendation

```
⚠️  REVIEW — Fix W-001 and W-002 before merge
```

**Blocking**: W-001 (`MessageRole.BOT` → `MessageRole.STAFF`) is a definite logic bug that will display wrong sender in chat history. Must be fixed.

**Strongly recommended**: W-002 (money field as `number` in DTO) — low production risk since Prisma handles conversion, but inconsistent with project convention established in hardening v4.

**Can merge as-is**: W-003 (design tokens) and W-004 (missing Thai messages) — cosmetic/style issues, acceptable in follow-up.

The overall hardening direction in this branch is excellent: LIFF token verification, FINANCE_MANAGER role gaps, DTO typed validation, and Phase 2 WebSocket events are all solid work.
