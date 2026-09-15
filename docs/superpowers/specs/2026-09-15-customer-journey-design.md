# การเดินทางของลูกค้า — สเปกการออกแบบ (2026-09-15)

> ที่มา: workflow ออกแบบ 3 แนวทาง (A ตาราง materialized · B union ตอนอ่าน · C ผสม) → กรรมการ 3 มุม (ความถูกต้องข้อมูล · แรงงานในโค้ดเบส · ประโยชน์ต่อร้าน) → สังเคราะห์เป็นแบบเดียว · เจ้าของสั่ง 2026-09-15 "อยากฟิวเก็บบันทึก customer journey ด้วย" และ "วางแผน เขียน code โดยใช้ sub agent ได้เลย"

## แบบที่เลือก

แนวทาง C (Hybrid) แบบตัดแต่งแล้ว มี 4 ส่วน: (1) event อัตโนมัติอ่านสดจากตารางต้นทาง (2) ตารางเล็ก customer_journey_entries ต่อท้ายอย่างเดียว เก็บทั้งช่วงเวลาที่วันนี้ถูกเขียนทับ (รับมาจาก A แต่มีจุดเขียนแค่ราว 9 จุด ทุกจุดเขียนหลัง commit และไม่อยู่ในทรานแซกชันเงิน) และบันทึกมือ 1-3 แตะ (3) แคชสรุป 1:1 customer_journey_states ที่คำนวณด้วยไฟล์ SQL ชุดเดียว ใช้ทั้งตอนคำนวณรายคน cron และ backfill โดยขั้น "ซื้อแล้ว" ต้องตรวจสดจาก BOUGHT_WHERE ทุกครั้งที่อ่าน (4) คอลัมน์ customers.merged_into_id ตั้งในทรานแซกชันเดียวกับ absorbPlaceholder และยุบ chain ให้เหลือชั้นเดียว · ตัดการเลื่อนขั้นด้วยมือของ C ออก เหลือแค่ป้าย "หลุด" · ใช้ขั้น "รู้ตัวตน" ของ B แทน "คุยแล้ว"

### เหตุผล

ตัดสินจากเหตุผลของกรรมการทั้งสามเลนส์รวมกัน ไม่ได้บวกคะแนน และแนวทางที่มีข้อห้ามแก้ไม่ได้ในเลนส์ใดเลนส์หนึ่งตกรอบ

แนวทาง A ตกรอบในเลนส์แรงงาน:
- ต้องฝัง JourneyRecorder ราว 30 จุด รวมทรานแซกชันขาย การ activate สัญญา และ payment-helpers
- ถ้า statement ใดล้มใน Prisma interactive tx ใบขายจริงล้มทั้งใบ
- ต้องเปลี่ยนลายเซ็น activate(id) กับ createForCustomer
- cron reconcile คือกติกาชุดที่สองที่ต้องแก้คู่กันไปตลอด ร้านที่มีคนซื้อหลักสิบไม่คุ้ม
- ในรูปปัจจุบันยังพึ่ง audit ที่ R12 ข้ามได้ (customer-merge.service.ts:210-228) และ dedupe ต่อสัญญาต่อสถานะทำให้รอบค้างชำระซ้ำหาย

แนวทาง B ตกรอบในเลนส์ความถูกต้องและประโยชน์:
- ประกาศว่าช่วงเวลาที่ถูกเขียนทับอยู่นอกขอบเขต ประวัติจึงหายต่อทุกวัน ขัดกับคำขอ "เก็บบันทึก" โดยตรง
- ไม่มีตารางสรุป จึงกรอง "ติดขั้นไหน" บนผู้สนใจราว 9 พันคนไม่ได้
- กรอง deleted_at ของข้อความ ทำให้ cohort แรก (แชทเริ่ม 2026-05-13) เปลี่ยนตัวเลขย้อนหลังเองตั้งแต่ราว 13 พ.ย. 2026

แนวทาง C มีข้อห้ามที่กรรมการระบุว่าแก้ได้ ได้คะแนนประโยชน์สูงสุด (7) และคะแนนความถูกต้อง/แรงงานใกล้อันดับหนึ่ง (6.5/6.5) จึงชนะ ข้อห้ามแก้ดังนี้:
- แคชเก่าหลังขาย: ขั้น PURCHASED ใน summary ตรวจสดด้วย exists query ตัวเดียวกับ BOUGHT_WHERE ถ้าไม่ตรงกับแคชจะคำนวณใหม่ทันที ไม่ต้องให้ writer ตั้ง dirty
- ขั้นมือปนกับขั้นจากระบบ: ตัด STAGE_MARK ออก ขั้นทุกขั้นมาจากหลักฐานในระบบ มือทำได้แค่ป้าย "หลุด" และ "เปิดใหม่"
- ข้อความทักทายอัตโนมัติของ FB ทำให้ห้องที่มีข้อความ STAFF เป็น 8,840/8,992: ลด "ร้านตอบแล้ว" เหลือเป็นจุดสัมผัสแบบค่าประมาณ แล้วใช้ "รู้ตัวตน" ของ B เป็นขั้นแทน

สิ่งที่ reuse / extend / replace จากของเดิม:
- REUSE: TimelineEvent contract, groupByDate, EventCard, DateRangePicker และค่าคงที่ CUSTOMER_BOUGHT_* ใน customer-sort.ts:61-73
- EXTEND: แยก 5 query ใน overdue/timeline.service.ts:45-80 ออกเป็น contract-event-sources.ts ที่รับ contractIds[] และ keyset
  - getFullTimeline กับ GET /overdue/contracts/:id/full-timeline คงรูปเดิม มี golden test กันไว้
  - การเปลี่ยน PAYMENT จาก updatedAt (บรรทัด 108) เป็น paidDate แยกเป็น PR ของตัวเอง
- EXTEND ฝั่งเว็บ: Customer360Timeline.tsx กลายเป็นตัวห่อบาง ๆ ของ components/timeline/EventTimeline.tsx (รับ style map และชุดชิปเป็น prop) · TimelineFilterChips รับ prop chips ถ้าไม่ส่งจะได้ 7 ชิปเดิม · useCustomer360 ไม่แตะ · CollectionsPage ยังกรองในหน่วยความจำและเพดาน 100 เหมือนเดิม
- REPLACE: การ์ด "ประวัติการดำเนินการ" ที่เห็นเฉพาะ OWNER ใน CustomerDetailPage.tsx:453-460 ถูกแทนด้วยแท็บการเดินทางเมื่อหน้ารีดีไซน์ลง

เงื่อนไขตั้งต้นที่ต้องผ่านก่อน: ข้อมูล prod วันที่ 2026-09-15 บอกว่า #1592/#1593 merge แล้วแต่ยังไม่ deploy (ห้องไม่มีเจ้าของ 8,991/8,992 · customers ล่าสุด 2026-09-08 · audit merge = 0) ต้อง deploy และรัน backfill:chat-prospects ก่อน เป็นเฟส 0 มิฉะนั้นแท็บของผู้สนใจทุกคนว่าง

### ความคิดที่ยกมาจากแบบอื่น

- จาก A: ช่วงเวลาที่วันนี้ถูกเขียนทับ (activate สัญญา, ตีกลับสัญญาแต่ละรอบ, ผล AI เครดิต, บอทส่งต่อ, ได้เบอร์, ผูก LINE ร้าน, กดลิงก์สินค้า, รวม placeholder) เขียนเป็นแถวใน customer_journey_entries ตั้งแต่ deploy · dedupeKey ผูกกับเอกสาร/แถว audit ไม่ผูกลูกค้า จึงย้ายตอน merge ได้ไม่ชน unique · เขียนหลัง commit แบบ best-effort (try/catch + Sentry) ไม่อยู่ใน tx เงิน ยกเว้น PLACEHOLDER_MERGED ที่เขียนใน tx ของ absorbPlaceholder ได้ เพราะไม่ใช่เส้นทางเงิน และแก้ปัญหา audit ถูกข้ามตาม R12
- จาก A: whitelist key ต่อชนิดเหตุการณ์ด้วย zod (JOURNEY_DATA_SCHEMAS) และ snapshot test ว่าใน response ไม่มี phone/nationalId/address/ข้อความแชท · AI_LEAD_CAPTURED ใช้เฉพาะ productId/packageChoice/downAmount/visitPlan
- จาก A: ชิป 'รู้จักร้านจากไหน' แตะเดียวใน CustomerCreateDialog / POS CustomerSearch / ขั้นเลือกลูกค้าของ ContractCreatePage และคำใบ้ SamePerson 'อาจเป็นผู้สนใจ Facebook ชื่อ … [ใช่ รวมประวัติแชท]' ที่เรียก POST /customers/:id/absorb-into/:targetId เดิม ทั้งสองอย่างอยู่ในขอบเขตหลัก
- จาก A: ด่านใน CLI ต้องหยุดจริง ถ้าห้องที่ไม่มีเจ้าของ (BACKFILL_WHERE) เกิน 1% ให้ exit 1 · exit 2 เมื่อจำนวน PURCHASED ในแคช ≠ count BOUGHT_WHERE · funnel แสดง caveat 'ลูกค้าซื้อ N คนที่ไม่มีประวัติแชทผูก' · มีตัวเลือกไม่นับ placeholder ที่ลูกค้าไม่เคยส่งข้อความ
- จาก A (ทางเลือกเฟส 4): ตอนซื้อให้เรียก AdsTrackingService.markConversion ที่ยังไม่มีคนเรียก หน้า /ads/roi จะได้ตัวเลขทันทีที่ข้อมูลโฆษณากลับมา
- จาก B: ขั้น 'รู้ตัวตน' (ได้เบอร์/เลขบัตร, ผูก LINE, เป็นปลายทางของการรวม) แทน ENGAGED ที่ข้อความทักทายอัตโนมัติ FB ทำให้ทุกห้องผ่าน
- จาก B: เปิด id ของ placeholder ที่ถูกรวมแล้ว → ตอบ 200 { redirectToCustomerId } · ACCOUNTANT ไม่เห็นกลุ่มแชท (สิทธิ์เดียวกับ chat-summary) · SALES เห็นเครดิตจากแชทเฉพาะห้องที่ตัวเองดูแลหรือยังไม่มีผู้ดูแล (creditHistoryAccess)
- จาก B: ข้อความบนจอบอกว่าเหตุการณ์ไหนเป็นค่าประมาณ (ป้าย reliability) และท้ายแท็บแสดงรายการ 'สิ่งที่ระบบยังไม่เก็บ'
- จาก C (คงไว้): merged_into_id ตั้งใน tx และยุบ chain (updateMany where mergedIntoId=placeholderId → targetId) · ตอนรวมให้ contactedAt/firstSource ยึดค่าที่เก่ากว่าเสมอ ไม่พึ่ง R24 · funnel แสดง unlinkedRooms
- จากกรรมการ: retention ของ ChatMessage เป็น soft-delete (notifications/services/retention.service.ts) ⇒ การนับข้อความและหาเวลาข้อความแรกต้องรวมแถวที่ deleted_at ไม่ null และแช่แข็ง contactedAt/firstStaffReplyAt ไว้ในแคชเผื่อ policy เปลี่ยน
- จากกรรมการ: event ติดตามหนี้ที่แสดงในแท็บลูกค้าต้องตัด DunningAction.messageContent (timeline.service.ts:120-123) และ callLog.notes (:94) ออก · หน้า CollectionsPage คงเดิม

