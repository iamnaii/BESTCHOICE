# Room-Based Chat Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยน chat จาก session-based เป็น room-based (เหมือน LINE/Facebook — 1 ห้อง = 1 ลูกค้า + 1 channel ตลอด) + refactor UI เป็น LINE OA Chat style + เพิ่ม @mention, typing indicator, read receipt ✓✓, pin, cross-channel Customer360

**Architecture:** Rename ChatSession→ChatRoom ทั้ง codebase (~97 files), เปลี่ยน room creation logic (ไม่สร้างใหม่เมื่อ resolve), ลบ session status (OPEN/RESOLVED) → ใช้ ACTIVE/IDLE, refactor Inbox UI เป็น 3 tabs + channel filter

**Tech Stack:** NestJS, Prisma, Socket.io, React, TanStack Query, Radix UI

**Spec:** `docs/superpowers/specs/2026-04-15-room-based-chat-design.md`

**Scope:** ~97 files, ~470 references — แบ่งเป็น 10 tasks ทำตามลำดับ

---

## Refactoring Strategy

เนื่องจากยังไม่มี production data → **drop & recreate**:
1. เปลี่ยน Prisma schema (ChatSession→ChatRoom)
2. Drop old tables + migrate fresh
3. Global find-replace ใน code: ChatSession→ChatRoom, sessionId→roomId, session→room
4. Fix type errors ทีละ module
5. Refactor frontend

**ไม่ต้องทำ backward compatibility** — ยังไม่ได้ใช้จริง

---

## Task 1: Prisma Schema — ChatSession → ChatRoom

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Rename ChatSession → ChatRoom**

Replace the entire `ChatSession` model with `ChatRoom`:
- Rename model: `ChatSession` → `ChatRoom`
- Rename table: `@@map("chat_sessions")` → `@@map("chat_rooms")`
- Remove `sessionStatus` field + `ChatSessionStatus` enum
- Add `ChatRoomStatus` enum: `ACTIVE`, `IDLE`
- Add new field: `status ChatRoomStatus @default(ACTIVE)`
- Add new field: `pinnedAt DateTime? @map("pinned_at")`
- Add new field: `pinnedById String? @map("pinned_by_id")`
- Keep: `unreadCount`, `lastMessageAt`, `totalMessages`, `assignedToId`, `handoffMode`, `leadScore`, `leadTemperature`, `attributionId`
- Keep: all relations (messages, tags, notes, trainingPairs, autoReplyLogs)

- [ ] **Step 2: Update ChatMessage**

- Add `readAt DateTime? @map("read_at")` field
- Rename `sessionId` → `roomId` and `@map("session_id")` → `@map("room_id")`
- Rename relation: `session ChatSession` → `room ChatRoom`

- [ ] **Step 3: Update all models that reference ChatSession**

Search schema for `ChatSession` and rename to `ChatRoom`:
- `ConversationTag.sessionId` → `roomId`
- `ChatNote.sessionId` → `roomId`
- `ChatFeedback.sessionId` → `roomId`
- `ChatSnooze.sessionId` → `roomId`
- `ChatSideMessage.sessionId` → `roomId`
- `AiTrainingPair.sessionId` → `roomId`
- `AiAutoReplyLog.sessionId` → `roomId`
- Any other FK referencing ChatSession

- [ ] **Step 4: Remove old enum, add new**

Remove `ChatSessionStatus` enum (OPEN, PENDING, HANDOFF, RESOLVED, ARCHIVED).
Add:
```prisma
enum ChatRoomStatus {
  ACTIVE
  IDLE
}
```

- [ ] **Step 5: Create fresh migration**

```bash
cd apps/api && npx prisma migrate dev --name room_based_chat_refactor --create-only
```

Review the generated SQL, then apply:
```bash
cd apps/api && npx prisma migrate deploy && npx prisma generate
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat(api): rename ChatSession to ChatRoom — room-based chat schema"
```

---

## Task 2: Backend — chat-engine module rename

