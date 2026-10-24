# ด่าน blacklist ตอนทำสัญญา (ก้อน 5 — C3) — Design Spec

**วันที่:** 2026-10-24 (รอบ 3 — แก้หลัง scrutinize: ด่านสองจุด create + activate · เก็บการปลด SOFT ลงแถวสัญญา · ข้อความใบรับคืนรอยืนยัน · **+ แก้หลัง review ท้ายเอกสาร**) · **ที่มา:** เทียบ Tooltify ข้อ C3 "ตรวจ blacklist อัตโนมัติตอนบันทึกสัญญา" (Tooltify มีเครือข่ายข้ามร้าน — ทำเองไม่ได้ ทำได้เฉพาะตรวจภายในร้าน) · mockup: canvas `MBXL8LNXn7hWzF6ktvL3R5` (v5)

## เจตนา

วันนี้ระบบรู้ว่าลูกค้า "เคยตัดหนี้สูญ / เคยถูกยึดเครื่อง" (tier `BLACKLIST` จาก `customer-tier.service.ts`) และพนักงานติด tag `BLACKLIST` ด้วยมือได้ แต่ **ไม่มีจุดไหนบังคับ** — พนักงานขายเปิดสัญญาให้คนเหล่านี้ได้เงียบ ๆ · คนที่หนียึด (สัญญาถูกบอกเลิกแต่ยังไม่คืนเครื่อง) หลุดทุกด่าน · ผู้จัดการอนุมัติ "ผ่อนซ้อน" ได้โดยไม่มีเหตุผล/ไม่มี audit · และด่านที่มีอยู่ (`assertCustomerContractPolicy`) ตรวจเฉพาะตอนสร้าง**ร่าง** ขณะที่สัญญาเริ่มมีผลจริงตอน**เปิดใช้** (`ContractWorkflowService.activate`) ซึ่งไม่ตรวจอะไรเกี่ยวกับลูกค้าเลย ⇒ สร้างร่าง 2 ใบแล้วเปิดใช้ทั้งคู่ได้. ก้อนนี้ทำให้ระบบ **ตรวจเองทั้งสองจุด** และบอกผลไว้ตั้งแต่ขั้นตรวจเครดิต/แชท.

## คำตัดสินเจ้าของ (23/10 — 3 รอบ AskUserQuestion · 24/10 "ต่อได้เลย" หลัง scrutinize)

| เรื่อง | คำตอบ |
|---|---|
| ระดับการห้าม | **แยก 2 ระดับ**: HARD = ห้ามเด็ดขาด ไม่มีใครปลด (รวม OWNER) · SOFT = ห้าม แต่ OWNER/ผู้จัดการสาขาปลดได้พร้อมเหตุผล |
| **1 คนผ่อนได้ 1 เครื่อง** | มีสัญญาผ่อนอยู่ (`ACTIVE/OVERDUE/DEFAULT`) = HARD · **ถอดช่อง "อนุมัติผ่อนซ้อน" (`overrideActiveContractCheck`) ออก** — ต้องปิดสัญญาเดิมก่อนถึงเปิดใหม่ได้ |
| HARD อื่น ๆ | เคยตัดหนี้สูญ · เคยถูกยึดเครื่อง **รวมเอาเครื่องมาคืนเอง** (`DeviceReturn.returnKind = VOLUNTARY`) · สัญญาถูกบอกเลิกแล้วแต่ยังไม่คืนเครื่อง (`TERMINATED` — หนียึด / ใบรับคืนรอยืนยัน) · tag `BLACKLIST` ที่ติดมือ · เบอร์โทรซ้ำกับคนที่ติด blacklist |
| SOFT | เป็นผู้อ้างอิงของคน blacklist ทั้งสองทาง (ลูกค้าใส่คน blacklist เป็นผู้อ้างอิง / คน blacklist เคยใส่ลูกค้าคนนี้เป็นผู้อ้างอิง — จับคู่ด้วยเบอร์โทร) |
| จุดตรวจ | ตอนบันทึกร่างสัญญา **และตอนเปิดใช้สัญญา** (ด่านที่ API — รอบ 3) · หน้าตรวจเครดิต + แผงแชท (แสดงผล) |
| ใครปลด SOFT | OWNER + ผู้จัดการสาขา ต้องใส่เหตุผล (บันทึกลงร่างสัญญา + audit) |
| SALES เห็นอะไร | เห็นระดับ + เหตุผล + **ชื่อคนที่จับคู่ได้** (ไม่เห็นเบอร์/เลขบัตรของคนนั้น) |
| ไม่ทำ | POS ขายสด/ไฟแนนซ์นอก · รับซื้อ/รับเทิร์น · เครือข่ายข้ามร้าน · auto-tag |

