# ถังขยะรวม — กู้ของที่ลบผิด (ก้อน 8 · A10)

วันที่ 2026-10-26 · ก้อน 8 ของรายการช่องว่าง Tooltify · สถานะ: **เจ้าของให้เริ่มโดยไม่ถาม ("ok") — คำตัดสินทั้งหมดเป็นของผู้เขียน ดู §11 ให้เจ้าของทบทวนตอน PR** · สาขา `feat/trash-bin` (จาก `main` 26.10.54 · ไม่พึ่งก้อน 6/7)

## 1. เจตนา

พนักงานกดลบของผิดแล้วไม่มีทางเอาคืน (ลูกค้า ใบจอง แม่แบบ ตั้งค่า ฯลฯ) — ทุกวันนี้ต้องให้คนเขียน SQL ล้าง `deleted_at` เอง หรือสร้างใหม่ (ซึ่งหลายตัวสร้างใหม่ไม่ได้เพราะ unique ยังถูกแถวที่ลบจองอยู่) ระบบใช้ soft delete ทั่วทั้งระบบ (`deletedAt` บน 174 โมเดล · กติกา database.md "ห้าม hard delete") แถวจึงยังอยู่ครบ แค่ไม่มีประตูให้กู้

สิ่งที่ค้นพบตอนสำรวจ (กำหนดรูปแบบของงานนี้):
- **ไม่มี restore endpoint ที่ไหนเลย** · ไม่มี `includeDeleted` · ไม่มี Prisma middleware กรอง `deletedAt` (ทุก query กรองเอง ~2,479 จุด) ⇒ ตั้ง `deletedAt = null` แล้วแถวกลับมาแสดงทุกหน้าโดยอัตโนมัติ
- **AuditLog รู้ว่าใครลบ เมื่อไร แถวไหน แต่ไม่มีภาพก่อนลบ** (`AuditInterceptor` เขียน action `DELETE` entity จาก URL entityId = UUID ตัวสุดท้าย · `oldValue` ว่างทุกครั้ง) ⇒ "ของที่กู้ได้" = ตัวแถวที่ยังค้างในตารางเท่านั้น
- **ไม่มี cron ลบถาวรแถวธุรกิจที่ถูก soft-delete** ⇒ ไม่มีเพดานเวลาของการกู้ (หน้าจอใช้หน้าต่าง 90 วันเพื่อความอ่านง่าย ไม่ใช่เพดานจริง)
- **`deletedAt` ถูกใช้ในความหมาย "ยกเลิก/แทนที่/รวม" ในหลายโมเดล** (Sale void · Payment/InstallmentSchedule/FinanceReceivable ตอนยกเลิกสัญญา · Contact/Customer merge · Signature superseded · retention cron) ⇒ **ห้ามทำ restore ทั่วไป ต้องเป็น allow-list รายโมเดล**
- **partial unique index** (`WHERE deleted_at IS NULL`) ทำให้การกู้ชนได้: products(imei) · expense_documents(number) · bookings(locked_product_id) · contacts(tax_id) ฯลฯ ⇒ ต้องตรวจก่อนและตอบ 409 ภาษาไทย
- ทางกู้ที่มีอยู่จริงทางเดียว: คำขอตัดสินค้าเหตุผล **FOUND "พบของคืน"** (`stock-adjustments.service.ts:769-817`) ซึ่ง database.md ระบุว่า "เป็นทางกู้เครื่องที่ถูกลบทางเดียวที่ระบบมี … ต้องไม่กลายเป็นประตูลัดเข้าคลัง" ⇒ สินค้าไม่เปิดปุ่มกู้ตรง ให้ชี้ไปทางนั้น

## 2. เป้าหมาย / ไม่ทำ / ห้ามเกิด

**เป้าหมาย**
1. เจ้าของเปิดหน้าเดียวเห็น "ของที่ถูกลบ" ทุกประเภทที่กู้ได้ รู้ว่าใครลบ เมื่อไร และกดกู้คืนได้ทีละรายการหรือหลายรายการ
2. กู้แล้วของกลับมาใช้งานเหมือนก่อนลบ (ย้อนสิ่งที่การลบเปลี่ยนทั้งหมด ไม่ใช่แค่ `deletedAt`) และไม่ทำให้ข้อมูลซ้ำ/ชนกติกาเดิม
3. ทุกการกู้มี audit ในสาย Merkle (`AuditService.log` หลัง commit) พร้อมเหตุผลเมื่อกู้ไม่ได้

