# F5 Service Requests from Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** รับปัญหาลูกค้าจากแชท มีคนตาม และเชื่อมเคสหลังการขายจริงได้โดยไม่สร้างหลักฐานรับฝากเครื่องผิด

**Architecture:** ChatServiceRequest เป็น intake เบื้องต้นและผูก Todo งานติดตาม; AfterSalesCase/RepairTicket เดิมยังเป็น source of truth ของเคส/ซ่อม/เอกสาร/การเงิน

**Tech Stack:** NestJS/Prisma, existing AfterSales services, React, isolated PostgreSQL

**Spec:** [design](../specs/2026-10-05-chat-operations-six-features-design.md), [master](2026-10-05-chat-operations-master.md); ขึ้นกับ F1/F2/F4

## Global Constraints

กติกา 1–10 ของ spec. “รับเรื่องหลังการขาย” ไม่ใช่ “รับฝากเครื่อง”. ห้ามข้ามรูป/การยืนยัน/ใบรับฝาก หรือส่ง LINE ว่าได้รับเครื่องแล้วจาก intake chat. ไม่แก้สูตรบัญชีหรือ bypass warranty checks

## Review Focus

- room ยังไม่รู้ตัวลูกค้าหรือมีหลายเครื่อง: T1
- retry เปิดเคสแล้วสร้างสองใบ/ผูกข้ามคน: T2
- หลัง link เปลี่ยนสถานะซ่อมจากหน้าจริงต้องแสดงสด: T2/T3
- ข้อมูลรูป/หลักฐานถูกลบหรือไม่มีสิทธิ์: T1/T3
- intake ต้องไม่มี side effect แจ้งรับเครื่อง/บัญชี: T1/T2

### Task 1: รับเรื่องก่อนเป็นเคสจริง

**Files:** Create `apps/api/src/modules/staff-chat/chat-service-request.controller.ts`, `dto/chat-service-request.dto.ts`, `services/chat-service-request.service.ts`, `services/chat-service-request.service.spec.ts`, `apps/api/e2e/chat-operations-service-intake.e2e-spec.ts`; modify schema/module; migration `20261005000700_chat_service_requests/migration.sql`

**Interfaces:** `POST /staff-chat/rooms/:id/service-requests` `{clientRequestId,symptom,assigneeId,dueAt,productId?,contractId?,saleId?,sourceMessageIds?}`; `GET /staff-chat/rooms/:id/service-requests`; `PATCH /staff-chat/service-requests/:id` `{expectedRevision,symptom?,status?}`. schema ตาม spec แต่ assignee/due ใช้ linked Todo เท่านั้น: ChatServiceRequest.todoId unique FK, ไม่เพิ่ม assigneeId/dueAt สองแห่ง. Source messages เป็น relation table FK+unique(requestId,messageId). เพิ่ม `ChatServiceRequestEvent` append-only `{id,requestId,kind,fromStatus?,toStatus?,actorId,createdAt}` สำหรับ CREATE/STATUS/LINK_CASE; เขียนใน tx ทุก transition เพื่อให้ F6 วัดตามเวลาเหตุการณ์ได้

- [ ] DTO symptom trim>=5<=5000, sourceMessageIds<=10; ตรวจ message อยู่ห้องเดียวและมีสิทธิ์. room ไม่ผูก customer สร้าง intake ได้ แต่ไม่ให้ link case จริงจน canonical customer ชัด. ห้ามสร้าง dummy customer เพื่อผ่าน case validation
- [ ] DB integration test สร้าง request พร้อม Todo CHAT_SERVICE ใน tx เดียว requestKey unique; retry คืนเดิม; transaction fail ไม่มี orphan Todo. ห้ามส่ง LINE/SMS และไม่มี RepairTicket/AfterSalesCase/ExpenseDocument/OtherIncome เพิ่มจาก intake
- [ ] เลือกสินค้า/สัญญาต้องตรวจลูกค้า+บริษัท+สาขาจริง ถ้าหลายเครื่องแสดงให้เลือก ไม่เลือกสัญญาล่าสุดเอง. หลักฐานจาก chat เป็น reference ที่อ่านผ่าน guarded media service ไม่คัดลอก public URL ของเอกสารส่วนตัว
- [ ] State validation helper:

```ts
export const serviceRequestTransitions = {
  OPEN: ['WAITING_CUSTOMER', 'LINKED', 'RESOLVED', 'CANCELLED'],
  WAITING_CUSTOMER: ['OPEN', 'LINKED', 'RESOLVED', 'CANCELLED'],
  LINKED: [], RESOLVED: [], CANCELLED: [],
} as const;
// LINKED เกิดผ่าน link service เท่านั้น ไม่รับจาก generic PATCH
```

- [ ] ใช้ F2 revision/CAS กับ request และ Todo assignment/due writer ของ F2/F4; WAITING_CUSTOMER ยังมี next follow-up ได้ ไม่ถือปิดงาน. resolve/cancel intake ต้องปิด Todo ที่เกี่ยวข้องใน tx เดียวและมีเหตุผล
- [ ] รัน unit/isolated intake suite; commit `feat(chat): create service intake linked to follow-up work`

### Task 2: ผูกหรือส่งต่อไปเปิด AfterSalesCase เดิม

**Files:** Modify `apps/api/src/modules/after-sales/dto/create-case.dto.ts`, `services/after-sales-case.service.ts`, `after-sales.module.ts`; create `apps/api/src/modules/after-sales/services/chat-service-case-link.service.ts`, `chat-service-case-link.service.spec.ts`, `apps/api/e2e/chat-operations-service-link.e2e-spec.ts`; modify ChatServiceRequest service/controller and schema unique case mapping

