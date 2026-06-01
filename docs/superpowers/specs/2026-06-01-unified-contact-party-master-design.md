# สมุดรวมผู้ติดต่อ — Contact Party Master (แนวทาง B)

วันที่: 2026-06-01
สถานะ: รออนุมัติ spec จาก owner

## ที่มา / ปัญหา

ข้อมูล "ผู้ติดต่อ" ในระบบกระจายอยู่หลาย model แต่ละที่มี domain logic หนักของตัวเอง และไม่เชื่อมกัน:

- **Customer** — ลูกค้าผ่อน (PII เข้ารหัส, สัญญา, เครดิต, อาชีพ/เงินเดือน, บุคคลอ้างอิง)
- **Supplier** — คู่ค้า/ผู้ขาย เช่น Apple (VAT, taxId, PO)
- **FinanceCompanyContact** — ผู้ติดต่อ (พนักงาน) ในบริษัทไฟแนนซ์ภายนอก (สร้าง 2026-05-31)
- **TradeIn** — คนขายมือสอง เก็บแค่ `sellerName` / `sellerPhone` เป็น free-text

ผลคือ owner หาคนไม่เจอ (ลูกค้าอยู่ใต้ "ขาย", ผู้ขายอยู่ใต้ "คลัง", คนขายมือสองไม่ได้เก็บเป็น record) และ **ผิดหลักบัญชี** — คู่สัญญา (party) คนเดียวที่เป็นทั้งลูกค้าและผู้ขายไม่ได้ถูกมองเป็นรายเดียว ทำให้ AR/AP และเอกสารภาษีไม่ reconcile เข้าหา record เดียว

อ้างอิงต้นแบบ: หน้า "ผู้ติดต่อ" ของ PEAK (ระบบบัญชีของ CPA) — สมุดรวมหน้าเดียว มีเลขที่กลาง (C00790), กลุ่มมาตรฐาน (ลูกค้า/ผู้ขาย/ปิดใช้งาน), กลุ่มกำหนดเอง, ค้นหา, เพิ่ม/นำเข้า/พิมพ์

## เป้าหมาย

1. หน้าเดียวที่ค้นหา/ดูผู้ติดต่อทุกประเภทได้
2. ถูกต้องตามหลักบัญชี: **1 คู่สัญญา (party) = 1 ผู้ติดต่อ master เดียว** ระบุด้วยเลขผู้เสียภาษี/บัตรปชช. — คนเดียวเป็นได้หลายบทบาท (role) พร้อมกัน, AR+AP รวมเข้า record เดียว, รองรับการแมป/ export เข้า PEAK

## แนวทางที่เลือก: B (party master ชั้นบน)

เพิ่มชั้น `Contact` (party master) **เหนือ** Customer/Supplier — pattern เดียวกับ "Business Partner" ของระบบบัญชีใหญ่ — **ไม่ลบ/ไม่ทุบ** ของเดิม และ**ไม่แก้ FK เดิม** (สัญญายังชี้ Customer, PO ยังชี้ Supplier) เพื่อความเสี่ยงต่ำ

แนวทางที่ตัดทิ้ง:
- **A (aggregator view เฉยๆ)** — แก้ pain "หาคนเจอ" ได้ แต่ไม่ได้ความถูกต้องบัญชี (ไม่มี party เดียว)
- **C (สมุดแยกใหม่)** — เกิดข้อมูลซ้ำซ้อน 2 ชุด ไม่ตอบโจทย์
- **B แบบ full rewrite** (ลบ Customer/Supplier ทำ Contact เป็นตัวเดียว) — เสี่ยงสูงเกินจำเป็น ต้องแก้ทุกจุดที่อ้าง FK

## 1. โครงข้อมูล

```
model Contact (party master — 1 party 1 record)
  id              uuid
  contactCode     เลขที่ภายใน เช่น P-00001 (gen เอง, advisory-lock per-day แบบ DocNumberService)
  peakContactCode เลขที่ฝั่ง PEAK (C00790) — owner กรอก/แมปเองสำหรับ export, nullable
  name            ชื่อ party
  taxId           เลขผู้เสียภาษี (นิติบุคคล) ── natural key
  nationalIdHash  hash บัตรปชช. (บุคคล) เข้ารหัส+hash แบบ Customer เดิม ── natural key
  phone, email, address, lineId
  roles           CUSTOMER | SUPPLIER | TRADE_IN_SELLER | FINANCE_COMPANY (ได้หลาย role พร้อมกัน)
  isActive        เปิด/ปิดใช้งาน (= กลุ่ม "ปิดใช้งาน")
  createdAt, updatedAt, deletedAt (soft delete)
```

การผูกกับของเดิม — เพิ่มแค่ field ชี้กลับ ไม่แตะ FK เดิม:
- `Customer.contactId` → Contact
- `Supplier.contactId` → Contact
- `TradeIn.sellerContactId` → Contact (คนขายมือสองได้เป็น record จริง แทน free-text)
- `ExternalFinanceCompany.contactId` → Contact

