# ใบรับเครื่องคืน — สาขารับเครื่อง FINANCE ยืนยัน หักค่าเครื่องผ่านรอบจ่าย INTER-CO

- วันที่: 2026-09-20
- สถานะ: design อนุมัติโดยเจ้าของ (แนวทาง A + ผลตรวจ /scrutinize) — รอเขียนแผนงาน
- อ้างอิงโค้ด: **origin/main** ณ 2026-09-20 (branch `feat/stock-go-live-2026-09` ตามหลัง main 369 commits — ห้ามอ่านโค้ดยึดคืนจาก branch นั้น)
- เกี่ยวข้อง: `.claude/rules/accounting.md` หัวข้อ "ยึดเครื่อง — ราคาเดียว", "Inter-Co Settlement Batch", "หักกลบเครดิตเปลี่ยนเครื่อง + เรียกคืน"; spec `2026-09-05-repossession-single-price-design.md`; spec `2026-08-19-device-swap-netting-cancel-workbook-design.md`

---

## 1. ปัญหาและเป้าหมาย

กระบวนการจริงของกิจการ (เจ้าของ 2026-09-20): การยึดเครื่องหรือลูกค้าคืนเครื่อง เกิดหลังหน้าร้าน (SHOP) ตรวจสภาพเครื่องแล้วเท่านั้น หน้าร้านเป็นคนบันทึกในระบบ และหน้าร้านต้องจ่ายค่าเครื่องให้ FINANCE ผ่านรอบจ่าย INTER-CO

ระบบวันนี้ (prod) ขัดกับกระบวนการ 4 จุด:

| กระบวนการจริง | ระบบวันนี้ |
|---|---|
| SHOP บันทึก | `POST /repossessions` เป็น OWNER เท่านั้น (`repossessions.controller.ts:86-87`) ผจก.สาขา/ผจก.การเงินได้แค่ preview |
| จ่ายค่าเครื่องผ่าน INTER-CO | ขาคู่ SHOP ของ JP5 ถูกแท็ก `SHOP_COLLECT` ซึ่งเครื่องหักกลบรอบจ่าย**จงใจไม่รับ** ล้างได้ทางเดียวคือ `POST /contracts/:id/shop-collect-settlement` (โอนสดทีละสัญญา) |
| ไม่มีการโอนเงินสดวันยึด | ค่าเริ่มต้นของ overlay `collectedByShop=false` ⇒ FINANCE ลง `Dr 11-1201` และ SHOP ลง `Cr S11-1202` ทันที ทั้งที่ไม่มีเงินโอนจริง ⇒ ยอดธนาคารในสมุด FINANCE เกินจริงเท่าราคาประเมิน |
| ลูกค้าคืนเครื่องเองระหว่างสัญญาเดิน | strict mode `jp5_require_terminated_status=true` ยึดได้เฉพาะ TERMINATED ⇒ คืนเองบันทึกไม่ได้ และชิป "คืนเครื่อง" ในวิซาร์ดรับชำระเป็นทางตัน |

เป้าหมาย: สาขาบันทึก "ใบรับเครื่องคืน" ได้เอง สัญญาหยุดทันทีที่รับคืน FINANCE ยืนยันหนึ่งคลิกแล้วบัญชีลงครบสองสมุด ค่าเครื่องถูกหักในรอบจ่าย INTER-CO ลูกค้าได้รับแจ้งทางไลน์ และประวัติ "เคยคืนเครื่อง" ติดตัวลูกค้า

## 2. คำตัดสินของเจ้าของ (2026-09-20)

| # | คำถาม | คำตัดสิน |
|---|---|---|
| D1 | ใครโพสต์บัญชี | **(ข)** สาขาบันทึกรับเครื่อง + เกรด + ราคาประเมิน แล้ว OWNER/ผจก.การเงินกดยืนยัน JP5 กับขาคู่ SHOP ค่อยลงตอนยืนยัน |
| D2 | คืนเองกับ strict mode | **(ก)** คืนเองได้ทุกสถานะที่สัญญายังเดิน (ACTIVE/OVERDUE/DEFAULT) ด้วยเหตุผล "ผ่อนต่อไม่ไหว" / "ไม่ประสงค์ใช้ต่อ" / "อื่น ๆ" ส่วน "ยึด" ยังต้อง TERMINATED (หนังสือบอกเลิกดิสแพตช์แล้ว) — `jp5_require_terminated_status` คงไว้ |
| D3 | ลายเซ็นลูกค้า | **ไม่มี** ลูกค้าไม่ต้องการเซ็นและอยากรีบออกจากร้าน ใช้ **ข้อความไลน์แจ้งยืนยันทางเดียว** แทน |
| D4 | สัญญาหยุดเมื่อไร | **ทันทีที่รับเครื่องคืน** (ตอนสาขาบันทึก) ไม่ใช่ตอน FINANCE ยืนยัน |
| D5 | ประวัติลูกค้า | เก็บว่า "เคยคืนเครื่อง" ให้เห็นบนหน้าลูกค้า/รายชื่อ/ทวงถาม |
| D6 | จ่ายค่าเครื่อง | ผ่านรอบจ่าย INTER-CO (หักจากยอดโอน) — แนวทาง A: ประเภทหักใหม่ ไม่ใช้แถวเรียกคืนแทน (แนวทาง B ตกไป) |
| D7 | รับเครื่องข้ามสาขา | รับได้ทุกสาขา ใบเก็บสาขาที่รับ (ผลตรวจ /scrutinize ข้อ 5 — เจ้าของตอบ "ok" ต่อข้อเสนอ) |

สมมติฐานที่เจ้าของไม่แย้ง (ถือว่าตกลง): ไลน์ไม่ต้องให้ลูกค้ากดอะไร · พนักงานขายบันทึกได้ (ไม่ใช่แค่ผจก.สาขา) · ไม่บังคับถ่ายรูปตอนรับคืน รูป 6 มุมยังถ่ายตอน "พร้อมขาย" ตามเดิม · ชิป "คืนเครื่อง" ในวิซาร์ดรับชำระถูกถอด · ไม่แสดงราคาประเมินในไลน์

## 3. ขอบเขต

ทำ:
- โมดูลใหม่ `device-returns` (ใบรับเครื่องคืน) + หน้าจอสาขา/FINANCE
- refactor `RepossessionsService.create()` ให้ถูกเรียกจากขั้นยืนยัน และตัดโหมดโอนสด/ช่องติ๊ก
- ประเภทลูกหนี้-หน้าร้านใหม่ `DEVICE_RETURN` ครบทุกเลนส์ + แถวหักประเภทที่ 3 ในรอบจ่าย INTER-CO + ทางรับเงินสดสำรอง
- ไลน์แจ้งลูกค้าผ่านตัวส่งกลาง (แม่แบบแก้เองได้) 2 เหตุการณ์
- tag อัตโนมัติ "เคยคืนเครื่อง" เป็นกฎในเครื่องยนต์ tag เดิม + รายการการเดินทางลูกค้า
- กันระบบทวงถามทำงานกับสัญญาที่มีใบรับคืนเปิดอยู่
- cron รายวันเตือน FINANCE เมื่อใบค้างยืนยันนาน/ใกล้สิ้นเดือน (ข้อ 8)