หมายเหตุ: ข้อ "ค้างชำระเกิน 60 วัน" ที่เคยเลือกไว้ **ถูกกลืนโดยกติกา 1 คน 1 เครื่อง** (ค้างได้ก็ต่อเมื่อมีสัญญาผ่อนอยู่ ซึ่ง HARD อยู่แล้ว) จึงไม่มี reason แยก.

**คำตัดสินผม (รอบ 3 — เจ้าของสั่ง "ต่อได้เลย" โดยไม่ตอบแยก):** ทุกเหตุผลอ่านจาก**สถานะปัจจุบัน** — สัญญา `TERMINATED` ที่ลูกค้าจ่ายครบจนกลายเป็น `COMPLETED` (`checkContractCompletion` ไม่ดูสถานะเดิม; ทางใช้เครดิต/ลิงก์ชำระรับเงินสัญญา TERMINATED ได้) = พ้น HARD ข้อนั้นเอง และหลุดจาก set (คนที่อ้างอิงเขาเลิกเป็น SOFT ด้วย) · ส่งกลับ/ยกเลิกใบรับคืนแบบคืนเอง (คืนสถานะเดิม) = เหตุผลสลับเป็น `ACTIVE_CONTRACT` · ถ้าเจ้าของอยากให้ "เคยหนียึด" ติดถาวร ต้องอ่าน AuditLog `CONTRACT_STATUS_LEGAL` แทน — ไม่ทำในก้อนนี้.

## นิยาม "คนที่ติด blacklist" (`BlacklistedCustomerSet` — ใช้จับคู่เบอร์/ผู้อ้างอิง)

ลูกค้า (รวมที่ถูก soft-delete — ประวัติไม่หายเพราะลบ) ที่เข้าข้อใดข้อหนึ่ง:
1. มีสัญญาสถานะ `CLOSED_BAD_DEBT` หรือ `TERMINATED` (`deletedAt: null`)
2. มีแถว `Repossession` (ผ่าน `contract.customerId`) ที่ไม่ถูกลบ
3. มี `CustomerTag` `tag = BLACKLIST` ที่ `deletedAt: null`

`DEFAULT` **ไม่อยู่ใน set** — เป็นสัญญาที่ยังเดิน (ค้าง 2 งวดติด, `overdue-lifecycle-cron`) ⇒ ตัวลูกค้าเองโดน HARD จากกติกา 1 คน 1 เครื่อง แต่ไม่ถือว่า "ติด blacklist" สำหรับจับคู่คนอื่น. **แถวแฝดจากการรวมลูกค้า** (`Customer.mergedIntoId` ชี้มาที่คนที่กำลังประเมิน หรือกลับกัน) ถูกตัดออกจากการจับคู่ — ไม่ให้ชี้ชื่อตัวเอง.

## ผลการประเมินต่อลูกค้า 1 คน

`CustomerBlacklistService.evaluate(customerId, db = this.prisma) → CustomerBlacklistResult` · `evaluateMany(ids, db?) → Record<id, CustomerBlacklistResult>` (โหลด set + hash เบอร์ครั้งเดียว) · โมดูลใหม่ `CustomerBlacklistModule` (`apps/api/src/modules/customers/customer-blacklist.module.ts` — imports `PrismaModule` + `CustomerPiiModule` เท่านั้น แบบเดียวกับ `CustomerPiiModule`) export ให้ `CustomersModule` (endpoint) และ `ContractsModule` (ด่าน) import — ไม่มี cycle (ContractsModule ไม่ได้ import CustomersModule และ CustomersModule import CreditCheckModule ซึ่งย้อน import CustomersModule อยู่แล้ว).

