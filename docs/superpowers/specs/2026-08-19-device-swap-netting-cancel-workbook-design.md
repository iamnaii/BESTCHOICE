# DeviceSwap / Cancel / Payoff — ปรับระบบตาม Workbook เจ้าของ (2026-08-19)

สถานะ: **อนุมัติโดยเจ้าของ 2026-08-19** (brainstorming session)
ที่มา: DeviceSwap Accounting Test Workbook v1.0 + เอกสาร "Flow การทำงาน — DeviceSwap / Cancel / Payoff"
(ไฟล์ workbook ทุก JE เป็นสมุด FINANCE เท่านั้น — ฝั่ง SHOP ออกแบบเพิ่มใน spec นี้ตามคำตัดสินเจ้าของ)

## 0. คำตัดสินเจ้าของในรอบนี้ (ปิดประเด็น — อย่าเสนอซ้ำ)

| # | คำถาม | คำตัดสิน |
|---|---|---|
| D1 | ขอบเขต | ทำครบทุกข้อใน workbook แบ่ง 5 เฟส ทำทีละเฟสอย่างละเอียด (จบเฟสต้อง review + approve ก่อนไปต่อ) |
| D2 | ฝั่งสมุด SHOP ของการหักกลบจุดที่ 3 | **เปิดบัญชีใหม่ `S21-3001 เจ้าหนี้-FINANCE ค่าเครื่องรับคืน` + แก้ A.4** ให้ลงที่ราคารับซื้อ — แจ้ง CPA รับทราบภายหลัง (เป็นคำตอบของ asymmetry ที่ค้างใน interco spec §11) |
| D3 | กติกายกเลิกสัญญา (Flow C) | **ยกเลิกได้เฉพาะก่อนชำระงวดแรก** (ถ้าเคยจ่ายต้อง void ใบเสร็จก่อน — ใบลดหนี้ออกอัตโนมัติ) — สัญญาที่เดินไปแล้วใช้เส้นทางยึดเครื่อง (JP5) ตามเดิม |

## 1. สรุป Gap (ยืนยันจากโค้ดจริง ณ 2026-08-19)

### ตรงกับ workbook อยู่แล้ว — ไม่แตะ

| Workbook | ระบบปัจจุบัน |
|---|---|
| Flow A (Case 1) — รุ่นเดิมราคาเดิม ไม่มี JE | MEMO mode (`ContractExchangeService`) — เปลี่ยน productId + log, ไม่มี JE ✓ |
| Flow B จุด 1A + จุด 2 — เปิดใหม่ + ปิดเก่าพัก 11-2107 | A.1 (`ContractActivation1ATemplate`) + A.2/A.3 — ระบบแยก 2 ใบผ่านบัญชีพัก 21-1106 แต่**ผลสุทธิเท่า workbook ทุกบาท** (Dr 11-2107 = ราคารับซื้อ; loss plug 51-1102; VAT ถึงกำหนดทันที ม.78/1) — **ตั้งใจไม่รวมเป็นใบเดียว** เพราะ golden fixtures มีอยู่แล้วและไม่มีผลทางบัญชี |
| Flow D (Case 7) — ปิดยอด + ส่วนลด 52-1106 + หน้าร้านรับแทน Dr 11-2107 | `EarlyPayoffJP4Template` + `ShopCollectSettlementTemplate` ✓ (Policy A: VAT ไม่ลด ไม่ออกใบลดหนี้ — ตรงกันอยู่แล้ว) |
| ECL ล้างในใบเดียวกัน (ยึด/write-off/swap) | consume-then-release pattern ใน JP5 / write-off / A.5 ✓ |

### Gap ที่ต้องทำ