ไม่ทำ (นอกขอบเขต):
- ถอดข้อจำกัด `Repossession.productId @unique` (ยึดเครื่องเดิมซ้ำ) — งานแยก รอเคสจริง
- ปลด/ถอน MDM อัตโนมัติ — ยังทำมือ
- ลงบัญชีส่วนลดยอดปิดของ JP5 — รอผู้สอบ (คำถาม 2026-09-05)
- ย้ายรายการยึดเก่าที่แท็ก `SHOP_COLLECT` ไปแล้ว — forward-only
- แม่แบบไลน์แบบ Flex สวยงาม — รอบแรกเป็นข้อความ แก้ที่หน้า `/notifications` ได้

## 4. โมเดลข้อมูล

### 4.1 ตารางใหม่ `DeviceReturn` (`device_returns`)

| ฟิลด์ | ชนิด | หมายเหตุ |
|---|---|---|
| id | uuid | |
| docNumber | String @unique | `DR-YYYYMMDD-NNNN` — ตัวนับแบบ `IntercoBatchNumberService` (advisory lock ต่อวัน BKK, max-via-findFirst-desc) **ไม่ใช้** `DocNumberService` ของ expense (ผูก enum `DocumentType` ใน Prisma) |
| contractId | FK Contract | `onDelete: Restrict` |
| productId | FK Product | snapshot จากสัญญา ณ วันสร้าง |
| customerId | FK Customer | snapshot — ให้กฎ tag/ประวัติ query ตรงได้ |
| receivingBranchId | FK Branch | สาขาที่รับเครื่องจริง (D7) = `user.branchId` ของผู้บันทึก; OWNER ต้องระบุใน body |
| receivedById | FK User | ผู้ตรวจสภาพ/ตีราคา → ไปเป็น `Repossession.appraisedById` ตอนยืนยัน |
| returnKind | enum `DeviceReturnKind { VOLUNTARY, REPOSSESSION }` | ระบบ derive จากสถานะสัญญา (ดู 5.1) |
| returnReason | String | key ของ `REPOSSESSION_RETURN_REASONS` (`UNAFFORDABLE`/`NO_LONGER_NEEDED`/`AFTER_TERMINATION`/`OTHER`) |
| deviceReceivedAt | DateTime | วันรับเครื่อง (ไม่เป็นอนาคต) → `Repossession.repossessedDate` |
| conditionGrade | enum `ConditionGrade` | A–D |
| appraisalPrice | Decimal(12,2) | ราคาประเมิน = ราคาที่ SHOP รับเครื่องไป (ราคาเดียว 2026-09-05) |
| tableBasePrice | Decimal(12,2)? | snapshot ตารางรับซื้อ (ยี่ห้อ/รุ่น/ความจุ/เกรด) ณ วันสร้าง — null = ไม่มีในตาราง |
| repairCost | Decimal(12,2) default 0 | ข้อมูลรายงาน ไม่ลงบัญชี (เหมือนเดิม) |
| notes | String? | บังคับเมื่อเหตุผล = OTHER หรือราคาต่างจากตารางเกิน 15% |
| previousContractStatus | enum `ContractStatus`? | เฉพาะ VOLUNTARY — ใช้คืนสถานะเมื่อส่งกลับ/ยกเลิก |
| status | enum `DeviceReturnStatus { PENDING_CONFIRM, CONFIRMED, REJECTED, CANCELED }` | |
| confirmedById / confirmedAt | | |
| repossessionId | FK Repossession @unique nullable | ผูกรายการยึดที่สร้างตอนยืนยัน |
| rejectedById / rejectedAt / rejectReason | | rejectReason 10–500 ตัวอักษร |
| canceledById / canceledAt | | |
| lineNotifyStatus | String? | `SENT` / `FAILED` / `NO_LINE` |
| lineNotifiedAt | DateTime? | |
| lineNotificationId | String? | id ของ `NotificationLog` |
| createdAt / updatedAt / deletedAt | | มาตรฐาน |

Index: `contractId`, `customerId`, `status`, `receivingBranchId`. **Partial unique** (raw SQL ใน migration — Prisma เขียนไม่ได้; precedent `products_imei_partial_unique`): `UNIQUE (contract_id) WHERE status = 'PENDING_CONFIRM' AND deleted_at IS NULL` — หนึ่งสัญญามีใบรอยืนยันได้ใบเดียว

Relations เพิ่ม: `Contract.deviceReturns[]`, `Customer.deviceReturns[]`, `Product.deviceReturns[]`, `Repossession.deviceReturn?`

### 4.2 enum และคอลัมน์ที่แก้

- `InterCoItemType` += `DEVICE_RETURN`
- `InterCoSettlementItem.deviceReturnAmount Decimal @default(0) @db.Decimal(12,2)` (@map `device_return_amount`)
- `CustomerTagType` += `RETURNED_DEVICE`
- `ShopReceivableType` (TS union ใน `shop-receivable-type.util.ts`) += `'DEVICE_RETURN'`
- `JOURNEY_ENTRY_KINDS.SYSTEM` (`packages/shared/src/customer-journey.ts`) += `'DEVICE_RETURNED'` + zod schema ใน `apps/api/src/modules/customer-journey/journey-data-schemas.ts`

Migration เดียว additive ทั้งหมด ไม่มี backfill

## 5. Flow

### 5.0 API สรุป (โมดูล `apps/api/src/modules/device-returns/`)

| Method | Path | Roles | หมายเหตุ |
|---|---|---|---|
| GET | `/device-returns/preview?contractId&conditionGrade&appraisalPrice` | OWNER, BM, SALES | ค้น/ตรวจสัญญาก่อนสร้าง: สรุปสัญญา, kind ที่ระบบเลือก, eligibility + เหตุผลที่ติด, ราคาตาราง, deviationPct |
| GET | `/device-returns/lookup?q=` | OWNER, BM, SALES | ค้นสัญญาด้วยเลขสัญญา / เบอร์ / IMEI (คืนรายการสั้น ไม่มี PII เกินจำเป็น) |
| POST | `/device-returns` | OWNER, BM, SALES | 5.1 |
| GET | `/device-returns?status&contractId&branchId&page&limit` | OWNER, FM, ACC ทั้งหมด; BM, SALES เฉพาะ `receivingBranchId` ตัวเอง | |
| GET | `/device-returns/awaiting-repossession` | OWNER, BM, FM | 5.7 |
| GET | `/device-returns/:id` | ตามขอบเขตข้างบน | |
| POST | `/device-returns/:id/confirm` | OWNER, FM | 5.2 |
| POST | `/device-returns/:id/reject` | OWNER, FM | 5.3 |
| POST | `/device-returns/:id/cancel` | OWNER, BM (สาขาตัวเอง) | 5.4 |
| POST | `/device-returns/:id/resend-line` | OWNER, FM, BM | 5.5 |
| POST | `/interco-settlement/device-returns/:contractId/settle-cash` | OWNER, FM | 6.3 |
| ~~POST~~ | ~~`/repossessions`~~ | — | **ลบ** (ผู้เรียกเดียวคือ overlay) |

### 5.1 สาขาสร้างใบ — `POST /device-returns`

