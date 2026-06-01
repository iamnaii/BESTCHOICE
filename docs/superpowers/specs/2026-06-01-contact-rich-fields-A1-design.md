# Contact Rich Detail — Read-Through (Sub-project A1, reworked)

วันที่: 2026-06-01
สถานะ: รออนุมัติ spec จาก owner
ส่วนหนึ่งของ: PEAK-style contact detail expansion (A → B → C). อันนี้คือ **A1**.

> **เวอร์ชันนี้ rework หลัง /scrutinize** — เวอร์ชันแรกเก็บ column ซ้ำบน Contact (address/entityType/branchCode/prefix) ซึ่งซ้ำกับ Customer/Supplier และทำให้ข้อมูลแตก 2 ชุด (เอกสารกฎหมายอ่านจาก Customer/Supplier ไม่ใช่ Contact). เวอร์ชันนี้ใช้ **read-through**: Contact คงเป็น party key บางๆ, หน้า detail ดึงข้อมูลจาก record ต้นทางมาแสดง + ลิงก์ไปแก้ที่ต้นทาง.

## ปัญหาที่ scrutinize เจอ (เหตุผลของการ rework)

- ฟิลด์เกือบทั้งหมดที่อยากเพิ่มมีอยู่แล้ว: `entityType`↔`Supplier.type`, `prefix`↔`Customer.prefix`, `branchCode`↔`Supplier.branchCode`, address↔`Customer.addressIdCard/addressCurrent` + `Supplier.address`
- สัญญา/ใบเสร็จอ่าน address จาก **Customer** ([contract-workflow.service.ts:176-177](../../apps/api/src/modules/contracts/contract-workflow.service.ts), [contracts.service.ts:173](../../apps/api/src/modules/contracts/contracts.service.ts)) → ถ้าเก็บซ้ำบน Contact แล้วแก้ที่ Contact จะไม่กระทบเอกสาร = ข้อมูลขัดกัน
- มี `CustomerDetailPage.tsx` + `SupplierDetailPage.tsx` ฟอร์มแก้ไขครบอยู่แล้ว และเป็นตัวจริงที่ระบบใช้

## หลักการ A1 (reworked)

- **Contact = party key บางๆ** (identity + link + roles) — **ไม่เพิ่ม column ข้อมูลกิจการ/ที่อยู่**
- หน้า detail แท็บ "ข้อมูลกิจการ" = **read-through** ประกอบจาก record ต้นทางที่ link อยู่ (Customer / Supplier / ExternalFinanceCompany)
- **แก้ไข = deep-link ไปหน้าต้นทางเดิม** (ที่มีฟอร์มครบ + เป็นตัวที่เอกสารใช้) — ไม่มี PATCH ฟิลด์บน Contact, ไม่มี migration, ไม่มี backfill
- **ไม่ duplicate PII inline**: ที่อยู่ลูกค้าเป็น PII เข้ารหัส — ไม่ดึงมาโชว์เต็มในหน้า contact (เลี่ยง PDPA/decrypt ผ่าน endpoint ใหม่) แสดงแค่ field ระบุตัวตน/ไม่อ่อนไหว + ลิงก์ไปดูเต็มที่หน้าต้นทาง

## ขอบเขต A1

ทำ:
- ขยาย `GET /contacts/:id` ให้ `select` ฟิลด์ระบุตัวตน/ไม่อ่อนไหวเพิ่มจาก record ที่ link (Supplier: type, taxId, branchCode, contactName, contactPhone, phone, hasVat ; Customer: prefix, phone, email, nationalId — **ไม่ดึง address PII** ; ExternalFinanceCompany: taxId, contactPhone, email, creditTermDays)
- หน้า `ContactDetailPage` แท็บ "ข้อมูลกิจการ" แสดง **การ์ดต่อ role record** + ปุ่ม "เปิดข้อมูลเต็ม / แก้ไข →" deep-link
- derive `entityType` แบบ read-time (มี role SUPPLIER/FINANCE_COMPANY หรือ Supplier.type=JURISTIC → นิติบุคคล ; ไม่งั้น บุคคล) — ไม่ต้องเก็บ column