1. **จุดที่ 3 — หักกลบในรอบจ่าย INTER-CO**: `interco-settlement.service.ts` ไม่แตะ 11-2107 เลย (grep ยืนยัน) — ปัจจุบันเงินวิ่ง 2 ขา (FINANCE จ่ายเต็ม → SHOP โอนราคารับซื้อกลับผ่าน shop-collect) ต้องเปลี่ยนเป็นหักกลบเหลือโอนสุทธิขาเดียว
2. **Flow C-2 — ยกเลิกหลังตัดจ่าย**: `ContractCancellationTemplate` mirror ใบ 1A เสมอโดยไม่เช็ครอบจ่าย → เจ้าหนี้ติดลบ + ไม่มีการตั้งลูกหนี้เรียกเงินคืน; `contract-exchange-cancel.service.ts` ก็ไม่มี guard รอบจ่ายเช่นกัน
3. **11-2107 หลายความหมาย**: ปัจจุบันแยกได้แค่ทาง `metadata.flow` โดยอ้อม — ต้องมี reference type ชัดเจน 3 ประเภท (workbook ระบุ 2 + ระบบมี SHOP_COLLECT อยู่แล้วเป็นประเภทที่ 3) + รายงานอายุหนี้แยกคอลัมน์ + alert เกิน 30 วัน
4. **Validation suite**: 11-2107 = 0 หลังจบ workflow ต่อสัญญา, กระทบยอด inter-co รายเดือน + alert, ECL ต้องถูกล้างตอนยกเลิก (template ปัจจุบันไม่แตะ), guard งวดบัญชีปิด (มีแล้วผ่าน `JournalAutoService`)
5. **IMEI guards**: `ProductStatus` enum ครบ 15 สถานะแล้ว — ขาด**ด่านตรวจ**: ห้ามเครื่องอยู่ 2 สัญญา active, ห้ามขายซ้ำโดยไม่ผ่านการคืน

## 2. บัญชี 11-2107 — Reference Types (3 ประเภท)

`AuditLog`/JE ที่แตะ 11-2107 ทุกใบ stamp `metadata.shopReceivableType`:

| Type | ความหมาย | จุดเกิด | จุดล้าง |
|---|---|---|---|
| `SWAP_CREDIT` | เครดิตราคารับซื้อจากรับคืนเครื่อง รอหักกลบรอบจ่าย (Flow B) | A.3 (`ExchangeBuybackReceivable11_2107Template`) | รอบจ่าย INTER-CO (Cr 11-2107 ในใบ FINANCE ของ batch) |
| `PAYOUT_RECALL` | เงินที่ตัดจ่ายหน้าร้านแล้วต้องเรียกคืน จากยกเลิกสัญญา (Flow C-2) | ใบยกเลิก C-2 | หักกลบรอบจ่ายถัดไป **หรือ** รับเงินสดคืน (reuse `ShopCollectSettlementTemplate`) |
| `SHOP_COLLECT` | เงินลูกค้าที่หน้าร้านรับแทน (ค่างวด/ปิดยอด — Flow D) | payment orchestrator / JP4 เส้นทาง shop-collect | `settleShopCollect` (Dr เงิน / Cr 11-2107) — **ไม่เข้ารอบจ่าย** |

- util กลาง `classifyShopReceivable(je)`: อ่าน `metadata.shopReceivableType` ก่อน, แถวเก่า fallback map จาก `metadata.flow` (ตารางตายตัว: `exchange-buyback-receivable-11-2107` → SWAP_CREDIT, shop-collect flows → SHOP_COLLECT) — **ไม่ backfill DB**
- ฝั่ง SHOP: `S21-3001` ใช้ stamp เดียวกัน (SWAP_CREDIT / PAYOUT_RECALL) เพื่อกระทบยอดสองสมุดแบบแยกประเภทได้

## 3. Phase 1 — รากฐาน: S21-3001 + A.4 ใหม่ + reference types

### 3.1 ผังบัญชี
- เพิ่ม `S21-3001 เจ้าหนี้-FINANCE ค่าเครื่องรับคืน` (Liability, normal Cr) ใน `shop-coa.csv` + seeder upsert
- **Prod rollout**: ต้องรัน `seed:coa` หลัง deploy (pattern เดียวกับ 21-1107 — บัญชีใหม่ไม่ seed อัตโนมัติใน pipeline)

### 3.2 A.4 ใหม่ (`ShopExchangeReturnTemplate`)
```
เดิม:  Dr S11-2002 [costPrice เดิม]      / Cr S50-1102 [costPrice เดิม]
ใหม่:  Dr S11-2002 [ราคารับซื้อ buyback] / Cr S21-3001 [ราคารับซื้อ buyback]
```
- ความหมาย: SHOP ซื้อเครื่องมือสองคืนจาก FINANCE ที่ราคารับซื้อ → ตั้งเจ้าหนี้รอหักกลบรอบจ่าย
- **อัปเดต `product.costPrice` = ราคารับซื้อ** ในตอน re-intake (tx เดียวกัน) — COGS ตอนขายซ้ำจะอ้างต้นทุนจริงของ SHOP
- Forward-only: JE A.4 เก่า (แบบ costPrice/Cr S50-1102) ปล่อยตามเดิม ไม่ backfill
- **ผลข้างเคียงที่ตั้งใจ**: cancel-sweep ของ exchange จับ JE นี้ด้วย `metadata.contractId` เหมือนเดิม (mirror-reverse ล้าง S21-3001 กลับเอง) — จำนวน reversalJeIds ไม่เปลี่ยน
- **หมายเหตุ CPA**: มูลค่าสต็อก re-intake เปลี่ยนจากต้นทุนเดิม → ราคารับซื้อ + เปิดบัญชี S21-3001 — ทำตามคำสั่งเจ้าของ 2026-08-19 (D2) แจ้ง CPA รับทราบ