## Data model

```prisma
// migration 2026091xxxxxxx_customer_journey — apps/api/prisma/schema.prisma

// 1) ติดตัวตนข้าม merge
model Customer {
  ...
  mergedIntoId String?   @map("merged_into_id")   // ตั้งใน tx ของ absorbPlaceholder คู่ deletedAt; chain ถูกยุบเหลือชั้นเดียวเสมอ
  mergedInto   Customer? @relation("CustomerMergedInto", fields: [mergedIntoId], references: [id])
  absorbed     Customer[] @relation("CustomerMergedInto")
  @@index([mergedIntoId])
}
// migration SQL (idempotent): UPDATE customers c SET merged_into_id = a.entity_id FROM audit_logs a
//   WHERE a.action='CUSTOMER_PLACEHOLDER_MERGED' AND a.entity='customer'
//   AND a.old_value->>'placeholderId' = c.id AND c.deleted_at IS NOT NULL AND c.merged_into_id IS NULL;

// 2) แถวต่อท้ายอย่างเดียว: ช่วงเวลาที่ระบบเขียนทับ (SYSTEM) + บันทึกมือ (MANUAL)
model CustomerJourneyEntry {
  id               String    @id @default(uuid())
  customerId       String    @map("customer_id")          // เจ้าของปัจจุบัน ย้ายตอน merge
  customer         Customer  @relation(fields: [customerId], references: [id], onDelete: Restrict)
  originCustomerId String    @map("origin_customer_id")   // id ตอนเขียน ไม่เปลี่ยน
  origin           String    @db.VarChar(8)               // SYSTEM | MANUAL
  kind             String    @db.VarChar(40)              // JourneyEntryKind (TS union ใน packages/shared/src/customer-journey.ts)
  occurredAt       DateTime  @map("occurred_at")
  actorType        String    @db.VarChar(10) @map("actor_type") // STAFF|CUSTOMER|BOT|SYSTEM
  actorUserId      String?   @map("actor_user_id")        // nullable ⇒ ไม่ติด FK แบบ R12
  actorUser        User?     @relation("JourneyEntryActor", fields: [actorUserId], references: [id])
  roomId           String?   @map("room_id")              // อ้างห้องเท่านั้น ไม่มีข้อความ
  refType          String?   @db.VarChar(24) @map("ref_type") // contract|sale|credit_check|booking|product|audit_log
  refId            String?   @map("ref_id")
  data             Json?                                  // ผ่าน JOURNEY_DATA_SCHEMAS[kind] (zod whitelist)
  // เฉพาะ MANUAL
  channel          String?   @db.VarChar(16)              // PHONE|FB_APP|LINE_APP|WALK_IN|OTHER
  outcome          String?   @db.VarChar(20)              // APPOINTED|VISITED|THINKING|BUDGET|NO_ANSWER|BOUGHT_ELSEWHERE|NOT_INTERESTED
  lostReason       String?   @db.VarChar(20) @map("lost_reason") // NOT_INTERESTED|BOUGHT_ELSEWHERE|CREDIT_FAILED|UNREACHABLE|OTHER
  heardFrom        String?   @db.VarChar(16) @map("heard_from")  // FB_AD|FB_PAGE|TIKTOK|LINE|GOOGLE|FRIEND|WALK_BY|OLD_CUSTOMER|OTHER
  note             String?   @db.VarChar(140)             // DTO ปฏิเสธ /\d[\d\s-]{8,}\d/ ; ไม่ grant ให้ MCP ; ไม่ส่งออก Excel
  dedupeKey        String?   @unique @map("dedupe_key")   // SYSTEM: `${kind}:${sourceRowOrAuditId}` ; MANUAL: null
  createdAt        DateTime  @default(now()) @map("created_at")
  deletedAt        DateTime? @map("deleted_at")           // 'เลิกทำ' ของ MANUAL เท่านั้น
  deletedById      String?   @map("deleted_by_id")
  @@index([customerId, occurredAt(sort: Desc), id])
  @@index([kind, occurredAt])
  @@map("customer_journey_entries")
}
// SYSTEM kinds: CONTRACT_ACTIVATED, CONTRACT_REVIEWED(ต่อรอบ), CREDIT_CHECK_OPENED_BY, CREDIT_AI_SCORED, BOT_HANDOFF,
//               CONTACT_ADDED, LINE_LINKED, PRODUCT_LINK_CLICK, PLACEHOLDER_MERGED
// MANUAL kinds: TOUCHPOINT, HEARD_FROM, MARKED_LOST, REOPENED
// ตัวเขียน: JourneyEntryWriter.recordAfterCommit(e) = createMany({skipDuplicates:true}) ใน try/catch + Sentry — ห้ามส่ง tx ของโดเมนเงินเข้ามา
//          JourneyEntryWriter.recordInTx(tx, e) ใช้ได้ที่เดียว: absorbPlaceholder

// 3) แคชสรุป 1:1 — คำนวณได้ใหม่ทั้งหมด ห้ามแก้มือ
model CustomerJourneyState {
  customerId        String    @id @map("customer_id")
  customer          Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)
  stage             String    @db.VarChar(12)   // CONTACTED|IDENTIFIED|INTERESTED|CREDIT|PURCHASED
  stageEnteredAt    DateTime  @map("stage_entered_at")
  path              String    @db.VarChar(18)   // UNKNOWN|INSTALLMENT|CASH|EXTERNAL_FINANCE
  contactedAt       DateTime  @map("contacted_at")         // แช่แข็ง; merge เลือกค่าเก่ากว่า
  identifiedAt      DateTime? @map("identified_at")
  interestedAt      DateTime? @map("interested_at")
  creditAt          DateTime? @map("credit_at")
  firstPurchaseAt   DateTime? @map("first_purchase_at")
  firstPurchaseKind String?   @db.VarChar(18) @map("first_purchase_kind")
  firstStaffReplyAt DateTime? @map("first_staff_reply_at") // แช่แข็ง, approximate
  firstChannel      String    @db.VarChar(20) @map("first_channel")  // CHAT_FACEBOOK…|WALK_IN|REFERRAL|UNKNOWN
  firstSource       String    @db.VarChar(30) @map("first_source")   // แช่แข็ง: AD:<campaignId> > CHAT_* > REFERRAL > HEARD:<x> > WALK_IN
  firstAdCampaignId String?   @map("first_ad_campaign_id")
  heardFrom         String?   @db.VarChar(16) @map("heard_from")
  lastCustomerAt    DateTime? @map("last_customer_at")
  lastTouchAt       DateTime? @map("last_touch_at")
  lostAt            DateTime? @map("lost_at")
  lostReason        String?   @db.VarChar(20) @map("lost_reason")
  computedAt        DateTime  @map("computed_at")
  @@index([stage, stageEnteredAt])
  @@index([firstSource, contactedAt])
  @@index([firstChannel, contactedAt])
  @@map("customer_journey_states")
}
// apps/api/src/modules/customer-journey/sql/journey-state.sql: INSERT … SELECT … ON CONFLICT (customer_id) DO UPDATE
//   พารามิเตอร์ $ids uuid[] | NULL(=ทุกคน) — ใช้โดย recompute(id), cron 03:30, CLI backfill (ไฟล์เดียว)
//   อ่าน chat_messages รวม deleted_at ไม่ null (retention เป็น soft-delete) ; contactedAt = LEAST(ค่าเดิมในแคช, MIN(chat_rooms.created_at รวมห้องที่ลบ), MIN(chat_messages.created_at role=CUSTOMER), customers.created_at ถ้าไม่ใช่ CHAT_*)
//   PURCHASED ใช้ CUSTOMER_BOUGHT_CONTRACT_STATUSES / CUSTOMER_BOUGHT_SALE_TYPES จาก @installment/shared (ฉีดเป็นพารามิเตอร์)

// 4) ตัวอ่านสด CustomerJourneyService.list(customerId, {cursor, limit, groups, from, to}, actor)
//   ids = [customerId, ...customers.where({mergedIntoId: customerId}).id]   (ชั้นเดียวเพราะยุบ chain แล้ว)
//   roomIds = chat_rooms customer_id = ANY(ids) (รวมห้องที่ soft-delete จาก mergeRooms)
//   contractIds / creditCheckIds / bookingIds หาครั้งเดียว
//   sources/*.source.ts คืน JourneyEvent[] (ts,id) < cursor ORDER BY ts DESC, id DESC LIMIT limit+1 → merge-sort → slice
//   contract-event-sources.ts (แยกจาก overdue/timeline.service.ts) รับ contractIds[] ใช้ร่วมกับ OverdueTimelineService
//   แชทรายวัน: SELECT room_id, role, (created_at AT TIME ZONE 'Asia/Bangkok')::date d, count(*), max(created_at)
//              FROM chat_messages WHERE room_id = ANY($roomIds) AND role IN ('CUSTOMER','STAFF','BOT') GROUP BY 1,2,3  (index [roomId, createdAt])
// JourneyEvent = TimelineEvent + { group, stage|null, actor:{type,id?,name?}|null, reliability:'exact'|'approximate', href?, origin:'SOURCE'|'SYSTEM_ENTRY'|'MANUAL' }
```

## ขั้นการเดินทาง

### 1 ทักเข้ามา (CONTACTED)

ทุกคนเริ่มที่ขั้นนี้ ทั้ง placeholder จากแชท (acquisitionSource CHAT_*) และลูกค้าที่พนักงานสร้างเอง (หน้าร้าน)

เวลาเข้าขั้น = LEAST ของค่าต่อไปนี้:
- MIN(chat_rooms.created_at) ของทุกห้องที่ customer_id อยู่ใน ids (นับห้องที่ถูกลบด้วย)
- MIN(chat_messages.created_at role=CUSTOMER) (นับแถวที่ถูก soft-delete ด้วย)
- customers.created_at เมื่อ acquisitionSource ไม่ขึ้นต้น CHAT_

