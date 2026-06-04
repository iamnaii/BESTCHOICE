# PEAK-style Contact Picker — เลือกผู้ติดต่อข้าม role ได้ทุกช่อง

วันที่: 2026-06-04
สถานะ: รออนุมัติ spec จาก owner
ต่อยอดจาก: [2026-06-01-unified-contact-party-master-design.md](2026-06-01-unified-contact-party-master-design.md) (party master ชั้นบน — สร้างเสร็จแล้ว)

## ที่มา / ปัญหา

party master (`Contact`) สร้างเสร็จแล้วตาม spec แม่ — 1 party = 1 record, มีได้หลาย role พร้อมกัน, `findOrCreateByNaturalKey()` ผูก role อัตโนมัติ และมีหน้า `/contacts` แล้ว

**แต่ "ช่องเลือกผู้ติดต่อ" บนเอกสารยังไม่ได้ใช้ party master เต็มที่** — ยังเหมือน PEAK ไม่ครบ:

1. **filter ตาม role** — `VendorCombobox` ([VendorCombobox.tsx:47](../../../apps/web/src/components/expense-form-v4/VendorCombobox.tsx#L47)) ค้น `contactsApi.list({ role: 'SUPPLIER' })` → ผู้ติดต่อที่ตอนนี้เป็น**ลูกค้าอย่างเดียว** ไม่โผล่ในช่องผู้ขาย ทั้งที่ใน PEAK แค่ติ๊ก "ผู้ขาย" เพิ่มก็ใช้ได้เลย
2. **ไม่สม่ำเสมอ** — 5 picker ใช้ 3 แบบ: contacts API (v4), `/customers` ตรงๆ, `/suppliers` ตรงๆ
3. **client-side filter** — `VendorCombobox` โหลด 200 รายการแล้ว filter ใน client (ไม่ใช่ server search) → เกิน 200 ค้นไม่เจอ

### เป้าหมาย (อ้างอิงต้นแบบ PEAK)

เลือกผู้ติดต่อ**รายไหนก็ได้**ในทุกช่อง (ลูกค้า/ผู้ขาย) — พอเลือกในช่องที่ผู้ติดต่อยังไม่มี role นั้น ระบบ **"สร้างเงียบๆ แล้วค่อยเติม"**: เติม role + สร้างแถวลูก (`Supplier`/`Customer`) ผูก Contact ให้อัตโนมัติ โดย field ที่ขาดปล่อยว่างไว้เติมทีหลัง

สอดคล้องกับเป้าบัญชีของ spec แม่: AR + AP reconcile เข้า party record เดียว

## ขอบเขต — tracer bullet ก่อน (ไม่รื้อทั้งแอปทีเดียว)

ทำ **"ช่องผู้ขาย" ตัวเดียวให้ครบ end-to-end ก่อน** → ทดสอบจริง → แล้วค่อยทยอย migrate อีก 4 picker เป็น PR ย่อยแยกกัน

**ช่องแรกที่เลือก:** supplier picker ของ **ฟอร์มรายจ่าย (`VendorCombobox`, expense v4)** — เป็น tracer bullet ที่สะอาดสุด (จากการอ่านโค้ดจริงตอนวางแผน):
- ใช้ `contactsApi` อยู่แล้ว → เปลี่ยนแค่เลิก filter role + ค้น server-side + ใส่ badge + เรียก `ensure-role` ตอนเลือก
- เก็บ vendor เป็น **free-text** (`vendorName`/`vendorTaxId`) ไม่มี FK/supplier-detail ให้พันกัน → wiring แตะไฟล์น้อย เสี่ยงต่ำ
- ยัง exercise การ provision Supplier + เติม role ครบ (contact กลายเป็นผู้ขายจริงใน party master เพื่อ reconcile) — แค่ตัว expense เก็บ text ตามเดิม ไม่เพิ่ม schema

> เหตุที่ **ไม่เริ่มที่ PurchaseOrder**: `<select>` ผู้ขายของ PO ผูกแน่นกับข้อมูล supplier เต็ม (`hasVat`, `paymentMethods`, query `['suppliers-for-po']`) → ต้อง refetch + แตะ 3 ไฟล์ ไม่ bite-sized พอจะเป็นช่องแรก เลยย้ายไป rollout (ตอนนั้นค่อยพิสูจน์ flow provision → `supplierId` FK → save). หมายเหตุ: ใน slice 1 endpoint `ensure-role` คืน `supplierId` + มี unit test ครบอยู่แล้ว ดังนั้น path การได้ FK ถูกพิสูจน์ระดับ unit แม้ยังไม่เสียบเข้าเอกสาร

## 1. Backend

### 1.1 ค้นผู้ติดต่อทุก role — ไม่ต้องแก้ backend

`ContactsService.list()` ([contacts.service.ts:20](../../../apps/api/src/modules/contacts/contacts.service.ts#L20)) filter role เฉพาะเมื่อส่ง `dto.role` เข้ามา — **ถ้า picker ไม่ส่ง `role` มันคืนผู้ติดต่อทุก role อยู่แล้ว** และ search (ชื่อ/เบอร์/เลขภาษี/contactCode) เป็น server-side อยู่แล้ว

→ ไม่ต้องแก้ backend ส่วนค้นหา แค่ฝั่ง frontend เลิกส่ง `role` แล้วใช้ debounced server search

### 1.2 endpoint `ensure-role` (งานหลักฝั่ง backend)

`POST /contacts/:id/ensure-role` body `{ role: 'SUPPLIER' | 'CUSTOMER' }` — ทำงานใน `$transaction`:

1. โหลด Contact (`deletedAt: null`); ไม่เจอ → `NotFoundException`
2. หาแถวลูกของ role นั้นที่ผูก `contactId` อยู่แล้ว
   - **มีแล้ว** → คืน id เดิม (idempotent)
   - **ยังไม่มี** → สร้างแถวลูก:
     - `SUPPLIER` → `Supplier { name: contact.name, phone: contact.phone ?? '', contactId: contact.id }` (field อื่นมี default/null ได้หมด — required แค่ `name` + `phone`)
     - `CUSTOMER` → `Customer { name, phone: contact.phone ?? '', contactId }` (nationalId nullable แบบ walk-in quick-create อยู่แล้ว)
3. ถ้า role ยังไม่อยู่ใน `Contact.roles` → push เพิ่ม (reuse logic เดียวกับ [contact-resolver.service.ts:55-58](../../../apps/api/src/modules/contacts/contact-resolver.service.ts#L55-L58))
4. audit: `CONTACT_ROLE_ADDED` (string มีอยู่แล้วใน spec แม่ §5)
5. คืน `{ contactId, role, supplierId?, customerId? }` ให้เอกสารผูก FK ตามเดิม

**guard:** `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER','FINANCE_MANAGER','ACCOUNTANT','BRANCH_MANAGER','SALES')` (ตามคนที่สร้างเอกสารผู้ขาย/ลูกค้าได้) + เคารพ branch-access เดิม

**tracer bullet ทำเฉพาะ `SUPPLIER` ก่อน** — `CUSTOMER` provisioning (ต้องระวัง PII/encryption fields ของ Customer) ทำในเฟส rollout

### 1.3 ที่อยู่ของโค้ด

เพิ่ม method `ensureRole(tx, contactId, role)` ใน `ContactResolverService` (มี advisory-lock contactCode + role-append อยู่แล้ว) แล้ว expose ผ่าน `ContactsController`

## 2. Frontend

### 2.1 คอมโพเนนต์กลาง `ContactCombobox`

`apps/web/src/components/contacts/ContactCombobox.tsx` (reuse pattern จาก VendorCombobox เดิม)

- **Props:** `roleNeeded: 'SUPPLIER' | 'CUSTOMER'`, `value`, `onSelect(result)`, `invalid?`
- ค้นแบบ debounced server search → `contactsApi.list({ search, isActive: true, limit: 20 })` (**ไม่ส่ง role** = เห็นทุกผู้ติดต่อ) ผ่าน `useQuery` + `useDebounce`
- แต่ละแถวโชว์ **badge บอก role ที่เป็นอยู่** (ลูกค้า/ผู้ขาย/คนขายมือสอง/ไฟแนนซ์) เพื่อให้เห็นว่าใครเป็นอะไรอยู่
- **on pick** → `contactsApi.ensureRole(contactId, roleNeeded)` → ได้ `childId` → ส่ง `onSelect({ contactId, childId, name, taxId })`
- ปุ่ม **"+ เพิ่มผู้ติดต่อใหม่"** → reuse flow เพิ่มผู้ติดต่อเดิม
- tokens/sonner/leading-snug ตาม frontend.md

### 2.2 เพิ่ม API client

`apps/web/src/lib/api/contacts.ts` เพิ่ม `contactsApi.ensureRole(id, role)` → `POST /contacts/:id/ensure-role`

### 2.3 เสียบเข้าช่องผู้ขาย (tracer bullet)

เปลี่ยน supplier picker ของ PurchaseOrder ให้ใช้ `ContactCombobox roleNeeded="SUPPLIER"` → onSelect เก็บ `childId` (supplierId) ตามเดิม

## 3. "ค่อยเติมทีหลัง" — data completeness

แถวลูกที่ถูก auto-create อาจมี `phone` ว่าง → โชว์ badge **"ข้อมูลไม่ครบ"** ในหน้ารายละเอียดผู้ติดต่อ/ซัพพลายเออร์ (derive จาก `phone === ''`) เพื่อเตือนให้กลับมาเติม

## 4. การทดสอบ

- **API:** `ensureRole` idempotent (เรียกซ้ำไม่สร้างซ้ำ), union role ถูก, กรณี `phone` ว่าง, branch-access, audit `CONTACT_ROLE_ADDED`
- **Web:** `ContactCombobox` — search เห็นทุก role, เลือกผู้ติดต่อที่เป็นลูกค้าอย่างเดียวในช่องผู้ขาย → provision Supplier + ผูก contact
- **E2E:** สร้าง PO โดยเลือกผู้ติดต่อที่เป็นลูกค้าอย่างเดียว → บันทึกได้พร้อม supplierId

## 5. Rollout (หลัง tracer bullet ผ่าน)

ทยอย migrate ทีละตัว (PR ย่อย) ให้ใช้ `ContactCombobox`:

| Picker | ช่อง | roleNeeded | หมายเหตุ |
|---|---|---|---|
| PurchaseOrder supplier select | ผู้ขาย | SUPPLIER | refetch `['suppliers-for-po']` หลัง provision เพื่อได้ `hasVat`/`paymentMethods` → เก็บ `supplierId` FK |
| RepairCenterCombobox | ศูนย์ซ่อม | SUPPLIER | + คง filter `isRepairCenter` (ensure-role ต้อง set `isRepairCenter`) |
| CustomerSelectStep (สัญญา) | ลูกค้า | CUSTOMER | ต้องเปิด CUSTOMER provisioning |
| CustomerPickerStep (ประกัน) | ลูกค้า | CUSTOMER | — |
| CounterpartyPicker (รายรับอื่น) | ลูกค้า | CUSTOMER | dual-mode อยู่แล้ว |

## ไม่ทำใน v1 (YAGNI)

- migrate ทุก picker พร้อมกัน (ทำทีละตัว)
- `CUSTOMER` auto-provision (เลื่อนไปเฟส rollout — ต้องดู PII/encryption ของ Customer)
- Import Excel / auto-fill เลขภาษี DBD (เป็น feature แยก — deferred ใน spec แม่อยู่แล้ว)
- เพิ่ม `expenseSupplierId` ลง ExpenseDocument (รอเคาะตอน migrate VendorCombobox)
