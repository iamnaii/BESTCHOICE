# เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — รอบจ่ายแบบ Batch + ลงบัญชี 2 ฝั่ง — Design

- **วันที่:** 2026-07-30
- **สถานะ:** design approve โดย owner แล้ว (หลัง scrutinize) — รอเขียน implementation plan
- **สถานะ (2026-08-01):** IMPLEMENTED T1-T7 บน branch `feat/interco-settlement-batch` — schema, pending engine, batch lifecycle, approve/reverse (paired JE + drift/period/SoD guards), endpoints + retire เส้นจ่ายเก่า (`settle` → 410, `shop-finance-settlement` module ลบ, `VendorClearanceTemplate`/`ShopFinanceReceiptTemplate` ลบ), web UI (2 แท็บ), docs (`.claude/rules/accounting.md` + `docs/accounting/interco-preflight-2026-08.sql`) ครบตาม plan `docs/superpowers/plans/2026-07-30-interco-settlement-batch.md` — รอ code review + เปิด PR
- **ที่มา:** คำสั่ง owner ข้อ C2 (2026-07-30, spec device-swap §13): เจ้าหนี้ 21-1101/21-1102 "กำลังจะเปิดใช้" — FINANCE กับหน้าร้านล้างกันผ่านเมนูจ่ายให้หน้าร้าน + finding F3 เดิม (VendorClearance unwired ทั้งระบบ)

## 1. การตัดสินใจของ owner (2026-07-30)

| # | เรื่อง | คำตอบ |
|---|---|---|
| D1 | รูปแบบการจ่าย | **โอนเป็นรอบ (batch)** — หลายสัญญารวม 1 ยอดโอน → เอกสาร "รอบจ่าย" 1 ใบ = JE ฝั่งละ 1 ใบ เทียบ statement บรรทัดต่อบรรทัด |
| D2 | ของเก่าที่ค้าง | **เงินโอนจริงไปแล้ว (นอกระบบ)** → ต้องมีโหมดบันทึกย้อนหลัง จับกลุ่มสัญญาตามรอบโอนจริง + วันที่ตาม statement |
| D3 | การอนุมัติ | **สองขั้น (maker–checker)** — ACC/FM สร้างรอบ+แนบหลักฐาน → OWNER/FM อนุมัติ (คนอนุมัติ ≠ คนสร้าง) → JE post ตอนอนุมัติ |
| D4 | รอบย้อนหลังตกเดือนที่ปิดงบแล้ว | default: **ลงวันแรกของเดือนที่ยังเปิด + จดวันโอนจริงใน memo** (JE นี้ไม่แตะ VAT — ไม่กระทบ ภ.พ.30); ทางเลือกสำรอง: OWNER เปิดงวดผ่าน flow `PERIOD_REOPENED` เดิม |

## 2. สภาพระบบปัจจุบัน (หลักฐานจากโค้ด — สำรวจ 2026-07-30)