แช่แข็งค่าไว้ในแคช: คำนวณใหม่ได้ค่าที่เก่ากว่าเท่านั้น ห้องที่ facebook-backfill นำเข้ามี created_at เป็นเวลานำเข้า จึงต้องเทียบกับข้อความแรกของลูกค้าด้วย

firstChannel = acquisitionSource ของห้อง/แถวที่เก่าสุด · walk-in = WALK_IN · referredById ไม่ null = REFERRAL

### 2 ได้เบอร์ / ยืนยันตัวตน (IDENTIFIED)

เข้าขั้นเมื่อมีข้อใดข้อหนึ่ง:
- customers.phone หรือ nationalId ไม่ว่าง (คือพ้นสภาพ isChatPlaceholder)
- มี customer_line_links ที่ unlinkedAt เป็น null
- เป็นปลายทางของ PLACEHOLDER_MERGED

เวลาเข้าขั้น = MIN ของ entry CONTACT_ADDED / LINE_LINKED / PLACEHOLDER_MERGED (เก็บตั้งแต่ deploy)

ย้อนหลัง (approximate):
- ลูกค้าที่สร้างพร้อมเบอร์ = customers.created_at
- placeholder ที่เติมเบอร์ภายหลัง = customers.updated_at
- ผูก LINE = customer_line_links.linkedAt (ถ้าผูกซ้ำ ค่านี้ถูกรีเซ็ต)

ใช้แทน 'คุยแล้ว' เพราะห้องที่มีข้อความ STAFF บน prod เป็น 8,840/8,992 จากข้อความทักทายอัตโนมัติ FB ส่วน 'ร้านตอบครั้งแรก' แสดงเป็นจุดสัมผัส ไม่ใช่ขั้น

### 3 สนใจจริง / นัด-จอง (INTERESTED)

เวลาเข้าขั้น = MIN ของ:
- bookings.created_at
- todos.created_at ที่ room_id อยู่ในห้องของลูกค้าและ due_date ไม่ null
- audit AI_LEAD_CAPTURED ที่ entity_id อยู่ใน ids
- online_installment_applications.created_at
- product_reservations.reserved_at (customer_id)
- trade_ins.created_at (customer_id)
- entry MANUAL TOUCHPOINT outcome APPOINTED/VISITED (แถบขั้นติดป้ายเล็ก 'พนักงานบันทึก')

เป็นขั้นเดียวที่บันทึกมือนับเป็นหลักฐานได้ เพราะทีมนัดลูกค้าในแอป FB ซึ่งระบบไม่เห็น

### 4 ตรวจเครดิต (CREDIT) — เฉพาะผ่อนกับร้าน

เวลาเข้าขั้น = MIN ของ:
- credit_checks.created_at (customer_id อยู่ใน ids; แถวที่นำเข้าจากแชทมี created_at ย้อนเป็นเวลา OCR = approximate)
- room_credit_analyses.created_at status COMPLETED บนห้องของลูกค้า
- contracts.created_at (deleted_at null)

ตั้ง path=INSTALLMENT

ถ้าผู้จัดการตัดสินล่าสุด (audit CREDIT_CHECK_OVERRIDE) เป็น REJECTED และยังไม่ซื้อ ⇒ ธง 'เครดิตไม่ผ่าน' ขั้นเป็นสีแดง

คนที่ซื้อเงินสดหรือไฟแนนซ์นอกโดยไม่มีใบตรวจ ⇒ แถบแสดง 'ข้าม (เงินสด/ไฟแนนซ์นอก)' ไม่นับว่าค้าง

ตั้งด้วยมือไม่ได้

### 5 ซื้อแล้ว (PURCHASED)

ใช้ predicate เดียวกับ BOUGHT_WHERE ของ customer-query.service.ts (ids ทุกตัว):
- sales.deleted_at null และ sale_type อยู่ใน CUSTOMER_BOUGHT_SALE_TYPES ['CASH','EXTERNAL_FINANCE']
- หรือ contracts.deleted_at null และ status อยู่ใน CUSTOMER_BOUGHT_CONTRACT_STATUSES

summary endpoint ตรวจสดทุกครั้ง ถ้าไม่ตรงกับแคชจะคำนวณใหม่ในคำขอนั้น แถบขั้นจึงไม่มีทางขัดกับแท็บลูกค้า/ผู้สนใจ

firstPurchaseAt = LEAST ของ:
- MIN(sales.created_at ของประเภทข้างบน)
- MIN(entry CONTRACT_ACTIVATED.occurredAt) หรือ ถ้าไม่มี = MIN(sales.created_at sale_type INSTALLMENT contract_id) ที่สร้างใน tx เดียวกับ activate (contract-workflow.service.ts:503)

ยกเลิกใบขาย/สัญญาจน predicate เป็นเท็จ ⇒ ถอยกลับไปขั้นสูงสุดก่อนหน้าเอง

ตั้งด้วยมือไม่ได้

### ป้ายหลังการขาย (ไม่ใช่ขั้น)

แสดงต่อจากขั้น 5 ตามสัญญาล่าสุด:
- ผ่อนอยู่ (ACTIVE)
- ค้างชำระ (OVERDUE)
- ผิดนัด (DEFAULT)
- ปิดสัญญาแล้ว (COMPLETED/EARLY_PAYOFF/CANCELED/TERMINATED/CLOSED_BAD_DEBT)

มีเพิ่มได้อีก 3 ป้าย:
- ซื้อซ้ำ (ซื้อตั้งแต่ 2 ครั้ง)
- มีใบซ่อม (repair_tickets)
- ติดตามตัวไม่ได้ (audit SKIP_TRACING_UPDATE status LOST)

### ป้ายหลุด (LOST) และเงียบ — ไม่ใช่ขั้น

หลุด:
- ตั้งด้วยมือเท่านั้น (entry MARKED_LOST พร้อม lostReason) และตั้งได้เฉพาะคนที่ยังไม่ซื้อ
- ขั้นเดิมไม่เปลี่ยน แค่เพิ่มป้าย
- ล้างเองเมื่อมีข้อความ CUSTOMER ใหม่ หรือ TOUCHPOINT หลัง lostAt (ไทม์ไลน์แสดง 'กลับมาติดต่ออีกครั้ง') หรือกดปุ่ม 'เปิดใหม่'

เงียบ:
- คำนวณตอนอ่าน ไม่เก็บ
- = ยังไม่ซื้อ และ max(lastCustomerAt, lastTouchAt) เกิน 30 วัน

'ค้างขั้นนี้ N วัน' = วันนี้ − stageEnteredAt

## รายการเหตุการณ์

