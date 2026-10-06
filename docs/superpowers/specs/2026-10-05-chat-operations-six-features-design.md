# BESTCHOICE: แชทที่ตามงานจนจบ — ขอบเขต 6 ฟีเจอร์

วันที่: 2026-10-05 · สถานะ: แผนเสนอเพื่อพัฒนา ยังไม่ได้แก้โค้ดหรือเปิดใช้จริง

## เป้าหมายและสิ่งส่งมอบ

คำขอเจ้าของ: วางแผนแก้ไขทั้ง 6 ข้อ ได้แก่ (1) คิวงานวันนี้และเตือนแชทค้าง (2) สถานะการขายและนัดติดตาม (3) คอมเมนต์ Facebook (4) ส่งต่องานและ Mention (5) เคสหลังการขายจากแชท (6) รายงานทีมที่แยกคนกับบอท

ผลลัพธ์หลัก: พนักงานเปิด Inbox แล้วรู้ว่าใครรอ ใครรับผิดชอบ ต้องทำอะไรต่อ และงานจบเมื่อใด โดยข้อมูลการขาย/เครดิต/บริการยังมาจากระบบต้นทางเดิม

## หลักฐานจาก checkout ที่ตรวจ

- Baseline `cd09bc4e6`; ก่อนลงมือจริงตรวจ HEAD และ diff ใหม่ เพราะมีหลาย session ใช้ workspace นี้
- `ChatRoom.waitingSince` คือรอคำตอบจากคน: เปิดอ่านหรือ BOT ตอบไม่ล้าง; ส่งล้มไม่ล้าง; ส่งสำเร็จ/echo STAFF/ปิดงานล้าง
- `assignment.service.ts`: คนตอบสำเร็จก่อนเป็นเจ้าของห้อง; `autoAssign` เป็น dead code; โอนหลังเซ็นสัญญามี guard ป้องกันแย่งค่าคอม
- `Todo.roomId` และนัดหมายใน `RoomDossier` มีอยู่แล้ว ไม่สร้างปฏิทิน/ตารางนัดอีกชุด
- Customer Journey มี summary และ schema/kinds สำหรับเหตุผลหลุด/เปิดใหม่ แต่ยังไม่พบ manual-write endpoint; F2 ต้องสร้าง writer ของ MANUAL แยกจาก JourneyEntryWriter ที่รับ SYSTEM เท่านั้น. ขั้น CONTACTED/IDENTIFIED/INTERESTED/CREDIT/PURCHASED มาจากหลักฐาน สเปก 2026-09-15 ห้ามเปลี่ยนขั้นด้วยมือ
- `CrmLead` อยู่ใน schema แต่ไม่ใช่เหตุให้รื้อฟื้น CRM อีกชุด; ใช้ Customer Journey ที่มี caller จริง
- Facebook webhook ปัจจุบันวน `entry.messaging` ไม่รับ `entry.changes` สำหรับ feed; comment identity ไม่ใช่หลักฐานว่าเป็น Messenger PSID เดียวกัน
- Notes ปัจจุบันส่ง content และ emit ตามห้อง; ยังไม่มี recipient/read/ack ของ Mention
- `AfterSalesCase` และ `RepairTicket` มี lifecycle, รูป, ใบรับฝาก, notification และผลบัญชีอยู่แล้ว การแจ้งปัญหาทางแชทยังไม่แปลว่าร้านรับฝากเครื่องจริง
- `firstResponseAt` ปัจจุบันนับ BOT/STAFF รวมกัน; รายงานใช้ createdAt ของห้องและ assignedTo ปัจจุบัน จึงไม่พอวัดรอบตอบหรือผู้ตอบจริง
- `NotificationLog` เป็น delivery log; ไม่มี inbox การอ่านรายพนักงาน จึงเพิ่ม staff inbox ขนาดเล็กเพื่อ SLA/Mention/งานบริการร่วมกัน ไม่สร้างระบบส่ง LINE/SMS ใหม่

## กติกาที่ทุกแผนต้องรักษา