**Interfaces:** optional `serviceRequestId` ใน CreateCaseDto; link in same transaction as original case insert; `POST /staff-chat/service-requests/:id/link-case` `{caseId,expectedRevision}`. `linkInTx(tx,{requestId,caseId,actor}):Promise<void>`. `afterSalesCaseId` nullable unique กำหนดหนึ่ง request ต้นทางต่อหนึ่งเคส; หลายห้องดูเคสเดียวกันผ่าน customer context ได้โดยไม่ duplicate link

- [ ] Test ผูกคนละ customer หรือ IMEI/contract ไม่ตรงต้องปฏิเสธและไม่มี write. Test merge customer canonical ตรงแล้วผูกได้โดยไม่เปลี่ยนหลักฐาน customer เดิมของเอกสารย้อนหลัง
- [ ] Flow “เปิดเคส” prefill form เดิมเท่านั้น ผู้รับผิดชอบเติมรูป/ข้อมูลรับฝากและยืนยันตาม CreateCaseDto/AfterSalesCaseService เดิม. source chat attachment ไม่แทน intake photos อัตโนมัติ; ต้องตรวจ provenance และยืนยันการรับฝากจริงตาม flow เดิม
- [ ] Lock service request ก่อนสร้างเคส ตรวจ LINKED แล้วคืน existing case ก่อนเริ่ม side effects. เมื่อ insert case สำเร็จ link ใน tx เดียวกัน; audit/read projection หลัง commit. Calls ส่งข้อความ/ออกเอกสารคงอยู่ใน lifecycle เดิมหลัง commit ไม่ถูกเรียกจาก link-only operation
- [ ] ทดสอบสอง create requests แข่งกันหนึ่ง case, DB failure rollback ทั้งคู่, link-existing ไม่ส่ง notification รับเครื่องซ้ำ, cancel/close repair ผ่าน flow เดิมมีบัญชีตามเดิมหนึ่งชุด
- [ ] หลัง LINKED derive displayed status จาก AfterSalesCase/RepairTicket ทุกครั้ง; linked Todo ใช้เพื่อผู้ดูแล/due ไม่เขียน repair stage. การ complete Todo ที่ linked ต้องถูก guard ให้ผ่าน lifecycle closed/cancelled จริง; ไม่ปล่อย generic todos endpoint ปิดงานซ่อมโดยไม่มีหลักฐาน
- [ ] รัน isolated service-link + existing after-sales/repair/exchange targeted regression ภายใน harness; commit `feat(after-sales): link chat intake to canonical cases`

### Task 3: แผงเคสและคิวติดตาม

**Files:** Create `apps/web/src/pages/UnifiedInboxPage/components/ChatServiceRequestDialog.tsx`, `ChatServiceRequestCard.tsx`, `ChatServiceRequestCard.test.tsx`, `hooks/useChatServiceRequests.ts`, `apps/web/e2e/chat-service-case.spec.ts`; modify `RoomDossier.tsx`, F1 query service, `apps/web/src/pages/AfterSalesNewPage.tsx` and `AfterSalesNewPage.test.tsx` to accept scoped prefill and serviceRequestId

**Interfaces:** card `{requestId,caseId|null,caseNumber|null,symptom,status,assignee,dueAt,revision}`; query server คืน `canOpenCase`/`canLinkCase` ตามสิทธิ์ แต่ server ต้องตรวจซ้ำเมื่อ mutation

- [ ] UI “รับเรื่องหลังการขาย” แสดงรายละเอียดปัญหา เจ้าของงาน นัดติดตาม และหลักฐาน; “เปิดเคสหลังการขาย” กับ “ผูกเคสเดิม” เป็นคนละปุ่ม. LINKED แสดงเลขเคสและลิงก์ไปของจริง ไม่สร้าง dropdown เปลี่ยนสถานะซ่อมอีกชุด
- [ ] Component test แยกข้อความสำคัญ:

```tsx
// ก่อน LINKED
<p>รับเรื่องทางแชทแล้ว ยังไม่ใช่การรับฝากเครื่อง</p>
// หลัง LINKED แสดง caseNumber และ stage label จาก server
```

- [ ] Queue projection แสดง SERVICE_REQUEST แทน TODO คู่กันของ CHAT_SERVICE เพื่อไม่เห็นงานเดียวสองแถวใน view เดียว; count ใช้ key เดียว. ดึง Todo assignee/due เป็น source เดียว. staff notification deep link ไป request/card ที่อ่านสิทธิ์ก่อน
- [ ] E2E: แจ้งปัญหาโดยยังไม่มี customer → ผูกลูกค้า → ตั้งนัด → เปิดเคสตามแบบเดิม → เปลี่ยนสถานะใน after-sales → กลับแชทเห็นสถานะล่าสุด → ปิดเคส → งานหายจาก overdue. ครอบคลุมมือถือและ permission denial
- [ ] รัน suites F5 + scoped queue regression + `npm run local:check`; preview ใช้ provider mock ไม่แจ้งลูกค้าจริง. commit `feat(inbox): track after-sales cases from chat`

**รับงาน F5:** ตามเคสจากแชทได้ ไม่ต้องสร้างเอกสารซ้ำ ไม่แสดงว่ารับเครื่องถ้ายังไม่ได้รับ และยอด/เอกสารหลังการขายเดิมไม่เปลี่ยน
