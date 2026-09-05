# Staff Inbox — เตรียมให้ทีมย้ายมาใช้ได้วันแรก (Day-one readiness) — Design

**วันที่:** 2026-09-05
**สถานะ:** Approved (brainstormed + scrutinized 2 รอบ)
**ขอบเขต:** `apps/api/src/modules/chat-engine/**`, `apps/api/src/modules/chat-adapters/facebook.adapter.ts`, `apps/api/src/modules/staff-chat/staff-chat.controller.ts`, `apps/api/src/cli/**`, `apps/web/src/pages/UnifiedInboxPage/**`, `apps/web/src/App.tsx`
**ที่มา:** เจ้าของขอเทียบหน้าแชทใหม่ของ OBI กับ inbox ของ BESTCHOICE → วัด prod แล้วพบว่าทีมยังไม่ได้ใช้หน้านี้เลย → เจ้าของตัดสินให้ "ปรับให้ใช้งานได้ก่อน"

---

## 1. ข้อเท็จจริงที่วัดจาก prod (2026-09-05 · 30 วันย้อนหลัง)

| ตัวชี้วัด | ค่า |
|---|---|
| ห้องแชททั้งหมด | 8,320 ห้อง ทุกห้องเป็น FACEBOOK (ACTIVE 131 · IDLE 8,189) ไม่มีห้อง LINE |
| ข้อความพนักงาน | 22,855 ใน 2,780 ห้อง · **ส่งจาก inbox = 0** ทุกใบเป็น echo จาก Page Inbox ของ Facebook |
| ห้องที่ถูกเปิดอ่านใน inbox | 21 |
| ลูกค้าที่ข้อความสุดท้ายเป็นของลูกค้าและไม่มีใครตอบ | **231 ห้อง** (TEXT 160 · IMAGE 53 · FILE 17) · 222 ห้องถูก cron ซ่อนเป็น IDLE |
| ในนั้นยังตอบได้ตอนนี้ (ไม่เกิน 24 ชม.) | 10 · ตอบได้ถ้ามีแท็ก HUMAN_AGENT (ไม่เกิน 7 วัน) อีก 42 · เกิน 7 วัน 179 |
| ห้องที่มีผู้ดูแล | ทุกห้อง (autoAssign แจกแบบวนตอนสร้างห้อง → 8 คนถือคนละ ~800 ห้องที่ไม่เคยแตะ) |
| unread_count > 0 | 130 จาก 131 ห้อง ACTIVE · 8,069 จาก 8,189 ห้อง IDLE |
| บอท | 352 ข้อความใน 3 ห้อง (whitelist) · handoff_mode = 1 ห้อง |
| ผู้ใช้ที่ active | 8 คน (OWNER 7 · BRANCH_MANAGER 1) · ทีมนั่งหน้าคอมเปิด inbox ค้างไว้ |

สรุป: หน้านี้ตอบคำถาม "มีอะไรใหม่" (unread) ทั้งที่งานจริงคือ "ใครรอเราอยู่" และ cron ซ่อนคนที่รอออกจากคิวพอดีตอนที่นานพอจะเป็นปัญหา

## 2. เป้าหมาย / ไม่ใช่เป้าหมาย

**เป้าหมาย** — ทีม 8 คนเปิด `/inbox` วันแรกแล้วเห็นตัวเลขที่เชื่อได้ ตอบลูกค้าที่รอได้จากหน้านี้ และห้องมีเจ้าของจากการตอบจริง โดยยังตอบจากแอป Facebook ควบคู่ไปได้ระหว่างเปลี่ยนผ่าน

**คำตัดสินของเจ้าของ**
1. **ใครตอบก่อนได้เป็นเจ้าของห้อง** (ไม่ใช่แจกอัตโนมัติ ไม่ใช่หัวหน้าจ่ายงาน)
2. ทีมนั่งหน้าคอม เปิด inbox ค้างไว้ → ใช้เสียง + แจ้งเตือนเบราว์เซอร์ที่มีอยู่ ไม่ต้องมี LINE ถึงพนักงาน
3. แนวทาง A "ข้อมูลพูดความจริงก่อน แล้วค่อยแต่งหน้า"