```ts
type BlacklistLevel = 'NONE' | 'SOFT' | 'HARD';
type BlacklistReasonCode =
  | 'ACTIVE_CONTRACT' | 'BAD_DEBT' | 'REPOSSESSED' | 'TERMINATED_UNRETURNED' | 'MANUAL_TAG' | 'PHONE_MATCH' // HARD
  | 'REFERENCES_BLACKLISTED' | 'REFERENCED_BY_BLACKLISTED';                                                   // SOFT
interface BlacklistReason { code: BlacklistReasonCode; level: 'HARD' | 'SOFT'; message: string;
  contractNumber?: string | null; related?: { customerId: string; name: string } | null }
interface CustomerBlacklistResult { level: BlacklistLevel; reasons: BlacklistReason[]; checkedAt: string }
```

- `level` = HARD ถ้ามี reason HARD ≥1 · ไม่งั้น SOFT · ไม่งั้น NONE. ใส่ทุก reason ที่เข้า (ไม่หยุดที่ข้อแรก).
- **HARD (ของตัวลูกค้าเอง)**
  - `ACTIVE_CONTRACT` — มีสัญญา `ACTIVE/OVERDUE/DEFAULT` (`deletedAt: null`) · `มีสัญญาผ่อนอยู่ {เลข} ({สถานะ}) — 1 คนผ่อนได้ 1 เครื่อง ต้องปิดสัญญาเดิมก่อน` (DEFAULT ใช้คำว่า "ผิดนัด") · **ไม่นับ `DRAFT`** (ร่างพี่น้องถูกกันที่ด่าน activate แทน — หัวข้อถัดไป)
  - `TERMINATED_UNRETURNED` — มีสัญญา `TERMINATED` ที่ยังไม่มีแถว `Repossession` · ข้อความแยกสองแบบด้วย `DeviceReturn` `status: PENDING_CONFIRM, deletedAt: null` ของสัญญานั้น (นิยามเดียวกับคิว "รอยึดเครื่อง" `DeviceReturnsService.awaitingRepossession`): **ไม่มีใบ** → `สัญญา {เลข} ถูกบอกเลิกแล้วแต่ยังไม่ได้รับเครื่องคืน` · **มีใบรอยืนยัน** → `สัญญา {เลข} รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน (ใบ {DR-เลข})` — HARD ทั้งคู่
  - `REPOSSESSED` — มี `Repossession` · ข้อความตาม `Repossession.deviceReturn.returnKind`: `VOLUNTARY` → `เคยเอาเครื่องมาคืนเอง (สัญญา {เลข} · {วันที่})` · อื่น/ไม่มีใบรับคืน → `เคยถูกยึดเครื่อง (สัญญา {เลข} · {วันที่})` · วันที่ = `deviceReturn.deviceReceivedAt ?? repossession.createdAt`
  - `BAD_DEBT` — สัญญา `CLOSED_BAD_DEBT` **ที่ไม่มีแถว Repossession** (JP5 ตอนยึดก็ตั้ง `CLOSED_BAD_DEBT` — ไม่รายงานซ้ำกับ `REPOSSESSED`) · `เคยถูกตัดเป็นหนี้สูญ (สัญญา {เลข})`
  - `MANUAL_TAG` — `ติด tag blacklist โดย {appliedBy.name} {วันที่}: {reason}` (reason ว่าง = ไม่มีส่วนท้าย · ไม่มีผู้ติด = "โดยระบบ")
  - `PHONE_MATCH` — เบอร์หลักของลูกค้าตรงกับสมาชิก set คนอื่น: เทียบ `phoneHash` **และ** `normalizeThaiPhone(phone)` plaintext (แถวเก่าอาจไม่มี hash — database.md; `CustomerPiiService.hash()` คืน null เมื่อไม่มี `PII_HASH_SALT`) · `เบอร์โทรตรงกับ {ชื่อ} ที่ติด blacklist` · **เลขบัตร**: `nationalIdHash`/`nationalId` เป็น `@unique` ทั้งตาราง (รวมแถวที่ลบ) — สร้างลูกค้าใหม่เลขเดิมจะได้แถวเดิมกลับมา (`reviveGhostId`) ซึ่งถือประวัติอยู่แล้ว ⇒ ไม่ต้องตรวจเพิ่ม