Roles: `OWNER`, `BRANCH_MANAGER`, `SALES`. Body: `contractId`, `deviceReceivedAt`, `conditionGrade`, `appraisalPrice`, `repairCost?`, `returnReason`, `notes?`, `receivingBranchId?` (OWNER เท่านั้น; BM/SALES ใช้ `user.branchId` — ไม่มี = fail-closed 403)

**ไม่มีข้อจำกัดว่าสัญญาต้องเป็นของสาขาผู้บันทึก (D7)** — สาขาใดรับเครื่องได้หมด สิ่งที่ผูกสาขาคือ `receivingBranchId`

ด่านทั้งหมดใน `$transaction` เดียว (ข้อความไทย):

1. สัญญาต้องมีอยู่และ `deletedAt = null`; โหลด `product`, `customer`, `payments (deletedAt null)`
2. derive `returnKind`:
   - สถานะ `TERMINATED` → `REPOSSESSION`; `returnReason` ต้องเป็น `AFTER_TERMINATION` (ไม่ส่งมา = ตั้งให้)
   - สถานะ `ACTIVE`/`OVERDUE`/`DEFAULT` → `VOLUNTARY`; `returnReason` ต้องเป็น `UNAFFORDABLE`/`NO_LONGER_NEEDED`/`OTHER` (OTHER ต้องมี `notes`)
   - สถานะอื่น → 400 "สัญญานี้ไม่อยู่ในสถานะที่รับเครื่องคืนได้"
3. ยอดค้าง (สูตรเดียวกับ `RepossessionsService.create()` — Σ `amountDue + lateFee(ถ้าไม่ waive) − amountPaid` ของงวดที่ไม่ PAID) ต้อง > 0 → ไม่งั้น 400 `ZERO_OUTSTANDING_MSG`
4. `product.status !== 'REPOSSESSED'` และไม่มี `Repossession` (deletedAt null) ของ `productId` → ไม่งั้น 409 `RE_REPOSSESSION_MSG` (ข้อจำกัดเดิม ฟอร์มบอกตั้งแต่ตอนค้นสัญญาผ่าน preview)
5. ไม่มีใบ `PENDING_CONFIRM` ของสัญญานี้ (partial unique เป็นตาข่าย → P2002 แปลงเป็น 409)
6. ไม่มี `ContractExchangeRequest` สถานะ `PENDING` และไม่มี `ContractCancellation` สถานะ `PENDING` ของสัญญานี้ → 400
7. ราคาประเมิน > 0; ถ้ามีราคาตาราง (`lookupTableBase(product, grade)` — ย้าย helper นี้ออกจาก `RepossessionsService` เป็น util ใช้ร่วม) และ `|appraisal − table| / table > 0.15` ต้องมี `notes` → ไม่งั้น 400 (ข้อความเดิมของ create())
8. `deviceReceivedAt` ไม่เป็นวันในอนาคต (BKK)

เขียน (tx เดียวกัน):
- `docNumber = DeviceReturnNumberService.next(tx)`
- สร้างแถว `DeviceReturn` สถานะ `PENDING_CONFIRM` (`tableBasePrice` snapshot, `previousContractStatus` = สถานะเดิมเมื่อ VOLUNTARY)
- **VOLUNTARY (D4):** `contract.update({ status: 'TERMINATED' })` + `tx.auditLog.create({ action: 'CONTRACT_STATUS_LEGAL', entity: 'contract', newValue: { from, to: 'TERMINATED', reason: 'DEVICE_RETURN_INTAKE', deviceReturnId, docNumber } })` — รูปเดียวกับที่หนังสือบอกเลิกทำใน `contract-letter.service.ts:240-270` **แต่ไม่ยิง** dunning event `CONTRACT_TERMINATED` (ข้อความนั้นสำหรับบอกเลิกฝ่ายเดียว)
- **REPOSSESSION:** ไม่แตะสถานะสัญญา

หลัง commit (ลำดับนี้ ทุกตัว best-effort ไม่ throw กลับผู้ใช้):
1. `AuditService.log({ action: 'DEVICE_RETURN_CREATED', entity: 'device_return', entityId, newValue: { docNumber, contractNumber, returnKind, returnReason, conditionGrade, appraisalPrice, tableBasePrice, receivingBranchId } })` — post-commit ตาม `.claude/rules/database.md` (Merkle chain)
2. `CustomerTagsService.recomputeForCustomer(customerId)` — ให้ tag `RETURNED_DEVICE` ติดทันที (กฎอยู่ใน 5.6)
3. ส่งไลน์ `DEVICE_RETURNED` (5.5) แล้วอัปเดต `lineNotifyStatus/lineNotifiedAt/lineNotificationId`

ผลของ TERMINATED ที่ได้ฟรี (ตรวจโค้ดแล้ว): accrual 2A หยุด (`installment-accrual.cron.ts:86` notIn) · ค่าปรับ/สถานะงวดหยุด (`overdue-lifecycle-cron.service.ts:84` เฉพาะ ACTIVE/OVERDUE/DEFAULT) · จดหมายอัตโนมัติหยุด (`letter-auto-generate.cron.ts:50,80`) · ล็อคจากไม่รับสายหยุด (`no-promise-lock.cron.ts:58`) · มอบหมายทวงถามข้าม (`auto-balance.service.ts:195`) · dunning ตามรอบข้าม (`dunning-engine.service.ts:307`) · หายจากคิวรับชำระ (`payment-query.service.ts:46`) และคิวทวงถาม "วันนี้" (`today-queue.predicate.ts:25-29`) · ค่าเผื่อหนี้สงสัยจะสูญยังตั้งต่อด้วยฐาน ACCRUED (`bad-debt.service.ts:460`) — ถูกต้อง JP5 จะล้างตอนยืนยัน

### 5.2 FINANCE ยืนยัน — `POST /device-returns/:id/confirm`

Roles: `OWNER`, `FINANCE_MANAGER`. Body: `paymentDate?` (วันลงบัญชี default วันนี้; ต้องเดือนปัจจุบัน BKK ตามกติกาใบลดหนี้เดิม), `discountPct?` (default 50 — มีผลเฉพาะตัวเลขบนจอ/แถวยึด ไม่ลง JE)

ก่อน tx: `validatePeriodOpen` ทั้ง FINANCE และ SHOP ที่ `paymentDate` (เหมือน create() เดิม)

ใน `$transaction` เดียว:
1. โหลดใบ ต้องเป็น `PENDING_CONFIRM` ไม่งั้น 409 "ใบนี้ถูกยืนยัน/ส่งกลับ/ยกเลิกไปแล้ว"
2. เรียก `RepossessionsService.createInTx(tx, input, actor)` (refactor จาก `create()` — ดู 6.1) ด้วย:
   `contractId`, `repossessedDate = deviceReceivedAt`, `paymentDate`, `conditionGrade`, `appraisalPrice`, `repairCost`, `notes` (ประกอบ "เหตุผลคืนเครื่อง: …" เหมือนเดิม), `returnReason`, `discountPct`, `appraisedById = receivedById`, `receivingBranchId`
   ด่านทั้งหมดของ create() ยังทำงาน: สัญญาต้อง TERMINATED (VOLUNTARY ถูก flip ไปแล้วใน 5.1 จึงผ่านโดยโครงสร้าง) · ยอดค้าง > 0 (ถ้าลูกค้าจ่ายผ่าน webhook จนหมดระหว่างรอ → 400 ให้ส่งกลับใบ) · เครื่องไม่เคยยึด · ราคา ±15% (notes จากใบ)
