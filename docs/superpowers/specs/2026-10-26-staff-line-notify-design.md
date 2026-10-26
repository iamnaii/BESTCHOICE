# LINE แจ้งเตือนภายในถึงพนักงาน (A16) — ออกแบบ

วันที่ 2026-10-26 · ก้อน 7 ของรายการช่องว่าง Tooltify · สถานะ: **ทำแล้ว (2026-10-26 · Task 1–13 ครบ · รอรีวิว/PR)** — เจ้าของให้เริ่มโดยไม่ถาม ("ได้ครับ") คำตัดสินทั้งหมดเป็นของผู้เขียน ดู §11 + §13.6 ให้เจ้าของทบทวนตอน PR · สาขา `feat/staff-line-notify` (ต่อยอดจาก `feat/recurring-bill-reminders` PR #1733 เพราะต้องเสียบท่อบิลประจำ)

## 1. ทำไมต้องมี

ทุกวันนี้พนักงานรู้เรื่องสำคัญช้าเพราะต้องเปิดระบบดูเอง: ลูกค้าขอคุยกับคนในแชท, สลิปยอดไม่ตรง, ของใกล้หมด, ใบรายจ่ายรออนุมัติ, สาขาไม่ปิดยอดเงินสด, บิลประจำครบกำหนด. Tooltify ส่ง LINE ให้เจ้าของ/พนักงานทันทีเมื่อเกิดเหตุการณ์ (ช่องว่าง A16) — ระบบเรามี "ไลน์พนักงาน (Staff OA)" อยู่แล้วแต่ใช้แบบต่างคนต่างต่อ ไม่มีสวิตช์กลาง.

## 2. ของที่มีอยู่แล้ว (ตรวจโค้ด 2026-10-26)

- **Staff OA** = integration key `line-staff` (Integration Hub: `channelToken`, `channelSecret`, `notifyTargets` = รายชื่อ LINE userId คั่น comma "กลุ่มที่ต้องการแจ้งเตือน"). ไม่มี webhook ของช่องนี้ → ระบบไม่รู้ userId ของพนักงานเอง.
- **`User.lineId`** แก้ได้ที่หน้าผู้ใช้ (`UsersPage/UserDetailPage` › ข้อมูลส่วนตัว › "LINE ID") — ใช้ส่งรายงานรายวันถึง OWNER อยู่แล้ว.
- **ท่อส่ง**: `NotificationsService.send({ channel: 'LINE', channelKey: 'line-staff', recipient: <lineUserId>, message, relatedId, category: STAFF })` → บันทึก `NotificationLog` ให้เอง · หมวด `STAFF` ข้ามกติกาเวลาส่ง/ความถี่ของลูกค้า (`compliance.service.ts`) · แม่แบบ `NotificationTemplate` (`staff.*` 6 ใบ แก้ได้ที่หน้า แจ้งเตือน › แม่แบบ).
- **จุดที่ยิง LINE พนักงานอยู่ตอนนี้ (ต่างคนต่างทำ)**:
  1. รายงานรายวันถึง OWNER (`owner-report-notifier.service.ts` → `User.lineId` ของ OWNER)
  2. สรุปติดตามหนี้รายวัน (`collections-summary.service.ts` → `User.lineId` ของ OWNER)
  3. จุดสั่งซื้อซ้ำ/ของใกล้หมด (`reorder-points.service.ts` → ส่ง `channel: 'LINE'` ด้วย **อีเมล** ของ OWNER = ไปไม่ถึงใคร — บั๊กแฝง)
  4. SMS credit ใกล้หมด (`scheduler.service.ts` → `notifyTargets`)
  5. ลูกค้าขอคุยกับคน / สลิปยอดไม่ตรง / สลิปค้างเกิน SLA (`chatbot-finance/staff-notification.service.ts` → broadcast `notifyTargets`)
  6. เตือนล็อกอินจากอุปกรณ์ใหม่ (`login-audit.service.ts` → `lineId` ของเจ้าตัว) — **เรื่องส่วนตัว ไม่ย้าย**
  7. บิลประจำ (ก้อน 6) `RecurringBillNotifier` = เขียน log รอเสียบท่อ
- ใบรายจ่ายรออนุมัติแจ้งผู้อนุมัติทาง **IN_APP เท่านั้น** (`notifyApprovers`) ซึ่ง IN_APP ไม่มีกระดิ่งในเว็บ (มีแต่หน้า log) = แทบไม่มีใครเห็น.
- การ์ดแดชบอร์ด (`dashboard-ops.service.ts`) ตรวจ "สาขาไม่ปิดยอดเงินสดเมื่อวาน" และ "เงินสดนับแล้วรอยืนยันเกิน 1 วัน" ตอนเปิดหน้าเท่านั้น ไม่มี cron.
- 🔴 prod: บันทึก 2026-08-23 ว่า `line-staff channelToken not configured` — ต้องใส่ token ก่อน ไม่งั้นทุกเหตุการณ์ถูกข้าม (ระบบบันทึก log "ยังไม่ตั้งค่า" ไม่พัง).

## 3. เป้าหมาย / ไม่ทำ

**เป้าหมาย**
1. จุดเดียวสำหรับ "แจ้งพนักงานทาง LINE": `StaffNotifyService.notify(event, payload)` — เลือกผู้รับตาม **บทบาท + สาขา** จาก `User.lineId` (บวก "กลุ่ม LINE" เดิมได้) · ตัดซ้ำ · บันทึก log · ไม่ล้มงานหลัก.
2. สวิตช์กลางให้ OWNER: หน้า แจ้งเตือน › แท็บ "แจ้งพนักงาน (LINE)" = ตารางเหตุการณ์ × บทบาท + เปิด/ปิด + เฉพาะสาขาตนเอง + ปุ่มส่งทดสอบ + รายชื่อพนักงานที่ยังไม่ผูก LINE.
3. เหตุการณ์ชุดแรก 14 รายการ (§5) ครอบจุดที่ระบบตรวจจับได้อยู่แล้ว + 2 จุดใหม่ที่เจ้าของน่าจะอยากรู้ทันที (ขายสด/เปิดสัญญา) + 2 cron ใหม่จากกติกาการ์ดแดชบอร์ด (ไม่ปิดยอดเงินสด / รอยืนยันรับเงิน).
4. ย้ายจุดยิงเดิมทั้ง 5 มาบนท่อเดียว (ข้อความคงเดิม) และซ่อมบั๊ก reorder-points.

**ไม่ทำ (wave 2)**
- Flex message / ปุ่มกดในข้อความ (ตอนนี้ text ล้วน)
- ผูก LINE อัตโนมัติผ่าน webhook ของ Staff OA หรือ LIFF (ยังกรอก `lineId` ด้วยมือที่หน้าผู้ใช้ + ปุ่ม "ส่งข้อความทดสอบ" ให้ตรวจว่าถูกคน)
- ตั้งค่าส่วนตัวรายคน (ขอไม่รับบางเรื่อง) — ตอนนี้ OWNER คุมระดับบทบาท
- ช่วงเวลาเงียบ (quiet hours) — เหตุการณ์เรียลไทม์เป็นเรื่องด่วนโดยธรรมชาติ cron ยิงช่วงเช้าอยู่แล้ว
- การ์ดแดชบอร์ดอื่น (สัญญาค้างชำระ/ยอดรับไม่ตรง) — มี flow ติดตามหนี้ของมันเองอยู่แล้ว

## 4. สถาปัตยกรรม

### 4.1 โมดูลใหม่ `apps/api/src/modules/staff-notify/`
- `staff-event-catalog.ts` — แคตตาล็อกเหตุการณ์ (§5): `key`, `group`, `label`, `description`, ค่าเริ่มต้น `{ enabled, roles, branchScoped, includeGroup }`, `sample` (payload ตัวอย่างสำหรับส่งทดสอบ), `dedupeWindowHours`.
- `staff-notify-rules.service.ts` — อ่าน/เขียนกติกาใน `SystemConfig` key **`staff_notify_rules`** (JSON `{ [eventKey]: { enabled, roles, branchScoped, includeGroup } }`) รวมกับค่าเริ่มต้นจากแคตตาล็อก (คีย์ที่ไม่มีในกติกา = ค่าเริ่มต้น) · validate ตอนเขียน (บทบาทต้องอยู่ใน `UserRole` ยกเว้น VIEWER).
- `staff-notify.service.ts` — `notify(event: StaffEventKey, p: StaffEventPayload): Promise<StaffNotifyResult>`:
  ```ts
  interface StaffEventPayload {
    title: string;           // บรรทัดแรก (ไม่ต้องใส่ชื่อระบบ — service เติม "📣 BESTCHOICE" ให้)
    lines: string[];         // รายละเอียดบรรทัดละข้อ
    link?: string;           // path ในเว็บ เช่น /expenses/recurring-bills?month=2026-10 → service ต่อ base URL ให้
    branchId?: string | null;// ใช้กรองผู้รับเมื่อกติกา branchScoped
    dedupeKey?: string;      // ซ้ำใน dedupeWindowHours = ไม่ส่งซ้ำ (เช่น occurrenceId+kind, documentId)
    extraRecipientUserIds?: string[]; // ผู้รับเฉพาะเจาะจง (เช่น ผู้อนุมัติที่คำนวณไว้แล้ว) — ยังถูกกรอง lineId/active
  }
  interface StaffNotifyResult { skipped?: 'disabled' | 'not_configured' | 'no_recipients'; sent: number; deduped: number; failed: number }
  ```
  ลำดับ: กติกาของ event (`enabled` เท็จ → `skipped: 'disabled'`) → Staff OA ตั้งค่าแล้วไหม (`LineStaffClientService.isConfigured()`; ไม่ → log เตือนวันละครั้ง + `not_configured`) → **ผู้รับ** = users `{ isActive: true, deletedAt: null, isSystemUser: false, lineId: not null, role in roles }` ∪ `extraRecipientUserIds` (กรองเงื่อนไขเดียวกัน) ∪ (ถ้า `includeGroup`) `notifyTargets` ของ Integration Hub · ถ้า `branchScoped` และมี `payload.branchId`: BRANCH_MANAGER/SALES รับเฉพาะ `user.branchId === payload.branchId`; OWNER/FINANCE_MANAGER/ACCOUNTANT รับทุกสาขา · ตัดซ้ำ userId/lineId → **dedupe**: ถ้ามี `dedupeKey` ตรวจ `NotificationLog` `{ channelKey: 'line-staff', recipient, relatedId: 'staff:<event>:<dedupeKey>', status: 'SENT', createdAt ≥ now − window }` มี = ข้าม → ส่งผ่าน `NotificationsService.send({ channel: 'LINE', channelKey: 'line-staff', recipient: lineId, message, relatedId, category: STAFF })` ทีละคน (ล้มคนหนึ่งไม่หยุดคนอื่น) → `Sentry.captureException` เมื่อล้ม ไม่ throw ออกไปหาผู้เรียกเด็ดขาด.
  ข้อความ: `📣 BESTCHOICE · <title>\n<lines…>\n🔗 <baseUrl><link>` · base URL = `FRONTEND_URL` (ไม่ใช่ `PAYMENT_LINK_BASE_URL` ซึ่งเป็นโดเมนลิงก์ชำระของลูกค้า — แก้จุดที่ก้อน 6 เลือกผิด).
- `staff-notify.controller.ts` (`/staff-notify`, OWNER): `GET rules` (แคตตาล็อก + กติกาที่มีผล + สถานะ Staff OA + พนักงานที่กติกาใดชี้ถึงแต่ `lineId` ว่าง) · `PUT rules` (ทั้งก้อน · audit `STAFF_NOTIFY_RULES_UPDATED`) · `POST test` `{ eventKey }` → ส่ง `sample` ของเหตุการณ์ถึง **ผู้เรียก** (ต้องมี `lineId` ไม่งั้น 400 "ยังไม่ได้ผูก LINE ของคุณ") · `POST users/:id/test` (OWNER) → push "ทดสอบการเชื่อมต่อ LINE พนักงาน — ถ้าได้รับข้อความนี้แปลว่าผูกถูกคน" ถึง `lineId` ของผู้ใช้นั้น.
- โมดูล export `StaffNotifyService` · import `NotificationsModule`, `ChatbotFinanceModule`?? — ไม่: `LineStaffClientService` อยู่ใน chatbot-finance; ย้าย **`isConfigured()`/`getRecipients()`** ออกมาเป็น `StaffLineConfigService` ในโมดูลใหม่ (อ่าน IntegrationConfig เอง) ให้ chatbot-finance ใช้ต่อได้ ไม่สร้างวงกลม import.

### 4.2 การเรียกจากจุดเกิดเหตุ
- เรียก **หลัง commit** เสมอ (นอก `$transaction`) และห่อ try/catch ของ service เอง — การแจ้งเตือนล้มต้องไม่ย้อนธุรกรรม.
- `StaffNotifyService` ถูก inject แบบ `@Optional()` ในโมดูลเดิม ๆ เพื่อให้ unit test เดิมที่ประกอบ service เองไม่ต้องเพิ่ม dep (รูปแบบเดียวกับ `notifications?` ใน lifecycle service).

## 5. แคตตาล็อกเหตุการณ์ ชุดแรก

| key | ทริกเกอร์ (ที่มีอยู่/ใหม่) | ผู้รับเริ่มต้น | เฉพาะสาขา | dedupe |
|---|---|---|---|---|
| `recurring_bill.upcoming` / `.due_today` / `.overdue` / `.missed` | `RecurringBillNotifier` (ก้อน 6) — เสียบ `StaffNotifyRecurringBillNotifier` แทน logger | OWNER, ACCOUNTANT | ไม่ (แต่ส่ง `branchId` ไว้) | `occurrenceId:kind:วันที่` (วันละครั้งต่อชนิด — ขั้น B ส่งวันละครั้งอยู่แล้ว) |
| `expense.pending_approval` | `notifyApprovers` ใน lifecycle (ส่ง IN_APP อยู่แล้ว) → เพิ่ม LINE ผ่าน `extraRecipientUserIds` = ผู้อนุมัติที่คำนวณได้ | (ตามผู้อนุมัติ) + OWNER | BM เฉพาะสาขาใบ (กติกาเดิม) | `documentId:PENDING_APPROVAL` |
| `chat.handoff` | `StaffNotificationService.notifyHandoff` | กลุ่ม LINE เดิม + OWNER, FINANCE_MANAGER | ไม่ | `roomId` 1 ชม. |
| `chat.slip_review` | `notifySlipReview` | กลุ่มเดิม + ACCOUNTANT, FINANCE_MANAGER, OWNER | ไม่ | `slipId` |
| `chat.slip_sla` | `notifySlipSlaBreached` | เหมือน slip_review | ไม่ | `slipId:sla` |
| `stock.low` | `reorder-points.service.ts` (แทนการยิง LINE ด้วยอีเมล) | OWNER, BRANCH_MANAGER | ใช่ (`rp.branchId`) | `reorderPointId` 24 ชม. |
| `sms.credit_low` | `scheduler.handleSmsCreditAlert` | OWNER | ไม่ | `วันที่` |
| `petty_cash.replenish` | `petty-cash-replenish-alert.cron.ts` | OWNER, ACCOUNTANT | ไม่ | `วันที่` |
| `ap.due` | `ap-due-alerts.cron.ts` (สวิตช์ `ap_due_alerts_enabled` ยังปิดตามเดิม) | ACCOUNTANT, OWNER | ไม่ | `documentId:วันที่` |
| `report.owner_daily` | `owner-report-notifier` (ข้อความเดิมจากแม่แบบ `staff.daily_line_report`) | OWNER | ไม่ | `วันที่` |
| `collections.daily_summary` | `collections-summary.service.ts` | OWNER, FINANCE_MANAGER | ไม่ | `วันที่` |
| `sale.completed` **ใหม่** | หลัง `SaleCreationService.create` สำเร็จ (ขายสด/ไฟแนนซ์นอก) | OWNER (BM ปิดไว้ก่อน) | ใช่ | `saleId` |
| `contract.activated` **ใหม่** | หลัง `ContractWorkflowService.activate` สำเร็จ | OWNER (FM ปิดไว้ก่อน) | ใช่ | `contractId` |
| `cash_close.missed` **ใหม่ cron 10:00** | กติกาเดียวกับการ์ด `cash_close_missed` (สาขาที่มียอดขายเมื่อวานแต่ไม่มีใบปิดยอด) — ย้ายคำนวณไป `ShopCashAlertsService` ให้ dashboard กับ cron ใช้ร่วม | OWNER, BRANCH_MANAGER | ใช่ (ต่อสาขา 1 ข้อความ) | `branchId:วันที่` |
| `cash_close.awaiting` **ใหม่ cron 10:00** | กติกาเดียวกับการ์ด `cash_close_awaiting` (นับแล้วรอยืนยันเกิน 1 วัน) | OWNER, ACCOUNTANT | ไม่ | `วันที่` |

ข้อความทุกเหตุการณ์: หัวข้อสั้น + ข้อเท็จจริง 2–4 บรรทัด (ชื่อ/สาขา/ยอด/วันที่) + ลิงก์หน้าที่ต้องไปทำ. ไม่ใส่เลขบัตรประชาชน/เลขบัญชีลูกค้า; เบอร์โทรลูกค้าแสดงแบบเดิมที่ handoff เคยแสดง (ทีมใช้โทรกลับ).

## 6. ย้ายจุดยิงเดิม

| จุด | เปลี่ยนอะไร | ข้อความ |
|---|---|---|
| chatbot-finance `StaffNotificationService` | แทน `lineStaff.broadcastText(text)` ด้วย `staffNotify.notify('chat.*', { title, lines, link, dedupeKey })` · `isConfigured()` ย้ายไป `StaffLineConfigService` | คงเดิม (แยก title/lines จากข้อความเดิม) |
| `scheduler.handleSmsCreditAlert` | แทน loop `sendFromTemplate('staff.sms_credit_low', …, target)` ด้วย notify 1 ครั้ง (ข้อความจากแม่แบบเดิมผ่าน `templateService.render`) | คงเดิม |
| `reorder-points.service.ts` | ลบ loop LINE ที่ใช้อีเมล · IN_APP คงไว้ · เพิ่ม notify `stock.low` | ข้อความเดิม |
| `owner-report-notifier` | แทน loop push ด้วย notify `report.owner_daily` (`extraRecipientUserIds` ไม่ต้อง — บทบาท OWNER) | คงเดิม |
| `collections-summary` | เหมือนกัน | คงเดิม |
| `notifyApprovers` | คง IN_APP · เพิ่ม notify `expense.pending_approval` ด้วย `extraRecipientUserIds` = ผู้อนุมัติที่กรองแล้ว | ใหม่: "ใบรายจ่าย EX-… รออนุมัติ · ผู้ขาย · ยอด · สาขา · โดย" |
| `RecurringBillNotifier` | provider ใหม่ `StaffNotifyRecurringBillNotifier` แทน `LoggingRecurringBillNotifier` (คง `resolveRecipients` ไว้ในกติกา: roles OWNER+ACCOUNTANT) | `buildRecurringBillMessage` เดิม (title = บรรทัดแรก, lines = ที่เหลือ) |

## 7. หน้าตั้งค่า (เว็บ) — mockup ก่อนโค้ด

หน้า แจ้งเตือน (`NotificationsPage`) เพิ่มแท็บ **"แจ้งพนักงาน (LINE)"** (OWNER):
1. แถบสถานะบนสุด: Staff OA ตั้งค่าแล้ว/ยัง (ลิงก์ไป Integration Hub) · "พนักงานที่ยังไม่ผูก LINE: N คน" กางดูรายชื่อ (ชื่อ · บทบาท · สาขา · ปุ่มไปหน้าผู้ใช้).
2. ตารางเหตุการณ์ จัดกลุ่ม (บิลประจำ / รายจ่าย / แชท / สต๊อก / เงินสดหน้าร้าน / รายงาน / ขาย): แถวละเหตุการณ์ = สวิตช์เปิด · ช่องติ๊กบทบาท 5 ช่อง (OWNER · ผจก.การเงิน · บัญชี · ผจก.สาขา · พนักงานขาย) · ติ๊ก "กลุ่ม LINE จาก Integration" · ติ๊ก "เฉพาะสาขาที่เกี่ยว" (มีผลกับ ผจก.สาขา/พนักงานขาย) · ปุ่ม "ส่งทดสอบถึงฉัน".
3. ปุ่ม "บันทึก" ท้ายตาราง (บันทึกทั้งก้อน) + แถบ "ยังไม่ได้บันทึก" เมื่อแก้.
4. หน้าผู้ใช้ (`UserDetailPage`) ข้าง "LINE ID": ปุ่ม "ส่งข้อความทดสอบ" (OWNER).

กติกา UI: label มองเห็นทุกช่อง · ช่องติ๊กขนาด ≥ 44px บนมือถือ · ผลสถานะไม่ใช้สีอย่างเดียว (ไอคอน+คำ) · ตารางอยู่ใน `overflow-x-auto`.

## 8. API

- `GET /staff-notify/rules` → `{ configured: boolean; groupTargets: number; catalog: StaffEventCatalogItem[]; rules: Record<key, EffectiveRule>; unlinkedUsers: { id; name; role; branchName }[] }`
- `PUT /staff-notify/rules` body `{ rules: Record<key, { enabled; roles; branchScoped; includeGroup }> }` → validate key ในแคตตาล็อก, roles ⊆ UserRole∖VIEWER → เขียน SystemConfig + AuditLog
- `POST /staff-notify/test` `{ eventKey }` → ส่ง sample ถึงผู้เรียก (409 ถ้า Staff OA ยังไม่ตั้งค่า · 400 ถ้าผู้เรียกไม่มี lineId)
- `POST /staff-notify/users/:id/test` → ทดสอบการเชื่อมต่อถึงผู้ใช้นั้น
- ทั้งหมด `@Roles('OWNER')`

## 9. กติกาที่ระบบรับประกัน
- แจ้งเตือนล้ม/ยังไม่ตั้งค่า **ไม่เคยทำงานหลักล้ม** (sale/contract/approval/cron)
- ข้อความเดียวกันถึงคนเดียวกันไม่ซ้ำภายใน window (dedupe ผ่าน NotificationLog ไม่ต้องมีตารางใหม่)
- ทุกการส่งมี `NotificationLog` (ดูได้ที่หน้า แจ้งเตือน › log กรอง `line-staff`)
- ผู้รับ = ผู้ใช้ที่ active ไม่ถูกลบ ไม่ใช่ผู้ใช้ระบบ และมี `lineId` เท่านั้น · ผู้ใช้ที่ถูกปิดใช้ภายหลัง = หยุดได้รับทันที (ไม่มี cache)
- กติกาใน SystemConfig ถูก validate — ค่าเสียหายใน DB → ใช้ค่าเริ่มต้นและ Sentry

## 10. เทส
- unit `staff-notify.service.spec.ts`: ผู้รับตามบทบาท/สาขา/extra/กลุ่ม · ปิด event · ไม่ตั้งค่า · dedupe · ล้มรายคนไม่หยุดคนอื่น · ไม่ throw
- unit rules service: merge ค่าเริ่มต้น · validate · ค่าเสียหายใน DB
- unit controller: OWNER เท่านั้น · test ไม่มี lineId → 400
- call-site specs: แต่ละจุดเรียก `notify` ด้วย event/payload ถูก (ขยาย spec เดิมของ reorder/sms/handoff/approvers/recurring-bills/collections/owner-report · spec ใหม่ sale/contract/cash-close cron)
- integration (Postgres จริง ใช้ `tools/test-db-vitest.sh`): dedupe กับ NotificationLog จริง + ผู้รับจาก users จริง
- web: แท็บตั้งค่า (render/ติ๊ก/บันทึก/ส่งทดสอบ/รายชื่อยังไม่ผูก) + ปุ่มทดสอบหน้าผู้ใช้ + route reachability

## 11. คำตัดสินของผู้เขียน (ขอให้เจ้าของทบทวน)
1. ผู้รับคุมที่ระดับ **บทบาท** ไม่ใช่รายคน (รายคนทำได้ wave 2 ถ้าจำเป็น) · "กลุ่ม LINE" เดิมยังใช้ได้ผ่านติ๊ก "กลุ่ม LINE จาก Integration".
2. เหตุการณ์ใหม่ `sale.completed` / `contract.activated` เปิดให้ OWNER ตั้งแต่แรก (เจ้าของมักอยากรู้ยอดขายทันที) — ถ้าดังเกินไปปิดได้ที่สวิตช์.
3. cron `cash_close.*` ยิง 10:00 วันละครั้ง (ไม่ใช่ทันทีหลังปิดร้าน) และข้อความละสาขา.
4. ไม่มีช่วงเวลาเงียบ.
5. ไม่ย้ายเตือนล็อกอินอุปกรณ์ใหม่ (เป็นข้อความส่วนตัวของผู้ใช้นั้น).
6. ลิงก์ในข้อความใช้ `FRONTEND_URL` (โดเมนแอปพนักงาน).
7. ต่อยอดจากสาขา #1733 (stack) เพราะต้องเสียบท่อบิลประจำ — PR ชี้ base ไป `feat/recurring-bill-reminders` แล้วเปลี่ยนเป็น `main` เมื่อ #1733 merge (วิธีเดียวกับ #1724).

## 12. ก่อน deploy
- ใส่ `channelToken`/`channelSecret` ของ Staff OA ใน Integration Hub บน prod (บันทึก 23/08 ยังว่าง) แล้วกด "ทดสอบการเชื่อมต่อ"
- กรอก `lineId` ของ OWNER/บัญชี/ผจก.สาขา ที่หน้าผู้ใช้ แล้วกด "ส่งข้อความทดสอบ" ทีละคน
- เปิดสวิตช์เหตุการณ์ที่ต้องการในแท็บใหม่ (ค่าเริ่มต้นเปิดตาม §5)

## 13. ผลตรวจของผู้สร้าง (builder check 2026-10-26) — แก้สเปกตามนี้ (ทับข้อที่ขัดกันข้างบน)

**13.1 ผูก LINE ของพนักงานด้วยรหัส 6 หลักผ่าน webhook ของ Staff OA (แทนกรอกมือ)** — ช่อง "LINE ID" เดิม (`User.lineId`) เป็นข้อความอิสระที่คนกรอกไอดีค้นหาเพื่อน ใช้ push ไม่ได้ และไม่มี webhook ให้ระบบรู้ userId (`LineStaffWebhookGuard` มีแต่ไม่มี controller เรียก) ⇒
- คอลัมน์ใหม่ `User.lineStaffUserId String? @unique @map("line_staff_user_id")` (userId ของ Messaging API ที่ Staff OA เห็น) + `lineLinkCode String? @map("line_link_code")` + `lineLinkCodeExpiresAt DateTime? @map("line_link_code_expires_at")` · migration backfill: `line_id` ที่ตรง `^U[0-9a-f]{32}$` คัดลอกไป `line_staff_user_id` (กรณีเคยกรอก userId จริงไว้) · `lineId` เดิมคงไว้เป็นข้อมูลติดต่อ ป้ายเปลี่ยนเป็น "LINE ID (สำหรับค้นหาเพื่อน)"
- `POST /webhooks/line-staff` (guard ลายเซ็น `LineStaffWebhookGuard` เดิม) รับ `follow` → ตอบ "สวัสดี <ชื่อ OA> — พิมพ์รหัสผูกบัญชี 6 หลักที่ได้จากหน้าผู้ใช้ในระบบ" · `message` text ตรง `^\d{6}$` → หา user ที่ `lineLinkCode = code` และยังไม่หมดอายุ (15 นาที ใช้ครั้งเดียว) → ตั้ง `lineStaffUserId = source.userId` ล้างรหัส ตอบ "ผูกสำเร็จ: <ชื่อ> (<บทบาท>)" + audit `STAFF_LINE_LINKED` · ไม่ตรง → ตอบ "รหัสไม่ถูกต้องหรือหมดอายุ ขอรหัสใหม่จากหน้าผู้ใช้" · userId เดิมผูกคนอื่นอยู่ → ย้ายมาคนใหม่ (unique) + audit · ข้อความอื่น → เงียบ (200)
- `POST /staff-notify/users/:id/link-code` (OWNER) → `{ code, expiresAt }` (สุ่ม 6 หลัก เขียนทับของเดิม) · `DELETE /staff-notify/users/:id/link` → ล้าง `lineStaffUserId` + audit
- หน้าผู้ใช้: บล็อก "ไลน์พนักงาน (แจ้งเตือนภายใน)": สถานะ "ยังไม่ผูก" → ปุ่ม "สร้างรหัสผูก LINE" → แสดงรหัสใหญ่ + ขั้นตอน (1 เพิ่มเพื่อน Staff OA จาก QR/ลิงก์ใน Integration Hub 2 ส่งรหัสนี้ในแชท 3 รอข้อความ "ผูกสำเร็จ") + นับถอยหลังหมดอายุ · "ผูกแล้ว (U…abcd)" → ปุ่ม "ส่งข้อความทดสอบ" + "ยกเลิกการผูก"
- Integration Hub: รายการ `line-staff` เพิ่ม `webhookUrl: ${BASE}/api/webhooks/line-staff` + คำแนะนำตั้ง Webhook URL ใน LINE Developers (เหมือนช่องอื่น)
- ผู้รับทุกเหตุการณ์ใช้ `lineStaffUserId` เท่านั้น · "พนักงานที่ยังไม่ผูก" = `lineStaffUserId` ว่าง

**13.2 โควต้าข้อความ** — OA แพ็กเกจฟรีส่งได้ ~300 ข้อความ/เดือน นับต่อผู้รับ ⇒ (ก) SystemConfig `staff_notify_monthly_cap` (ค่าเริ่มต้น 280) · `notify` นับ `NotificationLog` `line-staff` SENT ตั้งแต่ต้นเดือนไทย ถ้า `count + ผู้รับรอบนี้ > cap` → ข้ามผู้รับที่เกินด้วย `skipped: 'quota'` + warn วันละครั้ง + Sentry · (ข) แท็บตั้งค่าแสดง "ใช้ไป N / cap เดือนนี้" + ช่องแก้ cap + คำอธิบายแพ็กเกจ · (ค) ค่าเริ่มต้น **ปิด** สำหรับเหตุการณ์ถี่: `sale.completed`, `contract.activated` · `chat.slip_sla` ส่งวันละครั้ง (dedupe ตามวันที่)

**13.3 Flex** — `StaffEventPayload.flex?: { altText; contents }` ส่งผ่าน `LineOaService.sendFlexMessage(…, 'line-staff')` + เขียน `NotificationLog` เอง · รายงานรายวันเจ้าของคง Flex เดิม (สร้างในโค้ด ไม่ได้ใช้แม่แบบ `staff.daily_line_report` — ข้อความใน §5 เดิมผิด) · `sms.credit_low` เปลี่ยนเป็นข้อความล้วนจากท่อ (แม่แบบ `staff.sms_credit_low` ไม่ถูกใช้อีก คงไว้ใน DB)

**13.4 จุดส่งเดิมที่ตกสำรวจ — รวมเข้าท่อทั้งหมด**
- `overdue/owner-alert.helper.ts` `sendToAllOwners` (เรียกจาก mdm-auto-propose · letter-auto-generate · dunning-governance) ส่ง line-staff ถึง OWNER พร้อม SMS สำรอง ⇒ เหตุการณ์ `overdue.owner_alert` (OWNER) และท่อรองรับ `smsFallback: true` → `fallbackPhone = user.phone` ต่อผู้รับ (SMS สำรองไม่หาย)
- `shop-line-chat.service.ts` ข้อความสอบถามจากเว็บ → env `SHOP_STAFF_LINE_ID` (ไม่ได้ตั้งบน prod = ทิ้งเงียบ) ⇒ เหตุการณ์ `chat.web_inquiry` (OWNER + กลุ่ม LINE)
- `auth/login-audit.service.ts` เตือนล็อกอินอุปกรณ์ใหม่ → env เดียวกัน (ไม่ใช่ lineId ของเจ้าตัว — §2 ข้อ 6 และ §11 ข้อ 5 เดิมผิด) ⇒ เหตุการณ์ `auth.new_device_login` (OWNER) ข้อความเดิม
- แคตตาล็อกจึงมี **18 เหตุการณ์**: 15 เดิม (ตัด `recurring_bill.missed` — ก้อน 6 ไม่ยิงกรณีนี้ เหลือ `recurring_bill` ครอบ UPCOMING/DUE_TODAY/OVERDUE) + 3 ข้างบน

**13.5 แก้ข้อเท็จจริง/รายละเอียด** — `isConfigured()` ของท่อ = มี token เท่านั้น (ตัวเดิมบังคับ `notifyTargets` ด้วย — ใช้เป็นด่านแรกไม่ได้) · `chat.slip_sla` dedupe = วันที่ไทย (ข้อความรวม ไม่มี slipId) · `RecurringBillEvent` เพิ่ม `branchId` และ adapter สร้าง `link` เป็น path เอง · `cash_close.*` ใช้ `findUnclosedYesterday` / `staleAwaitingConfirmWhere` ที่มีอยู่ (เงื่อนไขจริง = มีเงินสดรับเข้าเมื่อวาน) · `sale.completed` ต้องยิงที่แปลงใบจองเป็นใบขายด้วย (`bookings.service.ts` ~1163) · `contract.activated` รวมสัญญาเปลี่ยนเครื่อง (เลขที่ EXCH- บอกเอง) · เบอร์ลูกค้าใน handoff ถูก mask อยู่แล้ว (ไม่ใช่ "ใช้โทรกลับ") · `FRONTEND_URL` เป็นรายการ CORS คั่น comma → ใช้ค่าแรก · cron รายงานเจ้าของ 20:00 / สรุปหนี้ 18:00 คงเวลาเดิม · หน้า log ยังกรอง channelKey ไม่ได้ (ไม่ทำใน wave นี้ — แท็บใหม่โชว์ตัวนับแทน)

**13.6 คำตัดสินเพิ่ม (ขอให้เจ้าของทบทวน)** — 8. ใช้การผูกด้วยรหัสผ่าน webhook (ต้องตั้ง Webhook URL ของ Staff OA ใน LINE Developers ก่อนใช้) · 9. เพดาน 280 ข้อความ/เดือน ค่าเริ่มต้น ปรับได้ · 10. ขายสด/เปิดสัญญา **ปิดเป็นค่าเริ่มต้น** (เพราะโควต้า) เปิดเองได้ · 11. รวมจุดส่งเดิมทั้งหมด (รวมเตือนล็อกอิน) ถึง OWNER ผ่านท่อ
