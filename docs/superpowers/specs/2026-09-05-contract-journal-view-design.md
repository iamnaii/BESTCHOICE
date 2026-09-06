# บันทึกบัญชีของสัญญา (Contract Journal View) + ปุ่มบนหน้ายึดเครื่อง — Design

**วันที่:** 2026-09-05 · **สถานะ:** เจ้าของอนุมัติ design ข้อ 1-3 ในแชท (2026-09-05) · **branch:** `feat/stock-go-live-2026-09`
**ที่มา:** เจ้าของถามว่าทำไมหน้า `/repossessions` ไม่มีที่ดูการบันทึกบัญชี — ไล่โค้ดแล้วพบว่า
ไม่ใช่แค่หน้ายึดเครื่อง แต่ **ไม่มีหน้าไหนเลย** ที่แสดง JE ระดับสัญญานอกเหนือจากรับชำระ/ปิดยอด

## 1. ปัญหา (หลักฐานจากโค้ด)

| จุด | อาการ |
|---|---|
| `Repossession` model | ไม่เก็บเลข JE ที่ JP5 โพสต์ (`schema.prisma` model Repossession ไม่มี field อ้าง JE) และ `findAll` ไม่ join JE |
| `GET /payments/contract/:id/journal-entries` (`payment-query.service.ts:139-166`) | กรองเฉพาะ tag `receipt` / `2B` / `credit-allocation` / `overpayment-credit` + flow `early-payoff` ⇒ JP5 (tag `JP5` / flow `repossession`), จ่ายคืน (`refund-payout`), ไม่คืน (`refund-waive`), รับโอนหน้าร้าน (`shop-collect-settlement`), 1A, 2A, ECL ไม่โผล่ |
| `PaymentHistorySheet` | ผูก JE เข้ากับ**ใบเสร็จ** (`jesForReceipt` คืน `[]` เมื่อใบเสร็จไม่มี `paymentId`) ⇒ ต่อให้ endpoint คืน JP5 มา หน้าก็ไม่แสดง · ปุ่มเปิด sheet บน `ContractDetailPage.tsx:332` ล็อกเฉพาะ ACTIVE/OVERDUE/DEFAULT/COMPLETED/EARLY_PAYOFF |
| `JeBlock` (`PaymentHistorySheet.tsx:530-535`) | ป้าย flow hardcode 3 แบบ — JE อื่นจะถูกติดป้าย "รับชำระ (2B)" ผิด |
| สมุดรายวัน `/finance/general-journal` | กรองได้แค่ช่วงวันที่ + บริษัท ไม่มีค้นหา |
| description ของ 3 template (`refund-payout.template.ts:222`, `refund-waive.template.ts:156`, `shop-collect-settlement.template.ts:283-286`) | ใช้ `contractId.slice(0, 8)` (UUID) แทนเลขสัญญา ⇒ ค้นข้อความด้วยเลขสัญญาไม่เจอ (JP5 ใช้เลขสัญญาถูกแล้ว) |
| `/audit/financial/:contractId` | allow-list action ตายตัว ไม่มี REPOSSESSION / REFUND_* |

## 2. เป้าหมาย

ผู้ใช้ที่เห็นสัญญาได้ ต้องเปิดดู **JE ทุกใบของสัญญานั้น ทั้งสมุด FINANCE และ SHOP** ได้จาก
หน้ารายละเอียดสัญญาและจากหน้ายึดเครื่อง โดยไม่ต้องรู้วันที่หรือรหัสบัญชี

## 3. ขอบเขต

**ทำ**
1. API `GET /contracts/:id/journal-entries` — JE ทุกใบที่ stamp `metadata.contractId` ทั้งสองสมุด + ใบกลับรายการที่ชี้กลับมา
2. Web — `ContractJournalDialog` + แยก `JeBlock` เป็นไฟล์ของตัวเอง + ตารางป้าย flow/tag ครบ + ปุ่ม "บันทึกบัญชี" บน `ContractDetailPage` (ทุกสถานะยกเว้น DRAFT) + ปุ่ม "บัญชี" ต่อแถวบน `RepossessionsPage` ทั้งสองตาราง
3. แก้ description ของ 3 template ให้ใช้เลขสัญญา