- **SOFT**
  - `REFERENCES_BLACKLISTED` — `references[].phone` ของลูกค้า (ถอดรหัสผ่าน `CustomerPiiService.decryptCustomerFields`) normalize แล้วตรงกับเบอร์หลักของสมาชิก set (hash หรือ plaintext) · `ผู้อ้างอิง "{ชื่อในช่อง}" คือ {ชื่อลูกค้า} ที่ติด blacklist`
  - `REFERENCED_BY_BLACKLISTED` — สมาชิก set คนใดมี `references[].phone` ตรงกับเบอร์หลัก/เบอร์สำรองของลูกค้า · `{ชื่อ} ที่ติด blacklist เคยใส่ลูกค้าคนนี้เป็นผู้อ้างอิง`
- ไม่มีเบอร์/ไม่มีผู้อ้างอิง/ถอดรหัสไม่ได้ (ไม่มีกุญแจ PII) → ข้ามข้อนั้นเงียบ ๆ
- **ประสิทธิภาพ (คำตัดสินผม):** โหลด set ทั้งก้อนครั้งเดียวต่อการประเมิน (`id, name, phone, phoneSecondary, phoneHash, phoneEncrypted, references, referencesEncrypted, mergedIntoId, deletedAt`) · ถอดรหัส `references*` เฉพาะสมาชิกที่คอลัมน์ไม่ว่าง · คำนวณ hash เบอร์ของลูกค้าที่ประเมินครั้งเดียว · ไม่คำนวณ tier ของทุกคน · set โตทางเดียว — ถ้าเกินหลักพันค่อยทำ index/cache (ยังไม่ทำ)
- **เรียกนอก tx** ของการสร้าง/เปิดใช้สัญญา (แบบเดียวกับ `testModeOn`) — ลด predicate lock บน Serializable tx; ส่วน `ACTIVE_CONTRACT` มีตาข่ายใน tx ซ้ำ (ด้านล่าง). ยอมรับช่องว่างเล็กมากที่ tag ถูกติดระหว่างตรวจกับ commit (คำตัดสินผม)
- **โหมดทดสอบ (`isTestModeEnabled`) ไม่ข้ามด่านนี้** — ข้ามเฉพาะด่านเครดิตตามเดิม (เจ้าของ: ห้ามเด็ดขาด)

## ด่านที่ API — สองจุด

### จุดที่ 1 `ContractLifecycleService.create()` (สร้างร่าง) — ก่อนเปิด `$transaction`
- ประเมิน → `HARD` → `ConflictException({ code: 'CUSTOMER_BLACKLISTED', level: 'HARD', reasons, message: 'ลูกค้าติด blacklist ไม่สามารถทำสัญญาได้' })` ทุกบทบาท
- `SOFT` ไม่มี `dto.blacklistOverrideReason` → `ConflictException({ code: 'CUSTOMER_BLACKLIST_REVIEW', level: 'SOFT', reasons, canOverride, message: 'ลูกค้ามีประวัติที่ต้องให้ผู้จัดการอนุมัติก่อนทำสัญญา' })` (`canOverride` = role ∈ OWNER, BRANCH_MANAGER)
- `SOFT` + `blacklistOverrideReason` (trim 10–500 ตัว) + role OWNER/BM → ผ่าน · **เขียนลงแถวสัญญาใน tx เดียวกับการสร้าง**: `blacklistOverrideReason`, `blacklistOverriddenById = actor.id`, `blacklistOverriddenAt = now` · หลัง commit `AuditLog { action: 'CONTRACT_BLACKLIST_OVERRIDDEN', entity: 'contract', entityId, userId, newValue: { customerId, level: 'SOFT', reasons, overrideReason } }` ผ่าน `AuditService.log` **หลัง tx** (database.md) · บทบาทอื่นส่งเหตุผลมาก็ยัง 409 ตัวเดิม · `NONE` + ส่งเหตุผลมา = ไม่เก็บ (ไม่มีอะไรให้ปลด)
- ใน tx: `assertCustomerContractPolicy(tx, customerId)` คงไว้เป็นตาข่ายชั้นสุดท้าย แต่ **ตัดพารามิเตอร์ role/override ทิ้ง** (fail-closed เสมอ) · DTO ถอด `overrideActiveContractCheck` ทั้ง `contract.dto.ts` และสำเนาที่ไม่มีผู้อ่านใน `sales/dto/sale.dto.ts` (client เก่าที่ส่งมาถูก whitelist ตัด)
- DTO: `CreateContractDto.blacklistOverrideReason?: string` (`@IsOptional() @IsString() @Length(10, 500, { message: 'กรุณาระบุเหตุผล 10–500 ตัวอักษร' })`)

