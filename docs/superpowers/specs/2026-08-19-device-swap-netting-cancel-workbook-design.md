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
| Flow B จุด 1A + จุด 2 — **โครงสร้าง/งบดุล** | A.1 (`ContractActivation1ATemplate`) + A.2/A.3 — ระบบแยก 2 ใบผ่านบัญชีพัก 21-1106 แต่**งบดุลสุทธิเท่า workbook ทุกบาท** (Dr 11-2107 = ราคารับซื้อ; VAT ถึงกำหนดทันที ม.78/1) — **ตั้งใจไม่รวมเป็นใบเดียว** เพราะ golden fixtures มีอยู่แล้วและไม่มีผลทางบัญชี ⚠️ ยกเว้น**วิธีรับรู้ P&L** — ดู Gap ข้อ 6 (scrutiny 2026-08-19) |
| Flow D (Case 7) — ปิดยอด + ส่วนลด 52-1106 + หน้าร้านรับแทน Dr 11-2107 | `EarlyPayoffJP4Template` + `ShopCollectSettlementTemplate` ✓ (Policy A: VAT ไม่ลด ไม่ออกใบลดหนี้ — ตรงกันอยู่แล้ว) |
| ECL ล้างในใบเดียวกัน (ยึด/write-off/swap) | consume-then-release pattern ใน JP5 / write-off / A.5 ✓ |

### Gap ที่ต้องทำ

1. **จุดที่ 3 — หักกลบในรอบจ่าย INTER-CO**: `interco-settlement.service.ts` ไม่แตะ 11-2107 เลย (grep ยืนยัน) — ปัจจุบันเงินวิ่ง 2 ขา (FINANCE จ่ายเต็ม → SHOP โอนราคารับซื้อกลับผ่าน shop-collect) ต้องเปลี่ยนเป็นหักกลบเหลือโอนสุทธิขาเดียว
2. **Flow C-2 — ยกเลิกหลังตัดจ่าย**: `ContractCancellationTemplate` mirror ใบ 1A เสมอโดยไม่เช็ครอบจ่าย → เจ้าหนี้ติดลบ + ไม่มีการตั้งลูกหนี้เรียกเงินคืน; `contract-exchange-cancel.service.ts` ก็ไม่มี guard รอบจ่ายเช่นกัน
3. **11-2107 หลายความหมาย**: ปัจจุบันแยกได้แค่ทาง `metadata.flow` โดยอ้อม — ต้องมี reference type ชัดเจน 3 ประเภท (workbook ระบุ 2 + ระบบมี SHOP_COLLECT อยู่แล้วเป็นประเภทที่ 3) + รายงานอายุหนี้แยกคอลัมน์ + alert เกิน 30 วัน
4. **Validation suite**: 11-2107 = 0 หลังจบ workflow ต่อสัญญา, กระทบยอด inter-co รายเดือน + alert, ECL ต้องถูกล้างตอนยกเลิก (template ปัจจุบันไม่แตะ), guard งวดบัญชีปิด (มีแล้วผ่าน `JournalAutoService`)
5. **IMEI guards**: `ProductStatus` enum ครบ 15 สถานะแล้ว — ขาด**ด่านตรวจ**: ห้ามเครื่องอยู่ 2 สัญญา active, ห้ามขายซ้ำโดยไม่ผ่านการคืน
6. **A.2 ใช้วิธี gross — workbook สั่งวิธีสุทธิ** (พบจาก scrutiny 2026-08-19): `exchange-close-old-21-1106.template.ts` ปัจจุบันมีขา `Cr 41-1101 [unearned]` (รับรู้ดอกเบี้ยรอตัดที่เหลือเป็นรายได้) ทำให้ loss plug 51-1102 โตขึ้นเท่ากัน — กำไรสุทธิเท่ากัน แต่บรรทัด P&L พองเกินคู่กัน. Workbook Case 2A Verification: "P/L สุทธิ = ขาดทุน 126.64 (**วิธีสุทธิ ไม่ตั้งรายได้ 41-1101**)" + regression checklist "เคสรับคืนเครื่องใช้วิธีสุทธิ / เคสปิดยอดใช้ 52-1106 — ห้ามสลับกัน". ยืนยันแล้วว่า**ไม่มี CPA CSV golden ผูก** (ปักโดย integration spec ของโปรเจคเอง) → แก้ใน Phase 1 (§3.4)

## 2. บัญชี 11-2107 — Reference Types (3 ประเภท)

`AuditLog`/JE ที่แตะ 11-2107 ทุกใบ stamp `metadata.shopReceivableType`:

| Type | ความหมาย | จุดเกิด | จุดล้าง |
|---|---|---|---|
| `SWAP_CREDIT` | เครดิตราคารับซื้อจากรับคืนเครื่อง รอหักกลบรอบจ่าย (Flow B) | A.3 (`ExchangeBuybackReceivable11_2107Template`) | รอบจ่าย INTER-CO (Cr 11-2107 ในใบ FINANCE ของ batch) |
| `PAYOUT_RECALL` | เงินที่ตัดจ่ายหน้าร้านแล้วต้องเรียกคืน จากยกเลิกสัญญา (Flow C-2) | ใบยกเลิก C-2 | หักกลบรอบจ่ายถัดไป **หรือ** รับเงินสดคืน (reuse `ShopCollectSettlementTemplate`) |
| `SHOP_COLLECT` | เงินลูกค้าที่หน้าร้านรับแทน (ค่างวด/ปิดยอด — Flow D) | JP4 payoff + JP5 repossession (เส้นทางหน้าร้านรับแทน) | `settleShopCollect` (Dr เงิน / Cr 11-2107) — **ไม่เข้ารอบจ่าย** |

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
- **Snapshot costPrice เดิมก่อน mutate** (เก็บบน `ContractExchangeRequest.previousCostPrice` — คอลัมน์ใหม่ nullable) และ **restore ใน cancel step "restore states"** (`contract-exchange-cancel.service.ts` ขั้นที่ 3) — มิฉะนั้น cancel จะ mirror GL กลับหมดแต่ costPrice ค้างเป็นราคารับซื้อ → COGS ผิดถ้าขายเครื่องภายหลัง (scrutiny finding 3)
- Forward-only: JE A.4 เก่า (แบบ costPrice/Cr S50-1102) ปล่อยตามเดิม ไม่ backfill
- **ผลข้างเคียงที่ตั้งใจ**: cancel-sweep ของ exchange จับ JE นี้ด้วย `metadata.contractId` เหมือนเดิม (mirror-reverse ล้าง S21-3001 กลับเอง) — จำนวน reversalJeIds ไม่เปลี่ยน
- **หมายเหตุ CPA**: มูลค่าสต็อก re-intake เปลี่ยนจากต้นทุนเดิม → ราคารับซื้อ + เปิดบัญชี S21-3001 — ทำตามคำสั่งเจ้าของ 2026-08-19 (D2) แจ้ง CPA รับทราบ

### 3.3 Stamp reference types
- A.3 template stamp `SWAP_CREDIT`; shop-collect paths stamp `SHOP_COLLECT`; (C-2 ใน Phase 3 stamp `PAYOUT_RECALL`)
- `classifyShopReceivable()` + unit tests ครอบ legacy mapping

### 3.4 A.2 เปลี่ยนเป็นวิธีสุทธิ (Gap ข้อ 6)
- `exchange-close-old-21-1106.template.ts`: **ตัดขา `Cr 41-1101 [unearned]` ออก** — loss/gain plug คำนวณใหม่เองเป็น `buyback − มูลค่าตามบัญชีสุทธิรวม VAT` (ตัวเลข workbook: 8,000 − 8,126.64 = ขาดทุน 126.64 ไม่ใช่ 4,126.64)
- Update assertions ใน `exchange-priced-flow.integration.spec.ts` (บรรทัดที่ปัก `Cr 41-1101 = 4,000.00` → ไม่มีบรรทัดนี้; loss 4,126.68 → 126.68 ตาม fixture เดิม) + template spec
- Gain branch: **คง `Cr 41-1102` ไว้ตามเดิม** (unreachable ภายใต้ guard ราคารับซื้อ ≥ เจ้าหนี้ — นโยบายธุรกิจบอกไม่เกิด) — workbook ระบุ "กลุ่ม 42-xxxx" บันทึกไว้เป็นประเด็นแจ้ง CPA ถ้าจะย้ายค่อยทำตามคำสั่ง ไม่เดาตอนนี้
- Cancel-sweep mirror ใบ A.2 ได้เหมือนเดิม (โครงสร้างบรรทัดเปลี่ยน แต่ mirror เป็น generic)

## 4. Phase 2 — จุดที่ 3: หักกลบในรอบจ่าย INTER-CO

### 4.1 Pending lens (`IntercoPendingService`)
- ต่อสัญญาเพิ่ม: `swapCreditGl` = Σ(Dr−Cr) 11-2107 ประเภท SWAP_CREDIT ของสัญญา (raw query แบบเดียวกับ 4 ยอดเดิม) + ฝั่ง SHOP `shopBuybackPayableGl` = Σ(Cr−Dr) S21-3001
- เพิ่ม**คิวรายการหักอิสระ**: สัญญายกเลิก (C-2) ที่มี `PAYOUT_RECALL` ค้าง — แสดงเป็นแถวหักในหน้ารอบจ่าย
- `SHOP_COLLECT` **ไม่เข้าเลนส์นี้** (ล้างผ่าน settleShopCollect ตามเดิม)
- **[implemented]** ฟิลด์จริง: `PendingContract.swapCreditGl/shopBuybackPayableGl/swapCreditEligible`
  (eligible = สองสมุด > 0 **และ** เท่ากัน ±0.01 — legacy swap §11.4 จึง false โดยโครงสร้าง);
  คิวหัก = `getPendingRecalls()` → `RecallCandidate { recallGl, shopRecallGl }` (settled gate
  กรอง `itemType: 'RECALL'` เท่านั้น — สัญญา C-2 มี SETTLEMENT item POSTED ถาวรโดยนิยาม;
  **Phase 3 Task 4**: ยอดทั้งคู่เป็น **net** = typed PAYOUT_RECALL gross − Σ deduction ทุก
  itemType ใน batch POSTED ของสัญญานั้น — เคสยกเลิก swap ที่เคยถูกหักเครดิต gross จะเสนอเกินจริง);
  `GET /interco-settlement/pending` คืน `{ pending, recalls, reconcile }` และ reconcile เพิ่ม
  `glSwapCreditTotal/glRecallTotal/glShopBuybackTotal`. SQL twins ของ type filter อยู่ที่
  `interco-typed-balance.ts` (helpers 4 ตัว) — แก้ที่ไหนต้องแก้ทั้งคู่

