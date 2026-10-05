# F1 Work Queue and SLA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inbox แสดงงานที่ต้องทำวันนี้ และเตือนผู้รับผิดชอบ/หัวหน้าเมื่อรอเกินกำหนด

**Architecture:** อ่านคิวจาก ChatRoom/Todo เดิม เพิ่ม response cycles สำหรับวัดทุกรอบ และ staff inbox แบบ durable สำหรับทุกฟีเจอร์ ใช้ predicate สิทธิ์เดียวกันกับ list/count/deep link

**Tech Stack:** NestJS, Prisma/PostgreSQL, React, TanStack Query, Jest/Vitest/Playwright

**Spec:** [six-features design](../specs/2026-10-05-chat-operations-six-features-design.md), [master](2026-10-05-chat-operations-master.md)

## Global Constraints

กติกา 1–10 ของ spec ทั้งหมด. ไม่เปลี่ยน first-successful-reply ownership หรือ after-hours bot. SLA 5/15 business minutes เป็นค่าเสนอที่ปรับได้. งานเก่าไม่ยิงเตือนเป็นชุดเมื่อเปิดใช้

## Review Focus

- ข้ามบริษัท/สาขา/ถอนสิทธิ์ทั้ง list และ counts: T1
- ส่งล้ม, BOT ตอบ, webhook retry, เปิดอ่านไม่ปิดวงรอบ: T2
- คร่อมเวลาปิดร้าน/เปิดร้านและ cron สองตัวไม่ยิงซ้ำ: T3
- เปลี่ยนเจ้าของก่อน cron commit ต้องไม่แจ้งคนเก่า: T3
- คืนค่า empty/error/loading/mobile ไม่แสดงศูนย์ปลอม: T4

### Task 1: สิทธิ์ร่วม, staff inbox และ isolated harness

**Files:** Create `packages/shared/src/chat-work.ts`, `apps/api/src/modules/staff-chat/services/chat-work-access.service.ts`, `apps/api/src/modules/staff-chat/services/chat-work-access.service.spec.ts`, `apps/api/src/modules/staff-chat/services/staff-inbox.service.ts`, `apps/api/src/modules/staff-chat/staff-inbox.controller.ts`, `apps/api/src/modules/staff-chat/dto/staff-inbox.dto.ts`, `apps/api/e2e/jest-chat-operations.json`, `apps/api/e2e/chat-operations-access.e2e-spec.ts`. Modify `packages/shared/src/index.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/modules/staff-chat/staff-chat.module.ts`, `tools/test-chat-credit.sh`; add migration `20261005000100_chat_work_foundation/migration.sql` under `apps/api/prisma/migrations/` (หากชื่อเวลาชนให้ใช้ timestamp ถัดไปและอัปเดตลิงก์)

**Interfaces:** สร้าง shared contracts และ ChatWorkAccessService/StaffInboxService ตาม master; API `GET /staff-chat/work-notifications`, `PATCH /staff-chat/work-notifications/:id/read` รับเฉพาะรายการของ current user; list `{data,total,page,limit,unreadCount}`

- [ ] เพิ่ม schema StaffInboxItem ตาม spec พร้อม recipient/deletedAt/createdAt index, FK Restrict และ dedupeKey unique. Query inbox ตรวจ target access ใหม่ทุกครั้ง; ไม่ส่ง deep-link URL จาก client ใช้ targetType/targetId allowlist
- [ ] เขียน negative unit tests ของ policy: SALES สาขาว่างปฏิเสธ, FINANCE-only ไม่เห็น SHOP, OWNER ยังต้องผ่าน company policy เดิม, staff disabled เลือกรับงานไม่ได้. อย่าปรับ policy AI/room เดิมนอก scope นี้
- [ ] ขยาย harness เลือกชุดอย่างชัดเจนก่อนเรียก Jest โดย default ไม่เปลี่ยน:

```bash
case "${CREDIT_SUITE:-chat-credit}" in
  chat-credit) CREDIT_JEST_CONFIG=e2e/jest-chat-credit.json ;;
  chat-operations) CREDIT_JEST_CONFIG=e2e/jest-chat-operations.json ;;
  *) echo 'Unsupported CREDIT_SUITE' >&2; exit 1 ;;
esac
# เรียกหลัง setup isolated DB เดิมเสร็จ
../../node_modules/.bin/jest --config "$CREDIT_JEST_CONFIG" --runInBand
```