1. งานหน้าร้าน = SHOP; งานการเงิน = FINANCE. ใช้ตัวเลือกงาน/บริษัทเดิมใน sidebar; ไม่เพิ่มตัวเลือกบริษัทซ้ำ
2. รักษา company grants, branch scope, soft delete และสิทธิ์ข้อมูลเครดิตทุก endpoint รวม count, search, deep link, export และ WebSocket
3. การเปิดอ่านแชทไม่ใช่การตอบ; BOT ไม่ใช่คำตอบจากคน; adapter ส่งล้มไม่ใช่ส่งสำเร็จ
4. คนตอบสำเร็จก่อนเป็นเจ้าของห้องตามเดิม; ผู้รับงานย่อย/ผู้ถูก Mention ไม่ได้รับเจ้าของแชท ยอดขาย หรือค่าคอมโดยอัตโนมัติ
5. Journey ขั้นหลักคำนวณจากหลักฐานเดิม; ไม่เปิดให้กด PURCHASED/WON เอง ไม่สร้าง pipeline ที่ขัดกับ source of truth
6. ใช้ Todo เดิมสำหรับนัดและงานติดตาม; ใช้ AfterSalesCase/RepairTicket เดิมสำหรับเคสจริงและสถานะซ่อม
7. Migration แบบเพิ่มข้อมูลก่อน; ห้าม reset/drop ข้อมูลเดิม ห้าม backfill เดาประวัติผู้ตอบหรือยอดขาย
8. ทดสอบบน PostgreSQL แยกและ provider จำลอง; ไม่มีข้อความถึงลูกค้าจริงใน local verification
9. ก่อนส่งมอบโค้ดแต่ละชุดรัน `npm run local:check` จาก checkout ที่แก้ และทดสอบ API/flow ที่ preview เดิมยังไม่รองรับเพิ่มด้วย
10. ขอบเขตปัจจุบันเป็นเอกสารแผน ไม่รวม commit/merge/deploy หรือเปลี่ยนการตั้งค่า Meta จริง

## แบบข้อมูลร่วมและขอบเขตบริการ

เพิ่ม `staff-chat/services/chat-work-access.service.ts` เป็น facade ของ policy ที่มีอยู่สำหรับฟีเจอร์ใหม่ รับ actor ตัวเต็มจาก auth รวม grants และ selected company ที่ตรวจแล้ว ห้ามคัดลอก policy AI ที่เข้มกว่าการตอบแชทมาทับทุกสิทธิ์โดยไม่ตรวจ behavior เดิม

นิยาม `ChatWorkActor` ใน `packages/shared/src/chat-work.ts`: `{ id: string; role: string; branchId: string | null; accessibleCompanies?: string[] }`; `WorkScope`: `{ company: 'SHOP' | 'FINANCE'; branchId?: string }` ซึ่ง server ตรวจ ไม่รับเป็นสิทธิ์จาก client

เพิ่ม `StaffInboxItem`: id, recipientId (FK User), kind (`CHAT_SLA`, `FOLLOW_UP`, `MENTION`, `HANDOFF`, `SERVICE_REQUEST`), roomId nullable (FK), todoId nullable (FK), dedupeKey unique, title, targetType/targetId, createdAt, readAt, deletedAt. เก็บชื่อเรื่องสั้น ไม่คัดลอกบัตรประชาชน/เอกสาร/ข้อความลูกค้าลงแจ้งเตือน

`StaffInboxService.enqueue(tx, input)` เขียนใน transaction ที่เกิดงาน โดยเคารพ `in_app_notifications_enabled`; unique key ทำให้ retry ไม่ซ้ำ; WebSocket เป็นแค่ hint หลัง commit รายการ durable ยังอ่านย้อนหลังได้ รายการต้องกรองสิทธิ์ปัจจุบันอีกครั้ง ถ้าสิทธิ์ถูกถอนห้ามเปิด payload เดิม

เพิ่ม `ChatResponseCycle` ในฟีเจอร์ 1: id, roomId, startedAt, firstCustomerMessageId nullable, firstBotSentAt nullable, firstHumanSentAt nullable, firstHumanStaffId nullable, assignedAtOpenId nullable, endedAt nullable, endReason (`HUMAN_REPLY`/`RESOLVED`), origin (`LIVE`/`LEGACY_OPEN`), policyVersion. มี partial unique index `(room_id) WHERE ended_at IS NULL`. Nullable IDs ใช้กับ legacy เท่านั้น; timestamps คือเวลารับ/ส่งสำเร็จที่ server ยืนยัน ไม่ใช่เวลาสร้าง draft

วงรอบเริ่มเมื่อ CUSTOMER ส่งเข้ามาในห้องที่ไม่มีวงรอบเปิด ลูกค้าส่งติดกันหลายข้อความไม่เริ่มใหม่ BOT บันทึกแยกแต่ไม่ปิดรอบ คนส่งสำเร็จปิดรอบ; resolve ปิดด้วย RESOLVED โดยไม่แต่งเวลาตอบ คนส่งล้มต้องไม่ปิด การอัปเดต cycle กับ waitingSince อยู่ transaction เดียวกันใน path ที่ทำได้; cron reconcile ตรวจความไม่ตรงและแจ้ง โดยไม่เขียนทับเงียบ