**ไม่ใช่เป้าหมาย (ตัดออกอย่างตั้งใจ — วัดแล้วไม่จำเป็นวันนี้)**
- แจ้งเตือน LINE ถึงพนักงาน · ล้างธง "ต้องตอบ" (handoffMode) ตอนพนักงานตอบ · แท็บ "ยังไม่มีผู้ดูแล" · ซ่อม ChatSnooze · โน้ตในไทม์ไลน์ · แผงภาพรวมทีม · แถวคิวแบบ OBI
- สี ฟอนต์ ระยะ แผง 360 composer มือถือ — ผ่านรอบ polish สิงหาคมแล้ว ไม่แตะ
- ปัญหา save≠delivered ที่ทำให้ข้อความส่งล้มแสดง 2 ฟอง (pre-existing, มีบันทึกใน batch 7/D)

## 3. หลักการเดียวที่ทุกส่วนต้องเคารพ

> **"รอตอบ" ล้างได้ด้วยคำตอบจาก "คน" ที่ "ถึงลูกค้าแล้ว" เท่านั้น**

ผลจาก scrutinize: ถ้าล้างตอน *บันทึก* ข้อความพนักงาน การส่งที่ล้ม (พ้น 24 ชม., token หมดอายุ) จะซ่อนลูกค้าที่ไม่เคยได้รับคำตอบ · ถ้าให้ *บอท* ล้างได้ ข้อความ "ปิดทำการ" ตอนกลางคืนจะซ่อนลูกค้าทุกคนจากคิวตอนเช้า

## 4. ส่วนที่ 1 · นิยาม "รอตอบ" (`ChatRoom.waitingSince`)

### 4.1 Data model
```prisma
// ChatRoom
/// เวลาที่ลูกค้าเริ่มรอคำตอบจากคน — ตั้งเมื่อข้อความลูกค้าเข้ามาและยังว่าง ·
/// ล้างเมื่อคำตอบจากพนักงาน "ถึงลูกค้าแล้ว" (inbox ส่งสำเร็จ / echo จาก Page Inbox) หรือปิดแชท ·
/// บอท/ระบบ/การเปิดอ่าน/การส่งที่ล้ม ไม่ล้าง
waitingSince DateTime? @map("waiting_since")
@@index([waitingSince])
```
Migration: `20261000300000_chat_room_waiting_since` (คอลัมน์ nullable + index — ทันทีบนตาราง 8k แถว)

### 4.2 ตั้งค่า (set)
- `RoomManagerService.saveMessage` (room-manager.service.ts ~L293-310) สาขา `role === CUSTOMER`: หลัง update เดิม เพิ่ม
  `prisma.chatRoom.updateMany({ where: { id, waitingSince: null }, data: { waitingSince: msg.createdAt } })`
  — set-if-null แบบ atomic จึงเก็บเวลา **ข้อความแรกที่ยังไม่ได้ตอบ** ไม่ใช่ใบล่าสุด และไม่ต้องอ่านก่อนเขียน
- ห้อง IDLE ที่ลูกค้าทักกลับ: `routeInbound` ตั้ง ACTIVE + ล้าง resolvedAt อยู่แล้ว (L103-106) แล้วจึง saveMessage → waitingSince ถูกตั้งตามปกติ ไม่ต้องแก้เพิ่ม

### 4.3 ล้างค่า (clear) — 3 จุดเท่านั้น
| จุด | เหตุผล |
|---|---|
| `RoomManagerService.markOutboundSent(messageId, externalMessageId)` | เรียกเฉพาะเมื่อ adapter ส่งสำเร็จ (message-router.service.ts L949) = ถึงลูกค้าแล้ว |
| `MessageRouterService.mirrorOutbound` เมื่อ `role === STAFF` (echo จาก Page Inbox) | echo = Facebook ยืนยันว่าส่งถึงแล้ว · ทำหลัง saveMessage สำเร็จ · กรณี P2002 (echo ซ้ำ) ไม่ต้องล้างซ้ำ |
| `AssignmentService.resolve` | ปิดแชทโดยไม่ต้องตอบ (ลูกค้าพิมพ์ขอบคุณ) ต้องออกจากคิว |

**ไม่ล้าง:** `saveMessage` ทุก role · BOT / SYSTEM / AUTO_TRIGGER · `markAsRead` / `markAllAsRead` · การเปิดห้อง · การส่งที่ล้ม · `reopen` (ปล่อยให้ข้อความลูกค้าถัดไปตั้งเอง)