- [ ] Integration test สร้างสองบริษัท/สองสาขาและ inbox item ให้แต่ละคน: GET คน A ไม่คืน item ของ B; PATCH item B ได้ 404/403; revoke grant แล้ว count/เนื้อหาหายทั้งคู่. สอง transaction enqueue dedupeKey เดียวกันต้องเหลือหนึ่งแถว. toggle OFF ต้องไม่มี item ใหม่
- [ ] ใช้ `$transaction` + unique conflict-safe insert (`createMany({skipDuplicates:true})` แล้ว read ด้วย key ภายในขอบเขต) เพื่อไม่ทำ transaction ล้มจาก P2002. mutation readAt ใช้ `where recipientId=currentUser.id` ฝั่ง server
- [ ] รัน unit tests และ `CREDIT_SUITE=chat-operations bash tools/test-chat-credit.sh`; เช็ก migrations ทั้ง baseline และ upgraded schema; ตรวจ diff ให้มีเฉพาะ task นี้ก่อน commit `feat(chat): add scoped staff work inbox`

### Task 2: วงรอบรอคำตอบที่ไม่ปนคนกับบอท

**Files:** Create `apps/api/src/modules/chat-engine/services/response-cycle.service.ts`, `response-cycle.service.spec.ts` ใน directory เดียวกัน, `apps/api/e2e/chat-operations-cycles.e2e-spec.ts`. Modify `apps/api/src/modules/chat-engine/services/room-manager.service.ts`, `apps/api/src/modules/chat-engine/services/message-router.service.ts`, `apps/api/src/modules/chat-engine/services/assignment.service.ts`, `apps/api/src/modules/chat-engine/chat-engine.module.ts`, `apps/api/src/modules/staff-chat/services/session-ops.service.ts`, schema + migration `20261005000200_chat_response_cycles/migration.sql`

**Interfaces:** `openInTx(tx,{roomId,messageId,receivedAt}): Promise<void>`; `recordBotSentInTx(tx,{roomId,sentAt}): Promise<void>`; `closeHumanInTx(tx,{roomId,cycleId,messageId,answeredThroughMessageId,staffId:string|null,sentAt}): Promise<void>`; `resolveInTx(tx,{roomId,resolvedAt}): Promise<void>`. เพิ่ม nullable cycleId/answeredThroughMessageId บน outbound ChatMessage เพื่อคงบริบทของการส่งระหว่าง retry. Calls ต้องอยู่กับ mutation waitingSince เดิม ไม่สร้าง side effect จาก React

- [ ] เขียน failing integration cases: inbound 09:00 + inbound 09:01 มีหนึ่ง cycle; BOT 09:02 ไม่ปิด; STAFF saved 09:03 แต่ send fail ไม่ปิด; retry success 09:04 ปิดและเก็บ firstHumanSentAt=09:04; inbound 09:05 เปิดรอบใหม่; markAsRead ไม่ปิด; resolve ปิดด้วย RESOLVED และไม่มีเวลาตอบปลอม
- [ ] Migration สร้าง partial unique index ที่ Prisma schema แทนไม่ได้:

```sql
CREATE UNIQUE INDEX chat_response_cycles_one_open
ON chat_response_cycles (room_id) WHERE ended_at IS NULL;
CREATE INDEX chat_response_cycles_started_room
ON chat_response_cycles (started_at, room_id);
```