**ไม่ทำใน wave นี้**
- ลบถาวร / ล้างถังขยะ (กติกา "ห้าม hard delete" — ถังขยะมีปุ่มกู้อย่างเดียว)
- เก็บ snapshot ก่อนลบลง AuditLog (งานแยก: ปรับ interceptor/บริการให้เก็บ `oldValue` — ไม่จำเป็นสำหรับการกู้เพราะแถวยังอยู่)
- กู้สิ่งที่ `deletedAt` แปลว่า "ยกเลิก/แทนที่/รวม" (§4 ตาราง "ไม่เข้าถัง")
- undo แบบ toast หลังกดลบ (ทำได้ภายหลังบนฐานเดียวกัน: เรียก restore endpoint)
- ให้บทบาทอื่นนอกจาก OWNER กู้

**ห้ามเกิด**
- กู้ลูกค้าแล้วได้เบอร์หลักซ้ำกับลูกค้าที่ยังอยู่ (database.md §เบอร์) · กู้สินค้าแล้ว IMEI ซ้ำ
- กู้ร่างสัญญาที่ระบบกลับรายการเงินดาวน์/เครดิต/ปลด CreditCheck ไปแล้ว (เห็นแต่ตัวแถว แต่เงินไม่กลับ)
- กู้ใบขาย/ใบรับเงิน/ค่างวด/JE ที่ถูก "ยกเลิก" (ทำบัญชีพังทันที)
- แถว audit ของการกู้ตกสาย Merkle (ห้าม `tx.auditLog.create`)
- หน้าเพิ่มภาระให้หน้าอื่น: ไม่เพิ่ม query flag ใด ๆ ให้ list/detail เดิม

## 3. ผู้ใช้และสิทธิ์

- **OWNER เท่านั้น** ทั้ง API (`@Roles('OWNER')`) และหน้า (`settings-registry` หมวด `system` roles `['OWNER']`) — ผู้ลบหลายทางเป็น BM/FM/AC แต่การกู้ข้ามสาขา/ข้ามบัญชีเป็นเรื่องของเจ้าของ
- เมนู: ตั้งค่า › ระบบ & ความปลอดภัย › **ถังขยะ** (`/settings/system/trash`) — อยู่ใต้ `/settings` จึงไม่ต้องแตะ `route-reachability` และเมนูหลัก

## 4. ขอบเขตโมเดล (allow-list) — "กู้คืน = ย้อนสิ่งที่การลบเปลี่ยน"

กติกาเดียวทุกประเภท: การลบเขียน `{ deletedAt, (isActive|enabled|active)=false }` ⇒ การกู้เขียนกลับ `{ deletedAt: null, flag=true }` · ก่อนเขียนต้องตรวจ (ก) แถวยังถูกลบอยู่จริง (`deletedAt != null`) (ข) เงื่อนไขเฉพาะประเภท (ค) partial unique → 409 ภาษาไทย

### 4.1 กู้ได้ (ปุ่ม "กู้คืน")

