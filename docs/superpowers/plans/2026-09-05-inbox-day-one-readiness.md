# Inbox Day-one Readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้ทีม 8 คนเปิด `/inbox` วันแรกแล้วเห็น "ใครรอเราอยู่" เป็นตัวเลขที่เชื่อได้ ตอบจากหน้านี้ได้ และห้องมีเจ้าของจากการตอบจริง

**Architecture:** เพิ่มคอลัมน์เดียว `ChatRoom.waitingSince` ที่ตั้งเมื่อข้อความลูกค้าเข้ามา และล้างได้เฉพาะเมื่อคำตอบจาก "คน" ถึงลูกค้าแล้ว (ส่งสำเร็จจาก inbox / echo จาก Page Inbox / ปิดแชท) · เลิกแจกห้องอัตโนมัติ เปลี่ยนเป็นรับเรื่องเมื่อคำตอบถึงลูกค้า ด้วย `updateMany` แบบมีเงื่อนไข · หน้าเว็บเพิ่มแท็บ "รอตอบ" เป็นค่าเริ่มต้น เวลารอบนแถว ลิงก์ห้องใน URL และคำอธิบายเมื่อส่งล้ม · adapter Facebook ลองส่งซ้ำด้วยแท็ก HUMAN_AGENT หลังสวิตช์

**Tech Stack:** NestJS + Prisma (PostgreSQL) · jest (`--runInBand`) · React + TanStack Query + react-router + Tailwind/shadcn · vitest · date-fns

**Spec:** `docs/superpowers/specs/2026-09-05-inbox-day-one-readiness-design.md`

## Global Constraints

- **หลักการเดียว (สเปก §3):** "รอตอบ" ล้างได้ด้วยคำตอบจาก **คน** ที่ **ถึงลูกค้าแล้ว** เท่านั้น — `saveMessage` ไม่ล้าง · BOT/SYSTEM ไม่ล้าง · การส่งที่ล้ม/การเปิดอ่าน ไม่ล้าง
- Migration ใหม่ต้องเป็น `20261000300000_chat_room_waiting_since` (ล่าสุดในโฟลเดอร์คือ `20261000200000_sale_shop_warranty`)
- boolean ใน query DTO ต้องใช้ `@Transform(({ value }) => value === true || value === 'true')` ห้าม `@Type(() => Boolean)` (`Boolean('false') === true`)
- เทสต์ api รันด้วย `npm --prefix apps/api test -- <path>` (jest `--runInBand --forceExit`) · เทสต์ web รันด้วย `npm --prefix apps/web test -- <path>` (vitest) · typecheck `./tools/check-types.sh web` และ `./tools/check-types.sh api`
- ทุก deploy ของ web ต้อง bump `"version"` ใน `apps/web/package.json` (รูปแบบ `YY.M.ลำดับ`)
- ห้ามแตะ: สี/ฟอนต์/ระยะ · แผง 360 · composer · `unreadCount` semantics · `handoffMode` · `firstResponseAt`
- Commit message ภาษาไทย ลงท้ายด้วย `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` · ทำงานบน branch `feat/inbox-day-one-readiness` (แตกจาก origin/main แล้ว มีสเปก commit อยู่)
- ห้ามรัน CLI ล้างข้อมูล (Task 9) กับฐานใดโดยไม่มี `CONFIRM_BACKFILL` · บน prod ต้องรันทันทีหลัง deploy PR1 และก่อนทีมเริ่มตอบ (สเปก §6)

---

## File Structure

**PR1 — หลังบ้าน (Tasks 1-10)**
| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/prisma/schema.prisma` (แก้) | เพิ่ม `waitingSince` บน `ChatRoom` |
| `apps/api/prisma/migrations/20261000300000_chat_room_waiting_since/migration.sql` (สร้าง) | คอลัมน์ + index |
| `apps/api/src/modules/chat-engine/services/room-manager.service.ts` (แก้) | ตั้ง waiting ใน `saveMessage` · ล้างใน `markOutboundSent` · `clearWaiting()` · `listRooms` filter/sort · `getRoomBadgeCounts.waiting` · ตัด autoAssign ใน `createRoom` |
| `apps/api/src/modules/chat-engine/services/message-router.service.ts` (แก้) | `mirrorOutbound` STAFF ล้าง waiting · `sendStaffMessage` รับเรื่องหลังส่งสำเร็จ |
| `apps/api/src/modules/chat-engine/services/assignment.service.ts` (แก้) | `claimIfUnassigned()` · `resolve` ล้าง waiting |
| `apps/api/src/modules/chat-engine/services/chat-cron.service.ts` (แก้) | `markIdleRooms` ยกเว้นห้องที่ลูกค้ารอ |
| `apps/api/src/modules/chat-engine/dto/session-query.dto.ts` (แก้) | query `waiting` |
| `apps/api/src/modules/staff-chat/staff-chat.controller.ts` (แก้) | ส่ง `waiting` เข้า listRooms |
| `apps/api/src/cli/reset-inbox-day-one.cli.ts` (สร้าง) + `apps/api/package.json` (แก้) | ล้างข้อมูลครั้งเดียว dry-run เป็นค่าเริ่มต้น |
| specs ที่แตะ: `room-manager.service.spec.ts` · `message-router.service.spec.ts` · `assignment.service.spec.ts` · `chat-cron.service.spec.ts` (ใหม่) · `reset-inbox-day-one.cli.spec.ts` (ใหม่) | |

**PR2 — หน้าเว็บ (Tasks 11-16)**
| ไฟล์ | หน้าที่ |
|---|---|
| `apps/web/src/lib/chat-time.ts` (+test) | `formatWaitDuration` |
| `apps/web/src/pages/UnifiedInboxPage/components/ChannelFilter.tsx` | แท็บ "รอตอบ" |
| `apps/web/src/pages/UnifiedInboxPage/components/tab-counts.ts` (+test) | นับ waiting (fallback) |
| `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx` | ป้าย "รอ …" |
| `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx` | จอว่าง "ตอบครบทุกคนแล้ว" |
| `apps/web/src/pages/UnifiedInboxPage/components/fb-window.ts` (+test) | `fbWindowState`, `fbWindowHoursLeft` |
| `apps/web/src/pages/UnifiedInboxPage/components/send-error.ts` (+test) | `describeSendError` |
| `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` | แถบเตือน 24 ชม. · เหตุผลในฟองแดง |
| `apps/web/src/pages/UnifiedInboxPage/index.tsx` | แท็บเริ่มต้น · param `waiting` · deep link · reason |
| `apps/web/src/App.tsx` | route `/inbox/:roomId` |
| `apps/web/package.json` | bump version |

**PR3 — adapter (Task 17)**
| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/src/modules/chat-engine/interfaces/channel-adapter.interface.ts` | `SendResult.errorCode` |
| `apps/api/src/modules/chat-adapters/facebook.adapter.ts` (+spec ใหม่) | `parseGraphError` · retry ด้วย HUMAN_AGENT หลังสวิตช์ |
| `apps/api/src/modules/chat-engine/services/message-router.service.ts` | ต่อ `errorCode` เข้า error string |

---

## PR1 — หลังบ้าน

### Task 1: คอลัมน์ `waitingSince` (schema + migration)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (โมเดล `ChatRoom` ราว L5221-5300 — ใต้ `resolvedAt`)
- Create: `apps/api/prisma/migrations/20261000300000_chat_room_waiting_since/migration.sql`

**Interfaces:**
- Produces: `ChatRoom.waitingSince: Date | null` (Prisma field) — ทุก task หลังจากนี้อ้างชื่อนี้

- [ ] **Step 1: เพิ่มฟิลด์ใน schema.prisma**

หาบล็อก `// SLA tracking` ในโมเดล `ChatRoom` (มี `firstResponseAt` และ `resolvedAt`) แล้วเพิ่มต่อท้าย `resolvedAt`:

```prisma
  // SLA tracking
  firstResponseAt DateTime? @map("first_response_at")
  resolvedAt      DateTime? @map("resolved_at")
  /// "รอตอบตั้งแต่" — เวลาที่ลูกค้าเริ่มรอคำตอบจาก "คน" (สเปก 2026-09-05-inbox-day-one-readiness §3-§4)
  /// ตั้ง: saveMessage เมื่อข้อความ CUSTOMER เข้ามาและยังว่าง (set-if-null)
  /// ล้าง: markOutboundSent (ส่งสำเร็จจาก inbox) · mirrorOutbound STAFF (echo Page Inbox) · resolve
  /// ไม่ล้าง: BOT/SYSTEM · การส่งที่ล้ม · การเปิดอ่าน (markAsRead)
  waitingSince    DateTime? @map("waiting_since")
```

แล้วในกลุ่ม `@@index(...)` ท้ายโมเดล (ก่อน `@@map("chat_rooms")`) เพิ่ม:

```prisma
  @@index([waitingSince])
```

- [ ] **Step 2: เขียน migration SQL**

```sql
-- "รอตอบตั้งแต่" (สเปก docs/superpowers/specs/2026-09-05-inbox-day-one-readiness-design.md §4)
--
-- วัด prod 2026-09-05: ลูกค้าที่ข้อความสุดท้ายเป็นของลูกค้าและไม่มีใครตอบ 231 ห้อง/30 วัน
-- ถูก cron ซ่อนเป็น IDLE 222 ห้อง เพราะระบบไม่มีข้อมูล "ลูกค้ารอตอบอยู่ตอนนี้" เลย
-- (unread_count ล้างตอนเปิดห้อง · first_response_at ตั้งครั้งเดียวต่อห้อง)
--
-- additive ล้วน: nullable ไม่มี default ⇒ ไม่ rewrite ตาราง · ห้องเก่าทุกห้องเป็น NULL = ไม่ได้รอ
-- ค่าเริ่มต้นสำหรับห้องที่รออยู่จริง ณ วันเปิดใช้ ใส่ด้วย CLI reset-inbox-day-one (ไม่ backfill ใน migration)
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "waiting_since" TIMESTAMP(3);

-- แท็บ "รอตอบ" กรอง waiting_since IS NOT NULL และเรียง waiting_since ASC
CREATE INDEX IF NOT EXISTS "chat_rooms_waiting_since_idx"
  ON "chat_rooms" ("waiting_since");
```

- [ ] **Step 3: generate client + typecheck**

Run: `cd apps/api && npx prisma generate && cd ../.. && ./tools/check-types.sh api`
Expected: generate สำเร็จ · tsc 0 errors (ยังไม่มีใครใช้ฟิลด์)

- [ ] **Step 4: ยืนยันชื่อโฟลเดอร์ migration ไม่ชนและใหม่กว่าตัวล่าสุด**

Run: `ls apps/api/prisma/migrations | tail -3`
Expected: บรรทัดสุดท้ายก่อน `migration_lock.toml` คือ `20261000300000_chat_room_waiting_since`

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261000300000_chat_room_waiting_since/migration.sql
git commit -m "feat(chat): เพิ่มคอลัมน์ chat_rooms.waiting_since — เวลาที่ลูกค้าเริ่มรอคำตอบจากคน

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `saveMessage` ตั้ง `waitingSince` เมื่อข้อความลูกค้าเข้ามา (set-if-null)

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts` — เมธอด `saveMessage` (ราว L293-320 บล็อก `updateData` … `await this.prisma.chatRoom.update`)
- Test: `apps/api/src/modules/chat-engine/services/room-manager.service.spec.ts` — `describe('saveMessage')` (L138)

**Interfaces:**
- Consumes: `ChatRoom.waitingSince` (Task 1)
- Produces: พฤติกรรม "CUSTOMER → `chatRoom.updateMany({ where: { id, waitingSince: null }, data: { waitingSince: msg.createdAt } })`"

- [ ] **Step 1: เพิ่ม `updateMany` ให้ prisma mock ของ spec**

ใน `beforeEach` ของ `room-manager.service.spec.ts` บล็อก `chatRoom: { ... }` เพิ่ม `updateMany: jest.fn().mockResolvedValue({ count: 1 }),` และ `groupBy: jest.fn().mockResolvedValue([]),` (groupBy ใช้ใน Task 7)

- [ ] **Step 2: เขียนเทสต์ที่ต้องล้มก่อน**

เพิ่มท้าย `describe('saveMessage')`:

```ts
    it('CUSTOMER → ตั้ง waitingSince แบบ set-if-null ด้วยเวลาข้อความนั้น (สเปก §4.2)', async () => {
      const createdAt = new Date('2026-09-05T08:00:00.000Z');
      prisma.chatMessage.create.mockResolvedValue({ id: 'm-c', createdAt });
      prisma.chatRoom.update.mockResolvedValue({});

      await service.saveMessage({ roomId: 'room-1', role: MessageRole.CUSTOMER, text: 'สนใจค่ะ' });

      expect(prisma.chatRoom.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-1', waitingSince: null },
        data: { waitingSince: createdAt },
      });
    });

    it('STAFF / BOT → ไม่แตะ waitingSince เลย (ล้างที่ markOutboundSent/mirrorOutbound เท่านั้น)', async () => {
      prisma.chatMessage.create.mockResolvedValue({ id: 'm-s', createdAt: new Date() });
      prisma.chatRoom.findUnique.mockResolvedValue({ firstResponseAt: null });
      prisma.chatRoom.update.mockResolvedValue({});

      await service.saveMessage({ roomId: 'room-1', role: MessageRole.STAFF, text: 'ตอบแล้วค่ะ' });
      await service.saveMessage({ roomId: 'room-1', role: MessageRole.BOT, text: 'บอทตอบ' });

      expect(prisma.chatRoom.updateMany).not.toHaveBeenCalled();
      for (const call of prisma.chatRoom.update.mock.calls) {
        expect(call[0].data).not.toHaveProperty('waitingSince');
      }
    });