**Files to modify:** All files in `apps/api/src/modules/chat-engine/`
- `services/session-manager.service.ts` → rename to `room-manager.service.ts`
- `services/assignment.service.ts`
- `services/handoff-manager.service.ts`
- `services/message-router.service.ts`
- `services/conversation-tag.service.ts`
- `services/chat-cron.service.ts`
- `services/after-hours.service.ts`
- `interfaces/domain-handler.interface.ts`
- `interfaces/chat-gateway.interface.ts`
- `constants/chat-events.ts`
- `chat-engine.module.ts`

- [ ] **Step 1: Rename session-manager.service.ts → room-manager.service.ts**

- Rename file
- Rename class: `SessionManagerService` → `RoomManagerService`
- Rename method: `getOrCreateSession()` → `getOrCreateRoom()`
- Change logic: always reuse existing room (never create new for same user+channel, even if previously "resolved")
- Remove `sessionStatus` references → use `status: ChatRoomStatus`
- Change `prisma.chatSession` → `prisma.chatRoom` everywhere
- Change `sessionId` params → `roomId`

Key change in `getOrCreateRoom()`:
```typescript
// OLD: findFirst with status filter → create new if RESOLVED
// NEW: findFirst WITHOUT status filter → always return existing room
const room = await this.prisma.chatRoom.findFirst({
  where: { externalUserId: params.externalUserId, channel: params.channel, deletedAt: null },
});
if (room) {
  // Reopen if IDLE
  if (room.status === 'IDLE') {
    await this.prisma.chatRoom.update({ where: { id: room.id }, data: { status: 'ACTIVE' } });
  }
  return room;
}
// Only create if truly new customer+channel
return this.prisma.chatRoom.create({ ... });
```

- [ ] **Step 2: Update all other chat-engine services**

Global find-replace in each file:
- `ChatSession` → `ChatRoom`
- `sessionId` → `roomId`
- `session` variable → `room` (careful: only chat session variables, not auth sessions)
- `prisma.chatSession` → `prisma.chatRoom`
- `SessionManagerService` → `RoomManagerService`
- `ChatSessionStatus` → `ChatRoomStatus`

For `chat-cron.service.ts`: remove `autoResolveIdleSessions()` or change to set `status: IDLE` instead of RESOLVED.

For interfaces: update `DomainContext.session` → `DomainContext.room`, `IChatGateway` method params.

- [ ] **Step 3: Update module registration**

In `chat-engine.module.ts`: rename `SessionManagerService` → `RoomManagerService` in providers/exports.

- [ ] **Step 4: Type check**

```bash
./tools/check-types.sh api
```

Fix any remaining type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chat-engine/
git commit -m "feat(api): refactor chat-engine module — session to room"
```

---

## Task 3: Backend — staff-chat module rename

**Files to modify:** All 23 files in `apps/api/src/modules/staff-chat/`

- [ ] **Step 1: Global rename in all staff-chat files**

For every file in `apps/api/src/modules/staff-chat/`:
- `ChatSession` → `ChatRoom`
- `sessionId` → `roomId`
- `prisma.chatSession` → `prisma.chatRoom`
- `SessionManagerService` → `RoomManagerService`
- Controller endpoints: `/sessions/` → `/rooms/`

Key files:
- `staff-chat.gateway.ts` (41 refs) — change WS room names: `chat:session:${id}` → `chat:room:${id}`
- `staff-chat.controller.ts` — change all route paths from `/sessions/:id` to `/rooms/:id`
- All services: update method signatures

- [ ] **Step 2: Add new endpoints to controller**

```typescript
// Pin room
@Post('rooms/:id/pin')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
async pinRoom(@Param('id') id: string, @Req() req: any) { ... }

// Unpin room
@Delete('rooms/:id/pin')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
async unpinRoom(@Param('id') id: string) { ... }

// Mark messages as read
@Post('rooms/:id/read')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
async markAsRead(@Param('id') id: string) { ... }

// Get cross-channel rooms for same customer
@Get('rooms/:id/cross-channel')
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')
async getCrossChannelRooms(@Param('id') id: string) { ... }
```

- [ ] **Step 3: Implement pin/unpin in service**

```typescript
async pinRoom(roomId: string, staffId: string) {
  await this.prisma.chatRoom.update({
    where: { id: roomId },
    data: { pinnedAt: new Date(), pinnedById: staffId },
  });
}