### 4.4 cron
`ChatCronService.markIdleRooms` (chat-cron.service.ts L59-72) เพิ่ม `waitingSince: null` ใน where → ห้องที่ลูกค้ารอไม่ถูกทำ IDLE อีก

### 4.5 API
- `listRooms` รับ `waiting?: boolean` → `where.waitingSince = { not: null }` · **เมื่อ waiting = true เรียง `[{ waitingSince: 'asc' }]` อย่างเดียว** (ปักหมุดไม่มีผลในแท็บนี้) · แท็บอื่นเรียงแบบเดิม
- `getRoomBadgeCounts` เพิ่ม `waiting` = นับห้อง `deletedAt null AND waitingSince not null` (ทั้งบริษัท ไม่ผูกคน)
- controller `GET /staff-chat/rooms` รับ query `waiting` (แปลง boolean ด้วย `@Transform` แบบเดียวกับ `unreadOnly` — ห้ามใช้ `@Type(() => Boolean)` ที่ทำให้ `'false'` เป็น true)
- payload รายการห้องใช้ `include` อยู่แล้ว → `waitingSince` ติดมาอัตโนมัติ ไม่ต้องแก้ select

### 4.6 ผลข้างเคียงที่ต้องรู้
- **วันที่เปิดบอท Facebook เต็มตัว** ห้องที่บอทตอบแล้วจะยังค้างในคิว "รอตอบ" จนกว่าคนจะตอบ ต้องเพิ่มสถานะ "บอทตอบแล้ว" ตอนนั้น (นอกขอบเขตรอบนี้ — บันทึกไว้ในหัวข้อ 10)
- **ผู้เขียนที่ข้าม `RoomManagerService.saveMessage`** (สำรวจใหม่ 2026-09-05 — ฉบับก่อนหน้าของหัวข้อนี้เขียนผิด 2 ข้อ: อ้างว่า `chatbot-finance/services/chat-room.service.ts` ไม่มีผู้เรียก และอ้างว่าไม่มีตัวไหนเขียน role CUSTOMER)
  - `line-oa/payment-links/payment-link.service.ts:340` · `notifications/services/notification-dispatch.service.ts:314` — เขียน `chatMessage.create` ตรง ฝั่ง LINE ไม่ใช่ role CUSTOMER → ไม่กระทบ
  - 🔴 **`chatbot-finance/services/chat-room.service.ts` มีผู้เรียกจริง**: `chatbot-finance/services/chatbot-finance.service.ts` เรียก `ChatRoomService.saveMessage` ด้วย `role: MessageRole.CUSTOMER` **6 จุด** (บรรทัด 205, 228, 255, 268, 279, 354) — เป็นตัวเขียนห้อง+ข้อความคู่ขนานครบชุดของช่องทาง LINE_FINANCE ที่**ไม่แตะ `RoomManagerService` เลย** ⇒ **ไม่เคยตั้ง `waitingSince`**
  - ผลกระทบวันนี้ = **ศูนย์** (prod ไม่มีห้อง LINE เลย — ตาราง §1) และล้มไปทางที่ปลอดภัย: ลูกค้า LINE จะ*ไม่ปรากฏ*ในคิว ไม่ใช่ถูกล้างผิด ⇒ ไม่แก้ในรอบนี้ แต่เป็นเงื่อนไขบังคับก่อนเปิด LINE (§10)
  - **ตรวจซ้ำแล้วว่าถูกต้อง**: `staff-chat/web-widget.gateway.ts:111` และเส้นทาง inbound ของ router เอง (`message-router.service.ts:187, 615`) เขียน CUSTOMER ผ่าน `roomManager.saveMessage` ทั้งคู่ → `waitingSince` ถูกตั้งตามปกติ

## 5. ส่วนที่ 2 · ใครตอบก่อนได้เป็นเจ้าของ