### 4.2 Model (additive migration)
- `InterCoSettlementItem` เพิ่ม: `itemType` enum (`SETTLEMENT` | `RECALL`, default `SETTLEMENT`), `swapCreditAmount Decimal @default(0)`, `recallAmount Decimal @default(0)`
- แถว `SETTLEMENT`: สัญญาปกติ/สัญญา swap (swapCreditAmount > 0 เมื่อเป็น swap)
- แถว `RECALL`: สัญญาที่ยกเลิกแบบ C-2 (เฉพาะ recallAmount, ยอดเจ้าหนี้ = 0)
- `@@unique([batchId, contractId])` เดิมคงไว้ (สัญญาหนึ่งเข้า batch ได้แถวเดียว)
- **นิยามยอดระดับ batch** (scrutiny finding 4): `totalAmount` คงความหมายเดิม = Σ เจ้าหนี้ (21-1101+21-1102) และเพิ่ม `netTransferAmount Decimal @default(0)` = เงินโอนจริง (`totalAmount − Σ swapCredit − Σ recall`) — ใบ FINANCE/SHOP ขาเงินสดใช้ `netTransferAmount`; `shopPostedAmount` เดิมยังคือยอดฝั่ง SHOP ที่ถูกล้าง (ไม่ใช่เงินสดอีกต่อไป — comment ในโค้ดให้ชัด)
- **[implemented — เบี่ยงจากบรรทัดบน]** `netTransferAmount` เป็น **nullable** (`Decimal?` ไม่ใช่
  `@default(0)`) — `null` = batch ก่อน Phase 2 = จ่ายเต็ม (ทุกจุดอ่าน fallback `?? totalAmount`);
  และเพิ่มอีก 2 คอลัมน์: `totalDeduction Decimal @default(0)` (Σ swapCredit + recall) +
  `shopNetAmount Decimal?` (= `shopPostedAmount − totalDeduction`, เงินรับจริงฝั่ง SHOP —
  ขา Dr ธนาคารของใบ SHOP ใช้ตัวนี้; nullable ความหมายเดียวกัน)
- **[implemented]** RECALL rows เลือกผ่าน `CreateBatchDto.recallContractIds` (แยกจาก `contractIds`;
  สัญญาเดียวกันอยู่ทั้งสอง list → reject)
- `updateBatch` (ลบ-สร้าง item ใหม่ DRAFT-only) ต้อง re-snapshot คอลัมน์ใหม่ทุกตัวด้วย

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
- **[implemented]** metadata จริง: `items[]` มี `type` (`SETTLEMENT|RECALL`) ต่อรายการด้วย +
  top-level `netTransferAmount` (2dp string); **จงใจไม่ stamp** `contractId`/`shopReceivableType`
  top-level บน batch JE (สถาปัตยกรรม "เลนส์ gross + item gate" — กัน batch JE รั่วเข้า lens ต่อสัญญา
  ทุกตัว, ดู §4.7); บรรทัดธนาคารทั้งสองใบ **skip เมื่อยอดสุทธิ = 0**; แถว RECALL ไม่สร้างบรรทัด
  `Dr 21-1101` ศูนย์ (มีเฉพาะขาหัก)

### 4.4 Guards
- **ราคารับซื้อ ≥ เจ้าหนี้สัญญานั้น** → `BadRequestException` ตอน createBatch/submit (นโยบายธุรกิจบอกว่าไม่เกิด แต่ workbook สั่ง "คงสูตร IF เป็น guard ห้ามลบ")
- **ยอดโอนสุทธิทั้งรอบต้อง ≥ 0** — ถ้ารายการหักมากกว่ายอดจ่าย → ปฏิเสธ พร้อมแนะให้เรียกเงินสดคืน (recall) หรือรอรอบที่ยอดพอ
- **Drift guard** ใน approve ขยายคลุม 11-2107 (แยกประเภท) + S21-3001 (tolerance ±0.01 เท่าเดิม)
- **ห้ามลงจุดที่ 3 ทันทีตอนเปลี่ยนเครื่อง**: เป็นจริงโดยโครงสร้างอยู่แล้ว (batch เป็น manual round) — ยืนยันใน test
- legacyNoShop: สัญญา swap ตั้งแต่ F2 มี SHOP leg เสมอ → แถวหักบังคับ `legacyNoShop = false`; สัญญา legacy (ก่อน 2026-06-23) ไม่มีทางมี SWAP_CREDIT อยู่แล้ว
- **[implemented — รายละเอียด guard จริง]** ทุก guard ยอดอยู่ที่ `buildSnapshot` (จับทั้ง createBatch
  และ updateBatch; submit ไม่ re-snapshot — มันทำ clash re-check); เพิ่มจาก spec: (1) guard สองสมุด
  ไม่ตรง — swap (`swapCreditGl > 0 && shopBuybackPayableGl > 0 && !eligible`) และ recall
  (`|recallGl − shopRecallGl| > 0.01`) → reject ห้ามเดาหักข้างเดียว (legacy swap ที่ SHOP = 0
  **ผ่านได้แบบไม่หัก** — ไม่เข้าเงื่อนไข); (2) W1 ขยาย — GL ติดลบใน 6 บัญชีเลนส์ → Sentry + reject;
  (3) clash check ใน submit + approve เป็น **type-aware**: RECALL clash เฉพาะ RECALL item
  (any-type จะทำให้รอบที่มี recall submit ไม่ได้ตลอดกาล — สัญญา C-2 มี SETTLEMENT item POSTED
  ถาวรโดยนิยาม); (4) drift guard = **สองชั้น**: (ก) snapshot > 0 → live สองสมุดต้องตรง snapshot
  ±0.01; (ข) snapshot = 0 แต่ live nettable **ทั้งสองสมุด** (scFin > 0.01 && scShop > 0.01) →
  drift — เครดิตสมุดเดียว (legacy §11.4) จงใจไม่ใช่ drift มิฉะนั้นรอบที่มี legacy swap อนุมัติไม่ได้
  ตลอดกาล (deadlock); แถว RECALL เทียบ typed PAYOUT_RECALL สองสมุดกับ `recallAmount`