| type | ป้าย | กลุ่ม | ต้นทาง | ขั้น | ผู้กระทำ | ความแม่นยำ |
|---|---|---|---|---|---|---|
| CHAT_ROOM_OPENED | ทักแชทครั้งแรกทาง {Facebook\|LINE ร้าน\|LINE การเงิน\|TikTok\|เว็บ} · ห้องถัดไป = ทักเพิ่มอีกช่องทาง/ห้องใหม่ | แชท/ติดต่อ | chat_rooms.created_at, channel (customer_id ∈ ids รวมห้องที่ soft-delete) เทียบ MIN(chat_messages.created_at role=CUSTOMER) | ทักเข้ามา | ลูกค้า | ห้องที่เกิดหลัง deploy #1592 = exact · ห้องที่นำเข้าย้อนหลังใช้ LEAST กับข้อความแรกของลูกค้า = approximate |
| AD_REFERRAL | ทักจากโฆษณา: {adName\|campaignName} | แชท/ติดต่อ | chat_rooms.attribution_id → ads_attributions.first_touch, ads_campaigns | ทักเข้ามา (ตั้ง firstAdCampaignId) | ลูกค้า | exact ถ้ามีข้อมูล · prod = 0 แถว ไม่มีข้อมูลต้นทาง (messaging_referrals ถูกถอด) · กดโฆษณาตัวใหม่ทำให้แถวเก่าหลุด |
| PRODUCT_LINK_CLICK | กดมาจากสินค้าบนเว็บ: {รุ่น} | แชท/ติดต่อ | entry SYSTEM เขียนใน facebook-webhook.controller.ts handleProductReferral (ref p:<productId>) หลังส่งข้อความระบบ | ทักเข้ามา | ลูกค้า | วันนี้ไม่ได้บันทึกแบบมีโครงสร้าง · เก็บตั้งแต่ deploy · ไม่ย้อนหลัง (ไม่แกะข้อความ) |
| CHAT_DAY | คุยแชท: ลูกค้า {n} ข้อความ · ร้านตอบ {m} · บอท {k} | แชท/ติดต่อ | chat_messages GROUP BY room_id, วันเวลาไทย, role (นับรวมแถวที่ retention soft-delete แล้ว ไม่อ่านข้อความ) | — | ลูกค้า / ร้าน (ไม่ระบุชื่อถ้า staff_id ว่าง) / บอท | จำนวนลูกค้า exact · จำนวนร้าน approximate: ข้อความทักทายอัตโนมัติ FB ถูกเก็บเป็น STAFF และมี staff_id แค่ 9 จาก 72,816 · หลัง mergeRooms ข้อความถูกย้ายไปห้องหลัก จึงไปรวมอยู่ใต้ห้องหลัก |
| FIRST_STAFF_REPLY | ร้านตอบครั้งแรก (หลังทัก {x} นาที) | แชท/ติดต่อ | MIN(chat_messages.created_at) role=STAFF AND (outbound_sent_at NOT NULL OR external_message_id NOT NULL) · ข้าม echo (outbound_sent_at NULL) ทุกใบที่ออกภายใน 60 วิหลังคำตอบใบแรกสุดของห้อง เมื่อคำตอบใบแรกสุดนั้นห่างข้อความลูกค้าไม่เกิน 60 วิทั้งสองทิศ (ช่วงข้อความอัตโนมัติของเพจ — ต่อยอดจาก shouldSkipFirstOutboundClear ที่ข้ามเฉพาะใบแรก) · แช่แข็งเป็น state.firstStaffReplyAt (LEAST — ทำกติกาให้แคบลงเมื่อไรต้อง reset คอลัมน์ใน PR เดียวกัน) | — (จุดสัมผัส ไม่เลื่อนขั้น) | ร้าน | approximate |
| ROOM_CLAIMED | {พนักงาน} รับดูแลห้องแชท | แชท/ติดต่อ | staff_chat_activities action IN (assign, transfer_in) metadata->>'roomId' ∈ roomIds (จำกัด created_at ≥ ห้องแรก) | — | staff_id | exact แต่ prod แทบไม่มี (มอบหมาย ≈1 ห้อง) |
| BOT_HANDOFF | บอทส่งต่อพนักงาน ({เหตุผล}) | แชท/ติดต่อ | entry SYSTEM เขียนใน HandoffManagerService.initiateHandoff หลังตั้ง handoffReason (dedupe = handoff:<roomId>:<timestamp>) | — | บอท | วันนี้ไม่ได้บันทึก (chat_rooms.handoffReason ถูกเขียนทับ) · เก็บตั้งแต่ deploy |
| AI_LEAD_CAPTURED | บอทจดความสนใจ: {รุ่น} · {ผ่อน/สด} · ดาวน์ {x} | แชท/ติดต่อ | audit_logs action=AI_LEAD_CAPTURED entity='customer' entity_id ∈ ids · ใช้เฉพาะ productId/packageChoice/downAmount/visitPlan ห้ามส่ง phone/address | สนใจจริง | บอท | exact · prod = 0 (บอทยัง whitelist) |
| APPOINTMENT | นัดเข้าร้าน {วัน เวลา} / มาตามนัดแล้ว | แชท/ติดต่อ | todos.room_id ∈ roomIds, due_date not null, created_at, completed_at, created_by_id | สนใจจริง | พนักงาน | exact · prod = 1 แถว · ไม่รู้ว่ามาจริงไหมถ้าไม่กด completed |
| CUSTOMER_CREATED_BY_STAFF | พนักงานเพิ่มเป็นลูกค้า (หน้าร้าน) | แชท/ติดต่อ | customers.created_at เมื่อ acquisition_source ไม่ขึ้นต้น CHAT_ · actor = audit_logs entity='customers' action='POST' entity_id | ทักเข้ามา + ได้เบอร์ / ยืนยันตัวตน | พนักงาน | approximate (ทาง revive-ghost / stub-upgrade ใช้ created_at เก่า) |
| CONTACT_ADDED | ได้เบอร์/เลขบัตรลูกค้าแล้ว | แชท/ติดต่อ | entry SYSTEM ใน CustomerWriteService.update / fill-contact เมื่อค่าเดิมเป็น null และค่าใหม่ไม่ null (เทียบค่าในโค้ด ไม่เก็บเบอร์) · capture-lead ที่เติมเบอร์ให้ placeholder | ได้เบอร์ / ยืนยันตัวตน | พนักงาน / บอท | วันนี้ไม่ได้บันทึก (body ใน audit ถูก REDACTED) · ย้อนหลัง = customers.updated_at (approximate) · เก็บ exact ตั้งแต่ deploy |
| PLACEHOLDER_MERGED | รวมประวัติแชท {n} ห้องเข้ากับลูกค้าคนนี้ | แชท/ติดต่อ | entry SYSTEM เขียนใน tx ของ absorbPlaceholder (dedupe merge:<placeholderId>) · ย้อนหลัง = audit CUSTOMER_PLACEHOLDER_MERGED หรือ placeholder.deleted_at + merged_into_id | ได้เบอร์ / ยืนยันตัวตน | พนักงาน / ระบบ (OTP, LIFF, พิมพ์เบอร์ใน LINE) | exact (เขียนใน tx ไม่ถูกข้ามแบบ audit R12) |
| LINE_LINKED | ผูก LINE {การเงิน\|ร้าน} แล้ว | แชท/ติดต่อ | entry SYSTEM ใน verification.service.ts bind, liff-api.service.ts, line-customer-link.service.ts selfLinkByPhone · ย้อนหลัง customer_line_links.linkedAt | ได้เบอร์ / ยืนยันตัวตน | ลูกค้า | FINANCE ย้อนหลัง approximate (ผูกซ้ำรีเซ็ต linkedAt) · LINE ร้าน วันนี้ไม่มีเวลา · exact ตั้งแต่ deploy |
| TOUCHPOINT | {พนักงาน} ติดต่อทาง {โทร\|แชทในแอป FB\|LINE\|หน้าร้าน}: {นัดแล้ว\|มาร้านแล้ว\|ขอคิดก่อน\|งบ/ดาวน์ไม่พอ\|ไม่รับสาย\|ซื้อที่อื่น\|ไม่สนใจ} | แชท/ติดต่อ | customer_journey_entries origin=MANUAL kind=TOUCHPOINT | APPOINTED/VISITED → สนใจจริง · อื่น ๆ ไม่เลื่อนขั้น | พนักงาน (created) | exact ตามที่พนักงานกด · มีเฉพาะที่กด |
| HEARD_FROM | ลูกค้าบอกว่ารู้จักร้านจาก {โฆษณา FB\|เพจ/โพสต์\|TikTok\|LINE\|Google\|เพื่อนแนะนำ\|ผ่านหน้าร้าน\|ลูกค้าเก่า\|อื่น ๆ} | แชท/ติดต่อ | entries MANUAL kind=HEARD_FROM (CustomerCreateDialog / POS / สร้างสัญญา / แท็บการเดินทาง) | — | พนักงาน | ลูกค้าบอกเอง ไม่ใช่หลักฐาน · เก็บตั้งแต่ deploy |
| MARKED_LOST / REOPENED | ติดป้ายหลุด: {เหตุผล} / เปิดใหม่ / กลับมาติดต่ออีกครั้ง | แชท/ติดต่อ | entries MANUAL kind=MARKED_LOST\|REOPENED · 'กลับมาติดต่อ' = ข้อความ CUSTOMER แรกหลัง lostAt (คำนวณตอนอ่าน) | ป้ายหลุด | พนักงาน / ลูกค้า | exact |
| CREDIT_CHECK_OPENED | เปิดตรวจเครดิต (ที่ร้าน / จากสเตทเม้นในแชท) | เครดิต | credit_checks.created_at (ai_analysis->>'source'='chat-statement' = จากแชท) · actor จาก entry CREDIT_CHECK_OPENED_BY เขียนหลัง commit ใน credit-check.controller (ที่มี user อยู่แล้ว) | ตรวจเครดิต | พนักงาน (ตั้งแต่ deploy) · ย้อนหลังไม่ทราบ | เวลา exact สำหรับที่สร้างเอง · approximate สำหรับที่นำเข้าจากแชท (created_at ย้อนเป็นเวลา OCR) · ผู้เปิดวันนี้ไม่ได้บันทึก (_userId ถูกทิ้ง) |
| CHAT_STATEMENT_ANALYZED | วิเคราะห์สเตทเม้นจากแชทแล้ว | เครดิต | room_credit_analyses.created_at status=COMPLETED room_id ∈ roomIds | ตรวจเครดิต | พนักงาน (ไม่ระบุชื่อ) | exact · SALES ที่ไม่ได้ดูแลห้องมองไม่เห็น (creditHistoryAccess) |
| CREDIT_AI_SCORED | AI ประเมินเครดิต {คะแนน} → {ผ่าน\|ส่งตรวจ\|ไม่ผ่าน} | เครดิต | entry SYSTEM หลัง commit ใน credit-check-ai-analysis.service.ts (dedupe ai:<creditCheckId>:<analysisAt>) | ตรวจเครดิต | ระบบ | วันนี้ไม่ได้บันทึก (status เขียนทับ ห้ามใช้ updatedAt) · เก็บตั้งแต่ deploy · ย้อนหลังไม่แสดง |
| CREDIT_DECISION | {ผู้จัดการ} {อนุมัติ\|ไม่อนุมัติ\|ส่งตรวจเพิ่ม} เครดิต | เครดิต | audit_logs action=CREDIT_CHECK_OVERRIDE entity='credit_check' entity_id ∈ creditCheckIds (หนึ่ง event ต่อแถว audit) | ตรวจเครดิต (REJECTED → ธงไม่ผ่าน) | audit user_id | exact |
| CREDIT_LIMIT_APPROVED | อนุมัติค่างวดไม่เกิน {x} บาท/เดือน | เครดิต | credit_approvals.created_at, approved_by_id (ทุกแถว) · used/superseded เป็นบรรทัดรอง | ตรวจเครดิต | ผู้จัดการ | exact |
| BOOKING | เปิดใบจอง {BK-…} / รับมัดจำ {x} บาท / ยกเลิกใบจอง / ใบจองหมดอายุ / แปลงเป็นใบขาย | ขาย/สัญญา | bookings.created_at(created_by_id), deposit_paid_at(deposit_received_by_id), canceled_at(canceled_by_id), converted_at · audit BOOKING_AUTO_EXPIRED | สนใจจริง | พนักงาน / ระบบ | exact |
| WEB_HOLD / ONLINE_APPLICATION | กดจองเครื่องบนเว็บ / ยื่นใบสมัครผ่อนออนไลน์ | ขาย/สัญญา | product_reservations.reserved_at (customer_id not null) · online_installment_applications.created_at | สนใจจริง | ลูกค้า | เวลาสร้าง exact · สถานะภายหลังถูกเขียนทับ · ส่วนใหญ่ customer_id ว่าง |
| TRADE_IN | ส่งเครื่องเทิร์น/ขายคืน · รับซื้อแล้ว {ราคา} | ขาย/สัญญา | trade_ins.created_at, id_card_verified_at, id_card_verified_by_id (customer_id) | สนใจจริง | พนักงาน | exact เฉพาะแถวที่ผูก customer_id · เวลาปฏิเสธ/ปิดไม่ได้บันทึก |
| SALE_CASH / SALE_EXTERNAL_FINANCE | ซื้อเงินสด {รุ่น} {ยอด} บาท / ซื้อผ่านไฟแนนซ์ {บริษัท} | ขาย/สัญญา | sales.created_at, sale_type ∈ CUSTOMER_BOUGHT_SALE_TYPES, deleted_at null, salesperson_id | ซื้อแล้ว (path CASH / EXTERNAL_FINANCE) | พนักงานขาย (ออนไลน์ = 'ออนไลน์') | exact |
| SALE_VOIDED | ยกเลิกใบขาย {เลข} ({เหตุผล}) | ขาย/สัญญา | sales.deleted_at, voided_by_id, void_reason | — (คำนวณขั้นใหม่) | พนักงาน | exact |
| CONTRACT_DRAFTED | ร่างสัญญาผ่อน {เลขสัญญา} | ขาย/สัญญา | contracts.created_at, salesperson_id (รวมร่างที่ถูกลบ แสดง 'ลบร่าง') | ตรวจเครดิต | พนักงานขาย | exact |
| CONTRACT_REVIEWED | {ผู้จัดการ} อนุมัติสัญญา / ตีกลับสัญญา: {เหตุผล} | ขาย/สัญญา | entry SYSTEM ต่อรอบ หลัง commit ใน contract-workflow.service.ts approve (:261) / reject (:324) (dedupe review:<contractId>:<reviewedAt>) · ย้อนหลัง contracts.reviewed_at/reviewed_by_id | ตรวจเครดิต | ผู้จัดการ | ย้อนหลัง approximate (เหลือรอบล่าสุด) · exact ทุกรอบตั้งแต่ deploy |
| CONTRACT_SIGNED | ลูกค้าเซ็นสัญญา | ขาย/สัญญา | signatures.signed_at signer_type=CUSTOMER contract_id ∈ contractIds | ตรวจเครดิต | ลูกค้า | exact |
| CONTRACT_ACTIVATED | เริ่มผ่อนสัญญา {เลข} · {n} งวด งวดละ {x} | ขาย/สัญญา | entry SYSTEM หลัง commit ใน contracts.controller ที่เรียก activate (มี user จาก request ไม่ต้องแก้ลายเซ็น activate(id)) · ย้อนหลัง = sales.created_at sale_type INSTALLMENT contract_id (สร้างใน tx เดียวกัน :503) | ซื้อแล้ว (path INSTALLMENT) | พนักงาน (ตั้งแต่ deploy) · ย้อนหลัง = salesperson_id | เวลาย้อนหลัง approximate แต่ใกล้จริง · exact ตั้งแต่ deploy |
| CONTRACT_ENDED | ปิดสัญญา {เลข}: {ผ่อนครบ\|ปิดก่อนกำหนด\|ยกเลิก\|บอกเลิก\|ตัดหนี้สูญ\|เปลี่ยนเครื่อง} | ขาย/สัญญา | COMPLETED/EARLY_PAYOFF = contracts.status + MAX(payments.paid_date) · CANCELED contract_cancellations.approved_at · TERMINATED audit CONTRACT_STATUS_LEGAL · EXCHANGED contracts.exchanged_at / contract_exchange_requests · CLOSED_BAD_DEBT audit | ป้ายหลังการขาย | ระบบ / ผู้จัดการ | CANCELED/TERMINATED/EXCHANGED exact · COMPLETED/EARLY_PAYOFF approximate (งวดสุดท้าย) |
| PAYMENT_RECEIVED | ชำระงวด {n} {จำนวน} ฿ / ดาวน์ / ปิดยอด | ชำระเงิน | contract-event-sources: payments status PAID, contract_id ∈ contractIds, เวลา = paid_date ?? updated_at · ชิปชำระปิดเป็นค่าตั้งต้น | ป้ายหลังการขาย | พนักงาน / gateway | paid_date exact · fallback updated_at = approximate (ติดป้าย) |
| CONTRACT_STATUS_CHANGE | สัญญา {เลข} {ค้างชำระ\|ผิดนัด\|กลับมาปกติ} | ติดตามหนี้ | audit_logs STATUS_CHANGE entity='contract' (หนึ่ง event ต่อแถว audit รอบค้างซ้ำไม่หาย) | ป้ายหลังการขาย | ระบบ (cron) | exact |
| COLLECTION_CALL / LETTER / MDM / DUNNING | โทรติดตาม: {ผล} / ส่งหนังสือ {ประเภท} / ล็อก·ปลดล็อกเครื่อง / ส่งแจ้งเตือน {ช่องทาง} | ติดตามหนี้ | contract-event-sources: call_logs.called_at(caller_id), contract_letters.dispatched_at, audit MDM_*, dunning_actions.created_at · ในแท็บลูกค้าตัด messageContent และ notes ออก | ป้ายหลังการขาย | พนักงานติดตาม / ระบบ | exact |
| AUTO_REMINDER | ส่งเตือนค่างวดทาง LINE ({T-3\|T-1\|…}) | ติดตามหนี้ | chat_auto_triggers.sent_at status=SENT customer_id ∈ ids | ป้ายหลังการขาย | ระบบ | exact (prod ยังไม่มีคนผูก LINE การเงิน) |
| SKIP_TRACING_LOST | ติดตามตัวไม่ได้ (ติดป้ายสูญหาย) | ติดตามหนี้ | audit_logs SKIP_TRACING_UPDATE entity='customer' (ใช้เฉพาะ status/reason) | ป้ายหลังการขาย | พนักงานติดตาม | exact |
| REPAIR_TICKET | เปิดใบซ่อม/เคลม · {สถานะ} | บริการ/ประกัน | repair_tickets.created_at + repair_status_logs.created_at (customer_id ∈ ids) | ป้ายหลังการขาย | พนักงาน | exact |
| LOYALTY_POINTS | ได้แต้ม {n} / แลกแต้ม {รายการ} | แต้ม | loyalty_points.created_at · loyalty_redemptions.created_at | — | ระบบ / พนักงาน | exact · ชิปปิดเป็นค่าตั้งต้น |
| TAG_CHANGED | ติดแท็ก {VIP\|เสี่ยงสูง\|…} / ถอดแท็ก | ระบบ | customer_tags.created_at, applied_by_user_id, deleted_at (ไม่แสดงแท็กซ้ำที่ merge soft-delete ภายใน 2 วินาที) | — | พนักงาน / ระบบ AUTO · ผู้ถอดไม่ได้บันทึก | เวลา exact |
| PDPA_CONSENT / KYC | ลงนามยินยอม PDPA / เพิกถอน / ยืนยันตัวตนผ่าน | ระบบ | pdpa_consents.granted_at/revoked_at (ยุบแถวซ้ำจากเปลี่ยนเครื่อง) · kyc_verifications status VERIFIED updated_at | — | ลูกค้า | PDPA exact · KYC approximate |