- **เลิกแจกอัตโนมัติ:** ลบการเรียก `assignmentService.autoAssign(room.id)` ใน `RoomManagerService.createRoom` (room-manager.service.ts L213-217) · คงเมธอด `autoAssign` ไว้ (ไม่มีผู้เรียกอื่น ลบได้ในรอบหลังถ้าอยากเก็บกวาด)
- **รับเรื่องเมื่อคำตอบถึงลูกค้า:** เพิ่ม `AssignmentService.claimIfUnassigned(roomId, staffId): Promise<boolean>`
  - `prisma.chatRoom.updateMany({ where: { id: roomId, assignedToId: null, deletedAt: null }, data: { assignedToId: staffId, status: ACTIVE } })`
  - เฉพาะเมื่อ `count === 1`: บันทึก `staffChatActivity { action: 'assign', metadata: { roomId, source: 'reply' } }` + `gateway.emitRoomUpdate` + `emitToStaff('chat:assigned')` เหมือน `assign()` เดิม
  - แข่งกัน 2 คน → ได้แค่คนเดียว ไม่มี activity ซ้ำ
- **จุดเรียก:** `MessageRouterService.sendStaffMessage` **หลัง** `markOutboundSent` (ส่งสำเร็จแล้วเท่านั้น — สอดคล้องหลักการข้อ 3) · inject `AssignmentService` แบบ `@Optional()` เหมือน dependency อื่นในคลาส (module ให้ provider อยู่แล้ว ไม่มี cycle)
- **echo ไม่รับเรื่อง:** Facebook ไม่บอกว่าใครกดส่ง ห้องนั้นจึงยังว่าง — ถูกต้องตามความจริง
- ปุ่ม "รับเรื่องนี้" และ "โอนให้พนักงาน" ใน SessionActions คงไว้ · ด่านกันโอนหลังเซ็นสัญญา (T4-C11) ไม่แตะ
- **ยืนยันแล้วว่าไม่กระทบค่าคอม:** ไม่มีโมดูลนอกแชทอ่าน `chatRoom.assignedToId` (crm-pipeline ใช้ `crmLead`) และด่านโอนอ่านสัญญาจาก `customerId`

## 6. ส่วนที่ 3 · ล้างข้อมูลครั้งเดียว (CLI)

ไฟล์ `apps/api/src/cli/reset-inbox-day-one.cli.ts` + script `reset:inbox-day-one` ใน `apps/api/package.json` ตามแบบ `backfill-contacts.cli.ts`: ต้องมี `CONFIRM_BACKFILL=YES_I_AM_SURE`, `EXPECTED_DB_NAME`, และ `ALLOW_PROD_BACKFILL` บน prod · ค่าเริ่มต้นเป็น **dry-run** พิมพ์ตัวเลขก่อน/หลัง · ทำใน transaction เดียว · รันซ้ำแล้วได้ 0 การเปลี่ยนแปลง

| ขั้น | SQL (แนวคิด) | คาดว่ากระทบ (ณ 2026-09-05) |
|---|---|---|
| 1 | `assigned_to_id = NULL` ทุกห้องที่ `deleted_at IS NULL` | ~8,318 |
| 2 | `unread_count = 0` ในห้องที่ข้อความสุดท้าย (ไม่ลบ) **ไม่ใช่** CUSTOMER | ~8,000 |
| 3 | ห้องที่ข้อความสุดท้ายเป็น CUSTOMER และ `last_message_at > now() - 7 days`: `waiting_since` = `MIN(created_at)` ของข้อความ CUSTOMER ที่อยู่หลังข้อความ STAFF/BOT ใบล่าสุด (ถ้าไม่มี STAFF/BOT เลย = ข้อความแรกของห้อง) · `status = ACTIVE` · `resolved_at = NULL` | 52 |
| 4 | ห้องที่รอเกิน 7 วัน **ไม่แตะ** (IDLE ตามเดิม) | 179 |

เหตุผลขั้น 4: ตอบไม่ได้แล้วไม่ว่าทางไหน ดึงขึ้นคิววันแรกจะทำให้คิวเต็มไปด้วยงานที่ทำไม่ได้ · ถ้าลูกค้าทักใหม่ routeInbound จะเปิดห้องและตั้ง waiting ให้เอง

**จังหวะรัน:** ทันทีหลัง deploy PR1 และ **ก่อน** ทีมเริ่มตอบจาก inbox — เพราะขั้น 1 ล้างผู้ดูแลทุกห้อง การรับเรื่องที่เกิดระหว่างนั้นจะถูกล้างไปด้วย