3. `createInTx` โพสต์: JP5 (ขา Dr = `11-2107` แท็ก `DEVICE_RETURN`), ขาคู่ SHOP (`Dr S11-2002 / Cr S21-1104` แท็ก `DEVICE_RETURN`), ปลดถังพัก, flip ECL rows, ใบลดหนี้ (ถ้ามีงวด accrual ค้าง), สัญญา → `CLOSED_BAD_DEBT`, เครื่อง → `REPOSSESSED` + `ownedByCompanyId = SHOP` + `PHONE_NEW → PHONE_USED` **+ `branchId = receivingBranchId`** (ใหม่ — ที่อยู่เครื่องจริง), audit `REPOSSESSION` (เดิม)
4. `deviceReturn.updateMany({ where: { id, status: 'PENDING_CONFIRM' }, data: { status: 'CONFIRMED', confirmedById, confirmedAt, repossessionId } })` — count 0 → throw Conflict → rollback ทั้งชุด (กันกดซ้อน; JP5 reference `${contractId}:repossession` unique เป็นตาข่ายชั้นสอง)

หลัง commit: audit `DEVICE_RETURN_CONFIRMED` (post-commit) · `journeyWriter.recordAfterCommit({ kind: 'DEVICE_RETURNED', actorType: 'STAFF', actorUserId: confirmer, refType: 'contract', refId: contractId, occurredAt: deviceReceivedAt, data: { docNumber, contractNumber, returnKind, returnReason }, dedupeKey: 'DEVICE_RETURNED:<deviceReturnId>' })` · `recomputeForCustomer` · การส่งใบลดหนี้ทางไลน์ทำอยู่แล้วใน create path (fire-and-forget)

### 5.3 ส่งกลับ — `POST /device-returns/:id/reject` (OWNER, FINANCE_MANAGER; body `reason` 10–500)

ใน tx: CAS `PENDING_CONFIRM → REJECTED` (+ rejectedBy/At/reason) · **VOLUNTARY:** `contract.update({ status: previousContractStatus })` + audit `CONTRACT_STATUS_LEGAL { from: 'TERMINATED', to: previous, reason: 'DEVICE_RETURN_REJECTED', deviceReturnId }`. cron งวด/ค่าปรับ/accrual เดินต่อเอง (2A query `dueDate < tomorrow AND accrualJournalEntryId IS NULL` เรียงเก่าก่อน เก็บงวดที่ค้างระหว่างนั้นให้ — แต่ทุกงวดผ่าน `validatePeriodOpen(inst.dueDate)` ถ้าเดือนนั้นปิดไปแล้วต้องเปิดงวดใหม่ก่อน; ระบุในข้อความผลลัพธ์ให้ FINANCE เห็น)

หลัง commit: audit `DEVICE_RETURN_REJECTED` · `recomputeForCustomer` (tag หลุดเองถ้าไม่มีใบ/รายการยึดอื่น) · ส่งไลน์ `DEVICE_RETURN_CANCELED` (5.5)

### 5.4 ยกเลิกโดยสาขา — `POST /device-returns/:id/cancel` (OWNER; BRANCH_MANAGER เฉพาะใบที่ `receivingBranchId = user.branchId`)

พฤติกรรมเดียวกับ 5.3 (สถานะ `CANCELED`, audit `DEVICE_RETURN_CANCELED`, คืนสถานะสัญญา, recompute tag, ไลน์ `DEVICE_RETURN_CANCELED`)

### 5.5 ไลน์แจ้งลูกค้า — ใช้ตัวส่งกลาง ไม่เขียนบริการใหม่

ใช้ `NotificationsService.sendFromTemplate(eventType, data, recipient, { customerId, relatedId: deviceReturnId })` (`notification-dispatch.service.ts:259`) ซึ่งให้ NotificationLog, retry, และแม่แบบแก้เองได้ที่หน้า `/notifications` (TemplateManager) — **ไม่ส่ง `fallbackPhone`** (ไลน์เท่านั้น ตาม D3 ไม่ตก SMS)

- `recipient` = `customer.lineLinks[0].lineUserId ?? customer.lineIdFinance` (ตรรกะเดียวกับ `credit-note-delivery.service.ts:108`); ไม่มีทั้งคู่ → `lineNotifyStatus = 'NO_LINE'` + Todo `MEDIUM` tag `device-return` "แจ้งลูกค้าไม่ได้ ไม่มีไลน์ผูก"
- แม่แบบ 2 แถวใน `NotificationTemplate` — seed ด้วย **migration SQL แบบ idempotent** (`INSERT … ON CONFLICT (event_type) DO NOTHING`) ตาม precedent `20260702000001_seed_notification_templates` ของ origin/main ⇒ prod ได้แม่แบบตอน `migrate deploy` โดยไม่ต้องรัน SQL มือ และ dev reset ได้เอง (ไม่แตะ `prisma/seed.ts`; `sendFromTemplate` throw + Sentry เมื่อไม่มีแม่แบบ จึงต้องมีก่อนโค้ดขึ้น). ตัวแปรใช้รูป `${var}` ตามที่ dispatcher แทนค่าจริง (`notification-dispatch.service.ts:219-227`):
  - `DEVICE_RETURNED` — channel `LINE`, channelKey `line-finance`, category `TRANSACTIONAL` (ไม่ผ่านด่านความยินยอม/quiet hours ตาม `compliance.service.ts:26` — เป็นการแจ้งตามสัญญา), format `text`; ตัวแปร: `${customerName} ${docNumber} ${contractNumber} ${deviceName} ${branchName} ${receivedDate} ${grade} ${returnKindLabel}`; ข้อความตั้งต้น: "รับเครื่องคืนแล้ว ใบ ${docNumber} สัญญา ${contractNumber} ${deviceName} ที่สาขา ${branchName} วันที่ ${receivedDate} สภาพเกรด ${grade} — สัญญาหยุดนับค่างวดและค่าปรับตั้งแต่วันนี้ FINANCE จะตรวจสอบและแจ้งผลปิดสัญญาพร้อมใบลดหนี้ทางไลน์นี้" (**ไม่มีราคาประเมิน**)
  - `DEVICE_RETURN_CANCELED` — เหมือนกัน; ข้อความตั้งต้น: "ใบรับเครื่องคืน ${docNumber} สัญญา ${contractNumber} ถูกยกเลิก สัญญาเดินต่อตามเดิม หากมีข้อสงสัยติดต่อสาขา ${branchName}"
- ผลส่งเก็บบนใบ (`SENT`/`FAILED`/`NO_LINE`); `FAILED` → dispatcher retry เอง + ใบมีปุ่ม "ส่งซ้ำ" (`POST /device-returns/:id/resend-line`, OWNER/FM/BM) · การส่งไม่สำเร็จ**ไม่ขวาง**การยืนยัน
- ไม่ยิง dunning event `CONTRACT_TERMINATED` (5.1)

### 5.6 ประวัติลูกค้า