## API

ทุกเส้นอยู่ใน customer-journey.controller.ts (โมดูลใหม่ customer-journey) · CustomersModule import โมดูลนี้ ส่วน CustomerMergeService พึ่งแค่ JourneyEntryWriter และ JourneyStateService ที่ไม่ import CustomersModule จึงไม่เกิด circular import

1) GET /customers/:id/journey
- roles: OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT, SALES
- query (class-validator DTO):
  - limit 1-100 (ค่าตั้งต้น 30)
  - cursor = base64('isoTs|eventId') แบบ keyset
  - groups = csv ของ chat, credit, sale, payment, collections, service, points, system (ค่าตั้งต้นไม่รวม payment/points/system)
  - from / to
  - include = summary
- 200: { customerId, mergedCustomerIds: string[], summary?: JourneySummary, events: JourneyEvent[], nextCursor: string|null, counts?: Record<group, number> (เฉพาะหน้าแรก), notRecorded: string[] }
- JourneyEvent = { id: '<source>-<rowId>', type, group, stage|null, timestamp, title, subtitle?, actor: {type, id?, name?}|null, reliability: 'exact'|'approximate', origin: 'SOURCE'|'SYSTEM_ENTRY'|'MANUAL', href?: '/inbox/:roomId'|'/contracts/:id'|'/sales/:id'|'/bookings/:id'|…, metadata?: whitelisted }
- ถ้า :id เป็น placeholder ที่รวมแล้ว (deleted_at ไม่ null และ merged_into_id ไม่ null) → 200 { redirectToCustomerId } · ถ้าลบด้วยเหตุอื่น → 404
- สิทธิ์การเห็น:
  - ACCOUNTANT ไม่ได้กลุ่ม chat
  - SALES ได้กลุ่ม chat เฉพาะห้องที่ยังไม่มีผู้ดูแลหรือตัวเองดูแล
  - SALES ไม่เห็นเครดิตจากแชทของห้องคนอื่น (room-credit-access.ts)
  - SALES เห็นยอดชำระ/ติดตามหนี้ (ตัดสิน 2026-09-15 OD-10 — SALES เห็นข้อมูลเดียวกันในแถบเตือน/การ์ดสัญญา/full-timeline อยู่แล้ว · ยังตัด callLog.notes / messageContent เหมือนทุกบทบาท)
- PDPA: ไม่มีข้อความแชท, messageContent, callLog.notes, phone, nationalId, address · มี snapshot test
- ภาพรวม: ?limit=6&include=summary&groups=chat,credit,sale

2) GET /customers/:id/journey/summary (roles เดียวกัน)
- 200 JourneySummary = { stage, stageLabel, stageEnteredAt, daysInStage, path, steps: [{ stage, label, at|null, state: 'done'|'current'|'skipped'|'todo', evidence: 'SYSTEM'|'MANUAL' }], firstChannel, firstSource, firstSourceLabel, firstAd: {id, name}|null, heardFrom, contactedAt, firstStaffReplyAt, firstPurchaseAt, lastCustomerAt, lastTouchAt, silentDays|null, lost: {at, reason}|null, postSaleBadges: string[], creditRejected: boolean }
- ลำดับการทำงาน: อ่านแคช → ตรวจสด BOUGHT exists → ถ้าไม่ตรง หรือ computedAt เก่ากว่า 15 นาทีและมี activity ใหม่กว่า computedAt → recompute([id]) ในคำขอนั้น
- ใช้กับแถบขั้นใน header และ KPI tiles

3) POST /customers/:id/journey/entries
- roles: OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES
- body แบบ discriminated:
  - { kind: 'TOUCHPOINT', channel, outcome, note?, occurredAt? (≥ now-7d, ≤ now), roomId? }
  - { kind: 'HEARD_FROM', heardFrom }
  - { kind: 'MARKED_LOST', lostReason, note? }
  - { kind: 'REOPENED' }
- 409 เมื่อ MARKED_LOST กับคนที่ซื้อแล้ว
- ถ้า :id เป็น placeholder ที่รวมแล้ว → เขียนไปที่ merged_into_id
- note ตรง /\d[\d\s-]{8,}\d/ → 400 'ห้ามใส่เบอร์โทรหรือเลขบัตรในบันทึก'
- 201 { event: JourneyEvent, summary: JourneySummary } (recompute รายคนแบบ sync ข้อมูลหลักสิบแถว)

4) DELETE /customers/:id/journey/entries/:entryId
- soft delete (deletedById) เฉพาะ origin=MANUAL
- ผู้บันทึกภายใน 24 ชม. หรือ OWNER/BRANCH_MANAGER

5) GET /customers/journey/funnel
- roles: OWNER, BRANCH_MANAGER
- query: from/to (cohort ตาม contactedAt) · by = firstSource|firstChannel|adCampaign|heardFrom|month · branchId? · onlyRepliedProspects? (ไม่นับ placeholder ที่ลูกค้าไม่เคยส่งข้อความ)
- 200 { rows: [{ key, label, contacted, identified, interested, credit, purchased, lost, silent, conversionPct, medianDaysToPurchase, revenue }], totals, unlinkedRooms (chat_rooms deleted_at null AND customer_id null), buyersWithoutChat, caveats: string[] }
- caveats เช่น 'ข้อมูลโฆษณามี 0 แถว', 'ลูกค้าซื้อ N คนไม่มีประวัติแชทผูก', 'ห้องไม่มีเจ้าของ X ห้อง — backfill ไม่ครบ'
- SQL เดียวบน customer_journey_states JOIN customers (หลักพันแถว)