ระหว่างรอ provider: outbound เก็บ cycleId และ answeredThroughMessageId ที่ทราบก่อนเริ่มส่ง; เมื่อสำเร็จหากมี inbound ใหม่หลัง watermark ให้คงงานใหม่ด้วยวงรอบถัดไป ไม่ล้างข้อความที่มาทีหลัง. ไม่ถือ DB transaction ขณะรอ network. การเก็บ cycleId/watermark เป็น additive fields ของ ChatMessage

## 1. คิวงานวันนี้และเตือนค้าง

- เพิ่มแถบคิวใน Inbox เดิม: รอตอบ / ยังไม่มีผู้ดูแล / ต้องติดตามวันนี้ / เกินกำหนด / งานที่ส่งถึงฉัน พร้อม count แบบ scoped ฝั่ง server
- รายการ read projection จาก ChatRoom, Todo และต่อเติม FacebookCommentThread/ChatServiceRequest ในแผนที่เกี่ยวข้อง; ไม่สร้างสำเนาเจ้าของงาน
- Room key กับ Todo key แยกกัน ชิปซ้อนกันได้ แต่ count ภายในแต่ละชิปนับ entity ไม่ซ้ำ มี stable pagination และเรียง overdue/dueAt/id
- ตั้งค่า SLA เสนอเริ่มที่ 5 นาทีเตือนเจ้าของ และ 15 นาทีเตือนหัวหน้า นับเฉพาะเวลาปฏิบัติงาน; ค่านี้ปรับได้และระบุว่าเป็นค่าเสนอ ไม่ใช่ SLA ที่เจ้าของยืนยันแล้ว
- SHOP ใช้เวลาร้านจาก `shop-hours.util.ts`; FINANCE ใช้ช่วง 10:00–20:00 ตาม behavior after-hours เดิมเฉพาะเป็นค่าเริ่มต้นของ policy ใหม่ ไม่แก้บอท after-hours เดิม
- ห้องไม่มีผู้ดูแลแจ้งหัวหน้าที่มีสิทธิ์บริษัท/สาขา; สาขายังไม่ทราบแจ้ง OWNER ที่มีสิทธิ์บริษัท ไม่เดาสาขาจากลูกค้า
- Dedupe = cycle + level + recipient; นัดหมาย dedupe = todo + dueDate revision + recipient. เปลี่ยนเจ้าของแล้วใช้ผู้มีสิทธิ์ปัจจุบัน หยุดเตือนงานที่ตอบแล้ว/เสร็จ/ยกเลิก
- เปิดคิวให้เห็น backlog เก่าได้ แต่ไม่ยิงแจ้งเตือนย้อนหลังทั้งหมด: `LEGACY_OPEN` ยังไม่สร้าง SLA notifications จนมี inbound ใหม่หลังเปิดใช้; ระบุช่วงเริ่มวัดใน UI

## 2. สถานะการขายและนัดติดตาม

- แสดง Journey 5 ขั้นเดิมใน RoomDossier พร้อมสินค้า/รุ่นที่สนใจจากข้อมูลเดิม ไม่ให้แก้ขั้นจริงด้วยมือ
- แสดงข้อความปฏิบัติงาน เช่น รอเอกสาร/รอผลเครดิต/มีข้อเสนอ/นัดรับ แยกจาก Journey หลัก ใช้เครดิต/ข้อเสนอ/นัดจริงเป็นหลักฐาน; ถ้าไม่มีข้อมูลให้แสดงว่าไม่พบหลักฐาน
- นัดติดตามใช้ Todo เพิ่ม `workKind` (`GENERAL`, `CHAT_FOLLOW_UP`, `CHAT_HANDOFF`, `CHAT_SERVICE`) และ `revision` สำหรับ optimistic concurrency. TodoStatus เดิมคือ TODO/DOING/REVIEW/DONE; เพิ่ม CANCELLED แบบ additive พร้อมแก้ status maps/filters ใน TodosPage. Todo เก่าคง GENERAL และนัดที่ผูก room ยังแสดงตามเดิม ไม่เดาประเภทย้อนหลัง
- ต้องระบุผู้รับผิดชอบ วันเวลา Asia/Bangkok และ next action; เปลี่ยนวันเก็บประวัติเหตุการณ์ไม่ทำให้ระบบเตือนวันเดิม
- หลุด/เปิดใหม่ใช้ Journey kinds และเหตุผลมาตรฐานเดิม ผ่าน MANUAL writer/endpoint ใหม่ของ F2; ลูกค้าซื้อแล้วอ่านจาก sale/contract จริง
- Merge customer เปลี่ยนลิงก์ไป canonical customer; ไม่ย้ายนัดไปผิด room และไม่สร้าง task ซ้ำ