- **tag `RETURNED_DEVICE` เป็นกฎในเครื่องยนต์ tag เดิม** (`customer-tags.service.ts` `evaluateAutoTags` + `AUTO_MANAGED_TAGS` + `autoReason`): ติดเมื่อ ลูกค้ามี `DeviceReturn` สถานะ `PENDING_CONFIRM`/`CONFIRMED` **หรือ** มีแถว `Repossession` (deletedAt null) ผ่านสัญญาของลูกค้า — ห้ามติด/ถอดเฉพาะกิจ (recompute รายคืน `customer-tag-recompute.cron.ts` จะลบ AUTO tag ที่ไม่มีกฎ) · label/สี ใน `CustomerTagChips.tsx` META ("เคยคืนเครื่อง") → แสดงเองที่ `CustomersPage` (CustomerCells), `CustomerDetailPage` (DetailHeader), หน้าทวงถาม (ContractCard, Customer360Panel)
- **การเดินทางลูกค้า:** kind `DEVICE_RETURNED` (SYSTEM) เขียนตอนยืนยัน (5.2) — ข้อมูลใน `data` ผ่าน zod whitelist ห้ามมีเบอร์/เลขบัตร/ที่อยู่
- ระดับความเสี่ยงลูกค้า (`customer-tier.service.ts:114`) นับแถว `Repossession` อยู่แล้ว → นับให้เองหลังยืนยัน ไม่แก้

### 5.7 ระบบทวงถามกับสัญญาที่มีใบเปิดอยู่ (ผลตรวจ scrutinize ข้อ 2)

- แท็บ "นัดชำระ" ของคิวทวงถาม (`queue.service.ts` `buildWhere` สาขา promise — ไม่มีตัวกรองสถานะสัญญา) เพิ่ม `deviceReturns: { none: { status: { in: ['PENDING_CONFIRM','CONFIRMED'] }, deletedAt: null } }` — helper เดียว `noOpenDeviceReturnWhere()` ใน `device-returns/device-return.predicate.ts` ใช้ร่วมกับข้อถัดไป
- `promise-resolution.cron.ts` `resolvePromise`: ก่อน `mdm.autoLock` ตรวจว่าสัญญาไม่มีใบรับคืน `PENDING_CONFIRM`/`CONFIRMED` (เครื่องอยู่ที่สาขาแล้ว) — ยังนับ broken/kept ตามเดิม แค่ไม่สั่งล็อค; log 1 บรรทัด
- รายการ "รอยึดเครื่อง" (เดิม `GET /contracts?status=TERMINATED`) เปลี่ยนเป็น `GET /device-returns/awaiting-repossession` = TERMINATED ที่ **ไม่มี** ใบ `PENDING_CONFIRM` และไม่มีแถว `Repossession`

## 6. บัญชี

### 6.1 refactor `RepossessionsService.create()`

- แยกเป็น `createInTx(tx, input: RepossessionCreateInput, actor)` (ตรรกะเดิมทั้งหมดตั้งแต่โหลดสัญญาถึง audit `REPOSSESSION`) และ `create()` เดิม**ถูกลบ**พร้อม `POST /repossessions` (ทางเข้าเดียวคือใบรับคืน) — ปรับ spec/tests ที่เรียก `create()` ให้เรียกผ่าน `DeviceReturnsService.confirm`
- ขา Dr ของ JP5 = `'11-2107'` เสมอ; `RepossessionInput.collectedByShop` เปลี่ยนเป็น `shopReceivableType: 'SHOP_COLLECT' | 'DEVICE_RETURN'` (JP4 ปิดยอดหน้าร้านรับแทนยังส่ง `SHOP_COLLECT` — byte-identical); metadata stamp `shopReceivableType`, `deviceReturnId`, `shopReceivable: '11-2107'`
- `ShopCollectShopLegs.postRepossessionIntake`: ตัดพารามิเตอร์ `collectedByShop` และสาขา `Cr S11-1202`; Cr เป็น `S21-1104` เสมอ stamp `shopReceivableType: 'DEVICE_RETURN'` + `metadata.contractId` + `deviceReturnId`; flow `shop-repossession-intake` เดิม
- `previewCalculation`/`previewJe`: ละเลย `collectedByShop`/`depositAccountCode` (ลบพารามิเตอร์); preview deposit = 11-2107 DEVICE_RETURN เสมอ; เพิ่มพารามิเตอร์ `deviceReturnId?` ให้ overlay โหมดยืนยันดึงเกรด/ราคาจากใบ
- DTO: ลบ `depositAccountCode`, `collectedByShop`, `customerRefundEnabled`, `marketValue` ออกจาก input (DTO create สาธารณะไม่มีอีกแล้ว); `UpdateRepossessionDto` คงเดิม
- audit `SHOP_COLLECT_REPOSSESSION` ไม่เขียนอีก (แทนด้วย `DEVICE_RETURN_CONFIRMED` + metadata บน JE)
- `findAll` คง `shopCollectOutstanding` (typed SHOP_COLLECT — แถวเก่า) และเพิ่ม `deviceReturnOutstanding` (typed DEVICE_RETURN net ของ POSTED deductions) เพื่อแสดง "รอหักในรอบจ่าย"; ปุ่ม "รับโอนหน้าร้าน" โชว์เฉพาะ `shopCollectOutstanding > 0` (แถวเก่า)
- ราคาประเมิน 0: ยังยืนยันได้ตามกติกาเดิม (JP5 ลง ไม่มีใบรับเข้าสต็อก SHOP และไม่มีแถวหักในรอบจ่าย)

### 6.2 ประเภท `DEVICE_RETURN` ครบทุกเลนส์ (ผลตรวจ scrutinize ข้อ 7)

ประกาศครั้งเดียว `export const SHOP_RECEIVABLE_TYPES = ['SWAP_CREDIT','PAYOUT_RECALL','SHOP_COLLECT','DEVICE_RETURN'] as const` ใน `shop-receivable-type.util.ts` และให้ SQL ทุกตัวสร้าง IN-list จากค่านี้ (`Prisma.join`) แทนตัวอักษรที่เขียนซ้ำ:

| ไฟล์ | ที่ต้องแก้ |
|---|---|
| `journal/shop-receivable-type.util.ts` | union + `EXPLICIT` เท่านั้น — **ไม่เพิ่ม `FLOW_MAP`** (ใบใหม่ stamp ชัดเสมอ; แถวยึดเก่า flow `shop-repossession-intake` ที่ไม่มี stamp คือโหมดโอนทันทีซึ่งไม่แตะ S21-1104 — ถ้าใส่ flow fallback จะถูก util จัดเป็น DEVICE_RETURN โดยไม่มีหนี้จริง) |
| `interco-settlement/interco-typed-balance.ts` | `deviceReturnFinanceBalance` (11-2107 Σ Dr−Cr typed DEVICE_RETURN by `metadata.contractId`), `deviceReturnShopBalance` (S21-1104 Σ Cr−Dr) ; IN-list ของ carve-out |
| `interco-settlement/interco-pending.service.ts` | `getPendingDeviceReturns()` (6.3), `getReconcileTotals().glDeviceReturnTotal`, IN-lists |
| `interco-settlement/interco-aging.service.ts` | `DEVICE_RETURN_COND`, คอลัมน์ `deviceReturnGross`, `intercoNet = swapCreditGross + payoutRecallGross + deviceReturnGross − settledDeduction`, `shopMirrorGross` key `metadata.contractId` สำหรับประเภทนี้, `negativeTypedFields`, IN-lists (4 จุด) |
| `interco-settlement/crons/*` | ไม่มี kind ใหม่; แขน INTERCO ครอบประเภทนี้เอง |
| `journal/cpa-templates/shop-collect-settlement.template.ts` | **ด่านใหม่ (6.4)** |

