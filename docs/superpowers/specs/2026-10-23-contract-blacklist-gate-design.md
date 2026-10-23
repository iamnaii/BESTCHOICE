# ด่าน blacklist ตอนทำสัญญา (ก้อน 5 — C3) — Design Spec

**วันที่:** 2026-10-23 · **ที่มา:** เทียบ Tooltify ข้อ C3 "ตรวจ blacklist อัตโนมัติตอนบันทึกสัญญา" (Tooltify มีเครือข่ายข้ามร้าน — ทำเองไม่ได้ ทำได้เฉพาะตรวจภายในร้าน)

## เจตนา

วันนี้ระบบรู้ว่าลูกค้า "เคยตัดหนี้สูญ / เคยถูกยึดเครื่อง" (tier `BLACKLIST` คำนวณจาก `customer-tier.service.ts`) และพนักงานติด tag `BLACKLIST` ด้วยมือได้ แต่ **ไม่มีจุดไหนบังคับ** — พนักงานขายเปิดสัญญาให้คนเหล่านี้ได้เงียบ ๆ และคนที่ถูกยึดเครื่องกลับมาใช้เบอร์เดิม/เป็นผู้อ้างอิงให้คนอื่นก็ไม่มีใครเห็น. ก้อนนี้ทำให้ระบบ **ตรวจเอง ณ จุดทำสัญญา** และบอกผลไว้ตั้งแต่ขั้นตรวจเครดิต.

## คำตัดสินเจ้าของ (23/10 ผ่าน AskUserQuestion)

| เรื่อง | คำตอบ |
|---|---|
| ระดับการห้าม | **แยก 2 ระดับ**: HARD = ห้ามเด็ดขาด ไม่มีใครปลด · SOFT = ห้าม แต่ OWNER/ผู้จัดการสาขาปลดได้พร้อมเหตุผล |
| HARD มาจาก | เคยตัดหนี้สูญ / เคยถูกยึดเครื่อง · tag `BLACKLIST` ที่ติดมือ · เลขบัตร/เบอร์ซ้ำกับคนที่ติด blacklist |
| SOFT มาจาก | มีสัญญาค้างชำระเกิน 60 วัน · เป็นผู้อ้างอิงของคน blacklist (ทั้งสองทาง: ลูกค้าใส่คน blacklist เป็นผู้อ้างอิง หรือคน blacklist เคยใส่ลูกค้าคนนี้เป็นผู้อ้างอิง — จับคู่ด้วยเบอร์โทร) |
| จุดตรวจ | ตอนบันทึกสัญญาผ่อน (ด่านที่ API) · หน้าตรวจเครดิต + แผงแชท (แสดงผล) |
| ใครปลด SOFT | OWNER + ผู้จัดการสาขา ต้องใส่เหตุผล (บันทึก audit) |
| ไม่ทำ | POS ขายสด/ไฟแนนซ์นอก · รับซื้อ/รับเทิร์น · เครือข่ายข้ามร้าน · auto-tag |

## นิยาม "คนที่ติด blacklist" (ชุดเดียว ใช้ทุกจุด)

`BlacklistedCustomerSet` = ลูกค้า (รวมที่ถูก soft-delete — ประวัติไม่หายเพราะลบ) ที่เข้าข้อใดข้อหนึ่ง:
1. มีสัญญาสถานะ `CLOSED_BAD_DEBT` หรือ `DEFAULT` (นิยามเดียวกับ `hasBadDebt` ของ tier)
2. มีแถว `Repossession` (ผ่าน `contract.customerId`) ที่ไม่ถูกลบ (นิยามเดียวกับ `hasRepossession`)
3. มี `CustomerTag` `tag = BLACKLIST` ที่ `deletedAt: null`

## ผลการประเมินต่อลูกค้า 1 คน

`CustomerBlacklistService.evaluate(customerId, db?) → CustomerBlacklistResult`

```ts
type BlacklistLevel = 'NONE' | 'SOFT' | 'HARD';
type BlacklistReasonCode =
  | 'BAD_DEBT' | 'REPOSSESSED' | 'MANUAL_TAG' | 'PHONE_MATCH'          // HARD
  | 'OVERDUE_60' | 'REFERENCES_BLACKLISTED' | 'REFERENCED_BY_BLACKLISTED'; // SOFT
interface BlacklistReason { code: BlacklistReasonCode; level: 'HARD' | 'SOFT'; message: string;
  related?: { customerId: string; name: string } | null }   // คนที่จับคู่ได้ (PHONE_MATCH / REFERENCE*)
interface CustomerBlacklistResult { level: BlacklistLevel; reasons: BlacklistReason[]; checkedAt: string }
```