### 3.3 Stamp reference types
- A.3 template stamp `SWAP_CREDIT`; shop-collect paths stamp `SHOP_COLLECT`; (C-2 ใน Phase 3 stamp `PAYOUT_RECALL`)
- `classifyShopReceivable()` + unit tests ครอบ legacy mapping

## 4. Phase 2 — จุดที่ 3: หักกลบในรอบจ่าย INTER-CO

### 4.1 Pending lens (`IntercoPendingService`)
- ต่อสัญญาเพิ่ม: `swapCreditGl` = Σ(Dr−Cr) 11-2107 ประเภท SWAP_CREDIT ของสัญญา (raw query แบบเดียวกับ 4 ยอดเดิม) + ฝั่ง SHOP `shopBuybackPayableGl` = Σ(Cr−Dr) S21-3001
- เพิ่ม**คิวรายการหักอิสระ**: สัญญายกเลิก (C-2) ที่มี `PAYOUT_RECALL` ค้าง — แสดงเป็นแถวหักในหน้ารอบจ่าย
- `SHOP_COLLECT` **ไม่เข้าเลนส์นี้** (ล้างผ่าน settleShopCollect ตามเดิม)

### 4.2 Model (additive migration)
- `InterCoSettlementItem` เพิ่ม: `itemType` enum (`SETTLEMENT` | `RECALL`, default `SETTLEMENT`), `swapCreditAmount Decimal @default(0)`, `recallAmount Decimal @default(0)`
- แถว `SETTLEMENT`: สัญญาปกติ/สัญญา swap (swapCreditAmount > 0 เมื่อเป็น swap)
- แถว `RECALL`: สัญญาที่ยกเลิกแบบ C-2 (เฉพาะ recallAmount, ยอดเจ้าหนี้ = 0)
- `@@unique([batchId, contractId])` เดิมคงไว้ (สัญญาหนึ่งเข้า batch ได้แถวเดียว)

### 4.3 JE ตอน approve (ตัวเลขตาม workbook Case 8: เจ้าหนี้ 10,000+1,000, รับซื้อ 8,000)
```
FINANCE:  Dr 21-1101  10,000.00   (เต็ม ต่อสัญญา)
          Dr 21-1102   1,000.00   (เต็ม ต่อสัญญา, ข้ามศูนย์)
             Cr 11-2107   8,000.00   (ต่อรายการหัก — ระบุประเภทใน description)
             Cr <ธนาคาร>  3,000.00   (ยอดโอนสุทธิทั้งรอบ)

SHOP:     Dr S21-3001   8,000.00   (ต่อรายการหัก)
          Dr <ธนาคาร>   3,000.00   (ยอดรับสุทธิ)
             Cr S11-3001  10,000.00
             Cr S11-3002   1,000.00
```
- แถว RECALL: FINANCE `Cr 11-2107 [PAYOUT_RECALL]` / SHOP `Dr S21-3001` — หักจากยอดโอนของรอบ
- metadata `items[]` เพิ่ม `swapCredit`/`recall` ต่อรายการ; idempotency key เดิม (`interco:<batchId>:FINANCE|SHOP`)