**ไม่ทำรอบนี้ (แยกชิ้น)**
- ขาคู่ SHOP ตอนยึดเครื่อง (`Dr S11-2002 [ราคาตี] / Cr S21-1104` หรือ `Cr S11-1202` ธนาคาร SHOP ฝั่งจ่าย) — ต้องมี spec + golden ของตัวเอง (accounting.md บันทึกไว้แล้วว่ารอ: "ขาคู่ของ SHOP_COLLECT")
- เส้นทางขายต่อเครื่องยึด (category → PHONE_USED, ปิดแถวยึดเมื่อขาย POS, ถอด "จัดการ→ขายแล้ว", ย้าย `ownedByCompanyId`) — รอคำตัดสินเจ้าของ
- ค้นหาในสมุดรายวัน · JE รอบจ่าย INTER-CO (ตั้งใจไม่ stamp `contractId` ระดับบน — ดู accounting.md) · JE ที่ stamp เฉพาะ `metadata.newContractId`
- ซ่อนปุ่ม "คืนเครื่อง" ในวิซาร์ดรับชำระเมื่อ strict mode เปิด

## 4. Design

### 4.1 API — `GET /contracts/:id/journal-entries`

- **ที่อยู่:** `contracts.controller.ts` (โมดูลเดียวกับ `:id/shop-collect-settlement`) · `ContractsModule` import `JournalModule` อยู่แล้ว
- **สิทธิ์ (จุดตัดสินใจ A — default):** `@Roles('OWNER','BRANCH_MANAGER','FINANCE_MANAGER','ACCOUNTANT','SALES')` เหมือน `GET /contracts/:id` · branch scope ใน service ด้วย `getBranchScope(user)` — role ที่ไม่ข้ามสาขาและสัญญาอยู่คนละสาขา ⇒ `NotFoundException('ไม่พบสัญญา')` (pattern เดียวกับ `repossessions.service.findOne`) ไม่ใช่ 403 เพื่อไม่ยืนยันว่ามีสัญญาของสาขาอื่น
- **Service ใหม่:** `ContractJournalQueryService` ใน `apps/api/src/modules/journal/` (export จาก `JournalModule`) method `listForContract(contractId, user)`:
  1. โหลดสัญญา `select { id, branchId, deletedAt }` → 404 ถ้าไม่มี/ถูกลบ/ข้ามสาขา
  2. Query 1: `journalEntry.findMany({ where: { status: 'POSTED', deletedAt: null, metadata: { path: ['contractId'], equals: id } }, include: { lines }, orderBy: { postedAt: 'asc' } })` — **ไม่กรอง tag/flow/companyId**
  3. Query 2 (เมื่อ Query 1 มีผล): ใบกลับรายการที่ชี้กลับมาผ่าน `metadata.originalEntryId` (receipt-void) **หรือ** `metadata.reversesEntryId` (sweep engine: ยกเลิกสัญญา / ยกเลิกเปลี่ยนเครื่อง / reverse รอบจ่าย) โดยใช้ id ของใบใน Query 1 · ตัดซ้ำด้วย id (ใบ mirror บางประเภท stamp `contractId` อยู่แล้วจึงมาตั้งแต่ Query 1)
  4. map `companyId → companyCode` ด้วย query `companyInfo.findMany({ where: { id: { in } }, select: { id, companyCode } })` หนึ่งครั้ง
  5. map แต่ละใบด้วย util กลาง (4.2) + เติม `companyCode: 'FINANCE' | 'SHOP' | null`
  6. เรียงผลลัพธ์รวมตาม `postedAt` asc แล้ว `entryNumber` asc