ไม่ทำ:
- เพิ่ม column บน Contact / migration / backfill / PATCH ฟิลด์กิจการบน Contact
- DBD lookup → A2 ; ช่องบัญชี → B ; ภาพรวมการเงิน → C
- ฟิลด์ที่ไม่มีบน record ต้นทางใดเลย (เช่น website, fax) — ถ้าจำเป็นจริง เพิ่มที่ **record ต้นทาง** (เช่น Supplier) ไม่ใช่ Contact — แยกพิจารณานอก A1 (YAGNI)

## 1. Backend

ขยาย `ContactsService.findOne(id)` include/select (ของเดิม select แค่ `{id,name}`):
- `customers`: `{ id, name, prefix, phone, email, nationalId, customerCode? }` — **ไม่ดึง addressCurrent/addressIdCard (PII)**
- `suppliers`: `{ id, name, type, taxId, branchCode, contactName, contactPhone, phone, hasVat, address }` (Supplier.address ไม่ใช่ PII เข้ารหัส — ดึงได้)
- `tradeInsAsSeller`: `{ id, sellerName, sellerPhone, createdAt }` (free-text, read-only)
- `externalFinanceCompany`: `{ id, name, taxId, contactPhone, email, creditTermDays }`

ไม่เพิ่ม endpoint ใหม่. guard เดิม. respect `deletedAt: null` เดิม.

> NB: ถ้าต้องการโชว์ address ลูกค้าในหน้า contact จริงๆ ภายหลัง ให้ทำผ่าน CustomerPiiService decrypt + PDPA guard เป็นงานแยก — A1 ไม่ทำ (ลิงก์ไปดูที่ CustomerDetailPage แทน)

## 2. Frontend

`ContactDetailPage` แท็บ "ข้อมูลกิจการ" (reworked):
- หัว: contactCode, name (display), badge roles, derived entityType, isActive
- **การ์ดต่อ role record** (วนตาม customers/suppliers/finance/tradeIns ที่มี):
  - การ์ดลูกค้า: prefix+name, เบอร์, email, เลขบัตร(mask) + ปุ่ม **"เปิดข้อมูลลูกค้า / แก้ไข →"** → `/customers/{id}`
  - การ์ดผู้ขาย: name, type, taxId, เลขสาขา, ผู้ติดต่อ, เบอร์, hasVat, address + ปุ่ม → `/suppliers/{id}`
  - การ์ดบริษัทไฟแนนซ์: name, taxId, เบอร์, email + ปุ่ม → `/external-finance-companies/{id}`
  - การ์ดคนขายมือสอง: sellerName/sellerPhone (read-only, อาจลิงก์ `/trade-in`)
- ถ้า Contact ไม่มี role record เลย (กรณีหายาก) → แสดงข้อมูลเท่าที่ Contact มี (name/phone) + หมายเหตุ "ยังไม่ผูกกับลูกค้า/ผู้ขาย"
- ใช้ semantic tokens, Thai `leading-snug`
- ไม่ต้องมี edit modal/form ใน A1 (แก้ที่หน้าต้นทาง)

## 3. ทดสอบ

- API: `findOne` คืน field ที่ขยายต่อ role record ครบ, **ไม่หลุด address PII ของลูกค้า**, soft-delete filter, NotFound
- Web: แท็บข้อมูลกิจการ render การ์ดตาม role ที่มี, ปุ่ม deep-link ชี้ path ถูก (`/customers/:id` ฯลฯ), กรณีหลาย role โชว์หลายการ์ด, กรณีไม่มี record โชว์ fallback

## หมายเหตุต่อ B / C

- **B (ผังบัญชีต่อ contact)**: ทบทวนด้วยหลักเดียวกัน — Supplier มี payment method/bank อยู่แล้ว, chart-of-accounts มี per-account mapping ; ดูว่าควรเก็บ AR/AP code ที่ระดับ Contact (ตัวจริงที่ journal อ้างได้) หรือ derive — brainstorm แยกตอนเริ่ม B
- **C (ภาพรวมการเงิน)**: aggregate read-only ข้าม sales/contract/payment ตาม contactId/ลิงก์ — read-through ล้วน ไม่เก็บซ้ำ
