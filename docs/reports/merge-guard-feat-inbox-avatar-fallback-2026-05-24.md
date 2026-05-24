# Merge Guard Report — feat/inbox-avatar-fallback-and-customer-link

**Date**: 2026-05-24  
**Branch**: `feat/inbox-avatar-fallback-and-customer-link`  
**Author**: Akenarin Kongdach  
**Commit**: `e36c0cb1` — feat(inbox): generated avatar fallback + link-customer-from-chat flow  
**Files Changed**: 8 files, +188 / −6 lines

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/chat-engine/services/room-manager.service.ts` | New `linkCustomer()` method — validates both room and customer soft-delete, guards against relinking to a different customer |
| `apps/api/src/modules/staff-chat/staff-chat.controller.ts` | New `PATCH rooms/:id/customer` endpoint with `@Roles(OWNER, BM, FM, SALES)` |
| `apps/web/src/lib/avatar.ts` | New DiceBear fallback avatar utility |
| `apps/web/src/pages/CustomersPage.tsx` | Auto-open create-customer modal from chat-room CTA (`?new=1&name=&fromRoomId=` params); post-create auto-link + navigate to inbox |
| `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` | Use `getGeneratedAvatarUrl` as avatar fallback |
| `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx` | Same DiceBear fallback for conversation list avatars |
| `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` | Rich empty-state when no customer is linked — shows avatar, channel badge, "สร้างลูกค้าจากแชทนี้" CTA button |
| `apps/web/src/pages/UnifiedInboxPage/index.tsx` | Passes `session` prop to `Customer360Panel` for the new empty state |

---

## Critical Issues

**None found.**

- New `PATCH rooms/:id/customer` endpoint has `@Roles()` decorator and is covered by the class-level `@UseGuards(JwtAuthGuard, RolesGuard)` at line 52 of the controller ✓  
- `linkCustomer()` checks `deletedAt` on both `ChatRoom` and `Customer` records ✓  
- No `Number()` on money fields ✓  
- No hardcoded secrets ✓  
- No raw `$queryRaw` ✓  

---

## Warning Issues

### W1 — No audit log on `linkCustomer()` (room-manager.service.ts)
Linking a customer to a chat room is a customer-data association that affects the customer 360 view and could surface PII from that customer to all staff who have access to the room. The `linkCustomer()` service method writes no `AuditLog` entry. Every other customer-data mutation in this codebase emits an audit event. This creates a gap in the PDPA data-access trail.

**Fix**: Add `this.audit.log({ action: 'CUSTOMER_LINKED_TO_CHAT_ROOM', entity: 'chat_room', entityId: roomId, newValue: { customerId }, userId })` inside `linkCustomer()`. The controller already has `@Req() req` available on other methods — thread `userId` down.

### W2 — `getGeneratedAvatarUrl` calls external DiceBear API from browser
`apps/web/src/lib/avatar.ts` generates URLs pointing at `https://api.dicebear.com`. In a production app handling PII, passing the chat room's `session.id` (a UUID) as a seed to a third-party avatar service leaks the session identifier to DiceBear's CDN logs. The comment in the file acknowledges the external service but does not address this concern.

**Fix (low-urgency)**: Consider seeding with a non-identifying hash (e.g. `sha256(session.id).slice(0,8)`) or self-hosting DiceBear. For now, a code comment noting this tradeoff is acceptable if the owner accepts the risk.

### W3 — `linkCustomerToRoom` uses `@Body('customerId')` without DTO class-validator
The new endpoint reads `customerId` directly from the request body via `@Body('customerId') customerId: string`. The only validation is a manual `if (!customerId || typeof customerId !== 'string')` check in the controller. The project convention is to validate input through DTO classes with class-validator decorators. The manual check is adequate functionally but inconsistent with the codebase pattern.

**Fix**: Create a `LinkCustomerDto` with `@IsUUID()` and `@IsNotEmpty({ message: 'กรุณาระบุ customerId' })`.

---

## Info Issues

### I1 — `eslint-disable-next-line react-hooks/exhaustive-deps` comment in CustomersPage.tsx
The `useEffect` that reads `searchParams` on mount suppresses the exhaustive-deps rule. The effect correctly only runs once (empty deps), but the suppression comment is a lint smell. Acceptable for a "run once on mount" effect with a clear comment.

### I2 — `Button variant="primary"` in Customer360Panel.tsx
The new CTA button uses `variant="primary"`. Verify this variant token is defined in the shadcn/ui theme — `variant="default"` is the conventional name in shadcn. If `primary` is a custom alias, this is fine; if not, it will silently fall back to a default style.

---

## Recommendation

**REVIEW** — No critical security issues. Two warnings are meaningful: the missing audit log (W1) is a PDPA gap for a customer-data association action, and the DiceBear external call (W2) leaks session IDs to a third party. The DTO pattern violation (W3) is a minor consistency issue. Recommend fixing W1 (audit log) and noting W2 as a known tradeoff before merging.