## 3. คอมเมนต์ Facebook เข้าเป็นงาน

- MVP รับ comment จากเพจที่ตั้งค่าและตรวจแล้ว พร้อมลิงก์โพสต์ ต้นฉบับ คอมเมนต์ตอบกลับ ผู้รับผิดชอบ สถานะ OPEN/RESPONDED/RESOLVED และเวลาที่รอ; ไม่ปนกับห้อง DM
- โมเดล `FacebookCommentThread` ผูก pageId/postId/rootCommentId, owner/branch/company ที่ server resolve, customerId/roomId nullable; `FacebookCommentEvent` เก็บ provider ID และ revision สำหรับ add/edit/remove. Unique composite ต้องรวม pageId
- ไม่จับคู่คนด้วยชื่อ/avatar; ไม่เอา comment author ID เป็น PSID. ผูก customer/room ได้เมื่อผู้มีสิทธิ์ยืนยันพร้อมหลักฐาน บันทึก audit และแก้ลิงก์ผิดได้
- Public reply เป็นการกดส่งโดยพนักงานและแสดงชัดว่า “ตอบสาธารณะ”; ไม่มี AI auto-reply สำหรับคอมเมนต์ในรอบนี้
- การทักส่วนตัวจากคอมเมนต์เป็น capability ที่ต้องยืนยันตาม Graph version/สิทธิ์จริงก่อนเปิด; หากยังยืนยันไม่ได้ให้ใช้ลิงก์ไป Meta และแสดงว่ายังไม่รองรับ ห้ามสมมติว่าเปิดหน้าต่าง DM แล้ว
- รับ webhook ซ้ำ/สลับลำดับ/ลบคอมเมนต์ได้ เก็บ tombstone และไม่คืนข้อความที่ลบกลับจาก event เก่า
- External dependency: เอกสาร Meta ทางการถูกตอบ 429 ระหว่างจัดทำแผน จึงยังไม่ยืนยัน permissions, payload revision และ private-reply eligibility สำหรับ app นี้ ต้องทำ capability probe บน test app ก่อนเปิด sending. งาน UI/backend และ fixtures ทำต่อได้ แต่ห้ามอ้างว่าส่งจริงผ่าน
- เอกสารที่ต้องตรวจใน capability task: https://developers.facebook.com/docs/graph-api/webhooks/reference/page/ และ https://developers.facebook.com/docs/messenger-platform/discovery/private-replies/ (ลิงก์สำหรับตรวจ ไม่ใช่หลักฐานว่าฟีเจอร์เปิดได้ใน app ปัจจุบัน)

## 4. Mention และส่งต่องาน

- Mention เก็บ `ChatNoteMention(noteId,userId)` แบบ unique pair; request ส่ง user IDs แยกจาก content ไม่ parse ชื่อเป็นตัวตน
- ผู้รับเลือกได้เฉพาะ active staff ที่มีสิทธิ์งานนั้นอยู่แล้ว; Mention ไม่เพิ่ม company/branch grants ไม่ให้เห็นเอกสารเครดิตเพิ่ม
- Mention = แจ้งให้อ่าน; ส่งงาน = สร้าง Todo `CHAT_HANDOFF` มี next action, dueDate, assignee, roomId ใช้ TODO/DOING/DONE เดิมและ CANCELLED ที่ F2 เพิ่ม; REVIEW เดิมยังใช้ได้กับงานทั่วไป แต่ไม่อยู่ใน handoff flow
- ปุ่มรับงานเปลี่ยนเฉพาะ Todo; คนฝากดูความคืบหน้าได้ภายใต้สิทธิ์เดิม การตอบสำเร็จ/โอน room ยังผ่าน AssignmentService และ guard ค่าคอมเดิม
- บันทึกโน้ต+mention+staff inbox item ใน transaction เดียว; retry ด้วย clientRequestId คืนงานเดิม; จบงานก่อน due แล้ว cron ต้องไม่แจ้งอีก

## 5. หลังการขายจากแชท