async unpinRoom(roomId: string) {
  await this.prisma.chatRoom.update({
    where: { id: roomId },
    data: { pinnedAt: null, pinnedById: null },
  });
}
```

- [ ] **Step 4: Implement markAsRead**

```typescript
async markAsRead(roomId: string) {
  const now = new Date();
  const updated = await this.prisma.chatMessage.updateMany({
    where: { roomId, role: 'CUSTOMER', readAt: null },
    data: { readAt: now },
  });
  await this.prisma.chatRoom.update({
    where: { id: roomId },
    data: { unreadCount: 0 },
  });
  return { markedCount: updated.count };
}
```

- [ ] **Step 5: Implement getCrossChannelRooms**

```typescript
async getCrossChannelRooms(roomId: string) {
  const room = await this.prisma.chatRoom.findUnique({
    where: { id: roomId },
    select: { customerId: true },
  });
  if (!room?.customerId) return [];

  return this.prisma.chatRoom.findMany({
    where: { customerId: room.customerId, deletedAt: null },
    select: {
      id: true,
      channel: true,
      lastMessageAt: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { text: true, createdAt: true, role: true },
      },
    },
    orderBy: { lastMessageAt: 'desc' },
  });
}
```

- [ ] **Step 6: Type check + commit**

```bash
./tools/check-types.sh api
git commit -m "feat(api): refactor staff-chat module — session to room + pin/read/cross-channel"
```

---

## Task 4: Backend — chatbot-finance + other modules rename

**Files to modify:**
- `apps/api/src/modules/chatbot-finance/` (~12 files with refs)
- `apps/api/src/modules/chat-analytics/` (1 file)
- `apps/api/src/modules/csat/` (2 files)
- `apps/api/src/modules/broadcast/` (1 file)

- [ ] **Step 1: Global rename in all files**

Same pattern as Tasks 2-3:
- `ChatSession` → `ChatRoom`
- `sessionId` → `roomId`
- `prisma.chatSession` → `prisma.chatRoom`
- `SessionManagerService` → `RoomManagerService`

- [ ] **Step 2: Update module imports**

Each module that imports from chat-engine needs updated import paths/names.

- [ ] **Step 3: Type check + commit**

```bash
./tools/check-types.sh api
git commit -m "feat(api): refactor chatbot-finance, analytics, csat — session to room"
```

---

## Task 5: Backend — Update seeds + full API type check

**Files:**
- `apps/api/prisma/seed.ts`
- `apps/api/prisma/seeds/mock-chat.ts`

- [ ] **Step 1: Update seed files**

- `chatSession` → `chatRoom`
- `sessionId` → `roomId`
- Remove `sessionStatus` references
- Add `status: 'ACTIVE'`

- [ ] **Step 2: Full API type check**

```bash
./tools/check-types.sh api
```

Fix ALL remaining type errors. This is the cleanup task.

- [ ] **Step 3: Commit**

```bash
git add apps/api/
git commit -m "feat(api): complete backend session→room rename — 0 type errors"
```

---

## Task 6: Frontend — Rename sessionId → roomId in all components

**Files to modify:** All 10 web files with chat references

- [ ] **Step 1: Global rename in UnifiedInboxPage/**

For every file in `apps/web/src/pages/UnifiedInboxPage/`:
- `sessionId` → `roomId`
- `activeSessionId` → `activeRoomId`
- `session` prop/variable → `room` (where it refers to chat session)
- API endpoints: `/staff-chat/sessions/` → `/staff-chat/rooms/`
- WebSocket: `chat:session:${id}` → `chat:room:${id}`

Key files:
- `index.tsx` (14 refs)
- `hooks/useChatSocket.ts` (12 refs)
- `components/AiSuggestPanel.tsx` (5 refs)
- `components/ProductContextCard.tsx` (5 refs)
- `components/ChatPanel.tsx` (3 refs)
- `components/CommandPalette.tsx` (2 refs)
- `components/ConversationList.tsx` (1 ref)
- `components/Customer360Panel.tsx` (1 ref)

- [ ] **Step 2: Update other pages**

- `ChatbotFinanceLearningPage.tsx` — sessionId → roomId
- `ChatbotFinanceKnowledgePage.tsx` — sessionId → roomId

- [ ] **Step 3: Type check**

```bash
./tools/check-types.sh web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/
git commit -m "feat(web): rename sessionId to roomId in all chat components"
```

---

## Task 7: Frontend — Refactor Inbox (3 tabs + channel filter)

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChannelFilter.tsx`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx`

- [ ] **Step 1: Replace ChannelFilter — remove status tabs**

Remove status tabs (OPEN/PENDING/HANDOFF/RESOLVED/ARCHIVED).
Replace with 3 main tabs + channel filter chips:

Tabs: `ของฉัน` | `ทั้งหมด` | `ยังไม่อ่าน`
Channel chips: `LINE` | `Facebook` | `TikTok` | `Web` (multi-select)

- [ ] **Step 2: Update ConversationList**

- Change filter logic: tabs filter by assignment (mine/all) or unread
- Remove `sessionStatus` filter
- Sort: pinned first → then by lastMessageAt desc
- Use `sortedRooms` with pin priority

- [ ] **Step 3: Update ConversationItem**

- Add PIN icon (📌) when `room.pinnedAt != null`
- Add unread count badge (red circle with number)
- Show last message preview + time/date
- Remove status dot (OPEN/RESOLVED) → replace with unread indicator

- [ ] **Step 4: Type check + commit**

```bash
./tools/check-types.sh web
git commit -m "feat(web): refactor Inbox — 3 tabs, channel filter, pin, unread badge"
```

---

## Task 8: Frontend — ChatPanel features (read receipt + typing)

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx`
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/MessageBubble.tsx`
- Modify: `apps/web/src/pages/UnifiedInboxPage/hooks/useChatSocket.ts`

- [ ] **Step 1: Add read receipt ✓✓ to MessageBubble**

For staff messages, show:
- ✓ (gray) = sent, `readAt === null`
- ✓✓ (blue) = read, `readAt !== null`

```tsx
{message.role === 'STAFF' && (
  <span className={cn('text-[10px] ml-1', message.readAt ? 'text-blue-400' : 'text-gray-400')}>
    {message.readAt ? '✓✓' : '✓'}
  </span>
)}
```

- [ ] **Step 2: Auto mark as read when opening room**

In ChatPanel or index.tsx, when user opens a room:
```typescript
useEffect(() => {
  if (activeRoomId) {
    api.post(`/staff-chat/rooms/${activeRoomId}/read`).catch(() => {});
  }
}, [activeRoomId]);
```

- [ ] **Step 3: Add typing indicator**

In useChatSocket, listen for `TYPING` event:
```typescript
socket.on('TYPING', (data) => {
  if (data.roomId === activeRoomId && data.role === 'CUSTOMER') {
    setIsCustomerTyping(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => setIsCustomerTyping(false), 5000);
  }
});
```

In ChatPanel, show typing indicator above input:
```tsx
{isCustomerTyping && (
  <div className="px-4 py-1.5 text-[12px] text-muted-foreground animate-pulse">
    กำลังพิมพ์...
  </div>
)}
```

- [ ] **Step 4: Add date separators**

Between messages on different days:
```tsx
{showDateSeparator && (
  <div className="flex items-center gap-3 py-3">
    <div className="flex-1 h-px bg-border" />
    <span className="text-[11px] text-muted-foreground">14 เมษายน 2026</span>
    <div className="flex-1 h-px bg-border" />
  </div>
)}
```

- [ ] **Step 5: Type check + commit**

```bash
./tools/check-types.sh web
git commit -m "feat(web): add read receipt, typing indicator, date separators to chat"
```

---

## Task 9: Frontend — Customer360 Panel (cross-channel + MDM + warranty + product)

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx`