## 7. ส่วนที่ 4 · หน้าเว็บ — แผงซ้ายตอบว่า "ใครรอเราอยู่"

- **แท็บ "รอตอบ"** ใน `ChannelFilter` (`InboxTab = 'waiting' | 'mine' | 'all' | 'unread'`, ไอคอน `Clock`) วางเป็นแท็บแรก · `index.tsx` ค่าเริ่มต้น `tab: 'waiting'` · ส่ง `waiting: true` เป็น query param · ตัวเลขจาก `serverCounts.waiting` (fallback ฝั่งเว็บ `deriveTabCounts` นับ `waitingSince != null` จากห้องที่โหลดแล้ว)
- **เวลารอบนแถว** `ConversationItem`: เมื่อ `session.waitingSince` มีค่า แสดงป้าย destructive "รอ {formatWaitDuration}" ในแถวป้ายบรรทัดล่าง · helper ล้วน `formatWaitDuration(iso, now)` ใน `lib/chat-time.ts` → `"5 นาที"` / `"3 ชม."` / `"2 วัน"` (นาที < 60 · ชม. < 48 · วัน) + vitest · เวลาข้อความล่าสุดมุมขวาคงเดิม
- **จอว่างของแท็บรอตอบ** ใน `ConversationList`: ไอคอน `CheckCheck` + "ตอบครบทุกคนแล้ว" + "ลูกค้าที่ทักมาใหม่จะขึ้นที่นี่" (แยกจาก 3 กรณีว่างเดิม)
- **ลิงก์ห้องใน URL:** `App.tsx` เพิ่ม `<Route path="/inbox/:roomId">` ชี้ `UnifiedInboxPage` ตัวเดิม (roles เดิม) · `index.tsx` อ่าน `useParams().roomId` เป็นแหล่งความจริงของ `activeRoomId` · `handleSelectRoom` → `navigate('/inbox/' + id)` · ปุ่มย้อนกลับมือถือ → `navigate('/inbox')` · effect ผูกกับ roomId param ทำ leave/join/view WS แทน handleSelectRoom เดิม · `FULL_BLEED_ROUTES` ใน MainLayout จับ prefix `/inbox/` อยู่แล้ว (L141) ไม่ต้องแก้
- **ความหมายแท็บเดิม:** "ของฉัน" = ห้องที่ฉันรับเรื่องแล้วจริง (โค้ดเดิม `assignedToId = me`) · "ยังไม่อ่าน" คงไว้แต่ไม่ใช่ค่าเริ่มต้น
- **bump version** `apps/web/package.json` ทุก deploy (กติกาโปรเจกต์)

## 8. ส่วนที่ 5 · หน้าต่าง 24 ชั่วโมงของ Facebook

**หลัก: เตือน ไม่ปิด** — หน้าเว็บไม่ตัดสินแทน Facebook และไม่ต้องรู้ค่าสวิตช์หลังบ้าน

### 8.1 หน้าเว็บ (PR2)
- helper ล้วน `fbWindowState(lastCustomerAt, now)` → `'open' | 'closing' | 'closed'` (closing = เหลือ ≤ 3 ชม.) + vitest
- `ChatPanel` ห้อง channel FACEBOOK: หา `createdAt` ของข้อความ CUSTOMER ใบล่าสุดจาก `messages` (เรียง asc อยู่แล้ว) · `closing` → แถบเหลือง "ตอบได้อีก N ชม. ก่อนพ้นหน้าต่าง 24 ชม. ของ Facebook" · `closed` → แถบเหลือง "พ้น 24 ชม. แล้ว Facebook อาจไม่ให้ส่งข้อความปกติ" · **ปุ่มส่งและทางส่งอื่นทำงานตามปกติทุกทาง**
- **บอกเหตุเมื่อส่งล้ม:** `failedSends[]` เพิ่ม `reason?: string` · เส้น HTTP ใช้ `data.error` (index.tsx L364 ตอนนี้ทิ้งค่า) · เส้น WS ใช้ `data.error` ที่ gateway ส่งอยู่แล้ว (staff-chat.gateway.ts L233-237) · helper ล้วน `describeSendError(error)` แปลรหัสที่รู้จัก: `(#10)`/`2018278` → "พ้น 24 ชม. Facebook ไม่ให้ส่งข้อความปกติ" · `(#190)` → "token ของเพจหมดอายุ ต้องต่ออายุในตั้งค่า" · อื่น ๆ แสดงข้อความดิบตัดที่ 120 ตัวอักษร · แสดงใต้ "ส่งถึงลูกค้าไม่สำเร็จ" ในฟองแดง

