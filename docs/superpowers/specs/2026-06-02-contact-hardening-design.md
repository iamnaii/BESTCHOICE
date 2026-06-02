# Contact Hardening — unify trade-in sellers, fix merge, partial-unique keys

วันที่: 2026-06-02
สถานะ: รออนุมัติ spec จาก owner

## ที่มา
จาก audit ระบบ contact party-master พบ edge cases หลายจุด. owner เลือกแก้ชุด 1+2+3:
1. **(I2)** trade-in seller ไม่รวมกับลูกค้า/ผู้ขายเดิม (keyless เสมอ) → ผู้ซื้อที่เอาเครื่องมาขาย = 2 contacts
2. **(C1+M2)** `merge()` ทิ้ง identity fields ของตัวซ้ำ (ข้อมูลหาย) + ไม่มี audit + ไม่มี UI
3. **(C2+C3)** unique เต็มตาราง + ไม่มี unique บน nationalIdHash → soft-deleted จอง key (re-create = 500) + race สร้าง contact ซ้ำ

ลำดับทำ (พึ่งกัน): **3 → 1 → 2**.

---

## ส่วนที่ 3 — Partial unique index + P2002 retry (รากฐาน)

### Schema
- เอา `@@unique([taxId])` ออกจาก `model Contact` (เก็บ field `taxId`).
- เพิ่ม **partial unique index แบบ raw SQL** ใน migration:
  - `CREATE UNIQUE INDEX IF NOT EXISTS contacts_tax_id_active_key ON contacts(tax_id) WHERE deleted_at IS NULL;`
  - `CREATE UNIQUE INDEX IF NOT EXISTS contacts_national_id_hash_active_key ON contacts(national_id_hash) WHERE deleted_at IS NULL;`
  - (Postgres unique ปล่อย NULL ซ้ำได้ → keyless contacts หลายตัว national_id_hash/tax_id = NULL ไม่ชนกัน; เฉพาะ non-null ที่ unique ต่อ "ยังไม่ถูกลบ")
- `contactCode` คง `@unique` เดิม (ไม่ reuse code อยู่แล้ว).
- migration ตั้ง synthetic timestamp ให้เรียงท้ายสุด (> ตัวล่าสุดใน history) — บทเรียนลำดับ migration เดิม.

### ⚠️ Deploy-safety (สำคัญ — migration อาจ fail บน prod ถ้ามีข้อมูลซ้ำ)
ก่อน `CREATE UNIQUE INDEX` ต้องไม่มี non-null `tax_id`/`national_id_hash` ซ้ำในแถว deleted_at IS NULL. แผนจะมี **pre-check query** (รันก่อน): 
```sql
SELECT tax_id, count(*) FROM contacts WHERE deleted_at IS NULL AND tax_id IS NOT NULL GROUP BY tax_id HAVING count(*)>1;
-- เช่นเดียวกับ national_id_hash
```
ถ้าเจอซ้ำ → dedupe (merge ด้วยมือ/CLI) ก่อน แล้วค่อย apply index. รันบน dev (37 rows) ก่อน — น่าจะไม่มีซ้ำ (resolver/backfill กันไว้แล้ว) แต่ต้องเช็คจริงก่อน prod.

### Resolver (`contact-resolver.service.ts`)
`findOrCreateByNaturalKey`: ห่อ `create` ด้วย try/catch — ถ้า `P2002` (unique race) → re-fetch by natural key (taxId/nationalIdHash) แล้ว attach role + return (เหมือน existing-match path). กัน race C3 + กรณีตกค้าง.

### ทดสอบ
- migration apply บน dev สะอาด (reset replay) + index มีจริง
- resolver: จำลอง create โยน P2002 → re-fetch + attach role (ไม่ throw)
- unit: keyless (null) สร้างหลายตัวได้ ; non-null ซ้ำ → match เดิม ไม่สร้างใหม่

---

## ส่วนที่ 1 — Trade-in auto-merge (I2)