- [ ] **Step 1: Add cross-channel rooms section**

Call `GET /staff-chat/rooms/:id/cross-channel` → display:

```tsx
<SectionHeader icon={MessageSquare} label="ห้องแชททั้งหมด" />
{crossChannelRooms.map((r) => (
  <button key={r.id} onClick={() => onSelectRoom(r.id)} className="...">
    <ChannelIcon channel={r.channel} />
    <div>
      <p className="text-[12px] truncate">{r.messages[0]?.text ?? '...'}</p>
      <p className="text-[10px] text-muted-foreground">
        {format(new Date(r.lastMessageAt), 'dd MMM HH:mm', { locale: th })}
      </p>
    </div>
    {r.id === activeRoomId && <Badge variant="primary" className="text-[9px]">กำลังคุย</Badge>}
  </button>
))}
```

- [ ] **Step 2: Add MDM history section**

Show current MDM lock status from contract:

```tsx
<SectionHeader icon={Smartphone} label="สถานะ MDM" />
{contract?.mdmLockedAt ? (
  <div className="text-red-600 text-[12px]">
    🔒 ล็อคอยู่ ตั้งแต่ {format(contract.mdmLockedAt, 'dd MMM yyyy')}
  </div>
) : (
  <div className="text-green-600 text-[12px]">🔓 ไม่ได้ล็อค</div>
)}
```