- `level` = `HARD` ถ้ามี reason ระดับ HARD อย่างน้อย 1 · ไม่งั้น `SOFT` ถ้ามี SOFT · ไม่งั้น `NONE`. ใส่ reason ทุกข้อที่เข้า (ไม่หยุดที่ข้อแรก) เพื่อให้ผู้จัดการเห็นภาพครบ.
- **HARD**
  - `BAD_DEBT` — ลูกค้าเองเข้าข้อ 1 · ข้อความ `เคยถูกตัดเป็นหนี้สูญ (สัญญา {เลข})`
  - `REPOSSESSED` — เข้าข้อ 2 · `เคยถูกยึดเครื่อง (สัญญา {เลข} · {วันที่})`
  - `MANUAL_TAG` — เข้าข้อ 3 · `ติด tag blacklist โดย {ชื่อผู้ติด} {วันที่}: {reason ของ tag}`
  - `PHONE_MATCH` — `phoneHash` ของลูกค้า (เบอร์หลัก) ตรงกับ `phoneHash` ของสมาชิก `BlacklistedCustomerSet` คนอื่น (ไม่ใช่ตัวเอง) · `เบอร์โทรตรงกับ {ชื่อ} ที่ติด blacklist` · **เลขบัตร**: `nationalIdHash` เป็น `@unique` ทั้งตาราง (รวมแถวที่ลบ) จึงไม่มีทางมี 2 แถวเลขบัตรเดียวกัน — การสร้างลูกค้าใหม่ด้วยเลขบัตรเดิมจะชุบแถวเดิมกลับมา (`create()` reviveGhost) ซึ่งถือประวัติ blacklist อยู่แล้ว ⇒ "เลขบัตรซ้ำ" ถูกบังคับโดยโครงสร้าง ไม่ต้องตรวจเพิ่ม (ระบุในเอกสารให้เจ้าของเข้าใจ)
- **SOFT**
  - `OVERDUE_60` — มี `Payment` ของสัญญา `ACTIVE/OVERDUE/DEFAULT` ของลูกค้าที่ยังไม่ `PAID` และ `bangkokDayDiff(dueDate, now) > 60` · `ค้างชำระ {N} วัน (สัญญา {เลข} งวดที่ {n})` ใช้งวดที่ค้างนานสุด (DEFAULT เข้า HARD อยู่แล้ว แต่ยังรายงาน OVERDUE_60 ด้วย)
  - `REFERENCES_BLACKLISTED` — ผู้อ้างอิงของลูกค้า (`references[].phone` ถอดรหัสผ่าน `CustomerPiiService`, normalize ด้วย `normalizeThaiPhone`, hash ด้วย `CustomerPiiService.hash`) ตรงกับ `phoneHash` ของสมาชิก set · `ผู้อ้างอิง "{ชื่อในช่องอ้างอิง}" คือ {ชื่อลูกค้า} ที่ติด blacklist`
  - `REFERENCED_BY_BLACKLISTED` — สมาชิก set คนใดมี `references[].phone` ตรงกับเบอร์หลัก/เบอร์สำรองของลูกค้า · `{ชื่อ} ที่ติด blacklist เคยใส่ลูกค้าคนนี้เป็นผู้อ้างอิง`
- ไม่มีเบอร์/ไม่มีผู้อ้างอิง/ถอดรหัสไม่ได้ (ไม่มีกุญแจ PII) → ข้ามข้อนั้นเงียบ ๆ ไม่ใช่ error
- ขนาดงาน: set มีไม่กี่สิบคน — โหลด set ทั้งก้อน (id, name, phoneHash, references) ครั้งเดียวต่อการประเมิน; ไม่คำนวณ tier ของทุกคน

## ด่านที่ API — ตอนสร้างสัญญา

`contract-lifecycle.service.ts create()` หลัง `assertCustomerContractPolicy` (ใน tx เดิม):
- `HARD` → `ConflictException({ code: 'CUSTOMER_BLACKLISTED', level: 'HARD', reasons, message: 'ลูกค้าติด blacklist ไม่สามารถทำสัญญาได้' })` — ไม่มี override ไม่ว่าบทบาทใด (รวม OWNER)
- `SOFT` และไม่มี `dto.blacklistOverrideReason` → `ConflictException({ code: 'CUSTOMER_BLACKLIST_REVIEW', level: 'SOFT', reasons, canOverride, message: 'ลูกค้ามีประวัติที่ต้องให้ผู้จัดการอนุมัติก่อนทำสัญญา' })` (`canOverride` = role ∈ OWNER, BRANCH_MANAGER)
- `SOFT` + `blacklistOverrideReason` (ตัดช่องว่างแล้ว 10–500 ตัว) + role OWNER/BM → ผ่าน · หลัง commit เขียน `AuditLog { action: 'CONTRACT_BLACKLIST_OVERRIDDEN', entity: 'contract', entityId, userId, newValue: { customerId, level: 'SOFT', reasons, overrideReason } }` (ผ่าน `AuditService.log` หลัง tx ตามกติกา database.md) · บทบาทอื่นส่งเหตุผลมาก็ยัง 409 ตัวเดิม
- `NONE` → ไม่แตะอะไร
- DTO: `CreateContractDto.blacklistOverrideReason?: string` (`@IsOptional() @IsString() @Length(10, 500)` ข้อความไทย)
- สัญญาที่ถูกสร้างผ่านทางอื่น (เปลี่ยนเครื่อง A.1 สัญญาใหม่บนลูกค้าเดิม · นำเข้า) **ไม่เข้าด่าน** — ลูกค้าคนเดิมที่ผ่อนอยู่แล้ว