| type | โมเดล · ป้าย | สิ่งที่การลบทำ (จุดลบ) | เงื่อนไข/ตรวจตอนกู้ | หลังกู้ |
|---|---|---|---|---|
| `customer` | Customer · ลูกค้า/ผู้สนใจ | `deletedAt` (`customer-write.service.ts:508`) · ไม่แตะลูก | ไม่ใช่ placeholder ที่ถูกรวม (`mergedIntoId == null` — ไม่ขึ้นรายการเลย) · **ล็อกเบอร์ `lockCustomerPhone` + `assertContactNotDuplicate` (เบอร์/อีเมล เทียบแถวที่ยังอยู่) → 409 "เบอร์ … ถูกใช้โดยลูกค้า X แล้ว"** · ถ้า `nationalIdHash` ถูกชุบไปแล้วโดย create ใหม่ (แถวนี้ `deletedAt` ว่างแล้ว) = กู้ไม่ได้ (ตรวจข้อ ก) | เรียก recompute journey state + AUTO tags ของลูกค้าคนนี้ (service เดิม) · warnings: "สัญญาเดิมที่ยัง TERMINATED/DRAFT ไม่ถูกแตะ" |
| `booking` | Booking · ใบจอง | `deletedAt` + audit `BOOKING_DELETED` (`bookings.service.ts:1318`) · ลบได้เฉพาะ PENDING_DEPOSIT | ถ้า `lockedProductId` ไม่ว่างและมีใบจองอื่นที่ยังอยู่ล็อกเครื่องเดียวกัน → 409 "เครื่องถูกใบจอง … ล็อกแล้ว" | — |
| `todo` | Todo · งาน | `deletedAt` (+ status CANCELLED เมื่อมีห้องแชท) | — | คง status ตามที่เป็น (ไม่เดาสถานะก่อนลบ) · warning เมื่อ status = CANCELLED |
| `repair_ticket` | RepairTicket · ใบซ่อม | `deletedAt` (ลบได้เฉพาะ CANCELLED) | — | กลับมาแสดงเป็น CANCELLED |
| `legal_case` | LegalCase · คดี | `deletedAt` | `contractId @unique` แบบเต็ม — ไม่ชน | — |
| `expense_document` | ExpenseDocument · ใบรายจ่าย (ร่าง) | `deletedAt` เฉพาะ DRAFT + audit `DELETED` | status ต้องเป็น DRAFT · **partial unique `number` → 409 "เลขที่ … ถูกออกใหม่แล้ว"** | lines/attachments ไม่เคยถูกแตะ จึงกลับมาครบ · ไม่แตะงวด/บัญชี (ร่างยังไม่โพสต์) |
| `other_income` | OtherIncome · รายได้อื่น (ร่าง) | `deletedAt` เฉพาะ DRAFT + audit `OI_DELETED` | status DRAFT | — |
| `fixed_asset` | FixedAsset · สินทรัพย์ (ร่าง) | `deletedAt` เฉพาะ DRAFT | status DRAFT | — |
| `expense_template` | ExpenseTemplate · รายจ่ายโปรด/บิลประจำ | `deletedAt` (`expense-templates.service.ts:311`) | โควต้า `max_templates_per_user` ของเจ้าของแม่แบบ (นับเฉพาะแถวที่ยังอยู่) → 409 "เกินโควต้า … ลบอันอื่นก่อน" | ถ้า `isRecurring` cron เริ่มสร้างงวดใหม่เองรอบถัดไป (งวดเดิมที่ค้างไม่ถูกแตะ) · warning |
| `other_income_template` | OtherIncomeTemplate | `deletedAt` | — | — |
| `canned_response` | CannedResponse · แม่แบบแชท | `deletedAt` (bubbles/quick replies ไม่ถูกแตะ) | `shortcut @unique` เต็ม — ไม่ชน | — |
| `notification_template` | NotificationTemplate · แม่แบบแจ้งเตือน | `deletedAt` + `isActive=false` | `eventType @unique` เต็ม | `isActive=true` (กลับมาส่งตาม event) · warning บอกชัด |
| `sms_template` | SmsTemplate | `deletedAt` + `active=false` | `name @unique` เต็ม | `active=true` |
| `promotion` | Promotion | `deletedAt` | — | — |
| `interest_config` | InterestConfig · ดอกเบี้ย/ค่างวด | `deletedAt` + `isActive=false` | — | `isActive=true` |
| `reorder_point` | ReorderPoint · จุดสั่งซื้อซ้ำ | `deletedAt` | dedup ตอน create ไม่กรอง deletedAt อยู่แล้ว — กู้ไม่ชน | — |
| `dunning_rule` | DunningRule · กฎทวงหนี้ | `deletedAt` | — | — |
| `webhook` | WebhookSubscription | `deletedAt` | — | — |
| `trade_in_valuation` | TradeInValuation · ราคารับซื้อ | `deletedAt` | `@@unique` เต็ม | กลับมาแสดงบนหน้ารับซื้อทันที (warning) |
| `buyback_question` | BuybackQuestion (+ choices) | `deletedAt` ของคำถาม + choices ด้วย timestamp เดียวกัน | — | กู้ choices ที่ `deletedAt == question.deletedAt` ด้วย |
| `reverse_reason` | ReverseReason | `deletedAt` + `isActive=false` | — | `isActive=true` |
| `chart_of_account` | ChartOfAccount · ผังบัญชี | `deletedAt` (เฉพาะที่ไม่มี JournalLine; ที่มี = เปลี่ยน status ไม่เข้าถัง) | `code @unique` เต็ม | — |
| `payment_method_config` | PaymentMethodConfig · ช่องทางรับเงิน | `deletedAt` + `enabled=false` | — | `enabled=true` |
| `gfin_model_mapping` / `gfin_overprice_rule` / `gfin_rate_factor` | ตั้งค่า GFIN 3 ตาราง | `deletedAt` + audit snapshot | `@@unique` เต็ม | — |
| `chat_knowledge` | ChatKnowledgeBase · FAQ บอท | `deletedAt` + `active=false` | — | `active=true` |
| `external_finance_company` | ExternalFinanceCompany · ไฟแนนซ์นอก | `deletedAt` | `name @unique` เต็ม | — |
| `supplier` | Supplier · ผู้จัดจำหน่าย | `deletedAt` + `isActive=false` | — | `isActive=true` |
| `branch` | Branch · สาขา | `deletedAt` + `isActive=false` | — | `isActive=true` · warning "ผู้ใช้/สต๊อกของสาขาไม่เคยถูกย้าย" |