6) ต่อยอดของเดิม
- GET /customers?view=prospects รับ journeyStage และ stuckDaysGte (JOIN customer_journey_states)
- GET /overdue/contracts/:id/full-timeline คงรูปเดิม แต่ข้างในเรียก contract-event-sources([contractId]) มี golden test ก่อนแยก
- PAYMENT paidDate เป็น PR แยก

7) งานเบื้องหลัง
- cron journey:recompute 03:30 BKK: recompute ทุกลูกค้าที่มี activity ใน 48 ชม. + sweep ทั้งหมดวันอาทิตย์ + ตรวจ count PURCHASED เทียบ BOUGHT_WHERE (ไม่ตรง → Sentry)
- cron journey:entry-guard 04:00: เทียบจำนวนสัญญาที่ activate / ใบขายเมื่อวานกับจำนวน entries CONTRACT_ACTIVATED ถ้าขาด → Sentry 'hook หลุด'
- CLI apps/api/src/cli/backfill-customer-journey.cli.ts + npm backfill:customer-journey
  - dry-run เป็นค่าตั้งต้น
  - EXPECTED_DB_NAME
  - CONFIRM_BACKFILL=YES_I_AM_SURE (+ ALLOW_PROD_BACKFILL)
  - รันผ่าน Cloud Run job แบบ seed-gfin
  - หยุดจริงถ้าห้องไม่มีเจ้าของเกิน 1% (exit 1)
  - exit 2 ถ้า PURCHASED ≠ BOUGHT_WHERE count
- grants.sql ของ MCP: grant ตารางใหม่ ยกเว้นคอลัมน์ note
- pdpa.service DSAR DELETION: ลบ entries ของคนนั้น

## การรอดเมื่อรวมผู้สนใจเข้าลูกค้าจริง

ทุกทางเข้ามารวมที่ CustomerMergeService.absorbPlaceholder (apps/api/src/modules/chat-prospects/customer-merge.service.ts): linkCustomer, POST /customers/:id/absorb-into/:targetId, session-ops mergeRooms (allowPlaceholderTarget), absorbRoomsOfLineUser (OTP/LIFF/พิมพ์เบอร์ LINE ร้าน) และ chat-room.service จึงแก้ที่เดียวก็ครอบทุกทาง

ในทรานแซกชันเดิม (บรรทัด 117-208 ที่ล็อกทั้งสองฝั่งแล้ว) วางถัดจาก adsAttribution.updateMany (:162) และก่อน soft-delete (:201):
(1) ย้ายบันทึก: tx.customerJourneyEntry.updateMany({ where: { customerId: placeholderId }, data: { customerId: targetId } }) · originCustomerId ไม่เปลี่ยน · ไม่ชน unique เพราะ dedupeKey ผูกกับเอกสาร ไม่ผูกลูกค้า
(2) ยุบ chain: tx.customer.updateMany({ where: { mergedIntoId: placeholderId }, data: { mergedIntoId: targetId } }) รองรับกรณี placeholder→placeholder (mergeRooms) แล้วต่อด้วย →คนจริง
(3) soft-delete เดิม: data: { deletedAt: now, mergedIntoId: targetId }
(4) แช่แข็งค่าเริ่มต้น:
  - อ่าน state ของ placeholder (ถ้ามี) และของ target
  - ถ้า placeholder.contactedAt < target.contactedAt ⇒ upsert state ของ target ด้วย contactedAt/firstChannel/firstSource/firstAdCampaignId/firstStaffReplyAt ของ placeholder
  - จากนั้น tx.customerJourneyState.deleteMany({ where: { customerId: placeholderId } })
  - ข้อนี้ไม่ขึ้นกับ R24 ซึ่งยก acquisitionSource ให้เฉพาะเมื่อ target ยังไม่มีค่า
(5) บันทึกการรวม: journeyEntryWriter.recordInTx(tx, { kind: 'PLACEHOLDER_MERGED', origin: 'SYSTEM', customerId: targetId, originCustomerId: placeholderId, dedupeKey: 'merge:' + placeholderId, actorType: actor.role === 'SYSTEM' ? 'SYSTEM' : 'STAFF', actorUserId: actor.role === 'SYSTEM' ? null : actor.id, data: { roomCount: roomIds.length } })
  - actorUserId เป็น null ได้ จึงไม่ติด FK และไม่ถูกข้ามแบบ audit R12
  - ถ้า absorb ล้ม (409 เอกสารพ่วง) ทุกอย่าง rollback พร้อมกัน
(6) หลัง commit ถัดจากการเขียน audit เดิม: journeyState.recompute([targetId]) ใน try/catch + Sentry · ถ้าล้ม summary endpoint และ cron คืนนั้นซ่อมเอง

สิ่งที่ตามไปเองโดยไม่ต้องคัดลอก:
- ห้อง (และข้อความ นัด room_credit_analyses ผ่าน roomId), creditChecks, tags, crmLeads, adsAttributions, chatAutoTriggers ถูกย้ายโดย updateMany เดิมแล้ว projection จึงตามไป
- ของที่ค้างอยู่กับ id ของ placeholder คือ audit_logs entity_id=placeholderId (เช่น AI_LEAD_CAPTURED) และแถว customers ที่ถูกลบ ตัวอ่านหาได้ด้วย ids = [target, ...customers where mergedIntoId = target] แล้ว query entity_id = ANY(ids)
- เอกสารที่บล็อกการรวม (สัญญา, ใบขาย, ใบจอง, KYC, PDPA) มีบน placeholder ไม่ได้ จึงไม่มีอะไรตกค้าง

ย้อนหลัง:
- migration เติม merged_into_id จาก audit CUSTOMER_PLACEHOLDER_MERGED (oldValue.placeholderId → entity_id)
- ก่อน deploy ให้นับ customers ที่ acquisition_source LIKE 'CHAT_%' AND deleted_at IS NOT NULL AND merged_into_id IS NULL เพื่อหาการรวมที่ audit ถูกข้าม · prod วันที่ 15 ก.ย. audit = 0 จึงคาดว่า 0
- ถ้าไม่เป็น 0 ห้องของ placeholder พวกนั้นอยู่ที่ target แล้ว event แชทจึงไม่หาย ขาดแค่ AI_LEAD_CAPTURED ของ placeholder ให้รายงานเป็นตัวเลข

ลิงก์เก่าที่ชี้ id ของ placeholder: endpoint ตอบ { redirectToCustomerId } และเว็บ navigate ไปหน้าลูกค้าจริง

db.spec (test_db เท่านั้น) ต่อยอด customer-merge.service.db.spec.ts:
- entries ย้าย
- chain A→B→คนจริงถูกยุบ
- AI_LEAD_CAPTURED ของ placeholder ขึ้นใต้ target
- contactedAt เลือกค่าเก่ากว่า
- actor SYSTEM ที่หา system user ไม่เจอยังมี PLACEHOLDER_MERGED
- BFS อิสระ (merged_into_id ∪ audit) ใช้เป็น oracle ว่าทุก event ของ placeholder ขึ้นใต้ target
- recompute ล้มแล้ว summary ยังคืน PURCHASED สด

## บันทึกด้วยมือ (เฟส 3)

หลักการ:
- ไม่มีช่องบังคับ บันทึกได้ใน 1-3 แตะ
- วางไว้ที่ที่พนักงานอยู่จริง คือหน้าร้าน/หน้าลูกค้า/ตอนขาย ไม่ใช่อินบ็อกซ์ เพราะทีมตอบใน Facebook app
- เฟส 1-2 ไม่ต้องกรอกอะไรเลย ส่วนบันทึกมือเริ่มเฟส 3
- ต้องมี mockup ให้เจ้าของเคาะก่อนแตะโค้ด (กติกา 2026-09-06)

(ก) คำใบ้ 'อาจเป็นคนเดียวกัน' ตอนขาย (เฟส 2, แตะเดียว)
- จุดที่แสดง: ขั้นเลือกลูกค้าของ POS/ContractCreatePage เมื่อลูกค้าไม่มีห้องแชทผูก
- ใช้ SameProsonService เดิม (ชื่อตรงหลัง normalize) → 'อาจเป็นผู้สนใจ Facebook ชื่อ … ทักมา 12 พ.ค. [ใช่ รวมประวัติแชท] [ไม่ใช่]'
- 'ใช่' เรียก POST /customers/:id/absorb-into/:targetId เดิม
- 'ไม่ใช่' ใช้ dismissedSamePerson เดิม
- ข้ามได้ ไม่บล็อกการขาย
- นี่คือกลไกเดียวที่ทำให้ยอดขายถูกนับเข้าช่องทางแชท (prod วันนี้ผู้ซื้อผูกห้อง 0/2)

(ข) ชิป 'รู้จักร้านจากไหน' (เฟส 3, แตะเดียว)
- แถวชิปเดียว 9 ตัวใน CustomerCreateDialog, POS CustomerSearch ตอนสร้างลูกค้าใหม่ และขั้นเลือกลูกค้าของ ContractCreatePage
- แสดงเฉพาะเมื่อ state.heardFrom ว่าง ข้ามได้
- ในแท็บการเดินทางแสดงเป็นแถบบนสุดจนกว่าจะตอบ
- บันทึกเป็น entry HEARD_FROM ครั้งแรก ตอบซ้ำ = แก้ค่า
- ห้ามแก้ acquisitionSource (R14/R24)

(ค) '+ บันทึกการติดต่อ' ในแท็บการเดินทาง (เฟส 3)
- เปิด bottom sheet บนมือถือ / popover บนเดสก์ท็อป
- แถว 1 ชิปช่องทาง: โทร · แชทในแอป FB · LINE · หน้าร้าน (จำค่าล่าสุดใน localStorage ห่อ try/catch)
- แถว 2 ชิปผล: นัดแล้ว · มาร้านแล้ว · ขอคิดก่อน · งบ/ดาวน์ไม่พอ · ไม่รับสาย · ซื้อที่อื่น · ไม่สนใจ
- แตะผล = บันทึกทันที (1 แตะถ้าช่องทางถูกอยู่แล้ว ไม่งั้น 2 แตะ) → toast 'บันทึกแล้ว · เลิกทำ' (soft delete ภายใน 24 ชม.)
- 'ซื้อที่อื่น' / 'ไม่สนใจ' ถามต่อแตะเดียว 'ติดป้ายหลุดไหม [ใช่]' (แตะที่ 3)
- 'เพิ่มโน้ต' พับไว้ (≤140 ตัว มีคำเตือนและ DTO ปฏิเสธเลขยาว) และ 'เปลี่ยนเวลา' (ย้อนได้ 7 วัน) เป็นทางเลือก

