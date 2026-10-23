# ด่าน blacklist ตอนทำสัญญา (ก้อน 5 — C3) — Design Spec

**วันที่:** 2026-10-23 (แก้หลัง builder-check + คำตอบเจ้าของรอบ 2) · **ที่มา:** เทียบ Tooltify ข้อ C3 "ตรวจ blacklist อัตโนมัติตอนบันทึกสัญญา" (Tooltify มีเครือข่ายข้ามร้าน — ทำเองไม่ได้ ทำได้เฉพาะตรวจภายในร้าน) · mockup: canvas `MBXL8LNXn7hWzF6ktvL3R5`

## เจตนา

วันนี้ระบบรู้ว่าลูกค้า "เคยตัดหนี้สูญ / เคยถูกยึดเครื่อง" (tier `BLACKLIST` จาก `customer-tier.service.ts`) และพนักงานติด tag `BLACKLIST` ด้วยมือได้ แต่ **ไม่มีจุดไหนบังคับ** — พนักงานขายเปิดสัญญาให้คนเหล่านี้ได้เงียบ ๆ · คนที่หนียึด (สัญญาถูกบอกเลิกแต่ยังไม่คืนเครื่อง) หลุดทุกด่าน · ผู้จัดการอนุมัติ "ผ่อนซ้อน" ได้โดยไม่มีเหตุผล/ไม่มี audit. ก้อนนี้ทำให้ระบบ **ตรวจเอง ณ จุดทำสัญญา** และบอกผลไว้ตั้งแต่ขั้นตรวจเครดิต/แชท.

## คำตัดสินเจ้าของ (23/10 — 3 รอบ AskUserQuestion)

| เรื่อง | คำตอบ |
|---|---|
| ระดับการห้าม | **แยก 2 ระดับ**: HARD = ห้ามเด็ดขาด ไม่มีใครปลด (รวม OWNER) · SOFT = ห้าม แต่ OWNER/ผู้จัดการสาขาปลดได้พร้อมเหตุผล |
| **1 คนผ่อนได้ 1 เครื่อง** | มีสัญญาผ่อนอยู่ (`ACTIVE/OVERDUE/DEFAULT`) = HARD · **ถอดช่อง "อนุมัติผ่อนซ้อน" (`overrideActiveContractCheck`) ออก** — ต้องปิดสัญญาเดิมก่อนถึงเปิดใหม่ได้ |
| HARD อื่น ๆ | เคยตัดหนี้สูญ · เคยถูกยึดเครื่อง **รวมเอาเครื่องมาคืนเอง** (`DeviceReturn.returnKind = VOLUNTARY`) · สัญญาถูกบอกเลิกแล้วแต่ยังไม่คืนเครื่อง (`TERMINATED` — หนียึด / ใบรับคืนรอยืนยัน) · tag `BLACKLIST` ที่ติดมือ · เบอร์โทรซ้ำกับคนที่ติด blacklist |
| SOFT | เป็นผู้อ้างอิงของคน blacklist ทั้งสองทาง (ลูกค้าใส่คน blacklist เป็นผู้อ้างอิง / คน blacklist เคยใส่ลูกค้าคนนี้เป็นผู้อ้างอิง — จับคู่ด้วยเบอร์โทร) |
| จุดตรวจ | ตอนบันทึกสัญญาผ่อน (ด่านที่ API) · หน้าตรวจเครดิต + แผงแชท (แสดงผล) |
| ใครปลด SOFT | OWNER + ผู้จัดการสาขา ต้องใส่เหตุผล (บันทึก audit) |
| SALES เห็นอะไร | เห็นระดับ + เหตุผล + **ชื่อคนที่จับคู่ได้** (ไม่เห็นเบอร์/เลขบัตรของคนนั้น) |
| ไม่ทำ | POS ขายสด/ไฟแนนซ์นอก · รับซื้อ/รับเทิร์น · เครือข่ายข้ามร้าน · auto-tag |

หมายเหตุ: ข้อ "ค้างชำระเกิน 60 วัน" ที่เคยเลือกไว้ **ถูกกลืนโดยกติกา 1 คน 1 เครื่อง** (ค้างได้ก็ต่อเมื่อมีสัญญาผ่อนอยู่ ซึ่ง HARD อยู่แล้ว) จึงไม่มี reason แยก.

## นิยาม "คนที่ติด blacklist" (`BlacklistedCustomerSet` — ใช้จับคู่เบอร์/ผู้อ้างอิง)