### 4.2 เห็นในถังแต่กู้ตรงไม่ได้ (แสดงพร้อมเหตุผล + ทางออก)

| type | ทำไม | ปุ่มที่ให้ |
|---|---|---|
| `product` | database.md: ทางกู้เครื่องที่ถูกลบมีทางเดียวคือคำขอ FOUND (เจ้าของอนุมัติ · กลับ JE ตัดจำหน่าย · IMEI ชน → 409 อยู่แล้ว) ห้ามสร้างด่านชุดที่สอง | "ขอพบของคืน" → `/stock/adjustments?found=<productId>` (หน้าเดิมเปิด dialog คำขอ FOUND พร้อมเครื่องนี้ — เพิ่ม query param ให้ dialog อ่านเท่านั้น) |
| `contract` (ร่าง) | การลบกลับ JE ดาวน์ · คืนเครดิตเทิร์น · soft-delete ลายเซ็น/KYC · ปลด `creditCheck.contractId` — ล้าง `deletedAt` อย่างเดียวได้แถวว่างเปล่า | ไม่มีปุ่ม · ข้อความ "ต้องทำสัญญาใหม่ (เงินดาวน์/เครดิตถูกคืนไปแล้วตอนลบ)" · **แก้ copy ใน `ContractDetailPage` ที่บอกว่า "soft delete, กู้คืนได้" เป็น "ลบแล้วกู้คืนไม่ได้"** |

### 4.3 ไม่เข้าถังเลย (ไม่ list)

Sale · Payment · InstallmentSchedule · FinanceReceivable · Receipt/LoyaltyPoint · JournalEntry/Line · CommissionPayout · InterCompanyTransaction (deletedAt = CANCELLED) · Contact (merge) · Customer ที่ `mergedIntoId` ไม่ว่าง · ChatRoom/ChatMessage · Signature/EDocument/ContractDocument · PaymentDraft · SupplierPaymentMethod · CustomerTag · FilterPreset · ChatNote/SideMessage · FinanceCompanyContact · StaffAppointmentWindow · CustomerJourneyEntry · MdmLockRequest · EquityDocument · BankAccount (disable) · CompanyInfo · IntegrationConfig/SystemConfig · ไฟล์แนบทุกชนิด · Rich menu (hard ที่ LINE) · สิ่งที่ "ลบ" ด้วย `isActive` อย่างเดียว (sticker/contract/pricing/inspection template — กู้ด้วย PATCH เดิม)

## 5. ผู้ลบ ("ลบโดย")

ไม่มีคอลัมน์ `deletedById` ทั่วไป ⇒ หาจาก AuditLog: `entityId = row.id` และ `action ∈ ['DELETE', <action เฉพาะประเภท>]` (`BOOKING_DELETED`, `DELETED`, `OI_DELETED`, `REPAIR_TICKET_SOFT_DELETED`, `EMPLOYEE_PROFILE_DELETED` …) เลือกแถวที่ `createdAt` ใกล้ `deletedAt` ที่สุดภายใน ±10 นาที · ดึงทีเดียวทั้งหน้า (`findMany entityId in [...]`) · ไม่พบ = "ไม่ทราบ (ระบบ/สคริปต์)" — ครอบคลุมการลบจาก cron/CLI ที่ไม่มี userId