(ง) ปุ่ม 'ติดป้ายหลุด' / 'เปิดใหม่' บนแถบขั้น
- ไม่มีปุ่มเลื่อนขั้นด้วยมือ เพราะขั้นมาจากหลักฐานในระบบเท่านั้น

(จ) การ์ดผู้สนใจใน RoomDossier ของอินบ็อกซ์
- ใช้ชิปชุดเดียวกัน roomId แนบให้อัตโนมัติ
- เตรียมไว้วันที่ทีมย้ายมาใช้อินบ็อกซ์ (R21 ยังไม่ให้ทีมใช้) ไม่คาดหวังว่าจะมีคนใช้ตอนนี้

ไม่ทำ:
- ฟอร์มยาว
- บังคับโน้ต
- เลือกขั้นเอง
- รายการ follow-up แยก (ถ้าเจ้าของต้องการ ให้ใช้ todos เดิมที่มี roomId/dueDate)

ตัวชี้วัดการใช้งานหลังเปิด 2 สัปดาห์: นับ entries MANUAL ต่อพนักงาน ถ้า ≈0 ให้คงไว้แต่ไม่ขยาย

## คำตอบด้านการตลาด (เฟส 2)

คำถาม 'ที่มาไหนนำไปสู่การซื้อจริง' ตอบด้วย GET /customers/journey/funnel หน่วยนับเป็นคน แบ่ง cohort ตามวันที่ทักครั้งแรก (contactedAt) ตัวอย่าง: 'ทักเข้ามาเดือน ต.ค. ทาง Facebook 3,100 คน → ได้เบอร์ / ยืนยันตัวตน 140 → นัด/จอง 40 → ตรวจเครดิต 25 → ซื้อ 12 (0.4%) · ค่ามัธยฐาน 9 วัน · ยอด X บาท'

แยกได้ 4 มิติ:
- firstChannel (CHAT_FACEBOOK/LINE_SHOP/LINE_FINANCE/TIKTOK/WEB/WALK_IN/REFERRAL)
- firstSource (ลำดับความน่าเชื่อ: โฆษณาที่บันทึกได้ > ช่องทางแชทแรก > คนแนะนำ > ลูกค้าบอกเอง > หน้าร้าน)
- adCampaign
- heardFrom (ติดป้าย 'ลูกค้าบอกเอง')

สิ่งที่ตอบได้และตอบไม่ได้ ตามข้อมูล prod 2026-09-15:

1) ฝั่ง 'ทักมากี่คน ทางไหน' ตอบย้อนหลังได้ถึง 13 พ.ค. 69
- เงื่อนไข: #1592/#1593 ต้อง deploy แล้ว และรัน backfill:chat-prospects แล้ว
- วันนี้ยังไม่ได้ทำ (ห้องไม่มีเจ้าของ 8,991/8,992) funnel จะแสดง unlinkedRooms เป็นตัวเตือน

2) ฝั่ง 'ซื้อจริง' ย้อนหลังแทบตอบไม่ได้
- ผู้ซื้อเงินสด/ไฟแนนซ์นอก 2 คน ผูกห้องแชท 0 คน · สัญญา 8 ใบถูกสร้างที่ร้าน
- ถ้าไม่รวม ทุกคนจะนับเป็น 'หน้าร้าน' และแชทจะดูเหมือนปิดการขายได้ 0% ซึ่งทำให้ตัดสินใจการตลาดผิดทิศ
- ทางแก้ย้อนหลัง: ไล่กดรวมคนซื้อหลักสิบคนหนึ่งรอบด้วยคำใบ้ SamePerson ใช้เวลาไม่ถึงชั่วโมง (เจ้าของตัดสิน)
- ทางแก้ไปข้างหน้า: คำใบ้แตะเดียวตอนเปิดใบขาย/สัญญา
- funnel แสดง buyersWithoutChat ทุกครั้ง

3) ระดับโฆษณารายตัวตอบไม่ได้จนกว่าจะแก้ต้นทางที่ Meta
- ads_attributions = 0 เพราะ fb-app-review-smoke.sh ถอด messaging_referrals และไม่มีโฆษณาแบบทักแชท
- ระบบนี้ไม่ได้สร้างข้อมูลโฆษณาขึ้นมาเอง แค่พร้อมรับ
- ถ้าวันไหนข้อมูลเข้า มิติ adCampaign ใช้ได้ทันที เพราะการซื้อคำนวณจาก BOUGHT_WHERE ผ่านห้อง ไม่พึ่ง markConversion (เฟส 4 เรียก markConversion เพิ่มได้ หน้า /ads/roi เดิมจะมีตัวเลข)

4) ลูกค้าหน้าร้านรู้จักจากไหน
- มีเฉพาะที่ถามด้วยชิป heardFrom ตั้งแต่เฟส 3 เป็นต้นไป
- เป็นแหล่งข้อมูลการตลาดเดียวสำหรับคนไม่ทักแชท ระหว่างที่ข้อมูลโฆษณายังเป็น 0

5) ข้อจำกัดถาวร
- โพสต์/คอนเทนต์ที่ไม่ใช่โฆษณาทำให้ทักหรือไม่ ไม่รู้
- ใครในทีมปิดการขายจากแชท FB ไม่รู้ (echo ไม่มี staff_id)
- คนเดียวกันทักหลายช่องทางที่ยังไม่รวมจะนับซ้ำใน contacted
- ยอดขาย Tooltify 3,403 แถวไม่มี customerId จึงไม่อยู่ใน funnel
- ค่าตั้งต้นไม่นับ placeholder ที่ลูกค้าไม่เคยส่งข้อความ (onlyRepliedProspects) เพื่อไม่ให้ห้องว่างราว 9 พันห้องทำให้ conversion ดูเป็น 0.0x%

เวลาในแคชถูกแช่แข็งไว้ ตัวเลข cohort เก่าจึงไม่เปลี่ยนเองเมื่อ retention ลบข้อความเก่า 6 เดือน

## สิ่งที่ระบบยังไม่บันทึกวันนี้ + ทางแก้เล็กสุด

- #1592/#1593 merge แล้วแต่ prod ยังไม่มีผลใช้งาน (ห้องไม่มีเจ้าของ 8,991/8,992, customers ล่าสุด 2026-09-08, audit merge = 0) ⇒ 'ทักครั้งแรก' ยังไม่เป็นแถวลูกค้าจริง — ทางแก้เล็กสุด: deploy ด้วย `gcloud run services update --image` ตามสูตรในเครื่อง → รัน backfill:chat-prospects ผ่าน Cloud Run job (dry-run ก่อน) → ตรวจผ่าน MCP ว่า chat_rooms ที่ deleted_at IS NULL AND customer_id IS NULL ≈ 0
- เวลาเปิดใช้สัญญา (contracts ไม่มี activatedAt และ activate(id) ไม่รับ userId) — ทางแก้: เขียน entry CONTRACT_ACTIVATED หลัง commit ใน contracts.controller ที่มี user อยู่แล้ว ไม่ต้องแก้ลายเซ็น · ย้อนหลังใช้ sales.created_at ของใบ INSTALLMENT ที่สร้างใน tx เดียวกัน (approximate)
- รอบตีกลับสัญญา (reviewedAt/workflowStatus ถูกเขียนทับ เหลือแค่รอบล่าสุด) — ทางแก้: entry CONTRACT_REVIEWED ต่อรอบ หลัง commit ใน approve/reject ของ contract-workflow.service.ts
- เวลาและผลของ AI ประเมินเครดิต (credit_checks.status ถูกเขียนทับ ส่วน updatedAt ขยับทุกครั้งที่แก้แถว) — ทางแก้: entry CREDIT_AI_SCORED หลัง commit ใน credit-check-ai-analysis.service.ts · ย้อนหลังไม่แสดง ห้ามใช้ updatedAt
- ผู้เปิดตรวจเครดิต (createForCustomer ทิ้ง _userId) — ทางแก้: entry CREDIT_CHECK_OPENED_BY เขียนหลัง commit ใน controller ที่มี user อยู่แล้ว ไม่แก้ service
- บอทส่งต่อพนักงานและเหตุผล (chat_rooms.handoffReason ถูกเขียนทับ ปิดงานแล้วเคลียร์) — ทางแก้: entry BOT_HANDOFF ใน HandoffManagerService.initiateHandoff แบบ best-effort
- เวลาที่ได้เบอร์ของผู้สนใจ (body ใน audit ถูก REDACTED ส่วนการมีคีย์ใน PATCH เป็นบวกลวง) — ทางแก้: entry CONTACT_ADDED ใน CustomerWriteService.update/fill-contact เมื่อค่าเดิม null → ไม่ null (เทียบในโค้ด ไม่เก็บเบอร์) · ย้อนหลังใช้ customers.updated_at (approximate)
- เวลาผูก LINE ร้าน (lineIdShop ไม่มีเวลา) และการผูก LINE การเงินซ้ำรีเซ็ต linkedAt — ทางแก้: entry LINE_LINKED ใน selfLinkByPhone, LIFF confirm และ verification bind
- ลูกค้ากดมาจากสินค้าบนเว็บ (มีแค่ข้อความ SYSTEM ในห้อง) — ทางแก้: entry PRODUCT_LINK_CLICK พร้อม productId ใน handleProductReferral ของ facebook-webhook.controller.ts
- การรวม placeholder ที่ actor เป็น SYSTEM แล้วหา system user ไม่เจอ ทำให้ audit ถูกข้ามทั้งใบ (R12) — ทางแก้: merged_into_id + entry PLACEHOLDER_MERGED เขียนใน tx ของ absorbPlaceholder
- ใครในทีมตอบแชทใน Facebook app (echo staff_id ≈0) และข้อความทักทายอัตโนมัติ FB ถูกเก็บเป็น STAFF — แก้ด้วยโค้ดไม่ได้ · ทางที่เล็กสุดคือแสดงเป็น 'ร้าน (ไม่ทราบชื่อ)' ติดป้ายค่าประมาณ ข้ามข้อความทักทายตามกติกา shouldSkipFirstOutboundClear และไม่ใช้เป็นขั้นของ funnel · แก้จริงได้เมื่อทีมย้ายมาตอบในอินบ็อกซ์
- ที่มาจากโฆษณา (ads_attributions = 0 เพราะ messaging_referrals ถูกถอดใน fb-app-review-smoke.sh) — ทางแก้: subscribe webhook field messaging_referrals คืน + ใช้โฆษณาแบบทักแชท (เจ้าของตัดสิน) · ตอนซื้อเรียก markConversion ที่ยังไม่มีคนเรียก (ทางเลือก)
- ลูกค้าหน้าร้านรู้จักร้านจากไหน (CreateCustomerDto ไม่มีช่อง และห้ามแก้ acquisitionSource) — ทางแก้: ชิป heardFrom แตะเดียวใน CustomerCreateDialog / POS / สร้างสัญญา บันทึกเป็น entry HEARD_FROM
- ผู้ซื้อที่ไม่ได้ผูกกับประวัติแชท (prod 0/2 คน สัญญา 8 ใบสร้างที่ร้าน) ทำให้การซื้อไม่ถูกนับเข้าช่องทางแชท — ทางแก้: คำใบ้ SamePerson แตะเดียวในหน้า POS/สร้างสัญญา (ใช้ absorb-into เดิม) · การไล่รวมมือหนึ่งรอบสำหรับผู้ซื้อเก่า **เลื่อนไปหลังเปิดใช้งานจริง** (ตัดสิน 2026-09-15 OD-11: ผู้ซื้อใน ERP ตอนนี้เป็นข้อมูลทดสอบ · การรวมย้อนกลับไม่ได้ ไม่มี unmerge)
- สัญญาณการคุยของแชทเก่ากว่า 6 เดือน (retention soft-delete ข้อความตั้งแต่ราว 13 พ.ย. 2026) — ทางแก้: query นับข้อความและหาเวลาข้อความแรกให้รวมแถว deleted_at ไม่ null + แช่แข็ง contactedAt/firstStaffReplyAt ในแคช และรัน backfill แคชทันทีหลัง backfill:chat-prospects
- เวลาผ่อนครบ/ปิดยอดก่อนกำหนด (ไม่มีคอลัมน์เวลาปิดสัญญา) — ยอมรับเป็นค่าประมาณจาก MAX(payments.paid_date) ติดป้ายไว้ ไม่ต้องเพิ่ม hook ในเส้นทางเงิน
- เวลาและผู้ถอดแท็ก, LINE unfollow/block, การเข้าชมเว็บ (website_visits.customer_id ว่างเสมอ) — ไม่อยู่ในขอบเขตรอบนี้ แสดงในรายการ 'ระบบยังไม่เก็บ' ท้ายแท็บ

