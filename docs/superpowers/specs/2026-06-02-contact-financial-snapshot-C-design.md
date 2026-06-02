# Contact Financial Snapshot (Sub-project C, thin)

วันที่: 2026-06-02
สถานะ: รออนุมัติ spec จาก owner
ส่วนหนึ่งของ: PEAK-style contact expansion (A → B → C). อันนี้คือ **C** (thin หลัง scrutinize).

> **C reworked หลัง scrutinize:** คำขอเดิม "แท็บภาพรวมการเงิน" (ยอดขาย/AR aging/doc list/กราฟ แบบ PEAK) ถูกตัดเหลือ **snapshot สั้นๆ** เพราะภาพการเงินลูกค้าเต็มมีอยู่แล้วบน `CustomerDetailPage` (ตาราง contracts, KPI active/overdue, risk panel) และมี endpoint `GET /customers/:id/summary` (outstanding + active/overdue) อยู่แล้ว. ทำเต็มบนหน้า contact = duplicate. A1 ก็ deep-link ไปหน้าลูกค้าเต็มได้อยู่แล้ว.

## หลักการ

- **reuse `GET /customers/:id/summary` ที่มีอยู่** — ไม่เขียน aggregate ใหม่
- frontend ล้วน — **ไม่มี backend change / schema / migration**
- โชว์ snapshot บน A1 CustomerCard (ที่ ContactDetailPage มีแล้ว) ไม่สร้างแท็บใหม่

## ขอบเขต

ทำ:
- `customersApi.summary(id)` ใน web api client (เรียก `GET /customers/:id/summary`)
- A1 `CustomerCard` (ใน `ContactDetailPage.tsx`) fetch summary ด้วย react-query → โชว์ **ยอดค้างชำระ (outstanding) + สัญญา active + ค้างชำระ (overdue)** เหนือปุ่ม deep-link เดิม
- loading / error / empty handled (snapshot ไม่ขึ้นถ้า fetch fail — ไม่พังการ์ด)

ไม่ทำ:
- backend endpoint ใหม่ / aggregate ใหม่ / schema (reuse `/customers/:id/summary`)
- กราฟ / doc list / AR aging / lifetime revenue (มีบน CustomerDetailPage / YAGNI)
- snapshot ฝั่ง supplier (ไม่มี endpoint เทียบเท่า — นอก scope)
- แท็บ "ภาพรวม" ใหม่ (โชว์ inline บน CustomerCard แทน)

## 1. Backend
ไม่มีการเปลี่ยนแปลง. ใช้ `GET /customers/:id/summary` เดิม (controller `customers.controller.ts:233`, roles OWNER/BM/FM/ACC/SALES) ที่คืน:
```
{ id, name, phone, activeContracts: number, overdueCount: number, outstanding: <Decimal aggregate> }
```
> NB: implementer ต้องยืนยัน shape จริง (`outstanding` อาจเป็น `{ _sum: { ... } }` หรือ number) จาก `customers.service.ts getSummary` แล้ว map ให้ถูกใน api client.

## 2. Frontend

`apps/web/src/lib/api/customers.ts` (หรือไฟล์ api client ลูกค้าที่มีอยู่ — ถ้าไม่มีให้สร้าง minimal):
```ts
export interface CustomerSummary { id: string; name: string; phone: string | null; activeContracts: number; overdueCount: number; outstanding: number; }
export const customersApi = { summary: (id: string) => api.get<CustomerSummary>(`/customers/${id}/summary`).then(r => r.data) };
```
(map `outstanding` ให้เป็น number ตาม shape จริง)

`apps/web/src/pages/ContactDetailPage.tsx` — `CustomerCard`:
- `useQuery({ queryKey: ['customer-summary', customer.id], queryFn: () => customersApi.summary(customer.id) })`
- โชว์ field: ยอดค้างชำระ (฿, format) · สัญญา active (จำนวน) · ค้างชำระ (overdueCount, เน้นสีถ้า >0)
- ระหว่างโหลด: skeleton/`—` ; fetch fail: ซ่อน snapshot (การ์ดยังแสดงชื่อ+ปุ่มลิงก์ปกติ)
- ปุ่ม deep-link `/customers/:id` เดิมคงไว้
- semantic tokens, Thai `leading-snug`

## 3. ทดสอบ
- web: `CustomerCard` (ผ่าน ContactDetailPage test) — mock `customersApi.summary` → render ยอดค้าง + active + overdue; กรณี fetch reject → การ์ดยังขึ้นชื่อ+ลิงก์ (snapshot ซ่อน) ไม่ crash
- ไม่มี backend test (ไม่แตะ backend)

## หมายเหตุ
ถ้าวันหน้าต้องการ snapshot ฝั่ง supplier ด้วย — ต้องมี supplier summary endpoint ก่อน (ยังไม่มี) แยกพิจารณานอก C