### 4.4 Guards
- **ราคารับซื้อ ≥ เจ้าหนี้สัญญานั้น** → `BadRequestException` ตอน createBatch/submit (นโยบายธุรกิจบอกว่าไม่เกิด แต่ workbook สั่ง "คงสูตร IF เป็น guard ห้ามลบ")
- **ยอดโอนสุทธิทั้งรอบต้อง ≥ 0** — ถ้ารายการหักมากกว่ายอดจ่าย → ปฏิเสธ พร้อมแนะให้เรียกเงินสดคืน (recall) หรือรอรอบที่ยอดพอ
- **Drift guard** ใน approve ขยายคลุม 11-2107 (แยกประเภท) + S21-3001 (tolerance ±0.01 เท่าเดิม)
- **ห้ามลงจุดที่ 3 ทันทีตอนเปลี่ยนเครื่อง**: เป็นจริงโดยโครงสร้างอยู่แล้ว (batch เป็น manual round) — ยืนยันใน test
- legacyNoShop: สัญญา swap ตั้งแต่ F2 มี SHOP leg เสมอ → แถวหักบังคับ `legacyNoShop = false`; สัญญา legacy (ก่อน 2026-06-23) ไม่มีทางมี SWAP_CREDIT อยู่แล้ว

### 4.5 Reverse batch
- mirror ทั้งสองใบตามเดิม → 11-2107/S21-3001 กลับมาค้าง + สัญญา/รายการหักกลับเข้าคิวอัตโนมัติ (ตกจากนิยาม settled gate เดิม ไม่ต้องแก้เลนส์)

### 4.6 UI (`/accounting/intercompany`)
- คิวรอจ่าย: คอลัมน์ "หักเครดิตเปลี่ยนเครื่อง", "หักเรียกคืน (ยกเลิก)", "ยอดโอนสุทธิ"
- หน้า batch detail: แสดง 3 ยอด (รวมเจ้าหนี้ / รวมรายการหัก / โอนสุทธิ) + ประเภทต่อแถว

### 4.7 หลัง approve — validation
- เช็ค per-contract: SWAP_CREDIT/PAYOUT_RECALL ที่อยู่ในรอบต้องเหลือ 0 → ไม่เป็น 0 ยิง `Sentry.captureMessage` (warning, `subsystem: 'interco-netting'`) — **alarm อย่างเดียว ไม่ throw** (doctrine R-1: ห้ามให้ alarm พังเส้นทางเงิน)

## 5. Phase 3 — Flow C: ยกเลิกสัญญา C-1 / C-2

### 5.1 Guard รวม (ทั้ง generic cancellation + exchange-cancel)
- ยกเลิกได้เฉพาะ: สัญญา ACTIVE + **ไม่มีใบเสร็จค้าง** (เคยจ่ายต้อง void ก่อน — ใบลดหนี้ ม.86/10 ออกอัตโนมัติจาก receipt-void อยู่แล้ว)
- สัญญาที่เดินเกินนั้น → แนะนำเส้นทางยึดเครื่อง (JP5) ในข้อความ error
- สัญญาอยู่ใน batch DRAFT/PENDING_APPROVAL → แจ้งให้ถอนออกจากรอบก่อน (drift guard ของ batch กันชนอยู่แล้ว แต่ให้ error ที่หน้ายกเลิกชัดกว่า)

### 5.2 ยกเครื่อง `ContractCancellationTemplate` → sweep-reverse
- จาก mirror-1A-ใบเดียว → **sweep ทุก JE POSTED ที่ `metadata.contractId` = สัญญานี้** (pattern เดียวกับ exchange-cancel) — เก็บ 2A accrual ที่เผลอเดินก่อนยกเลิกด้วย
- **ล้าง ECL ใน tx เดียวกัน**: ถ้า GL 11-2102 ของสัญญามียอด → `Dr 11-2102 / Cr 51-1103` (มาตรฐานเดียวตาม CPA ruling A2.2) + REVERSE แถว `BadDebtProvision`
- deprecate ช่อง `refundAmount` (Dr 52-1106 / Cr ธนาคาร เดิม): ภายใต้ guard ใหม่ ลูกค้ายังไม่เคยจ่าย FINANCE → เงินคืนฝั่ง FINANCE = 0 เสมอ (คง field ที่ API เพื่อ back-compat, ต้องเป็น 0)

### 5.3 C-1 (ยังไม่ตัดจ่าย) — ตรง Case 3A กรณี 1
- sweep-reverse ตรงๆ ทุกใบ (รวม SHOP legs: revenue/COGS/ลูกหนี้ S11-3001/S11-3002/ดาวน์) — ตัวเลขเท่าเดิมสลับข้าง ไม่มีเงินสดเคลื่อนไหว
- สัญญาออกจากคิวรอจ่ายเองโดยนิยามเลนส์ (`HAVING SUM > 0` ไม่เจอ)