## endpoint อ่านผล

`GET /customers/:id/blacklist` → `CustomerBlacklistResult` · roles OWNER/BRANCH_MANAGER/FINANCE_MANAGER/ACCOUNTANT/SALES (ขอบเขตลูกค้าตาม `CustomersController` เดิม) · `related.name` เป็นชื่อลูกค้าในระบบ (ไม่ส่งเบอร์/เลขบัตรของคนที่จับคู่)

## Web

- **หน้าสร้างสัญญา ขั้นเลือกลูกค้า** (`CustomerSelectStep`): เมื่อเลือกลูกค้า → ดึง `/customers/:id/blacklist` (react-query key `['customer-blacklist', id]`)
  - `HARD`: กล่องแดง (`border-destructive/30 bg-destructive/5`) ไอคอน `ShieldBan` หัว "ห้ามทำสัญญา — ลูกค้าติด blacklist" + รายการเหตุผล (ไอคอน + ข้อความ · ชื่อคนที่จับคู่เป็นลิงก์ไปหน้าลูกค้า) + ข้อความ "ไม่มีการอนุมัติข้าม ถ้าข้อมูลผิดให้แก้ที่หน้าลูกค้า/ถอด tag ก่อน" · ปุ่ม "ถัดไป" ปิด
  - `SOFT`: กล่องส้ม (`border-warning/40 bg-warning/10` ตัวอักษร `text-warning-strong`) ไอคอน `ShieldAlert` หัว "ต้องให้ผู้จัดการอนุมัติก่อนทำสัญญา" + เหตุผล · OWNER/BM: checkbox "อนุมัติทำสัญญาทั้งที่มีประวัติ (ในฐานะ …)" + `Textarea` เหตุผล (บังคับ ≥10 ตัวอักษร นับตัวอักษรให้เห็น) · SALES: "กรุณาติดต่อผู้จัดการ" · ปุ่ม "ถัดไป" เปิดเมื่อ checkbox + เหตุผลครบ
  - `NONE`: ไม่แสดงอะไร (ไม่มีแถบ "ปกติ" ให้รก) · ระหว่างโหลด: ปุ่มถัดไปรอ
  - payload สร้างสัญญาแนบ `blacklistOverrideReason` เมื่อติ๊ก · 409 `CUSTOMER_BLACKLISTED`/`CUSTOMER_BLACKLIST_REVIEW` จาก API → toast ข้อความ + กลับมาขั้นเลือกลูกค้า (ป้องกันกรณีสถานะเปลี่ยนระหว่างกรอก)
- **หน้าตรวจเครดิต** (`CreditCheckCard` ใน `/credit-checks`) และ **แผงแชท** (`RoomCreditCard` ใน inbox): ป้าย `Badge` ใต้ชื่อลูกค้า — `HARD` = destructive "ติด blacklist · ห้ามทำสัญญา" · `SOFT` = warning "ต้องให้ผู้จัดการอนุมัติ" · ขยายดูเหตุผลได้ (รายการเดียวกับหน้าสัญญา) · `NONE` ไม่แสดง
- ไม่ใช้สีอย่างเดียว: ไอคอน + ข้อความทุกระดับ (`frontend.md`)

## ความปลอดภัย / PII

- ไม่มี endpoint สาธารณะ · เหตุผลที่ส่งออกมีชื่อคนที่จับคู่ แต่ไม่มีเบอร์/เลขบัตรของเขา · การถอดรหัส references ทำฝั่ง API เท่านั้น
- audit `CONTRACT_BLACKLIST_OVERRIDDEN` เก็บ reasons + เหตุผลผู้จัดการ (ไม่เก็บเบอร์)

## เทสต์

API: `customer-blacklist.service.spec.ts` (ทุก reason code · ลำดับ level · ข้ามเมื่อไม่มีเบอร์/กุญแจ · ไม่จับคู่ตัวเอง · set รวมลูกค้าที่ถูกลบ) · `contract-create-policy`/lifecycle spec (HARD 409 ทุก role · SOFT 409 ไม่มีเหตุผล · SOFT ผ่านพร้อม audit · SALES ส่งเหตุผล = 409) · DTO validation · **integration บน PostgreSQL ชั่วคราว** (`credit-payment-flow` suite หรือไฟล์ใหม่): ลูกค้าถูกยึดเครื่องจริง → สร้างสัญญาใหม่ 409 · ผู้อ้างอิงจับคู่ด้วยเบอร์ที่เข้ารหัสจริง
Web: `CustomerSelectStep` (HARD ปิดปุ่ม/ไม่มี checkbox · SOFT OWNER ติ๊ก+เหตุผล · SOFT SALES ข้อความติดต่อผู้จัดการ · payload มี reason) · `CreditCheckCard`/`RoomCreditCard` badge ตามระดับ

## นอกขอบเขต

POS · รับซื้อ/เทิร์น · เครือข่ายข้ามร้าน · auto-tag BLACKLIST · จับคู่ด้วยชื่อ (ซ้ำกันได้ง่าย) · เบอร์สำรองของสมาชิก set (ไม่มี hash)