Anti-drift test (บังคับ): integration — สร้างใบ→ยืนยัน แล้ว `IntercoAgingService.getTypedAccountDrift()` ต้อง = 0 ทั้ง 11-2107 และ S21-1104 และ `classifyShopReceivable` ของ JE ทั้งสองใบคืน `DEVICE_RETURN`

### 6.3 รอบจ่าย INTER-CO — แถวหักประเภทที่ 3

mirror ของแถว `RECALL` ทุกจุด (`interco-settlement.service.ts` บรรทัดที่ grep `'RECALL'`/`recallAmount` พบ ~25 จุด):

- `IntercoPendingService.getPendingDeviceReturns(tx?)` → `DeviceReturnCandidate { contractId, contractNumber, customerName, deviceReturnGl, shopDeviceReturnGl }`: FINANCE lens 11-2107 typed DEVICE_RETURN by `metadata.contractId` `HAVING SUM > 0`; SHOP lens S21-1104 typed DEVICE_RETURN by `metadata.contractId`; settled gate เฉพาะ `itemType: 'DEVICE_RETURN'` ใน batch `PENDING_APPROVAL`/`POSTED`; **ยอด = gross − Σ `deviceReturnAmount` ของ item ใน batch `POSTED` ของสัญญานั้น (หักเฉพาะประเภทเดียวกัน — ต่างจากสูตร NET ของแถวเรียกคืนที่หักทุกประเภท)** เหตุผล: gross ของเรียกคืน (redirect ทั้งยอดที่ตัดจ่าย) นับซ้ำเครดิตสวอปที่เคยหักไว้จึงต้องหักทุกประเภท แต่ gross ของค่าเครื่องคืนเป็นหนี้ก้อนใหม่ที่ไม่เกี่ยวกับเครดิตสวอปเดิม — สัญญาใหม่จากการเปลี่ยนเครื่องที่เคยถูกหักเครดิต 8,000 แล้วภายหลังถูกยึดที่ราคา 7,000 ต้องมียอดค่าเครื่องคืน 7,000 เต็ม (ถ้าหักทุกประเภทจะได้ −1,000 แล้วหลุดจากทุกทางล้าง); drift guard ตอนอนุมัติและด่านของ settle-cash ใช้สูตรเดียวกัน; hydrate สัญญา**ไม่กรอง** `CLOSED_BAD_DEBT` (สัญญายึดปิดแล้วโดยนิยาม); net ≤ 0.01 หลุดคิว. ข้อจำกัดที่รู้ตัว: สัญญาที่ยังมีแถว SETTLEMENT รอจ่ายอยู่ (FINANCE ยังไม่เคยจ่าย SHOP) จะเข้ารอบเดียวกับแถวค่าเครื่องคืนไม่ได้ (unique `(batchId, contractId)` เดิม) — ต้องแยกรอบหรือใช้รับเงินสด
- `GET /interco-settlement/pending` คืน `{ pending, recalls, deviceReturns, reconcile }`
- `CreateBatchDto.deviceReturnContractIds?: string[]`; `buildSnapshot` สร้างแถว `itemType: 'DEVICE_RETURN'` (GL 4 เลนส์ = 0, `legacyNoShop=false`, `deviceReturnAmount = net`); guard สองสมุดต่างกัน > 0.01 → reject; สัญญาเดียวกันอยู่สองรายการในรอบเดียวไม่ได้ (unique เดิม)
- `totalDeduction = Σ swapCredit + recall + deviceReturn`; `netTransferAmount`/`shopNetAmount` ≥ 0 guard เดิม
- clash check (submit + approve): แถว DEVICE_RETURN ชนเฉพาะ `itemType: 'DEVICE_RETURN'` (สัญญานี้มี SETTLEMENT item ถาวรในรอบเก่าโดยนิยาม เหมือน RECALL)
- drift guard (approve): แถว DEVICE_RETURN เทียบ live typed net ทั้งสองสมุดกับ `deviceReturnAmount` ±0.01 (สูตร NET เหมือน RECALL)
- `buildFinanceLines`: ข้าม `Dr 21-1101/21-1102`; `Cr 11-2107 [deviceReturnAmount]` description `หักค่าเครื่องคืน {contractNumber}`
- `buildShopLines`: `Dr S21-1104 [deviceReturnAmount]` description `ล้างเจ้าหนี้ FINANCE-ค่าเครื่องคืน {contractNumber}`
- metadata `items[]` เพิ่ม `deviceReturn: '<2dp>'`, `type: 'DEVICE_RETURN'`; **ไม่ stamp** top-level `contractId`/`shopReceivableType` บน batch JE (สถาปัตยกรรม "เลนส์ gross + item gate" เดิม)
- `alarmNettingResiduals`: typed gross รวม 3 ประเภทต่อสมุด − Σ deduction ทุก itemType
- `reverseBatch`: mirror สองใบตามเดิม แถวกลับเข้าคิวเองผ่าน gate
- ทางรับเงินสดสำรอง: generalize `settleRecallCash` เป็น `settleDeductionCash(contractId, type, dto)`; route ใหม่ `POST /interco-settlement/device-returns/:contractId/settle-cash` (OWNER, FINANCE_MANAGER) DTO เดิม (`amount`, `financeDepositAccountCode`, `shopPayoutAccountCode?`, `requestId`); FINANCE ใช้ `ShopCollectSettlementTemplate` + `typeStamp: 'DEVICE_RETURN'`; SHOP `Dr S21-1104 / Cr <shopPayoutAccountCode default S11-1202>` stamp DEVICE_RETURN (flow `interco-device-return-cash-shop`); guards ชุดเดียวกับ recall (requestId idempotency, ไม่มี item DEVICE_RETURN ใน batch เปิด, อยู่ในคิว, สองสมุดตรง, amount ≤ net + 0.01); audit `INTERCO_DEVICE_RETURN_CASH_SETTLED`
- UI `PendingTab`: รายการที่ 3 "ค่าเครื่องคืน" (checkbox, ยอด net, badge สองสมุดไม่ตรง) รวมในยอดหักที่เลือก; `RecallCashDialog` รับ `type` เพื่อใช้กับค่าเครื่องคืน; `types.ts` เพิ่ม `DeviceReturnCandidate`

### 6.4 ด่านกันล้างซ้ำสองทาง

`ShopCollectSettlementTemplate.execute` (ใบรับโอนจากหน้าร้าน) เพิ่มด่านหลัง requestId idempotency: ถ้าสัญญามีบรรทัด 11-2107 ที่ stamp `DEVICE_RETURN` (นับ `deviceReturnFinanceBalance > 0` **หรือ** มี JE ใด ๆ ที่ stamp ประเภทนี้) → 400 "สัญญานี้มีค่าเครื่องคืนที่ต้องหักผ่านรอบจ่าย INTER-CO — ใช้หน้าจ่ายให้หน้าร้าน รายการค่าเครื่องคืน หรือปุ่มรับเงินสดในหน้านั้น" (ยกเว้นเมื่อ `typeStamp === 'DEVICE_RETURN'` คือถูกเรียกจาก 6.3 เอง) — ไม่งั้นการโอนสดที่ stamp SHOP_COLLECT ล้าง 11-2107 โดยที่เลนส์ DEVICE_RETURN ไม่ลด → รอบจ่ายถัดไปหักซ้ำ

