# Merge Guard Report — feat/inbox-avatar-fallback-and-customer-link

**Date**: 2026-05-24  
**Branch**: `feat/inbox-avatar-fallback-and-customer-link`  
**Author**: Akenarin Kongdach  
**Reviewed against**: `origin/main`

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/chat-engine/services/room-manager.service.ts` | +34 lines — new `linkCustomer()` method |
| `apps/api/src/modules/staff-chat/staff-chat.controller.ts` | +13 lines — new `PATCH /rooms/:id/customer` endpoint |
| `apps/web/src/lib/avatar.ts` | +14 lines — new utility (new file) |
| `apps/web/src/pages/CustomersPage.tsx` | +40 lines — prefill + auto-link flow |
| `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` | +5 lines — avatar fallback |
| `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx` | +5 lines — avatar fallback |
| `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` | +72 lines — no-customer empty state with CTA |
| `apps/web/src/pages/UnifiedInboxPage/index.tsx` | +7 lines — pass `session` prop |

**Total**: 8 files changed, ~188 insertions, 6 deletions

---

## Purpose

Two related features:

1. **Avatar fallback** — when a chat contact has no profile picture (common for Facebook PSIDs before Messenger App Review passes), generate a deterministic DiceBear avatar seeded on `session.id`.
2. **Link-customer-from-chat flow** — staff can click "สร้างลูกค้าจากแชทนี้" in the Customer360Panel empty state, which pre-fills the customer creation form and automatically links the new customer record back to the originating chat room via `PATCH /staff-chat/rooms/:id/customer`.

---

## Critical Issues

_None._

---

## Warning Issues

### W-1 — `linkCustomer`: soft-delete check not in WHERE clause (convention)
**File**: `apps/api/src/modules/chat-engine/services/room-manager.service.ts` ~line 296  
**Severity**: Warning

```typescript
// Current (manual check after fetch — does not follow convention)
const room = await this.prisma.chatRoom.findUnique({
  where: { id: roomId },
  select: { id: true, customerId: true, deletedAt: true },
});
if (!room || room.deletedAt) { ... }
```

Project convention (`database.md`) requires `deletedAt: null` in the `where` clause, not a manual post-fetch check. Functionally correct but inconsistent with every other service. Same pattern repeated 12 lines later for the `customer.findUnique` call.

**Suggested fix**:
```typescript
const room = await this.prisma.chatRoom.findUnique({
  where: { id: roomId, deletedAt: null },
  select: { id: true, customerId: true },
});
if (!room) { throw new Error('ห้องแชทไม่พบหรือถูกลบ'); }
```

---

### W-2 — New endpoint body validated manually instead of via DTO
**File**: `apps/api/src/modules/staff-chat/staff-chat.controller.ts` ~line 172  
**Severity**: Warning

```typescript
@Patch('rooms/:id/customer')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
async linkCustomerToRoom(
  @Param('id') id: string,
  @Body('customerId') customerId: string,
) {
  if (!customerId || typeof customerId !== 'string') {
    throw new BadRequestException('กรุณาระบุ customerId');
  }
```

Convention (`backend.md`) requires a class-validator DTO for all request bodies. The manual guard works but bypasses the global `ValidationPipe`. A plain DTO would also validate UUID format and auto-document in Swagger.

**Suggested fix**: Create `dto/link-customer.dto.ts` with `@IsUUID() @IsNotEmpty() customerId: string` and use `@Body() dto: LinkCustomerDto`.

---

### W-3 — DiceBear third-party dependency for avatar generation
**File**: `apps/web/src/lib/avatar.ts` line 12  
**Severity**: Warning

```typescript
return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
```

The function sends `session.id` (an internal UUID) to a public third-party CDN on every avatar render. Concerns:

- **External dependency**: avatars unavailable if DiceBear has an outage (cosmetic only — broken `<img>` is non-blocking).
- **Info leakage**: internal room UUIDs are sent to a third-party service on each render. The UUID is not PII but it is an internal identifier.
- **CSP**: if the app adds a `Content-Security-Policy: img-src` header in future, `api.dicebear.com` must be allow-listed.

Mitigation options (not blocking merge): (a) add an `onError` fallback to `<img>` rendering an initial-letter avatar in CSS; (b) self-host DiceBear via their npm package `@dicebear/collection`. For now, document the external dependency.

---

## Info

| # | Location | Note |
|---|----------|------|
| I-1 | `CustomersPage.tsx:186` | `useEffect` with `// eslint-disable-next-line react-hooks/exhaustive-deps` — intentional mount-only pattern, acceptable here since URL params are consumed on page load only. |
| I-2 | `Customer360Panel.tsx:356–416` | No-customer CTA state is 60+ lines inline; could be extracted to a named sub-component for readability, but not required for merge. |
| I-3 | `CustomersPage.tsx:290–304` | `onSuccess` is now `async` for sequential `api.patch` call. React Query does not re-throw errors from `onSuccess`, so the inner `try/catch` correctly surfaces errors via `toast.error`. Pattern is safe. |

---

## Checklist

- [x] `StaffChatController` class-level `@UseGuards(JwtAuthGuard, RolesGuard)` confirmed present
- [x] New endpoint has `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')`
- [x] Frontend uses `api.patch()` from `@/lib/api` (not raw `fetch`)
- [x] `queryClient.invalidateQueries()` called after successful link (`['chat-room', roomId]`)
- [x] No money fields, no `Number()` on Decimal
- [x] `Button variant="primary"` is a valid custom variant in this project's shadcn/ui config
- [x] Thai validation messages present in new service `throw new Error(...)` calls
- [ ] W-1: `deletedAt: null` missing from Prisma WHERE clauses in `linkCustomer`
- [ ] W-2: Missing DTO class for `linkCustomerToRoom` request body
- [ ] W-3: Third-party DiceBear dependency — document or mitigate

---

## Recommendation

**REVIEW** — Two convention issues (W-1, W-2) should be addressed before merge. W-3 (DiceBear) is low-risk but worth documenting. No security blockers.