### Backend (`trade-in.service.ts` create, ~line 196)
แทน `nationalIdHash: null` คงที่ ด้วย logic:
- ถ้า `dto.customerId` → load customer, ใช้ `customer.nationalIdHash` (หรือถ้ามี `customer.contactId` แล้ว set `sellerContactId = customer.contactId` ตรงๆ + attach role) — เลือกทางที่ตรงสุด: ส่ง `nationalIdHash: customer.nationalIdHash` ให้ resolver (จะ match contact เดิมของลูกค้า)
- else ถ้า `dto.sellerIdCardNumber` → `nationalIdHash = pii.hash(normalizeNationalId(sellerIdCardNumber))` โดย **normalize เหมือน Customer เป๊ะ**: `raw.replace(/[\s-]/g,'').toUpperCase()` ([customers.service.ts:459-461](../../apps/api/src/modules/customers/customers.service.ts)) แล้ว `CustomerPiiService.hash()` (salt เดียวกัน)
- else → `nationalIdHash: null` (keyless เดิม)
- ส่งให้ `findOrCreateByNaturalKey(tx, { name: sellerName, taxId: null, nationalIdHash: <above>, phone: sellerPhone, role: 'TRADE_IN_SELLER' })`
- inject `CustomerPiiService` เข้า trade-in.service (+ TestModeModule/CustomersModule ตามที่ export `hash`)

### ทดสอบ
- trade-in ของลูกค้าที่มี `nationalIdHash` เดิม → ได้ contact เดียวกัน, roles เพิ่ม `TRADE_IN_SELLER` (ไม่สร้างใหม่)
- มี `sellerIdCardNumber` ตรงกับลูกค้า (normalize ก่อน) → match contact ลูกค้า
- ไม่มี key → keyless สร้างใหม่เหมือนเดิม
- existing trade-in tests เขียว

---

## ส่วนที่ 2 — Merge: C1 + audit (M2) + UI

### Backend (`contacts.service.ts` merge)
ใน `$transaction` ก่อน soft-delete duplicate:
- **carry identity fields**: สำหรับ `taxId, nationalIdHash, peakContactCode, phone, email` — ถ้า primary เป็น null/ว่าง แต่ duplicate มี → set ค่าจาก duplicate ลง primary (coalesce). ทำพร้อม `roles: { set: unionRoles }` ในการ update primary เดียว.
  - (partial unique จากส่วน 3 ทำให้ copy taxId ลง primary ได้ เพราะ duplicate ถูก soft-delete → ออกจาก unique scope)
- เขียน audit `CONTACTS_MERGED` (entity `contact`, entityId primaryId, newValue `{ duplicateId, mergedRoles, carriedFields }`) ใน tx เดียวกัน
- คง repoint FK (customer/supplier/tradeIn/finance) + soft-delete duplicate เดิม

### Frontend
- `contactsApi.merge` มีแล้ว — เพิ่ม UI:
- หน้า ContactDetailPage (OWNER): ปุ่ม **"รวมผู้ติดต่อซ้ำ"** → เปิด dialog ที่ **ค้นหา contact อื่น** (reuse `GET /contacts?search=`) → เลือกตัวที่จะยุบเข้า contact นี้ (contact ปัจจุบัน = primary, ตัวที่เลือก = duplicate) → ConfirmDialog destructive แสดงสรุป (role/ฟิลด์ที่จะรวม) → `contactsApi.merge(primaryId=current, duplicateId=selected)` → invalidate + toast + (duplicate ถูกยุบ → อาจ refetch/นำทาง)
- OWNER เท่านั้น (ปุ่มซ่อนสำหรับ role อื่น)

### ทดสอบ
- backend merge: primary ไม่มี taxId + duplicate มี → หลัง merge primary ได้ taxId ; audit เขียน ; role union ; duplicate soft-deleted ; FK repointed
- merge ตัวเอง → BadRequest (เดิม)
- web: ปุ่ม + search dialog + confirm + เรียก merge ด้วย id ถูก

---

## นอก scope (backlog จาก audit — ไม่ทำรอบนี้)
I1 (supplier taxId ซ้ำ — share เป็น policy ที่ตั้งใจ, แค่ handle P2002 ซึ่งส่วน 3 ช่วยแล้ว), I3 (PII_HASH_SALT plaintext fallback — ควรแก้แยกเป็น security cleanup), I4 (stale roles), I5 (stale name/phone), M1 (P-99999 ceiling), M3 (findOne PII to SALES). บันทึกไว้ทำรอบหน้า.
