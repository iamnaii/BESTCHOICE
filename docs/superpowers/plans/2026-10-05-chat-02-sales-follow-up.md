# F2 Sales Context and Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** พนักงานเห็นขั้นการขายจริงและตั้งงานติดตามจากแชทเดิมได้

**Architecture:** ใช้ JourneySummary เดิมเป็น source of truth; Todo เป็นนัดและ next action ไม่สร้าง CrmLead pipeline ซ้ำหรือ manual WON

**Tech Stack:** NestJS/Prisma, React/TanStack Query, shared journey types

**Spec:** [design](../specs/2026-10-05-chat-operations-six-features-design.md), [master](2026-10-05-chat-operations-master.md); ขึ้นกับ F1

## Global Constraints

ใช้กติกา 1–10 ของ spec. ขั้นจากหลักฐานเดิม; note/todo ไม่ทำให้ PURCHASED; เงินสดข้าม CREDIT ได้. ไม่เปลี่ยนสิทธิ์เอกสารเครดิตเพื่อให้แสดงบนแชท

## Review Focus

- canonical customer merge และ room ที่ยังไม่ผูก: T1
- สถานะซื้อ stale/ใบขาย void: T1
- นัดเปลี่ยนวันชนกัน/ข้ามเที่ยงคืน Bangkok: T2
- นัดเดิมไม่ถูกสร้างซ้ำหรือรีไทป์โดยเดา: T2
- ลูกค้าที่ไม่ซื้อ/กลับมาซื้อใหม่ ไม่ทำลายประวัติ: T3

### Task 1: Sales context ใน RoomDossier

**Files:** Create `apps/api/src/modules/staff-chat/services/chat-sales-context.service.ts`, `chat-sales-context.service.spec.ts`, `apps/api/src/modules/staff-chat/chat-sales-context.controller.ts`, `apps/web/src/pages/UnifiedInboxPage/components/ChatSalesContext.tsx`, `ChatSalesContext.test.tsx`, `apps/api/e2e/chat-operations-sales-context.e2e-spec.ts`. Modify `staff-chat.module.ts`, `UnifiedInboxPage/components/RoomDossier.tsx`

**Interfaces:** `GET /staff-chat/rooms/:id/sales-context` → `{ customerId:string|null; journey:JourneySummary|null; nextAction:{todoId:string;title:string;dueAt:string|null}|null; evidenceLinks:Array<{kind:'CREDIT'|'OFFER'|'APPOINTMENT'|'PURCHASE';id:string;label:string}> }`; JourneyRedirect resolve ด้วย canonical customer ไม่วนลิงก์

- [ ] เขียน test CASH purchase ที่ไม่มีเครดิต: ผ่าน summary service เดิมแล้ว stage PURCHASED, CREDIT skipped; อย่าสร้าง stage จำลองจากข้อความแชท. room customer=null ต้องคืน journey=null และปุ่มผูกลูกค้าเดิม
- [ ] ทดสอบ pending/void sale ไม่ทำให้ซื้อแล้ว; stale cache ต้องผ่าน summary refresh เดิม. requester ไม่มีสิทธิ์ finance evidence ต้องไม่เห็น URL/จำนวนเงิน/ID เอกสารที่อ่านไม่ได้
- [ ] Service composition เท่านั้น: `assertRoom` → resolve canonical customer → JourneySummaryService → scoped credit/offer/appointment references. ไม่คัดลอก SQL `BOUGHT_WHERE` หรือคำนวณ stage ชุดใหม่
- [ ] UI ใช้หลักนี้:

```tsx
// ไม่มี select แก้ขั้นหลักของลูกค้า
<p aria-label="ขั้นการขาย">{context.journey?.stageLabel ?? 'ยังไม่ผูกข้อมูลลูกค้า'}</p>
// ป้าย “รอเอกสาร/มีข้อเสนอ/นัดรับ” ต้องมี evidenceLink ของรายการจริง
```

- [ ] ตรวจ merge placeholder แล้วเปิดห้องเดิมยังเห็น canonical summary แต่ room-specific appointment ไม่ย้ายหาย; รัน unit + isolated sales context suite แล้ว commit `feat(inbox): show evidence-based sales context`

### Task 2: Todo นัดติดตามพร้อม concurrency และประวัติ

**Files:** Modify `apps/api/prisma/schema.prisma`, `apps/api/src/modules/todos/dto/todo.dto.ts`, `todos.service.ts`, `todos.controller.ts`, `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx`, `apps/web/src/pages/TodosPage/types.ts`, `components/TodoFilters.tsx`, `components/TodoForm.tsx`, `components/TodoKanbanView.tsx` under TodosPage; create migration `20261005000300_chat_follow_up/migration.sql`, `apps/api/src/modules/staff-chat/dto/chat-follow-up.dto.ts`, `services/chat-follow-up.service.ts`, `chat-follow-up.controller.ts`, `apps/web/src/pages/UnifiedInboxPage/components/ChatFollowUpDialog.tsx`, `ChatFollowUpDialog.test.tsx`, `apps/api/e2e/chat-operations-follow-up.e2e-spec.ts`

**Interfaces:** Todo เพิ่ม workKind enum ตาม spec, revision default 0, requestKey nullable unique; TodoStatus เดิม TODO/DOING/REVIEW/DONE เพิ่ม CANCELLED พร้อม label/filter/maps; `TodoWorkEvent` append-only `{todoId,actorId,kind,fromDueAt?,toDueAt?,fromAssigneeId?,toAssigneeId?,createdAt}`. API `POST /staff-chat/rooms/:id/follow-ups` `{clientRequestId,title,assigneeId,dueAt}`; `PATCH /staff-chat/follow-ups/:id` `{expectedRevision,title?,assigneeId?,dueAt?,status?}` คืน Todo ที่แก้แล้ว; canonical due field ยังเป็น Todo.dueDate