```

- [ ] **Step 3: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/room-manager.service.spec.ts -t "waitingSince"`
Expected: FAIL — `updateMany` ไม่ถูกเรียก

- [ ] **Step 4: แก้ `saveMessage`**

หลังบรรทัด `await this.prisma.chatRoom.update({ where: { id: params.roomId }, data: updateData });` และก่อน `return msg;` เพิ่ม:

```ts
    if (params.role === MessageRole.CUSTOMER) {
      // "รอตอบตั้งแต่" (สเปก §4.2) — set-if-null แบบ atomic: เก็บเวลาข้อความ *แรก* ที่ยังไม่ได้ตอบ
      // ไม่ใช่ใบล่าสุด และไม่ต้องอ่านก่อนเขียน (สองข้อความมาพร้อมกันได้ค่าเดียวกัน)
      // ⚠️ ห้ามล้างที่นี่สำหรับ STAFF/BOT — การส่งที่ล้มก็ผ่าน saveMessage (save-before-send)
      await this.prisma.chatRoom.updateMany({
        where: { id: params.roomId, waitingSince: null },
        data: { waitingSince: msg.createdAt },
      });
    }
```

- [ ] **Step 5: รันให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/room-manager.service.spec.ts`
Expected: PASS ทั้งไฟล์ (เทสต์เดิม `saveMessage` 4 ตัวยังผ่าน เพราะ `updateMany` เป็น mock แยกจาก `update`)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/chat-engine/services/room-manager.service.ts apps/api/src/modules/chat-engine/services/room-manager.service.spec.ts
git commit -m "feat(chat): saveMessage ตั้ง waitingSince แบบ set-if-null เมื่อข้อความลูกค้าเข้ามา

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `clearWaiting()` + `markOutboundSent` ล้างเมื่อส่งถึงลูกค้า

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts` — `markOutboundSent` (L334-370)
- Test: `room-manager.service.spec.ts`

**Interfaces:**
- Produces: `RoomManagerService.clearWaiting(roomId: string): Promise<void>` (Task 4 เรียก) · `markOutboundSent` ล้าง waiting ของห้องที่ข้อความนั้นอยู่

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้มก่อน**

เพิ่ม `describe` ใหม่ใน `room-manager.service.spec.ts` (วางถัดจาก `describe('saveMessage')`):

```ts
  describe('clearWaiting / markOutboundSent', () => {
    it('clearWaiting ล้างเฉพาะห้องที่กำลังรออยู่', async () => {
      await service.clearWaiting('room-1');
      expect(prisma.chatRoom.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-1', waitingSince: { not: null } },
        data: { waitingSince: null },
      });
    });

    it('markOutboundSent (ส่งสำเร็จ) → stamp outboundSentAt แล้วล้าง waiting ของห้องนั้น', async () => {
      prisma.chatMessage.update.mockResolvedValue({ id: 'm1', roomId: 'room-9' });

      await service.markOutboundSent('m1', 'mid-1');

      expect(prisma.chatMessage.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { outboundSentAt: expect.any(Date), externalMessageId: 'mid-1' },
      });
      expect(prisma.chatRoom.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-9', waitingSince: { not: null } },
        data: { waitingSince: null },
      });
    });

    it('markOutboundSent ชน P2002 (echo จอง mid ก่อน) → stamp เฉพาะ outboundSentAt และยังล้าง waiting', async () => {
      const dup: any = new Error('dup');
      dup.code = 'P2002';
      prisma.chatMessage.update
        .mockRejectedValueOnce(dup)
        .mockResolvedValueOnce({ id: 'm1', roomId: 'room-9' });

      await service.markOutboundSent('m1', 'mid-dup');

      expect(prisma.chatMessage.update).toHaveBeenLastCalledWith({
        where: { id: 'm1' },
        data: { outboundSentAt: expect.any(Date) },
      });
      expect(prisma.chatRoom.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-9', waitingSince: { not: null } },
        data: { waitingSince: null },
      });
    });
  });
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/room-manager.service.spec.ts -t "clearWaiting"`
Expected: FAIL — `service.clearWaiting is not a function`

- [ ] **Step 3: เพิ่ม `clearWaiting` และแก้ `markOutboundSent`**

แทนที่เมธอด `markOutboundSent` ทั้งตัว (คง jsdoc/คอมเมนต์ยาวเรื่อง P2002 ไว้เหมือนเดิม — เปลี่ยนเฉพาะโค้ด):