## 6. API — โมดูล `trash` (`apps/api/src/modules/trash/`) · OWNER

- `trash-registry.ts` — allow-list เดียวของระบบ: `TrashEntry { type, label, group, model (ชื่อ delegate), listSelect, toRow(row) → { title, subtitle, link }, extraWhere?, auditActions, restorable: true | { reason, actionLabel, linkFor(row) }, restore(tx, row, ctx) → { data, warnings }, afterRestore?(prisma, row) }` · เทสยืนยันว่าทุก entry ชี้โมเดลที่มี `deletedAt` และคีย์ไม่ซ้ำ
- `GET /trash/types` → `{ types: [{ type, label, group, count, restorable }] }` (count = แถวที่ `deletedAt != null` ตาม extraWhere · ใน 90 วันเมื่อส่ง `?days=90`)
- `GET /trash?type=&q=&days=90&page=1&pageSize=50` → `{ data: TrashRow[], total, page, pageSize }` · `type` ว่าง = ทุกประเภท: ดึงล่าสุด ≤50 ต่อประเภทแล้วรวมเรียง `deletedAt desc` (บอกในหน้าว่า "เมื่อดูรวมแสดงล่าสุด 50 รายการต่อประเภท") · `q` ค้นใน title/subtitle ฝั่ง DB ต่อประเภท (`contains` บนฟิลด์ที่ registry ระบุ)
  - `TrashRow { type, typeLabel, id, title, subtitle, deletedAt, deletedBy: { id, name } | null, restorable, reason?, actionLabel?, link? }`
- `POST /trash/:type/:id/restore` → `{ ok: true, warnings: string[], link }` · 404 ไม่พบ/ไม่ได้ถูกลบ · 409 ชนกติกา (ข้อความไทยบอกว่าชนกับอะไร) · 400 ประเภทไม่รู้จักหรือกู้ตรงไม่ได้
  - ลำดับ: โหลดแถว (รวมที่ลบ) → ตรวจ (ก)(ข)(ค) ใน `$transaction` (ล็อกเบอร์ลูกค้าใน tx เดียว) → `update { deletedAt: null, ...flags }` → `afterRestore` นอก tx (recompute) → `audit.log({ action: 'RESTORED', entity: type, entityId, userId, oldValue: { deletedAt }, newValue: { changes, warnings } })` **หลัง commit** (database.md §AuditLog)
  - P2002 ที่หลุดมาถึง (race) → 409 ข้อความเดียวกับการตรวจล่วงหน้า
- `POST /trash/restore` body `{ items: [{ type, id }] }` (≤50) → `{ results: [{ type, id, ok, error?, warnings? }] }` ทีละรายการ ไม่หยุดเมื่อรายการหนึ่งล้ม
- ไม่มี endpoint ลบถาวร

## 7. หน้าจอ — ตั้งค่า › ระบบ & ความปลอดภัย › ถังขยะ (mockup กระดาน 1)