ลูกค้า (รวมที่ถูก soft-delete — ประวัติไม่หายเพราะลบ) ที่เข้าข้อใดข้อหนึ่ง:
1. มีสัญญาสถานะ `CLOSED_BAD_DEBT` หรือ `TERMINATED` (`deletedAt: null`)
2. มีแถว `Repossession` (ผ่าน `contract.customerId`) ที่ไม่ถูกลบ
3. มี `CustomerTag` `tag = BLACKLIST` ที่ `deletedAt: null`

`DEFAULT` **ไม่อยู่ใน set** — เป็นสัญญาที่ยังเดิน (ค้าง 2 งวดติด, `overdue-lifecycle-cron`) ⇒ ตัวลูกค้าเองโดน HARD จากกติกา 1 คน 1 เครื่อง แต่ไม่ถือว่า "ติด blacklist" สำหรับจับคู่คนอื่น.

## ผลการประเมินต่อลูกค้า 1 คน

`CustomerBlacklistService.evaluate(customerId, db = this.prisma) → CustomerBlacklistResult`

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
  - `ACTIVE_CONTRACT` — มีสัญญา `ACTIVE/OVERDUE/DEFAULT` · `มีสัญญาผ่อนอยู่ {เลข} ({สถานะ}) — 1 คนผ่อนได้ 1 เครื่อง ต้องปิดสัญญาเดิมก่อน` (DEFAULT ใช้คำว่า "ผิดนัด")
  - `TERMINATED_UNRETURNED` — มีสัญญา `TERMINATED` · `สัญญา {เลข} ถูกบอกเลิกแล้วแต่ยังไม่ได้รับเครื่องคืน`
  - `REPOSSESSED` — มี `Repossession` · ข้อความตาม `Repossession.deviceReturn.returnKind`: `VOLUNTARY` → `เคยเอาเครื่องมาคืนเอง (สัญญา {เลข} · {วันที่})` · อื่น/ไม่มีใบรับคืน → `เคยถูกยึดเครื่อง (สัญญา {เลข} · {วันที่})`
  - `BAD_DEBT` — สัญญา `CLOSED_BAD_DEBT` **ที่ไม่มีแถว Repossession** (JP5 ตอนยึดก็ตั้ง `CLOSED_BAD_DEBT` — ไม่รายงานซ้ำกับ `REPOSSESSED`) · `เคยถูกตัดเป็นหนี้สูญ (สัญญา {เลข})`
  - `MANUAL_TAG` — `ติด tag blacklist โดย {ชื่อผู้ติด} {วันที่}: {reason}` (reason ว่าง = ไม่มีส่วนท้าย)
  - `PHONE_MATCH` — เบอร์หลักของลูกค้าตรงกับสมาชิก set คนอื่น: เทียบ `phoneHash` **และ** `normalizeThaiPhone(phone)` plaintext (แถวเก่าอาจไม่มี hash — database.md) · `เบอร์โทรตรงกับ {ชื่อ} ที่ติด blacklist` · **เลขบัตร**: `nationalIdHash`/`nationalId` เป็น `@unique` ทั้งตาราง (รวมแถวที่ลบ) — สร้างลูกค้าใหม่เลขเดิมจะได้แถวเดิมกลับมา (`reviveGhostId`) ซึ่งถือประวัติอยู่แล้ว ⇒ ไม่ต้องตรวจเพิ่ม
- **SOFT**
  - `REFERENCES_BLACKLISTED` — `references[].phone` ของลูกค้า (ถอดรหัสผ่าน `CustomerPiiService` · `REFERENCE_PII_FIELDS`) normalize แล้วตรงกับเบอร์หลักของสมาชิก set (hash หรือ plaintext) · `ผู้อ้างอิง "{ชื่อในช่อง}" คือ {ชื่อลูกค้า} ที่ติด blacklist`
  - `REFERENCED_BY_BLACKLISTED` — สมาชิก set คนใดมี `references[].phone` ตรงกับเบอร์หลัก/เบอร์สำรองของลูกค้า · `{ชื่อ} ที่ติด blacklist เคยใส่ลูกค้าคนนี้เป็นผู้อ้างอิง`
- ไม่มีเบอร์/ไม่มีผู้อ้างอิง/ถอดรหัสไม่ได้ (ไม่มีกุญแจ PII) → ข้ามข้อนั้นเงียบ ๆ
- โหลด set ทั้งก้อนครั้งเดียวต่อการประเมิน (`id, name, phone, phoneHash, references*`) — ไม่คำนวณ tier ของทุกคน · `evaluateMany(ids)` สำหรับตาราง (ใช้ set เดียวกัน)
- **เรียกนอก tx** ของการสร้างสัญญา (แบบเดียวกับ `testModeOn`) — ลด predicate lock บน Serializable tx; ยอมรับช่องว่างเล็กมากที่ tag ถูกติดระหว่างตรวจกับ create (คำตัดสินผม)