### จุดที่ 2 `ContractWorkflowService.activate()` (เปิดใช้ — จุดที่สัญญาเริ่มมีผล) — ก่อนเปิด `$transaction` ของมัน
- เหตุผล: `create()` เขียน `status: 'DRAFT'` และ `ACTIVE_CONTRACT` ไม่นับ DRAFT ⇒ ร่าง 2 ใบผ่านทั้งคู่ · `activate()` วันนี้ตรวจ approval/DRAFT/PDPA/hash/ลายเซ็น/สินค้า/เครดิต แต่ไม่ดูสัญญาอื่นของลูกค้าหรือ blacklist · ร่างสร้างก่อนลูกค้าติด tag/ถูกบอกเลิกก็เปิดใช้ได้
- ประเมิน → `HARD` → 409 `CUSTOMER_BLACKLISTED` (ข้อความเดิม + `reasons`) — รวม `ACTIVE_CONTRACT` จากร่างพี่น้องที่เปิดใช้ไปก่อน
- `SOFT`: ผ่านเมื่อแถวสัญญามี `blacklistOverriddenAt` (ปลดไว้ตอนสร้าง) · ไม่มี → 409 `CUSTOMER_BLACKLIST_REVIEW` ข้อความ `ลูกค้ามีประวัติที่ต้องให้ผู้จัดการอนุมัติ (เกิดหลังสร้างร่าง) — ให้ OWNER/ผู้จัดการสาขาลบร่างนี้แล้วสร้างสัญญาใหม่พร้อมอนุมัติ` (ทางที่มีจริง: `DELETE /contracts/:id` ลบร่าง · `activate(id)` ไม่มี actor และ FINANCE_MANAGER ที่เปิดใช้ได้ไม่ใช่บทบาทที่ปลด — คำตัดสินผม: ไม่เพิ่ม endpoint ปลดบนร่างในก้อนนี้ เคสนี้หายาก)
- ใน tx (หลัง `lockCreditCustomer`): `assertCustomerContractPolicy(tx, current.customerId)` fail-closed — ตาข่าย race ร่างสองใบเปิดใช้พร้อมกัน (ล็อกแถวลูกค้า `FOR NO KEY UPDATE` ทำให้เรียงกัน ใบหลังเห็น ACTIVE ของใบแรก)
- ทางสร้าง/เปิดใช้ที่ไม่ผ่านสองจุดนี้ (เปลี่ยนเครื่อง `contract-exchange.service.ts` / `defect-exchange.service.ts` / `migration.service.ts`) **ไม่เข้าด่าน** — ลูกค้าคนเดิมบนสัญญาที่ผ่อนอยู่ (สัญญาใหม่ของเปลี่ยนเครื่องเปิดใช้ผ่าน `activate()` ตัวเดียวกัน ⇒ จะเจอ `ACTIVE_CONTRACT` ของสัญญาเดิม — ต้อง**ข้ามด่าน blacklist เมื่อ `exchangedFromContractId` มีค่า** (ตัวแปร `isExchangeContract` ที่มีอยู่แล้ว))

### Schema
`Contract` เพิ่ม `blacklistOverrideReason String? @map("blacklist_override_reason")` · `blacklistOverriddenById String? @map("blacklist_overridden_by_id")` (relation `ContractBlacklistOverriddenBy` → User, `onDelete: SetNull`) · `blacklistOverriddenAt DateTime? @map("blacklist_overridden_at")` — migration `20261102000000_contract_blacklist_override` (additive, nullable). `projectContract`/read policy ไม่ต้องซ่อน (ไม่ใช่ PII).

## endpoint อ่านผล

- `GET /customers/:id/blacklist` → `CustomerBlacklistResult`
- `GET /customers/blacklist?ids=a,b,c` (≤100) → `Record<customerId, CustomerBlacklistResult>` สำหรับตาราง
- roles OWNER/BRANCH_MANAGER/FINANCE_MANAGER/ACCOUNTANT/SALES · วางใน `CustomersController` ก่อน route `:id` (มี static route ก่อน `:id` อยู่แล้ว เช่น `search`) · controller รับ `CustomerBlacklistService` ตรง (ห้ามเรียก Prisma จาก controller)