- หัว: "ถังขยะ" · "ของที่ถูกลบ 90 วันล่าสุด กู้คืนได้ที่นี่ (เฉพาะเจ้าของ) · ไม่มีการลบถาวร"
- แถบประเภท (chips นับจำนวน): ทั้งหมด · ลูกค้า · ใบจอง · ใบรายจ่าย (ร่าง) · แม่แบบ · ตั้งค่า · สินค้า (กู้ผ่านพบของคืน) … จัดกลุ่มตาม `group` ของ registry
- ตัวกรอง: ค้นหา (ชื่อ/เลขที่/เบอร์หางเลข) · ช่วง 30 / 90 / ทั้งหมด
- ตาราง (`overflow-x-auto` · มือถือเป็นการ์ด): ☐ · ประเภท (badge) · รายการ (ชื่อหนา + บรรทัดรอง) · ลบเมื่อ (วันที่ไทย + "3 วันก่อน") · ลบโดย · สถานะ ("กู้ได้" / "กู้ไม่ได้ — เหตุผล" ไอคอน+คำ ไม่ใช้สีอย่างเดียว) · ปุ่มแถว "กู้คืน" หรือ "ขอพบของคืน"
- เลือกหลายรายการ → แถบล่าง "กู้คืนที่เลือก (N)" (เฉพาะที่กู้ได้ · ≤50)
- ยืนยันก่อนกู้ (`ConfirmDialog` variant default ไม่ใช่ destructive): บอกสิ่งที่จะเกิด เช่น "ลูกค้าจะกลับมาแสดงในรายชื่อ · ระบบจะตรวจเบอร์ซ้ำก่อน" · ผลลัพธ์ toast สำเร็จ + ลิงก์ "เปิด" · ล้ม → toast ข้อความ 409 จาก API
- ว่าง: "ไม่มีของในถังขยะช่วงนี้" + ปุ่มขยายเป็น "ทั้งหมด"
- กติกา UI: label มองเห็น · ปุ่ม ≥44px บนมือถือ · โทเคนจาก `index.css` เท่านั้น · ตารางไม่ล้นจอ

## 8. แก้ข้อความลบเดิมให้ตรงความจริง (ในก้อนนี้)

- ลูกค้า: "การลบจะไม่สามารถกู้คืนได้จากหน้าจอ" → "เจ้าของกู้คืนได้จาก ตั้งค่า › ถังขยะ"
- สินทรัพย์ (2 จุด) "ไม่สามารถกู้คืนได้" → "เจ้าของกู้คืนได้จากถังขยะ (เฉพาะฉบับร่าง)"
- รายได้อื่น (ร่าง) / Webhook "ไม่สามารถยกเลิกได้" → "เจ้าของกู้คืนได้จากถังขยะ"
- สัญญา: "(soft delete, กู้คืนได้)" → "ลบแล้วกู้คืนไม่ได้ — เงินดาวน์/เครดิตจะถูกคืนทันที"

## 9. เทส

- **หน่วย (jest)**: registry (ทุก type มี `deletedAt` · label/group ครบ · restorable ชี้ลิงก์ได้) · `TrashService.list` (รวมหลายประเภท เรียง deletedAt · q · days · deletedBy จาก audit ใกล้เวลาสุด · ไม่พบ = null) · `restore` ต่อประเภทสำคัญ: customer (ล็อกเบอร์ + ซ้ำ → 409 · recompute ถูกเรียกหลัง tx · audit หลัง commit และ **ไม่ใช่** `tx.auditLog.create`) · booking (ล็อกเครื่องซ้ำ → 409) · expense_document (DRAFT เท่านั้น · P2002 → 409) · expense_template (โควต้า) · notification_template (isActive กลับ true) · buyback_question (choices ตาม timestamp) · product → 400 พร้อม link · แถวที่ไม่ได้ถูกลบ → 404 · bulk ไม่หยุดเมื่อล้ม · controller OWNER เท่านั้น (RolesGuard metadata)
- **Postgres (vitest `*.integration.spec.ts` + glob ใหม่ `TRASH_FILES` ใน deploy-gcp.yml)**: ลบลูกค้าจริงผ่าน `CustomerWriteService.remove` → list เห็น + deletedBy จาก AuditLog ที่เขียนผ่าน `AuditService.log` → restore → ลูกค้ากลับมาใน `findAll` · กู้ซ้ำ 404 · สร้างลูกค้าใหม่เบอร์เดิมแล้ว restore → 409 · audit `RESTORED` มี `rowHash`/`sequenceNumber` · ใบรายจ่ายร่าง: ลบ → ออกเลขใหม่ซ้ำ → restore 409
- **เว็บ (vitest+RTL)**: หน้าโหลด types + rows · chip กรอง · ค้นหา debounce · ปุ่มกู้ → ConfirmDialog → POST → toast + invalidate · แถวกู้ไม่ได้แสดงเหตุผล + ปุ่ม "ขอพบของคืน" ลิงก์ถูก · bulk เลือกเฉพาะกู้ได้ → POST bulk → สรุปผล · ว่าง · settings-registry: item roles OWNER · copy ใน dialog ลบ 5 จุดเปลี่ยนแล้ว