## ด่านที่ API — ตอนสร้างสัญญา

`ContractLifecycleService.create()` ก่อนเปิด `$transaction`:
- ประเมิน → `HARD` → `ConflictException({ code: 'CUSTOMER_BLACKLISTED', level: 'HARD', reasons, message: 'ลูกค้าติด blacklist ไม่สามารถทำสัญญาได้' })` ทุกบทบาท
- `SOFT` ไม่มี `dto.blacklistOverrideReason` → `ConflictException({ code: 'CUSTOMER_BLACKLIST_REVIEW', level: 'SOFT', reasons, canOverride, message: 'ลูกค้ามีประวัติที่ต้องให้ผู้จัดการอนุมัติก่อนทำสัญญา' })` (`canOverride` = role ∈ OWNER, BRANCH_MANAGER)
- `SOFT` + `blacklistOverrideReason` (trim 10–500 ตัว) + role OWNER/BM → ผ่าน · หลัง commit `AuditLog { action: 'CONTRACT_BLACKLIST_OVERRIDDEN', entity: 'contract', entityId, userId, newValue: { customerId, level: 'SOFT', reasons, overrideReason } }` ผ่าน `AuditService.log` **หลัง tx** (database.md) · บทบาทอื่นส่งเหตุผลมาก็ยัง 409 ตัวเดิม
- ใน tx: `assertCustomerContractPolicy` คงไว้เป็นตาข่ายชั้นสุดท้าย แต่ **ตัดพารามิเตอร์ override ทิ้ง** (fail-closed เสมอ) · DTO ถอด `overrideActiveContractCheck` (client เก่าที่ส่งมาถูก whitelist ตัด)
- DTO: `CreateContractDto.blacklistOverrideReason?: string` (`@IsOptional() @IsString() @Length(10, 500, { message: 'กรุณาระบุเหตุผล 10–500 ตัวอักษร' })`)
- ทางสร้างสัญญาที่ไม่ผ่าน `create()` (เปลี่ยนเครื่อง `contract-exchange.service.ts`, `defect-exchange.service.ts`, `migration.service.ts`) **ไม่เข้าด่าน** — ลูกค้าคนเดิมบนสัญญาที่ผ่อนอยู่

## endpoint อ่านผล

- `GET /customers/:id/blacklist` → `CustomerBlacklistResult`
- `GET /customers/blacklist?ids=a,b,c` (≤100) → `Record<customerId, CustomerBlacklistResult>` สำหรับตาราง
- roles OWNER/BRANCH_MANAGER/FINANCE_MANAGER/ACCOUNTANT/SALES · วางใน `CustomersController` ก่อน route `:id`

## Web

- **หน้าสร้างสัญญา ขั้นเลือกลูกค้า**: hook `useContractCreateData` ดึง `['customer-blacklist', id]` เมื่อเลือกลูกค้า (คู่กับ `['customer-latest-credit', id]` เดิม) และคำนวณ `canNext()` (ไฟล์ `hooks/useContractCreateData.ts` + ปุ่มใน `ContractCreatePage/index.tsx`) · `CustomerSelectStep` รับ `blacklist`, `overrideReason`, `setOverrideReason`, `overrideAccepted`, `setOverrideAccepted` แทน `overrideActiveContractCheck`:
  - `HARD`: กล่องแดง (`border-destructive/30 bg-destructive/5`, `role="alert"`) ไอคอน `ShieldBan` หัว "ห้ามทำสัญญา — ลูกค้าติด blacklist" + รายการเหตุผล (ไอคอนต่อ code · ชื่อคนที่จับคู่เป็นลิงก์ `/customers/:id`) + "ไม่มีการอนุมัติข้าม" + ทางออกตามบทบาท (OWNER/FINANCE_MANAGER: "ถอด tag ได้ที่หน้าลูกค้า" · อื่น: "ติดต่อเจ้าของ/ผู้จัดการการเงิน") · ปุ่ม "ถัดไป" ปิด
  - `SOFT`: กล่องส้ม (`border-warning/40 bg-warning/10`, `role="alert"`) ไอคอน `ShieldAlert` หัว "ต้องให้ผู้จัดการอนุมัติก่อนทำสัญญา" + เหตุผล · OWNER/BM: checkbox "อนุมัติทำสัญญาทั้งที่มีประวัติ (ในฐานะ …)" + `Textarea` เหตุผล (≥10 ตัว แสดงตัวนับ) · SALES: "กรุณาติดต่อผู้จัดการสาขาเพื่ออนุมัติ" · "ถัดไป" เปิดเมื่อติ๊ก + เหตุผลครบ
  - `NONE`: ไม่แสดง · โหลดอยู่: "ถัดไป" รอ
  - แบนเนอร์ "ลูกค้ายังมีสัญญาที่กำลังผ่อนอยู่" + checkbox อนุมัติผ่อนซ้อนเดิม **ถอดออก** (กลายเป็น reason `ACTIVE_CONTRACT` ในกล่องแดง)
  - payload แนบ `blacklistOverrideReason` เมื่อติ๊ก · 409 `CUSTOMER_BLACKLISTED`/`CUSTOMER_BLACKLIST_REVIEW` → toast + กลับขั้นเลือกลูกค้า + refetch