- **Response:** `ContractJeView[]` (shape เดียวกับ endpoint รับชำระ + `companyCode`) — ไม่แบ่งหน้า (สัญญาหนึ่งมี JE หลักสิบใบ)

### 4.2 Mapper กลาง — `apps/api/src/modules/journal/contract-je-view.util.ts`

ย้ายบล็อก map ใน `payment-query.service.ts:200-244` (เรียง Dr ก่อน Cr, `.toFixed(2)` strings, `isBalanced`, การ coerce metadata เป็น `string | null`) ออกมาเป็น pure function
`toContractJeView(entry, nameByCode)` แล้วให้ `PaymentQueryService.getContractJournalEntries`
เรียกใช้ — **พฤติกรรมเดิมต้องเท่าเดิมทุกไบต์** (spec `payment-query.journal-entries.spec.ts` เป็นตัวคุม)

### 4.3 Web

- **`apps/web/src/components/payment/JeBlock.tsx`** — ย้าย `JeBlock`, `ContractJe`, `ContractJeLine` ออกจาก `PaymentHistorySheet.tsx` แล้ว export · `PaymentHistorySheet` import กลับ
- **`journalFlowLabel(je): { label, tone }`** ในไฟล์เดียวกัน — ตาราง flow/tag → ป้ายไทย (อ่าน `flow` ก่อน `tag`):

  | flow / tag | ป้าย |
  |---|---|
  | `receipt-void`, tag `REVERSAL`, `*-reverse`, `exchange-cancel`, `contract-cancellation` | กลับรายการ (tone destructive) |
  | tag `1A` | เปิดสัญญา (1A) |
  | tag `2A` / flow `accrual` | รับรู้รายได้งวด (2A) |
  | tag `2B` / `receipt` / flow `payment-receipt`, `2b-receipt*` | รับชำระ (2B) |
  | `credit-allocation`, `overpayment-credit`, `paysolutions-surplus-advance` | เครดิต/จ่ายเกิน |
  | `early-payoff` | JP4 — ปิดยอดก่อนกำหนด |
  | `repossession` | JP5 — ยึดเครื่อง |
  | `refund-payout` | จ่ายเงินคืนส่วนต่างลูกค้า |
  | `refund-waive` | ไม่คืนเงินส่วนต่าง → รายได้ยึด |
  | `shop-collect-settlement` | รับโอนจากหน้าร้าน (ล้าง 11-2107) |
  | `provision`, `write-off`, tag `BAD-DEBT` | ค่าเผื่อหนี้ / ตัดหนี้สูญ |
  | `stage-reverse`, `exchange-ecl-reversal` | กลับค่าเผื่อหนี้ |
  | `reschedule-*`, tag `6a` / `6b` | ปรับดิว (JP6) |
  | `mandatory`, tag `VAT60-*` | VAT 60 วัน |
  | `shop-inventory-transfer-*`, `shop-down-payment*`, `shop-exchange-return`, `shop-cash-sale`, `shop-external-finance-*` | SHOP — ตามชื่อ (โอนกรรมสิทธิ์/รับเงินดาวน์/รับเครื่องคืน/ขายสด/ไฟแนนซ์ภายนอก) |
  | `exchange-*` | เปลี่ยนเครื่อง |
  | อื่น ๆ | `tag ?? flow ?? 'อื่น ๆ'` |

  `JeBlock` เปลี่ยนมาใช้ helper นี้ — 3 เคสเดิมของ `PaymentHistorySheet` ได้ป้ายเดิม (`กลับรายการ (VOID)`, `JP4 — ปิดยอดก่อนกำหนด`, `รับชำระ (2B)`) เหมือนเดิม