| ชิ้น | สถานะ | หลักฐาน |
|---|---|---|
| ตั้งเจ้าหนี้ FINANCE | ✅ ทุกสัญญา: 1A → Cr 21-1101 (`financedAmount`) + Cr 21-1102 (`storeCommission ?? 10%×financed`) metadata `{tag:'1A', contractId}` | `contract-activation-1a.template.ts` |
| ตั้งลูกหนี้ SHOP | ⚠️ เฉพาะสัญญา activate ตั้งแต่ **2026-06-23** (commit `bbcfa7a3` PR #1280) ผ่าน `contract-workflow.service.ts:540` — สัญญาก่อนหน้านั้น + สัญญาจาก **contract-exchange (device swap)** ไม่มี Dr S11-3001/S11-3002 | git log -S + grep exchange service |
| ตาราง `InterCompanyTransaction` | สร้างจาก `sale-writer` เท่านั้น (`contractId` nullable) — ไม่ครอบ exchange; ยอด snapshot ตอนขาย ไม่ใช่ตอน 1A | schema:4360, sale-writer:344 |
| จ่ายฝั่ง FINANCE (เส้นเก่า) | มี: `intercompany/` `settle({transactionId})` → JE inline Dr 21-1101+21-1102 / Cr bank, metadata **ไม่มี contractId** | intercompany.service.ts:102-220 |
| จ่ายฝั่ง SHOP (เส้นเก่า) | มี service `shop-finance-settlement/` (ต่อสัญญา, ใช้ `storeCommission ?? 0` — **ไม่ตรง 1A ที่ fallback 10%**) แต่**ไม่ได้ต่อ UI** | shop-finance-settlement.service.ts:35-56 |
| ยอดค้างบนหน้าจอ | 🔴 สูตรผิด chart เก่า: SHOP อ่าน `11-2105`, FINANCE อ่านแค่ `21-1102` (ไม่รวมยอดจัด) → เลขบนจอ + ตัวกันจ่ายเกิน เชื่อไม่ได้ | intercompany.service.ts:32-75 |
| UI | มีหน้า `/accounting/intercompany` + เมนู "จ่ายให้หน้าร้าน (Inter-co)" อยู่แล้ว — เรียกเส้นเก่า | IntercompanySettlementPage.tsx, menu.ts:422,557 |
| `VendorClearanceTemplate` | dead code — ไม่มี caller | grep |
| `ShopFinanceReceiptTemplate` | มีแค่เช็ค Dr=Cr — **ไม่มีตัวกันเครดิตเกิน GL** | shop-finance-receipt.template.ts:120-127 |

## 3. โมเดลข้อมูลใหม่

```prisma
model InterCoSettlementBatch {
  id             String   @id @default(uuid())
  batchNumber    String   @unique              // IC-YYYYMMDD-NNNN (DocNumberService pattern, BKK day)
  status         InterCoBatchStatus @default(DRAFT)  // DRAFT → PENDING_APPROVAL → POSTED → REVERSED (+ CANCELLED จาก DRAFT/PENDING)
  transferDate   DateTime                       // วันโอนจริงตาม statement
  postedAt       DateTime?                      // วันที่ลงบัญชีจริง (ต่างได้ตาม D4)
  financeBankCode String                        // default '11-1201'
  shopBankCode    String                        // default 'S11-1201'
  totalFinanced  Decimal @db.Decimal(12, 2)
  totalCommission Decimal @db.Decimal(12, 2)
  totalAmount    Decimal @db.Decimal(12, 2)     // = financed + commission (ยอดโอนจริง)
  shopPostedAmount Decimal @db.Decimal(12, 2)   // ส่วนที่ฝั่ง SHOP ลงจริง (≤ totalAmount — F1)
  transferRef    String?                        // เลขอ้างอิงโอน/สลิป
  slipFileKey    String?                        // S3 key (optional)
  note           String?
  makerId        String
  approverId     String?
  financeJournalEntryId String? @unique
  shopJournalEntryId    String? @unique         // null ได้ (รอบ legacy ล้วน — F1)
  createdAt/updatedAt/deletedAt                 // convention เดิม
}

model InterCoSettlementItem {
  id          String  @id @default(uuid())
  batchId     String                            // FK → batch (Restrict)
  contractId  String                            // FK → contract (Restrict)
  financedGl  Decimal @db.Decimal(12, 2)        // snapshot จาก GL 21-1101 คงเหลือของสัญญา ณ เวลาสร้าง
  commissionGl Decimal @db.Decimal(12, 2)       // snapshot จาก GL 21-1102 คงเหลือ
  shopFinancedGl Decimal @db.Decimal(12, 2)     // GL S11-3001 คงเหลือ (0 = legacy/exchange — F1/F2)
  shopCommissionGl Decimal @db.Decimal(12, 2)   // GL S11-3002 คงเหลือ
  legacyNoShop Boolean @default(false)          // ธง F1/F2 — ฝั่ง SHOP ไม่ post ให้สัญญานี้
  @@unique([batchId, contractId])
}
```

- กันสัญญาซ้ำ**ข้ามรอบ**: enforce ใน service tx ตอน approve (Prisma ทำ partial-unique อิงสถานะตารางแม่ไม่ได้) — เช็คว่า contract ไม่อยู่ใน batch อื่นสถานะ `PENDING_APPROVAL/POSTED` + drift guard (§5) เป็นตาข่ายชั้นสอง (GL เหลือ 0 → รอบซ้อนตกทันที)

## 4. เครื่องคิด "คิวรอจ่าย" (pending engine — แก้บั๊กสูตรเก่าไปในตัว)

ต่อสัญญา (ทุกสถานะสัญญา — GL เป็นตัวตัดสิน ไม่ใช่ status):

```
payableOrigin_i = Σ Cr − Σ Dr ของ 21-1101 (+21-1102 แยกคอลัมน์) จาก JE ที่ metadata.contractId = i
                  (จับ 1A + JV มือที่ประทับ contractId — JE ของ "รอบจ่าย" ไม่เข้าเลนส์นี้โดยตั้งใจ)
settled_i       = EXISTS InterCoSettlementItem ของสัญญา i ใน batch สถานะ PENDING_APPROVAL/POSTED
คิวรอจ่าย       = payableOrigin_i > 0 AND NOT settled_i
```

- **เหตุผลที่แยกสองเลนส์**: journal_lines ไม่มีคอลัมน์ metadata และ JE รอบจ่าย 1 ใบครอบหลายสัญญา (มี `metadata.items[]` ไม่ใช่ `contractId` เดี่ยว) — ถ้า netting ด้วย GL ล้วนจะ attribute ขา Dr กลับเข้าสัญญาไม่ได้ (บั๊กแบบเดียวกับเส้นเก่า F3) → ใช้ **ตาราง item เป็นบันทึกการจ่ายรายสัญญา** (v1 จ่ายเต็มยอดคงเหลือเสมอ — ไม่มี partial ตาม §13) + reverse รอบ → batch เป็น REVERSED → item หลุดเงื่อนไข → สัญญากลับเข้าคิวเองโดยไม่ต้องแก้ GL lens
- **Reconcile view ระดับบัญชี**: ยอดรวมคิวรอจ่าย ต้อง = GL ทั้งบัญชี 21-1101+21-1102 (รวมขา Dr ของรอบ) — โชว์คู่กันบนหน้าจอเป็น sanity check; เพี้ยน = มี JE แปลกปลอม/JE เส้นเก่า
- **แหล่งยอด = GL เท่านั้น** — ห้ามใช้ `contract.financedAmount/storeCommission` (F4: field null ↔ JE fallback 10% ไม่ตรงกัน)
- JE เส้นเก่า (`inter-company-settlement`) ไม่มี contractId → **pre-flight prod ต้องนับก่อนเปิดใช้** (§10); ถ้าพบ >0 ทำ opening reconcile ก่อน
- ฝั่ง SHOP แสดงคู่กัน: `shopFinanced_i` = GL S11-3001 ของสัญญา (via metadata.contractId), `shopCommission_i` = S11-3002 — ถ้าเป็น 0 ทั้งคู่ → ติดธง **LEGACY_NO_SHOP** (สัญญาก่อน 2026-06-23 หรือจาก exchange — F1/F2)
- หน้าเดิม `getOutstandingBalance` แก้สูตรเป็น: FINANCE = GL 21-1101+21-1102 (companyId FINANCE), SHOP = S11-3001+S11-3002 (companyId SHOP) + แสดง drift พร้อมคำอธิบายว่า drift ที่เหลือ = legacy pre-wiring (ไม่ใช่ bug)

## 5. ลงบัญชีตอนอนุมัติ (atomic ผ่าน `PairedJournalService`)

ใน `$transaction` เดียว:

1. **Drift guard 4 บัญชี ต่อสัญญา** (ใน tx, ก่อน post): `payableOrigin_i` ปัจจุบัน (เลนส์ §4) ต้อง = `financedGl/commissionGl` ที่ snapshot ไว้ใน item (±0.01) และเลนส์เดียวกันบน S11-3001/S11-3002 ต้อง = snapshot ฝั่ง SHOP — จับ JV มือ/เหตุการณ์ที่แตะบัญชีระหว่าง snapshot→approve; ไม่ตรง → reject ทั้งรอบ พร้อมรายชื่อสัญญาที่ drift (กด refresh สร้างรอบใหม่) | กันจ่ายซ้ำ: เช็ค `settled_i` (item ในรอบอื่น PENDING_APPROVAL/POSTED) ตั้งแต่ตอน submit และซ้ำอีกครั้งใน tx นี้
2. **Period guard ทั้ง 2 บริษัท**: `validatePeriodOpen(postedAt, FINANCE)` + `validatePeriodOpen(postedAt, SHOP)` (SHOP มีงวดของตัวเอง)
3. **FINANCE JE (1 ใบ/รอบ):**
   ```
   Dr 21-1101  Σ financedGl        (บรรทัดแยกต่อสัญญา + description เลขสัญญา)
   Dr 21-1102  Σ commissionGl      (บรรทัดแยกต่อสัญญา)
      Cr 11-1201 (หรือบัญชีที่เลือก)  totalAmount
   metadata: { flow:'interco-settlement-batch', batchId, side:'FINANCE' } — ต่อบรรทัดมี contractId ใน description; ต่อ JE มี items[] {contractId, financed, commission} ใน metadata
   ```
4. **SHOP JE (1 ใบ/รอบ — เฉพาะสัญญาที่ `legacyNoShop=false`):**
   ```
   Dr S11-1201                     shopPostedAmount
      Cr S11-3001  Σ shopFinancedGl
      Cr S11-3002  Σ shopCommissionGl
   ```
   - **cap ต่อสัญญาที่ GL จริง** (F1) — รอบที่มีแต่สัญญา legacy → ไม่สร้าง SHOP JE เลย (`shopJournalEntryId = null`), เอกสารแสดงหมายเหตุ "ฝั่ง SHOP: ไม่มียอดตั้งต้น (ก่อน wiring 2026-06-23 / สัญญาเปลี่ยนเครื่อง)"
   - ความต่าง `totalAmount − shopPostedAmount` = เงินที่ SHOP รับจริงแต่สมุด SHOP ไม่มีลูกหนี้รองรับ → **ไม่เดาลงบัญชีแทน** — เป็นคำถาม opening balance ถึง CPA (§11)
5. Idempotency: `metadata.flow + batchId` (partial unique index เดิม `journal_entries_idempotency_idx` ครอบ) — ฝั่งละ key (`:FINANCE` / `:SHOP`)
6. `InterCompanyTransaction` ที่ `contractId` ตรงกับ item → mark `RECONCILED` (best-effort — ไม่มีก็ข้าม ไม่ block)
7. Batch → `POSTED` + audit `INTERCO_BATCH_APPROVED` (+ `INTERCO_BATCH_CREATED/REVERSED/CANCELLED` ในจุดของมัน — entity `interco_settlement_batch`)

**ยกเลิกรอบที่ POSTED:** mirror-reverse JE ทั้ง 2 ใบ (pattern REVERSAL เดิม + `reversesEntryId`) → batch `REVERSED` → สัญญากลับเข้าคิวอัตโนมัติ (GL กลับมามียอด) — role OWNER/FM + เหตุผล ≥10 ตัวอักษร

## 6. Maker–Checker (D3)

- สร้าง/แก้ DRAFT + submit: `ACCOUNTANT`, `FINANCE_MANAGER` | อนุมัติ: `OWNER`, `FINANCE_MANAGER` โดย **approver ≠ maker** (server-side เช็ค — pattern tolerance approver เดิม)
- DRAFT แก้ได้/ลบได้ (soft), PENDING_APPROVAL แก้ไม่ได้ (ถอนกลับ DRAFT ได้โดย maker), POSTED แตะไม่ได้นอกจาก reverse
- แนบสลิป: upload S3 (optional — บังคับไม่ได้เพราะรอบ backfill บางรอบอาจไม่มีสลิปเหลือ)

## 7. โหมดย้อนหลัง (D2 + D4)

ฟอร์มเดียวกัน — ใส่ `transferDate` ในอดีต:
- งวดเปิดอยู่ → `postedAt = transferDate`
- งวดปิดแล้ว → UI เสนอ default `postedAt` = วันแรกของเดือนเปิดที่เร็วสุด + JE description ระบุ "โอนจริง {transferDate}" (D4); ปุ่มทางเลือก "เปิดงวด" ลิงก์ไป flow reopen เดิม (OWNER)
- รอบ backfill หลายรอบ = สร้างหลาย batch ตามรอบโอนจริงใน statement (คนละใบ คนละวันที่)

## 8. UI (rebuild หน้าเดิม `/accounting/intercompany`)

- **แท็บ 1 "รอจ่าย"**: ตารางสัญญาค้างจ่ายจาก pending engine (เลขสัญญา/ลูกค้า/วัน activate/ยอดจัด/ค่าคอม/ธง LEGACY) + เลือกหลายรายการ → "สร้างรอบจ่าย" (สรุปยอดรวม + วันที่โอน + บัญชี + สลิป)
- **แท็บ 2 "รอบจ่าย"**: รายการ batch ทุกสถานะ + detail (รายสัญญา, JE ทั้งสองฝั่ง ลิงก์ไปดู, ผู้สร้าง/ผู้อนุมัติ, ปุ่มอนุมัติ/ถอน/ยกเลิก/reverse ตาม role+สถานะ) — ปุ่มอนุมัติแสดง preview JE 2 ฝั่งก่อนยืนยัน
- เมนู: ป้ายเดิม "จ่ายให้หน้าร้าน (Inter-co)" คงไว้; ตัดป้ายซ้ำ "ชำระเงินระหว่างบริษัท" (menu.ts:422) ให้เหลือชื่อเดียวกันทุก role

## 9. เก็บกวาดของเก่า

| ของ | ทำอะไร |
|---|---|
| `intercompany.settle` + `settleWithJournal` (ต่อรายการ) | retire — controller ตอบ 410 พร้อมข้อความชี้ไปเมนูใหม่ (กันสคริปต์เก่ายิงซ้ำ) |
| `shop-finance-settlement` controller/endpoints | retire ทั้ง module (service logic ย้ายเข้าเครื่องใหม่); template `ShopFinanceReceiptTemplate` เลิกใช้ (JE รอบใหม่ post ผ่าน PairedJournalService โดยตรง) |
| `VendorClearanceTemplate` | ลบ (dead code) + ลบออกจาก journal.module |
| `getOutstandingBalance` | แก้สูตรตาม §4 (หน้า FinanceReceivablePage/รายงาน Inter-co ที่อ่านตัวเดิมได้ของถูกไปด้วย) |
| `InterCompanyTransaction` | คงไว้ (read-only history + mark RECONCILED) — ไม่ retire โมเดลใน sprint นี้ |

## 10. Pre-flight prod (ก่อนเปิดใช้จริง)

1. `SELECT COUNT(*) FROM journal_entries WHERE metadata->>'flow' = 'inter-company-settlement'` — คาด 0; ถ้า >0 ต้องทำ opening reconcile (จับคู่ JE เก่าเข้าสัญญาด้วยมือ) ก่อนเชื่อ pending list
2. นับสัญญา activate ก่อน/หลัง 2026-06-23 + ยอดรวม 21-1101/21-1102 ค้าง → ประมาณขนาด backlog ให้พี่นายเห็นก่อนเริ่มบันทึกรอบย้อนหลัง
3. เช็ค GL S11-3001/S11-3002 รวม — ต้อง ≤ ฝั่ง FINANCE เสมอ (drift = legacy โดยนิยาม)

## 11. คำถามถึง CPA (แนบท้าย — ไม่ block การ build)

1. **Opening balance สมุด SHOP:** สัญญาช่วง พ.ค.–22 มิ.ย. 2026 สมุด SHOP ไม่มีลูกหนี้ Inter-co (ระบบเพิ่ง wire ฝั่ง SHOP 23 มิ.ย.) — เงินที่ FINANCE โอนให้ช่วงนั้น ฝั่ง SHOP ควรบันทึกอย่างไร (ตั้ง opening balance ย้อนหลัง หรือถือเป็นยุคก่อนเริ่มสมุด SHOP)?
2. สัญญาจากการเปลี่ยนเครื่อง (device swap) — FINANCE ต้องจ่ายยอดจัดใหม่ให้ SHOP เหมือนขายปกติหรือไม่ (ตอนนี้ตั้งเจ้าหนี้ไว้แล้วโดย 1A)?

## 12. Tests (integration DB จริง — `*.integration.spec.ts` ตาม CI glob เดิม)

1. **Golden เต็มวง**: activate 2 สัญญา (ตัวหนึ่ง `storeCommission=null` → GL fallback 10% — F4) → สร้างรอบ → อนุมัติ → GL 21-1101/21-1102/S11-3001/S11-3002 ของทั้งคู่ = 0 เป๊ะ, TB `scope=ALL` `isAllBalanced=true`, batch POSTED + JE 2 ใบ metadata ครบ
2. **Legacy round (F1)**: สัญญาที่ไม่มี SHOP GL → FINANCE JE ใบเดียว, `shopJournalEntryId=null`, `legacyNoShop=true`
3. **Drift guard**: post JE แทรกแก้ 21-1101 หลัง snapshot → approve ต้อง reject ทั้งรอบ
4. **กันซ้ำ**: สัญญาเดียวถูกใส่ 2 รอบ → รอบสองโดน reject ตั้งแต่ submit (และถ้า race ผ่านมาได้ → โดนซ้ำใน approve tx); หลัง reverse รอบแรก → รอบใหม่ผ่าน + pending engine เห็นสัญญากลับมา
5. **Maker=approver → 403**; งวดปิด (ทั้งฝั่ง SHOP-only closed) → BadRequest + ข้อความ D4
6. **Reverse**: GL กลับครบทุกบัญชี + กลับเข้า pending list
7. Unit: pending engine (สูตร GL, ธง legacy, ไม่อ่าน contract fields)

## 13. Out of scope

- จ่ายบางส่วนของสัญญา / แบ่งงวดจ่าย (รอบ = เต็มยอดคงเหลือของสัญญาเสมอ)
- `LATE_FEE_SHARE` + backfill opening balance ฝั่ง SHOP (รอ CPA §11)
- จับคู่ bank statement อัตโนมัติ
- Wire SHOP-side JE ให้ contract-exchange path (follow-up แยก — F2)
- Retire โมเดล `InterCompanyTransaction`