## Web

- **หน้าสร้างสัญญา ขั้นเลือกลูกค้า**: hook `useContractCreateData` ดึง `['customer-blacklist', id]` เมื่อเลือกลูกค้า (คู่กับ `['customer-latest-credit', id]` เดิม) และคำนวณ `canNext()` (ไฟล์ `hooks/useContractCreateData.ts` + ปุ่มใน `ContractCreatePage/index.tsx`) **fail-closed**: `query.isSuccess && level !== 'HARD' && (level !== 'SOFT' || (overrideAccepted && reason.trim().length >= 10))` — โหลดอยู่/error = ปิด · error แสดงกล่องเทา "โหลดผลตรวจ blacklist ไม่ได้" + ปุ่ม "ลองใหม่" (`refetch`) · `CustomerSelectStep` รับ `blacklist`, `blacklistStatus` (`'loading'|'error'|'ready'`), `onRetry`, `overrideReason`, `setOverrideReason`, `overrideAccepted`, `setOverrideAccepted` แทน `overrideActiveContractCheck`:
  - `HARD`: กล่องแดง (`border-destructive/30 bg-destructive/5`, `role="alert"`) ไอคอน `ShieldBan` หัว "ห้ามทำสัญญา — ลูกค้าติด blacklist" + รายการเหตุผล (ไอคอนต่อ code · ชื่อคนที่จับคู่เป็นลิงก์ `/customers/:id`) + "ไม่มีการอนุมัติข้าม" + ทางออกตามบทบาท (OWNER/FINANCE_MANAGER: "ถอด tag ได้ที่หน้าลูกค้า" เฉพาะเมื่อมี `MANUAL_TAG` · อื่น: "ติดต่อเจ้าของ/ผู้จัดการการเงิน") · ปุ่ม "ถัดไป" ปิด
  - `SOFT`: กล่องส้ม (`border-warning/40 bg-warning/10`, `role="alert"`) ไอคอน `ShieldAlert` หัว "ต้องให้ผู้จัดการอนุมัติก่อนทำสัญญา" + เหตุผล · OWNER/BM: checkbox "อนุมัติทำสัญญาทั้งที่มีประวัติ (ในฐานะ …)" + `Textarea` เหตุผล (≥10 ตัว แสดงตัวนับ) · SALES: "กรุณาติดต่อผู้จัดการสาขาเพื่ออนุมัติ" · "ถัดไป" เปิดเมื่อติ๊ก + เหตุผลครบ
  - `NONE`: ไม่แสดง
  - แบนเนอร์ "ลูกค้ายังมีสัญญาที่กำลังผ่อนอยู่" + checkbox อนุมัติผ่อนซ้อนเดิม **ถอดออก** (กลายเป็น reason `ACTIVE_CONTRACT` ในกล่องแดง)
  - payload แนบ `blacklistOverrideReason` เมื่อติ๊ก · 409 `CUSTOMER_BLACKLISTED`/`CUSTOMER_BLACKLIST_REVIEW` ตอนสร้าง → toast + กลับขั้นเลือกลูกค้า + `refetch` (ใส่ใน effect เดียวกับ `CONTRACT_QUOTE_CHANGED` ใน `index.tsx`)
  - ตอนเปิดใช้ (หน้ารายละเอียดสัญญา ปุ่ม "เปิดใช้สัญญา"): 409 สองโค้ดนี้ → toast ข้อความจาก server (มี `reasons[].message` ต่อท้ายบรรทัดละข้อ) — ไม่มี UI ใหม่