### 4.5 Reverse batch
- mirror ทั้งสองใบตามเดิม → 11-2107/S21-3001 กลับมาค้าง + สัญญา/รายการหักกลับเข้าคิวอัตโนมัติ (ตกจากนิยาม settled gate เดิม ไม่ต้องแก้เลนส์)

### 4.6 UI (`/accounting/intercompany`)
- คิวรอจ่าย: คอลัมน์ "หักเครดิตเปลี่ยนเครื่อง", "หักเรียกคืน (ยกเลิก)", "ยอดโอนสุทธิ"
- หน้า batch detail: แสดง 3 ยอด (รวมเจ้าหนี้ / รวมรายการหัก / โอนสุทธิ) + ประเภทต่อแถว

### 4.7 หลัง approve — validation
- เช็ค per-contract: SWAP_CREDIT/PAYOUT_RECALL ที่อยู่ในรอบต้องเหลือ 0 → ไม่เป็น 0 ยิง `Sentry.captureMessage` (warning, `subsystem: 'interco-netting'`) — **alarm อย่างเดียว ไม่ throw** (doctrine R-1: ห้ามให้ alarm พังเส้นทางเงิน)
- **[implemented — นิยาม residual เปลี่ยนจากบรรทัดบน]** batch JE ไม่ stamp `contractId` (กันรั่วเข้า
  payable lens) ⇒ typed balance ต่อสัญญา**ไม่ลดหลัง approve โดยตั้งใจ** — "ต้องเหลือ 0" ตรงๆ ใช้
  ไม่ได้ใต้สถาปัตยกรรม "เลนส์ gross + item gate" (settledness อยู่ที่ `InterCoSettlementItem`).
  Residual จริง = `typed gross (สองสมุด แยกกัน) − Σ deduction ของสัญญานั้นใน batch POSTED ทั้งหมด`;
  `|residual| > 0.01` → alarm (`alarmNettingResiduals` — fire-and-forget **หลัง tx commit**, root
  prisma เท่านั้น). ค่าปกติ = 0; > 0 = เครดิตงอกหลัง snapshot/หักไม่ครบ; < 0 = หักซ้ำ.
  **[implemented — Phase 3 Task 4 ปรับสูตรเพิ่ม]** typed gross ของ alarm = SWAP_CREDIT +
  PAYOUT_RECALL **รวมสองประเภทต่อสมุด** (invariant "= 0" ถือจริงระดับสัญญา ไม่ใช่ระดับประเภท —
  สัญญา swap ที่ถูกยกเลิก (C-2) มีประวัติข้ามประเภท: เทียบทีละประเภทจะ false-alarm) และ
  recall lens/drift แถว RECALL เปลี่ยนเป็น **net of Σ POSTED deductions ทุก itemType**.
  Carry → Phase 3/4 (สถานะหลัง Phase 3 2026-08-20): ~~producer C-2 ต้องตั้ง PAYOUT_RECALL
  เฉพาะเมื่อ batch จ่ายเดิม POSTED~~ **ปิดแล้ว** — detection ของ C-2 คือ POSTED SETTLEMENT item
  โดยนิยาม (Task 3/5); ~~alarm ควรแยก postedDeduction ตาม itemType~~ **ปิดแล้วด้วยทิศตรงข้าม**
  — รวม typed สองประเภทแทน (Task 4, บรรทัดบน); คงเหลือ → Phase 4: เครดิต A.3-only ที่งอกหลัง
  approve + TOCTOU settle-cash vs approveBatch + คิว recall กรอง net ฝั่ง FINANCE เท่านั้น —
  จุด hook คือ reconcile cron (`interco-reconcile.cron`)

## 5. Phase 3 — Flow C: ยกเลิกสัญญา C-1 / C-2

> **สถานะ: implemented 2026-08-20** (branch `feat/device-swap-cancel-phase3`, Tasks 1-8) —
> จุดที่ของจริงต่างจาก spec ถูก annotate `[implemented]` ในแต่ละหัวข้อย่อยด้านล่าง.
> สรุปฉบับ canonical อยู่ที่ `.claude/rules/accounting.md` → "ยกเลิกสัญญา (Flow C — Phase 3)".