- [ ] **Step 3: Add warranty section**

Show from product.warrantyExpireDate:

```tsx
<SectionHeader icon={Shield} label="การรับประกัน" />
{product?.warrantyExpireDate ? (
  <div className="text-[12px]">
    {isPast(product.warrantyExpireDate)
      ? <span className="text-red-600">❌ หมดประกัน {format(product.warrantyExpireDate, 'dd MMM yyyy')}</span>
      : <span className="text-green-600">✅ ถึง {format(product.warrantyExpireDate, 'dd MMM yyyy')} (เหลือ {daysRemaining} วัน)</span>
    }
  </div>
) : <p className="text-[12px] text-muted-foreground">ไม่มีข้อมูลประกัน</p>}
```

- [ ] **Step 4: Move ProductContextCard to permanent section**

Already exists — just ensure it's always visible (not conditional).

- [ ] **Step 5: Type check + commit**

```bash
./tools/check-types.sh web
git commit -m "feat(web): add cross-channel rooms, MDM status, warranty to Customer360"
```

---

## Task 10: Frontend — @mention in Internal Notes + Final cleanup

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` (notes section)
- Full type check

- [ ] **Step 1: Add @mention in notes**

In the notes input area, detect `@` character → show dropdown of online staff:
- Fetch staff list: `GET /staff-chat/staff/online`
- Filter by typed name
- Select → insert `@staffName` in note text
- On save note → backend detects `@mentions` → send notification

Keep it simple: regex `/@(\w+)/g` to extract mentions, POST notification to mentioned staff via WebSocket.

- [ ] **Step 2: Full type check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors API + Web.

- [ ] **Step 3: Final commit + push**

```bash
git add .
git commit -m "feat: Room-Based Chat Refactor — persistent rooms, LINE OA style UI, @mention, read receipt, typing, pin, cross-channel"
git push
```

---

## Verification

1. **TypeScript**: `./tools/check-types.sh all` — 0 errors
2. **Inbox**: 3 tabs work (ของฉัน/ทั้งหมด/ยังไม่อ่าน) + channel filter
3. **Room persistence**: ลูกค้าทักมา → สร้างห้อง → ตอบ → ห้องยังอยู่ → ลูกค้าทักอีก → เข้าห้องเดิม
4. **Pin**: กด pin → ห้องอยู่ด้านบน → กด unpin → กลับเรียงปกติ
5. **Read receipt**: เปิดห้อง → ข้อความ mark as read → ✓✓ สีฟ้า
6. **Typing**: ลูกค้าพิมพ์ → "กำลังพิมพ์..." แสดง
7. **Cross-channel**: ลูกค้าทัก LINE + FB → เปิดห้อง LINE → ด้านขวาเห็นห้อง FB + ข้อความล่าสุด + วันเวลา
8. **MDM status**: ลูกค้ามีสัญญาค้าง + เครื่องล็อค → แสดง 🔒 + วันที่ล็อค
9. **Warranty**: แสดงวันหมดประกัน + เหลือกี่วัน
10. **@mention**: พิมพ์ `@` → เห็น dropdown → เลือก → ส่ง note → คนถูก mention ได้ notification