### 8.2 adapter (PR3 · หลังสวิตช์ · ปิดเป็นค่าเริ่มต้น)
- config `FB_HUMAN_AGENT_TAG_ENABLED` (default `false`)
- `FacebookAdapter.sendMessage`: parse `errBody` เป็น JSON → `error.code`, `error.error_subcode` · คืน `errorCode` เช่น `fb:10:2018278` พร้อม `error` เดิม
- ถ้าสวิตช์เปิด และ code 10 / subcode 2018278 → ส่งซ้ำ **หนึ่งครั้ง** ด้วย `{ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' }` · การส่งที่ล้มไม่เคยถึงลูกค้า ส่งซ้ำจึงไม่ทำให้ซ้ำ
- `message-router` ส่ง `errorCode` ผ่าน `{ success: false, error }` (ต่อท้าย error string) ให้ controller/WS เดิมนำส่ง
- **งานเจ้าของนอกโค้ด:** ขอฟีเจอร์ Human Agent ใน Meta App Dashboard (facebook-app-review.service.ts:381 ระบุว่ายังไม่ได้เปิด) → เปิดสวิตช์หลังอนุมัติ · ระหว่างรอ ลูกค้า 42 คนที่รอ 1-7 วันยังตอบไม่ได้

## 9. ส่วนที่ 6 · ทดสอบและลำดับขึ้น prod

### 9.1 เทสต์หลังบ้าน (jest ชุดเดิม)
| ไฟล์ | เพิ่ม |
|---|---|
| `room-manager.service.spec.ts` (`describe('saveMessage')` มีอยู่) | CUSTOMER → updateMany set-if-null · STAFF/BOT → ไม่แตะ waitingSince · `markOutboundSent` ล้าง · `createRoom` ไม่เรียก autoAssign · `listRooms({waiting:true})` where/orderBy · `getRoomBadgeCounts().waiting` |
| `message-router.service.spec.ts` | ส่งสำเร็จ → markOutboundSent แล้ว claimIfUnassigned · ส่งล้ม → ไม่เรียกทั้งคู่ · `mirrorOutbound` STAFF ล้าง waiting / BOT ไม่ล้าง |
| `assignment.service.spec.ts` | `claimIfUnassigned` count 1 → activity + emit · count 0 → เงียบ · `resolve` ล้าง waiting |
| `chat-cron.service.spec.ts` (ใหม่) | where ของ markIdleRooms มี `waitingSince: null` |
| `facebook.adapter.spec.ts` | parse errorCode · retry ด้วยแท็กเฉพาะเมื่อสวิตช์เปิด + code ตรง · ไม่ retry กรณีอื่น |
| CLI spec | dry-run ไม่เขียน · เกณฑ์ 7 วัน · MIN(created_at) หลัง STAFF/BOT ล่าสุด · idempotent |

### 9.2 เทสต์หน้าเว็บ (vitest)
`formatWaitDuration` · `fbWindowState` · `describeSendError` · `deriveTabCounts` นับ waiting · `tsc` เขียว · ชุดเดิม 1,092 ตัวเขียว

### 9.3 ลำดับ
1. **PR1 หลังบ้าน:** migration + §4 + §5 + CLI (§6) → merge → deploy
2. **รัน CLI บน prod** (dry-run → จริง) → ตรวจด้วย MCP: `waiting_since IS NOT NULL` ≈ 52 · `assigned_to_id IS NULL` = ทุกห้อง · `unread_count > 0` เหลือเฉพาะห้องที่ข้อความสุดท้ายเป็น CUSTOMER
3. **PR2 หน้าเว็บ:** §7 + §8.1 + bump version → deploy → เปิด `/inbox` เห็นแท็บรอตอบ ≈ 52 ห้อง เรียงรอนานสุดก่อน
4. **PR3 adapter:** §8.2 หลังสวิตช์ ขึ้นเมื่อไหร่ก็ได้ · เปิดสวิตช์เมื่อ Meta อนุมัติ
5. **ทดสอบจริงก่อนบอกทีม:** ตอบ 1 ห้องที่รอไม่เกิน 24 ชม. จาก inbox → ห้องหายจากแท็บรอตอบ + ผู้ดูแลเป็นคนที่ตอบ · ตอบ 1 ห้องจากแอป Facebook → echo เข้ามาแล้วห้องหายจากแท็บรอตอบโดยผู้ดูแลยังว่าง