## 10. สิ่งที่ปล่อยให้ผู้สร้างตัดสิน

- รูปแบบ `listSelect`/`toRow` ต่อประเภท (ฟิลด์ที่เป็นชื่อ/เลขที่) · การ mask เบอร์ในบรรทัดรอง (ใช้ `maskPhone` เดิม)
- วิธีรวมผลหลายประเภท (query ขนาน `Promise.all` ต่อประเภท) และการแบ่งหน้าในหน่วยความจำ
- โครง DataTable/ScreenTable ตามแบบ `SalesHistoryPage` (มีสวิตช์+ปุ่มต่อแถว+ConfirmDialog แบบมี children)
- การส่ง `found=<productId>` ให้ `RequestAdjustmentDialog` เปิดพร้อมเครื่อง (อ่าน query แล้วเปิด dialog — แตะหน้าเดิมให้น้อยที่สุด)

## 11. คำตัดสินของผู้เขียน (เจ้าของทบทวน)

1. **กู้คืน = กลับมาใช้งานเหมือนก่อนลบ** (คืน `isActive/enabled/active` ด้วย) — ไม่ใช่กู้แบบ "ปิดใช้งานไว้ก่อน" เพราะปุ่มลบเดิมเป็นปุ่มเดียวที่ตั้ง flag นั้น
2. **สินค้า**ไม่มีปุ่มกู้ตรง ชี้ไปคำขอ "พบของคืน" (ด่านเดียวตาม database.md) · **ร่างสัญญา**กู้ไม่ได้เลย (ผลข้างเคียงตอนลบย้อนไม่ได้)
3. **ร่างเอกสารการเงิน (ใบรายจ่าย/รายได้อื่น/สินทรัพย์)** กู้ได้เพราะยังไม่โพสต์ · เลขที่ที่ถูกออกใหม่แล้ว = 409 ไม่ออกเลขใหม่ให้
4. **OWNER เท่านั้น** ทั้งที่บางอย่าง BM/FM/AC ลบได้
5. หน้าต่างเริ่มต้น **90 วัน** (สลับ "ทั้งหมด" ได้) · ไม่มีเพดานกู้จริง
6. **ไม่มีลบถาวร** และไม่มี undo toast ใน wave นี้
7. "ลบโดย" มาจาก AuditLog แบบประมาณ (±10 นาที) · ลบโดยระบบ/สคริปต์ = "ไม่ทราบ"
8. กู้ลูกค้า: ล็อกเบอร์ + ตรวจซ้ำทั้งเบอร์และอีเมลกับแถวที่ยังอยู่ · ไม่แตะสัญญา/แท็ก/ห้องแชทเดิม (ไม่เคยถูกลบ)
9. กู้หลายรายการทำทีละรายการสูงสุด 50 และรายงานผลรายตัว (ไม่ใช่ทั้งชุดสำเร็จ/ล้ม)
10. แก้ข้อความ dialog ลบ 5 จุดที่บอกว่า "กู้คืนไม่ได้/ยกเลิกไม่ได้" ให้ตรงความจริง และแก้ของสัญญาที่บอกผิดว่ากู้ได้
11. **ไม่รวม** Branch/Supplier ที่ไม่มีปุ่มลบในเว็บ? → **รวม** (ลบได้ผ่าน API และผลเสียของการลบผิดสูง) · ไม่รวม CompanyInfo/BankAccount/IntegrationConfig (semantics "ปิด/คืนค่าเริ่มต้น" ไม่ใช่ลบ)

## 12. ก่อน deploy

- ไม่มี migration · ไม่มี env ใหม่ · ไม่มีข้อมูลต้อง backfill
- หลัง deploy เจ้าของเปิด ตั้งค่า › ระบบ › ถังขยะ ตรวจว่ารายการล่าสุดตรงกับที่รู้ว่าถูกลบไป (เช่น ลูกค้าที่ลบผิดล่าสุด) แล้วลองกู้ 1 รายการ

## 13. ส่วนแก้หลัง builder-check (ทับข้อที่ขัดกันข้างบน — คำตัดสินของผู้เขียน เจ้าของทบทวน)