### 5.1 Guard รวม (ทั้ง generic cancellation + exchange-cancel)
- ยกเลิกได้เฉพาะ: สัญญา ACTIVE + **ไม่มีใบเสร็จค้าง** (เคยจ่ายต้อง void ก่อน — ใบลดหนี้ ม.86/10 ออกอัตโนมัติจาก receipt-void อยู่แล้ว)
- สัญญาที่เดินเกินนั้น → แนะนำเส้นทางยึดเครื่อง (JP5) ในข้อความ error
- สัญญาอยู่ใน batch DRAFT/PENDING_APPROVAL → แจ้งให้ถอนออกจากรอบก่อน (drift guard ของ batch กันชนอยู่แล้ว แต่ให้ error ที่หน้ายกเลิกชัดกว่า)
- **[implemented — Tasks 2+5, guards เพิ่มจาก review]** ทุกข้อบนทำครบ (ACTIVE re-read **ใน tx**
  กัน race JP5/termination; PAID = `status PAID` OR `amountPaid > 0`) + เพิ่ม: (1) **park 3 ถัง**
  (`advanceBalance + creditBalance + rescheduleAdvanceBalance > 0` → reject — เงินสดจริงที่หลุด
  guard PAID เช่น 6a fee), (2) **SHOP_COLLECT ค้าง** (`shopCollectTypedBalance ≠ 0` → reject —
  sweep exclude flow เงินสดนี้จึงต้อง settle ก่อน), (3) `refundAmount > 0` → reject (deprecated —
  เงินดาวน์คืนเป็นขั้น SHOP หลังยกเลิก), (4) **positive cash tripwire** — สแกน sweep candidates
  บรรทัดแตะบัญชีเงินสด/ธนาคาร (prefix 11-11/11-12/S11-11/S11-12) → reject ระบุ entryNumber

### 5.2 ยกเครื่อง `ContractCancellationTemplate` → sweep-reverse (generalize ของที่มี)
- จาก mirror-1A-ใบเดียว → sweep-reverse โดย **generalize `ExchangeCancelReversalTemplate`** (scrutiny finding 5) — ตัวนี้มี semantics ครบอยู่แล้ว: reverse ตาม id list + sweep `metadata.contractId` + ข้าม JE ที่ `reversed:true` และใบ reversal เอง — ห้ามเขียน sweep ตัวที่สอง
- **Sweep ต้อง exclude `metadata.flow = 'provision'`** (scrutiny finding 2): JE ค่าเผื่อรายวัน stamp `contractId` เหมือนกัน — ถ้า sweep จับด้วย แล้วโพสต์ขา release แยกอีก 11-2102 จะติดลบเท่ายอดที่ล้าง. ใช้แบบ JP4 C1 แทน: **release ใบเดียวจาก live GL** — `glContractBalance(tx, contractId, '11-2102', 'cr')` → `Dr 11-2102 / Cr 51-1103` (`EclStageReverseTemplate` self-skip เมื่อ ≤ 0) + REVERSE แถว `BadDebtProvision`
  - หมายเหตุ: exchange-cancel เดิมไม่ชนปัญหานี้เพราะ sweep ใช้ newContractId ส่วน provision อยู่บนสัญญาเก่า — แต่พอ generalize ให้สัญญาทั่วไป contractId เดียวกัน ต้อง exclude
- deprecate ช่อง `refundAmount` (Dr 52-1106 / Cr ธนาคาร เดิม): ภายใต้ guard ใหม่ ลูกค้ายังไม่เคยจ่าย FINANCE → เงินคืนฝั่ง FINANCE = 0 เสมอ (คง field ที่ API เพื่อ back-compat, ต้องเป็น 0)
- **[implemented — Tasks 1+2, ต่างจาก spec 2 จุด]** (1) exclude list กว้างกว่า spec:
  `C1_EXCLUDED_FLOWS = ['provision', 'stage-reverse', 'shop-collect-settlement',
  'shop-down-payment', 'reschedule-collect']` — สามตัวหลังเป็น JE **เงินสดจริง** (พบใน review
  Fix Round 1: mirror = fabricate การเคลื่อนไหวเงินที่ไม่เคยเกิด; down JE ไม่ mirror ⇒ S21-2001
  ค้าง Cr downAmount เป็นเจ้าหนี้รอคืนลูกค้าโดยตั้งใจ — จ่ายจริงเป็นขั้น SHOP แยก) + tripwire
  บวก (§5.1). (2) idempotency ของ template เปลี่ยนเป็น **DB-backed**: probe
  `ContractCancellation.reversalJournalEntryId` (metadata probe เดิมมองไม่เห็น sweep output —
  per-JE key ไม่มี cancellationId); engine options ใหม่ = excludeFlows/redirects/redirectStamp/
  flowLabel/descriptionPrefix + คืน `redirectedTotals`, caller exchange เดิม byte-identical