## เฟส

### เฟส 0 — ปูพื้น (ไม่มีหน้าจอให้ทีม) (3 วัน)

(1) deploy #1592/#1593 บน prod ด้วยสูตร Cloud Build + `run services update --image` แล้วรัน backfill:chat-prospects ผ่าน Cloud Run job (dry-run → จริง) · ตรวจผ่าน MCP ว่าห้องไม่มีเจ้าของ ≈0 และ customers CHAT_* ≈ 7-8k
(2) golden test ของ GET /overdue/contracts/:id/full-timeline
(3) mockup ให้เจ้าของเคาะ: แท็บการเดินทาง, แถบขั้น, ภาพรวม 6 รายการ, หน้า funnel, คำใบ้รวมตอนขาย, ชิปบันทึก (design canvas)
(4) ประสานกับโครงหน้ารายละเอียดลูกค้าใหม่ ไม่แตะ CustomerDetailPage.tsx 1,438 บรรทัดจนกว่าโครงแท็บจะลง

### เฟส 1 — การเดินทางอัตโนมัติ (ไม่มีงานกรอกมือเพิ่ม) (10 วัน)

API:
- migration merged_into_id (+เติมย้อนหลังจาก audit) และ customer_journey_entries / customer_journey_states
- แก้ absorbPlaceholder: ย้าย entries, ยุบ chain, entry PLACEHOLDER_MERGED ใน tx, recompute หลัง commit
- entry writer ระบบ 8 จุด เขียนหลัง commit: CONTRACT_ACTIVATED, CONTRACT_REVIEWED, CREDIT_AI_SCORED, CREDIT_CHECK_OPENED_BY, BOT_HANDOFF, CONTACT_ADDED, LINE_LINKED, PRODUCT_LINK_CLICK · ขึ้นก่อนเพื่อเริ่มเก็บประวัติเร็วที่สุด
- แยก contract-event-sources.ts
- CustomerJourneyService พร้อม source ต่อโดเมนและ zod whitelist
- journey-state.sql พร้อม CLI backfill (ด่านหยุดจริง / exit 2) และ cron recompute + entry-guard
- GET /customers/:id/journey และ /summary พร้อม redirect

เว็บ:
- EventTimeline กลาง + TimelineFilterChips รับ chips prop
- แท็บการเดินทาง (useInfiniteQuery), แถบขั้น, ภาพรวม 6 รายการ, ข้อความ 'ระบบยังไม่เก็บ'

งานปิดท้าย:
- grants.sql MCP (ไม่ grant note) และ DSAR
- bump version เว็บ

PR แยก: PAYMENT ใช้ paidDate

### เฟส 2 — คำตอบการตลาด (4 วัน)

- GET /customers/journey/funnel และหน้า OWNER/BM พร้อม caveats (unlinkedRooms, buyersWithoutChat, โฆษณา = 0)
- ตัวกรอง journeyStage / stuckDaysGte ในแท็บผู้สนใจ /customers
- คำใบ้ SamePerson แตะเดียวในหน้า POS และสร้างสัญญา
- ~~รายการ one-off 'ผู้ซื้อที่ยังไม่ผูกแชท' ให้เจ้าของไล่กดรวม~~ — **เลื่อนไปหลังเปิดใช้งานจริง ไม่อยู่ในเฟส 2** (ตัดสิน 2026-09-15 OD-11)
  - ผู้ซื้อใน ERP ตอนนี้เป็นข้อมูลทดสอบทั้งหมด · รวมผู้ซื้อทดสอบเข้ากับห้องแชทของคนจริงจะปนข้อมูล และการรวมย้อนกลับไม่ได้
  - ทบทวนเมื่อเปิดใช้จริงและ backfill ผู้สนใจแล้ว funnel ยังเห็นผู้ซื้อจริงที่ไม่ผูกแชทจำนวนมาก — ใช้คำใบ้ SamePerson ตอนขายแทนการไล่ย้อน

### เฟส 3 — บันทึกมือ 1-3 แตะ (4 วัน)

- POST/DELETE journey/entries
- sheet บันทึกการติดต่อ (ชิปช่องทาง + ชิปผล + เลิกทำ)
- ชิป 'รู้จักร้านจากไหน' ใน CustomerCreateDialog / POS / สร้างสัญญา
- ป้ายหลุด/เปิดใหม่ และชิปชุดเดียวกันใน RoomDossier
- วัดการใช้งานหลัง 2 สัปดาห์

### เฟส 4 — ข้อมูลโฆษณา (ทำเมื่อเจ้าของเคาะ) (2 วัน)

- subscribe messaging_referrals คืนและทดสอบ smoke
- เรียก markConversion ตอนซื้อ (ใบขายเงินสด/ไฟแนนซ์นอก และ activate สัญญา หลัง commit) ให้ /ads/roi มีตัวเลข
- มิติ adCampaign ใน funnel เริ่มมีข้อมูลตั้งแต่วันที่เปิด

## คำถามที่เจ้าของต้องตัดสิน

> ตัดสินแล้ว 2026-09-15 (เจ้าของให้ controller เลือกทางที่ดีที่สุด — OD-9 ถึง OD-13) · คงคำถามเดิมไว้เป็นประวัติ

- ลูกค้าที่ซื้อไปแล้วส่วนใหญ่ไม่ได้ผูกกับประวัติแชท ถ้าไม่ไล่กดรวมย้อนหลังหนึ่งรอบ (หลักสิบคน ใช้เวลาไม่ถึงชั่วโมง) รายงานจะบอกว่าแชทปิดการขายได้ 0% — จะให้ใครไล่กดรวม หรือยอมให้ตัวเลขเริ่มนับตั้งแต่วันเปิดใช้งาน?
  - **ตัดสิน (OD-11):** ไม่ไล่รวมย้อนหลัง ตัวเลขนับตั้งแต่วันเปิดใช้ · รายการ one-off เลื่อนไปหลังเปิดใช้งานจริง
- ตอนเปิดใบขาย/สัญญา ถ้าระบบเจอผู้สนใจจากแชทที่ชื่อตรงกัน ให้ขึ้นถาม 'ใช่คนเดียวกันไหม [รวม]' ทุกครั้งได้ไหม (เพิ่ม 1 แตะ ข้ามได้) — และถาม 'รู้จักร้านจากไหน' แตะเดียวตอนสร้างลูกค้าหน้าร้านได้ไหม?
  - **ตัดสิน (OD-12):** ไม่ทำรอบนี้ · ทำเฟส 3 หลัง backfill ผู้สนใจ + เจ้าของเคาะ mockup (คำใบ้ไม่บังคับ ไม่รวมเอง · ชิปข้ามได้) · ข้อมูลรู้จักร้านจากไหนของการขายก่อนเฟส 3 เก็บย้อนไม่ได้
- ขั้นที่ 2 ของเส้นทางจะเป็น 'รู้ตัวตน' (ได้เบอร์/ผูก LINE แล้ว) แทน 'คุยแล้ว' เพราะข้อความทักทายอัตโนมัติของ Facebook ทำให้เกือบทุกห้องดูเหมือนร้านตอบแล้ว — โอเคไหม?
  - **ตัดสิน (OD-9):** คงกติกาเดิม เปลี่ยนป้ายเป็น 'ได้เบอร์ / ยืนยันตัวตน' · prod: ข้อความพนักงานมี outbound_sent_at 1 ใน 74,514 ⇒ ขั้น 'คุยแล้ว' ใช้ไม่ได้ และ first_staff_reply_at แทบว่างเสมอ
- จะให้กลับไปเปิดรับข้อมูลโฆษณาจาก Facebook (ต้องตั้งค่า messaging_referrals ที่ Meta และใช้โฆษณาแบบกดแล้วทักแชท) เพื่อให้รู้ว่าโฆษณาตัวไหนขายได้ไหม — ถ้าไม่ทำ รายงานจะบอกได้แค่ช่องทาง ไม่รู้รายโฆษณา
  - **ตัดสิน (OD-13):** ไม่แก้โค้ดรอบนี้ · งานเจ้าของ: เช็ค Ads Manager ว่ามีโฆษณาคลิกไป Messenger ไหม + กด subscribe webhooks ด้วยชุดฟิลด์ตั้งต้น · markConversion = เฟส 4
- พนักงานขาย (SALES) ควรเห็นยอดชำระค่างวดและประวัติติดตามหนี้ในแท็บการเดินทางของลูกค้าไหม หรือให้เห็นเฉพาะผู้จัดการ/การเงิน?
  - **ตัดสิน (OD-10):** SALES เห็น (เห็นข้อมูลเดียวกันในแถบเตือน/การ์ดสัญญา/full-timeline อยู่แล้ว) · ยังตัดโน้ตโทร/ข้อความทวงเหมือนทุกบทบาท
