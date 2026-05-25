# Pre-Merge Guard Report — 2026-05-25-v3

**Generated**: 2026-05-25  
**Reviewer**: Pre-Merge Guard Agent  
**Branches reviewed**: 3 (most recently pushed non-guard/watchdog feature branches)

---

## Branch 1: `feat/canned-response-channel-tabs`

**Author**: Akenarin Kongdach  
**Latest commit**: `fix(canned-response): Phase 2b — review issues C/W1/W2 channel tabs`  
**Pushed**: 2026-05-25 13:08 +07

### File Changes Summary
| File | +Lines | -Lines |
|------|--------|--------|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +86 | -20 |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 | new |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17 | -4 |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 | new |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 | new |

**Total**: 5 files, ~277 insertions, ~24 deletions

### Issues Found

**Critical**: None

**Warning**: None

**Info**:
- `BubbleList.tsx` passes `onCountsChange` in a `useEffect` dependency array. Since the caller (`TemplateEditorPane`) passes `setBubbleCounts` (a React state setter), which is identity-stable, no infinite re-render can occur. Flagged for awareness only.
- `bubble-reorder-logic.ts` is 31 lines with 100 lines of tests — good coverage ratio.

### Checklist
- [x] No raw `fetch()` — uses `api.get()` / `api.post()`
- [x] `queryClient.invalidateQueries()` called after all mutations
- [x] Design tokens only (bg-primary, bg-muted, text-muted-foreground, border-border) — no hardcoded hex
- [x] `leading-snug` used on all Thai text containers
- [x] `toast.error()` from sonner for errors
- [x] Reorder logic extracted to testable pure function
- [x] `aria-pressed` on tab buttons (a11y)
- [x] No backend changes

### Recommendation: ✅ APPROVE

Pure frontend feature; no security surface; well-tested; follows all frontend rules.

---

## Branch 2: `feat/canned-response-postback-routing`

**Author**: Akenarin Kongdach  
**Latest commit**: `fix(canned-response): Phase 5 — review issues C1/C2/W4/W5/W6/W7`  
**Pushed**: 2026-05-25 13:02 +07