- [ ] เชื่อมหลัง provider ยืนยัน success ใน `markOutboundSent` และ path `mirrorOutbound` ของ STAFF echo; staffId ไม่ทราบให้ null. BOT ใช้เวลาส่งจริงเช่นกัน ไม่ใช้การ save ก่อนส่ง. ใช้ row lock ของห้องใน transaction เมื่อแข่ง inbound/send/resolve เพื่อไม่ปิดรอบถัดไปผิด; closure ต้องอ้าง cycle/message causality ไม่ปิดตาม roomId ล่าสุดอย่างเดียว
- [ ] ก่อนเรียก network จับ current cycleId และ latest CUSTOMER message watermark แล้ว commit; ห้ามถือ DB lock ขณะรอ provider. เมื่อ ack กลับปิดเฉพาะ cycle ที่ส่งตอบ และหากมี inbound หลัง watermark ให้เปิดรอบใหม่ที่ oldest unanswered message พร้อม waitingSince ใน transaction เดียว. Reply ที่เริ่มก่อนมี inbound ห้ามล้าง waiting ของ inbound ใหม่. Echo ที่ไม่มี watermark ใช้เฉพาะเวลาจาก provider ที่ตรวจแล้ว; ถ้า ordering ยืนยันไม่ได้เก็บ response เป็น unknown และไม่ล้างงานค้างโดยเดา
- [ ] Merge rooms ที่มี cycle เปิดทั้งคู่ต้อง retain ประวัติเก่าและเลือก oldest waiting สำหรับรอบเปิดเดียว; บันทึก mapping ก่อนย้าย message, ไม่ชน partial unique. Legacy seed ใช้ waitingSince เป็น LEGACY_OPEN และไม่แต่ง firstCustomerMessageId. dry-run รายงานจำนวนก่อนเขียน; ไม่รัน production
- [ ] ทดสอบ concurrent inbound 2 calls, inbound ระหว่าง outbound request ยัง in-flight, echo ซ้ำกับ API response, merge rooms และส่งสำเร็จแต่ DB finalization ล้ม. delivery retry ต้องตรวจ provider identity/สถานะเดิมก่อนส่งใหม่; ห้ามแสดง success หากยังยืนยันไม่ได้
- [ ] รัน isolated cycles suite + existing room-manager/assignment tests; commit `feat(chat): track human and bot response cycles`

### Task 3: SLA policy, cron และการเตือนนัดหมาย

**Files:** Create `apps/api/src/modules/chat-engine/services/chat-sla-policy.ts`, `chat-sla-policy.spec.ts`, `chat-sla-notifier.service.ts`, `chat-sla-notifier.service.spec.ts` ใน directory เดียวกัน; create `apps/api/e2e/chat-operations-alerts.e2e-spec.ts`. Modify `apps/api/src/modules/chat-engine/services/chat-cron.service.ts`, module registration, settings service/DTO ที่ใช้ config keys เดิมของระบบ

**Interfaces:** `businessMinutesBetween(start:Date,end:Date,windows:Array<{start:Date;end:Date}>):number`; `ChatSlaNotifierService.scan(now:Date):Promise<{created:number;skipped:number}>`. Config `chat_sla_owner_minutes=5`, `chat_sla_manager_minutes=15`, policy version/cutover และ windows ตาม spec; service สร้าง window จาก Bangkok calendar ไม่พึ่ง timezone host

- [ ] เริ่มด้วย pure test ข้ามเวลาปิดร้าน (windows เป็น UTC ที่แทน Bangkok 10–19):

```ts
expect(businessMinutesBetween(
  new Date('2026-10-05T11:58:00Z'), new Date('2026-10-06T03:04:00Z'),
  [{ start: new Date('2026-10-05T03:00:00Z'), end: new Date('2026-10-05T12:00:00Z') },
   { start: new Date('2026-10-06T03:00:00Z'), end: new Date('2026-10-06T12:00:00Z') }],
)).toBe(6);
```

