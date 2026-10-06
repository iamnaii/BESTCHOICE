# F4 Mentions and Team Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ฝากเรื่องให้เพื่อน/ฝ่ายอื่นแล้วรู้ว่าได้รับและทำเสร็จ โดยไม่เปลี่ยนเจ้าของยอดขาย

**Architecture:** Note + explicit mention recipients + F1 staff inbox; งานที่ต้องทำใช้ Todo CHAT_HANDOFF และ revision/event ของ F2 ไม่มี owner transfer แฝง

**Tech Stack:** NestJS/Prisma transactions, React, WebSocket invalidation, Jest/Vitest

**Spec:** [design](../specs/2026-10-05-chat-operations-six-features-design.md), [master](2026-10-05-chat-operations-master.md); ขึ้นกับ F1 และ F2-T2

## Global Constraints

กติกา 1–10 ของ spec. Mention ไม่ใช่ grant; รับงานไม่ใช่รับยอดขาย; staff ที่ไม่มีสิทธิ์ห้อง/บริษัทไม่อยู่ในรายชื่อเลือก. ไม่แตะ signed-contract transfer guard

## Review Focus

- ชื่อซ้ำ/เปลี่ยนชื่อ/inactive recipient: T1
- retry note หรือส่งงานไม่สร้าง notifications/tasks ซ้ำ: T1/T2
- cross-team แต่ไม่มี company grant ไม่ได้ข้อมูลเกินสิทธิ์: T1/T2
- assignee กดรับพร้อมกัน/เจ้าของห้องเปลี่ยนขณะส่งงาน: T2
- read notification ไม่เท่ากับ accept/done: T3

### Task 1: Mention เป็น user ID และแจ้งเตือนถึงคน

**Files:** Create `apps/api/src/modules/staff-chat/dto/create-room-note.dto.ts`, `services/note-mention.service.ts`, `services/note-mention.service.spec.ts`, `apps/api/e2e/chat-operations-mentions.e2e-spec.ts`; modify `staff-chat.controller.ts`, `services/staff-message.service.ts`, `staff-chat.module.ts`, schema; add migration `20261005000600_chat_note_mentions/migration.sql`

**Interfaces:** `POST /staff-chat/rooms/:id/notes` รองรับ `{content,mentionedUserIds?:string[],clientRequestId?:string}` backward-compatible กับ content-only เดิม; UI ใหม่ต้องส่ง request ID. เพิ่ม ChatNote requestKey nullable unique และ `ChatNoteMention` unique(noteId,userId), FK Restrict. `GET /staff-chat/rooms/:id/eligible-staff` เรียก F1 access service

- [ ] Write failing tests mention สองคนชื่อเดียวกันต้องใช้คนที่เลือก ID; text '@ชื่อ' โดยไม่มี mentionedUserIds เป็นแค่ข้อความ ไม่แจ้งใคร; unique recipients dedupe
- [ ] Validate content trim 1–5000, mentionedUserIds<=20 unique UUIDs, recipients active และ eligible; ไม่ให้ callerใส่ room อื่นใน notification target. ยืนยัน access ณ เวลาบันทึกใน tx
- [ ] Transaction create note + mention rows + enqueue items; note dedupe ใช้ roomId/actorId/clientRequestId เพื่อไม่ชนผู้ส่ง; item key ตามนี้:

```ts
export const mentionKey = (noteId: string, userId: string) =>
  `mention:${noteId}:${userId}`;
// same note/user => same persistent notification across retries
```

helper อยู่ note-mention service. legacy content-only ยังบันทึกได้; ห้าม parse display name เพื่อสร้าง ID. Emit room invalidation และ recipient hint หลัง commit เท่านั้น

- [ ] Test recipient revoke ระหว่างเลือกกับ submit ได้ 403 ไม่มี partial note/notification; ปิด toggle ยังบันทึกโน้ตได้แต่ไม่มี inbox item. ลบโน้ตแล้ว notification แสดง “โน้ตถูกลบ” โดยไม่คืนข้อความ cache
- [ ] รัน unit + isolated mention suite แล้ว commit `feat(chat): notify explicit note mentions`

### Task 2: ส่งงาน/รับงาน/จบงานโดยใช้ Todo

**Files:** Create `apps/api/src/modules/staff-chat/dto/chat-handoff.dto.ts`, `services/chat-handoff.service.ts`, `chat-handoff.controller.ts`, `apps/api/e2e/chat-operations-handoff.e2e-spec.ts`; modify shared chat-work types, module and F1 queue projection