### 9.4 วันแรกของทีม
เปิด `/inbox` → กดกระดิ่งอนุญาตแจ้งเตือนเบราว์เซอร์ครั้งเดียว → เปิดแท็บค้างไว้ → ทำงานจากแท็บ "รอตอบ" บนลงล่าง · ตอบจากแอป Facebook ควบคู่ได้ ระบบนับว่าตอบแล้วเหมือนกัน

## 10. ความเสี่ยงและสิ่งที่ต้องกลับมาทำเมื่อสถานการณ์เปลี่ยน
- **เปิดบอท Facebook เต็มตัว** → ต้องมีสถานะ "บอทตอบแล้ว" มิฉะนั้นคิวรอตอบจะเต็มไปด้วยห้องที่บอทดูแลอยู่
- **เปิดช่องทาง LINE** → ต้องทำก่อน: ให้ `ChatRoomService.saveMessage` (`chatbot-finance/services/chat-room.service.ts`) เดินผ่าน `RoomManagerService` หรือทำ set-if-null ของ `waitingSince` ซ้ำในนั้น — ตอนนี้ผู้เรียก 6 จุดใน `chatbot-finance.service.ts` เขียน CUSTOMER โดยข้าม `RoomManagerService` ทั้งหมด (§4.6) ⇒ ห้อง LINE จะไม่มีวันเข้าคิว "รอตอบ"
  - **ท่าตรวจที่ถูก: grep `role: MessageRole.CUSTOMER` แล้วดูว่าจุดไหนไม่ได้ผ่าน `RoomManagerService.saveMessage`** — การ grep `prisma.chatMessage.create(` (ท่าเดิม) **มองไม่เห็น wrapper service** อย่าง `ChatRoomService` จึงพลาดช่องนี้มารอบแรก
- **เทสต์ที่อยากได้ก่อนขึ้น PR หน้าเว็บ** (ยังไม่ทำในรอบนี้) — 2 ตัว แบบต่อ DB จริง ตาม harness ที่มีอยู่แล้วใน `room-manager.recent-messages.db.spec.ts`:
  1. ข้อความลูกค้าเข้า → echo ข้อความทักทายอัตโนมัติของเพจตามมา → ห้องต้อง**ยังอยู่**ใน `listRooms({ waiting: true })`
  2. ยิง endpoint ข้อความสำเร็จรูป (canned response) → ห้องต้อง**หลุด**จากคิว "รอตอบ"
- **คำถามค้างที่เจ้าของต้องตอบ (สาขานี้พึ่งคำตอบนี้อยู่):** ข้อความทักทายอัตโนมัติของเพจ Facebook **ยังเปิดอยู่ไหม** — ถ้าปิดไปแล้ว ด่านกันของ Fix 1 (`RoomManagerService.shouldSkipFirstOutboundClear`) ถอดออกได้
- **ทีมเริ่มใช้จริง 1 เดือน** → ค่อยเลือกจากรายการที่ตัดออก (นัดติดตาม · ภาพรวมทีม · โน้ตในไทม์ไลน์) ตามที่ติดขัดจริง ไม่ใช่ตามที่ OBI มี
- ข้อความส่งล้มยังแสดง 2 ฟอง (save≠delivered) เป็นของเดิม ไม่แก้ในรอบนี้

## 11. อ้างอิง
- ผลวิเคราะห์และหลักฐานทั้งหมด: memory `bestchoice-inbox-vs-obi-chat-gaps`
- สเปกรอบก่อนของ inbox: `docs/superpowers/specs/2026-06-25-inbox-ux-overhaul-design.md`
- ต้นแบบแนวคิด "รอตอบ / ใครตอบก่อนได้เป็นเจ้าของ / จอว่าง = เป้าหมายของวัน": OBI `front/src/pages/chatNew` (สเปก §4, §12)