- **`apps/web/src/components/contract/ContractJournalDialog.tsx`** — props `{ contractId, contractNumber, open, onClose }` · `useQuery(['contract-journal', contractId])` → `GET /contracts/:id/journal-entries` · จัดกลุ่มตาม `companyCode` (FINANCE ก่อน SHOP, `null` ท้ายสุดในกลุ่ม "ไม่ระบุสมุด") · หัวกลุ่ม: ชื่อสมุด + จำนวนใบ + Σ Dr · แต่ละใบ = `JeBlock` · empty state "ยังไม่มีบันทึกบัญชีของสัญญานี้" · error state ผ่าน `QueryBoundary` · ใช้ `Dialog` จาก `@/components/ui/dialog` (primitive เดียวกับ `PaymentHistorySheet`)
- **`ContractDetailPage.tsx`** — ปุ่ม "บันทึกบัญชี" (icon `BookOpen`) ข้าง "ประวัติการชำระ" แสดงเมื่อ `contract.status !== 'DRAFT'` (จุดตัดสินใจ B — default ซ่อนใน DRAFT เพราะยังไม่มี JE)
- **`RepossessionsPage.tsx`** — ปุ่มข้อความ "บัญชี" ต่อแถว ทั้งตาราง "รอยึดเครื่อง" (มี 1A/2A/ECL ให้ดู) และตาราง "ยึดคืน & ขายต่อ" เปิด `ContractJournalDialog` ในหน้าเดิม

### 4.4 description ของ 3 template

`refund-payout` / `refund-waive` / `shop-collect-settlement` ค้น `contractNumber` เอง
(`client.contract.findUnique({ where: { id }, select: { contractNumber: true } })`) แล้วเขียน
`สัญญา ${contractNumber}` — fallback เป็น `contractId.slice(0, 8)` เมื่อไม่พบ (ไม่ควรเกิด) ·
`reference` / `metadata` / idempotency probe **ไม่เปลี่ยน** (จับที่ metadata ไม่ใช่ข้อความ) ·
ตรวจแล้วไม่มี spec ผูก description ทั้ง 3 ไฟล์

## 5. Tests

- **API (jest, mock prisma ตามแบบ `payment-query.journal-entries.spec.ts`):** `contract-journal-query.service.spec.ts` — 404 เมื่อไม่มี/ถูกลบ/ข้ามสาขา (BM) · where ของ Query 1 ไม่มี tag/flow/companyId · Query 2 รวมทั้ง `originalEntryId` และ `reversesEntryId` และตัดซ้ำ · `companyCode` map ถูก · เรียงตาม `postedAt`
- **API:** `payment-query.journal-entries.spec.ts` เดิมต้องผ่านโดยไม่แก้ (พิสูจน์ว่า mapper ย้ายแล้วเท่าเดิม)
- **API:** unit ใหม่ว่า description ของ 3 template มีเลขสัญญา
- **Web (vitest + RTL):** `JeBlock.test.tsx` ตาราง `journalFlowLabel` (JP5, refund, กลับรายการ, fallback) · `ContractJournalDialog.test.tsx` จัดกลุ่มสองสมุด + empty state · `PaymentHistorySheet.je-dialog.test.tsx` เดิมต้องผ่าน
- `./tools/check-types.sh all` = 0 error

## 6. ไม่มี migration / seed / config ใหม่

## 7. อ้างอิง

- `.claude/rules/accounting.md` — JE templates, metadata stamps, "ขาคู่ของ SHOP_COLLECT ยังไม่มี"
- `apps/api/src/modules/payments/services/payment-query.service.ts` — endpoint รับชำระเดิม
- `apps/web/src/components/payment/PaymentHistorySheet.tsx` — `JeBlock` ต้นทาง
- คำวินิจฉัยผู้สอบที่เกี่ยว: `docs/accounting/cpa-answers-2026-08-24.md` A1 / B2 (รอบ 1 และ 2), `case-5-repossession.csv` (FINANCE ไม่ตั้งสต็อกเครื่องยึด — Dr เงินที่ราคากลาง)