```ts
  /**
   * ล้าง "รอตอบ" — เรียกได้เฉพาะเมื่อคำตอบจาก "คน" ถึงลูกค้าแล้ว (สเปก §3 / §4.3):
   *   markOutboundSent (inbox ส่งสำเร็จ) · mirrorOutbound STAFF (echo จาก Page Inbox) · resolve
   * ห้ามเรียกจาก saveMessage / BOT / การส่งที่ล้ม / markAsRead
   */
  async clearWaiting(roomId: string): Promise<void> {
    await this.prisma.chatRoom.updateMany({
      where: { id: roomId, waitingSince: { not: null } },
      data: { waitingSince: null },
    });
  }

  async markOutboundSent(messageId: string, externalMessageId?: string): Promise<void> {
    let roomId: string | undefined;
    try {
      const row = await this.prisma.chatMessage.update({
        where: { id: messageId },
        data: {
          outboundSentAt: new Date(),
          ...(externalMessageId ? { externalMessageId } : {}),
        },
      });
      roomId = row.roomId;
    } catch (err) {
      // (คอมเมนต์เดิมเรื่อง echo webhook / P2002 คงไว้ตรงนี้ทั้งบล็อก)
      if ((err as { code?: string })?.code === 'P2002' && externalMessageId) {
        this.logger.warn(
          `[markOutboundSent] externalMessageId ${externalMessageId} ถูกใช้แล้ว — stamp เฉพาะ outboundSentAt`,
        );
        const row = await this.prisma.chatMessage.update({
          where: { id: messageId },
          data: { outboundSentAt: new Date() },
        });
        roomId = row.roomId;
      } else {
        throw err;
      }
    }
    // ส่งถึงลูกค้าแล้วจริง (ทั้งสองทางด้านบน) → ลูกค้าไม่ได้รออีก
    if (roomId) await this.clearWaiting(roomId);
  }
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/room-manager.service.spec.ts`
Expected: PASS ทั้งไฟล์

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chat-engine/services/room-manager.service.ts apps/api/src/modules/chat-engine/services/room-manager.service.spec.ts
git commit -m "feat(chat): ล้าง waitingSince เมื่อข้อความพนักงานส่งถึงลูกค้าแล้ว (markOutboundSent)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: echo จาก Page Inbox (`mirrorOutbound` STAFF) ล้าง waiting

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.ts` — `mirrorOutbound` (L637-700)
- Test: `apps/api/src/modules/chat-engine/services/message-router.service.spec.ts`

**Interfaces:**
- Consumes: `roomManager.clearWaiting(roomId)` (Task 3)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้มก่อน**

เพิ่ม `describe` ใหม่ท้ายไฟล์ spec (ใช้ `makeRouter` ที่มีอยู่ — เพิ่ม `clearWaiting` ให้ roomManager mock ใน `makeRouter` ก่อน: ในอ็อบเจ็กต์ `roomManager` ของ `makeRouter` เพิ่มบรรทัด `clearWaiting: jest.fn().mockResolvedValue(undefined),`):

```ts
describe('MessageRouterService.mirrorOutbound — echo ล้าง waiting', () => {
  const base = { externalUserId: 'PSID-1', channel: ChatChannel.FACEBOOK, text: 'ตอบจากแอป Facebook' };

  it('echo STAFF → ล้าง waiting ของห้อง (ถึงลูกค้าแล้วโดยนิยาม)', async () => {
    const { router, roomManager } = makeRouter({});
    await router.mirrorOutbound({ ...base, role: MessageRole.STAFF, externalMessageId: 'mid-1' });
    expect(roomManager.clearWaiting).toHaveBeenCalledWith('r1');
  });

  it('BOT (greeting อัตโนมัติของเพจ) → ไม่ล้าง waiting', async () => {
    const { router, roomManager } = makeRouter({});
    await router.mirrorOutbound({ ...base, role: MessageRole.BOT, externalMessageId: 'mid-2' });
    expect(roomManager.clearWaiting).not.toHaveBeenCalled();
  });

  it('echo ซ้ำ (P2002) → ไม่ล้างซ้ำ', async () => {
    const { router, roomManager } = makeRouter({});
    const dup: any = new Error('dup');
    dup.code = 'P2002';
    roomManager.saveMessage.mockRejectedValueOnce(dup);
    await router.mirrorOutbound({ ...base, role: MessageRole.STAFF, externalMessageId: 'mid-1' });
    expect(roomManager.clearWaiting).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/message-router.service.spec.ts -t "mirrorOutbound"`
Expected: FAIL — `clearWaiting` ไม่ถูกเรียก

- [ ] **Step 3: แก้ `mirrorOutbound`**

ใน `mirrorOutbound` หลังบล็อก `try { await this.roomManager.saveMessage({...}) } catch (err) { ... }` และก่อน `this.gateway?.emitNewMessage(...)` เพิ่ม:

```ts
    // echo STAFF = Facebook ยืนยันว่าข้อความจากคนถึงลูกค้าแล้ว → ล้าง "รอตอบ" (สเปก §4.3)
    // BOT (เช่น greeting อัตโนมัติของเพจ) ไม่ล้าง — ลูกค้ายังรอคน (สเปก §3)
    // `?.` เพราะ spec หลายตัว mock roomManager บางส่วน
    if (params.role === MessageRole.STAFF) {
      await this.roomManager.clearWaiting?.(room.id);
    }
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/message-router.service.spec.ts`
Expected: PASS ทั้งไฟล์

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chat-engine/services/message-router.service.ts apps/api/src/modules/chat-engine/services/message-router.service.spec.ts
git commit -m "feat(chat): echo STAFF จาก Page Inbox ล้าง waitingSince (BOT ไม่ล้าง)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `resolve` ล้าง waiting

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/assignment.service.ts` — `resolve` (L180-201)
- Test: `apps/api/src/modules/chat-engine/services/assignment.service.spec.ts` — `describe('resolve')` (L154)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้มก่อน**

เพิ่มใน `describe('resolve')`:

```ts
    it('ปิดแชทโดยไม่ต้องตอบ → ล้าง waitingSince ด้วย (สเปก §4.3)', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue({ id: 'room-1' });
      prisma.chatRoom.update.mockResolvedValue({});
      prisma.staffChatActivity.create.mockResolvedValue({});

      await service.resolve('room-1', 'staff-1');

      expect(prisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: expect.objectContaining({ status: ChatRoomStatus.IDLE, waitingSince: null }),
      });
    });
```

ถ้าเทสต์เดิม `'should resolve room and set resolvedAt'` ใช้ `data: { status, handoffMode, resolvedAt }` แบบตรงตัว ให้เพิ่ม `waitingSince: null` เข้าไปในอ็อบเจ็กต์ที่คาดหวังของเทสต์นั้นด้วย

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/assignment.service.spec.ts -t "resolve"`
Expected: FAIL — data ไม่มี `waitingSince`

- [ ] **Step 3: แก้ `resolve`**

```ts
    await this.prisma.chatRoom.update({
      where: { id: roomId },
      data: {
        status: ChatRoomStatus.IDLE,
        handoffMode: false,
        resolvedAt: new Date(),
        // ปิดแชทโดยไม่ต้องตอบ (ลูกค้าพิมพ์ขอบคุณ) = ออกจากคิว "รอตอบ" (สเปก §4.3)
        waitingSince: null,
      },
    });
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/assignment.service.spec.ts`
Expected: PASS ทั้งไฟล์

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chat-engine/services/assignment.service.ts apps/api/src/modules/chat-engine/services/assignment.service.spec.ts
git commit -m "feat(chat): resolve ล้าง waitingSince — ปิดแชทโดยไม่ต้องตอบออกจากคิวรอตอบ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: cron เลิกซ่อนห้องที่ลูกค้ารอ

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/chat-cron.service.ts` — `markIdleRooms` (L59-72)
- Create: `apps/api/src/modules/chat-engine/services/chat-cron.service.spec.ts`

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้มก่อน**

```ts
import { ChatCronService } from './chat-cron.service';
import { ChatRoomStatus } from '@prisma/client';

describe('ChatCronService.markIdleRooms', () => {
  it('ทำ IDLE เฉพาะห้องที่ไม่มีลูกค้ารอ (waitingSince IS NULL) — สเปก §4.4', async () => {
    const prisma = {
      chatRoom: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const svc = new ChatCronService(prisma as any);

    await svc.markIdleRooms();

    expect(prisma.chatRoom.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ChatRoomStatus.ACTIVE,
          handoffMode: false,
          waitingSince: null,
          deletedAt: null,
        }),
        data: expect.objectContaining({ status: ChatRoomStatus.IDLE }),
      }),
    );
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/chat-cron.service.spec.ts`
Expected: FAIL — where ไม่มี `waitingSince: null`

- [ ] **Step 3: แก้ `markIdleRooms`**

```ts
      const result = await this.prisma.chatRoom.updateMany({
        where: {
          status: ChatRoomStatus.ACTIVE,
          handoffMode: false,
          // ห้องที่ลูกค้ารอคำตอบจากคนอยู่ ห้ามซ่อนเป็น IDLE (วัด prod 2026-09-05: เคยซ่อนไป 222 ห้อง)
          waitingSince: null,
          lastMessageAt: { lt: twentyFourHoursAgo },
          deletedAt: null,
        },
        data: {
          status: ChatRoomStatus.IDLE,
          resolvedAt: now,
        },
      });
```

และแก้ jsdoc ของเมธอดเพิ่มหนึ่งบรรทัด: `* Rooms where a customer is still waiting for a human reply (waitingSince set) are never idled.`

- [ ] **Step 4: รันให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/chat-cron.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/chat-engine/services/chat-cron.service.ts apps/api/src/modules/chat-engine/services/chat-cron.service.spec.ts
git commit -m "fix(chat): cron ไม่ทำ IDLE ห้องที่ลูกค้ายังรอคำตอบ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `listRooms` กรอง/เรียง "รอตอบ" + ตัวนับ + DTO/controller

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts` — `listRooms` (L448-527) · `getRoomBadgeCounts` (L558-579)
- Modify: `apps/api/src/modules/chat-engine/dto/session-query.dto.ts` (ใต้ `unreadOnly` L41-46)
- Modify: `apps/api/src/modules/staff-chat/staff-chat.controller.ts` — `listRooms` (L92-110)
- Test: `room-manager.service.spec.ts`

**Interfaces:**
- Produces: `listRooms({ waiting?: boolean })` · `GET /staff-chat/rooms?waiting=true` · `GET /staff-chat/rooms/counts → { mine, all, unread, waiting, byChannel }` (PR2 Task 12 อ่าน `waiting`)

- [ ] **Step 1: เขียนเทสต์ที่ต้องล้มก่อน**

เพิ่ม `describe` ใหม่ใน `room-manager.service.spec.ts`:

```ts
  describe('listRooms — แท็บรอตอบ', () => {
    beforeEach(() => {
      prisma.chatRoom.findMany.mockResolvedValue([]);
      prisma.chatRoom.count.mockResolvedValue(0);
    });

    it('waiting=true → กรอง waitingSince not null และเรียง waitingSince asc อย่างเดียว', async () => {
      await service.listRooms({ waiting: true });
      const args = prisma.chatRoom.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ deletedAt: null, waitingSince: { not: null } });
      expect(args.orderBy).toEqual([{ waitingSince: 'asc' }]);
    });

    it('ไม่ส่ง waiting → เรียงแบบเดิม (ปักหมุดก่อน แล้ว lastMessageAt)', async () => {
      await service.listRooms({});
      const args = prisma.chatRoom.findMany.mock.calls[0][0];
      expect(args.where).not.toHaveProperty('waitingSince');
      expect(args.orderBy).toEqual([
        { pinnedAt: { sort: 'desc', nulls: 'last' } },
        { lastMessageAt: 'desc' },
      ]);
    });
  });

  describe('getRoomBadgeCounts — waiting', () => {
    it('คืน waiting = จำนวนห้อง waitingSince not null ทั้งบริษัท', async () => {
      // ลำดับ count: all(unread) · mine(unread) · waiting
      prisma.chatRoom.count
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(52);
      prisma.chatRoom.groupBy.mockResolvedValue([{ channel: 'FACEBOOK', _count: { id: 7 } }]);

      const res = await service.getRoomBadgeCounts('staff-1');

      expect(res).toEqual({ mine: 2, all: 7, unread: 7, waiting: 52, byChannel: { FACEBOOK: 7 } });
      expect(prisma.chatRoom.count).toHaveBeenCalledWith({
        where: { deletedAt: null, waitingSince: { not: null } },
      });
    });
  });
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/room-manager.service.spec.ts -t "รอตอบ|waiting"`
Expected: FAIL

- [ ] **Step 3: แก้ `listRooms`**

เพิ่มพารามิเตอร์ใน type ของ `params` (ใต้ `unreadOnly?: boolean;`):

```ts
    /** แท็บ "รอตอบ" — ห้องที่ลูกค้ารอคำตอบจากคน (waitingSince not null) เรียงรอนานสุดก่อน */
    waiting?: boolean;
```

ใต้บรรทัด `if (params.unreadOnly) where.unreadCount = { gt: 0 };` เพิ่ม:

```ts
    if (params.waiting) where.waitingSince = { not: null };
```

แทนที่ `orderBy: [...]` ใน `findMany` ด้วย:

```ts
        // แท็บรอตอบ: รอนานสุดก่อน อย่างเดียว (ปักหมุดไม่มีผล — สเปก §4.5)
        // แท็บอื่น: ปักหมุดก่อน แล้ว lastMessageAt (parity เดิม · priority ไม่ใช่ sort key โดยตั้งใจ)
        orderBy: params.waiting
          ? [{ waitingSince: 'asc' as const }]
          : [
              { pinnedAt: { sort: 'desc' as const, nulls: 'last' as const } },
              { lastMessageAt: 'desc' as const },
            ],
```

- [ ] **Step 4: แก้ `getRoomBadgeCounts`**

```ts
  async getRoomBadgeCounts(staffId?: string): Promise<{
    mine: number;
    all: number;
    unread: number;
    /** ห้องที่ลูกค้ารอคำตอบจากคน — ทั้งบริษัท ไม่ผูกคน (สเปก §4.5) */
    waiting: number;
    byChannel: Record<string, number>;
  }> {
    const unreadWhere: Prisma.ChatRoomWhereInput = { deletedAt: null, unreadCount: { gt: 0 } };
    const [all, mine, waiting, byChannelRaw] = await Promise.all([
      this.prisma.chatRoom.count({ where: unreadWhere }),
      staffId
        ? this.prisma.chatRoom.count({ where: { ...unreadWhere, assignedToId: staffId } })
        : Promise.resolve(0),
      this.prisma.chatRoom.count({ where: { deletedAt: null, waitingSince: { not: null } } }),
      this.prisma.chatRoom.groupBy({
        by: ['channel'],
        where: unreadWhere,
        _count: { id: true },
      }),
    ]);
    const byChannel: Record<string, number> = {};
    for (const g of byChannelRaw) byChannel[g.channel] = g._count.id;
    return { mine, all, unread: all, waiting, byChannel };
  }
```

- [ ] **Step 5: DTO + controller**

`session-query.dto.ts` ใต้ `unreadOnly?: boolean;`:

```ts
  @IsOptional()
  @IsBoolean()
  // แท็บ "รอตอบ" — coerce แบบเดียวกับ unreadOnly (ห้าม @Type(() => Boolean))
  @Transform(({ value }) => value === true || value === 'true')
  waiting?: boolean;
```

`staff-chat.controller.ts` ใน `listRooms` ใต้ `unreadOnly: query.unreadOnly,` เพิ่ม `waiting: query.waiting,`

- [ ] **Step 6: รันให้ผ่าน + typecheck**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/room-manager.service.spec.ts && ./tools/check-types.sh api`
Expected: PASS · tsc 0 errors

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/chat-engine/services/room-manager.service.ts apps/api/src/modules/chat-engine/services/room-manager.service.spec.ts apps/api/src/modules/chat-engine/dto/session-query.dto.ts apps/api/src/modules/staff-chat/staff-chat.controller.ts
git commit -m "feat(chat): แท็บรอตอบ — listRooms?waiting=true เรียงรอนานสุดก่อน + counts.waiting

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: ใครตอบก่อนได้เป็นเจ้าของ (เลิก autoAssign + `claimIfUnassigned`)

**Files:**
- Modify: `apps/api/src/modules/chat-engine/services/assignment.service.ts` — เพิ่มเมธอดหลัง `assign()` (L75)
- Modify: `apps/api/src/modules/chat-engine/services/room-manager.service.ts` — `createRoom` ตัดบล็อก autoAssign (L212-217)
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.ts` — ctor (L37-54) + `sendStaffMessage` หลัง `markOutboundSent` (L949)
- Test: `assignment.service.spec.ts` · `room-manager.service.spec.ts` · `message-router.service.spec.ts`

**Interfaces:**
- Produces: `AssignmentService.claimIfUnassigned(roomId: string, staffId: string): Promise<boolean>`

- [ ] **Step 1: เทสต์ `claimIfUnassigned` (ล้มก่อน)**

ใน `assignment.service.spec.ts` เพิ่ม `updateMany: jest.fn()` ให้ `prisma.chatRoom` ใน `beforeEach` แล้วเพิ่ม `describe`:

```ts
  describe('claimIfUnassigned — ใครตอบก่อนได้เป็นเจ้าของ', () => {
    it('ห้องว่าง → รับเรื่อง บันทึก activity (source: reply) และคืน true', async () => {
      prisma.chatRoom.updateMany.mockResolvedValue({ count: 1 });
      prisma.staffChatActivity.create.mockResolvedValue({});

      const claimed = await service.claimIfUnassigned('room-1', 'staff-1');

      expect(claimed).toBe(true);
      expect(prisma.chatRoom.updateMany).toHaveBeenCalledWith({
        where: { id: 'room-1', assignedToId: null, deletedAt: null },
        data: { assignedToId: 'staff-1', status: ChatRoomStatus.ACTIVE },
      });
      expect(prisma.staffChatActivity.create).toHaveBeenCalledWith({
        data: { staffId: 'staff-1', action: 'assign', metadata: { roomId: 'room-1', source: 'reply' } },
      });
    });

    it('ห้องมีเจ้าของแล้ว (หรือแพ้การแข่ง) → count 0 · ไม่บันทึก activity · คืน false', async () => {
      prisma.chatRoom.updateMany.mockResolvedValue({ count: 0 });

      const claimed = await service.claimIfUnassigned('room-1', 'staff-2');

      expect(claimed).toBe(false);
      expect(prisma.staffChatActivity.create).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/assignment.service.spec.ts -t "claimIfUnassigned"`
Expected: FAIL — `service.claimIfUnassigned is not a function`

- [ ] **Step 3: เพิ่ม `claimIfUnassigned`**

วางหลังเมธอด `assign()` ใน `assignment.service.ts`:

```ts
  /**
   * ใครตอบก่อนได้เป็นเจ้าของ (สเปก §5 · คำตัดสินเจ้าของ 2026-09-05)
   *
   * เรียกจาก MessageRouterService.sendStaffMessage **หลังคำตอบถึงลูกค้าแล้ว** เท่านั้น
   * updateMany แบบมีเงื่อนไข ⇒ สองคนตอบห้องว่างพร้อมกันได้เจ้าของคนเดียว ไม่มี activity/WS ซ้ำ
   * ห้องที่มีเจ้าของแล้ว คนอื่นตอบได้โดยเจ้าของไม่เปลี่ยน (คืน false เงียบ ๆ)
   */
  async claimIfUnassigned(roomId: string, staffId: string): Promise<boolean> {
    const res = await this.prisma.chatRoom.updateMany({
      where: { id: roomId, assignedToId: null, deletedAt: null },
      data: { assignedToId: staffId, status: ChatRoomStatus.ACTIVE },
    });
    if (res.count !== 1) return false;

    await this.prisma.staffChatActivity.create({
      data: { staffId, action: 'assign', metadata: { roomId, source: 'reply' } },
    });

    this.logger.log(`Room ${roomId} claimed by staff ${staffId} (first reply)`);
    this.gateway?.emitRoomUpdate(roomId, { event: 'assigned', roomId, assignedToId: staffId });
    this.gateway?.emitToStaff(staffId, 'chat:assigned', { roomId, assignedToId: staffId });
    return true;
  }
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/assignment.service.spec.ts`
Expected: PASS ทั้งไฟล์

- [ ] **Step 5: เทสต์ "สร้างห้องใหม่ไม่แจกอัตโนมัติ" (ล้มก่อน)**

ใน `room-manager.service.spec.ts` เพิ่ม import `import { AssignmentService } from './assignment.service';` และใน `providers` ของ `Test.createTestingModule` เพิ่ม:

```ts
        { provide: AssignmentService, useValue: { autoAssign: jest.fn() } },
```

เพิ่มเทสต์ใน `describe('getOrCreateRoom')`:

```ts
    it('ห้องใหม่ → ไม่ autoAssign (ใครตอบก่อนได้เป็นเจ้าของ — สเปก §5)', async () => {
      prisma.chatRoom.findUnique.mockResolvedValue(null);
      prisma.chatRoom.findFirst.mockResolvedValue(null);
      prisma.chatRoom.create.mockResolvedValue({ id: 'room-new', channel: 'FACEBOOK', status: 'ACTIVE' });

      const assignment = module.get(AssignmentService) as { autoAssign: jest.Mock };
      await service.getOrCreateRoom({ externalUserId: 'PSID-new', channel: ChatChannel.FACEBOOK });

      expect(assignment.autoAssign).not.toHaveBeenCalled();
    });
```

(`module` ต้องประกาศไว้นอก `beforeEach`: เปลี่ยน `const module = await Test.createTestingModule(...)` เป็น `module = await ...` และประกาศ `let module: TestingModule;` ที่หัว `describe` พร้อม `import { Test, TestingModule } from '@nestjs/testing';`)

- [ ] **Step 6: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/room-manager.service.spec.ts -t "autoAssign"`
Expected: FAIL — `autoAssign` ถูกเรียก 1 ครั้ง

- [ ] **Step 7: ตัดบล็อก autoAssign ใน `createRoom`**

ลบ 6 บรรทัดนี้ออกจาก `room-manager.service.ts`:

```ts
    // Auto-assign to least-busy staff (best-effort)
    try {
      await this.assignmentService?.autoAssign(room.id);
    } catch {
      // Assignment failure shouldn't block room creation
    }
```

แทนที่ด้วยคอมเมนต์บรรทัดเดียว:

```ts
    // ไม่แจกห้องอัตโนมัติอีก — ใครตอบก่อนได้เป็นเจ้าของ (AssignmentService.claimIfUnassigned · สเปก §5)
```

ถ้า `assignmentService` ไม่มีผู้ใช้อื่นในไฟล์แล้ว (ตรวจด้วย `grep -n assignmentService apps/api/src/modules/chat-engine/services/room-manager.service.ts`) ให้**คง** การ inject ไว้ (ตัดในรอบเก็บกวาดภายหลัง) เพื่อไม่ให้ Task นี้แตะ constructor

- [ ] **Step 8: รันให้ผ่าน**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/room-manager.service.spec.ts`
Expected: PASS ทั้งไฟล์

- [ ] **Step 9: เทสต์ "รับเรื่องหลังส่งสำเร็จ" ใน message-router (ล้มก่อน)**

เพิ่มท้าย `message-router.service.spec.ts`:

```ts
describe('MessageRouterService.sendStaffMessage — ใครตอบก่อนได้เป็นเจ้าของ', () => {
  function makeClaimingSender(adapterResult: { success: boolean; error?: string }) {
    const { router: base, roomManager, adapter } = makeStaffSender();
    adapter.sendMessage.mockResolvedValue(adapterResult);
    const assignment = { claimIfUnassigned: jest.fn().mockResolvedValue(true) };
    const router = new MessageRouterService(
      roomManager as any,
      { initiateHandoff: jest.fn() } as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      undefined, // afterHours
      undefined, // aiAutoReply
      undefined, // adapters
      undefined, // handlers
      undefined, // gateway
      assignment as any,
    );
    router.registerAdapter(adapter as any);
    void base;
    return { router, roomManager, adapter, assignment };
  }

  it('ส่งสำเร็จ → markOutboundSent แล้วค่อย claimIfUnassigned(roomId, staffId)', async () => {
    const { router, roomManager, assignment } = makeClaimingSender({ success: true });
    const res = await router.sendStaffMessage({ roomId: 'r1', staffId: 'u1', text: 'สวัสดีค่ะ', clientMessageId: 'tok-1' });

    expect(res.success).toBe(true);
    expect(assignment.claimIfUnassigned).toHaveBeenCalledWith('r1', 'u1');
    expect(roomManager.markOutboundSent.mock.invocationCallOrder[0])
      .toBeLessThan(assignment.claimIfUnassigned.mock.invocationCallOrder[0]);
  });

  it('adapter ส่งล้ม → ไม่ markOutboundSent และไม่รับเรื่อง (ลูกค้ายังไม่ได้รับคำตอบ)', async () => {
    const { router, roomManager, assignment } = makeClaimingSender({ success: false, error: '(#10) outside window' });
    const res = await router.sendStaffMessage({ roomId: 'r1', staffId: 'u1', text: 'สวัสดีค่ะ', clientMessageId: 'tok-2' });

    expect(res.success).toBe(false);
    expect(roomManager.markOutboundSent).not.toHaveBeenCalled();
    expect(assignment.claimIfUnassigned).not.toHaveBeenCalled();
  });

  it('claim ล้ม (เช่น DB error) → ไม่ทำให้การส่งที่สำเร็จแล้วกลายเป็นล้ม', async () => {
    const { router, assignment } = makeClaimingSender({ success: true });
    assignment.claimIfUnassigned.mockRejectedValue(new Error('db down'));
    const res = await router.sendStaffMessage({ roomId: 'r1', staffId: 'u1', text: 'สวัสดีค่ะ', clientMessageId: 'tok-3' });
    expect(res.success).toBe(true);
  });
});
```

- [ ] **Step 10: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/message-router.service.spec.ts -t "ใครตอบก่อน"`
Expected: FAIL — `claimIfUnassigned` ไม่ถูกเรียก

- [ ] **Step 11: inject `AssignmentService` + เรียกหลัง `markOutboundSent`**

import ใน `message-router.service.ts`: `import { AssignmentService } from './assignment.service';`

เพิ่มพารามิเตอร์ **ท้ายสุด** ของ constructor (หลัง `private gateway?: IChatGateway,`) เพื่อไม่กระทบผู้เรียกเดิมที่ส่ง positional args:

```ts
    @Optional()
    @Inject(forwardRef(() => AssignmentService))
    private assignmentService?: AssignmentService,
```

ใน `sendStaffMessage` แทนที่ท้ายเมธอดจาก `await this.roomManager.markOutboundSent(saved.id, result.externalMessageId);` ถึง `return {...}` ด้วย:

```ts
    await this.roomManager.markOutboundSent(saved.id, result.externalMessageId);

    // ใครตอบก่อนได้เป็นเจ้าของ (สเปก §5) — หลังส่งถึงลูกค้าแล้วเท่านั้น · best-effort:
    // การรับเรื่องล้มไม่ทำให้การส่งที่สำเร็จแล้วกลายเป็นล้ม (ไม่งั้น client retry = ส่งซ้ำ)
    try {
      await this.assignmentService?.claimIfUnassigned(params.roomId, params.staffId);
    } catch (err) {
      this.logger.warn(
        `[sendStaffMessage] claim failed for room ${params.roomId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    return {
      success: true,
      message: { id: saved.id, clientMessageId: saved.clientMessageId, createdAt: saved.createdAt },
    };
```

- [ ] **Step 12: รันให้ผ่าน + typecheck**

Run: `npm --prefix apps/api test -- src/modules/chat-engine/services/ && ./tools/check-types.sh api`
Expected: PASS ทุกไฟล์ใน services/ · tsc 0 errors

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/modules/chat-engine/services/assignment.service.ts apps/api/src/modules/chat-engine/services/assignment.service.spec.ts apps/api/src/modules/chat-engine/services/room-manager.service.ts apps/api/src/modules/chat-engine/services/room-manager.service.spec.ts apps/api/src/modules/chat-engine/services/message-router.service.ts apps/api/src/modules/chat-engine/services/message-router.service.spec.ts
git commit -m "feat(chat): ใครตอบก่อนได้เป็นเจ้าของห้อง — เลิก autoAssign ตอนสร้างห้อง, claimIfUnassigned หลังส่งถึงลูกค้า

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: CLI ล้างข้อมูลครั้งเดียว `reset-inbox-day-one`

**Files:**
- Create: `apps/api/src/cli/reset-inbox-day-one.cli.ts`
- Create: `apps/api/src/cli/reset-inbox-day-one.cli.spec.ts`
- Modify: `apps/api/package.json` (scripts — ใต้ `"backfill:contacts:help"`)

**Interfaces:**
- Produces: `computeWaitingSince(msgs: { role: string; createdAt: Date }[]): Date | null` (pure) · script `reset:inbox-day-one`

- [ ] **Step 1: เทสต์ helper ล้วน (ล้มก่อน)**

```ts
import { computeWaitingSince } from './reset-inbox-day-one.cli';

const at = (iso: string) => new Date(iso);

describe('computeWaitingSince — เวลาข้อความลูกค้าใบแรกหลังคำตอบล่าสุด', () => {
  it('ลูกค้าส่ง 2 ใบหลังพนักงานตอบ → ได้เวลาใบแรก (ไม่ใช่ใบล่าสุด)', () => {
    const msgs = [
      { role: 'CUSTOMER', createdAt: at('2026-09-01T01:00:00Z') },
      { role: 'STAFF', createdAt: at('2026-09-01T02:00:00Z') },
      { role: 'CUSTOMER', createdAt: at('2026-09-03T05:00:00Z') },
      { role: 'CUSTOMER', createdAt: at('2026-09-03T06:00:00Z') },
    ];
    expect(computeWaitingSince(msgs)).toEqual(at('2026-09-03T05:00:00Z'));
  });

  it('ไม่มี STAFF/BOT เลย → ข้อความแรกของห้อง', () => {
    const msgs = [
      { role: 'CUSTOMER', createdAt: at('2026-09-02T01:00:00Z') },
      { role: 'CUSTOMER', createdAt: at('2026-09-02T02:00:00Z') },
    ];
    expect(computeWaitingSince(msgs)).toEqual(at('2026-09-02T01:00:00Z'));
  });

  it('ข้อความสุดท้ายเป็น STAFF หรือ BOT → null (ไม่ได้รอ)', () => {
    expect(computeWaitingSince([
      { role: 'CUSTOMER', createdAt: at('2026-09-02T01:00:00Z') },
      { role: 'BOT', createdAt: at('2026-09-02T01:30:00Z') },
    ])).toBeNull();
    expect(computeWaitingSince([])).toBeNull();
  });

  it('SYSTEM/AUTO_TRIGGER ไม่นับเป็นคำตอบ', () => {
    const msgs = [
      { role: 'STAFF', createdAt: at('2026-09-01T02:00:00Z') },
      { role: 'CUSTOMER', createdAt: at('2026-09-03T05:00:00Z') },
      { role: 'SYSTEM', createdAt: at('2026-09-03T05:01:00Z') },
    ];
    expect(computeWaitingSince(msgs)).toEqual(at('2026-09-03T05:00:00Z'));
  });
});
```

- [ ] **Step 2: รันให้ล้ม**

Run: `npm --prefix apps/api test -- src/cli/reset-inbox-day-one.cli.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: เขียน CLI**

```ts
/**
 * ล้างข้อมูล inbox ครั้งเดียวก่อนวันแรกที่ทีมย้ายมาใช้
 * สเปก docs/superpowers/specs/2026-09-05-inbox-day-one-readiness-design.md §6
 *
 * ทำ 3 ขั้นใน transaction เดียว (รันซ้ำได้ ผลเป็น 0 การเปลี่ยนแปลง):
 *   1. assigned_to_id = NULL ทุกห้อง — ผู้ดูแลเดิมมาจาก autoAssign แบบวน ไม่มีใครเคยตอบจริง
 *   2. unread_count = 0 ในห้องที่ข้อความสุดท้ายไม่ใช่ของลูกค้า
 *   3. ห้องที่ข้อความสุดท้ายเป็นของลูกค้าและ last_message_at ไม่เกิน 7 วัน:
 *      waiting_since = ข้อความลูกค้าใบแรกหลังคำตอบล่าสุด · status = ACTIVE · resolved_at = NULL
 *      (เกิน 7 วัน = ตอบไม่ได้แล้วไม่ว่าทางไหน ปล่อย IDLE ตามเดิม)
 *
 * ⚠️ ต้องรันทันทีหลัง deploy PR1 และก่อนทีมเริ่มตอบจาก inbox — ขั้น 1 ล้างผู้ดูแลทุกห้อง
 *
 * Dry-run เป็นค่าเริ่มต้น (พิมพ์ตัวเลข ไม่เขียน):
 *   EXPECTED_DB_NAME=<db> npm --prefix apps/api run reset:inbox-day-one
 * รันจริง:
 *   CONFIRM_BACKFILL=YES_I_AM_SURE EXPECTED_DB_NAME=<db> [ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production] \
 *     npm --prefix apps/api run reset:inbox-day-one
 * บน prod ใช้กลไก Cloud Run Job เดียวกับ backfill-contacts (ดู header ของ backfill-contacts.cli.ts)
 * แล้ว override command เป็น `node dist/src/cli/reset-inbox-day-one.cli.js`
 */
import { PrismaClient, Prisma } from '@prisma/client';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';
const REACHABLE_DAYS = 7;
const HUMAN_OR_BOT = new Set(['STAFF', 'BOT']);

/**
 * เวลาที่ลูกค้าเริ่มรอ = ข้อความ CUSTOMER ใบแรกที่อยู่หลังคำตอบ (STAFF/BOT) ใบล่าสุด
 * คืน null เมื่อข้อความสุดท้ายไม่ใช่ของลูกค้า (= ไม่ได้รอ) · SYSTEM/AUTO_TRIGGER ไม่นับเป็นคำตอบ
 * `msgs` ต้องเรียง createdAt จากเก่าไปใหม่
 */
export function computeWaitingSince(msgs: { role: string; createdAt: Date }[]): Date | null {
  if (msgs.length === 0) return null;
  const lastCustomerOrReply = [...msgs].reverse().find((m) => m.role === 'CUSTOMER' || HUMAN_OR_BOT.has(m.role));
  if (!lastCustomerOrReply || lastCustomerOrReply.role !== 'CUSTOMER') return null;
  let lastReplyIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (HUMAN_OR_BOT.has(msgs[i].role)) { lastReplyIdx = i; break; }
  }
  const firstUnanswered = msgs.slice(lastReplyIdx + 1).find((m) => m.role === 'CUSTOMER');
  return firstUnanswered ? firstUnanswered.createdAt : null;
}

// ─── runnable glue (require.main === module) ─────────────────────────────────

/** ห้องที่ข้อความสุดท้าย (ไม่ลบ) เป็นของลูกค้า — ใช้ทั้งนับและเลือกผู้สมัครขั้น 3 */
const LAST_IS_CUSTOMER = Prisma.sql`
  COALESCE((SELECT m.role::text FROM chat_messages m
            WHERE m.room_id = r.id AND m.deleted_at IS NULL
            ORDER BY m.created_at DESC LIMIT 1), '') = 'CUSTOMER'`;

async function count(prisma: PrismaClient, sql: Prisma.Sql): Promise<number> {
  const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>(sql);
  return Number(n);
}

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME=<db> required');
    process.exit(1);
  }
  const dryRun = process.env.CONFIRM_BACKFILL !== REQUIRED_CONSENT;
  if (dryRun) {
    console.log('[reset-inbox-day-one] DRY-RUN (ค่าเริ่มต้น) — พิมพ์ตัวเลข ไม่เขียน');
    console.log(`  รันจริง: CONFIRM_BACKFILL=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> [ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT}] npm --prefix apps/api run reset:inbox-day-one`);
  }
  if (!dryRun && process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_BACKFILL !== REQUIRED_CONSENT) {
    console.error(`ERROR: production ต้องมี ALLOW_PROD_BACKFILL=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const [{ current_database: actualDb }] = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}"`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`[reset-inbox-day-one] DB: "${actualDb}" | mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);

  const cutoff = new Date(Date.now() - REACHABLE_DAYS * 24 * 3600 * 1000);

  try {
    const assigned = await count(prisma, Prisma.sql`
      SELECT count(*)::bigint AS n FROM chat_rooms r WHERE r.deleted_at IS NULL AND r.assigned_to_id IS NOT NULL`);
    const unreadStale = await count(prisma, Prisma.sql`
      SELECT count(*)::bigint AS n FROM chat_rooms r WHERE r.deleted_at IS NULL AND r.unread_count > 0 AND NOT (${LAST_IS_CUSTOMER})`);
    const candidates = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT r.id FROM chat_rooms r
      WHERE r.deleted_at IS NULL AND r.waiting_since IS NULL
        AND r.last_message_at > ${cutoff} AND (${LAST_IS_CUSTOMER})`);
    const unreachable = await count(prisma, Prisma.sql`
      SELECT count(*)::bigint AS n FROM chat_rooms r
      WHERE r.deleted_at IS NULL AND r.last_message_at <= ${cutoff} AND (${LAST_IS_CUSTOMER})`);

    console.log('[reset-inbox-day-one] ===== แผน =====');
    console.log(`  1. ล้างผู้ดูแล                     : ${assigned} ห้อง`);
    console.log(`  2. unread_count → 0                : ${unreadStale} ห้อง`);
    console.log(`  3. ตั้ง waiting_since + ACTIVE     : ${candidates.length} ห้อง (รอไม่เกิน ${REACHABLE_DAYS} วัน)`);
    console.log(`  4. ปล่อย IDLE (รอเกิน ${REACHABLE_DAYS} วัน)   : ${unreachable} ห้อง`);

    if (dryRun) return;

    console.log('[reset-inbox-day-one] Ctrl+C ภายใน 5 วินาทีเพื่อยกเลิก');
    await new Promise((r) => setTimeout(r, 5000));

    // waiting_since ต่อห้อง — ระดับสิบห้อง วนทีละห้องได้ (ไม่ต้อง SQL ซับซ้อน)
    const waitingPlan: { id: string; waitingSince: Date }[] = [];
    for (const c of candidates) {
      const msgs = await prisma.chatMessage.findMany({
        where: { roomId: c.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { role: true, createdAt: true },
      });
      const ws = computeWaitingSince(msgs);
      if (ws) waitingPlan.push({ id: c.id, waitingSince: ws });
    }

    const result = await prisma.$transaction(async (tx) => {
      const step1 = await tx.chatRoom.updateMany({
        where: { deletedAt: null, assignedToId: { not: null } },
        data: { assignedToId: null },
      });
      const step2 = await tx.$executeRaw(Prisma.sql`
        UPDATE chat_rooms r SET unread_count = 0
        WHERE r.deleted_at IS NULL AND r.unread_count > 0 AND NOT (${LAST_IS_CUSTOMER})`);
      let step3 = 0;
      for (const w of waitingPlan) {
        const res = await tx.chatRoom.updateMany({
          where: { id: w.id, waitingSince: null },
          data: { waitingSince: w.waitingSince, status: 'ACTIVE', resolvedAt: null },
        });
        step3 += res.count;
      }
      return { step1: step1.count, step2, step3 };
    });

    console.log('[reset-inbox-day-one] ===== ผล =====');
    console.log(`  1. ล้างผู้ดูแล                     : ${result.step1}`);
    console.log(`  2. unread_count → 0                : ${result.step2}`);
    console.log(`  3. ตั้ง waiting_since + ACTIVE     : ${result.step3}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[reset-inbox-day-one] FAILED', err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npm --prefix apps/api test -- src/cli/reset-inbox-day-one.cli.spec.ts`
Expected: PASS 4 เทสต์ (import ไฟล์ไม่ต่อ DB เพราะ `require.main === module`)

- [ ] **Step 5: เพิ่ม script ใน `apps/api/package.json`**

ใต้ `"backfill:contacts:help": ...,` เพิ่ม:

```json
    "reset:inbox-day-one": "node dist/src/cli/reset-inbox-day-one.cli.js",
    "reset:inbox-day-one:help": "echo 'Dry-run default: EXPECTED_DB_NAME=<db> npm --prefix apps/api run reset:inbox-day-one. To write: CONFIRM_BACKFILL=YES_I_AM_SURE EXPECTED_DB_NAME=<db> [ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production] npm --prefix apps/api run reset:inbox-day-one — ล้างผู้ดูแลทุกห้อง, unread=0 ในห้องที่ตอบแล้ว, ตั้ง waiting_since ให้ห้องที่ลูกค้ารอไม่เกิน 7 วัน'",
```

- [ ] **Step 6: build + dry-run กับฐาน dev (ถ้ามี) เพื่อยืนยันว่า SQL รันได้**

Run: `npm --prefix apps/api run build && EXPECTED_DB_NAME=<ชื่อฐาน dev จริง> npm --prefix apps/api run reset:inbox-day-one`
Expected: พิมพ์ "===== แผน =====" 4 บรรทัดแล้วจบโดยไม่เขียน · ถ้าไม่มีฐาน dev ให้ข้ามและระบุในสรุป PR ว่ายังไม่ได้ dry-run

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/cli/reset-inbox-day-one.cli.ts apps/api/src/cli/reset-inbox-day-one.cli.spec.ts apps/api/package.json
git commit -m "feat(chat): CLI reset-inbox-day-one — ล้างผู้ดูแล/unread และตั้ง waiting_since ก่อนวันแรก (dry-run เป็นค่าเริ่มต้น)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: ด่านตรวจ + ชุดเทสต์เต็ม + เปิด PR1

**Files:** ไม่แก้โค้ด (ยกเว้นถ้าด่านตรวจข้อ 1 พบผู้เขียน CUSTOMER)

- [ ] **Step 1: ด่านตรวจผู้เขียนข้อความที่ข้าม `saveMessage` (สเปก §4.6)**

Run: `grep -rn --include='*.ts' -A 12 'chatMessage.create(' apps/api/src | grep -v '\.spec\.' | grep -E 'chatMessage.create\(|role:'`
Expected: 4 จุด — `room-manager.service.ts` (saveMessage เอง), `chatbot-finance/services/chat-room.service.ts`, `line-oa/payment-links/payment-link.service.ts`, `notifications/services/notification-dispatch.service.ts` — และ **ไม่มีจุดใดนอก saveMessage ที่ `role: MessageRole.CUSTOMER` / `role: 'CUSTOMER'`** · ถ้าพบ ให้หยุดและรายงาน (ต้องเปลี่ยนจุดนั้นให้เรียก `roomManager.saveMessage` ก่อนจึงจะไปต่อ)

- [ ] **Step 2: ชุดเทสต์ api ทั้งชุด + typecheck**

Run: `npm --prefix apps/api test && ./tools/check-types.sh api`
Expected: PASS ทั้งชุด (ยกเว้น spec ที่ต้องต่อฐานจริงตามที่ repo ระบุใน `api-jest-parallel-db-flaky` — รัน `--runInBand` อยู่แล้ว) · tsc 0 errors

- [ ] **Step 3: push + เปิด PR1**

```bash
git push -u origin feat/inbox-day-one-readiness
gh pr create --title "feat(chat): inbox วันแรก PR1 — รอตอบ (waiting_since) · ใครตอบก่อนได้เป็นเจ้าของ · CLI ล้างข้อมูล" --body "$(cat <<'EOF'
## สรุป
หลังบ้านทั้งก้อนของสเปก `docs/superpowers/specs/2026-09-05-inbox-day-one-readiness-design.md` (§4-§6)

- `chat_rooms.waiting_since` — ตั้งเมื่อข้อความลูกค้าเข้ามา (set-if-null) · ล้างเฉพาะเมื่อคำตอบจาก **คน** ถึงลูกค้าแล้ว: `markOutboundSent` / echo STAFF / `resolve`
- cron `markIdleRooms` ไม่ซ่อนห้องที่ลูกค้ารอ
- `GET /staff-chat/rooms?waiting=true` เรียงรอนานสุดก่อน · `rooms/counts.waiting`
- เลิก autoAssign ตอนสร้างห้อง → `claimIfUnassigned` หลังส่งถึงลูกค้า (updateMany มีเงื่อนไข)
- CLI `reset:inbox-day-one` (dry-run เป็นค่าเริ่มต้น)

## หลัง merge
1. deploy
2. รัน CLI บน prod **ทันที** ก่อนทีมเริ่มตอบ (ดู header ของ CLI)
3. ตรวจด้วย MCP: `waiting_since IS NOT NULL` ≈ 52 · `assigned_to_id IS NULL` = ทุกห้อง

## เทสต์
- jest: room-manager / message-router / assignment / chat-cron (ใหม่) / reset-inbox-day-one (ใหม่)
- `./tools/check-types.sh api` เขียว

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR2 — หน้าเว็บ

> เริ่มหลัง PR1 merge + deploy + รัน CLI แล้ว (หน้าเว็บอ่าน `waitingSince`/`counts.waiting` จาก API) · ทำงานบน branch ใหม่ `feat/inbox-day-one-web` แตกจาก main ที่มี PR1 แล้ว

### Task 11: `formatWaitDuration`

**Files:**
- Modify: `apps/web/src/lib/chat-time.ts`
- Test: `apps/web/src/lib/chat-time.test.ts`

**Interfaces:**
- Produces: `formatWaitDuration(since: string | Date | null | undefined, now?: Date): string` → `'5 นาที' | '3 ชม.' | '2 วัน' | ''`

- [ ] **Step 1: เทสต์ (ล้มก่อน)** — เพิ่มท้าย `chat-time.test.ts` (import `formatWaitDuration` เพิ่มจาก `./chat-time`):

```ts
describe('formatWaitDuration — ป้าย "รอ …" ในแถวคิว', () => {
  const NOW2 = new Date('2026-09-05T12:00:00');
  it('ว่าง/ไม่ใช่วันที่ → ""', () => {
    expect(formatWaitDuration(null, NOW2)).toBe('');
    expect(formatWaitDuration('x', NOW2)).toBe('');
  });
  it('ต่ำกว่า 1 ชม. → นาที (อนาคตเล็กน้อยปัดเป็น 0)', () => {
    expect(formatWaitDuration(new Date('2026-09-05T11:35:00'), NOW2)).toBe('25 นาที');
    expect(formatWaitDuration(new Date('2026-09-05T12:00:30'), NOW2)).toBe('0 นาที');
  });
  it('ต่ำกว่า 48 ชม. → ชั่วโมง', () => {
    expect(formatWaitDuration(new Date('2026-09-05T09:00:00'), NOW2)).toBe('3 ชม.');
    expect(formatWaitDuration(new Date('2026-09-03T13:00:00'), NOW2)).toBe('47 ชม.');
  });
  it('ตั้งแต่ 48 ชม. → วัน', () => {
    expect(formatWaitDuration(new Date('2026-09-03T12:00:00'), NOW2)).toBe('2 วัน');
    expect(formatWaitDuration('2026-08-30T12:00:00', NOW2)).toBe('6 วัน');
  });
});
```

- [ ] **Step 2: รันให้ล้ม** — Run: `npm --prefix apps/web test -- src/lib/chat-time.test.ts` · Expected: FAIL (ไม่มี export)

- [ ] **Step 3: เพิ่มฟังก์ชันท้าย `chat-time.ts`**

```ts
/** ระยะเวลาที่ลูกค้ารอคำตอบ สำหรับป้าย "รอ …" ในแถวคิว (สเปก 2026-09-05 §7) */
export function formatWaitDuration(
  since: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!since) return '';
  const d = toDate(since);
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 60000));
  if (diffMin < 60) return `${diffMin} นาที`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 48) return `${hours} ชม.`;
  return `${Math.floor(hours / 24)} วัน`;
}
```

- [ ] **Step 4: รันให้ผ่าน** — Run: `npm --prefix apps/web test -- src/lib/chat-time.test.ts` · Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chat-time.ts apps/web/src/lib/chat-time.test.ts
git commit -m "feat(inbox): formatWaitDuration สำหรับป้ายรอตอบ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: แท็บ "รอตอบ" เป็นค่าเริ่มต้น + ตัวนับ

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChannelFilter.tsx` (TABS L4-8 · `InboxTab` L18 · `counts` prop L33)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/tab-counts.ts` (+ `tab-counts.test.ts`)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx` (prop `serverCounts` type L31)
- Modify: `apps/web/src/pages/UnifiedInboxPage/index.tsx` (state `filters` L33-38 · params ของ `sessionsQuery` L~170-185)

**Interfaces:**
- Consumes: API `waiting` param + `counts.waiting` (Task 7)
- Produces: `InboxTab = 'waiting' | 'mine' | 'all' | 'unread'` · `deriveTabCounts(...)` คืน `{ mine, all, unread, waiting }`

- [ ] **Step 1: เทสต์ `deriveTabCounts` (ล้มก่อน)** — แก้ `tab-counts.test.ts`:

```ts
const S = (over: Partial<{ unreadCount: number; assignedTo: { id: string } | null; waitingSince: string | null }>) => ({
  unreadCount: 0,
  assignedTo: null,
  waitingSince: null,
  ...over,
});

describe('deriveTabCounts', () => {
  it('counts unread rooms for all/unread, my unread for mine, and waiting rooms', () => {
    const sessions = [
      S({ unreadCount: 2, assignedTo: { id: 'me' }, waitingSince: '2026-09-05T01:00:00Z' }),
      S({ unreadCount: 1, assignedTo: { id: 'other' } }),
      S({ unreadCount: 0, assignedTo: { id: 'me' }, waitingSince: '2026-09-05T02:00:00Z' }),
      S({ unreadCount: 5, assignedTo: null }),
    ];
    expect(deriveTabCounts(sessions, 'me')).toEqual({ mine: 1, all: 3, unread: 3, waiting: 2 });
  });
  it('handles missing currentUserId + empty list', () => {
    expect(deriveTabCounts([], undefined)).toEqual({ mine: 0, all: 0, unread: 0, waiting: 0 });
  });
});
```

- [ ] **Step 2: รันให้ล้ม** — Run: `npm --prefix apps/web test -- src/pages/UnifiedInboxPage/components/tab-counts.test.ts` · Expected: FAIL

- [ ] **Step 3: แก้ `tab-counts.ts`**

```ts
type Room = { unreadCount?: number; assignedTo?: { id: string } | null; waitingSince?: string | null };

/** Unread-room counts per inbox tab + waiting rooms. Client-derived fallback from the loaded list
 *  (server counts from GET /staff-chat/rooms/counts are authoritative). */
export function deriveTabCounts(
  sessions: Room[],
  currentUserId?: string,
): { mine: number; all: number; unread: number; waiting: number } {
  const isUnread = (r: Room) => (r.unreadCount ?? 0) > 0;
  const all = sessions.filter(isUnread).length;
  const mine = sessions.filter((r) => isUnread(r) && r.assignedTo?.id === currentUserId).length;
  const waiting = sessions.filter((r) => !!r.waitingSince).length;
  return { mine, all, unread: all, waiting };
}
```

- [ ] **Step 4: รันให้ผ่าน** — Run: `npm --prefix apps/web test -- src/pages/UnifiedInboxPage/components/tab-counts.test.ts` · Expected: PASS

- [ ] **Step 5: `ChannelFilter.tsx`**

```ts
import { Inbox, User, Mail, Clock } from 'lucide-react';

const TABS = [
  { key: 'waiting', label: 'รอตอบ', icon: Clock },
  { key: 'mine', label: 'ของฉัน', icon: User },
  { key: 'all', label: 'ทั้งหมด', icon: Inbox },
  { key: 'unread', label: 'ยังไม่อ่าน', icon: Mail },
] as const;
```

`export type InboxTab = 'waiting' | 'mine' | 'all' | 'unread';`
prop `counts?: { mine: number; all: number; unread: number; waiting: number };`

ตัวเลขบนแท็บรอตอบต้องเป็นสีแดง (1 สี = 1 ความหมาย: แดง = ต้องลงมือ) — ในบล็อก `{counts && counts[tab.key] > 0 && (<span className={cn('ml-0.5 ...', ...)}>` เปลี่ยนคลาสของ span เป็น:

```tsx
<span className={cn(
  'ml-0.5 inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold leading-none',
  tab.key === 'waiting' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground',
)}>
```

- [ ] **Step 6: `ConversationList.tsx`** — เปลี่ยน type ของ `serverCounts` เป็น `{ mine: number; all: number; unread: number; waiting: number; byChannel: Record<string, number> }`

- [ ] **Step 7: `index.tsx`**

ค่าเริ่มต้นของ `filters`: `}>({ tab: 'waiting', channels: [], aiFilter: 'all' });`

ใน `params` ของ `sessionsQuery` ใต้ `unreadOnly: ...` เพิ่ม:

```ts
            waiting: filters.tab === 'waiting' ? true : undefined,
```

และให้เวลารอบนแถวเดินโดยไม่ต้องรอเหตุการณ์ WS: เพิ่ม `refetchInterval: 60_000,` ใน options ของ `sessionsQuery` (ถัดจาก `initialPageParam: 1,`)

- [ ] **Step 8: typecheck** — Run: `./tools/check-types.sh web` · Expected: 0 errors (ถ้า tsc ฟ้องที่ `deriveTabCounts`/`serverCounts` ที่อื่น ให้ตามแก้ type ให้มี `waiting`)

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/ChannelFilter.tsx apps/web/src/pages/UnifiedInboxPage/components/tab-counts.ts apps/web/src/pages/UnifiedInboxPage/components/tab-counts.test.ts apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx apps/web/src/pages/UnifiedInboxPage/index.tsx
git commit -m "feat(inbox): แท็บรอตอบเป็นค่าเริ่มต้น เรียงรอนานสุดก่อน + ตัวนับจากเซิร์ฟเวอร์

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: ป้าย "รอ …" บนแถว + จอว่าง "ตอบครบทุกคนแล้ว"

**Files:**
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx` (session type L79-94 · แถวป้าย L220-250)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx` (บล็อกจอว่าง `visibleRooms.length === 0`)

- [ ] **Step 1: `ConversationItem.tsx`**

import: `import { formatWaitDuration } from '@/lib/chat-time';` (ไฟล์มี `formatChatTimestamp` import อยู่แล้ว — รวมเป็นบรรทัดเดียว)

ใน type `session` เพิ่ม `waitingSince?: string | null;` (ใต้ `handoffMode?: boolean;`)

เงื่อนไขแสดงแถวป้าย (`{(session.tags?.length || ...) && (`) เพิ่ม `session.waitingSince ||` เป็นตัวแรก

ในแถวป้าย **ก่อน** บล็อก `{session.tags?.some(... 'overdue') && (` เพิ่ม:

```tsx
            {session.waitingSince && (
              <Badge variant="destructive" appearance="light" className="text-[10px] px-1.5 py-0 h-5 leading-snug">
                รอ {formatWaitDuration(session.waitingSince)}
              </Badge>
            )}
```

- [ ] **Step 2: `ConversationList.tsx` จอว่างแท็บรอตอบ**

import เพิ่ม `CheckCheck` (มีอยู่แล้วในบรรทัด lucide — ยืนยัน)

ในบล็อก `: visibleRooms.length === 0 ? (` แทนที่ไอคอนกับกิ่ง `sessions.length === 0 ?` ด้วยกิ่งใหม่ที่ตรวจแท็บรอตอบก่อน:

```tsx
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
              {filters.tab === 'waiting' && !filters.search ? (
                <CheckCheck className="w-5 h-5 text-success" />
              ) : (
                <MessageCircle className="w-5 h-5 text-muted-foreground/40" />
              )}
            </div>
            {filters.tab === 'waiting' && !filters.search ? (
              <>
                <p className="text-sm font-medium text-foreground leading-snug">ตอบครบทุกคนแล้ว</p>
                <p className="text-xs text-muted-foreground/80 mt-0.5 leading-snug">
                  ลูกค้าที่ทักมาใหม่จะขึ้นที่นี่
                </p>
              </>
            ) : sessions.length === 0 ? (
              /* ...กิ่งเดิม "ยังไม่มีการสนทนา" ต่อจากนี้ไม่เปลี่ยน... */
```

(กิ่ง `filters.search` และกิ่ง "ไม่มีแชทในตัวกรองนี้" คงเดิม — ปุ่ม "ดูทั้งหมด" ของกิ่งหลังตั้ง `tab: 'all'` เหมือนเดิม)

- [ ] **Step 3: typecheck + เทสต์เดิมของคอมโพเนนต์** — Run: `./tools/check-types.sh web && npm --prefix apps/web test -- src/pages/UnifiedInboxPage` · Expected: 0 errors · PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx apps/web/src/pages/UnifiedInboxPage/components/ConversationList.tsx
git commit -m "feat(inbox): ป้ายเวลารอบนแถว + จอว่างแท็บรอตอบ = ตอบครบทุกคนแล้ว

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: ลิงก์ห้องใน URL (`/inbox/:roomId`)

**Files:**
- Modify: `apps/web/src/App.tsx` (route L504)
- Modify: `apps/web/src/pages/UnifiedInboxPage/index.tsx` (state L29 · `handleSelectRoom` L338-346 · `onBack` L510)

- [ ] **Step 1: route**

ใต้บรรทัด `<Route path="/inbox" element={...} />` เพิ่มบรรทัดที่เหมือนกันทุกประการยกเว้น path:

```tsx
          <Route path="/inbox/:roomId" element={<ProtectedRoute roles={['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES']}><UnifiedInboxPage /></ProtectedRoute>} />
```

(`MainLayout` จับ full-bleed ด้วย `pathname.startsWith('/inbox/')` อยู่แล้ว — `components/layout/MainLayout.tsx:141`)

- [ ] **Step 2: `index.tsx`**

import: `import { useNavigate, useParams } from 'react-router';`

ในคอมโพเนนต์ (ใต้ `const { user } = useAuth();`):

```ts
  const navigate = useNavigate();
  const { roomId: roomIdParam } = useParams<{ roomId: string }>();
```

`activeRoomId` state คงเป็น `useState<string | null>(null)` (ต้องเริ่มที่ null เพื่อให้ effect ด้านล่างทำ join ตอนเปิดลิงก์ตรง)

แทนที่ `handleSelectRoom` เดิม (ที่เรียก leaveRoom/setActiveRoomId/joinRoom/viewRoom) ด้วย:

```ts
  // URL คือแหล่งความจริงของห้องที่เปิด (สเปก §7 ลิงก์ห้องใน URL) — เลือกห้อง = เปลี่ยน URL
  const handleSelectRoom = useCallback(
    (roomId: string) => navigate(`/inbox/${roomId}`),
    [navigate],
  );

  // param เปลี่ยน → ออกจากห้องเดิม เข้าห้องใหม่ (ครอบทั้งคลิกเลือก, ปุ่มย้อนกลับ, เปิดลิงก์ตรง, refresh)
  useEffect(() => {
    const next = roomIdParam ?? null;
    if (next === activeRoomId) return;
    if (activeRoomId) leaveRoom(activeRoomId);
    setActiveRoomId(next);
    if (next) {
      joinRoom(next);
      viewRoom(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ทำงานเฉพาะเมื่อ URL เปลี่ยน
  }, [roomIdParam]);
```

`onBack={() => setActiveRoomId(null)}` → `onBack={() => navigate('/inbox')}`

- [ ] **Step 3: typecheck + ตรวจในเบราว์เซอร์**

Run: `./tools/check-types.sh web`
จากนั้นรัน dev server ตาม `bestchoice-local-dev-gotchas` (ห้ามใช้พอร์ต 3000/5199 · ห้าม pkill ตามพอร์ต) แล้วตรวจ 3 อย่าง: คลิกห้อง → URL เป็น `/inbox/<id>` · refresh → ห้องเดิมเปิดและข้อความโหลด · ปุ่มย้อนกลับ (จอแคบ) → URL กลับเป็น `/inbox`
Expected: ครบ 3 ข้อ · ไม่มี error ใน console เรื่อง join/leave ซ้ำ

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/pages/UnifiedInboxPage/index.tsx
git commit -m "feat(inbox): ลิงก์ห้องใน URL /inbox/:roomId — แชร์/refresh แล้วห้องเดิมยังเปิด

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: แถบเตือน 24 ชม. ของ Facebook + เหตุผลเมื่อส่งล้ม

**Files:**
- Create: `apps/web/src/pages/UnifiedInboxPage/components/fb-window.ts` (+ `fb-window.test.ts`)
- Create: `apps/web/src/pages/UnifiedInboxPage/components/send-error.ts` (+ `send-error.test.ts`)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (props L115 · แถบก่อน `{/* AI Suggestions */}` L809 · ฟองแดง L784-805)
- Modify: `apps/web/src/pages/UnifiedInboxPage/index.tsx` (`failedSends` type + `pushFailedSend` L~72-90 · HTTP branch L364-367 + catch · WS `onSendFailed`)

**Interfaces:**
- Produces: `fbWindowState(lastCustomerAt, now?) → 'open'|'closing'|'closed'` · `fbWindowHoursLeft(lastCustomerAt, now?) → number` · `describeSendError(error?) → string | null` · `failedSends[i].reason?: string`

- [ ] **Step 1: เทสต์ helper (ล้มก่อน)** — `fb-window.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fbWindowState, fbWindowHoursLeft } from './fb-window';

const NOW = new Date('2026-09-05T12:00:00Z');

describe('fbWindowState — หน้าต่าง 24 ชม. ของ Facebook', () => {
  it('ไม่มีข้อความลูกค้า / วันที่เพี้ยน → open (ไม่เตือนมั่ว)', () => {
    expect(fbWindowState(null, NOW)).toBe('open');
    expect(fbWindowState('nope', NOW)).toBe('open');
  });
  it('เหลือมากกว่า 3 ชม. → open', () => {
    expect(fbWindowState('2026-09-05T08:00:00Z', NOW)).toBe('open');
  });
  it('เหลือไม่เกิน 3 ชม. → closing', () => {
    expect(fbWindowState('2026-09-04T14:30:00Z', NOW)).toBe('closing');
  });
  it('พ้น 24 ชม. → closed', () => {
    expect(fbWindowState('2026-09-04T11:59:00Z', NOW)).toBe('closed');
  });
});

describe('fbWindowHoursLeft', () => {
  it('ปัดขึ้นเป็นชั่วโมง และไม่ติดลบ', () => {
    expect(fbWindowHoursLeft('2026-09-04T14:30:00Z', NOW)).toBe(3);
    expect(fbWindowHoursLeft('2026-09-04T11:00:00Z', NOW)).toBe(0);
  });
});
```

`send-error.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { describeSendError } from './send-error';

describe('describeSendError — แปลเหตุที่ส่งล้มเป็นไทย', () => {
  it('ว่าง → null', () => {
    expect(describeSendError(undefined)).toBeNull();
    expect(describeSendError('')).toBeNull();
  });
  it('พ้นหน้าต่าง 24 ชม. (Graph #10 / subcode 2018278)', () => {
    const body = '{"error":{"message":"(#10) This message is sent outside of allowed window.","code":10,"error_subcode":2018278}}';
    expect(describeSendError(body)).toBe('พ้น 24 ชม. Facebook ไม่ให้ส่งข้อความปกติ');
    expect(describeSendError('fb:10:2018278 ...')).toBe('พ้น 24 ชม. Facebook ไม่ให้ส่งข้อความปกติ');
  });
  it('token หมดอายุ (#190)', () => {
    expect(describeSendError('{"error":{"message":"Error validating access token","code":190}}')).toBe('token ของเพจหมดอายุ ต้องต่ออายุในตั้งค่า');
  });
  it('อื่น ๆ → ข้อความดิบ ตัดที่ 120 ตัวอักษร', () => {
    expect(describeSendError('boom')).toBe('boom');
    expect(describeSendError('x'.repeat(200))).toHaveLength(121);
  });
});
```

- [ ] **Step 2: รันให้ล้ม** — Run: `npm --prefix apps/web test -- src/pages/UnifiedInboxPage/components/fb-window.test.ts src/pages/UnifiedInboxPage/components/send-error.test.ts` · Expected: FAIL (module not found)

- [ ] **Step 3: เขียน helper**

`fb-window.ts`:

```ts
/** หน้าต่างตอบ 24 ชม. ของ Facebook Messenger นับจากข้อความล่าสุดของลูกค้า (สเปก §8.1 — เตือน ไม่ปิดปุ่ม) */
export const FB_WINDOW_MS = 24 * 60 * 60 * 1000;
/** เตือน "ตอบได้อีก N ชม." เมื่อเหลือไม่เกินเท่านี้ */
export const FB_CLOSING_MS = 3 * 60 * 60 * 1000;

export type FbWindowState = 'open' | 'closing' | 'closed';

function msLeft(lastCustomerAt: string | Date | null | undefined, now: Date): number | null {
  if (!lastCustomerAt) return null;
  const t = new Date(lastCustomerAt).getTime();
  if (Number.isNaN(t)) return null;
  return FB_WINDOW_MS - (now.getTime() - t);
}

export function fbWindowState(
  lastCustomerAt: string | Date | null | undefined,
  now: Date = new Date(),
): FbWindowState {
  const left = msLeft(lastCustomerAt, now);
  if (left === null) return 'open';
  if (left <= 0) return 'closed';
  if (left <= FB_CLOSING_MS) return 'closing';
  return 'open';
}

export function fbWindowHoursLeft(
  lastCustomerAt: string | Date | null | undefined,
  now: Date = new Date(),
): number {
  const left = msLeft(lastCustomerAt, now);
  if (left === null || left <= 0) return 0;
  return Math.ceil(left / (60 * 60 * 1000));
}
```

`send-error.ts`:

```ts
/** แปลเหตุที่ส่งล้ม (error string จาก API/WS) เป็นข้อความไทยสั้น ๆ สำหรับฟองแดง (สเปก §8.1) */
export function describeSendError(error?: string | null): string | null {
  if (!error) return null;
  // Facebook Graph: code 10 + subcode 2018278 = ส่งนอกหน้าต่าง 24 ชม. · adapter อาจส่งมาเป็น "fb:10:2018278 …"
  if (/2018278|\(#10\)|"code":\s*10\b/.test(error)) return 'พ้น 24 ชม. Facebook ไม่ให้ส่งข้อความปกติ';
  if (/\(#190\)|"code":\s*190\b|fb:190\b/.test(error)) return 'token ของเพจหมดอายุ ต้องต่ออายุในตั้งค่า';
  return error.length > 120 ? error.slice(0, 120) + '…' : error;
}
```

- [ ] **Step 4: รันให้ผ่าน** — Run เดิมของ Step 2 · Expected: PASS ทั้งสองไฟล์

- [ ] **Step 5: `index.tsx` — ส่ง reason เข้า failedSends**

type ของ `failedSends` state เพิ่ม `reason?: string`:

```ts
  const [failedSends, setFailedSends] = useState<
    { id: string; roomId: string; text: string; source: 'http' | 'ws'; clientMessageId: string; reason?: string }[]
  >([]);
```

`pushFailedSend` รับพารามิเตอร์ที่ 5:

```ts
  const pushFailedSend = useCallback(
    (roomId: string, text: string, source: 'http' | 'ws', clientMessageId: string, reason?: string) => {
      setFailedSends((prev) =>
        prev.some((f) => f.roomId === roomId && f.text === text)
          ? prev
          : [...prev, { id: crypto.randomUUID(), roomId, text, source, clientMessageId, reason }],
      );
    },
    [],
  );
```

import: `import { describeSendError } from './components/send-error';`

- WS: `onSendFailed: (data) => { pushFailedSend(data.roomId, data.text, 'ws', '', describeSendError(data.error) ?? undefined); ... }`
- HTTP branch `if (data && data.success === false)`: `pushFailedSend(roomId, text, 'http', clientMessageId, describeSendError(data.error) ?? undefined);`
- `catch` ของ `sendRoomMessage`: เปลี่ยน `catch {` เป็น `catch (err) {` และส่ง `describeSendError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (err instanceof Error ? err.message : undefined)) ?? undefined`
- ตอนส่ง prop: `failedSends={failedSends.filter((f) => f.roomId === activeRoomId)}` (ไม่เปลี่ยน — reason ติดมาในอ็อบเจ็กต์)

- [ ] **Step 6: `ChatPanel.tsx` — props + ฟองแดง + แถบเตือน**

props: `failedSends?: { id: string; text: string; source?: 'http' | 'ws'; reason?: string }[];`

import เพิ่ม `Clock` ในบรรทัด lucide-react · `import { fbWindowState, fbWindowHoursLeft } from './fb-window';`

ใต้ `const isResolved = ...` (L537) เพิ่ม:

```ts
  // หน้าต่าง 24 ชม. ของ Facebook — เตือนอย่างเดียว ไม่ปิดปุ่มส่ง (สเปก §8.1) · messages เรียง asc อยู่แล้ว
  const lastCustomerAt = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'CUSTOMER') return messages[i].createdAt as string;
    }
    return null;
  }, [messages]);
  const fbState = session?.channel === 'FACEBOOK' ? fbWindowState(lastCustomerAt) : 'open';
```

ก่อน `{/* AI Suggestions */}` เพิ่ม:

```tsx
      {/* หน้าต่าง 24 ชม. ของ Facebook — เตือน ไม่ปิดปุ่ม */}
      {fbState !== 'open' && !isResolved && (
        <div className="flex items-center gap-2 border-t border-warning/20 bg-warning/10 px-4 py-1.5 text-[11px] text-warning leading-snug">
          <Clock className="size-3.5 shrink-0" />
          <span>
            {fbState === 'closed'
              ? 'พ้น 24 ชม. แล้ว Facebook อาจไม่ให้ส่งข้อความปกติ'
              : `ตอบได้อีก ${fbWindowHoursLeft(lastCustomerAt)} ชม. ก่อนพ้นหน้าต่าง 24 ชม. ของ Facebook`}
          </span>
        </div>
      )}
```

ในฟองแดง (`{(failedSends ?? []).map((f) => (`) ใต้บรรทัด `{f.source === 'ws' ? 'ส่งถึงลูกค้าไม่สำเร็จ' : 'ส่งไม่สำเร็จ'}` เพิ่ม:

```tsx
                    {f.reason && <span className="text-destructive/80">· {f.reason}</span>}
```

- [ ] **Step 7: typecheck + เทสต์ + ตรวจตา** — Run: `./tools/check-types.sh web && npm --prefix apps/web test -- src/pages/UnifiedInboxPage` · Expected: 0 errors · PASS · เปิดห้อง Facebook ที่ข้อความลูกค้าล่าสุดเกิน 24 ชม. เห็นแถบเหลืองเหนือช่องพิมพ์ และปุ่มส่งยังกดได้

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/UnifiedInboxPage/components/fb-window.ts apps/web/src/pages/UnifiedInboxPage/components/fb-window.test.ts apps/web/src/pages/UnifiedInboxPage/components/send-error.ts apps/web/src/pages/UnifiedInboxPage/components/send-error.test.ts apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx apps/web/src/pages/UnifiedInboxPage/index.tsx
git commit -m "feat(inbox): เตือนหน้าต่าง 24 ชม. ของ Facebook (ไม่ปิดปุ่ม) + บอกเหตุในฟองส่งไม่สำเร็จ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: bump version + ชุดเทสต์เต็ม + เปิด PR2

- [ ] **Step 1: bump version** — แก้ `"version"` ใน `apps/web/package.json` เป็นค่าถัดไปตามรูปแบบ `YY.M.ลำดับ` (ดูค่าปัจจุบันด้วย `grep '"version"' apps/web/package.json`)

- [ ] **Step 2: ชุดเทสต์เต็ม + typecheck** — Run: `npm --prefix apps/web test && ./tools/check-types.sh web` · Expected: PASS ทั้งชุด (เดิม 1,092 + ใหม่) · 0 errors

- [ ] **Step 3: push + PR2**

```bash
git add apps/web/package.json
git commit -m "chore(web): bump version — inbox วันแรก PR2

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/inbox-day-one-web
gh pr create --title "feat(inbox): inbox วันแรก PR2 — แท็บรอตอบ · เวลารอ · ลิงก์ห้อง · เตือน 24 ชม. FB" --body "$(cat <<'EOF'
## สรุป
หน้าเว็บของสเปก `docs/superpowers/specs/2026-09-05-inbox-day-one-readiness-design.md` (§7-§8.1) — ต้องมี PR1 บน prod ก่อน

- แท็บ "รอตอบ" เป็นค่าเริ่มต้น เรียงรอนานสุดก่อน ตัวเลขจาก `rooms/counts.waiting`
- ป้าย "รอ 3 ชม." บนแถว · จอว่าง = "ตอบครบทุกคนแล้ว"
- `/inbox/:roomId` — แชร์ลิงก์/refresh แล้วห้องเดิมยังเปิด
- แถบเตือนหน้าต่าง 24 ชม. ของ Facebook (เตือน ไม่ปิดปุ่ม) + เหตุผลในฟองส่งไม่สำเร็จ

## เทสต์
- vitest: chat-time / tab-counts / fb-window / send-error + ชุดเดิม
- `./tools/check-types.sh web` เขียว
- ตรวจตา: คลิกห้อง→URL เปลี่ยน · refresh · ปุ่มย้อนกลับจอแคบ · แถบเหลืองในห้อง FB ที่เกิน 24 ชม.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR3 — adapter Facebook (หลังสวิตช์)

### Task 17: `errorCode` + ส่งซ้ำด้วยแท็ก HUMAN_AGENT เมื่อเปิดสวิตช์

**Files:**
- Modify: `apps/api/src/modules/chat-engine/interfaces/channel-adapter.interface.ts` (`SendResult` L90-97)
- Modify: `apps/api/src/modules/chat-adapters/facebook.adapter.ts` (ctor L41 · `sendMessage` L58-155)
- Create: `apps/api/src/modules/chat-adapters/facebook.adapter.spec.ts`
- Modify: `apps/api/src/modules/chat-engine/services/message-router.service.ts` (`sendStaffMessage` บรรทัด `return { success: false, error: result.error ?? 'send failed' };`)

**Interfaces:**
- Produces: `SendResult.errorCode?: string` (รูปแบบ `fb:<code>[:<subcode>]`) · `parseGraphError(body: string): { code?: number; subcode?: number }` (export) · config `FB_HUMAN_AGENT_TAG_ENABLED` (`'true'` = เปิด · default ปิด)

- [ ] **Step 1: `SendResult`**

```ts
export interface SendResult {
  success: boolean;
  /** Platform's message ID for the sent message */
  externalMessageId?: string;
  error?: string;
  /** รหัส error แบบอ่านด้วยโปรแกรม เช่น `fb:10:2018278` (พ้นหน้าต่าง 24 ชม.) · `fb:190` (token) */
  errorCode?: string;
  /** Set when an adapter drops the bubble because the channel doesn't support it. */
  droppedReason?: string;
}
```

- [ ] **Step 2: เทสต์ adapter (ล้มก่อน)** — `facebook.adapter.spec.ts`:

```ts
import { FacebookAdapter, parseGraphError } from './facebook.adapter';
import { ChatChannel, MessageType } from '@prisma/client';

const WINDOW_ERR = JSON.stringify({
  error: { message: '(#10) This message is sent outside of allowed window.', code: 10, error_subcode: 2018278 },
});

function makeAdapter(humanAgent: boolean) {
  const integrationConfig = { getConfig: jest.fn().mockResolvedValue({ pageAccessToken: 'tok', pageId: 'page-1' }) };
  const configService = { get: jest.fn((k: string) => (k === 'FB_HUMAN_AGENT_TAG_ENABLED' ? (humanAgent ? 'true' : 'false') : undefined)) };
  const adapter = new FacebookAdapter(integrationConfig as any, configService as any);
  return adapter;
}

function fetchSequence(responses: { ok: boolean; status?: number; body: string }[]) {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      text: async () => r.body,
      json: async () => JSON.parse(r.body),
    });
  }
  (global as any).fetch = fn;
  return fn;
}