### 5.3 C-1 (ยังไม่ตัดจ่าย) — ตรง Case 3A กรณี 1
- sweep-reverse ตรงๆ ทุกใบ (รวม SHOP legs: revenue/COGS/ลูกหนี้ S11-3001/S11-3002/ดาวน์) — ตัวเลขเท่าเดิมสลับข้าง ไม่มีเงินสดเคลื่อนไหว
- สัญญาออกจากคิวรอจ่ายเองโดยนิยามเลนส์ (`HAVING SUM > 0` ไม่เจอ)
- **[implemented — Task 2]** ตามนี้ + restore ใน tx เดียวกัน: product → IN_STOCK + SHOP company,
  soft-delete Payment/InstallmentSchedule, ECL release ใบเดียวจาก live GL + flip
  `BadDebtProvision` → REVERSED; audit `CONTRACT_CANCELED`. Integration:
  `contract-cancellation.integration.spec.ts` (net 0 ทุกบัญชีต่อสัญญา)

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
- **[implemented — Tasks 3+4+6, ต่างจาก spec 4 จุด]**
  1. **Detection = POSTED SETTLEMENT item อย่างเดียว** (`settledPayoutByContract` — shared helper
     3 จุดเรียก: approve/list/exchange) — ไม่มี pre-check "GL 21-1101/21-1102 = 0" แยกต่างหาก;
     การยืนยัน GL ทำ **หลัง sweep** แทน: `redirectedTotals['11-2107']` ต้อง = `settledTotal`
     ±0.01 **และ** `redirectedTotals['S21-3001'].neg()` = `settledShopTotal` (แยกสมุด — Task 4
     fold; hand-JV สมุดเดียวต้องโดนจับ) — ไม่ตรง throw ใน tx ให้ sweep ทั้งชุด rollback
  2. **ไม่ใช่ใบรวมใบเดียวตามตัวอย่างใน spec** — sweep mirror **ต่อ JE ต้นทาง** (ใบใครใบมัน)
     โดย redirect เฉพาะ leg บน 4 บัญชีรอบจ่าย (map `C2_REDIRECTS`); JE ที่มี redirect leg ถูก
     stamp `shopReceivableType: 'PAYOUT_RECALL'` ระดับใบ; ยอดรวม redirect = gross ที่ตัดจ่าย
     (ตาม batch item — ตรง spec) + defensive check: JE ผสมบรรทัด redirect source กับบรรทัด/
     ประเภท typed ในใบเดียว → reject (stamp จะทับความหมายเดิม)
  3. **ดาวน์**: sweep คืน Cr S21-2001 **โดยโครงสร้าง** (mirror JE B ของ activation) — ไม่มี JE
     คืนเงินอัตโนมัติ: ใบรับเงินดาวน์ (`shop-down-payment`) เป็นเงินสดจริงถูก exclude ⇒ S21-2001
     ค้าง Cr downAmount เป็นเจ้าหนี้รอคืนลูกค้า; จ่ายคืนจริง = ขั้น SHOP แยก
     (`ShopDownPaymentReversalTemplate` pre-activation / JV post-activation จนกว่าจะมี UI)
  4. **ยอด recall ใน audit/คิว = net** (settledTotal − Σ(swapCreditAmount+recallAmount) ของ item
     ชุดเดียวกัน — Task 4): `CONTRACT_CANCELED_AFTER_PAYOUT` เก็บทั้ง `settledTotal` (gross,
     ตรวจย้อน redirect) + `recallAmount` (net) + `batchNumbers`; เลขทองของเฟส: หักเครดิต 8,000
     จากเจ้าหนี้ 11,000 → redirect gross 11,000, recall net 3,000 (golden ผ่าน production chain
     ใน `exchange-priced-flow.integration.spec.ts`). ข้อ (b) endpoint เงินสดคืน = Task 6:
     `POST /interco-settlement/recalls/:contractId/settle-cash` (OWNER/FM, Serializable,
     P2034/P2002 → 409) — FINANCE ผ่าน template + `typeStamp: 'PAYOUT_RECALL'` (default
     `'SHOP_COLLECT'` ⇒ JP4 เดิม byte-identical), SHOP leg `Dr S21-3001 / Cr S-bank` ใน tx
     เดียว; guards: amount ≤ net + สองสมุดตรง ±0.01 + block RECALL item ใน batch เปิด;
     audit `INTERCO_RECALL_CASH_SETTLED`

### 5.5 exchange-cancel
- เพิ่ม branch เดียวกัน: ถ้าสัญญาใหม่ของ swap ถูกตัดจ่ายแล้ว → C-2 semantics (แทนขาเจ้าหนี้/ลูกหนี้ SHOP ด้วย 11-2107/S21-3001) — ปัจจุบัน mirror ตรงๆ จะสร้างเจ้าหนี้ติดลบ
- **[implemented — Task 5]** guard batch เปิด + detect/redirect/cross-check ชุดเดียวกับ generic
  (import `C2_REDIRECTS`/`C2_REDIRECT_STAMP`/`settledPayoutByContract` — ห้ามสำเนาที่สอง) +
  `cancelWindow: 'AFTER_PAYOUT'` (C-1 exchange ยัง `'FREE'`); audit `EXCHANGE_CANCELED` เพิ่ม
  `recallAmount` (net) + `batchNumbers`; FINALIZED-path audit ย้ายไป**หลัง tx commit** (doctrine
  R-1 — `AuditService.log` เปิด root-tx ซ้อน = P2028 pool starvation + phantom row บน rollback)

## 6. Phase 4 — รายงาน + Alerts + Validation