### 5.4 C-2 (ตัดจ่ายแล้ว) — ตรง Case 3A กรณี 2
- ตรวจจับ: มี `InterCoSettlementItem` ใน batch `POSTED` (primary) + GL cross-check 21-1101/21-1102 ของสัญญา = 0
- ใบ FINANCE: sweep-reverse แต่**ขา Dr 21-1101 + Dr 21-1102 แทนที่ด้วย `Dr 11-2107 [PAYOUT_RECALL]`** = ยอดที่ตัดจ่ายจริง (ตาม batch item ไม่ใช่ field บนสัญญา):
  ```
  Dr 11-2107  11,000.00  [PAYOUT_RECALL]
  Dr 11-2106   6,000.00
  Dr 21-2102   1,190.00
     Cr 11-2101  17,000.00
     Cr 11-2105   1,190.00
  ```
- ใบ SHOP: mirror SHOP legs แต่**ขา Cr S11-3001 + Cr S11-3002 แทนที่ด้วย `Cr S21-3001 [PAYOUT_RECALL]`** (เงินที่ SHOP ต้องคืน) — เครื่องกลับเข้าสต็อก (mirror JE A) + สถานะสินค้า
- ดาวน์ (สัญญาทั่วไปที่มีดาวน์): mirror คืน S21-2001 → คืนเงินลูกค้าผ่าน pattern `ShopDownPaymentReversalTemplate`
- ล้าง PAYOUT_RECALL: (a) หักกลบรอบถัดไป (Phase 2) หรือ (b) endpoint เรียกเงินสดคืน — reuse `ShopCollectSettlementTemplate` + stamp type
- AuditLog: action ใหม่ `CONTRACT_CANCELED_AFTER_PAYOUT` (entity `contract`) ระบุยอด recall + batch อ้างอิง

### 5.5 exchange-cancel
- เพิ่ม branch เดียวกัน: ถ้าสัญญาใหม่ของ swap ถูกตัดจ่ายแล้ว → C-2 semantics (แทนขาเจ้าหนี้/ลูกหนี้ SHOP ด้วย 11-2107/S21-3001) — ปัจจุบัน mirror ตรงๆ จะสร้างเจ้าหนี้ติดลบ

## 6. Phase 4 — รายงาน + Alerts + Validation

1. **รายงานอายุลูกหนี้หน้าร้าน (11-2107)**: endpoint `GET /interco-settlement/shop-receivable-aging` — ต่อสัญญา: ยอดต่อประเภท (3 คอลัมน์ SWAP_CREDIT / PAYOUT_RECALL / SHOP_COLLECT) + อายุ (วันจาก posted_at ของ JE ตั้งหนี้) + UI section ในหน้า interco
2. **Cron รายวัน** (`shop-receivable-aging.cron`): ค้างเกิน 30 วัน → Todo MEDIUM (dedup ต่อ สัญญา+ประเภท) + Sentry warning (`subsystem: 'interco-netting'`)
3. **Cron รายเดือน** (`interco-reconcile.cron`, วันที่ 1 08:00 BKK): เทียบ FINANCE (21-1101+21-1102 คงค้าง, 11-2107 ต่อประเภท) ↔ SHOP (S11-3001+S11-3002, S21-3001) — ไม่ตรง (นอกเหนือ legacy driftNote เดิม) → Todo + Sentry
4. Trial balance: ไม่ต้องแก้ — S21-3001 เข้า SECTION_MAP อัตโนมัติผ่าน prefix S21

## 7. Phase 5 — IMEI Guards

`ProductStatus` enum ครบแล้ว — เพิ่มด่านตรวจ:
1. **Activation guard**: productId/imeiSerial ต้องไม่อยู่ในสัญญา ACTIVE อื่น (เช็คตอน activate + ตอน exchange finalize) → `ConflictException` ภาษาไทย
2. **Sale guard**: ขาย (POS/สัญญาใหม่) ได้เฉพาะสถานะ `IN_STOCK` / `REFURBISHED` — ห้าม `SOLD_*`/`REPOSSESSED`/`DAMAGED`/`LOST`/`WRITTEN_OFF` โดยไม่ผ่านการคืน/refurb
3. **Transition ตรวจสอบ**: exchange return → สถานะเครื่องเก่ากลับเข้าคลังหน้าร้าน (ตรวจ flow ปัจจุบันให้ตรง state diagram ของ workbook), repossession → `REPOSSESSED` → `REFURBISHED` → `SOLD_RESELL`
4. รายงาน/เทสต์: integration test เครื่องเดียวกันสองสัญญา + ขายซ้ำ