- เพิ่ม `ChatServiceRequest` เป็นใบรับเรื่องทางแชท: roomId, customerId nullable, symptom, requestedProductId/contractId/saleId nullable, todoId unique FK (เจ้าของงานและ dueDate อ่านจาก Todo), status (`OPEN`, `WAITING_CUSTOMER`, `LINKED`, `RESOLVED`, `CANCELLED`), afterSalesCaseId nullable unique, revision, requestKey unique, timestamps/deletedAt. ชื่อ UI “รับเรื่องหลังการขาย”
- ไม่สร้าง AfterSalesCase/RepairTicket ทันทีถ้ายังไม่มีข้อมูลรับฝาก/รูป/การยืนยันตาม flow เดิม; ไม่พิมพ์ใบรับฝาก ไม่ส่งข้อความว่าได้รับเครื่องแล้ว และไม่ลงบัญชีจากใบรับเรื่องนี้
- เมื่อพร้อมเปิดเคสจริง ให้ prefill flow AfterSales เดิม ไม่ข้าม validation; ส่ง serviceRequestId และผูก case ใน transaction เดียวกับการสร้าง case เพื่อไม่สร้างซ้ำเมื่อ retry
- ผูกเคสเดิมได้เมื่อ customer + เครื่อง/สัญญาตรงและ actor มีสิทธิ์ทั้งสองฝั่ง; ถ้าระบุไม่ได้ให้เลือกตรวจ ไม่ผูกอัตโนมัติ
- หลัง LINKED แสดง stage จาก AfterSalesCase/RepairTicket โดยตรง ปิดงานบริการตาม lifecycle เดิม ไม่เก็บสำเนาสถานะซ่อมที่แก้แยกกันได้
- Todo `CHAT_SERVICE` ผูก serviceRequestId สำหรับคิว/กำหนดเวลา; ใบรับเรื่องถือ assignee/due เป็น projection ของ Todo โดยไม่เปิด writer ซ้ำ (schema จริงใช้ Todo เป็น source of truth ของสองค่านี้)

## 6. รายงานบริหาร

- แยกจำนวนข้อความกับวงรอบตอบ: บอทตอบครั้งแรก, คนตอบครั้งแรก, median/p90 เวลารอคน, วงรอบเกิน SLA, งานค้าง ณ ตอนนี้ และงานปิดโดยไม่ตอบ
- ผู้ตอบ = firstHumanStaffId ของวงรอบ; เจ้าของห้อง = assignment ณ เหตุการณ์ที่วัด; เจ้าของยอดขาย = sale/contract attribution เดิม ห้ามใช้ assignedTo ปัจจุบันแทนสามความหมายนี้
- รักษา “ไม่ทราบผู้ตอบ” สำหรับ Page echo ที่ไม่มี staff identity และไม่ยกเครดิตให้เจ้าของห้องปัจจุบัน
- Funnel จาก Journey เดิม; รายงาน “สถานะปัจจุบันของกลุ่มลูกค้าที่เข้ามาในช่วงวันที่” ต้องติด label นี้ ไม่อ้างว่าเป็น historical snapshot ณ สิ้นวัน
- ขายจากแชท = ลูกค้า canonical ที่มี inbound chat ก่อนรายการขายที่เข้าเงื่อนไขเดิม; ไม่อ้าง causal attribution; แยก unmatched และไม่นับ sale/contract คู่เดียวซ้ำ
- แยกยอดขายตามนิยามเดิมของเอกสาร/บริษัท ใช้ Decimal ฝั่ง server; ไม่รวมค่างวดรับชำระเป็นยอดขายซ้ำ
- ข้อมูลก่อน cutover/ที่ถูก retention ลบ แสดง coverage และ unknown; ห้ามเติมศูนย์แทนไม่มีข้อมูล

## ลำดับส่งมอบและเกณฑ์จบ

ลำดับแนะนำ: F1 → F2 → F4 → F3 → F5 → F6; เตรียม Meta capability ของ F3 ได้ระหว่างรอ แต่ไม่ให้บล็อกอีก 5 ข้อ

จบเมื่อทั้งหกมี API ที่ scoped, UI desktop/mobile, negative tests, migration บน DB แยก และ local preview ที่ตรวจ flow ได้ พร้อมบันทึกสิ่งที่ใช้ provider จำลอง. การตรวจ Meta จริงเป็น gate เพิ่มของ F3 แยกจากความเสร็จของ local implementation

นอกขอบเขต: Instagram/TikTok, Broadcast, round-robin, custom workflow builder, เปลี่ยนค่าคอม, เปลี่ยนสูตรบัญชี, ส่งข้อความอัตโนมัติใหม่ถึงลูกค้า