### File Changes Summary
| File | Type | Notes |
|------|------|-------|
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.ts` | new | Core router service |
| `apps/api/src/modules/staff-chat/services/quick-reply-postback-router.service.spec.ts` | new | 165-line test suite |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts` | modified | `staffId: string | null`, `getSystemUserId()` |
| `apps/api/src/modules/staff-chat/services/canned-response-sender.service.spec.ts` | modified | +4 test cases for null staffId path |
| `apps/api/src/modules/staff-chat/staff-chat.module.ts` | modified | Register + export `QuickReplyPostbackRouterService` |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | modified | Wire postback router |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | modified | Update mocks |
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | modified | `forwardRef(() => StaffChatModule)` |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts` | modified | Wire postback router |
| `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.spec.ts` | modified | Update mocks |
| `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` | modified | Wire postback router |
| `apps/api/src/modules/line-oa/line-oa.module.ts` | modified | `forwardRef(() => StaffChatModule)` |
| `apps/web/src/pages/CannedResponseAdminPage.tsx` | modified | Pass `allTemplates` prop |
| `apps/web/src/pages/canned-response-admin/QuickReplyEditor.tsx` | modified | Template picker UI |

**Total**: 15 files, ~701 insertions, ~22 deletions

### Issues Found

**Critical**: None

**Warning**:

#### W1 — Missing `if (userId)` guard in `line-oa-chatbot.controller.ts`

**File**: `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts`  
**Location**: `handlePostback()` method, new Phase 5 block

```ts
// Current (missing guard):
const userId = event.source.userId;  // can be undefined for group/room events
try {
  const room = await this.prisma.chatRoom.findUnique({
    where: {
      lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_SHOP },
    },
```

The equivalent block in `chatbot-finance.service.ts` correctly guards with `if (userId) {` before the try/catch. When a LINE group/room postback fires without a `userId`, Prisma receives `undefined` for the `lineUserId` field and throws a validation error — caught by the try/catch and logged as a spurious warning. Functionally non-crashing, but inconsistent and noisy.

**Fix**: Wrap the postback router block in `if (userId) { ... }` matching the finance service pattern.

```ts
// Should be:
const userId = event.source.userId;
const data = event.postback.data;

if (userId) {  // ← add this guard
  try {
    const room = await this.prisma.chatRoom.findUnique({ ... });
    ...
  } catch (err) { ... }
}

const params = new URLSearchParams(data);
```

#### W2 — System user password stored as plain text

**File**: `apps/api/src/modules/staff-chat/services/canned-response-sender.service.ts`  
**Method**: `getSystemUserId()`

```ts
create: {
  email: 'system@bestchoice.internal',
  password: 'NEVER_LOGIN_SYSTEM_USER',  // plain text, not bcrypt
  ...
  isActive: false,
},
```

The password field conventionally stores bcrypt hashes. While `isActive: false` blocks login and the bcrypt compare would reject this plaintext anyway, it breaks field-level consistency. Should use a bcrypt hash of a random secret or a known-invalid hash string (`$2b$10$invalid...`).

**Note**: This may be an already-established pattern inherited from the `collections-foundation.seed`. If the seed already creates this user with a plaintext password, adding `update: {}` in the upsert means the DB value is never changed — existing deployments are unaffected. Low severity.

**Info**:
- `QuickReplyPostbackRouterService` rate-limits at 5 sends per 10s per room (in-memory). Correctly noted in comments as per-process — acceptable for a defensive guard.
- `forwardRef()` used on three module imports to break circular dependency cycles. Correct NestJS pattern.
- All three webhook paths (LINE_FINANCE, LINE_SHOP, FACEBOOK) have try/catch with fall-through — service failures cannot block message delivery.
- System bot role is `SALES` (minimum) — correctly avoids appearing in OWNER-only queries.
- `TEMPLATE:<id>` payload parsing trims whitespace before lookup.

### Checklist
- [x] No new unguarded controllers (webhook controllers intentionally public per security.md)
- [x] No `Number()` on money fields — no financial arithmetic in new code
- [x] All new DB queries have `deletedAt: null` (`chatRoom.findFirst/findUnique` with `deletedAt: null`)
- [x] No hardcoded secrets or API keys
- [x] No SQL injection (`findUnique`/`findFirst` only, no `$queryRaw`)
- [x] `QuickReplyPostbackRouterService` has 165 lines of tests (rate-limit, loop guard, error paths)
- [x] `canned-response-sender.service.spec.ts` has 4 new tests for null staffId path
- [ ] **W1**: Missing `if (userId)` guard in `line-oa-chatbot.controller.ts` (line ~534)
- [ ] **W2**: Plain text password in `getSystemUserId()` — minor, see note above

### Recommendation: 🔶 REVIEW

Fix W1 before merge (5-line change). W2 is low-severity — fix preferred but can follow up.

---

## Branch 3: `feat/data-deletion-page`

**Author**: Akenarin Kongdach  
**Latest commit**: `feat(privacy): add public /privacy/data-deletion instructions page (#1093)`  
**Pushed**: 2026-05-25 (as part of multi-branch stack)

### File Changes Summary
| File | +Lines | Notes |
|------|--------|-------|
| `apps/web/src/App.tsx` | +2 | New lazy route `/privacy/data-deletion` |
| `apps/web/src/pages/DataDeletionPage.tsx` | +123 | Static public page |

**Total**: 2 files, 125 insertions

### Issues Found

**Critical**: None  
**Warning**: None  

**Info**:
- Page is intentionally public (no `ProtectedRoute` wrapper) — correct for Meta's Data Deletion Instructions URL requirement.
- Uses `lazy()` import — correct per frontend rules.
- Design tokens throughout (bg-background, text-foreground, text-muted-foreground, bg-muted, border-border) — no hardcoded colors.
- `leading-snug` on all Thai text — correct.
- Date `24 พฤษภาคม 2569` is hardcoded in static content (expected for legal/privacy pages).
- `akenarin.ak@gmail.com` is the owner's personal email used as the PDPA contact — business decision, not a code issue.

### Checklist
- [x] No auth required (correct — Meta verification hits this URL unauthenticated)
- [x] No API calls (fully static)
- [x] Design tokens only
- [x] Lazy-loaded route
- [x] No backend changes
- [x] Links to `/privacy` for full policy

### Recommendation: ✅ APPROVE

Minimal static page, zero security surface, correct implementation for Meta App Review compliance.

---

## Summary

| Branch | Files | Insertions | Critical | Warning | Info | Decision |
|--------|-------|-----------|---------|---------|------|----------|
| `feat/canned-response-channel-tabs` | 5 | 277 | 0 | 0 | 1 | ✅ APPROVE |
| `feat/canned-response-postback-routing` | 15 | 701 | 0 | 2 | 4 | 🔶 REVIEW |
| `feat/data-deletion-page` | 2 | 125 | 0 | 0 | 0 | ✅ APPROVE |

### Action Required Before Merge of `feat/canned-response-postback-routing`

**W1 — Must fix**: Add `if (userId)` guard in `line-oa-chatbot.controller.ts` `handlePostback()`:

```ts
if (userId) {
  try {
    const room = await this.prisma.chatRoom.findUnique({
      where: { lineUserId_channel: { lineUserId: userId, channel: ChatChannel.LINE_SHOP } },
      select: { id: true },
    });
    if (room) {
      const routeResult = await this.postbackRouter.route(room.id, data);
      if (routeResult.handled) {
        // log + return
        return;
      }
    }
  } catch (err) {
    // log + fall through
  }
}
```

**W2 — Preferred fix**: Replace `password: 'NEVER_LOGIN_SYSTEM_USER'` with a valid bcrypt hash or known-invalid sentinel (`$2b$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`).