## 8. สิ่งที่ตั้งใจไม่ทำ

- **ไม่รวม A.2+A.3 เป็นใบเดียว** ตาม workbook จุด 2 — ผลสุทธิเท่ากันทุกบาท golden เดิมคงอยู่
- **ไม่ backfill** JE เก่าใดๆ (A.4 แบบเก่า / cancel แบบเก่า / reference type บนแถวเก่า) — forward-only + `classifyShopReceivable` map แถวเก่าตอนอ่าน
- **Flow A / Flow D ไม่แตะ**
- ไม่ทำ VAT-on-interest (CR-001 ยัง deferred ตามเดิม)
- SHOP_COLLECT ไม่เข้ารอบจ่าย (คนละธรรมชาติ — เงินลูกค้า ไม่ใช่เงินระหว่างกิจการ)

## 9. ประเด็นแจ้ง CPA (ทำก่อน แจ้งรับทราบ — ตามคำสั่งเจ้าของ D2)

1. เปิด `S21-3001 เจ้าหนี้-FINANCE ค่าเครื่องรับคืน` ฝั่งสมุด SHOP (ปิดคำถาม asymmetry ใน interco spec §11 สำหรับเส้นทางเปลี่ยนเครื่อง)
2. มูลค่าสต็อกเครื่อง re-intake = ราคารับซื้อ (แทน costPrice เดิม) — ต้นทุนจริงที่ SHOP ซื้อคืนจาก FINANCE
3. การหักกลบเจ้าหนี้/ลูกหนี้ระหว่างกันในรอบจ่าย (จุดที่ 3) แทนการโอนเงิน 2 ขา
4. PAYOUT_RECALL จากการยกเลิกสัญญาหลังตัดจ่าย

## 10. Testing ต่อเฟส

| เฟส | เทสต์หลัก |
|---|---|
| 1 | template spec A.4 ใหม่ + `classifyShopReceivable` unit + update `exchange-priced-flow.integration.spec.ts` (S21-3001 ค้าง 8,000 หลัง finalize; cancel-sweep net 0 รวม S21-3001) |
| 2 | integration: batch ผสม (ปกติ + swap + recall) → JE สองสมุด balance, 11-2107/S21-3001 = 0 หลัง approve, guard ราคารับซื้อ ≥ เจ้าหนี้, ยอดสุทธิติดลบ, reverse กลับเข้าคิว |
| 3 | integration C-1 (net 0 ทุกบัญชี) + C-2 (11-2107 recall ตั้งถูก, เจ้าหนี้ไม่ติดลบ, ECL ล้าง, เครื่องกลับสต็อก) + guard ใบเสร็จค้าง |
| 4 | cron specs (aging/reconcile) + report endpoint spec |
| 5 | guard specs (2 สัญญา active / ขายซ้ำ) + E2E smoke |
| ทุกเฟส | `./tools/check-types.sh all` + TB `scope=ALL` `isAllBalanced=true` ใน integration |

## 11. Rollout

1. Migration additive ทั้งหมด (enum + คอลัมน์ default 0) — ไม่ rewrite ตาราง
2. Prod หลัง deploy Phase 1: รัน `seed:coa` (เพิ่ม S21-3001)
3. รอบจ่ายที่เปิดค้าง (DRAFT/PENDING_APPROVAL) ก่อน deploy Phase 2: แนะนำ approve/cancel ให้จบก่อน (snapshot ไม่มี field ใหม่ — drift guard จะปฏิเสธเองถ้าค่าคลาด แต่ปิดรอบก่อนสะอาดกว่า)
4. สัญญา swap ที่ finalize ก่อน Phase 1 (A.4 แบบเก่า, ไม่มี S21-3001): ยอด 11-2107 SWAP_CREDIT ค้างของสัญญาเหล่านั้น**ล้างผ่าน shop-collect ตามเดิม** (เงิน 2 ขา) — การหักกลบใช้กับสัญญาที่ finalize หลัง Phase 1 เท่านั้น (มิฉะนั้นฝั่ง SHOP ไม่มี S21-3001 ให้ Dr → ใบ SHOP ไม่ balance) — เลนส์แยกด้วยการมี/ไม่มี S21-3001 GL ของสัญญานั้น