**Interfaces:** `POST /staff-chat/rooms/:id/handoffs` `{clientRequestId,title,assigneeId,dueAt,note?}` → Todo CHAT_HANDOFF; `PATCH /staff-chat/handoffs/:id` `{expectedRevision,action:'ACCEPT'|'COMPLETE'|'CANCEL',completionNote?}`. ACCEPT=DOING, COMPLETE=DONE, CANCEL=CANCELLED; F2 TodoWorkEvent เป็น audit source

- [ ] Integration test: room ownedBy seller A มี signed contract แล้ว ส่งงานให้ B ที่มีสิทธิ์ → B accept/complete → room.assignedToId ยังคง A และไม่มี commission mutation. เรียก AssignmentService.transfer ผ่าน explicit transfer เท่านั้น
- [ ] Service ตรวจ assignee/creator/manager role: assignee รับ/จบ; creator หรือ scoped manager ยกเลิก; DONE/CANCELLED immutable ต่อ accept โดยคืน conflict. expectedRevision CAS จาก F2 ป้องกันการกดแข่ง; duplicate clientRequestId คืน Todo เดิม
- [ ] Transition helper ที่ export ใน chat-handoff service และ unit test ครบ:

```ts
const transitions = {
  TODO: { ACCEPT: 'DOING', CANCEL: 'CANCELLED' },
  DOING: { COMPLETE: 'DONE', CANCEL: 'CANCELLED' },
} as const;
// COMPLETE จาก TODO ปฏิเสธ ต้องรับงานก่อน; terminal state ไม่ย้อนเอง
```

- [ ] Enqueue HANDOFF ให้ผู้รับตอน create และผู้ฝากตอน done แบบ dedupe(todoId,revision,recipientId). เมื่อ recipient ออกจากทีมให้ manager ที่มีสิทธิ์เห็น orphan task ในคิว ไม่แอบโอนให้คนใหม่
- [ ] Tests forbidden company/branch, requester forged actor ID, stale revision, rollback notification เมื่อ transaction ล้ม; unit/isolated suite ผ่านแล้ว commit `feat(chat): track team handoffs without changing sales owner`

### Task 3: Composer, รายการงาน และ deep link

**Files:** Create `apps/web/src/pages/UnifiedInboxPage/components/NoteMentionInput.tsx`, `NoteMentionInput.test.tsx`, `ChatHandoffDialog.tsx`, `ChatHandoffCard.tsx`, `ChatHandoffCard.test.tsx`, `apps/web/e2e/chat-handoff.spec.ts`; modify `hooks/useRoomNotes.ts`, `components/ChatPanel.tsx`, `components/Customer360Panel.tsx`, `components/StaffWorkInbox.tsx`, `components/RoomDossier.tsx`

**Interfaces:** `NoteMentionInput` emits `{content,mentionedUserIds}`; ChatHandoffCard consumes Todo/revision and actions; deep link allowlisted `{roomId,noteId?,todoId?}` และต้อง fetch scoped resource ก่อน scroll/focus

- [ ] เปลี่ยน @name autocomplete ที่มีอยู่ให้ใช้ ID token; แสดงรายชื่อ active eligible ทั้งหมดไม่จำกัดแค่ online. ลบ token แล้วต้องลบ ID ตาม ไม่ส่ง mention ที่มองไม่เห็น
- [ ] Component test เลือกชื่อซ้ำ, keyboard Enter/Escape, ค้นไม่พบ, error/retry. แยกปุ่ม “บันทึกโน้ต” จาก “ส่งงาน”; ป้าย owner แชทกับผู้รับงานมี label คนละอัน
- [ ] Scenario desktop/mobile: A ฝาก B → B เห็น unread → เปิดอ่าน unread หายแต่งานยัง TODO → รับงาน DOING → จบงาน DONE → A เห็นผลและคิวไม่เตือนงานเดิมอีก
- [ ] สลับบัญชี/บริษัทและ reconnect ต้องไม่เห็น notification cache ของคนก่อน; ไม่มีข้อความภายในไป provider (mock transport assert calls=0)
- [ ] รัน F4 suites + F1/F2 affected tests + `npm run local:check`; leave URL, commit `feat(inbox): add mention and handoff workflow`

**รับงาน F4:** คนรับได้รับแจ้งเตือน กดรับและจบได้ คนฝากตามผลได้ โดยเจ้าของห้องและค่าคอมคงกติกาเดิม