> **สถานะ: `[implemented]` ครบทั้ง 4 ข้อ (2026-08-21)** — plan
> `docs/superpowers/plans/2026-08-21-interco-reconcile-phase4.md`; เอกสารอ้างอิงที่เป็น
> source of truth หลัง implement = `.claude/rules/accounting.md` หัวข้อ
> **"การกระทบยอดระหว่างกิจการ (Phase 4)"**. ย่อหน้าด้านล่างคงข้อความ spec เดิมไว้ พร้อม
> ระบุ **จุดที่ implement ต่างจาก spec จริง** — อย่าอ่าน spec ข้อนี้เดี่ยวๆ แล้วสรุปพฤติกรรม.

1. **รายงานอายุลูกหนี้หน้าร้าน (11-2107)** `[implemented]`: endpoint `GET /interco-settlement/shop-receivable-aging` — ต่อสัญญา: ยอดต่อประเภท (3 คอลัมน์ SWAP_CREDIT / PAYOUT_RECALL / SHOP_COLLECT) + อายุ (วันจาก posted_at ของ JE ตั้งหนี้) + UI section ในหน้า interco
   - **ต่างจาก spec — ยอด "คงเหลือจริง" เป็น 2 กลุ่ม ไม่ใช่ 3 คอลัมน์ล้วน**: SWAP_CREDIT + PAYOUT_RECALL ยุบเป็น `intercoNet` (= gross สองประเภท − `settledDeduction`) ส่วน SHOP_COLLECT แยกคอลัมน์. เหตุผล: `settledDeduction` หักที่ **ระดับสัญญา** ไม่แยกประเภท (สัญญา swap ที่ถูกยกเลิกภายหลังมีประวัติข้ามประเภท) ⇒ ถ้าโชว์ 3 คอลัมน์ **สุทธิ** ต้องเดาว่า deduction ไปหักประเภทไหน = ตัวเลขผิด. คอลัมน์ **gross** รายประเภทยังมีครบบนแถว (`swapCreditGross` / `payoutRecallGross`) — invariant เดียวกับสูตร combined ของ `alarmNettingResiduals` (Phase 3 Task 4)
   - **เพิ่มจาก spec**: `shopMirrorGross`/`shopMirrorNet` (S21-3001 ต่อสัญญา, conditional group key), `bookMismatch`, และ **`legacyOneBook`** — flag แยก swap ยุคก่อน Phase 1 (§11.4) ออกจาก totals/overdue เพราะคอลัมน์ typed ของแถวนั้นค้าง +/− ถาวรแม้ยอดบัญชีจริงเป็น 0 (ล้างผ่าน shop-collect ซึ่ง stamp คนละประเภท) — ถ้าไม่มี flag นี้ระบบจะเตือนเท็จทุกวันตลอดไป. หนี้ legacy จริงรายงานแยกใน `totals.legacyOneBookNet`
   - **`asOf` มีผลกับ "อายุ" เท่านั้น — ยอดคงเหลือเป็นยอดปัจจุบันเสมอ** (twins ไม่มี date filter; deduction gate อ่านสถานะ batch ปัจจุบัน) ⇒ UI **จงใจไม่มี date picker**
2. **Cron รายวัน** (`shop-receivable-aging.cron`) `[implemented]`: ค้างเกิน 30 วัน → Todo MEDIUM (dedup ต่อ สัญญา+ประเภท) + Sentry warning (`subsystem: 'interco-netting'`)
   - เวลาจริง **09:07 BKK**; kill switch `shop_receivable_aging_alerts_enabled` (default `true`) + เกณฑ์วัน `shop_receivable_aging_alert_days` (default 30, ช่วง 1-365 — นอกช่วงคืน fallback ไม่ clamp)
   - **ต่างจาก spec — dedup ต่อ "สัญญา" ไม่ใช่ "สัญญา+ประเภท"**: หนึ่ง Todo ต่อสัญญาครอบทุกแขนที่ค้าง (แขนแก่สุดขึ้นหัวเรื่อง, รายละเอียดสองแขน + วิธีล้างอยู่ในคำอธิบาย) — สองใบต่อสัญญาเป็นเสียงซ้ำที่คนจะเลิกอ่าน และ "ประเภท" ยุบเป็น "แขน" (`INTERCO` / `SHOP_COLLECT`) ตามข้อ 1 อยู่แล้ว
   - **ไม่ alert แถว `legacyOneBook` รายแถว** แต่ยิง Sentry **รวมหนึ่งอีเวนต์ต่อรอบ** เมื่อ `legacyOneBookNet > 0.01` (gate ด้วยยอดจริง ไม่ใช่จำนวนแถว)