- **ป้าย** `CustomerBlacklistBadge` (`components/customer/`): `HARD` = `Badge variant="destructive"` ไอคอน + "ติด blacklist · ห้ามทำสัญญา" · `SOFT` = `variant="warning"` + "ต้องให้ผู้จัดการอนุมัติ" · `NONE` = null · กดขยายเหตุผล (`aria-expanded`) ใช้รายการเดียวกับหน้าสัญญา. วางที่:
  - `/credit-checks` (`CreditChecksPage.tsx`) ใต้ชื่อลูกค้าในแถว — ดึง batch ตาม `row.customer.id` ที่แสดงในหน้า
  - หน้าลูกค้า `CustomerDetailPage` `DetailHeader` ข้าง `CustomerTierBadge` (แสดงผลใบเดียว) — และเปลี่ยนป้าย tier `BLACKLIST` ใน `types/customer-tier.ts` จาก "ห้ามทำสัญญา" เป็น "ประวัติเสีย" เพื่อไม่ให้สองป้ายขัดกัน (คำตัดสินผม — tier ไม่รวม `TERMINATED` จึงอาจโชว์ RISKY ข้างป้าย HARD ได้ ยอมรับ)
  - แผงแชท `pages/UnifiedInboxPage/components/RoomDossier.tsx` ส่วนหัวลูกค้า (เมื่อ `customerId` มี)
  - `CreditTab`/`CreditCheckCard`: ไม่ต้อง (หัวหน้าลูกค้ามีแล้ว)

## ความปลอดภัย / PII

ไม่มี endpoint สาธารณะ · เหตุผลมีชื่อคนที่จับคู่ แต่ไม่มีเบอร์/เลขบัตร · ถอดรหัส references ฝั่ง API เท่านั้น · audit และคอลัมน์บนสัญญาเก็บ reasons + เหตุผลผู้จัดการ (ไม่มีเบอร์)

## เทสต์

API: `customer-blacklist.service.spec.ts` (ทุก reason code · VOLUNTARY vs ยึด · ใบรับคืนรอยืนยัน vs หนียึด · BAD_DEBT ไม่ซ้ำ REPOSSESSED · level · ข้ามเมื่อไม่มีเบอร์/กุญแจ · ไม่จับคู่ตัวเอง/แฝด merge · set รวมลูกค้าที่ถูกลบ · plaintext fallback · `evaluateMany`) · lifecycle spec (HARD 409 ทุก role · SOFT 409 ไม่มีเหตุผล · SOFT ผ่าน + คอลัมน์ + audit หลัง tx · SALES ส่งเหตุผล = 409 · `overrideActiveContractCheck` ไม่มีผลอีก · test mode ไม่ข้าม) · workflow spec (activate: HARD 409 · SOFT ไม่มี override 409 · SOFT มี override ผ่าน · exchange ข้ามด่าน) · controller/DTO · **integration บน PostgreSQL ชั่วคราว** (`tools/test-chat-credit.sh` — `credit-payment-flow` suite มีสัญญาจริง): ร่าง 2 ใบ → เปิดใช้ใบแรกผ่าน ใบสอง 409 · ยึดเครื่องจริง → เปิดใหม่ 409 · TERMINATED → 409 · TERMINATED จ่ายครบ → COMPLETED → NONE · ผู้อ้างอิงจับคู่ผ่านเบอร์ที่เข้ารหัสจริง · seed ชื่อห้ามมีตัวเลข (บทเรียน `generateSaleNumber`)
Web: `CustomerSelectStep` (HARD ปิดปุ่ม/ไม่มี checkbox · SOFT OWNER ติ๊ก+เหตุผล · SOFT SALES ข้อความติดต่อ · error + ลองใหม่ · payload) · `useContractCreateData.canNext` (loading/error = false) · `CustomerBlacklistBadge` 3 ระดับ · `CreditChecksPage` batch · `RoomDossier`

## นอกขอบเขต

POS · รับซื้อ/เทิร์น · เครือข่ายข้ามร้าน · auto-tag · จับคู่ด้วยชื่อ · เบอร์สำรองของสมาชิก set (ไม่มี hash) · เตือนตอนสร้าง/แก้ลูกค้า · endpoint ปลด SOFT บนร่างที่สร้างไปแล้ว · ประวัติ "เคยหนียึด" ถาวรหลังจ่ายครบ

## แก้หลัง review ทั้งสาขา (2026-10-24 — reviewer ชุดสด: C1 + I1–I3)