- [ ] DTO บังคับ title ไม่ว่าง <=255, UUID assignee/clientRequestId, dueAt ISO มี offset, expectedRevision integer>=0; actor ได้จาก auth. สร้างนัดอดีตได้แต่ UI ระบุเกินกำหนด ไม่แก้วันให้อัตโนมัติ
- [ ] เพิ่ม failing DB test สอง PATCH expectedRevision=0 แข่งกัน: หนึ่ง success อีกหนึ่ง 409; event ตรงกับอันที่ชนะหนึ่งแถว. แนวทาง update:

```ts
const updated = await tx.todo.updateMany({
  where: { id: todoId, revision: expectedRevision, deletedAt: null },
  data: { dueDate: dueAt, revision: { increment: 1 } },
});
if (updated.count !== 1) throw new ConflictException('งานนี้มีการแก้ไขแล้ว กรุณาโหลดใหม่');
```

- [ ] วาง scope check ก่อน update ใน transaction; ตรวจ assignee มีสิทธิ์ room และยัง active. Audit + TodoWorkEvent + staff inbox ใช้ tx เดียวกัน. ป้องกัน generic `/todos/:id` ข้าม revision/scope/work-kind rules สำหรับ room tasks ด้วย delegate ไป helper เดียว
- [ ] UI reuse date-time component เดิม เก็บ UTC และแสดง Bangkok; สองแท็บแก้ชนกันแสดงข้อมูลล่าสุดและให้เลือกบันทึกใหม่ ไม่ overwrite เงียบ. fetch old Todo.roomId ทุก workKind เพื่อไม่ซ่อนนัดเดิม
- [ ] รัน isolated follow-up cases: duplicate create requestKey, reschedule แล้วไม่เตือนวันเก่า, DONE/CANCELLED หายจาก active queue, assignee ข้ามสาขาไม่ได้, 23:59/00:01 ตรงวัน; commit `feat(chat): add reliable follow-up tasks`

### Task 3: หลุด/เปิดใหม่, queue wiring และ acceptance

**Files:** Modify `apps/web/src/pages/UnifiedInboxPage/components/ChatSalesContext.tsx`, `RoomDossier.tsx`, `apps/api/src/modules/staff-chat/services/chat-work-query.service.ts`, `chat-sales-context.controller.ts`, `apps/api/src/modules/customer-journey/customer-journey.module.ts`, schema; create `apps/api/src/modules/customer-journey/journey-manual-entry.service.ts`, `journey-manual-entry.service.spec.ts`, `apps/api/src/modules/staff-chat/dto/chat-sales-disposition.dto.ts`, `apps/web/e2e/chat-sales-follow-up.spec.ts`; add migration `20261005000350_journey_manual_requests/migration.sql` for nullable unique manualRequestKey on CustomerJourneyEntry

**Interfaces:** ใช้ `JOURNEY_LOST_REASON_LABELS` และ event kinds `MARKED_LOST`/`REOPENED` เดิม ไม่สร้าง lostReason enum ใหม่. เพิ่ม `POST /staff-chat/rooms/:id/sales-disposition` `{action:'MARK_LOST'|'REOPEN',reason?:string,clientRequestId:string}`. `JourneyManualEntryService.record({customerId,roomId,action,reason,clientRequestId},actor)` ตรวจ room/customer access, resolve canonical customer, transaction สร้าง origin=MANUAL, actorType=STAFF, occurredAt จาก server, manualRequestKey จาก actor+request ID และ dedupeKey=null ตาม schema convention. ไม่เรียก JourneyEntryWriter เดิมเพราะรับ SYSTEM เท่านั้น. ใช้ summary/BOUGHT_WHERE เดิมปฏิเสธ MARK_LOST เมื่อลูกค้าซื้อแล้ว; recompute ด้วย JourneyStateService หลัง commit ไม่แก้ stage cache ด้วยมือ

- [ ] Component test ปุ่ม “ไม่ซื้อแล้ว” ต้องเลือกเหตุผลมาตรฐานก่อน submit; “กลับมาติดตาม” สร้าง REOPENED ไม่ลบ entry เก่า. mock API ตรวจว่า request ไม่ส่ง stage:'PURCHASED'
- [ ] Wiring หลังบันทึก invalidate room sales-context, journey summary, Todo และ F1 queue อย่างเจาะจง. เลือกนัดที่ใกล้ที่สุดจากงาน active ไม่เลือกนัด DONE ที่ใหม่กว่า
- [ ] เพิ่ม fixture จริงใน isolated suite: ลูกค้าจากแชท → สนใจสินค้า → นัด → เลื่อนนัด → เครดิต → หลุด/เปิดใหม่ → ซื้อเงินสด; UI ใช้ข้อมูลต้นทาง ไม่สร้าง purchase จากการกดสถานะ
- [ ] รัน tests F2 และ F1 queue regression + `npm run local:check`; ตรวจจอ 1440/390, errors, scope switching. commit `feat(inbox): connect sales progress with follow-up queue`

**รับงาน F2:** สถานะตรงกับเอกสารจริง นัดอยู่คิวถูกวัน ติดตามต่อจาก canonical customer ได้ และไม่มีทางตั้งซื้อแล้วโดยไม่มีหลักฐาน