3. **Cron รายเดือน** (`interco-reconcile.cron`, วันที่ 1 08:00 BKK) `[implemented]`: เทียบ FINANCE (21-1101+21-1102 คงค้าง, 11-2107 ต่อประเภท) ↔ SHOP (S11-3001+S11-3002, S21-3001) — ไม่ตรง (นอกเหนือ legacy driftNote เดิม) → Todo + Sentry
   - kill switch `interco_reconcile_enabled` (default `true`); Todo **HIGH หนึ่งใบต่อเดือน** tag `interco-reconcile` (dedup ด้วย `yyyy-mm` เวลาไทย)
   - **5 finding kinds** (spec เดิมไม่ได้แจกแจง): `BOOK_MISMATCH` (ปิด carry e) · `SWAP_CREDIT_ONE_BOOK` (ปิด carry c) · `PAYABLE_PAIR_MISMATCH` · `NEGATIVE_TYPED` (ตาข่ายของ carry d) · `ACCOUNT_DRIFT` — แต่ละตัวมีเกณฑ์แยก legacy ของตัวเอง (ดูตารางใน accounting.md)
   - **drift ของคิวรอจ่ายต้องบวกกลับรอบที่ค้างอนุมัติก่อนตัดสิน** — รอบ `PENDING_APPROVAL` จองสัญญาแล้วแต่ยังไม่โพสต์ JE ⇒ drift ติดลบเท่ายอดรอบนั้นพอดี = สภาพปกติ ไม่ใช่ anomaly
   - **รายงานอย่างเดียว ไม่แตะ GL แม้แต่บรรทัดเดียว** — ไม่ตั้ง JE ปรับปรุงเอง (คลาสเดียวกับ opening-balance gap §11 ที่รอ CPA)
4. Trial balance: ไม่ต้องแก้ — S21-3001 เข้า SECTION_MAP อัตโนมัติผ่าน prefix S21 `[verified 2026-08-21]` (`accounting-section-map.util.ts` มี `'S21': 'หนี้สินหมุนเวียน (SHOP)'` อยู่แล้ว — ไม่มีการแก้โค้ดรายงานในเฟสนี้)

**Carry ที่ปิดไปในเฟสนี้:** (c) เครดิต A.3-only งอกหลัง approve → `SWAP_CREDIT_ONE_BOOK` ·
(d) TOCTOU settle-cash vs approveBatch → **`approveBatch` เปลี่ยนเป็น Serializable ที่ต้นเหตุ**
(SSI ต้องการให้ทั้งคู่เป็น Serializable จึงจะเห็นกัน) + P2034 → 409 ไทย, ตาข่าย =
`NEGATIVE_TYPED` · (e) คิว recall กรอง net ฝั่ง FINANCE เท่านั้น → `BOOK_MISMATCH`.
**ยังเปิด → Phase 5:** `COMMISSION_ONLY_GAP` (สัญญาที่ `storeCommission` ว่าง — 1A ตั้ง
fallback 10% บน 21-1102 แต่ขา SHOP ตั้ง 0) — reconcile รายงานพร้อมป้ายกำกับแล้ว แต่ยังไม่แก้
ต้นเหตุ เพราะเป็นความต่างจริงในบัญชี (opening-balance gap §11) ที่ต้องให้เจ้าของ/CPA ตัดสิน ·
**`approveCancellation` ยังเป็น READ COMMITTED** (Phase 4 ยกเฉพาะ `approveBatch`; เส้นทาง
ยกเลิกได้แค่ `P2002 → 409`) · **`swapCreditShopBalance`/Query B ฝั่ง S21-3001 เป็น stamp-only
ไม่มี flow fallback** ทั้งที่ `FLOW_MAP` map `shop-exchange-return → SWAP_CREDIT` — แคบกว่า
`classifyShopReceivable` โดยตั้งใจ รอเคสจริง/CPA. รายละเอียดทั้งหมดอยู่ใน accounting.md
หัวข้อ "รอ Phase 4 (carry)" → บล็อก "ยังเปิดอยู่ → Phase 5".

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
2. มูลค่าสต็อกเครื่อง re-intake = ราคารับซื้อ (แทน costPrice เดิม) — ต้นทุนจริงที่ SHOP ซื้อคืนจาก FINANCE **และจังหวะ COGS-relief ฝั่ง SHOP เปลี่ยน**: เดิม Cr S50-1102 ทันทีวันเปลี่ยนเครื่อง → ใหม่ผลกระทบ COGS ไปออกตอนขายซ้ำผ่าน costPrice ใหม่
3. การหักกลบเจ้าหนี้/ลูกหนี้ระหว่างกันในรอบจ่าย (จุดที่ 3) แทนการโอนเงิน 2 ขา
4. PAYOUT_RECALL จากการยกเลิกสัญญาหลังตัดจ่าย
5. A.2 เปลี่ยนวิธีรับรู้จาก gross → **สุทธิ** (ตัดขา Cr 41-1101, loss เหลือเฉพาะส่วนต่างราคารับซื้อ vs มูลค่าตามบัญชี) ตาม workbook — กำไรสุทธิไม่เปลี่ยน แต่บรรทัดรายได้ดอกเบี้ย/ขาดทุนรับคืนเครื่องในงบเล็กลงคู่กัน
6. บัญชี gain กรณีราคารับซื้อ > มูลค่าตามบัญชี: โค้ดคง 41-1102 (unreachable ภายใต้ guard) — workbook ระบุกลุ่ม 42-xxxx ถ้า CPA ต้องการย้ายค่อยสั่ง

## 10. Testing ต่อเฟส

| เฟส | เทสต์หลัก |
|---|---|
| 1 | template spec A.4 ใหม่ + A.2 วิธีสุทธิ (ไม่มีขา 41-1101, loss 126.68 ตาม fixture) + `classifyShopReceivable` unit + update `exchange-priced-flow.integration.spec.ts` (S21-3001 ค้าง 8,000 หลัง finalize; cancel-sweep net 0 รวม S21-3001 + restore costPrice) |
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