กฎสำคัญ (ความถูกต้องบัญชี):
- 1 party = 1 Contact ระบุด้วย taxId หรือ nationalId
- คนเดียวมีได้หลาย role เช่น ลูกค้าผ่อนที่เอามือถือมาขายด้วย = Contact 1 อัน role `CUSTOMER` + `TRADE_IN_SELLER`
- ตอนสร้าง Customer/Supplier/TradeIn ใหม่ → เรียก `findOrCreateByNaturalKey()` หา Contact จาก taxId/nationalId ก่อน: มีแล้ว = ผูก role เพิ่ม (ไม่สร้างซ้ำ), ไม่มี = สร้างใหม่

## 2. Backfill ข้อมูลเดิม

สคริปต์รันครั้งเดียว `npm run backfill:contacts` (pattern เดียวกับ `backfill:promise-slots`). migration เพิ่ม `contactId` แบบ **nullable ก่อน → backfill → ค่อยใช้งาน** (2-step ตาม database.md — ไม่ทำ required บน table ที่มีข้อมูล)

ลำดับ:
1. **Supplier** (จำนวนน้อย, taxId ชัด) → Contact + role SUPPLIER
2. **Customer** → หา Contact ที่ nationalId/taxId ตรง: ตรง→ผูก role CUSTOMER เพิ่ม, ไม่ตรง→สร้างใหม่
3. **TradeIn** (free-text) → จับคู่เบอร์/ชื่อ: เจอ→ผูก role TRADE_IN_SELLER + set sellerContactId, ไม่เจอ→สร้างใหม่
4. **บริษัทไฟแนนซ์** → Contact + role FINANCE_COMPANY

นโยบาย dedup ปลอดภัย: คนขายมือสองที่มีแต่ชื่อ+เบอร์ (ไม่มีบัตรปชช.) **ถ้าไม่ชัวร์ ให้สร้าง Contact แยกไว้ก่อน ไม่ auto-merge** แล้วมีปุ่ม "รวมผู้ติดต่อซ้ำ" ทีหลัง (ป้องกัน merge ผิดคนซึ่งแก้ยากกว่า)

backfill ต้อง idempotent — รันซ้ำไม่สร้างซ้ำ

## 3. Backend

module ใหม่ `apps/api/src/modules/contacts/` (pattern customers/):
- `GET /contacts` — list รวม + ค้นหา (ชื่อ/เบอร์/เลขภาษี/contactCode) + `?role=...|ALL` + `?isActive` + pagination (page/limit, response `{data,total,page,limit}`)
- `GET /contacts/:id` — รายละเอียด party + ทุก role + ลิงก์ไปหน้าจริง (สัญญา/PO/ใบรับซื้อ)
- `POST /contacts/merge` — รวมผู้ติดต่อซ้ำ (OWNER เท่านั้น)
- `findOrCreateByNaturalKey()` — service กลางที่ Customer/Supplier/TradeIn เรียกตอนสร้างใหม่
- guard: `@UseGuards(JwtAuthGuard, RolesGuard)` + เคารพ branch-access เดิม (reuse `branch-access.util.ts`)

## 4. Frontend

หน้า `/contacts` (lazy-load + QueryBoundary) เลียนแบบ layout PEAK:
- ซ้าย: filter กลุ่ม (ทั้งหมด / ลูกค้า / ผู้ขาย / คนขายมือสอง / ไฟแนนซ์ / ปิดใช้งาน)
- ตาราง: เลขที่ | ชื่อ | กลุ่ม (role badges) | คำสั่ง — คลิกแถว → หน้ารายละเอียด party
- ปุ่ม "เพิ่มผู้ติดต่อ ▾" → เลือกประเภท → เด้งฟอร์มเดิม (reuse ฟอร์มลูกค้า/ผู้ขาย) → เซฟแล้วผูก Contact อัตโนมัติ
- search ใช้ `useDebounce`; data ผ่าน react-query; tokens/sonner ตามมาตรฐาน frontend.md
- เพิ่มเข้า side menu (`config/menu.ts`) เห็นได้ทุก role ที่เกี่ยว

## 5. สิทธิ์เข้าถึง

- เมนูเห็นได้: OWNER, FINANCE_MANAGER, ACCOUNTANT, BRANCH_MANAGER, SALES
- row-level: SALES/BM เห็นเฉพาะ contact ที่มี role ในสาขาตัวเอง (reuse `branch-access.util.ts`)
- merge: OWNER เท่านั้น
- mutation ผ่าน AuditInterceptor เดิม — audit strings ใหม่: `CONTACT_CREATED`, `CONTACTS_MERGED`, `CONTACT_ROLE_ADDED`
- PII: Contact เข้ารหัส+hash บัตรปชช. แบบ Customer เดิม ไม่ log เลขจริง

## 6. การทดสอบ

- API: `findOrCreateByNaturalKey` (party ซ้ำ→ผูก role / ไม่ซ้ำ→สร้าง), list+filter+search+pagination, merge, branch-access filter, backfill idempotency
- Web: list (filter กลุ่ม, search debounce), add-contact routing
- Backfill: idempotent, dedup ถูกต้อง, ไม่ auto-merge คนขายมือสองที่ไม่ชัวร์

## ไม่ทำใน v1 (YAGNI — เฟสหลัง)

- นำเข้า Excel/CSV
- พิมพ์ / export รายงานรายชื่อ
- กลุ่มกำหนดเอง (custom group)
- ผู้ติดต่อพนักงานในบริษัทไฟแนนซ์ขึ้นมาเป็น Contact (ยังเก็บซ้อนใต้บริษัทเหมือนเดิม)