- **ป้าย** `CustomerBlacklistBadge` (`components/customer/`): `HARD` = `Badge variant="destructive"` ไอคอน + "ติด blacklist · ห้ามทำสัญญา" · `SOFT` = `variant="warning"` + "ต้องให้ผู้จัดการอนุมัติ" · `NONE` = null · กดขยายเหตุผล (`aria-expanded`) ใช้รายการเดียวกับหน้าสัญญา. วางที่:
  - `/credit-checks` (`CreditChecksPage.tsx`) ใต้ชื่อลูกค้าในแถว — ดึง batch ตาม id ที่แสดงในหน้า
  - หน้าลูกค้า `CustomerDetailPage` `DetailHeader` ข้าง `CustomerTierBadge` (แสดงผลใบเดียว) — และเปลี่ยนป้าย tier `BLACKLIST` ใน `types/customer-tier.ts` จาก "ห้ามทำสัญญา" เป็น "ประวัติเสีย" เพื่อไม่ให้สองป้ายขัดกัน (คำตัดสินผม)
  - แผงแชท `RoomDossier.tsx` ส่วนหัวลูกค้า (เมื่อ `customerId` มี)
  - `CreditTab`/`CreditCheckCard`: ไม่ต้อง (หัวหน้าลูกค้ามีแล้ว)

## ความปลอดภัย / PII

ไม่มี endpoint สาธารณะ · เหตุผลมีชื่อคนที่จับคู่ แต่ไม่มีเบอร์/เลขบัตร · ถอดรหัส references ฝั่ง API เท่านั้น · audit เก็บ reasons + เหตุผลผู้จัดการ (ไม่มีเบอร์)

## เทสต์

API: `customer-blacklist.service.spec.ts` (ทุก reason code · VOLUNTARY vs ยึด · BAD_DEBT ไม่ซ้ำ REPOSSESSED · level · ข้ามเมื่อไม่มีเบอร์/กุญแจ · ไม่จับคู่ตัวเอง · set รวมลูกค้าที่ถูกลบ · plaintext fallback) · lifecycle/policy spec (HARD 409 ทุก role · SOFT 409 ไม่มีเหตุผล · SOFT ผ่าน + audit หลัง tx · SALES ส่งเหตุผล = 409 · `overrideActiveContractCheck` ไม่มีผลอีก) · controller/DTO · **integration บน PostgreSQL ชั่วคราว** (`tools/test-chat-credit.sh` — `credit-payment-flow` suite มีสัญญาจริง): ยึดเครื่องจริง → เปิดใหม่ 409 · TERMINATED → 409 · ผู้อ้างอิงจับคู่ผ่านเบอร์ที่เข้ารหัสจริง · seed ชื่อห้ามมีตัวเลข (บทเรียน `generateSaleNumber`)
Web: `CustomerSelectStep` (HARD ปิดปุ่ม/ไม่มี checkbox · SOFT OWNER ติ๊ก+เหตุผล · SOFT SALES ข้อความติดต่อ · payload) · `useContractCreateData.canNext` · `CustomerBlacklistBadge` 3 ระดับ · `CreditChecksPage` batch · `RoomDossier`

## นอกขอบเขต

POS · รับซื้อ/เทิร์น · เครือข่ายข้ามร้าน · auto-tag · จับคู่ด้วยชื่อ · เบอร์สำรองของสมาชิก set (ไม่มี hash) · เตือนตอนสร้าง/แก้ลูกค้า