### 6.5 ตัวเลขทอง (integration golden)

ยึดสัญญา X ราคาประเมิน 7,000 → JE ยืนยัน (contract 17,000/12 งวด — งวด 1-4 ผ่าน accrual 2A แล้วและจ่ายครบ งวด 5-12 ยังไม่ accrual ตามสูตร CSV กรณีที่ 5 / `repossession-jp5.template.spec.ts`):

FINANCE JP5: `Dr 11-2107 7,000.00 · Dr 11-2106 4,000.00 · Dr 21-2102 793.32 · Dr 51-1102 5,126.68 / Cr 11-2101 11,333.36 · Cr 11-2105 793.32 · Cr 21-2101 793.32 · Cr 41-1101 4,000.00` (รวม 16,920.00)
SHOP: `Dr S11-2002 7,000.00 / Cr S21-1104 7,000.00`

รอบจ่ายถัดไปจ่ายสัญญา Y (เจ้าหนี้ 10,000 + คอม 1,000) เลือกแถวค่าเครื่องคืน X:

| FINANCE Dr | | FINANCE Cr | |
|---|---|---|---|
| 21-1101 | 10,000.00 | 11-2107 หักค่าเครื่องคืน X | 7,000.00 |
| 21-1102 | 1,000.00 | 11-1201 | 4,000.00 |

| SHOP Dr | | SHOP Cr | |
|---|---|---|---|
| S21-1104 ล้างเจ้าหนี้ค่าเครื่องคืน X | 7,000.00 | S11-3001 | 10,000.00 |
| S11-1201 | 4,000.00 | S11-3002 | 1,000.00 |

หลัง approve: typed DEVICE_RETURN gross ยังเป็น 7,000 (ขาหักไม่ stamp) แต่ `getPendingDeviceReturns` = 0 (Σ POSTED deduction 7,000), `alarmNettingResiduals` residual = 0, `getTypedAccountDrift` = 0, X หลุดคิว; reverse รอบ → X กลับเข้าคิวที่ 7,000

### 6.6 forward-only

แถวยึดที่ลงไปแล้วด้วยแท็ก `SHOP_COLLECT` (ก่อนฟีเจอร์นี้) ล้างทางเดิม (`shop-collect-settlement` + ขา SHOP เมื่อ S21-1104 SHOP_COLLECT คุ้มยอด) — ไม่ย้ายรายการ ไม่ backfill ใบรับคืนย้อนหลัง

## 7. หน้าจอ

| ที่ | เปลี่ยน |
|---|---|
| `/repossessions` (`RepossessionsPage.tsx`) | ส่วนบนใหม่ "ใบรับเครื่องคืน": ปุ่ม "บันทึกรับเครื่องคืน" (ค้นสัญญาด้วยเลขสัญญา/เบอร์/IMEI ผ่าน `GET /device-returns/preview?…` ที่คืน eligibility + kind + valuation + deviationPct) · ตาราง "รอ FINANCE ยืนยัน" (FINANCE เห็นปุ่มยืนยัน/ส่งกลับ + สถานะไลน์ + ปุ่มส่งซ้ำ; สาขาเห็นสถานะ + ยกเลิกใบตัวเอง) · รายการ "รอยึดเครื่อง" ใช้ `GET /device-returns/awaiting-repossession` ปุ่มเป็น "รับเครื่องคืน" |
| ฟอร์มใหม่ `DeviceReturnIntakeDialog` | ข้อมูลสัญญา · ประเภท (ระบบเลือก) · เหตุผล (select 4 ค่า; OTHER บังคับรายละเอียด) · วันที่รับ · เกรด A–D · ราคาประเมิน (ตารางเติมให้ ปรับได้ เตือน ±15% ตามตรรกะ `autoPrice` ของ overlay เดิม) · ค่าซ่อม · หมายเหตุ · กล่อง "สิ่งที่จะเกิดขึ้น": สัญญาหยุดทันที (VOLUNTARY) / แจ้งไลน์ลูกค้า / รอ FINANCE ยืนยัน / ปลด MDM ทำมือ · **ไม่มี**ส่วนบัญชี |
| `RepossessionOverlay.tsx` → โหมดยืนยัน | props `deviceReturnId`; ข้อมูลใบเป็นอ่านอย่างเดียว + สถานะไลน์; ช่องที่แก้ได้: วันที่ลงบัญชี, ส่วนลดยอดปิด; ตาราง JP5 preview (`GET /repossessions/preview/:contractId?deviceReturnId=`); ปุ่ม "ยืนยัน" / "ส่งกลับ" (dialog เหตุผล) · **ถอด**: บัญชีรับเงิน, ช่องติ๊กลูกหนี้-หน้าร้าน, ปุ่มบันทึกรับโอนจากหน้าร้าน (ปุ่มนี้ยังอยู่บนแถวยึดเก่าใน `/repossessions` เมื่อ `shopCollectOutstanding > 0`) |
| `ContractDetailPage.tsx` | ป้าย "รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน DR-…" เมื่อมีใบ `PENDING_CONFIRM` (จาก `GET /device-returns?contractId=`) + ปุ่ม "รับเครื่องคืน" เมื่อสถานะเข้าเกณฑ์และผู้ใช้มีสิทธิ์ |
| `RecordPaymentWizard.tsx` | ถอดชิป `REPO` "คืนเครื่อง" + state `showRepoOverlay` + import overlay |
| หน้าจ่ายให้หน้าร้าน (`interco/PendingTab.tsx`) | รายการ "ค่าเครื่องคืน" + ปุ่มรับเงินสด (6.3) |
| `CustomerTagChips.tsx` | META `RETURNED_DEVICE` label "เคยคืนเครื่อง" |
| `config/menu.ts` | เมนู "ยึดคืนเครื่อง" (4 role) เปลี่ยนป้ายเป็น "รับเครื่องคืน / ยึดคืน" path เดิม |
| แท็บการเดินทาง | label kind `DEVICE_RETURNED` "คืนเครื่อง" |

## 8. กรณีขอบ