const msg = { externalUserId: 'PSID-1', channel: ChatChannel.FACEBOOK, type: MessageType.TEXT, text: 'สวัสดีค่ะ' };

describe('parseGraphError', () => {
  it('อ่าน code/subcode จาก body ของ Graph', () => {
    expect(parseGraphError(WINDOW_ERR)).toEqual({ code: 10, subcode: 2018278 });
    expect(parseGraphError('not json')).toEqual({});
  });
});

describe('FacebookAdapter.sendMessage — หน้าต่าง 24 ชม.', () => {
  afterEach(() => { delete (global as any).fetch; });

  it('สวิตช์ปิด: พ้นหน้าต่าง → ล้มครั้งเดียว พร้อม errorCode fb:10:2018278', async () => {
    const fetchMock = fetchSequence([{ ok: false, body: WINDOW_ERR }]);
    const res = await makeAdapter(false).sendMessage(msg as any);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('fb:10:2018278');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('สวิตช์เปิด: พ้นหน้าต่าง → ส่งซ้ำหนึ่งครั้งด้วย MESSAGE_TAG/HUMAN_AGENT แล้วสำเร็จ', async () => {
    const fetchMock = fetchSequence([
      { ok: false, body: WINDOW_ERR },
      { ok: true, body: JSON.stringify({ message_id: 'mid-2' }) },
    ]);
    const res = await makeAdapter(true).sendMessage(msg as any);
    expect(res).toEqual({ success: true, externalMessageId: 'mid-2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.messaging_type).toBe('MESSAGE_TAG');
    expect(secondBody.tag).toBe('HUMAN_AGENT');
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.messaging_type).toBe('RESPONSE');
  });

  it('สวิตช์เปิด: error อื่น (token) → ไม่ส่งซ้ำ errorCode fb:190', async () => {
    const fetchMock = fetchSequence([{ ok: false, body: JSON.stringify({ error: { message: 'bad token', code: 190 } }) }]);
    const res = await makeAdapter(true).sendMessage(msg as any);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('fb:190');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: รันให้ล้ม** — Run: `npm --prefix apps/api test -- src/modules/chat-adapters/facebook.adapter.spec.ts` · Expected: FAIL (ไม่มี `parseGraphError` / ctor รับ arg เดียว)

- [ ] **Step 4: แก้ adapter**

import เพิ่ม: `import { Optional } from '@nestjs/common';` (รวมกับบรรทัด `Injectable, Logger`) และ `import { ConfigService } from '@nestjs/config';`

ctor:

```ts
  constructor(
    private readonly integrationConfig: IntegrationConfigService,
    // Optional: spec/ผู้เรียกเดิมที่ new FacebookAdapter(integrationConfig) ยังใช้ได้
    @Optional() private readonly configService?: ConfigService,
  ) {}

  /** สวิตช์แท็ก HUMAN_AGENT (7 วัน) — ต้องได้ฟีเจอร์ Human Agent จาก Meta App Review ก่อนเปิด (สเปก §8.2) */
  private humanAgentTagEnabled(): boolean {
    return this.configService?.get<string>('FB_HUMAN_AGENT_TAG_ENABLED') === 'true';
  }
```

helper ระดับโมดูล (นอกคลาส ก่อน `@Injectable()`):

```ts
/** อ่าน code / error_subcode จาก body ของ Graph API ({"error":{"code":10,"error_subcode":2018278,...}}) */
export function parseGraphError(body: string): { code?: number; subcode?: number } {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number; error_subcode?: number } };
    const out: { code?: number; subcode?: number } = {};
    if (typeof parsed?.error?.code === 'number') out.code = parsed.error.code;
    if (typeof parsed?.error?.error_subcode === 'number') out.subcode = parsed.error.error_subcode;
    return out;
  } catch {
    return {};
  }
}

const FB_OUTSIDE_WINDOW = { code: 10, subcode: 2018278 };
```

ใน `sendMessage` แทนที่ส่วนตั้งแต่ `const body: Record<string, unknown> = { messaging_type: 'RESPONSE', ... }` จนถึงก่อน `} catch (err) {` ด้วย:

```ts
      const recipient = { id: message.externalUserId };
      const first = await this.postToGraph(pageId, pageAccessToken, {
        messaging_type: 'RESPONSE',
        recipient,
        message: fbMessage,
      });
      if (first.success) return first;

      // พ้นหน้าต่าง 24 ชม. + เปิดสวิตช์ → ส่งซ้ำหนึ่งครั้งด้วยแท็ก HUMAN_AGENT (7 วัน)
      // การส่งแรกไม่เคยถึงลูกค้า การส่งซ้ำจึงไม่ทำให้ซ้ำ
      if (
        first.errorCode === `fb:${FB_OUTSIDE_WINDOW.code}:${FB_OUTSIDE_WINDOW.subcode}` &&
        this.humanAgentTagEnabled()
      ) {
        this.logger.warn(`[FB] outside 24h window for ${message.externalUserId} — retrying with HUMAN_AGENT tag`);
        return this.postToGraph(pageId, pageAccessToken, {
          messaging_type: 'MESSAGE_TAG',
          tag: 'HUMAN_AGENT',
          recipient,
          message: fbMessage,
        });
      }
      return first;
```

และเพิ่มเมธอด private ใหม่ (วางถัดจาก `messagesUrl`):

```ts
  /** POST หนึ่งครั้งไป Send API · คืน SendResult พร้อม errorCode เมื่อ Graph ตอบ error */
  private async postToGraph(
    pageId: string,
    pageAccessToken: string,
    body: Record<string, unknown>,
  ): Promise<SendResult> {
    const res = await fetch(this.messagesUrl(pageId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pageAccessToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`[FB] API error ${res.status}: ${errBody}`);
      const { code, subcode } = parseGraphError(errBody);
      const errorCode = code != null ? `fb:${code}${subcode != null ? `:${subcode}` : ''}` : undefined;
      return { success: false, error: errBody, errorCode };
    }

    const data = (await res.json()) as { message_id?: string };
    return { success: true, externalMessageId: data.message_id };
  }
```

(บล็อก `catch (err)` เดิมเรื่อง timeout/Sentry คงไว้ครอบทั้ง try)

- [ ] **Step 5: `message-router` ต่อ errorCode เข้า error string**

```ts
    if (!result.success) {
      this.logger.error(`Failed to send staff message on ${room.channel}: ${result.error}`);
      // errorCode นำหน้า error ให้หน้าเว็บ (describeSendError) จับได้แม้ error body เปลี่ยนรูป
      return {
        success: false,
        error: [result.errorCode, result.error ?? 'send failed'].filter(Boolean).join(' '),
      };
    }
```

- [ ] **Step 6: config ตัวอย่าง** — ถ้ามี `apps/api/.env.example` (ตรวจ `grep -n FB_PAGE_ACCESS_TOKEN apps/api/.env.example`) เพิ่มใต้ตัวแปร FB ที่มีอยู่:

```
# แท็ก HUMAN_AGENT (ส่งได้ 7 วันหลังข้อความลูกค้า) — เปิดได้เมื่อ Meta อนุมัติฟีเจอร์ Human Agent แล้วเท่านั้น
FB_HUMAN_AGENT_TAG_ENABLED=false
```

- [ ] **Step 7: รันให้ผ่าน + ชุด chat ทั้งหมด + typecheck**

Run: `npm --prefix apps/api test -- src/modules/chat-adapters src/modules/chat-engine && ./tools/check-types.sh api`
Expected: PASS · 0 errors

- [ ] **Step 8: Commit + PR3**

```bash
git checkout -b feat/inbox-fb-human-agent origin/main
# (cherry-pick หรือทำงานบน branch นี้ตั้งแต่ Step 1)
git add apps/api/src/modules/chat-engine/interfaces/channel-adapter.interface.ts apps/api/src/modules/chat-adapters/facebook.adapter.ts apps/api/src/modules/chat-adapters/facebook.adapter.spec.ts apps/api/src/modules/chat-engine/services/message-router.service.ts apps/api/.env.example
git commit -m "feat(chat-fb): errorCode จาก Graph + ส่งซ้ำด้วยแท็ก HUMAN_AGENT เมื่อพ้น 24 ชม. (หลังสวิตช์ FB_HUMAN_AGENT_TAG_ENABLED)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/inbox-fb-human-agent
gh pr create --title "feat(chat-fb): แท็ก HUMAN_AGENT หลังสวิตช์ + errorCode ของ Graph" --body "$(cat <<'EOF'
## สรุป
สเปก `docs/superpowers/specs/2026-09-05-inbox-day-one-readiness-design.md` §8.2

- adapter คืน `errorCode` เช่น `fb:10:2018278` (พ้นหน้าต่าง 24 ชม.) ให้หน้าเว็บแปลเหตุ
- เมื่อ `FB_HUMAN_AGENT_TAG_ENABLED=true` และ Graph ตอบพ้นหน้าต่าง → ส่งซ้ำหนึ่งครั้งด้วย `MESSAGE_TAG` / `HUMAN_AGENT`
- **สวิตช์ปิดเป็นค่าเริ่มต้น** — เปิดได้เมื่อเจ้าของขอฟีเจอร์ Human Agent ใน Meta App Dashboard และได้รับอนุมัติแล้ว

## เทสต์
- jest ใหม่ `facebook.adapter.spec.ts` (mock fetch) · chat-engine ชุดเดิมเขียว · tsc เขียว

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## หลัง merge — ลำดับขึ้น prod (สเปก §9.3)

1. **PR1 merge → deploy** (migration รันโดย pipeline ตามปกติ)
2. **รัน CLI บน prod ทันที** (dry-run ก่อน แล้วจริง) ผ่านกลไก Cloud Run Job เดียวกับ `backfill-contacts` โดย override command เป็น `node dist/src/cli/reset-inbox-day-one.cli.js` และตั้ง `CONFIRM_BACKFILL=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice_prod ALLOW_PROD_BACKFILL=YES_I_AM_SURE`
3. **ตรวจด้วย MCP `bestchoice-db`** (อ่านอย่างเดียว):
   ```sql
   SELECT count(*) FILTER (WHERE waiting_since IS NOT NULL) AS waiting,
          count(*) FILTER (WHERE assigned_to_id IS NOT NULL) AS still_assigned,
          count(*) FILTER (WHERE unread_count > 0) AS unread_gt0
   FROM chat_rooms WHERE deleted_at IS NULL
   ```
   คาดหวัง: `waiting` ≈ 52 (นับใหม่ ณ วันรัน) · `still_assigned` = 0 · `unread_gt0` ≈ จำนวนห้องที่ข้อความสุดท้ายเป็นของลูกค้า
4. **PR2 merge → deploy** → เปิด `/inbox` เห็นแท็บรอตอบเป็นค่าเริ่มต้น ตัวเลข ≈ 52 เรียงรอนานสุดก่อน
5. **ทดสอบจริงก่อนบอกทีม (สเปก §9.3 ข้อ 5):**
   - ตอบ 1 ห้องที่รอไม่เกิน 24 ชม. จาก inbox → ห้องหายจากแท็บรอตอบ + ผู้ดูแล = คนที่ตอบ (ตรวจ `assigned_to_id` และ `staff_chat_activities.metadata->>'source' = 'reply'`)
   - ตอบ 1 ห้องจากแอป Facebook → echo เข้ามาแล้วห้องหายจากแท็บรอตอบ โดย `assigned_to_id` ยังเป็น NULL
6. **PR3** ขึ้นเมื่อไหร่ก็ได้ · เปิด `FB_HUMAN_AGENT_TAG_ENABLED=true` เฉพาะหลัง Meta อนุมัติ
7. **บันทึกความจำ** อัปเดต `bestchoice-inbox-vs-obi-chat-gaps` ว่า PR ไหนขึ้นแล้ว และตัวเลขหลัง CLI

## Self-review (ทำแล้ว)

- **Spec coverage:** §4.1→T1 · §4.2→T2 · §4.3→T3/T4/T5 · §4.4→T6 · §4.5→T7 · §4.6→T10 ด่านตรวจ · §5→T8 · §6→T9 · §7→T11-T14 · §8.1→T15 · §8.2→T17 · §9→T10/T16/หลัง merge
- **Type consistency:** `clearWaiting(roomId)` (T3) ← T4 · `claimIfUnassigned(roomId, staffId): Promise<boolean>` (T8) · `deriveTabCounts → { mine, all, unread, waiting }` (T12) ← ConversationList/ChannelFilter · `failedSends[].reason` (T15 index ↔ ChatPanel) · `SendResult.errorCode` (T17) ← message-router
- **สิ่งที่ตั้งใจไม่ทำ:** ไม่ปิดปุ่มส่งเมื่อพ้น 24 ชม. (scrutinize ข้อ 6) · BOT ไม่ล้าง waiting (ข้อ 2) · ไม่ล้าง handoffMode ตอนตอบ · ไม่แตะ ChatSnooze/LINE