13.1 **กู้แล้วกลับมาแบบ "ปิดใช้งาน"** สำหรับประเภทที่การลบตั้ง flag (`isActive`/`active`/`enabled` = false): notification_template · sms_template · interest_config · reverse_reason · payment_method_config · chat_knowledge · external_finance_company · supplier · branch — restore ล้างแค่ `deletedAt` และเตือน "กู้แล้วยังปิดใช้งานอยู่ — เปิดได้ที่หน้า <ชื่อหน้า>" (ทุกหน้ามีสวิตช์เปิด/ปิดใน update DTO อยู่แล้ว) — **กลับคำตัดสิน §11 ข้อ 1** เหตุผล: การลบเขียนทับ flag โดยไม่เก็บค่าเดิม และ `interest_config` ถูกเลือกแบบ "ตัวที่เปิดอยู่และสร้างก่อนชนะ" การกู้แบบเปิดทันทีจะเปลี่ยนดอกเบี้ย/ค่างวดของทั้งหมวดโดยไม่มีใครรู้
13.2 **ลูกค้าที่ห้องแชทถูกผูกไปกับผู้สนใจใหม่** (`ensureForRoom` สร้าง placeholder ใหม่เมื่อลูกค้าเดิมถูกลบ): ไม่รวมอัตโนมัติ · หลังกู้ ถ้าลูกค้าไม่มี `ChatRoom` ผูกอยู่เลย → warning "ห้องแชทเดิมอาจถูกผูกกับผู้สนใจคนใหม่ไปแล้ว — ถ้าซ้ำ ให้รวมเป็นคนเดียวกันที่หน้าลูกค้า" (ทาง `POST /customers/:id/absorb-into/:targetId` ที่มีอยู่) · ตรวจซ้ำเบอร์/อีเมลยังทำตามเดิม
13.3 **ฐานโค้ด = `main`** (ไม่พึ่ง #1733) · **แถวที่ "ระบบ" ลบเอง = กู้ไม่ได้**: ถ้าแถว audit การลบมี `userId` ของผู้ใช้ระบบ (`User.isSystemUser`) → แสดง "ลบโดยระบบ" + `restorable: false` เหตุผล "ระบบลบเอง (เช่น งวดบิลประจำถูกแทน) — กู้ไม่ได้" และ `restore` ปฏิเสธ 400 — ครอบ `retireDraft` ของบิลประจำหลัง #1733 merge โดยไม่ต้องแก้ registry
13.4 **แถวที่สคริปต์ลบ** (ไม่มี audit เลย เช่น `cleanup:test-pack`, `wipe:stock-go-live`): แสดงตามปกติ "ลบโดย: ไม่ทราบ" และกู้ได้ — หน้าต่าง 90 วัน + ค้นหา + chip ประเภท เป็นตัวช่วย ไม่ซ่อนด้วย marker ข้อมูลทดสอบ (marker อยู่คนละฟิลด์ต่อโมเดล — ไม่คุ้ม)
13.5 **งานที่ผูกห้องแชท** ตอนลบไม่ถูก soft-delete (ตั้ง CANCELLED อย่างเดียว) — นอกขอบเขต ถังแสดงเฉพาะงานที่ `deletedAt` ไม่ว่าง · ตัดคำเตือน "CANCELLED" ใน §4.1
13.6 **ไม่รวม** EmployeeProfile (ข้อมูลบัญชีธนาคารเงินเดือน · มีทาง "เพิ่มกลับเข้า payroll" เดิม), ตัวเลือกคำถามรับซื้อที่ลบทีละตัว, ไฟล์ใบสมัครไฟแนนซ์ — ตัด `EMPLOYEE_PROFILE_DELETED` ออกจากรายการ action
13.7 **"ลบโดย" ค้นด้วย `(entity, entityId)`** ตาม index ของ AuditLog — registry ระบุ `auditEntities` (ชื่อ segment ของ URL ที่ interceptor เขียน เช่น `customers`) และ `auditEntityId?(row)` สำหรับ route ที่ไม่ได้ใช้ id แถว (คดี = `contractId`) · route ที่ entityId ว่าง (แม่แบบแจ้งเตือนลบด้วย eventType) = "ไม่ทราบ"
13.8 `TrashEntry.restoreData` ถูกตัดออก (ไม่มีประเภทไหนใช้หลัง 13.1)