- ลูกค้าจ่ายเงินหลังใบเปิด: คิวรับชำระไม่แสดง; webhook PaySolutions บันทึกได้ (เงินตัดจริง) → JP5 อ่าน GL จริง; ยอดค้าง 0 → ยืนยันถูกปฏิเสธ ต้องส่งกลับ
- ช่องว่างข้ามเดือน: `paymentDate` ต้องเดือนปัจจุบัน ⇒ ใบที่สร้าง 30 ก.ย. ยืนยัน 2 ต.ค. ได้ JE/ใบลดหนี้เดือน ต.ค. — **cron รายวัน (09:20 BKK, ใน device-returns) สร้าง Todo `MEDIUM` tag `device-return` ต่อใบที่ `PENDING_CONFIRM` เกิน 3 วัน (dedup ต่อใบ) และ Todo `HIGH` เมื่อเหลือ ≤ 2 วันสิ้นเดือน BKK**
- ส่งกลับหลังปิดงวดเดือนก่อน: accrual ย้อนหลังติด `validatePeriodOpen` → ข้อความผลลัพธ์ของ reject บอกให้เปิดงวด (`PERIOD_REOPENED` flow) ถ้าใบข้ามเดือน
- เครื่องเคยยึดแล้ว (unique เดิม): preview บอกตั้งแต่ค้นสัญญา; งานถอดข้อจำกัดเป็นงานแยก
- รอบจ่ายหักแล้วยอดโอนติดลบ: guard เดิมปฏิเสธ → ใช้รับเงินสด (6.3) หรือรอรอบถัดไป
- ยืนยันสองคนพร้อมกัน: CAS → 409 ไทย; period ปิด → 400 เดิม
- ไม่มีไลน์: `NO_LINE` + Todo; ยืนยันได้
- ใบผิดสัญญา: ส่งกลับ/ยกเลิก → ลูกค้าได้ข้อความ `DEVICE_RETURN_CANCELED`
- MDM: ยังล็อคอยู่ได้ระหว่างรอ — ปลดมือ (กล่องผลลัพธ์เตือน); 5.7 กัน auto-lock ซ้ำ

## 9. สิทธิ์และความปลอดภัย

- `DeviceReturnsController` มี `@UseGuards(JwtAuthGuard, RolesGuard)` ทุก route มี `@Roles`; route รูป `/:id` บังคับขอบเขตสาขาใน service (`BranchGuard` ไม่ครอบ — `.claude/rules/security.md`): BM/SALES อ่านได้เฉพาะใบที่ `receivingBranchId = user.branchId`; ยกเลิกใบได้เฉพาะ BM ของสาขานั้น (SALES สร้างได้แต่ยกเลิกไม่ได้); ไม่มี `branchId` = 403 fail-closed; CROSS_BRANCH_ROLES ผ่าน
- ไม่มี endpoint สาธารณะใหม่; ไม่มี PII ใหม่ในไลน์ (ไม่ส่งเบอร์/เลขบัตร/ราคา)
- AuditLog actions ใหม่ (String): `DEVICE_RETURN_CREATED`, `DEVICE_RETURN_CONFIRMED`, `DEVICE_RETURN_REJECTED`, `DEVICE_RETURN_CANCELED`, `DEVICE_RETURN_LINE_RESENT`, `INTERCO_DEVICE_RETURN_CASH_SETTLED`; reuse `CONTRACT_STATUS_LEGAL` สำหรับ flip/คืนสถานะ; `REPOSSESSION` เดิมยังเขียนใน `createInTx`

## 10. การทดสอบ

- Unit (jest): `device-returns.service.spec.ts` — ด่าน 5.1 ทุกข้อ, derive kind, flip/คืนสถานะ, CAS 409, reject/cancel, สิทธิ์สาขา; `device-return-notify.spec.ts` — SENT/FAILED/NO_LINE + Todo; `device-return-pending.cron.spec.ts` — Todo เกิน 3 วัน (dedup) + ใกล้สิ้นเดือน; `customer-tags.service.spec.ts` — กฎ RETURNED_DEVICE ติด/หลุด; `repossessions.service.spec.ts` — ปรับให้เรียก `createInTx` + deposit 11-2107 DEVICE_RETURN + `branchId`; `shop-collect-shop-legs.template.spec.ts` — ไม่มีสาขา S11-1202; `promise-resolution.cron.spec.ts` — ข้าม autoLock เมื่อมีใบ
- Integration (vitest, DB จริง): `device-returns/__tests__/device-return-flow.integration.spec.ts` — สร้าง→ยืนยัน JE ครบสองสมุด typed DEVICE_RETURN, drift = 0, tag/journey; `interco-settlement/__tests__/interco-device-return.integration.spec.ts` — golden 6.5 + settle-cash + reverse + ปุ่มรับโอนเดิมปฏิเสธ; `interco-aging.integration.spec.ts` — คอลัมน์ใหม่ + reconcile
- Web (vitest): `DeviceReturnIntakeDialog.test.tsx`, `RepossessionOverlay.confirm-mode.test.tsx`, `RecordPaymentWizard` ไม่มีชิป, `PendingTab` รายการที่ 3, `CustomerTagChips` label
- CI (`deploy-gcp.yml`): เพิ่ม glob `src/modules/device-returns/__tests__/*.integration.spec.ts` (glob ไม่ recurse — บทเรียนเดิม); interco glob เดิมครอบไฟล์ใหม่แล้ว

## 11. การนำขึ้นและเอกสาร

- Migrations additive (ช่วง 1: enum + คอลัมน์ `device_return_amount`; ช่วง 2: ตาราง + partial unique + enum + **migration seed แม่แบบไลน์ 2 แถวแบบ idempotent**); prod: `prisma migrate deploy` อย่างเดียว → ไม่ต้อง seed:coa (ไม่มีบัญชีใหม่) ไม่ต้องรัน SQL มือ
- เอกสาร: `.claude/rules/accounting.md` (JP5 ขา Dr = 11-2107 DEVICE_RETURN เสมอ; SHOP_COLLECT เหลือต้นทาง JP4; ตารางประเภท 11-2107 เพิ่มแถว; รอบจ่ายแถวหักที่ 3; ด่านใบรับโอน; ตัวเลขทอง) · `.claude/rules/database.md` (partial unique ใบรับคืน + สถานะเครื่องระหว่างรอ) · `CLAUDE.md` Key Routes/Important Notes · `docs/accounting/cpa-followup-*.txt` เพิ่มย่อหน้า "แจ้งเพื่อทราบ: กรณีที่ 5 ขาเงินสดเป็นลูกหนี้-หน้าร้านแล้วล้างผ่านรอบจ่ายตามแนวกรณีที่ 8 จุดที่ 3"
- ตามคำสั่งเจ้าของ 2026-09-05: ไม่ commit / deploy / PR จนกว่าจะสั่ง

ลำดับการทำ (แผนงานเดียว แบ่งเป็น 3 ช่วง — ช่วง 1 ต้องเสร็จก่อนช่วง 2 เพราะขา JE ประเภทใหม่ต้องมีเลนส์รองรับ ไม่งั้นเกิด ACCOUNT_DRIFT ทันทีที่ยืนยันใบแรก):
1. ประเภท `DEVICE_RETURN` + เลนส์/กระทบยอด + รอบจ่าย INTER-CO + settle-cash + ด่านใบรับโอน (ข้อ 6.2–6.4) พร้อม integration tests
2. refactor `createInTx` + ขาคู่ SHOP + โมดูลใบรับคืน (สร้าง/ยืนยัน/ส่งกลับ/ยกเลิก) + tag/journey + ทวงถาม + ไลน์ + cron เตือน (ข้อ 5, 6.1)
3. หน้าจอ (ข้อ 7) + เอกสาร + SQL แม่แบบ prod

## 12. ที่ยังเปิดอยู่

- ยึดเครื่องเดิมซ้ำ (`Repossession.productId @unique`) — รอเคสจริง
- ส่วนลดยอดปิดของ JP5 ลงบัญชีหรือไม่ — รอผู้สอบ
- ข้อความไลน์เป็นข้อความธรรมดาก่อน; Flex ทำทีหลังผ่านแม่แบบเดียวกัน
- MDM ปลดอัตโนมัติตอนรับคืน — ยังไม่ทำ