1. **สัญญาทดแทนจากเปลี่ยนเครื่องตำหนิ 7 วัน ข้ามด่านตอน activate** — `defect-exchange.service.ts` สร้างสัญญาทดแทนด้วย `parentContractId` (ไม่ใช่ `exchangedFromContractId`) แล้วเปิดใช้ผ่าน `activate()` ตามปกติ ⇒ spec เดิมเข้าใจผิดว่าไม่เข้าด่าน. ตอนนี้ `activate()` ข้ามด่าน blacklist + ตาข่าย `assertCustomerContractPolicy` เมื่อ `parentContractId` ชี้สัญญาที่ `status = DEFECT_EXCHANGED` (ต่อเนื่องจากสัญญาเดิมของลูกค้าคนเดิม — ตรรกะเดียวกับเปลี่ยนเครื่อง) · parent สถานะอื่น = ไม่ข้าม (**คำตัดสินผม** ตามข้อเสนอ reviewer — ไม่งั้นเงินลูกค้าค้างใน 21-1106 โดยไม่มีทางไปต่อ)
2. **ปลด SOFT ได้ตอนเปิดใช้ด้วย** — `activate(id, actorId?, { actorRole?, blacklistOverrideReason? })`: ไม่มี `blacklistOverriddenAt` → OWNER/BM ส่งเหตุผล (`ActivateContractDto.blacklistOverrideReason` ใน body `POST /contracts/:id/activate`) ⇒ เขียน `blacklistOverride*` ตอน update เป็น ACTIVE + audit `CONTRACT_BLACKLIST_OVERRIDDEN` (`stage: 'ACTIVATE'`) หลัง commit · ไม่ส่ง → 409 REVIEW `canOverride` ตามบทบาท ข้อความ "กรอกเหตุผลเพื่ออนุมัติแล้วเปิดใช้สัญญา" / บทบาทที่ปลดไม่ได้ (FM) "ให้ OWNER/ผู้จัดการสาขาเป็นผู้เปิดใช้สัญญาพร้อมเหตุผล" · เหตุผล: ร่างที่อนุมัติ/ลงนามแล้ว**ลบไม่ได้** (`softDelete` รับเฉพาะ CREATING/REJECTED · `DELETE /contracts/:id` = OWNER เท่านั้น) ข้อความเดิม "ลบร่างแล้วสร้างใหม่" จึงชี้ทางที่ไม่มีจริง และ `activate` มี actor อยู่แล้ว (controller ส่ง `user.id`) — ความเข้าใจเดิมในรอบ 3 ผิด · web: หน้ารายละเอียดสัญญาเปิด `BlacklistOverrideDialog` (กล่องเดียวกับ SOFT ในขั้นเลือกลูกค้า — reasons + Textarea ≥10 + "อนุมัติและเปิดใช้สัญญา") เมื่อ 409 REVIEW `canOverride: true` · **UI ชิ้นนี้ไม่ได้ผ่าน mockup ก่อน** (reuse แบบที่เคาะแล้ว) — แจ้งเจ้าของ
3. **`PHONE_MATCH` ใช้ `phoneHash` ที่เก็บไว้เฉพาะเมื่อแถวไม่มีเบอร์ plaintext** — แถว hash ค้างจากบั๊ก skip-tracing เดิม (database.md / `findLivePhoneOwner`) ต้องไม่ทำให้คนที่ถือเบอร์นั้นตอนนี้ถูกห้ามถาวร
4. **กล่องแดง HARD ที่มี `MANUAL_TAG`**: OWNER/FINANCE_MANAGER ได้ปุ่ม "ถอด tag" เปิด `CustomerTagDialog` (ตัวจริงจาก CollectionsPage) ตรงนั้น ปิดแล้ว refetch — ลิงก์เดิมไป `/customers/:id` ซึ่งไม่มีปุ่มถอด tag ถูกถอด

Minor ที่ reviewer ยกและ**ยังไม่แก้** (บันทึกใน ledger/PR): ถอดรหัส references ล้ม = ข้ามทั้งคน (ควรข้ามเฉพาะส่วน references) · `staleTime: 0` บนป้ายแชท/หัวหน้าลูกค้า · `/credit-checks` size=200 เกิน batch 100 · DTO `@Length` ไม่ trim · `GET /customers/:id/blacklist` id ไม่มี = NONE · กล่องกระพริบตอน refetch · query set สาขา `repossession.is`/`tags.some` ยังไม่มี e2e · `MANUAL_TAG.message` ต่อ reason free text (PII ที่พนักงานพิมพ์เองอาจรั่วถึง SALES) · `useCallback` deps ไม่มีผล