- [ ] Implement overlap sum `max(0,min(end,window.end)-max(start,window.start))/60000`; validate disjoint sorted windows, end>=start, manager threshold>=owner. เก็บ policy version เมื่อเปิด cycle เพื่อไม่เปลี่ยนประวัติย้อนหลังเมื่อแก้ settings
- [ ] Cron ทุกนาที batch/keyset อ่าน live open cycles; recheck room waiting/owner/recipient access ใน transaction ก่อน enqueue. Dedupe `sla:{cycleId}:{level}:{recipientId}`; unseen owner ที่ย้ายมาแล้วได้รับหนึ่งรายการโดยไม่ลบ audit ของ owner เดิม. ไม่มี eligible manager ใช้ OWNER ที่มี grant แทน
- [ ] นัดหมายใช้ Todo dueDate/revision และ status; ส่งเฉพาะ assignee ที่ eligible หรือ scoped manager เมื่อไม่มี assignee; TODO เก่าที่ไม่มี revision ใช้ dueDate key ได้. เมื่อ master toggle OFF ไม่สร้าง backlog notifications ตอนเปิดใหม่: cutover ล่าสุดใช้กับ notification eligibility แต่คิวงานยังอ่านได้
- [ ] Integration tests: scan พร้อมกันเหลือหนึ่ง item, ตอบหรือเปลี่ยนคนในระหว่าง scan ไม่เตือนคนเก่า, legacy backlog ไม่มี notifications, นัดเลื่อนแล้ว key เดิมไม่ส่ง, DONE ไม่เตือน; ใช้ active allowlist TODO/DOING/REVIEW ทำให้ CANCELLED ที่ F2 เพิ่มไม่เข้าเงื่อนไขด้วย; ไม่ส่ง LINE/SMS ผ่าน transport
- [ ] รัน pure tests + isolated alerts suite; commit `feat(chat): notify overdue replies and follow-ups`

### Task 4: คิว/กระดิ่งใน Inbox และ preview ที่ตรวจได้

**Files:** Create `apps/api/src/modules/staff-chat/chat-work.controller.ts`, `dto/chat-work-query.dto.ts`, `services/chat-work-query.service.ts`; create `apps/web/src/pages/UnifiedInboxPage/components/WorkQueue.tsx`, `WorkQueue.test.tsx`, `StaffWorkInbox.tsx`, `hooks/useChatWork.ts`, `apps/web/e2e/chat-work-queue.spec.ts`. Modify `UnifiedInboxPage/index.tsx`, `components/ConversationList.tsx`, API module; extend checkout's managed preview fixtures/route handlers identified from `tools/local-check.mjs` and `tools/local-preview*` (ไม่มีการอ้างว่า API จำลองคือ production)

**Interfaces:** `GET /staff-chat/work?view=WAITING&company=SHOP&page=1&limit=50` → ChatWorkPage; valid views ตาม master, limit 1–200; request filter เดียวกันใช้ใน row/count

- [ ] เขียน component tests ด้วย fixed response: WAITING มี 2, FOR_ME มี 1 แต่เป็น room เดียวกับ WAITING ได้; error response ต้องแสดง retry ไม่ใช่ศูนย์; กด notification แล้วเปิด exact room/note/task พร้อม permission failure state
- [ ] Query ROOM_WAIT จาก waitingSince ไม่ใช่ unreadCount; TODAY ใช้ Bangkok `[00:00,next00:00)`, OVERDUE ใช้ dueAt<now; unread กับ waiting เป็นคนละป้าย. FOR_ME ใช้ assigneeId/recipientId ไม่เปลี่ยน owner. Todo ของ room ที่ลบ/ไม่มีสิทธิ์ไม่หลุดมาใน count
- [ ] ผูก query keys กับ company/branch/view; WebSocket invalidate เฉพาะหลัง commit และ fallback refetch ทำให้ reconnect ไม่พลาดงาน. keyboard navigation/390px ไม่ซ่อนปุ่มรับงาน; label “เปิดอ่านแล้ว” ไม่ใช่ “ตอบแล้ว”
- [ ] E2E synthetic: ลูกค้าทัก → อยู่รอตอบ → เปิดอ่านยังอยู่ → ส่งล้มยังอยู่ → ส่งสำเร็จออกจากคิว; ข้ามวันนัดยังถูกต้อง; สลับ SHOP/FINANCE ไม่เห็น stale cache
- [ ] รัน API queue e2e ใน isolated suite, Vitest/Playwright และ `npm run local:check`; leave verified preview running, commit `feat(inbox): add daily work queue and staff alerts`

**รับงาน F1:** ผู้ใช้เห็นคิวที่ถูกสิทธิ์ คิวไม่หายเมื่อเปิดอ่าน เตือนซ้ำไม่ได้ และ synthetic end-to-end ของการส่งล้ม/สำเร็จผ่าน
