# Accounting Rules (TFRS for NPAEs — Full Accrual, Phase A.4)

## Standard
- TFRS for NPAEs (มาตรฐานรายงานทางการเงินสำหรับกิจการที่ไม่มีส่วนได้เสียสาธารณะ)
- **Full Accrual TFRS 15** — ดอกเบี้ยรับรู้ตามงวด ผ่าน 11-2106 Unearned Interest (Contra Asset)
- **Accrual VAT** — ตั้งภาษีวันเปิดสัญญา (11-2105/21-2102) ล้างทีละงวดเข้า 21-2101
- Single **FINANCE chart** (111 accounts ณ 2026-08-08 — ตัวเลขนี้เดินตาม CSV ไม่ใช่ค่าคงที่; เดิม 99 ตอน Phase A.4, 110 ก่อน 21-1107 เพิ่ม 2026-08-08) — SHOP-side deferred to A.5
- Source of truth: `docs/superpowers/specs/2026-05-04-accounting-phase-a4-cpa-chart-adoption-design.md` + CSV at `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/`

## Phase A.0-A.3 Status
Phase A.0-A.3 is **wholly superseded**. All A.0-A.3 dead code was purged in T3.
Do NOT reference old A.0-A.3 JE templates, chart codes, or journal service methods.

---

## ⚖️ คำวินิจฉัยผู้สอบบัญชี รอบ 2026-08-24 — อ่านก่อนแตะเรื่องที่เคยเขียนว่า "รอ CPA"

**บันทึกฉบับเต็ม: `docs/accounting/cpa-answers-2026-08-24.md`** (คำถาม:
`docs/accounting/cpa-questions-2026-08-24.html`) — 13 ข้อ, ตรวจผลกระทบกับโค้ดจริงแล้ว

> ⚠️ **สถานะการทำตามคำวินิจฉัย (2026-08-24)**
> - ✅ **B4 เท่านั้นที่แก้โค้ดแล้ว** — `S21-3001` → `S21-1104` ทั้ง CSV + 194 จุดใน 34 ไฟล์
>   (type-check ผ่านทั้ง api/web). **ยังไม่ได้รันอะไรบน prod** — ต้อง deploy → `seed:coa` →
>   `docs/accounting/retire-S21-3001-to-S21-1104-2026-08.sql` ตามลำดับ
> - ✅ **C1 แก้โค้ดแล้ว** — `resolveStoreCommission` helper เดียวแทนสูตร 10% ที่เคยมี 6 สำเนา
>   ⇒ สองสมุดตั้งค่าคอมตรงกันโดยโครงสร้าง (forward-only — สัญญาเก่ายังต้องมีรายการแก้ย้อนหลัง
>   ซึ่ง **ยังรอผู้สอบชี้บัญชีคู่**)
> - ⏳ **ข้ออื่นยังไม่แก้โค้ด** — หัวข้ออื่นของไฟล์นี้ยังบรรยาย **พฤติกรรมปัจจุบันของระบบ**
>   ซึ่งถูกต้องตามที่เป็นอยู่ อย่าอ่านว่าทำตามคำวินิจฉัยแล้ว

| ข้อ | คำวินิจฉัย | กระทบอะไรในไฟล์นี้ |
|---|---|---|
| **A1 + B4 + C5** | เปิดบัญชี **`S21-1104` เจ้าหนี้ FINANCE** ฝั่ง SHOP · **`S21-3001` ผิด ต้องเปลี่ยนมาใช้ตัวนี้** ✅ *(โค้ดเปลี่ยนแล้ว, prod ยังไม่ได้รัน)* | หัวข้อ Device Swap (A.4), หักกลบรอบจ่าย Phase 2, Flow C-2, รายงานอายุ Phase 4, Payroll "จ่ายรวมฝั่งเดียว" |
| **A2** | **ต้องตั้ง** ยอดยกมาฝั่ง SHOP ย้อนหลัง (สัญญาก่อน 2026-06-23) | `legacyNoShop` policy · interco spec §11 opening-balance gap |
| **A3** | ผู้สอบ**ไม่ให้ตัวเลข** — ให้ทำคู่มือ/หน้าจอบันทึกยอดตั้งต้นเอง | Equity rollout ข้อ 3 (CAP_INIT backfill) |
| **A4** | ปล่อยไว้ (สัญญาทดสอบ) | ใบลดหนี้ RT-202608-00006 — forward-only ตามเดิม |
| **B1 B2 B3 C3** | **ยืนยันว่าถูกต้อง** — ตรวจแล้วโค้ดตรงตามที่รายงานไป | ไม่ต้องแก้ (B2 วิธีถูก แต่รหัสบัญชีเปลี่ยนตาม B4) |
| **C1** | SHOP **ต้องตั้ง**ค่าคอมให้ตรง FINANCE เพราะเป็นรายได้หน้าร้าน `S41-1201` | ปิดทางเลือก (ข) ของ `COMMISSION_ONLY_GAP` — เลือก (ก) |
| **C2** | เงินพักที่เหลือตอนปิดสัญญาก่อนกำหนด → ลดยอดค้าง + **รับรู้เป็นรายได้** | "ยังไม่ตัดสิน (CPA-gated)" ของ residual ถังพัก |
| **C4** | ใบขายจากใบจอง — **แก้ไปข้างหน้าอย่างเดียว** | หมายเหตุ "แจ้ง CPA" ที่ด่าน G8 |

**✅ ตอบรอบ 2 แล้ว 2026-08-25 — 5 ใน 6 ข้อที่เคยบล็อกกลายเป็นโมฆะ**
(รายละเอียด: `docs/accounting/cpa-answers-2026-08-24.md` หัวข้อ "คำตอบรอบ 2")

> **หัวใจ:** *"ข้อมูลทั้งหมดที่ผ่านมาเป็นการทดสอบโปรแกรม เมื่อใช้จริงจะล้างออก"*
> ⇒ **งานตั้งยอดยกมา + รายการแก้ย้อนหลังทั้งหมดเป็นโมฆะ** เริ่มใหม่เหมือนเปิดบริษัทใหม่

- **ย้ายรายการ S21-3001** → โมฆะ (ข้อมูลทดสอบ + prod ไม่มีบัญชีนี้เลย)
- **C5 "แยกจ่าย" หรือ "แยกบันทึก"** → **(ก) ห้ามจ่ายรวม ต้องแยกจ่าย** ⇒ โค้ด payroll ที่แยกฝั่ง
  อยู่แล้ว **ถูกต้องตามคำวินิจฉัย ไม่ต้องแก้** · `S21-1104` ไม่ต้องรองรับการจ่ายแทนกัน
- **รายการแก้ค่าคอมย้อนหลัง** → ไม่ต้องทำ (จะล้างข้อมูล) · fallback 10% **คงไว้ทุกสัญญา
  แต่ต้องทำให้ตั้งค่าได้**
- **ยอดยกมา SHOP/FINANCE** → ล้างแล้วดึงจากระบบเดิม ไม่ใช่ตั้งย้อนหลัง
- **ขามัดจำใบจอง** → **บันทึกตอนรับเงิน** (`Dr เงินสด / Cr S21-2002`)

**❓ ที่ยังบล็อกจริง — เหลือ 1 ข้อครึ่ง:**
- **บัญชีรายได้ของเงินพักปรับดิวที่เหลือ** — รอบ 2 ตอบว่า *"คือค่างวดที่ลูกค้าจ่ายล่วงหน้า
  (ไม่ควรมียอดค้าง 165.42)"* แต่ **ยังไม่ระบุบัญชี** และ**ขัดกับ C3 รอบแรก**
  ที่ตอบว่าพฤติกรรมปัจจุบัน (ซึ่ง*สร้าง* 165.42) ถูกแล้ว — ดูบันทึกฉบับเต็ม
- **บัญชีรายได้ริบมัดจำ** (กรณีลูกค้าไม่มารับของ) — ยังไม่มีในผัง ยังไม่ได้ถาม

**กติกาเดิมยังใช้: ห้ามเดา JE ปิดช่องว่างเอง** — คำวินิจฉัยที่ยังไม่ครบพอให้ลงรายการได้
ถือว่ายังบล็อกอยู่เหมือนเดิม

---

## Chart of Accounts (111 accounts ณ 2026-08-08 — FINANCE only)

Full list lives in `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv`.
Key codes referenced by JE templates:

### Assets (11-XXXX)
| Code | Name |
|------|------|
| 11-1101 | เงินสด — สุทธินีย์ คงเดช |
| 11-1102 | เงินสด — เอกนรินทร์ คงเดช |
| 11-1103 | เงินสด — พนักงานบัญชี |
| 11-1201 | ธนาคาร KBank |
| 11-1202 | ธนาคาร SCB (ค่าใช้จ่าย) |
| 11-1203 | ธนาคาร SCB (ค่าเสื่อม) |
| 11-2101 | ลูกหนี้ผ่อนชำระ (HP Receivable Gross) |
| 11-2102 | ค่าเผื่อหนี้สงสัยจะสูญ (Allowance for Doubtful — Contra) |
| 11-2103 | ลูกหนี้ค้างชำระ (Accrued Receivable) |
| 11-2104 | ลูกหนี้-VAT ที่ออกแทน |
| 11-2105 | ลูกหนี้ภาษีขายรอเรียกเก็บ (VAT Receivable — Accrual) |
| 11-2106 | รายได้รอตัดบัญชี-ดอกเบี้ย (Unearned Interest — Contra Asset) |

### Liabilities (21-XXXX)
| Code | Name |
|------|------|
| 21-1101 | เจ้าหนี้-หน้าร้าน (ยอดจัด) |
| 21-1102 | เจ้าหนี้ค่าคอม-หน้าร้าน |
| 21-1103 | เงินรับล่วงหน้า (Advance from customer) |
| 21-1107 | เจ้าหนี้เงินคืนลูกค้า-ยึดเครื่อง — **ปิดใช้ 2026-09-05 (ไม่มีเงินคืนส่วนต่างอีกต่อไป — ดูหัวข้อ "ยึดเครื่อง — ราคาเดียว")** · เดิม: ตั้ง ณ วันยึดเมื่อราคากลาง > ยอดปิด (JP5) ล้างผ่าน RefundPayoutTemplate · บัญชีคงไว้ในผัง (prod ไม่มีแถวใช้) |
| 21-2101 | ภาษีขาย ภ.พ.30 (VAT Output — settled) |
| 21-2102 | ภาษีขายรอเรียกเก็บ (VAT Deferred Output) |
| 21-2103 | VAT บังคับ-ลูกหนี้ค้าง 60 วัน |

### Revenue (41-XXXX / 42-XXXX)
| Code | Name |
|------|------|
| 41-1101 | รายได้ดอกเบี้ย (HP Interest — Accrual) |
| 41-1102 | รายได้จากการยึดสินค้า (Repossession Income) |

### Expenses (51-XXXX / 52-XXXX / 53-XXXX)
| Code | Name |
|------|------|
| 51-1101 | ค่าใช้จ่าย VAT ลูกหนี้ไม่ชำระ |
| 51-1102 | หนี้สูญ/ขาดทุนจากยึดเครื่อง (also: write-off loss plug) — หลังหักเงินของลูกค้าที่ค้าง 21-1103/21-5101 และส่วนลด 52-1106 ของ JP5 (PR6 — หัวข้อ "ยึดเครื่อง (JP5) / ตัดหนี้สูญ — หักเงินของลูกค้าที่ค้าง…") |
| 51-1103 | ค่าเผื่อหนี้สงสัยจะสูญ (เพิ่มในปี) — ECL provision expense, contra to 11-2102 |
| 51-1105 | VAT กลับรายการ |
| 52-1104 | ส่วนลดเศษสตางค์ (≤1฿ rounding tolerance) |
| 52-1106 | ส่วนลดดอกเบี้ย-ปิดยอด (Early payoff discount) · ส่วนลดยอดปิดตอนยึดเครื่อง (JP5 — ฝ่ายบัญชีเลือก "แบบ (ก)" 30/09/2569 · PR6) |
| 53-1503 | กำไร/ขาดทุนจากการปัดเศษ |

---

## JE Templates

Templates live at `apps/api/src/modules/journal/cpa-templates/`.
All templates are verified against CPA CSV golden fixtures in `__tests__/fixtures/cpa-cases/`.

| Template Class | Trigger | Key Accounts |
|----------------|---------|-------------|
| `ContractActivation1ATemplate` | Contract activated | Dr 11-2101 / Cr 21-1101 + 21-1102 + 21-2102 + 11-2106 |
| `InstallmentAccrual2ATemplate` | Daily cron 00:01 BKK (วันครบกำหนด — ส่วนที่เหลือของงวด) **หรือ ณ วันรับเงิน**: ใบที่ทำให้งวดชำระครบ (ส่วนที่เหลือ) · ใบบางส่วนก่อนวันครบกำหนด (เท่ายอดที่รับ — ก1) (หัวข้อ "ตั้งลูกหนี้งวด ณ วันรับเงิน") | Dr 11-2103 / Cr 41-1101 + Dr 11-2105 / Cr 21-2102 |
| `PaymentReceipt2BTemplate` | Payment received (single) | Dr cash / Cr 11-2101 + 11-2103 + 21-2101 cleared from 21-2102 |
| `PaymentReceipt2BSplitTemplate` | Partial payment | As above with pro-rata split |
| `EarlyPayoffJP4Template` | Early payoff | Includes Dr 52-1106 (discount) + reverse remaining 11-2106 |
| `RepossessionJP5Template` | ยืนยันใบรับเครื่องคืน (`DeviceReturnsService.confirm` → `RepossessionsService.createInTx`; `create()` + `POST /repossessions` ถูกลบ 2026-09-20) | Loss branch: Dr 51-1102; Gain branch: Cr 41-1102; `Dr <deposit>` = **ราคาประเมิน** (ราคาเดียว 2026-09-05) ลง **`11-2107` เสมอ stamp `shopReceivableType: 'DEVICE_RETURN'` + `deviceReturnId`** (2026-09-20 — ไม่มีโหมดโอนสด/`collectedByShop` อีก). optional `input.customerRefund` → Cr 21-1107 ยังอยู่ใน template แต่ **caller ไม่ส่งอีกแล้ว** (คำตัดสินเจ้าของ 2026-09-05 supersede 2026-08-08 ข้อ 2) · PR6: `Dr 21-1103` / `Dr 21-5101` เงินของลูกค้าที่ค้างทุกประเภท + `Dr 52-1106` ส่วนลดยอดปิด (`input.discount`) ก่อน plug |
| `RefundPayoutTemplate` | Manual — `POST /repossessions/:id/refund-payment` — **legacy เท่านั้น (2026-09-05)**: ใช้ได้เฉพาะแถวยึดที่เคยติ๊กคืนเงินก่อนนโยบายใหม่ (prod ไม่มี) | Dr 21-1107 / Cr depositAccountCode — clears the 21-1107 balance JP5 parked |
| `RefundWaiveTemplate` | Manual — `POST /repossessions/:id/refund-waive` — **legacy เท่านั้น (2026-09-05)** | Dr 21-1107 / Cr 41-1102 — ล้างยอด 21-1107 คงเหลือทั้งหมดเข้ารายได้จากการยึดสินค้า |
| `RescheduleJP6Template` | Reschedule (6a/6b variants) | Reclassify overdue to 21-1103 advance |
| `Vat60dayMandatoryTemplate` | Daily cron 02:00 BKK | Mandatory VAT on 60-day overdue installments |
| `Vat60dayReversalTemplate` | Payment after 60-day flag | Reversal when overdue payment received |

`VendorClearanceTemplate` (was: `Dr 21-1101 + 21-1102 / Cr 11-1201`) was **deleted** 2026-08-01 —
dead code, never had a production caller. Its intended trigger (clearing 21-1101/21-1102 on
payment to SHOP) is now handled by the Inter-Co Settlement Batch flow — see "Inter-Co Settlement
Batch — เมนูจ่ายให้หน้าร้าน (C2, 2026-08-01)" below.

---

## ยึดเครื่อง — ราคาเดียว + ไม่มีเงินคืนส่วนต่าง (คำตัดสินเจ้าของ 2026-09-05)

Spec: `docs/superpowers/specs/2026-09-05-repossession-single-price-design.md` · โค้ด:
`repossessions.service.ts` (`previewCalculation` / `createInTx` — `create()` ถูกลบ 2026-09-20 ทางเข้าเดียวคือ
`DeviceReturnsService.confirm`), `RepossessionOverlay.tsx` (โหมดยืนยันอย่างเดียว — ดูหัวข้อย่อย
"ใบรับเครื่องคืน (DeviceReturn)" ท้ายส่วนนี้)

**คำตัดสิน (ปิดประเด็น — อย่าเสนอกลับ):**
1. **ไม่มีเงินคืนส่วนต่างให้ลูกค้า** — ปพพ. ม.574 ให้ผู้ให้เช่าซื้อริบเงินที่ชำระแล้วและเอาของคืน
   ไม่บังคับคืนส่วนต่าง ⇒ นโยบายเจ้าของเลือกไม่คืน **supersede คำสั่ง 2026-08-08 ข้อ 2**.
   เดิม `create()` ปฏิเสธ `customerRefundEnabled=true` (400 ไทย); ตั้งแต่ 2026-09-20 ลบ public `create()`
   และ `POST /repossessions` แล้ว — ใบรับเครื่องคืน/โหมดยืนยันไม่มีตัวเลือกคืนเงินส่วนต่าง;
   `previewCalculation` คืน `customerRefund = 0` เสมอ. บัญชี 21-1107 + `RefundPayoutTemplate` /
   `RefundWaiveTemplate` + endpoints **คงไว้เพื่อแถวยึดเก่าที่เคยติ๊ก** (prod หลัง factory reset ไม่มี).
2. **ราคาเดียว** — เหลือ "ราคาประเมิน" ช่องเดียว = ราคาที่หน้าร้านรับเครื่องไปจาก FINANCE = ยอดที่ JP5
   ลง `Dr 11-2107`. ใบรับเครื่องคืนเก็บราคาตารางไว้เป็นตัวเทียบ ไม่ใช่ราคาที่กรอกเพิ่มเพื่อคำนวณเงินคืน
   (DTO ของ public `create()` เดิมที่มี `marketValue` ถูกลบแล้ว).
3. **ตารางรับซื้อมือสอง (`TradeInValuation`) เป็นค่าตั้งต้น + ตัวเทียบ** — เลือกเกรด → preview ค้น
   (ยี่ห้อ, รุ่น, ความจุ, เกรด) เติมราคาประเมินให้ (แก้ทับได้; ค่าที่พิมพ์เองไม่ถูกทับเมื่อสลับเกรด) ·
   **ด่าน ±15%** ชุดเดียวกับหน้ารับซื้อ (`TradeInLifecycleService.PRICE_CEILING/FLOOR_RATIO`):
   ต่างจากตารางเกิน 15% ต้องมีเหตุผลใน `notes` ที่ intake UI และ `DeviceReturnsService.create`
   พร้อมตรวจซ้ำใน `RepossessionsService.createInTx` ตอนยืนยัน
   (`RepossessionsService.TABLE_DEVIATION_LIMIT` → 400 ไทย) · ไม่มีรุ่นในตาราง = ตีราคาเอง ไม่มีด่าน.
4. **คอลัมน์ `Repossession.marketValue` เปลี่ยนความหมายเป็น snapshot ราคาตารางรับซื้อ ณ วันยึด**
   (ไม่มีในตาราง = ราคาประเมิน) · `profitLoss` = ราคาประเมิน − ยอดปิดสัญญา · `customerRefund` = 0.
   ไม่มี migration — ก่อนหน้านี้ไม่มีผู้อ่านสองคอลัมน์นี้เลย (grep 2026-09-05).
5. **preview เลิกถอยไปใช้ `product.costPrice`** — ไม่มีราคาประเมิน = `marketValueSource: null` และจอโชว์ "—"
   (เดิมโชว์ต้นทุนซื้อเข้าเป็น "ราคากลาง" ทั้งที่ create ไม่เคยใช้เลขนั้น).

**ขาคู่ฝั่ง SHOP ของการยึด (ทำแล้ว 2026-09-05 — ปิด "ASYMMETRY ที่รู้ตัว" ต้นทาง JP5; เหลือรูปเดียว 2026-09-20):**
`ShopCollectShopLegs.postRepossessionIntake` (`cpa-templates/shop-collect-shop-legs.template.ts`, ไม่ใช่ Nest provider —
สร้างภายในผู้เรียก) โพสต์ใน tx เดียวกับ JP5 (`RepossessionsService.createInTx`):

```
Dr S11-2002 สินค้าคงคลัง-มือถือมือสอง        [ราคาประเมิน]
   Cr S21-1104 เจ้าหนี้ FINANCE                 [ราคาประเมิน]   ← เสมอ (FINANCE Dr 11-2107) · stamp DEVICE_RETURN + contractId + productId + deviceReturnId
```
flow `shop-repossession-intake`, key `shop-repossession-intake:<contractId>`, `metadata.contractId`.
**สาขา `Cr S11-1202` (หน้าร้านโอนให้ FINANCE ทันที, ไม่ stamp) ถูกลบ 2026-09-20** — วันยึด/รับคืนไม่มีเงินโอนจริง
(spec 2026-09-20 §1: ค่าเริ่มต้นเดิม `collectedByShop=false` ทำให้ยอดธนาคาร FINANCE เกินจริงเท่าราคาประเมิน) · stamp
`SHOP_COLLECT` บนขานี้เปลี่ยนเป็น `DEVICE_RETURN` (แถวยึดก่อน 2026-09-20 ยังเป็น `SHOP_COLLECT` — forward-only).
`DeviceReturnsService.confirm` เรียก `assertRepossessionPeriodsOpen` เพื่อตรวจ `validatePeriodOpen` ของ
**ทั้งสองบริษัท** ก่อนเปิด tx; `createInTx` ใน tx นั้น flip
`product.ownedByCompanyId` → SHOP + `category PHONE_NEW → PHONE_USED` + **`branchId = receivingBranchId`** (ขายต่อผ่าน
POS จึงลง Cr S11-2002 ถูกบัญชี และเครื่องอยู่ที่สาขาที่รับจริง — D7).

ใบล้างเจ้าหนี้ (`ContractPaymentService.shopCollectSettlement` หลัง `ShopCollectSettlementTemplate`):
`Dr S21-1104 / Cr S11-1202` flow `shop-collect-settlement-shop` key `<flow>:<contractId>:<requestId|amount>`
**เฉพาะเมื่อ** `shopCollectShopBalance(tx, id)` (S21-1104 typed SHOP_COLLECT) คุ้มยอด — แถวต้นทาง **JP4**
(ปิดยอดหน้าร้านรับแทน — ยังไม่มีขา SHOP ตอนตั้งหนี้ เพราะต้องเลือกบัญชีเงินสด SHOP ต่อสาขา
`resolveBranchCashAccount` ที่ fail-closed) และแถวก่อนฟีเจอร์ถูกข้ามพร้อม `shopLegSkipped: 'NO_SHOP_PAYABLE'`
ใน AuditLog `SHOP_COLLECT_SETTLED` (ใบ FINANCE dedupe → `'DEDUPED'`). **ห้ามโพสต์ขา SHOP โดยไม่มีด่านนี้** —
S21-1104 ติดลบ. `settleRecallCash` (PAYOUT_RECALL) มี SHOP leg ของตัวเองอยู่แล้ว ไม่แตะ.

**เลนส์ S21-1104 รู้จัก SHOP_COLLECT แล้ว** (`interco-aging.service.ts` Query B + `getTypedAccountDrift`,
`interco-typed-balance.ts shopCollectShopBalance`): คอลัมน์ใหม่ `shopMirrorCollectGross` แยกเหมือน
ฝั่ง FINANCE (`shopCollect`) — **ไม่รวม** ใน `shopMirrorGross`/`shopMirrorNet`/`bookMismatch` (กลุ่ม interco
ล้างผ่านรอบจ่าย ส่วน SHOP_COLLECT ล้างผ่านใบ shop-collect). ถ้าไม่เติมประเภทนี้ใน drift lens, reconcile
รายเดือนจะยิง `ACCOUNT_DRIFT` บน S21-1104 ทุกเดือนตั้งแต่การยึดครั้งแรก.

**ขายต่อเครื่องยึด = ผ่าน POS หรือเปิดสัญญาผ่อนใหม่เท่านั้น (2026-09-05, ขยายหลัง review):** แถว
`Repossession` ปิด/เปิดผ่าน helper เดียว `repossessions/repossession-resale.util.ts` —
`closeRepossessionOnSale` (→ `SOLD` + `resellPrice` = ราคาขายจริง) เรียกจาก `SaleWriterService`
(ขายสด/ไฟแนนซ์ภายนอก) และ `ContractWorkflowService.activate` (ขายผ่อนใหม่ — stamp `soldContractId`);
`reopenRepossessionOnUnsale` (→ `READY_FOR_SALE`) เรียกจาก `SaleVoidService` และ
`ContractCancellationService.approveCancellation` (C-1). **ห้ามเขียน updateMany ชุดที่สอง.**
`VALID_TRANSITIONS.READY_FOR_SALE = []` และ `update()` ปฏิเสธ `status: 'SOLD'` ด้วยข้อความไทยที่ชี้ปุ่ม
"พร้อมขาย" + ถ่ายรูป 6 มุมให้ครบก่อน (2026-09-07: เครื่องยึดเข้าคิว `PHOTO_PENDING` แทน `REFURBISHED` —
ดู `.claude/rules/database.md` state diagram; `update()` ปฏิเสธ `status: 'READY_FOR_SALE'` ด้วย ประตูเดียวคือ
`markReadyForSale` ที่บังคับสองราคา) — สาขา SOLD เดิมใน `update()` ถูกลบทิ้ง.
JE ตอนขาย = `ShopCashSaleTemplate` / `ShopInventoryTransferTemplate` ปกติ (Cr S11-2002 ที่ `costPrice` =
ราคาประเมิน ตั้งโดย `markReadyForSale` ⇒ สต็อกมือสองกลับเป็น 0 พอดีกับใบรับเข้า — ปักที่
`product-lifecycle.integration.spec.ts`). เส้นทางเปลี่ยนเครื่อง (device swap) ที่หยิบเครื่องยึดไปเป็นเครื่องใหม่
**ยังไม่ปิดแถวยึด** — ยังไม่มีเคสจริง.

**ด่านของ `create()` ที่เพิ่มจาก review 2026-09-05 (preview `eligibility` ใช้กติกาชุดเดียวกัน — ข้อความอยู่ใน
`ZERO_OUTSTANDING_MSG` / `RE_REPOSSESSION_MSG` ของ `repossessions.service.ts`):**
- **ยอดค้าง ≤ 0 → 400** — ผ่อนครบ = เครื่องเป็นของลูกค้า (ปพพ. ม.572); และถ้าปล่อยผ่าน JP5+ใบรับเข้าจะไม่โพสต์
  (เดิม gate ที่ `outstanding > 0`) แต่เครื่องถูกย้ายเข้า SHOP อยู่ดี ⇒ S11-2002 ติดลบตอนขายต่อ.
- **เครื่องเคยมีแถว `Repossession` → 409** — `Repossession.productId` เป็น `@unique` ⇒ loop
  ยึด→ขายต่อ→ผ่อนใหม่→ค้างอีก บันทึกครั้งที่สองไม่ได้ (ด่าน `findFirst` ก่อน JP5 + แปลง P2002 เป็น 409 เดียวกัน
  เป็นตาข่าย). **ยังเปิดอยู่:** ถ้าธุรกิจต้องยึดเครื่องเดิมซ้ำจริง ต้องถอด `@unique` (migration) และเปลี่ยน
  `reopenRepossessionOnUnsale` ให้เลือกแถวล่าสุดแทน `updateMany` — รอเคสจริง/คำสั่งเจ้าของ.
- **ราคาประเมิน 0** (DTO ยอมรับ `@Min(0)`) → JP5 โพสต์ตามเดิม แต่ **ไม่โพสต์ใบรับเข้าสต็อก SHOP**
  (เครื่องไม่มีมูลค่า ต้นทุน 0 — ไม่มีบรรทัดศูนย์บาท).

**หน้ายึด/ใบรับเครื่องคืน:** `previewCalculation(contractId, { deviceReturnId, discountPct })` คืน `eligibility
{canRepossess, reason}` (สถานะสัญญา + strict mode + ยอดค้าง กติกาเดียวกับ `createInTx`; เกรด/ราคาประเมิน/เหตุผลอ่านจาก
ใบรับเครื่องคืน) → `RepossessionOverlay` โหมดยืนยันโชว์แบนเนอร์ + ปิดปุ่มยืนยัน แทนปล่อยชน 400 · `findAll` คืน
`shopCollectOutstanding` (11-2107 SHOP_COLLECT ต่อสัญญาผ่าน `shopCollectTypedBalance` — แถวยึดก่อน 2026-09-20) → ปุ่ม
"รับโอนหน้าร้าน" โชว์เฉพาะแถวที่ยังมียอด และเติมยอดนั้นให้ · และคืน `deviceReturnOutstanding` (11-2107 DEVICE_RETURN
net ของ POSTED deductions) → ป้าย "รอหักในรอบจ่าย" บนแถว (ล้างผ่านรอบจ่าย INTER-CO/รับเงินสด ไม่ใช่ปุ่มรับโอน).

**~~เลข "บนจอ" กับ "ในสมุด" ต่างกันเท่าส่วนลดยอดปิด~~ — ปิดแล้ว (PR6):** ฝ่ายบัญชีตอบ 30/09/2569 "แบบ (ก) ลงส่วนลดแยกที่
52-1106" ⇒ JP5 ลง `Dr 52-1106` = ส่วนลดตัวเดียวกับบนจอ และขาดทุน 51-1102 ลดเท่ากัน (หัวข้อ "ยึดเครื่อง (JP5) / ตัดหนี้สูญ —
หักเงินของลูกค้าที่ค้าง…" ข้างล่าง) · **ที่ยังเปิดอยู่ (ไม่เกี่ยวกับเงินคืน):** ขาคู่ SHOP ของ **JP4** ปิดยอดหน้าร้านรับแทน
(`Dr <เงินสด SHOP ต่อสาขา> / Cr S21-1104`) ยังไม่ต่อ — รอตัดสินบัญชีเงินสด SHOP ต่อสาขา.

### ใบรับเครื่องคืน (DeviceReturn) — สาขาบันทึก FINANCE ยืนยัน ค่าเครื่องหักในรอบจ่าย (2026-09-20)

Spec: `docs/superpowers/specs/2026-09-20-device-return-intake-design.md` · Plans:
`docs/superpowers/plans/2026-09-20-device-return-phase{1,2,3}-*.md` · โค้ด: `apps/api/src/modules/device-returns/` (ใบ),
`repossessions.service.ts` (`createInTx` / `assertRepossessionPeriodsOpen` — `create()` + `POST /repossessions` ถูกลบ),
`interco-settlement/*` (แถวหักประเภทที่ 3), web `apps/web/src/components/device-returns/*` + `RepossessionOverlay.tsx`
(โหมดยืนยันอย่างเดียว).

**คำตัดสินเจ้าของ (D1–D7, ปิดประเด็น — อย่าเสนอกลับ):** สาขา (OWNER/BM/SALES) บันทึก "ใบรับเครื่องคืน"
`DR-YYYYMMDD-NNNN` (`DeviceReturnNumberService` — advisory lock ต่อวัน BKK แบบ `IntercoBatchNumberService`) พร้อมเกรด/
ราคาประเมิน → **สัญญาหยุดทันทีที่รับคืน** (VOLUNTARY = สัญญา ACTIVE/OVERDUE/DEFAULT flip → `TERMINATED` เก็บ
`previousContractStatus` + audit `CONTRACT_STATUS_LEGAL` reason `DEVICE_RETURN_INTAKE` ใน tx; REPOSSESSION = สัญญา
`TERMINATED` อยู่แล้ว เหตุผลล็อก `AFTER_TERMINATION`; `jp5_require_terminated_status` คงไว้) → ลูกค้าได้ไลน์
`DEVICE_RETURNED` (ไม่มีลายเซ็น ไม่มีราคาในข้อความ; แม่แบบแก้ได้ที่ `/notifications`) → OWNER/FM กด **ยืนยัน** หนึ่งคลิก
= JP5 + ขาคู่ SHOP ใน tx เดียว (`DeviceReturnsService.confirm` → `RepossessionsService.createInTx`, CAS
`PENDING_CONFIRM → CONFIRMED` count 0 → 409) → ค่าเครื่องหักผ่านรอบจ่าย INTER-CO (แนวทาง A — ประเภทหักใหม่ ไม่ใช้แถว
เรียกคืนแทน) · รับได้ทุกสาขา ใบเก็บ `receivingBranchId` และเครื่องย้าย `branchId` ไปสาขาที่รับตอนยืนยัน · ส่งกลับ
(`reject`, OWNER/FM, เหตุผล 10–500) / ยกเลิก (`cancel`, OWNER/BM สาขาตัวเอง) ปิดใบ + ไลน์
`DEVICE_RETURN_CANCELED` โดย **คืนสถานะเฉพาะ VOLUNTARY ที่มี `previousContractStatus` และสัญญายังเป็น
`TERMINATED`** (CAS); REPOSSESSION ไม่คืนสถานะ และถ้าสัญญาเปลี่ยนสถานะไปแล้วจะไม่เขียนทับ. ถ้าคืนสถานะ
สำเร็จและใบข้ามเดือน ผลลัพธ์มี `notice` ให้ตรวจงวดบัญชีก่อน cron 2A accrual ย้อนหลัง — UI ต้องแสดง notice
และไม่กล่าวว่าสัญญาคืนสถานะเสมอ. การตรวจงวดใช้ `validatePeriodOpen` รวม grace policy เดิม ไม่ใช่ปิดเดือนแล้วห้ามเสมอ.

**JE ตอนยืนยัน — ขา Dr ของ JP5 = `11-2107` เสมอ stamp `shopReceivableType: 'DEVICE_RETURN'` (+ `deviceReturnId`,
`shopReceivable: '11-2107'`); ไม่มีโหมด "โอนสดวันยึด" อีกต่อไป:**

```
FINANCE — RepossessionJP5Template (deposit '11-2107', typeStamp DEVICE_RETURN)
  Dr 11-2107 ลูกหนี้-หน้าร้าน [ราคาประเมิน] + ขาล้าง 11-2101/11-2103/11-2105/11-2106/21-2102
  + (PR6) Dr 21-1103 / Dr 21-5101 เงินของลูกค้าที่ค้าง + Dr 52-1106 ส่วนลดยอดปิด (ก่อน plug) + plug 41-1102/51-1102 ตามเดิม
SHOP — ShopCollectShopLegs.postRepossessionIntake (สาขา Cr S11-1202 ถูกลบ)
  Dr S11-2002 สินค้าคงคลัง-มือถือมือสอง [ราคาประเมิน]
     Cr S21-1104 เจ้าหนี้ FINANCE            [ราคาประเมิน]   ← stamp DEVICE_RETURN + contractId + productId + deviceReturnId
```
flow `shop-repossession-intake` เดิม. ราคาประเมิน 0 → JP5 ลง แต่ไม่มีใบรับเข้าสต็อก SHOP และไม่มีแถวหักในรอบจ่าย.
`SHOP_COLLECT_REPOSSESSION` audit ไม่เขียนอีก (แทนด้วย `DEVICE_RETURN_CONFIRMED` + metadata บน JE); audit `REPOSSESSION`
เดิมยังเขียนใน `createInTx` (PR6: + `closeAdvances` — คอลัมน์เงินของลูกค้าก่อนตั้งเป็นศูนย์คู่กับยอดที่ JP5 หักตามบัญชี).

**ตัวเลขทอง (CSV กรณีที่ 5: 17,000/12 งวด, งวด 1–4 accrued และชำระแล้ว, งวด 5–12 ยังไม่ accrued,
ราคาประเมิน 7,000, ยืนยันใบด้วย `{}` ⇒ ส่วนลดยอดปิดค่าเริ่มต้น 50%; fixture จริง `device-returns/__tests__/device-return-flow.integration.spec.ts`,
ส่วนคู่ JE สังเคราะห์/รอบจ่ายอยู่ที่ `interco-settlement/__tests__/interco-device-return.integration.spec.ts` — รายการจำลองรูปก่อน PR6):**
FINANCE (PR6 — ตาราง "แบบ (ก)" ของฝ่ายบัญชี) `Dr 11-2107 7,000.00 · Dr 11-2106 4,000.00 · Dr 21-2102 793.32 ·
Dr 52-1106 1,999.99 · Dr 51-1102 3,126.69 / Cr 11-2101 11,333.36 · Cr 11-2105 793.32 · Cr 21-2101 793.32 · Cr 41-1101 4,000.00`
(Σ 16,920.00 · ก่อน PR6: ไม่มี 52-1106 และ 51-1102 5,126.68) · SHOP `Dr S11-2002 7,000.00 / Cr S21-1104 7,000.00`.

**ประเภท `DEVICE_RETURN` ครบทุกเลนส์** — ประกาศครั้งเดียว `SHOP_RECEIVABLE_TYPES` (`shop-receivable-type.util.ts`) และ
SQL ทุกตัวสร้าง IN-list จาก `Prisma.join`; **ไม่มี `FLOW_MAP` fallback** (แถวยึดเก่า flow เดียวกันที่ไม่มี stamp คือโหมด
โอนทันทีซึ่งไม่แตะ S21-1104 — ถ้าใส่ fallback จะถูกจัดเป็น DEVICE_RETURN โดยไม่มีหนี้จริง): `deviceReturnFinanceBalance` /
`deviceReturnShopBalance` (`interco-typed-balance.ts`, stamp-only) · `getPendingDeviceReturns()` +
`ReconcileTotals.glDeviceReturnTotal` · aging `deviceReturnGross` / `shopMirrorDeviceReturnGross` รวมใน `intercoNet` และ
`shopMirrorGross` (key `metadata.contractId`) + `negativeTypedFields` · `getTypedAccountDrift` ⇒ anti-drift ไม่เพิ่มจาก
baseline หลังยืนยันใบแรก (baseline สะอาด ⇒ 0; `device-returns/__tests__/device-return-flow.integration.spec.ts`).

**แถวหักประเภทที่ 3 ในรอบจ่าย INTER-CO (`InterCoItemType.DEVICE_RETURN`, คอลัมน์ `deviceReturnAmount`) — mirror ของ RECALL
ด้านโครงสร้าง แต่สูตร net แยกตามประเภท:** คิว `GET /interco-settlement/pending` คืน
`{ pending, recalls, deviceReturns, reconcile }`. **คิวและ approval ของ DEVICE_RETURN: net = typed gross −
Σ `deviceReturnAmount` เท่านั้น** ของ item ใน batch POSTED (`DEVICE_RETURN_DEDUCTION_COLUMNS`); ห้ามหัก
`swapCreditAmount`/`recallAmount` ในเลนส์นี้ — เคยหัก swap 8,000 แล้วคืนเครื่อง 7,000 ต้องยังมีค่าเครื่องคืน 7,000.
คิว recall และ combined residual หัก Σ **ทั้งสามคอลัมน์** (`ALL_DEDUCTION_COLUMNS`) ตามสูตรของตน.
Hydrate คิว DEVICE_RETURN **ไม่กรอง**สถานะสัญญา
— เป็น `CLOSED_BAD_DEBT` โดยนิยาม · `CreateBatchDto.deviceReturnContractIds` · guard สองสมุดต่างกัน > 0.01 → reject
`ยอดค่าเครื่องคืนสองสมุดไม่ตรงกัน สัญญา {no}` · clash เฉพาะ `itemType: 'DEVICE_RETURN'` · drift guard เทียบ live net ±0.01 ·
`buildFinanceLines` ข้าม Dr 21-1101/21-1102, `Cr 11-2107 [deviceReturnAmount]` "หักค่าเครื่องคืน {no}" · `buildShopLines`
`Dr S21-1104 [deviceReturnAmount]` "ล้างเจ้าหนี้ FINANCE-ค่าเครื่องคืน {no}" · metadata `items[]` เพิ่ม `type: 'DEVICE_RETURN'`,
`deviceReturn: '<2dp>'` (**ไม่ stamp** top-level `contractId`/`shopReceivableType` — สถาปัตยกรรม "เลนส์ gross + item gate"
เดิม) · `alarmNettingResiduals` รวม 3 ประเภทต่อสมุด − Σ deduction ทุก itemType · reverse = mirror สองใบ แถวกลับเข้าคิวเอง
ผ่าน gate. รอบถัดไปจ่ายสัญญา Y (10,000 + 1,000) เลือกแถว X: FINANCE `Dr 21-1101 10,000 · Dr 21-1102 1,000 / Cr 11-2107
7,000 · Cr 11-1201 4,000`; SHOP `Dr S21-1104 7,000 · Dr S11-1201 4,000 / Cr S11-3001 10,000 · Cr S11-3002 1,000` — หลัง
approve typed gross ยังเป็น 7,000 (ขาหักไม่ stamp) แต่คิว = 0, residual = 0, drift = 0, X หลุดคิว; reverse → X กลับเข้าคิว
ที่ 7,000. ทางรับเงินสดสำรอง: `POST /interco-settlement/device-returns/:contractId/settle-cash` (OWNER/FM —
`settleDeductionCash(contractId, 'DEVICE_RETURN', dto, userId)`; ดูหัวข้อ "เส้นทางรับเงินสดคืน (Task 6)").

**ด่านกันล้างซ้ำสองทาง (`ShopCollectSettlementTemplate.execute`, หลัง requestId idempotency ก่อนคำนวณยอดค้าง):**
`typeStamp !== 'DEVICE_RETURN'` และ (**`deviceReturnFinanceBalance(contractId) > 0` หรือมีประวัติ
JE `POSTED` ที่ไม่ถูก soft-delete, stamp `DEVICE_RETURN` + `contractId`, มีบรรทัด `11-2107` ที่ไม่ถูก soft-delete**)
→ 400 "สัญญานี้มีค่าเครื่องคืนที่ต้องหัก
ผ่านรอบจ่าย INTER-CO — ใช้หน้าจ่ายให้หน้าร้าน รายการค่าเครื่องคืน หรือปุ่มรับเงินสดในหน้านั้น" — ไม่งั้นใบรับโอน (stamp
SHOP_COLLECT) ล้าง 11-2107 โดยเลนส์ DEVICE_RETURN ไม่ลด → รอบจ่ายถัดไปหักซ้ำ. ปุ่ม "รับโอนหน้าร้าน" บน `/repossessions`
ยังโชว์เฉพาะแถวเก่าที่ `shopCollectOutstanding > 0`; แถวใหม่โชว์ป้าย "รอหักในรอบจ่าย" จาก `deviceReturnOutstanding`.

**`SHOP_COLLECT` เหลือต้นทางเดียวคือ JP4** (ปิดยอดหน้าร้านรับแทน) — ต้นทาง JP5 ถูกแทนด้วย `DEVICE_RETURN` ตั้งแต่
2026-09-20; แถวยึดที่ลงไปแล้วด้วย `SHOP_COLLECT` ล้างทางเดิม (forward-only ไม่ย้ายรายการ ไม่ backfill ใบรับคืน).

**หน้าจอ:** `/repossessions` (เมนู "รับเครื่องคืน / ยึดคืน") — ปุ่ม "บันทึกรับเครื่องคืน" (`DeviceReturnIntakeDialog`: ค้นสัญญา
`GET /device-returns/lookup?q=` + `GET /device-returns/preview` ให้ eligibility/kind/ราคาตาราง/±15% — **ไม่มีส่วนบัญชี**) ·
ตาราง "ใบรับเครื่องคืน — รอ FINANCE ยืนยัน" (`DeviceReturnList`: FINANCE ยืนยัน/ส่งกลับ/ส่งซ้ำไลน์, BM ยกเลิกใบสาขาตัวเอง) ·
รายการ "รอยึดเครื่อง" = `GET /device-returns/awaiting-repossession` ปุ่ม "รับเครื่องคืน" · `RepossessionOverlay` = **โหมดยืนยัน
อย่างเดียว** (prop `deviceReturnId` บังคับ; ข้อมูลใบอ่านอย่างเดียว; แก้ได้เฉพาะวันที่ลงบัญชี + ส่วนลดยอดปิด; preview
`GET /repossessions/preview/:contractId?deviceReturnId=&discountPct=`; ยืนยัน = `POST /device-returns/:id/confirm`, ส่งกลับ =
`POST /device-returns/:id/reject`) — ถอด CashAccountSelect/ช่องติ๊กลูกหนี้-หน้าร้าน/ปุ่มรับโอน/`POST /repossessions`; ชิป
"คืนเครื่อง" ในวิซาร์ดรับชำระถูกถอด · `ContractDetailPage` ป้าย "รับเครื่องคืนแล้ว รอ FINANCE ยืนยัน DR-…" + ปุ่ม
"รับเครื่องคืน" · INTER-CO `PendingTab` รายการที่ 3 "ค่าเครื่องคืน" + ปุ่ม "รับเงินสดค่าเครื่อง" (`RecallCashDialog
kind='DEVICE_RETURN'`) + `BatchDetailSheet` badge "ค่าเครื่องคืน" · tag AUTO `RETURNED_DEVICE` "เคยคืนเครื่อง" (ห้ามติด/
ถอดมือ — กฎที่ `evaluateAutoTags`) · journey kind `DEVICE_RETURNED` ป้าย "คืนเครื่อง" (`entries.source.ts` VIEWS).

**ประวัติการชำระ (2026-09-24, เจ้าของ: "ไม่มีประวัติว่าลูกค้าปิดยอด / คืนเครื่อง"):** `PaymentHistorySheet` เรียงจากใบเสร็จ
แต่ JP5 ไม่ออกใบเสร็จ (ใบลดหนี้ออกเฉพาะเมื่อมีงวดค้างที่ accrue แล้ว) ⇒ `GET /payments/contract/:id` ส่ง `contract.closure`
(`PaymentQueryService.resolveClosure`: แถวยึด + ใบรับเครื่องคืน → `DEVICE_RETURN` · ใบเสร็จ `EARLY_PAYOFF` → `EARLY_PAYOFF` ·
สถานะ `COMPLETED`/`CANCELED`) ให้หน้านั้นวาดแถว "ปิดสัญญาแล้ว" เหนือตาราง และ `getContractJournalEntries` รวม flow
`repossession` (JP5) ให้ปุ่มบันทึกบัญชีของแถวนั้น · journey ของลูกค้าเพิ่มชนิด `EARLY_PAYOFF` (เขียนหลัง commit ใน
`ContractPaymentService.earlyPayoff` — `JourneyEntryWriter` เป็น `@Optional()` พารามิเตอร์ท้ายสุด เพราะ spec 10 ไฟล์ `new` service
ด้วยมือ) คู่กับ `DEVICE_RETURNED` ที่มีอยู่แล้ว · งวดที่เหลือหลัง JP5 ยังเป็น `PENDING` ตามเดิม (ไม่ได้แตะ).
**งวด PAID ที่ไม่มีใบเสร็จ** (ยกยอดมา / seed `seed-test-contracts.cli` "data-only, no JE, no receipt") เคยหายจากตารางทั้งที่การ์ด
"งวดที่ชำระแล้ว" นับรวม (เจ้าของ 2026-09-24 "ประวัติชำระอื่นๆ หายไป") ⇒ `paidRowsWithoutReceipt` (`paymentHistoryDerivations.ts`) เติมแถว
`noReceipt` ป้าย "ไม่มีใบเสร็จ / ชำระแล้ว (ยกมา)" ไม่มีปุ่มดาวน์โหลด/ยกเลิก และยอดสะสมนับรวม · ปุ่ม "ประวัติการชำระ" บนหน้าสัญญาเปิดทุกสถานะ
ที่ไม่ใช่ `DRAFT` (เดิม whitelist 5 สถานะตั้งแต่ 2026-07-02 ทำให้สัญญา `CLOSED_BAD_DEBT` เข้าประวัติไม่ได้).

**ที่ยังเปิดอยู่:** ยึดเครื่องเดิมซ้ำ (`Repossession.productId @unique`) · ~~ส่วนลดยอดปิดของ JP5 ลงบัญชีหรือไม่~~ (ตอบแล้ว
30/09/2569 "แบบ (ก)" — PR6). ร่างบันทึกอธิบายวิธีใหม่ (Task 16 จะจัดทำ,
ยังไม่ได้ส่ง): `docs/accounting/cpa-followup-2026-09-20-device-return.txt` · ไลน์เป็นข้อความธรรมดา (Flex ทีหลังผ่านแม่แบบเดียวกัน) ·
MDM ปลดอัตโนมัติตอนรับคืน · ขาคู่ SHOP ของ JP4 ปิดยอดหน้าร้านรับแทน (ยังไม่ต่อ — ข้างบน).

## ยึดเครื่อง (JP5) / ตัดหนี้สูญ — หักเงินของลูกค้าที่ค้างทุกประเภท + ส่วนลดยอดปิด 52-1106 (PR6)

คำตอบฝ่ายบัญชี: **เล่ม 1 ข้อ 6 (29/09/2569) ทางเลือก (1) "หักทุกประเภท ทั้งสองกรณี"** — นำเงินรับล่วงหน้าที่ค้างทุกประเภท
(21-1103 ทั้งถังพักค่าปรับดิว `rescheduleAdvanceBalance` และถังรวม `advanceBalance`) และเงินเกินของลูกค้า (21-5101 —
`creditBalance`) มาหักลูกหนี้ก่อนคำนวณหนี้สูญ / ผลจากการยึดเครื่อง ทั้งตัดหนี้สูญและยึดคืน · **ฉบับรวม ข้อ 5 (30/09/2569)
"แบบ (ก) ลงส่วนลดแยกที่ 52-1106"** — JP5 ลงส่วนลดยอดปิดที่หน้าจอแสดงเป็นบรรทัดของตัวเอง และลดขาดทุน 51-1102 เท่ากัน.

| เรื่อง | กติกา |
|---|---|
| ยอดที่หัก | **ยอดในสมุดบัญชี**ของสัญญา (`glContractBalance` ด้าน Cr − Dr) ของ 21-1103 และ 21-5101 — `readContractCloseAdvances` (`journal/contract-close-advances.ts`) ตัวเดียวใช้ร่วมกันทั้งสองรายการ · ยอดติดลบ = ไม่มีให้หัก |
| JP5 | บรรทัดเงินพักปรับดิวเดิม (`parkRelief` = ส่วนที่ยอดปิดดูดซับ) + `Dr 21-1103` = ยอด 21-1103 ในบัญชี − parkRelief (ถังรวม + ส่วนของถังพักที่ยอดปิดไม่ได้ดูดซับ) + `Dr 21-5101` = ยอด 21-5101 ในบัญชี + `Dr 52-1106` = `computePayoffQuote().discountAmount` ตัวเดียวกับบนจอ (ผู้เรียกส่ง `discount` ทั้ง `previewCalculation` และ `createInTx` ⇒ preview === posted) — ทุกบรรทัดวางก่อน plug · ฐานส่วนลด = กำไรของงวดค้าง**ทั้งหมด** (ตัวเลขเดียวกับตัวอย่างข้อ 5 ที่ฝ่ายบัญชีเลือกแบบ (ก)) ⇒ มีงวดที่ตั้งลูกหนี้แล้วค้างอยู่ ส่วนลดรวมดอกเบี้ยที่ 2A รับรู้ไปแล้วด้วย (4 งวดตั้งแล้ว + 4 งวดยังไม่ถึง: ส่วนลด 1,999.99 · ดอกเบี้ยของงวดที่ยังไม่ถึงกำหนด 2,000.00 · ส่วนลด 50% ตามฐาน 5.2 = 1,000.00 — ต่างเฉพาะการจัดประเภท) · **ตั้งแต่ PR5 ฐานเดียวกับ 52-1106 ของ JP4** (ส่วนลดที่ให้จริง — คำตอบข้อ 5.3 · JP4 บันทึกส่วนที่เกินฐาน 5.2 ไว้ใน `discountBeyondDeferredBase` · ความขัดกับ 5.2 รอฝ่ายบัญชี · หัวข้อถัดไป) |
| ตัดหนี้สูญ | `Dr 21-1103` (ทุกถัง) + `Dr 21-5101` ก่อน plug · **ปฏิเสธเมื่อ loss ติดลบ** คือเมื่อเงินของลูกค้า (21-1103 + 21-5101 ตามบัญชี) **มากกว่า**ลูกหนี้คงเหลือตามบัญชี (รวม VAT — 11-2101 + 11-2103 + 11-2105) **หักภาษีในใบลดหนี้ ม.82/5** ของงวดที่ตั้งลูกหนี้แล้วแต่ยังไม่จ่าย — เกิดได้**แม้เงินของลูกค้าน้อยกว่าหนี้** เพราะใบลดหนี้ไม่ลดตามเงินที่หัก (ข้อจำกัดที่รู้ในแถว "ภาษีขาย / ใบลดหนี้ ม.82/5" ข้างล่าง) · ตัวอย่าง: ค้างงวดที่ตั้งลูกหนี้แล้ว 1 งวด 1,515.83 (ภาษีในใบลดหนี้ 99.17) → เพดาน 1,515.83 − 99.17 = 1,416.66: เงินของลูกค้า 1,450.00 (น้อยกว่าหนี้) → loss −33.34 ⇒ ปฏิเสธ · พอดี 1,416.66 → ลงได้ หนี้สูญ 0 และใบลดหนี้ยังกลับภาษี 99.17 เต็มจำนวน (ปักด้วย jest `bad-debt-writeoff.close-advances.spec.ts`) · ไม่มีงวดที่ตั้งลูกหนี้แล้วค้าง ⇒ เพดาน = ลูกหนี้รวม VAT พอดี · ปฏิเสธ = `throw new Error` เดิมของ template (`negative loss plug`) ทั้งธุรกรรม rollback: ไม่มี JE / ใบลดหนี้ / เปลี่ยนสถานะ · **ผู้เรียกเห็น HTTP 500** ข้อความกลาง "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง" (`SentryExceptionFilter` บน production) + Sentry ระดับ **error** — ข้อความของ template ("GL state ผิดปกติ ต้องตรวจก่อน") อยู่ใน log / Sentry เท่านั้นและชี้สาเหตุผิด (สาเหตุจริง = เงินของลูกค้าเกินเพดานข้างบน — บัญชีไม่ได้ผิดปกติ) · **ห้ามลองใหม่** (ผลเดิมทุกครั้ง) → ได้เครื่องคืน = ยึดเครื่อง (JP5 — ส่วนเกินเป็นกำไร 41-1102) · ไม่ได้เครื่อง = พักสัญญาไว้จนฝ่ายบัญชีตัดสินวิธีลง (ไม่มีบัญชีกำไรแบบ JP5 และไม่มีทางคืนเงิน / เครดิตในระบบ) |
| คำอธิบายบรรทัด | บรรทัดใหม่ไม่มีคำอธิบาย — การ์ดรายการ JP5 / สมุดรายวันแสดงชื่อบัญชีจากผังบัญชี (ไม่มีข้อความใหม่บนจอ) · บรรทัดเงินพักปรับดิวคงคำอธิบายเดิม |
| ค่าเผื่อหนี้สงสัยจะสูญ | ใช้หักกับขาดทุน 51-1102 ที่เหลือ**หลัง**หักเงินของลูกค้าและส่วนลดเท่านั้น — ส่วนที่เหลือคืนเป็น 51-1103 ตามเดิม · **ส่วนลด 52-1106 และลำดับส่วนลดกับค่าเผื่อ:** กำไรขาดทุนรวมเท่ากับรายการที่ไม่แยกบรรทัดส่วนลด ต่างเฉพาะการจัดประเภท — 51-1102 ลดเท่าส่วนลดพอดีเมื่อขาดทุนที่เหลือหลังหักส่วนลดยังไม่น้อยกว่าค่าเผื่อ · ค่าเผื่อมากกว่าขาดทุนที่เหลือ หรือส่วนลดทำให้เป็นกำไร ⇒ 51-1102 ลดน้อยกว่าส่วนลด ส่วนต่างไปเพิ่มการคืนค่าเผื่อ 51-1103 หรือกำไร 41-1102 (ค่าเผื่อ 4,000 ส่วนลด 1,999.99: 51-1102 จาก 1,126.68 เหลือ 0 คืน 873.31) · **เงินของลูกค้าที่หัก ไม่ใช่แค่การจัดประเภท:** เทียบก่อน PR6 กำไรขาดทุนรวมสูงขึ้นเท่ายอดที่เพิ่งหัก (ออกเป็น 51-1102 ที่ลดลง การคืนค่าเผื่อ 51-1103 ที่เพิ่มขึ้น หรือกำไร 41-1102 ของ JP5) — ก่อน PR6 ยอดนี้ค้างเป็นหนี้สิน 21-1103 / 21-5101 ของสัญญาหลังปิด (JP5 เดิมหักเฉพาะถังพักส่วนที่ยอดปิดดูดซับ) |
| ภาษีขาย / ใบลดหนี้ ม.82/5 | ขาภาษีขายไม่เปลี่ยน (ตารางแบบ (ก) — 21-2101 เต็มจำนวน) · ใบลดหนี้ (`computeCnBreakdown`) คิดจากยอดค้างของงวดที่ตั้งลูกหนี้แล้วตามเดิม **ไม่ลดตามเงินของลูกค้าที่หัก** — ถูกต้องสำหรับถังพัก (ออกแบบให้หักงวดสุดท้ายซึ่งยังไม่ตั้งลูกหนี้) · **ข้อจำกัดที่รู้:** เงินรับล่วงหน้าถังรวม / เครดิต 21-5101 ที่ค้างคู่กับงวดที่ตั้งลูกหนี้แล้วแต่ยังไม่จ่าย (ไม่บ่อย — รอบกลางคืน 2A ปกติหักถังรวมเข้างวดแล้ว) — ตามหลัก pro-rate ของ CPA 26/07/2569 ส่วนที่ถือว่าได้รับเงินแล้วควรลดภาษีในใบลดหนี้ แต่ PR6 ไม่ลด (แจ้งฝ่ายบัญชีเพื่อทราบ) |
| คอลัมน์ของสัญญา | `advanceBalance` / `rescheduleAdvanceBalance` / `creditBalance` = 0 ในธุรกรรมเดียวกับรายการ (`CONTRACT_ADVANCE_COLUMNS_CLEARED` — `RepossessionsService.createInTx` · `BadDebtService.writeOffBadDebt`) · audit `RESCHEDULE_ADVANCE_CONSUMED` ของ JP5 คงรูปเดิม แต่ `afterParkBalance` = 0 เสมอ |
| คอลัมน์ไม่ตรงบัญชี | Σ คอลัมน์ ≠ ยอดในบัญชี ⇒ Sentry ระดับ warning `action: 'close-advance-ledger-mismatch'` (`flow`: `repossession` / `write-off` · extra มียอดทั้งสองฝั่ง) **หลัง commit เท่านั้น** (`DeferredWarning` — `DeviceReturnsService.confirm` / `writeOffBadDebt`) · เคสที่รู้: เครดิตจากเปลี่ยนเครื่องเสีย (`creditBalance` ไม่มี 21-5101 หนุน) — หักตามบัญชี (0) แล้วเตือน · **หลักฐานถาวร:** JP5 เขียน `closeAdvances` ใน audit `REPOSSESSION` ทุกครั้ง (`advanceBalanceBefore` / `rescheduleAdvanceBalanceBefore` / `creditBalanceBefore` = คอลัมน์ของแถวสัญญาที่ล็อกแล้ว — แถวที่ update สถานะ `CLOSED_BAD_DEBT` คืนมา ชุดเดียวกับที่ JP5 เทียบกับบัญชีและ `beforeParkBalance` ของ audit ถังพัก · `ledger21_1103Cleared` / `ledger21_5101Cleared` = ยอดที่หักตามบัญชี) · ตัดหนี้สูญ: ยอดที่หักอยู่ใน JE metadata แต่คอลัมน์ก่อนตั้งเป็นศูนย์**ยังไม่มีหลักฐานถาวร** — `BadDebtWriteOffAuditLog` ไม่มีช่อง JSON (งานต่อ: migration เพิ่มคอลัมน์ หรือเขียนแถว `AuditLog`) |
| metadata | JP5: `advanceRelief` / `creditRelief` / `discount` (stamp เมื่อ > 0 — `parkRelief` เดิมคงอยู่) · ตัดหนี้สูญ: `advanceRelief` (21-1103 ทุกถัง) / `creditRelief` |
| ตัวอย่างของฝ่ายบัญชี | ข้อ 5: 12 × 1,515.83 จ่าย 4 งวด ราคาประเมิน 7,000 ส่วนลด 50% → Dr 11-2107 7,000.00 · 11-2106 4,000.00 · 21-2102 793.32 · **52-1106 1,999.99** · **51-1102 3,126.69** / Cr 11-2101 11,333.36 · 11-2105 793.32 · 21-2101 793.32 · 41-1101 4,000.00 (16,920.00) — บนจอขาดทุน 3,126.65 (ต่าง 0.04 = เศษงวดสุดท้าย) · ข้อ 6: ลูกหนี้ 6 งวดรวม VAT 36,472.02 หักเงินรับล่วงหน้า 1,419.00 → หนี้สูญ 35,053.02 (ปักด้วย jest `repossession-jp5.close-advances.spec.ts` · `repossession-discount-line.spec.ts` · `bad-debt-writeoff.close-advances.spec.ts`) |

**ไม่เปลี่ยนใน PR6:** สูตรยอดปิดบนจอ `computePayoffQuote` (ใช้ร่วมกับปิดยอดก่อนกำหนด — **ยังไม่หักเงินรับล่วงหน้าถังรวม**
`advanceBalance` · PR5 ก็ไม่แก้ — เจ้าของเคาะ 01/10/2569 ให้หักแบบเงินพักค่าปรับดิว ทำใน PR5ข) · JP4 (PR5 — หัวข้อถัดไป) · เงินที่เข้ามาหลังสัญญาปิด (คำถามฉบับรวม
ข้อ 6 ยังเปิด) · ฐานค่าเผื่อหนี้สงสัยจะสูญ (ECL) · ด่านอนุมัติตัดหนี้สูญตามยอด (`assertWriteOffTierPermitted` ยังใช้ยอดค้างตามงวด
ก่อนหักเงินของลูกค้า) · forward-only — สัญญาที่ยึด/ตัดหนี้สูญไปแล้วไม่ถูกแก้ย้อนหลัง

**"ส่วนต่างราคาประเมินเทียบยอดปิด" บนจอ ≠ "กำไร/ขาดทุนจากรายการยึดคืน" (41-1102 − 51-1102) เป็นเรื่องปกติ — ไม่ใช่บั๊ก ห้าม "แก้" ให้เท่ากัน.**
เหตุที่ทำให้ต่าง (ไม่ใช่รายการครบถ้วน): (1) เศษสตางค์ของงวดสุดท้าย (ตัวอย่างข้อ 5: 0.04) · (2) ค่าปรับค้าง — จอบวกเข้ายอดปิด บัญชีรับรู้ค่าปรับ
เมื่อรับเงิน · (3) เงินรับล่วงหน้าถังรวม — บัญชีหัก จอไม่หัก (เจ้าของเคาะให้สูตรยอดปิดหัก — PR5ข) · (4) **ค่าเผื่อหนี้สงสัยจะสูญที่ใช้** — 51-1102 เป็นยอดหลังใช้ 11-2102
(งวดค้างของสัญญา TERMINATED ตั้งค่าเผื่อ 75–100%) ส่วนจอไม่เกี่ยวกับค่าเผื่อ · (5) **ภาษีขายของงวดที่ตั้งลูกหนี้แล้วแต่ยังไม่จ่าย** — บัญชีได้คืนผ่าน
ใบลดหนี้ ม.82/5 (`Dr 21-2101`) ส่วนยอดปิดบนจอรวม VAT · (6) ส่วนเกินของถังพักที่ยอดปิดดูดซับไม่หมด — บัญชีหักทั้งหมด จอหักเท่าที่ดูดซับ ·
(7) คอลัมน์ไม่ตรงบัญชี (เช่น เครดิตจากเปลี่ยนเครื่องเสีย) — บัญชีหักตามบัญชี จอใช้คอลัมน์. ตัวอย่าง (คำนวณมือ): สัญญาตัวอย่างข้อ 5
แต่งวด 5–8 ตั้งลูกหนี้แล้วยังไม่จ่าย + ค่าเผื่อ 75% ของงวดเหล่านั้น (4,547.49) → ขาดทุนก่อนค่าเผื่อ ≈ 12,126.68 − 396.68 (ใบลดหนี้) − 7,000.00
− 1,999.99 = 2,730.01 → ค่าเผื่อครอบทั้งหมด ⇒ 51-1102 = **0.00** ขณะที่จอยังแสดงส่วนต่าง **−3,126.65**

## ปิดยอดก่อนกำหนด (JP4) — ล้างตามยอดในบัญชี · เงินสด = เงินที่รับ · 52-1106 = ส่วนลดที่ให้จริง (PR5)

คำตอบฝ่ายบัญชี **เล่ม 1 ข้อ 5 (29/09/2569): 5.1 ถูกต้อง · 5.2 ถูกต้อง · 5.3 ตามข้อเสนอ · 5.4 ถูกต้อง**. โค้ด `journal/compute-early-payoff-je.ts`:
`readEarlyPayoffLedger` (ยอดในบัญชี 5 บัญชีของสัญญา) · `buildEarlyPayoffJE` (ฟังก์ชันบริสุทธิ์) · `buildEarlyPayoffJournal` (อ่านยอด + เงินของ
ลูกค้า + สร้างรายการ — ตัวเดียวที่ `getEarlyPayoffQuote` (preview / คำขออนุมัติ) และ `earlyPayoff` (ลงจริง) ใช้ ⇒ preview === posted).

| เรื่อง | กติกา |
|---|---|
| ขาล้าง (5.1) | Cr 11-2103 / 11-2101 / 11-2105 = ยอดในบัญชีของสัญญา (`glContractBalance` ด้าน Dr — ยอดติดลบ เช่น รับเงินงวดในวันครบกำหนดก่อนรอบกลางคืนตั้งลูกหนี้งวด ลงฝั่ง Dr) · Dr 11-2106 / Cr 41-1101 และ Dr 21-2102 / Cr 21-2101 = ยอด 11-2106 / 21-2102 ในบัญชี (ส่วนที่ยังไม่ถึงกำหนด — งวดที่ตั้งลูกหนี้แล้วไม่ถูกรับรู้ซ้ำ) · ไม่มีบรรทัดยอดศูนย์ · ไม่นับ "งวดที่ยังไม่ PAID × ยอดต่องวด" อีก (`computeEarlyPayoffJE` เดิม — ลบแล้ว · `accruedUnpaid` ของ PR2ข ไม่จำเป็นอีก) |
| เงินสด (5.3) | Dr บัญชีรับเงิน = `quote.totalPayoff` = เงินที่ลูกค้าจ่าย (ก้อนเดียวกับที่กระจายเข้าแถว Payment และพิมพ์บนใบเสร็จ) · หน้าร้านรับแทน = Dr 11-2107 ยอดเดียวกัน (audit `SHOP_COLLECT_PAYOFF` เก็บ `cashReceived`) · ทางสลิปตรง: สลิปต่างยอดปิดได้ ±0.01 — รายการใช้ยอดปิด |
| 52-1106 (5.3) | ส่วนที่เหลือให้สมดุล = ลูกหนี้ตามบัญชี (11-2101 + 11-2103 + 11-2105) + ค่าปรับ NETTED − เงินที่รับ − เงินพักค่าปรับดิว − เงินเกินของลูกค้า · ไม่มีสูตรส่วนลดที่สอง · ปกติต่างจากส่วนลดของสูตรยอดปิด (`quote.discountAmount` — metadata `quoteDiscountAmount`) แค่เศษงวดสุดท้าย (17,000/12: +0.04) · ต่างเกิน 1.00 = ยอดในบัญชีไม่ตรงยอดค้างตามงวด หรือเงินของลูกค้าที่ยอดปิดหักแต่ไม่มีในบัญชี → สัญญาณเตือน (แถวสัญญาณเตือน) |
| 5.2 | หลักการ: ส่วนลดเกี่ยวกับดอกเบี้ยของงวดที่ยังไม่ถึงกำหนด · สูตรยอดปิดคิดส่วนลดจากกำไรของงวดค้าง**ทั้งหมด** ⇒ **ทุกการปิดยอดที่ยังมี 11-2103 ค้าง** 52-1106 รวมส่วนลดของดอกเบี้ยที่ 2A รับรู้ไปแล้ว — ลงทั้งก้อนที่ 52-1106 ตาม 5.3 และ stamp `discountBeyondDeferredBase` = 52-1106 − % ส่วนลด × ดอกเบี้ยรอตัดบัญชีคงเหลือ (เมื่อเกิน 1.00) · ตัวอย่าง (17,000/12 ส่วนลด 50%): ตั้งแล้วค้าง 4 (งวด 1 จ่าย 500) + ยังไม่ถึง 8 → 52-1106 2,766.37 เทียบฐาน 2,000.00 (เกิน 766.37) · 4 + 4 → 2,000.03 เทียบ 1,000.00 (เกิน 1,000.03) · 9 + 3 → 3,000.02 เทียบ 750.00 (เกิน 2,250.02) · รอคำตอบฝ่ายบัญชีว่าจะคงทั้งก้อนหรือแยกส่วนนี้ไปบัญชีอื่น |
| เศษ / เงินเกินหนี้ | ส่วนที่เหลือติดลบไม่เกิน 1.00 (ลูกค้าจ่ายเกินลูกหนี้ตามบัญชีด้วยเศษค่างวด — เช่นส่วนลด 0%) → Cr 53-1503 (`roundingGain`) · ติดลบเกิน 1.00 → **ปฏิเสธทั้งธุรกรรม** (`Error` ใน `earlyPayoff` — HTTP 500 ข้อความกลาง + Sentry error · preview ไม่ throw แต่แสดง UNBALANCED) — เกิดเมื่อเงินของลูกค้าที่ยอดปิดหักให้มากกว่าหนี้ (เครดิตมากกว่ายอดค้าง → ยอดปิดชน 0) หรือบัญชีของสัญญาผิดปกติ (เช่นไม่มีรายการเปิดสัญญา) · ทางแก้ = ใช้เครดิตชำระงวดแทนการปิดยอด (คอลัมน์และบัญชีมีเครดิตอยู่) / ให้ฝ่ายบัญชีตรวจ |
| เงินของลูกค้า (5.4) | หักเท่าที่**ยอดปิดหักให้และมีอยู่จริงในบัญชี** (`readContractCloseAdvances` ของ PR6): Dr 21-1103 = min(`quote.rescheduleAdvanceApplied`, คอลัมน์ถังพัก, ยอด 21-1103 ในบัญชี) (คำอธิบายเดิม) · Dr 21-5101 = min(คอลัมน์ `creditBalance` ที่ยอดปิดหักให้, ยอด 21-5101 ในบัญชี) (X2 — เดิมคอลัมน์ตั้ง 0 โดยไม่มีรายการ) · ยอดในบัญชีที่เกินคอลัมน์ยังเป็นเงินของลูกค้า ค้างในบัญชีนั้น + สัญญาณเตือน · **เงินรับล่วงหน้าถังรวม (`advanceBalance`) ไม่ถูกหัก** — สูตรยอดปิดไม่หักยอดนี้ให้ลูกค้า ถ้าหักในบัญชีบริษัทจะเก็บเงินของลูกค้าไว้ (52-1106 ลดลง) ⇒ ค้างใน 21-1103 + คอลัมน์ตามเดิม · **เจ้าของเคาะ 01/10/2569: หักถังรวมแบบเงินพักค่าปรับดิว (หักก่อนคิดส่วนลด · ลดต้นทุนตามสัดส่วน) — ทำใน PR5ข** (แก้ `computePayoffQuote` ทั้งหน้าปิดยอดและหน้ายึดคืน + JP4 ลง Dr 21-1103 ทั้งยอดในบัญชี + `CONTRACT_ADVANCE_COLUMNS_CLEARED`) · ส่วนเกินของถังพักที่ยอดปิดดูดซับไม่หมด (ถังพัก ≥ ยอดค้าง) ค้างเช่นกัน |
| คอลัมน์ | `creditBalance` = 0 (เดิม — ตอนนี้มี Dr 21-5101 หนุนเท่าที่บัญชีมี) · `rescheduleAdvanceBalance` −= เงินพักที่หัก + audit `RESCHEDULE_ADVANCE_CONSUMED` (เดิม) · `advanceBalance` ไม่แตะ |
| สัญญาณเตือน | Sentry ระดับ warning **หลัง commit เท่านั้น** (`earlyPayoff` เก็บไว้แล้วส่งหลัง `$transaction` · preview ไม่ส่ง): (1) คอลัมน์ไม่ตรงยอดในบัญชี → `close-advance-ledger-mismatch` `flow: 'early-payoff'` (2) 52-1106 ต่างจาก `quote.discountAmount` เกิน 1.00 → `early-payoff-discount-vs-quote` `flow: 'early-payoff'` (extra: `discount` · `quoteDiscountAmount` · `difference` · ยอดประกอบ) — เช่นแถวงวดถูกตั้ง PAID โดยไม่มีรายการรับชำระ (ลูกหนี้ของงวดนั้นยังอยู่ในบัญชี) · รายการเปิดสัญญาซ้ำ · เครดิต/เงินพักในคอลัมน์ที่ไม่มีในบัญชี |
| metadata | `discount` (52-1106) · `cashReceived` · `receivableCleared` · `quoteDiscountAmount` · `lateFees` · `parkRelief` / `creditRelief` / `roundingGain` (เมื่อ > 0) · `discountBeyondDeferredBase` (เมื่อ > 1.00) |
| คำอธิบายบรรทัด | บรรทัดที่ PR5 เพิ่ม (11-2103 · 21-5101 · 53-1503) ไม่มีคำอธิบาย — การ์ดรายการบนหน้าปิดยอด / สมุดรายวันแสดงชื่อบัญชีจากผังบัญชี (ไม่มีข้อความใหม่บนจอ) |
| template | `EarlyPayoffJP4Template` (ไม่มีผู้เรียกใน production) รับ `cashReceived` จากผู้เรียก · ใช้ `buildEarlyPayoffJE` ตัวเดียวกัน · อ่านยอดในบัญชีในธุรกรรมของการลงรายการ · เงินพัก clamp ด้วยคอลัมน์และยอด 21-1103 ในบัญชี · ไม่แตะ 21-5101 / ถังรวม |
| ใบเสร็จ | ใบ `EARLY_PAYOFF` **ไม่เปลี่ยน** (ไม่ผูกรายการ JP4 · ถอด ×7/107 จากเงินที่รับทั้งก้อน) — รูปแบบใบรอคำตอบฝ่ายบัญชี (ฉบับรวม ข้อ 16 ยังไม่ได้ส่ง) ⇒ ภาษีบนใบ ≠ 21-2101 ที่ลง: ลูกค้าจ่าย 15,189.98 → ใบพิมพ์ภาษี 993.74 · บัญชีลง 1,190.00 (ต่าง 196.26 = ภาษีของส่วนลดที่ Policy A ไม่ลด) |
| คำขออนุมัติ | `earlyPayoff` เทียบ**เฉพาะตัวเงินของ quote** กับ `reviewSummary` (ทุกฟิลด์ยกเว้น `journalPreview` — `earlyPayoffApprovalMoney`) · รายการบัญชีใน preview อ่านยอดในบัญชี จึงเปลี่ยนได้เมื่อ 2A ลงระหว่างส่งคำขอกับอนุมัติทั้งที่ยอดเงินเท่าเดิม ⇒ ไม่ต้องส่งใหม่ · **รายการที่ลง = ยอดในบัญชีตอนทำรายการ** (อาจต่างจากบรรทัดที่เห็นตอนส่งคำขอ — ตัวเงินเท่าเดิม) · snapshot ของคำขอ (`paymentApprovalSnapshot` — มีวันที่ของ quote) เก็บและเทียบเหมือนเดิม ⇒ คำขอข้ามวันยังได้ 409 "ยอดหรือข้อมูลรายการเปลี่ยนแล้ว…" ตามเดิม · คำขอที่ค้างก่อน deploy ได้ 409 "ยอดปิดสัญญาเปลี่ยนแล้ว กรุณาส่งขออนุมัติใหม่" (quote เดิมมี `accruedUnpaid`) — ส่งใหม่ได้ทันที |
| ไม่แก้ใน PR5 | เงินรับล่วงหน้าถังรวม (PR5ข) · ลูกค้าปิดยอดเองผ่าน QR (`paysolutions-webhook.service.ts` — กระจายเงินทีละงวดแล้วตั้ง `creditBalance: 0` โดยไม่มี Dr 21-5101 ⇒ X2 ยังเกิดทางนี้) · ใบเสร็จปิดยอด (ข้อ 16) · การกลับรายการ VAT 60 วันในเส้นทางจริง (`earlyPayoff` ไม่เรียก `Vat60dayReversalTemplate` — มีเฉพาะใน template) · เงินของลูกค้าที่ค้างหลังปิดยอด (ถังรวม · ส่วนเกินของถังพัก) ยังไม่มีสัญญาณเตือน |

ตัวอย่าง (สัญญา 17,000/12 งวดละ 1,515.83 ส่วนลด 50% — ปักด้วย jest `compute-early-payoff-je.spec.ts`):
- ยังไม่จ่ายเลย ลูกค้าจ่าย 15,189.98 → Dr เงินสด 15,189.98 · 11-2106 6,000.00 · 21-2102 1,190.00 · **52-1106 3,000.02** / Cr 11-2101 17,000.00 ·
  11-2105 1,190.00 · 41-1101 6,000.00 · 21-2101 1,190.00 (รวม 25,380.00) — ก่อน PR5: เงินสด 15,189.96 · 52-1106 3,000.00 · ล้าง 16,999.92 / ภาษี 1,190.04
- มีเงินพักค่าปรับดิว 1,044.00 ลูกค้าจ่าย 14,318.16 → Dr เงินสด 14,318.16 · Dr 21-1103 1,044.00 · **52-1106 2,827.84** (ขาอื่นเท่าข้างบน) —
  ก่อน PR5 เงินสด 14,145.96 ต่ำกว่าเงินที่รับ 172.20
- 6 งวดค้าง งวดแรกรับบางส่วน 1,000 ก่อนครบกำหนด ลูกค้าจ่าย 7,062.28 → เงินสด 7,062.28 · **52-1106 1,032.74** · ล้าง 11-2101 7,565.46 ·
  11-2105 529.56 ตามบัญชี — ก่อน PR5 (PR2ข) เงินสด 6,759.90 ต่ำกว่าเงินที่รับ 302.38

**Forward-only:** รายการ JP4 ที่ลงก่อน deploy ไม่ถูกแก้ (prod ไม่มีสัญญาที่ผ่อนอยู่ ณ 30/09/2569).

---

## Rounding Modes (CRITICAL — match CPA CSV golden values)

Wrong rounding = test failures. Use these modes exactly:

| Calculation | Mode | Example |
|-------------|------|---------|
| `grossExclVat / totalMonths` | `ROUND_DOWN` | 17000/12 = **1416.66** (NOT 1416.67) |
| `vatTotal / totalMonths` | `ROUND_HALF_UP` | 1190/12 = **99.17** |
| per-installment total | sum of above | 1416.66 + 99.17 = **1515.83** (NOT 1515.84) |

---

## Cash Account Dimension

Payment.depositAccountCode accepts one of 6 codes:
- 11-1101, 11-1102, 11-1103 (per-person cash)
- 11-1201, 11-1202, 11-1203 (bank accounts)

Pre-filled from `User.defaultCashAccountCode`. Validated via regex on input.
Cash account dimension is required on every Payment record.

---

## Tolerance Policy (<=1 THB)

Small discrepancies on payment receipt (overpay / underpay <=1 THB):

| Direction | Journal | Approval |
|-----------|---------|----------|
| Overpay | Cr 53-1503 (auto, no approval required) | None |
| Underpay | Dr 52-1104 | Requires `toleranceApproverId` — OWNER / ACCOUNTANT / BRANCH_MANAGER |

AuditLog: `action = TOLERANCE_APPROVED`, `entity = payment`.
UI: tolerance approval modal in `PaymentForm` — opens when delta <=1 THB on underpay.

---

## VAT 60-Day Rule

- Cron runs daily at 02:00 Asia/Bangkok
- Finds installments overdue 60+ days with no PAID payment in the period
- Posts `Vat60dayMandatoryTemplate` JE (Dr 11-2104 / Cr 21-2103)
- When overdue payment is subsequently received: `PaymentReceipt2BTemplate` auto-triggers `Vat60dayReversalTemplate`

---

## ภ.พ.30 — ภาษีขายคำนวณที่เดียว (2026-09-30)

Plan: `docs/superpowers/plans/2026-09-30-pp30-output-vat-single-source.md` · โค้ด: `apps/api/src/modules/tax/pp30-output-vat.ts`
(`computePp30OutputVat` · `summarizePp30OutputVat` · `classifyOutputVatReduction` · `pp30MonthRange` · `resolvePp30CompanyId` ·
`toPp30OutputVatJson` · `PP30_INCLUDES_MANDATORY_60DAY`) · Integration: `apps/api/src/modules/accounting/pp30-output-vat.integration.spec.ts` (CI `ACCT_FILES`)

**ผู้ใช้ตัวเลขภาษีขายของ ภ.พ.30 ทุกตัวเรียกตัวคำนวณเดียว — ห้ามเขียน query ภาษีขายชุดที่สอง:**
`TaxPreviewService.previewPP30` (→ `GET /tax/pp30-preview` · `GET /tax/export-xlsx?form=PP30` · `POST /tax/generate` ·
snapshot ปิดงวด `MonthlyCloseService.generateReportSnapshots` → `reportSnapshot.vatSummary`) และ
`FinanceTaxService.getVatMonthly` (หน้า `/finance/vat` เมนู "VAT (ภ.พ.30)")

| เรื่อง | กติกา |
|---|---|
| ยอด | ภาษีขาย = Σ(เครดิต − เดบิต) ของ `21-2101` · `Prisma.Decimal` เท่านั้น · ยอดติดลบได้ (เดือนที่มีแต่รายการกลับรายการ) — แสดงตามจริง ไม่ปัดเป็นศูนย์ |
| ภาษีขาย 60 วัน (`21-2103`) | **ไม่รวมในยอด จนกว่าฝ่ายบัญชีจะตอบ** — `PP30_INCLUDES_MANDATORY_60DAY = false` (คำตัดสินผู้คุมงาน 2026-09-30 · **กลับคำตัดสิน "Critical #2"** เดิมใน `previewPP30` ที่รวม 21-2103): 2A ตั้งภาษีขายของทุกงวดเข้า 21-2101 ณ วันครบกำหนดแล้ว แต่รอบภาษีขาย 60 วัน (`vat-60day.cron.ts`) ตั้ง 21-2103 ซ้ำโดยไม่ดู `accrualJournalEntryId` และสถานะสัญญา · แสดงแยกเป็นข้อมูลประกอบ ตั้ง / กลับ / สุทธิ ทุกช่องทาง (หน้า `/finance/vat` · ไฟล์ Excel สามแถวหมวด "ข้อมูลประกอบ" · `outputVatBreakdown.mandatory60Day*` + `mandatory60DayIncluded: false` ใน preview · `TaxReport.generatedData` · snapshot ปิดงวด) · เปลี่ยนค่าต้องแก้ข้อความ "ยังไม่รวม" บนหน้าและในไฟล์ Excel พร้อมกัน (เทส `PP30_INCLUDES_MANDATORY_60DAY` ปักไว้) |
| รายการที่นับ | `status: POSTED` · รายการและบรรทัดไม่ถูกลบ · `companyId` ที่ผู้เรียกส่ง (ว่าง = 400 "กรุณาระบุบริษัท" — เดิม `GET /tax/pp30-preview` ที่ไม่ส่งบริษัทได้ยอดรวมทุกบริษัท) — หน้า `/finance/vat` ไม่ส่ง ⇒ บริษัท `FINANCE` (บริษัทเดียวที่จดภาษีมูลค่าเพิ่ม · ไม่พบ = 400 ภาษาไทย) |
| เดือน | `entryDate` ภายใน [วันที่ 1 00:00 น., วันที่ 1 ของเดือนถัดไป 00:00 น.) ตามปฏิทินไทย (`pp30MonthRange` ใช้ `bangkokMidnight` — ไม่ขึ้นกับ TZ ของโปรเซส) · เดิม preview ใช้ `postedAt` ซึ่งเท่ากันสำหรับรายการที่ระบบลง ต่างกันเฉพาะรายการที่ลงเองแบบย้อนวัน (นับในเดือนของวันที่รายการ) · ปี/เดือนผิดรูป = 400 "ปี/เดือนไม่ถูกต้อง" · ตารางรายการบนหน้า `/finance/vat` แสดงวันที่ post (`postedAt`) — ของเดิม |
| ลำดับรายการ (`loadPp30OutputVatLines`) | เรียงบรรทัด `21-2101`/`21-2103` ของเดือนตาม `entryDate` ก่อน แล้ว `entryNumber` แล้ว id ของบรรทัด (`entryDate` อย่างเดียวไม่พอ — รายการอัตโนมัติหลายใบในทรานแซกชันเดียวกันประทับเวลาเดียวกัน ลำดับจึงไม่แน่นอนถ้าเรียงแค่นั้น) — กำหนดลำดับของ `lines`/`reductionLines` ที่ตัวคำนวณคืน ซึ่งไหลต่อเป็นลำดับของ `lineItems.outputVatReductions` ใน preview (ตารางรายการของหน้า `/finance/vat` เป็นคนละ query แยกจากตัวคำนวณ — ดูแถว "รายการปิด/ชำระภาษีขาย" ด้านล่าง) |
| ที่มาของเดบิต 21-2101 (`classifyOutputVatReduction`) | **กลับรายการ**: `metadata.tag = 'REVERSAL'` (รายการกลับแบบกระจกทุกชนิด) หรือ `referenceType = 'REVERSAL'` (ยกเลิกรายการบัญชีด้วยมือ — รายการกลับไม่มี metadata) หรือเอกสารรายได้อื่นแบบ `-R` (`metadata.source = 'OTHER_INCOME'` + `otherIncomeId` ลงท้าย `:reversal`) · **ใบลดหนี้ ม.82/5**: `tag 'JP5'` + `flow 'repossession'` หรือ `tag 'BAD-DEBT'` + `flow 'write-off'` (ตัดสินทีละบรรทัด — รายการเดียวมีทั้งเดบิตใบลดหนี้และเครดิตภาษีถึงกำหนด) · นอกนั้น **อื่น ๆ** (ไม่ถูกทิ้ง) |
| รายการปิด/ชำระภาษีขาย (ผ่าน `21-3201`) | รายการที่มีบรรทัดยังไม่ถูกลบบนบัญชี `21-3201` (เจ้าหนี้สรรพากร ภ.พ.30 รอชำระ) — ทั้งใบเป็นรายการปิด/ชำระภาษีขาย หรือการกลับรายการของรายการปิดนั้น (`isVatSettlementEntry(entry)`) — บรรทัดของรายการนี้อยู่**นอก**ตัวเลขภาษีขายของเดือนทุกที่: ภาษีขายในตัวคำนวณ (บรรทัด `21-2101` **และ `21-2103`** ทั้งเครดิตและเดบิตของรายการนั้นถูกข้ามทั้งบรรทัด ไม่ใช่แค่เดบิตที่ลด — fix round 1 กันไว้เฉพาะฝั่ง 21-2101, fix round 2 (2026-09-30) จึงกันฝั่ง 21-2103 ด้วย ผ่าน `countsInPp30Computation(line)` ที่ `summarizePp30OutputVat` เช็คก่อนแยกบัญชี) · ภาษีซื้อของหน้า `/finance/vat` (`vatInput` — กันบรรทัด `11-4101` ของรายการปิดด้วย ไม่งั้นเครดิตภาษีซื้อที่ "ใช้" ตอนปิดยอดจะหักล้างภาษีซื้อใหม่ของเดือนเดียวกัน) · ตารางรายการของหน้า `/finance/vat` (`lines`/`lineCount` — ไม่โชว์บรรทัดใดของรายการปิดเลย ไม่จำกัดเฉพาะบรรทัดภาษีขาย) — `countsInPp30Computation(line)` (ทั้งสองบัญชี — F1 fix round 2) · `countsAsPp30SettledVat(line)` (ต่อบรรทัด `21-2101` โดยเฉพาะ ประกอบจาก `countsInPp30Computation`) และ `isVatSettlementEntry(entry)` (ต่อทั้งรายการ ทั้งสามอยู่ใน `pp30-output-vat.ts`) เป็นกติกาเดียว ทุกจุดที่รวมยอดต่อบรรทัดต้องเรียกฟังก์ชันเหล่านี้แทนเช็ค `accountCode`/`lines.length` เอง (ผู้เรียกที่ลืม = รวมยอดรายการปิดเข้าไปด้วย ผลรวมย่อยไม่เท่ายอดรวม) · **ข้อจำกัด**: ต้องปิด/นำส่งผ่าน `21-3201` เท่านั้นจึงถูกกันออก — `Dr 21-2101 / Cr ธนาคาร` ตรง ๆ (ไม่ผ่าน `21-3201`) ยังนับเป็น "หัก รายการอื่นที่ลดภาษีขาย" ตามเดิม · ภาษีซื้อของ `previewPP30` (`TaxPreviewService.getInputVatLineItems`) **ไม่ถูกแตะ** — ยังไม่กันรายการปิดออก (คงกติกาเดิมตาม V4) |
| รายละเอียดที่ส่งออก | `toPp30OutputVatJson` (ยอดเป็นสตริง 2 ตำแหน่ง): `settledGross` · `reductionReversal` · `reductionCreditNote` · `reductionOther` · `reductionTotal` · `settledNet` · `mandatory60DayCredit` · `mandatory60DayDebit` · `mandatory60DayNet` · `mandatory60DayIncluded` · `totalOutputVat` — กระทบยอดได้เสมอ (ตั้ง − หัก = สุทธิ) · preview ส่งเป็น `outputVatBreakdown` + `lineItems.outputVatReductions` (รายการที่ลดยอดพร้อมที่มา) · หน้า `/finance/vat` ส่งเป็น `outputVat` |
| เดือนของการลด | รายการกลับรายการ/ใบลดหนี้ลดภาษีขายของ**เดือนที่ลงรายการ** ไม่แก้เดือนเดิม · ยึดคืนลงย้อนวันได้เฉพาะในเดือนปัจจุบัน (`assertRepossessionPeriodsOpen`) ใบลดหนี้จึงอยู่เดือนเดียวกับรายการ |
| ภาษีซื้อ | **ไม่อยู่ในตัวคำนวณนี้** — `previewPP30` (เดบิต 11-4101 flow `expense-*` ของสาขาในบริษัท) คงกติกาเดิมทั้งหมด (ไม่กันรายการปิดภาษีออก) · `getVatMonthly` (11-4101 สุทธิทุก flow ไม่กรองบริษัทเมื่อไม่ส่ง) คงกติกาเดิมเช่นกัน **ยกเว้นข้อเดียว**: ตั้งแต่ fix round 1 กันบรรทัด 11-4101 ของรายการปิด/ชำระภาษีขาย (ผ่าน 21-3201) ออกด้วยแล้ว (ดูแถว "รายการปิด/ชำระภาษีขาย" ด้านบน) ส่วนภาษีซื้อของไฟล์ ภ.พ.30/รายงานภาษีที่กดสร้าง (Excel/TaxReport, `previewPP30`) ยังไม่เปลี่ยน ⇒ "ภาษีที่ต้องชำระ" สองที่ยังต่างกันได้ จนกว่าจะได้คำตอบฝ่ายบัญชีเรื่องภาษีซื้อ |
| field เดิมที่ความหมายเปลี่ยน | `previewPP30.totalVatOutput` = 21-2101 สุทธิ (**ไม่รวม 21-2103 แล้ว**) · `totalVatSettled` = 21-2101 **สุทธิ** · `totalVatMandatory60Day` = 21-2103 **สุทธิ** (ข้อมูลประกอบ) · `lineItems.mandatoryVat60Day[].vatAmount` = เครดิต − เดบิต · `vatOutputBySource` = 21-2101 **สุทธิ** ตาม `referenceType` (รวมกัน = `totalVatSettled`) · `getVatMonthly` คืนยอดเป็นสตริงทศนิยม 2 ตำแหน่ง, `vatOutput` = 21-2101 สุทธิของ FINANCE และตาราง `lines` มีแถว 21-2103 |

**ยังเปิดอยู่:** ฝ่ายบัญชีต้องตอบเรื่องภาษีขาย 60 วัน — (ก) รวมกลับเข้ายอด (ข) ไม่รวม (ค) รวมเฉพาะงวดที่ยังไม่ตั้งลูกหนี้งวด และควรตั้งภาษีขาย 60 วันกับสัญญาที่ยึดคืน/ปิดแล้วหรือไม่ (ตัวอย่างบน prod: `JE-202609-00055` ลงหลังยึดคืน) · หน้า `VatReportPage` (ผู้เรียก `/tax/pp30-preview` + ไฟล์ส่งออก) ยังไม่มีเส้นทางในเว็บ — ป้าย "ภาษีขาย (Cr 21-2101)" บนหน้านั้นต้องแก้ตอนเปิดใช้ · ปุ่ม Excel/XML บน `/finance/vat` ยังเป็นปุ่มเปล่า · ตรวจข้อมูล `checkVatMismatch` / `checkLateFeeVatLeak` / `traceVatTotal` ยังเทียบเครดิต 21-2101 กับ `Payment.vatAmount` (คนละตัววัด — ต้องออกแบบใหม่) · ยกเลิกรายการบัญชีด้วยมือ (`JournalService.void`) ยังเปลี่ยนรายการเดิมเป็น `VOIDED` ⇒ ภาษีขายของเดือนเดิมถูกแก้ย้อนหลังและเดือนที่ยกเลิกถูกหักอีกครั้ง — งานแยกถัดไป (prod ยังไม่เคยมีการยกเลิกแบบนี้)

---

## Reports

`apps/api/src/modules/accounting/accounting.service.ts`:

| Method | Description |
|--------|-------------|
| `getTrialBalance(asOfDate?)` | Running balance per account, grouped by 2-digit code prefix |
| `getProfitLossFromJournal(start, end)` | Revenue (41+42) minus Expenses (51+52+53+54). Excludes 55-XXXX |
| `getBalanceSheetFromJournal(asOfDate?)` | Assets (11+12) / Liabilities (21+22) / Equity (31+32+33). Contra assets (11-2102, 11-2106) sum as negatives |

---

## Wipe & Reseed (one-time prod migration from A.0-A.3)

Run as Cloud Run Job after merging Phase A.4 to production. Requires explicit owner approval.

### CRITICAL: Deploy order for Phase A.4 migration

The migration `20260801100000_phase_a4_cpa_chart_schema` adds NOT NULL columns (`name`, `normalBalance`, `type`) on `chart_of_accounts`. Running `prisma migrate deploy` on a non-empty `chart_of_accounts` table WILL FAIL.

**Mandatory sequence:**
1. Wipe first: run the CLI below (clears accounting tables including `chart_of_accounts`)
2. Then migrate: `npx prisma migrate deploy`
3. Reseed is automatic (wipe CLI reseeds ผัง FINANCE ทั้งชุดจาก CSV หลัง truncate — จำนวนบัญชีอ่านจาก CSV, CLI พิมพ์ created/updated จริงออกมา)

```bash
# Step 1: Wipe + reseed CoA
CONFIRM_WIPE=YES_I_AM_SURE npm --prefix apps/api run wipe:accounting

# Step 2: Apply migration (chart_of_accounts now empty — NOT NULL columns will succeed)
npx prisma migrate deploy
```

For fresh dev environments (`prisma migrate reset`): ordering is automatic — no manual wipe needed.

Truncates (in order): `journal_lines`, `journal_entries`, `payments`, `installment_schedules`, `contracts`, `chart_of_accounts`, then reseeds ผัง FINANCE ทั้งชุดจาก CPA CSV (ปัจจุบัน 111 บัญชี (ณ 2026-08-08 หลังเพิ่ม 21-1107)).

After wipe + migrate, verify (P3-SP5 DEEP fix C4 — counts split by company):
1. `SELECT COUNT(*) FROM chart_of_accounts WHERE code NOT LIKE 'S%';` — expected 111 (ณ 2026-08-08 — เลขนี้เดินตาม finance-coa.csv เสมอ) (FINANCE — อย่าจำเป็นค่าคงที่ ให้นับจาก CSV)
2. `SELECT COUNT(*) FROM chart_of_accounts WHERE code LIKE 'S%';` — expected ~56 (SHOP, P3-SP5)
3. Smoke one contract end-to-end via UI
4. Run TB report (`scope=FINANCE`) and confirm it balances
5. Run TB report (`scope=SHOP`) and confirm it balances
6. Run TB report (`scope=ALL`) and confirm `isAllBalanced=true` (both halves balance independently)

CLI source: `apps/api/src/cli/wipe-accounting.cli.ts`

---

## VAT Policy

- **SHOP** not VAT-registered — no VAT on SHOP transactions
- **FINANCE** VAT-registered at 7%
- **Late fees** (ค่าปรับล่าช้า) — NOT subject to VAT (owner policy, legally correct: penalties excluded from VAT base)

  **Flat-bracket late-fee model (bracket-only, permanent):** late fee = `tier1Amount` for 1..(tier2MinDays-1) days overdue, `tier2Amount` (flat, does not accumulate per day) for >= tier2MinDays days overdue, driven by SystemConfig keys `late_fee_tier1_amount`, `late_fee_tier2_amount`, `late_fee_tier2_min_days` (defaults 50/100/3). CPA ยืนยันขั้นบันไดถาวร + ถอด PER_DAY ออกจากโค้ด 2026-08-01 (เดิม D2 2026-06-25 CPA-gated ไม่เคยเปิดใช้บน prod) — the per-day model (`min(daysOverdue × ratePerDay, maxAmount, capPct% × installmentGross)`) and its config-switchable `late_fee_mode` were removed entirely; BRACKET is the only formula in the system now. Single source of truth: `resolveLateFee` in `late-fee.util.ts`; the overdue cron reproduces the same flat-bracket CASE expression in SQL, guarded by an anti-drift test (`late-fee-bracket-sql.integration.spec.ts`).

- No WHT on customer transactions (deferred to A.5 for vendor/payroll flows)

### VAT input account routing (P0-1 — Fix Report v1.0)

Two accounts look similar; **use them differently**:

| Account | When to use | Claimable on ภ.พ.30? |
|---|---|---|
| **11-4101** ภาษีซื้อ | Routine purchase VAT — invoiced from a registered vendor | ✅ Yes (Input Tax Credit) |
| **11-2104** ลูกหนี้-VAT ที่ออกแทน | ม.83/6 cases only — VAT paid on behalf of an overseas service provider | ❌ No (different statute) |

Expense module JE templates (`expense-accrual`, `expense-same-day`, `credit-note`) **all** book purchase VAT to **11-4101**. Booking to 11-2104 silently inflates the "ลูกหนี้" line on the balance sheet AND blocks the VAT refund. Anti-regression test exists in each template spec.

### Asset VAT — 11-4102 deferred → 11-4101 transfer flow

Assets can be POSTed before the supplier tax invoice physically arrives (TFRS accrual). For that case the asset entry form lets the user pick `vatAccount = '11-4102' ภาษีซื้อรอเรียกเก็บ` — the purchase JE then books the VAT to 11-4102 instead of 11-4101. Because 11-4102 is NOT claimable on ภ.พ.30, this VAT is parked until the invoice arrives.

When the invoice physically arrives, the user clicks "ใบกำกับมาถึงแล้ว" on `AssetDetailPage`. `AssetService.markInvoiceReceived` runs `AssetInvoiceReceivedTemplate`:

```
Dr 11-4101 ภาษีซื้อ          [vatAmount]
   Cr 11-4102 ภาษีซื้อรอเรียกเก็บ [vatAmount]
```

Guards:
- Asset must be POSTED + `hasVat` + `vatAccount === '11-4102'` + `!invoiceReceivedAt`
- V15 period guard uses TODAY (transfer posts to current period — purchaseDate may be in a closed period and that's fine)
- Idempotent via `metadata.flow = 'asset-invoice-received' + assetId` (mirrors asset-purchase pattern) + unique constraint on `FixedAsset.invoiceTransferJournalEntryId`
- After success: `asset.vatAccount` flips to `'11-4101'`, `invoiceReceivedAt/ById/JournalEntryId` populated, AuditLog `INVOICE_RECEIVED` written in same `$transaction`

Template: `apps/api/src/modules/journal/cpa-templates/asset-invoice-received.template.ts`
Endpoint: `POST /assets/:id/invoice-received` (Roles: OWNER, FINANCE_MANAGER, ACCOUNTANT)
Schema: 3 nullable fields on `FixedAsset` (migration `20260926000000_asset_invoice_received`).

---

## ค่าปรับดิวพักงวดสุดท้าย (Reschedule Fee Park — คำสั่งเจ้าของ 2026-08-16)

Spec: `docs/superpowers/specs/2026-08-16-reschedule-fee-park-last-installment-design.md`
Schema: `Contract.rescheduleAdvanceBalance Decimal @default(0) @db.Decimal(12, 2)`
(@map `reschedule_advance_balance`, migration `20260992000000_reschedule_advance_balance` —
additive `NOT NULL DEFAULT 0`, ไม่ rewrite ตาราง)

**GL ไม่เปลี่ยน — ยังเป็น 21-1103 เงินรับล่วงหน้าเหมือนเดิม.** `rescheduleAdvanceBalance`
เป็นถัง **ระดับ application เท่านั้น** ที่แยกเงินค่าธรรมเนียมปรับดิว (6a/6b) ออกจาก
`Contract.advanceBalance` (ถังรวม FIFO เดิม) ทั้งสองถังโพสต์ลง 21-1103 บัญชีเดียวกัน ต่างกันที่
**กติกาการหัก**: ถังรวมถูก 2A accrual หัก FIFO เข้างวดถัดไป ส่วนถังพัก **แตะได้เฉพาะงวดสุดท้าย**
ตาม CPA CSV (`case-6a/6b-reschedule-*.csv`) ที่กำหนดว่าค่าธรรมเนียมปรับดิว = เงินจ่ายล่วงหน้า
ของงวดสุดท้าย. เครดิตจากจ่ายเกินธรรมดา (D1) ยังหักงวดถัดไปเหมือนเดิม (คำตัดสิน 2026-06-25 คงอยู่).

### จุดเครดิต (เงินเข้าถังพัก)

| Flow | ที่ | หมายเหตุ |
|---|---|---|
| 6a (เก็บค่าธรรมเนียมแยกใบ) | `reschedule-collect.service.ts` — `rescheduleAdvanceBalance: { increment: fee }` | JE เดิม `Dr เงิน / Cr 21-1103` ไม่เปลี่ยน · description `'เงินรับล่วงหน้างวดสุดท้าย — ค่าธรรมเนียมปรับดิว (6a)'` (preview ใช้สตริงเดียวกัน byte-identical) |
| 6b (รวมกับค่างวด) | phase 1 เครดิตเข้าถังรวมตาม D1 ปกติ → phase 2 (`bundledPaid`) **sweep** `min(fee, advanceBalance)` ถังรวม → ถังพัก ใน tx เดียว | phase 1/2 เป็นคนละ transaction — sweep ที่ **สั้นกว่า fee** (รวมกรณี 0) ยิง Sentry warning `subsystem: 'reschedule-park'` (I-7) · idempotent ด้วย probe หา AuditLog `RESCHEDULE_ADVANCE_PARKED` ที่ผูก `(contract, paymentId)` ก่อน sweep (M-3) |

### จุดหัก (เงินออกจากถังพัก) — มีแค่ 3 ทาง

1. **2A accrual ของงวดสุดท้าย** (`inst.installmentNo === c.totalMonths`) —
   `InstallmentAccrual2ATemplate` หักถังรวมตามเดิมก่อน แล้วจึงหักถังพักด้วย JE แยกใบ
   `Dr 21-1103 / Cr 11-2103`, description `'หักเงินพักปรับดิวเข้างวดสุดท้าย'`,
   `metadata.flow = 'reschedule-park-consume'`, `reference = '<installmentScheduleId>:reschedule-park-consume'`.
   **งวดอื่นห้ามแตะถังพักเด็ดขาด.**
   Cap สองชั้น: `min(installmentTotal − genericConsumed, rowOutstanding)` โดย `rowOutstanding`
   ใช้สูตร FEE-FIRST ชุดเดียวกับ `feeNettedOutstanding` ใน `compute-cn-breakdown.ts`
   (งวดสุดท้ายที่จ่ายไปแล้วก่อน accrual → หักซ้ำไม่ได้, `11-2103` ติดลบไม่ได้ — I-3).
2. **จ่ายงวดสุดท้ายก่อน accrual** (wizard → `PaymentReceiptOrchestrator`) — auto-consume
   หักถังรวมก่อน เหลือเท่าไรจึงหักถังพัก, gate ด้วย `installmentNo === contract.totalMonths`
   ทั้ง 3 ชั้น (FE `computeNetReceiptDue` / preview / orchestrator) เป็น predicate เดียวกัน
   ป้องกัน preview ≠ posted. ขา `Dr 21-1103` ของใบเสร็จรวมสองถังเป็นบรรทัดเดียว แต่ JE ถูก stamp
   `metadata.genericConsume` / `metadata.parkConsume` (`JE_ADVANCE_SPLIT_META` ใน
   `receipt-void.service.ts`) เพื่อให้ **void แยกคืนถูกถัง** — JE ที่ไม่มี stamp (ก่อนฟีเจอร์นี้)
   คืนเข้าถังรวมทั้งก้อนโดยตั้งใจ เพราะถังพักเป็น forward-only จึงไม่มีทางมีเงินพักอยู่ในนั้น (I-2).
3. **ปิดสัญญาก่อนกำหนด — JP4 + JP5 พร้อม relief leg** (ดูหัวข้อถัดไป).

> **2026-09-29 — งวดสุดท้ายที่ตั้งลูกหนี้งวด ณ วันรับเงิน (+ ก1):** เมื่อใบรับชำระของทางที่ 2 ทำให้งวดสุดท้ายชำระครบ
> ระบบลงรายการ 2A (ส่วนที่เหลือของงวด) ในธุรกรรมเดียวกันด้วย แต่เป็น "แกนอย่างเดียว" — **2A ตอนรับเงินไม่หักถังพัก**
> (การหักตอนรับเงินเป็นหน้าที่ของเส้นทางรับชำระตามกติกาเดิมของมัน). ใบรับชำระบางส่วนของงวดสุดท้าย**ก่อนวันครบกำหนด**
> ลง 2A เท่ายอดที่รับ (แกนอย่างเดียวเช่นกัน) · ตั้งแต่วันครบกำหนดไม่ลง 2A · ถึงวันครบกำหนดรอบกลางคืนตั้งส่วนที่เหลือของงวด
> และหักถังพักตามทางที่ 1 — เพดาน = min(ส่วนที่ถังรวมยังไม่ได้ล้าง, ยอดที่ยังค้างบนแถวงวด `feeNettedOutstanding`,
> ยอดลูกหนี้ของงวดที่ยังไม่ถูกล้างในบัญชี − ส่วนที่ถังรวมล้าง) (ชั้นสุดท้ายเพิ่มใน PR2ข). จุดหักยังมี 3 ทางเท่าเดิม.

### ปิดสัญญาก่อนกำหนดด้วยสลิป — ไม่ผ่านคิวอนุมัติเมื่อยอดตรง (คำสั่งเจ้าของ 2026-09-24)

Mockup: artifact `69ezDjY8uoFrqcBfPfrLEQ` V4 (6 กระดาน) · โค้ด: `contracts/early-payoff-slip/` (`slip-checks.ts` กติกา 5 ข้อ
แบบฟังก์ชันบริสุทธิ์ · `early-payoff-slip.service.ts` อัปโหลด→อ่าน→ตรวจ→ตั๋ว→ยืนยัน) · `ContractPaymentService.earlyPayoff`
รับ `slipMatch` เป็นทางเข้าที่สองคู่กับ `approvalContext` · UI `ContractEarlyPayoff.tsx` (สวิตช์ "โอนเข้าบัญชีบริษัท · แนบสลิป |
เก็บที่หน้าร้าน", แถบ 3 ขั้น, การ์ดสลิป 4 สถานะ, กล่องยืนยัน, จอสำเร็จ).

- **เครื่องยนต์อ่านสลิปวันนี้ = OCR ของบอท (`VisionService` Claude Haiku, กินเครดิต Anthropic)** — เจ้าของเลือก "ทำเลย ใช้ OCR
  เดิมก่อน" 2026-09-24; อ่านรูปอย่างเดียว ปลอมได้ ⇒ ยังมีกล่องยืนยัน + ติ๊ก "ตรวจแล้วว่าสลิปเป็นของสัญญานี้" · สลับเป็น SCB แบบ OBI
  (ต้องสมัคร SCB Developer ชื่อเบสท์ช้อยส์ + รับเข้าบัญชี SCB) หรือบริการกลาง (SlipOK ฯลฯ) ได้โดยเปลี่ยนแค่ตัวที่คืน `SlipReading`.
- **5 ข้อต้องผ่านครบถึงปิดเลย** (`evaluateSlipChecks`): อ่านออก + ความมั่นใจ ≥ 0.9 (เกณฑ์เดียวกับบอท) · ยอด = `computePayoffQuote.totalPayoff`
  ±0.01 (เทียบเป็นสตางค์) · บัญชีปลายทาง = บัญชีบริษัท (`FinanceConfigService.isCompanyBankAccount` — อ่านไม่ได้ = ไม่ผ่าน) ·
  ลายนิ้วมือสลิป (`slipFingerprint` สูตรเดียวกับ `SlipProcessingService.computeSlipHash`) ยังไม่มีใน `SlipFingerprint` ·
  วันที่ในสลิปไม่เป็นอนาคต (อ่านไม่ได้ = ใช้วันนี้). ไม่ผ่านข้อใด/OCR ไม่พร้อม → หน้าจอพาไป "ส่งขออนุมัติ (แนบสลิปนี้)" — `slipUrl`
  ติดไปกับ payload ให้ผู้อนุมัติเปิดดู (`PaymentApprovalSummary`). "เก็บที่หน้าร้าน" ต้องขออนุมัติเสมอ.
- **ตั๋ว (ticket)**: HMAC-SHA256 ด้วย `JWT_SECRET` ของผลตรวจ (สัญญา · ผู้กด · key รูป · hash · ยอด · ส่วนลด · วันที่) อายุ 15 นาที —
  ไม่อ่าน OCR ซ้ำตอนยืนยัน (ผลไม่ deterministic) และไม่มีตารางเก็บผลอ่านที่ยังไม่ผูกใบเสร็จ. ตอนยืนยันใน tx เดียวกับ JE:
  ยอดปิดสดต้องยังตรง (409 ถ้าขยับ) · `tx.slipFingerprint.create` (unique → P2002 = 409 "สลิปนี้ถูกใช้") · `PaymentEvidence`
  (`APPROVED`, `reviewNote: EARLY_PAYOFF_SLIP_MATCH`, `imageUrl` = key) · AuditLog `EARLY_PAYOFF_SLIP_MATCHED` ผ่าน `tx.auditLog.create`.
  `Payment.evidenceUrl` = URL สลิป · `gatewayRef` = เลขอ้างอิงจากสลิป · `paidDate`/JE = วันที่ในสลิป · บัญชีรับ 11-1201 เท่านั้น.
- Endpoints: `POST /contracts/:id/early-payoff/slip` (multipart `slip` + `discountPct`, OWNER/BM/FM) → ผลตรวจ+ตั๋ว ·
  `POST /contracts/:id/early-payoff/slip-confirm` `{ ticket, notes? }` → JP4 ปกติ + ใบเสร็จ EARLY_PAYOFF + journey `EARLY_PAYOFF`.
  `POST /contracts/:id/early-payoff` เดิมยังปฏิเสธเมื่อไม่มีทั้งคำขออนุมัติและสลิป.
- ที่ยังเปิด: LIFF ลูกค้าไม่มีทางนี้ · ไม่มีการแนบสลิปใบที่ 2 (โอนเพิ่มให้ครบ) — ใช้ "เปลี่ยนสลิป" แทน · ไม่ลบรูปสลิปที่ตรวจไม่ผ่านออกจาก
  storage (เก็บเป็นหลักฐานคำขอ).

### JP4 / JP5 — relief leg `Dr 21-1103` (C-3, 2026-08-17)

`computePayoffQuote` หักถังพักออกจากยอดค้างของลูกค้า (บรรทัด `rescheduleAdvanceApplied` แยกจาก
`advancePayment`) ทำให้ยอดที่ลูกค้าจ่ายลดลง — **ห้าม netting เฉยๆ โดยไม่ปลดหนี้ 21-1103** ไม่งั้น `Dr เงินสด` จะสูงกว่าเงินที่รับจริง
เท่ากับยอดพัก และเหลือเครดิตผีค้างบนสัญญาที่ปิดไปแล้ว. รูปแบบที่ลงจริง:

```
Dr <cash>    = totalCash − parkRelief
Dr 21-1103   = parkRelief          ← บรรทัดใหม่ (ไม่ออกเลยเมื่อ parkRelief = 0)
```

ยอดเดบิตรวมเท่าเดิม ⇒ **ทุกขา Cr เหมือนเดิมทุกไบต์ ⇒ golden JP4/JP5 เดิมไม่ขยับ**. **PR5 (JP4):** เงินสด = เงินที่รับจริง
(`quote.totalPayoff` — หักเงินพักแล้ว) · `Dr 21-1103` = เงินพัก · 52-1106 = ส่วนที่เหลือให้สมดุล (หัวข้อ "ปิดยอดก่อนกำหนด (JP4) — ล้างตามยอดในบัญชี")

| เรื่อง | กติกา |
|---|---|
| `parkRelief` คือเท่าไร | **ยอดถังพักเต็มจำนวน** clamp ไม่เกินยอดค้างหลังหักยอดชำระล่วงหน้า: `rescheduleAdvanceApplied = min(park, totalRemaining − advancePayment)` (ตั้งแต่ 2026-08-26; ก่อนหน้านั้นเป็น "ส่วนที่ยอดปิดดูดซับจริง" ซึ่งเหลือเศษค้าง 165.42 — ประวัติในกล่องล่าง) |
| ถังพักหักตรงไหนใน quote | **หักออกจากยอดค้างก่อนคิด ex-VAT/ต้นทุน/กำไร/ส่วนลด** (คำสั่งเจ้าของ 2026-09-23 — ดูกล่อง "🔁 เจ้าของสั่งเปลี่ยน" ด้านล่าง) และ**ต้นทุนยอดค้างลดตามสัดส่วนงวดที่เงินพักครอบ** (`งวดคงเหลือ − park ÷ ค่างวด`) — ค่าปรับดิว = เงินจ่ายงวดล่วงหน้า (CPA CSV 6a/6b) จึงลดต้นทุนเหมือนงวด PAID · เครดิตทั่วไป (`advancePayment`) ยังลดเฉพาะยอดค้าง **ไม่ลดต้นทุน** เหมือนเดิม (ไม่อยู่ในคำสั่ง — ถ้าจะให้สอดคล้องต้องถามเจ้าของแยก) |
| Clamp | JP4 (PR5): min(ยอดที่ยอดปิดหักให้, คอลัมน์ถังพัก, ยอด 21-1103 ในบัญชี) — เดิม clamp ด้วยฐานเงินสดตามงวด `totalCash` · JP5: clamp ด้วยยอด GL 21-1103 จริงของสัญญานั้น (`glContractBalance`) แล้ว `execute()` คืนยอดที่โพสต์จริง (`parkRelief`) — PR6: caller ใช้ลง audit `RESCHEDULE_ADVANCE_CONSUMED` เท่านั้น คอลัมน์ตั้งเป็น 0 ทั้งสาม (ไม่ decrement) · เคสสุดขั้วถังพัก ≥ ยอดค้างทั้งก้อน: quote ใช้ถังเท่ายอดค้าง (ส่วนลด 0 เพราะไม่มีฐาน) · JP4 (PR5) ปลดเท่ายอดที่ quote ใช้ (เดิมปลดได้แค่ฐานเงินสดตามงวด − ส่วนลดดอกเบี้ย) · ส่วนเกินของถังค้าง (alarm I-5 ครอบเฉพาะการปิดครบงวด) · **PR6: JP5 ไม่มีส่วนค้างอีก** — ส่วนของถังพักที่ยอดปิดไม่ได้ดูดซับถูกหักด้วยบรรทัด `Dr 21-1103` เงินรับล่วงหน้าที่เหลือ (หัวข้อ "ยึดเครื่อง (JP5) / ตัดหนี้สูญ — หักเงินของลูกค้าที่ค้าง…") |
| JP5 วางบรรทัดตรงไหน | push `Dr 21-1103` **ก่อน** คำนวณ plug ขาดทุน/กำไร → plug ดูดซับเอง (pattern เดียวกับ `customerRefund`/21-1107 ไม่มีสูตรที่สอง) |
| Decrement คอลัมน์ | อยู่ใน `$transaction` เดียวกับ JE เสมอ + AuditLog (ดูตารางล่าง) · preview (`getEarlyPayoffQuote`, `previewCalculation`) ใช้ `parkRelief` ตัวเดียวกัน ⇒ preview === posted · **PR6: JP5 ตั้งคอลัมน์เงินของลูกค้าทั้งสามเป็น 0** (ไม่ใช่ decrement) |
| Parity | `computePayoffQuote` ยังเป็นแหล่งเดียวของทั้งสองเส้นทาง — `payoff-parity-park.spec.ts` ปักว่า JP5 `closingAmount` === JP4 `totalPayoff` และ `parkRelief` ที่ทั้งสองใช้เป็นตัวเดียวกัน |

> **🔁 เจ้าของสั่งเปลี่ยน 2026-09-23 — ค่าปรับดิวที่พักไว้ "ต้องนำไปหักก่อน" (แทนสูตรผู้สอบ 2026-08-26 ด้านล่าง)**
>
> สัญญาจริงสาขาลพบุรี (3,671 × 7 งวด · พัก 1,714 · ลด 50%): จอโปรแกรมได้ **17,717.97**
> (สูตรผู้สอบ: ปิดปกติ 19,431.97 − 1,714) แต่ตารางเจ้าของได้ **18,135.85**:
> ยอดค้าง 25,697 − 1,714 = **23,983** → ÷1.07 = 22,414.02 → ต้นทุน "45%" **10,719.72**
> (= 11,485.83 × 23,983 ÷ 25,697 — ต้นทุนต่อบาทของยอดค้างเท่าเดิม ไม่ใช่ 45% ตายตัว)
> → กำไร 11,694.30 → ลด 5,847.15 → **18,135.85** (ลูกค้าจ่าย**มากขึ้น** 417.88 เพราะ
> ฐานส่วนลดเล็กลง). ถังพักยังถูกใช้เต็มจำนวน (`Dr 21-1103` = 1,714) ไม่มีเศษค้าง —
> ต่างจากสูตรผู้สอบเฉพาะ **ฐานส่วนลด**. ⚠️ **ขัดกับคำวินิจฉัยผู้สอบ 2026-08-26 —
> ยังไม่ได้แจ้งผู้สอบ** (เจ้าของสั่งตรง "ต้องคำนวนตามที่ส่งให้").
> Golden: `compute-payoff-quote.spec.ts` "ตารางเจ้าของ 2026-09-23" · JE ฝั่งบัญชีไม่ขยับ
> (ขา Dr 21-1103 หักเต็มอยู่แล้ว · ส่วนลด 52-1106 คิดจากดอกเบี้ยตามงวด คนละฐานกับ quote
> — ACCOUNTANT NOTE Wave-1 #11 · **ตั้งแต่ PR5 52-1106 = ส่วนลดที่ให้จริง เงินสด = เงินที่รับ**) · UI: บรรทัด "หักค่าปรับดิวที่จ่ายล่วงหน้าไว้" ย้ายขึ้นไป
> อยู่เหนือ "คงเหลือยอดค้าง" ทั้งหน้าปิดก่อนกำหนดและหน้ายึดคืน (preview เพิ่ม
> `totalRemaining`/`advancePayment`).

> **✅ CPA ตอบครบแล้ว 2026-08-26 — แก้โค้ดแล้ว (ถูกแทนที่บางส่วน 2026-09-23 — กล่องบน)**
>
> ผู้สอบส่งสเปคมาพร้อมตัวอย่าง JE เต็ม (*"ปิดยอดก่อนกำหนด กรณีมีค่าปรับดิว"*):
> **`ยอดปิดยอดจริง = ยอดปิดยอดปกติ − 21-1103 คงเหลือ`** โดย "ยอดปิดยอดปกติ" =
> คำนวณเหมือนสัญญาที่ไม่เคยปรับดิว · หลักการ: *"21-1103 ค่าปรับดิวคงเหลือ =
> หนี้สินที่ค้างลูกค้า → ปิดยอดก่อนต้องคืน"*
>
> ⇒ **ถังพักไม่ลดฐานส่วนลด และหักเต็มจำนวนตอนท้าย** ⇒ **ไม่มี residual อีกต่อไป**
> คำถาม "165.42 ลงบัญชีรายได้ตัวไหน" จึงตกไปทั้งข้อ — เศษนั้นไม่ควรเกิดตั้งแต่แรก
>
> แก้ที่ `computePayoffQuote` จุดเดียวตามที่ดักไว้: `main = tail(advancePaymentNoPark)`
> แล้วหักถังพักเต็มจำนวนหลังคำนวณส่วนลด · `advancePayment` **ไม่รวมถังพัก**อีกต่อไป
> (ไม่งั้นตัวเลขบนหน้าจอไม่ลงตัว — UI คิด `คงเหลือ = รวมค้าง − ชำระล่วงหน้า`)
> · UI เพิ่มบรรทัด "หักค่าปรับดิวที่จ่ายล่วงหน้าไว้"
>
> เลขที่ขยับ (เคสตัวอย่างในเทส): ลูกค้าจ่าย `10,917.42 → 10,752.00` (ลดอีก 165.42)
> · `Dr 21-1103` `188.58 → 354.00` · ยอด Dr รวมเท่าเดิม 11,106.00 ⇒ **ทุกขา Cr
> ไม่ขยับ** · JP4/JP5 parity ยังตรงกัน (`payoff-parity-park.spec.ts` ผ่าน)
>
> **ย่อหน้าถัดไปเป็นประวัติของกติกาเดิม เก็บไว้อ่านที่มา — ไม่ใช่พฤติกรรมปัจจุบันแล้ว**

> **⚖️ CPA ตอบแล้ว 2026-08-24 (ข้อ C2) — (กติกาเดิม ถูกแทนที่ 2026-08-26):** *"กรณีปิดสัญญาก่อน นำมาคำนวนเป็น
> ชำระล่วงหน้า เพื่อลดยอดค้างชำระ และบันทึกทางบัญชีเป็นรายได้ (เหมือนชำระค่างวดล่วงหน้า)"*
> ⇒ ครึ่งแรก (ลดยอดค้าง) โค้ดทำอยู่แล้วผ่าน `rescheduleAdvanceApplied`; ครึ่งหลัง (รับรู้ residual
> เป็นรายได้) **ยังไม่มี** และ **ยังลงมือไม่ได้** เพราะผู้สอบยังไม่ได้ระบุบัญชีรายได้ — ผังปัจจุบัน
> **ไม่มีบัญชีค่าธรรมเนียมปรับดิว** เลย (ตัวเลือก: 41-1101 / 42-1103 / เปิด 42-11XX ใหม่) และยังไม่ตอบ
> เรื่อง VAT / กรณีผ่อนครบงวด / กรณีตัดหนี้สูญ. ดู `docs/accounting/cpa-answers-2026-08-24.md`
> ข้อ C2. **ย่อหน้าถัดไปคือพฤติกรรมปัจจุบัน ซึ่งยังเป็นจริงทุกประการ**

**~~ยังไม่ตัดสิน (CPA-gated)~~ — ปิดแล้ว 2026-08-26:** residual **ไม่เกิดอีกต่อไป**
เพราะถังพักถูกหักเต็มจำนวน (ดูกล่องด้านบน) · ย่อหน้านี้เก็บไว้เป็นประวัติ:
เดิมยอดพักที่เหลือหลัง JP4/JP5 ระบบ **ไม่ตั้ง JE คืนเงิน/รับรู้รายได้ให้อัตโนมัติ** — ปล่อยค้างในคอลัมน์ + 21-1103 แล้วให้มนุษย์ตัดสิน. คำถาม
"ถังพักควรลดฐานส่วนลดหรือไม่" ก็ยังเปิดอยู่ (ถ้าเจ้าของ/CPA สั่งว่า **ไม่ควรลด**
`rescheduleAdvanceApplied` จะเท่ากับยอดพักเต็มโดยอัตโนมัติ แก้จุดเดียวใน `computePayoffQuote`).

### Residual ตอนปิดครบงวด — alarm อย่างเดียว ไม่ตั้ง JE (I-5)

สัญญาที่เดินครบงวดตามปกติ **ไม่เคยผ่าน JP4** จึงอาจปิดโดยยังมีเงินพักเหลือ (ปรับดิวหลายรอบ
ถังพักอาจเกิน 1 งวด แต่ 2A cap ที่ `installmentTotal`). `checkContractCompletion`
(`payment-helpers.ts`) จึงยิง `Sentry.captureMessage` level `warning`
(`tags.subsystem = 'reschedule-park'`) + สร้าง **Todo MEDIUM** หนึ่งใบ (tag `reschedule-park`,
`RESIDUAL_PARK_TODO_TAG`, ระบุเลขสัญญา + ยอด, dedup กัน void → re-pay สร้างซ้ำ) —
pattern เดียวกับ `credit-note-delivery.service.ts`. **ไม่มี JE อัตโนมัติ** เพราะ
"คืนเงินลูกค้า vs รับรู้เป็นรายได้" เป็นคำตัดสิน CPA (คลาสเดียวกับ opening-balance gap
ใน interco spec §11). helper นี้ห้าม throw — alarm ต้องไม่ roll back เงินที่ลูกค้าจ่ายมาแล้ว.

### Forward-only — ไม่มี backfill

สัญญาที่ค่าธรรมเนียมปรับดิวถูกหักเข้างวดถัดไปไปแล้ว **ปล่อยตามนั้น** (คำตัดสินเจ้าของ
2026-08-16). ไม่มีสคริปต์ backfill และไม่ต้องมี — คอลัมน์ default 0 ทำให้สัญญาเก่าทุกใบ
เดินเส้นทางเดิมทุกประการ. ผลข้างเคียงที่ตั้งใจ: JE ก่อนฟีเจอร์นี้ไม่มี `metadata.parkConsume`
stamp และ void ของมันคืนเข้าถังรวมทั้งก้อน — **ถูกต้องแล้ว ห้ามไป "แก้" ให้เดา split ย้อนหลัง**.

### AuditLog action strings (M-4)

`AuditLog.action` เป็น String ธรรมดา (ไม่มี Prisma enum) — action ใหม่ของรอบนี้:

| Action | Entity | เขียนที่ | `newValue.source` |
|---|---|---|---|
| `RESCHEDULE_ADVANCE_PARKED` | `contract` | `reschedule-collect.service.ts` (6a เครดิตเข้าถัง / 6b phase-2 sweep) | `RESCHEDULE_COLLECT_6A_FEE`, `RESCHEDULE_COLLECT_6B_FEE_SWEEP` |
| `RESCHEDULE_ADVANCE_CONSUMED` | `contract` | `payment-receipt-orchestrator.ts` (จ่ายงวดสุดท้าย), `contract-payment.service.ts` (JP4), `repossessions.service.ts` (JP5 — PR6: เขียนเมื่อถังพักก่อนยึด > 0 หรือบรรทัดเงินพัก > 0 · `afterParkBalance` = 0 เสมอ) | `RECORD_PAYMENT_LAST_INSTALLMENT_PARK_CONSUME`, `EARLY_PAYOFF_PARK_RELIEF`, `REPOSSESSION_PARK_RELIEF` |
| `RESCHEDULE_ADVANCE_UNPARKED` | `contract` | `receipt-void.service.ts` (void ใบเสร็จ 6b ที่เคยถูก sweep) | `RECEIPT_VOID_6B_FEE_UNPARK` |

**`RESCHEDULE_ADVANCE_UNPARKED` = คู่ตรงข้ามของ `PARKED` และเป็น "สถานะ" ของการ sweep (R-2).**
6b ย้ายเงินเข้าถังพักผ่านขา **Cr** ซึ่ง**ไม่มี stamp** (ตอน phase 1 โพสต์ `Cr 21-1103` เงินก้อนนั้น
ยังเป็นเครดิตธรรมดาจริงๆ — phase 2 คนละ tx ถึงค่อยกวาดเข้าถังพัก) ดังนั้น split-by-stamp ที่ใช้กับ
ขา **Dr** ใช้ไม่ได้: ถ้าไม่ทำอะไรเลย void จะดึงเครดิตออกจากถังรวมทั้งก้อน (**`advanceBalance`
ติดลบเท่าค่าธรรมเนียม**) แล้วปล่อยเงินก้อนเดียวกันค้างในถังพักโดยไม่มี GL หนุน. เนื่องจาก
**AuditLog เป็น immutable (DB trigger)** จึงแก้แถวเดิมไม่ได้ — ใช้วิธี "แถวไหนใหม่กว่าชนะ" แทน:

- `receipt-void.service.ts` อ่านคู่ (PARKED, UNPARKED) ของ `(contract, paymentId)` → ถ้า PARKED
  ใหม่กว่า แปลว่า sweep ยังมีผล → ดึงเงินคืนจาก**ถังพัก** ไม่ใช่ถังรวม แล้วเขียน UNPARKED
- `reschedule-collect.service.ts` probe ตัวเดิม (M-3 idempotency) **ต้องใช้ตรรกะเดียวกัน** —
  void ใช้ payment row เดิม ถ้า probe หาแค่ PARKED มันจะเจอแถวเก่าแล้วปฏิเสธการ park ซ้ำ
  ⇒ จ่ายรอบสองค่าธรรมเนียมจะไหลกลับไปเข้างวดถัดไป = **บั๊ก FIFO เดิมกลับมาแบบเงียบๆ**

**กฎเหล็กของ alarm เงินพักคงเหลือ (R-1):** `alarmResidualParkOnCompletion` รับเฉพาะ
`PrismaService` (root) — **ห้ามรับ tx client** และ **ห้าม await** จากเส้นทางการรับเงิน. เหตุผล:
Postgres ทำให้ transaction เป็นพิษทันทีที่มี statement พัง ⇒ `try/catch` เพียงอย่างเดียว
**ไม่พอ** (commit ไม่ผ่านอยู่ดี) — ตัว alarm ต้องไม่อยู่บน connection ของ tx เลย. ปัจจุบัน
type system บังคับให้แล้ว (ส่ง `TransactionClient` เข้าไป = compile error) — อย่าคลายเป็น
`Prisma.TransactionClient | PrismaService` เพื่อความสะดวก. ยิงจาก 2 จุด: `checkContractCompletion`
(เส้นทาง orchestrator) และ cron 2A ตอน accrue งวดสุดท้ายแล้วไม่เหลืองวดค้าง (เคสที่ orchestrator
ไม่เคยทำงาน — R-5).

`newValue` ทุกใบมี `beforeParkBalance` / `afterParkBalance` (2dp string) เสมอ ⇒ ไล่ยอดถังจาก
audit trail ได้ตรงๆ. 6b sweep เพิ่ม `before/afterGenericBalance` + `sweptAmount` ด้วย และ
**AuditLog แถวนี้เองคือ idempotency marker ของ sweep** (เขียนใน tx เดียวกับการย้ายเงิน
⇒ "มีแถว" กับ "ย้ายเงินแล้ว" ขัดกันไม่ได้ — ไม่ต้องเพิ่มคอลัมน์ marker).

การ **void ใบเสร็จ** ไม่มี action string ใหม่ — ใช้ `RECEIPT_VOID` เดิม แต่เพิ่มฟิลด์
`newValue.rescheduleAdvanceRestored` (null เมื่อไม่มีเงินพักถูกคืน) คู่กับ
`advanceBalanceRestored` ที่มีอยู่แล้ว.

**หมายเหตุสำหรับคนเขียน flow ใหม่:** JE ที่ปลด 21-1103 ด้วย `metadata.tag = '2B'` **ต้อง**
ลงทะเบียนใน `ALWAYS_INCLUDED_2B_FLOWS` (`apps/api/src/modules/journal/reconstruct-prior.ts`)
ไม่งั้น `reconstructPriorCleared` จะมองไม่เห็นตอนที่มันปลดเต็มจำนวนงวด แล้วใบเสร็จถัดไปจะ
เครดิต `11-2103` ซ้ำเป็นสองเท่า (C-1 — เคส headline ของถังพักคือปลดเต็มงวดพอดี).

---

## V15 — ACCRUAL ห้ามมี WHT (ม.50 ป.รัษฎากร)

`ExpenseDocumentsService.post()` rejects the transition `DRAFT → ACCRUAL` whenever `withholdingTax > 0`. ป.รัษฎากร ม.50 says WHT arises "ขณะที่จ่ายเงินได้" — at payment, not at accrual. Booking WHT on the accrual leg would misfile the ภงด.3/53 period and incur เบี้ยปรับ. The settlement step (VENDOR_SETTLEMENT) is where WHT lands.

---

## V17 — WHT base = `amountBeforeVat` (ป.รัษฎากร)

WHT is computed on the **ฐานเงินได้สุทธิ** — the pre-VAT amount, never including VAT. Per `LineAggregatorService.computeLine`:

```ts
whtAmount = round2(amountBeforeVat × whtPercent / 100)
```

NEVER `totalAmount × whtPercent` (would double-tax the VAT). This applies uniformly across expense, other-income, and asset modules. Convention is enforced through service code, not a runtime guard — code-review must catch any drift.

Reference: ป.รัษฎากร — WHT is calculated on the net taxable income, excluding VAT.

---

## Payroll — แยกฝั่ง SHOP/FINANCE (คำสั่งเจ้าของ 2026-08-06)

Spec: `docs/superpowers/specs/2026-08-06-payroll-shop-side-design.md` ·
Runbook: `docs/accounting/payroll-shop-rollout-2026-08.md` ·
E2E: `apps/api/src/modules/expense-documents/__tests__/payroll-shop-flow.integration.spec.ts`

- ใบเงินเดือน 1 ใบสังกัดฝั่งเดียวผ่าน `PayrollDetail.entityScope`:
  **SHOP** (default — พนักงานสาขา) | **FINANCE** (ส่วนกลาง). UI มี toggle "กลุ่มพนักงาน".
- `PayrollTemplate` resolve บัญชีผ่าน AccountRoleMap ตาม scope:
  | | SHOP | FINANCE |
  |---|---|---|
  | เงินเดือน (Dr) | `shop_payroll_expense` → S52-1201 | `payroll_expense` → 53-1101 |
  | ปกส.นายจ้าง (Dr) | `shop_payroll_sso_expense` → S52-1205 | `payroll_sso_expense` → 53-1102 |
  | ภ.ง.ด.1 ค้างจ่าย (Cr) | `shop_wht_payroll` → S21-3101 | `wht_payroll` → 21-3101 |
  | ปกส.ค้างนำส่ง (Cr×2) | S21-3105 / S21-3106 | 21-3105 / 21-3106 |
  | เงินสด/ธนาคาร (Cr) | S11-1101..1103 / S11-1201..1202 | 11-1101..1103 / 11-1201..1203 |
  `companyId` = ฝั่งของเอกสาร (แก้บั๊ก B2 เดิม: FINANCE codes + SHOP companyId →
  เงินเดือนหายจาก TB/P&L ทั้งสอง scope). Period guard ตรวจ AccountingPeriod ของฝั่งนั้น.
- **Custom income whitelist ต่อ scope** (V17): FINANCE `custom_income_accounts_whitelist`
  default `["53-1103","53-1104"]` (แก้ B1 — OT = 53-1103 ค่าล่วงเวลา ไม่ใช่ 53-1105
  ค่าอบรม); SHOP `custom_income_accounts_whitelist_shop` default `["S52-1202","S52-1204"]`.
  UI ดึงจาก `GET /expense-documents/payroll/meta?scope=` — เลิก hardcode.
- **V19**: รหัสรายการหักต้องมีจริงใน CoA + prefix ตรงฝั่ง (S สำหรับ SHOP).
- **กันซ้ำ**: (สาขา + งวด + ฝั่ง) ซ้ำ → reject โดย advisory lock ใน tx (ใบ VOID ไม่นับ);
  พนักงาน (userId) ซ้ำแถวในใบเดียว → reject + DB unique `(payroll_id, user_id)`.
- **สิทธิ**: อนุมัติก่อนจ่ายผ่าน `approval_enabled` + `approval_required_doc_types`
  (default `['PAYROLL']`) + `approvers_list`; ฟอร์มเปลี่ยนปุ่มเป็น "บันทึก & ส่งขออนุมัติ".
  เห็นเงินเดือนข้ามสาขา: เฉพาะ CROSS_BRANCH_ROLES — `GET /expense-documents/:id`
  บังคับ branch scope แล้ว (BM เห็นเฉพาะสาขาตัวเอง).
- **ภ.ง.ด.1** (`previewPayrollWHT` เขียนใหม่ 2026-08-06): อ่านจากเอกสาร PAYROLL ที่
  POSTED โดยตรง (ไม่ใช่เดิน JE 21-3101) → พนักงานภาษี 0 ปรากฏครบ, ใบ VOID หลุดออก
  อัตโนมัติ, gross = ฐาน + Σ customIncome(isTaxable). `finance-tax` WHT_PND1_ACCOUNTS
  รวม `S21-3101` (นิติบุคคลเดียว ยื่นรวม). หน้าจอ `/finance/wht-report` ต่อ route แล้ว.
- **Wipe**: `npm --prefix apps/api run wipe:payroll` (DRY_RUN + guards ชุดเดียวกับ
  wipe-accounting) — ล้างใบเงินเดือนเก่าที่ลงผิดผังทั้งหมดตามคำสั่งเจ้าของ.
- **รอบ 2-3 (2026-08-06 "ทำเลยสิ") — เสร็จแล้ว**
  (spec: `docs/superpowers/specs/2026-08-06-payroll-round2-3-design.md`):
  - **นำส่ง per-book (D1)**: `PayrollRemittanceTemplate` — SSO `Dr <sso_employee>
    + Dr <sso_employer> / Cr <cash ฝั่งนั้น>`, PND1 `Dr <wht_payroll> / Cr <cash>`;
    ยอด = Σ PayrollLine ของใบ POSTED ในงวด+ฝั่ง (ตรงแบบยื่น), guard GL คุ้มยอด +
    idempotency `sso-remit:<scope>:<period>` / `pnd1-remit:...` + period-open ที่วันจ่าย.
    จ่ายรวมฝั่งเดียว = ต้องมีบัญชี interco ฝั่ง SHOP → **CPA ตอบแล้ว 2026-08-24 (ข้อ A1+C5):
    เปิด `S21-1104` เจ้าหนี้ FINANCE + "ต้องแยกบันทึก เพราะเป็นค่าใช้จ่าย SHOP"** (ยังไม่แก้โค้ด).
    ⚠️ คำตอบ C5 อ่านได้ 2 ทาง — (ก) ห้ามจ่ายรวม ต้องแยกจ่าย vs (ข) จ่ายรวมได้ แต่ค่าใช้จ่าย
    ต้องลงสมุด SHOP โดยมี S21-1104 เป็นสะพาน. เราอ่านว่า (ข) ("แยก**บันทึก**" ไม่ใช่ "แยก**จ่าย**")
    **แต่ต้องยืนยันก่อนเขียนโค้ด** เพราะถ้าเป็น (ก) แปลว่าไม่ต้องแก้อะไรเลย — ห้ามเดา JE. Endpoints `POST /tax/payroll-remit/{sso,pnd1}`
    (OWNER/FM), UI ปุ่มนำส่งบน `/finance/sso-report`.
  - **สปส.1-10**: `GET /tax/sso-1-10-preview` + XLSX `form=SSO110` + หน้า
    `/finance/sso-report` (เฉพาะแถว ssoEmployee > 0, นายจ้าง = ลูกจ้างตามกฎหมาย).
  - **ภ.ง.ด.1ก + 50 ทวิ**: `GET /tax/pnd1-annual-preview?year` (group ต่อคนทั้งปี,
    gross รวมรายได้พิเศษที่เสียภาษี, + `annualWageTotal` อ้างอิง กท.20ก) + XLSX
    `form=PND1A` + หน้า `/finance/wht-annual` พิมพ์ใบ 50 ทวิ ต่อคน (ผู้จ่าย =
    FINANCE CompanyInfo — นิติบุคคลจดทะเบียนเดียว).
  - **แก้ไขร่าง (R3-2)**: `PATCH /expense-documents/:id/payroll` — DRAFT เท่านั้น,
    validator ชุดเดียวกับ create (`preparePayrollInput` shared), dup-งวด guard
    ยกเว้นตัวเอง, ลบ+สร้าง PayrollDetail ใหม่ (pattern interco updateBatch).
  - **คัดลอกงวดก่อน (R3-1)**: ปุ่มในฟอร์ม — client ดึงใบล่าสุดของสาขา (findOne)
    มาเติมทั้ง scope+lines; server re-validate ทุกอย่างตอนบันทึกตามปกติ.
  - **ไฟล์โอนธนาคาร (R3-3)**: `GET /expense-documents/:id/bank-transfer.csv`
    (จาก `EmployeeProfile.bankName/bankAccountNo`; แถวไม่มีข้อมูล → ข้าม +
    `X-Skipped-Lines`).
  - **WHT แนะนำ (R3-4)**: `apps/web/src/utils/pit-withholding.ts` — ขั้นบันได ม.48
    + ลดหย่อนมาตรฐาน (ส่วนตัว 60k, ค่าใช้จ่าย 50%≤100k, ปกส.จริง) — **advisory
    เท่านั้น** แสดงใต้ช่อง WHT กดใช้ได้ ไม่ block.
  - **CI**: เพิ่ม step `Test Web` (เทสต์ web ไม่เคยรันใน pipeline ใดมาก่อน).
- **คำตัดสินเจ้าของ 2026-08-06 (ปิดประเด็น — อย่าเสนอซ้ำ)**:
  - ส่งสลิปให้พนักงานทาง LINE/email — **ไม่ทำ** (เจ้าของ: "ไม่ต้องส่ง"; พิมพ์สลิป
    กระดาษจาก PaymentVoucherPage ตามเดิม)
  - PDPA retention `payroll_lines` — **ไม่ลบทิ้ง** (เจ้าของ: เก็บถาวร; สอดคล้อง
    พ.ร.บ.การบัญชี เก็บเอกสาร ≥5 ปี — ไม่ต้องสร้าง retention cron)
- **ยังค้างจริง**: กท.20ก แบบฟอร์มเต็ม (มี annualWageTotal อ้างอิงแล้ว),
  จ่ายนำส่งรวมฝั่งเดียว (**CPA ตอบแล้ว 2026-08-24 ข้อ A1+C5 — เปิด `S21-1104` เจ้าหนี้ FINANCE +
  "ต้องแยกบันทึก เพราะเป็นค่าใช้จ่าย SHOP"; ยังไม่แก้โค้ด และยังต้องยืนยันว่า C5 หมายถึง
  "แยกจ่าย" หรือ "แยกบันทึก"** — ดู `docs/accounting/cpa-answers-2026-08-24.md`).

## SSO accounts (P0-3 — Fix Report v1.0)

Payroll JE splits employee deduction + employer contribution into dedicated payables instead of lumping into 21-1104 ("เจ้าหนี้ค่าใช้จ่ายกิจการ"). This keeps the Trial Balance for 21-1104 = real AP and makes สปส.1-10 filing trivial.

| Account | Side | Used for |
|---|---|---|
| **21-3105** | Cr | เงินสมทบประกันสังคม-พนักงานค้างนำส่ง (5% deduction from employee) |
| **21-3106** | Cr | เงินสมทบประกันสังคม-นายจ้างค้างนำส่ง (5% employer match, capped 750/person) |
| **53-1102** | Dr | เงินสมทบประกันสังคม (นายจ้าง) — the employer-side expense |

Thai SSO law mandates identical 5% contributions from both sides (cap 750/person/month), so `payroll.template.ts` reuses the per-line `ssoEmployee` value for the employer side. If rates ever diverge, add an `ssoEmployer` column to `PayrollLine`.

Legacy data migration (one-time): `apps/api/prisma/migrations-manual/2026-05-11-reclassify-sso-21-1104-to-21-3105.sql` — idempotent reclassification of historical Cr 21-1104 PAYROLL lines into 21-3105.

---

## ใบลดหนี้ตอน void ใบเสร็จ — หนึ่งใบต่อหนึ่งใบเสร็จ (2026-08-18)

ใบเสร็จค่างวดของ FINANCE พิมพ์หัวเอกสารว่า **"ใบเสร็จรับเงิน / ใบกำกับภาษี"** เมื่อมี VAT
(`receipt-pdf.service.ts`) ⇒ การยกเลิกมันต้องมี **ใบลดหนี้ตาม ม.86/10** คู่เสมอ.

`ReceiptVoidService.voidReceipt` ยกเลิก **ทั้งงวด** (un-pay semantics 2026-07-08): ใบที่ผู้ใช้กด
+ ใบพี่น้องทุกใบที่ผูก `paymentId` เดียวกัน (`INSTALLMENT_MONEY_RECEIPT_TYPES`). ก่อน 2026-08-18
มันออกใบลดหนี้ให้ **เฉพาะใบที่กด** — งวดที่แบ่งจ่าย 1,771 + 2,000 จึงยกเลิกเงิน 3,771 โดยมี
ใบลดหนี้แค่ 2,000 (พบบน prod สัญญา TEST-20260809-004 งวด 4). **ฝั่ง GL ไม่เคยมีรู** —
`originalEntries` เป็น `findMany` ที่กลับรายการ JE ทุกใบที่ผูก `metadata.paymentId` อยู่แล้ว —
ช่องว่างอยู่ที่ **เอกสาร** ล้วน ๆ.

ตอนนี้ลูปเดียวกับที่ void ใบพี่น้องสร้าง `Receipt{ receiptType: 'CREDIT_NOTE',
amount: <ยอดของใบนั้น>, voidedReceiptId: <ใบนั้น> }` ให้ทุกใบ (ตั้งแต่ PR3 คัดลอกมูลค่า/VAT/ค่าปรับ/ปัดเศษ/เงินรับล่วงหน้าของใบนั้นด้วย —
ดู "ใบกำกับภาษีตามบัญชี"), เลขที่ผ่าน
`ReceiptNumberService` ตัวเดิม (advisory lock เดียวกัน). AuditLog `RECEIPT_VOID` เพิ่มฟิลด์
`newValue.siblingCreditNoteNumbers: string[]`. **Invariant: Σ ยอดใบลดหนี้ = Σ ยอดใบเสร็จที่ถูก
ยกเลิกในรอบนั้นเสมอ** — เทสต์ปักไว้ที่ `receipt-void.sibling-credit-note.spec.ts`.

> Forward-only: ใบเสร็จที่ถูก void **ก่อน** 2026-08-18 และไม่มีใบลดหนี้คู่ ไม่มีสคริปต์ backfill
> (ออกใบลดหนี้ย้อนหลังคือการออกเอกสารภาษีใหม่ ต้องให้ CPA เคาะ). เคสที่รู้ตัวแล้ว 1 เคส:
> TEST-20260809-004 งวด 4 ขาดใบลดหนี้ของ RT-202608-00006 (1,771฿) — เป็นสัญญาทดสอบ.

### ยกเลิกใบเสร็จของงวดที่รับเงินก่อนครบกำหนด — กลับรายการตั้งลูกหนี้งวดด้วย (คำตอบฝ่ายบัญชี 2026-09-29)

คำตอบของฝ่ายบัญชี 29/09/2569 (เอกสารขอคำวินิจฉัยเล่ม 1 ข้อ 4 — ทางเลือก 1): ยกเลิกใบเสร็จของงวดที่รับเงินก่อนครบกำหนด
ให้กลับรายการรับชำระ **และกลับรายการตั้งลูกหนี้งวดด้วย** — ดอกเบี้ยและภาษีขายของงวดกลับไปเป็นรายการรอตัดบัญชี
แล้วตั้งใหม่ในวันที่รับเงินครั้งถัดไปหรือวันครบกำหนด แล้วแต่วันใดถึงก่อน.

โค้ด: ข้อ 1 ตัดสินที่ `ReceiptVoidService.voidReceipt` (คำนวณ `survivingPaid` จาก `reconstructPriorCleared`
หลังกลับรายการรับชำระทุกใบของงวด แล้วเรียก template เฉพาะเมื่อ `survivingPaid ≤ 0`) · ข้อ 2–3 และด่านกันกลับซ้ำ
อยู่ที่ `ReceiptVoidReversalTemplate.voidAccrualPostedAtReceipt` — เรียกหลังคืนสถานะแถวงวด ในธุรกรรมเดียวกัน.

**กลับเมื่อครบสามข้อ:**
1. การยกเลิกทำให้งวด**ไม่เหลือการรับชำระที่มีผล** (`survivingPaid ≤ 0` — การยกเลิกใบเดียวคือการยกเลิกทุกใบของงวด
   แต่รายการหักเงินรับล่วงหน้าของรอบกลางคืนไม่ถูกยกเลิกไปด้วย ถ้ามีรายการนั้นถือว่างวดยังมีการชำระ)
2. รายการตั้งลูกหนี้งวดของงวด**ถูกลง ณ วันรับเงินทุกใบ** (`metadata.trigger = 'receipt'`) — ตั้งแต่ ก1 งวดหนึ่งมีได้หลายใบ
   (ใบบางส่วน `<id>:receipt-accrual:<k>` ที่ยังมีผล + ใบที่ทำให้ครบซึ่งลิงก์ชี้) · ใบที่ทำให้ครบเป็นของรอบกลางคืน
   (วันครบกำหนดถูกเลื่อนภายหลัง) = **ไม่กลับอะไรเลย รวมใบบางส่วน** (ลิงก์ต้องหมายถึง "ตั้งครบ" เสมอ)
3. **ยังไม่ถึงวันครบกำหนด** ณ วันที่ยกเลิก ตามปฏิทินไทย (`isDueDateReached` — วันครบกำหนดเอง = ถึงแล้ว
   นิยามเดียวกับที่รอบกลางคืนใช้เลือกงวด). ถึงแล้ว = กลับเฉพาะรายการรับชำระเหมือนเดิม

| เรื่อง | กติกา |
|---|---|
| บรรทัด | **กระจกของบรรทัดที่ลงไว้จริง**ของรายการ 2A เดิม — สลับ debit/credit ทีละบรรทัด ยอดมาจากสมุดบัญชี (ตัวช่วยเดียวกับรายการกลับใบรับชำระ) เรียงตามรูปที่เสนอฝ่ายบัญชี: `Dr 11-2101 · Dr 11-2105 · Dr 21-2101 · Dr 41-1101 / Cr 11-2103 · Cr 21-2102 · Cr 11-2106` คำอธิบายรายบรรทัดขึ้นต้น `[กลับรายการ]`. **การยกเลิกใบเสร็จต้องไม่ถูกหยุดเพราะยอดที่ลงไว้ต่างจากยอดที่คำนวณจากสัญญา** — `buildAccrual2AReversalLines` (ตัวสร้างเดียวกับ 2A สลับฝั่ง) ใช้ตรวจทานหลังลงเท่านั้น: ต่างกัน = รายการกลับถูกลงตามบรรทัดที่ลงไว้ + Sentry warning `[receipt-accrual-void] posted 2A lines differ from the builder — reversal mirrors the posted lines` ให้ฝ่ายบัญชีตรวจรายการ 2A ใบนั้น |
| วันที่ + งวดบัญชี | ลงวันที่ยกเลิก เหมือนรายการกลับใบรับชำระ · ด่านงวดบัญชีคือด่านเดิมของการยกเลิกใบเสร็จ (`validatePeriodOpen` ของ FINANCE ที่วันนี้ ก่อนเปิดธุรกรรม) — ภาษีขายจึงลดในเดือนที่ยกเลิก ไม่แก้ย้อนเดือนที่รับเงิน |
| metadata | `tag: 'REVERSAL'` · `flow: 'receipt-accrual-void'` · `idempotencyKey: 'receipt-accrual-void:<id ของ 2A>'` · `originalEntryId` · `originalEntryNumber` · `contractId` — **ห้ามเพิ่ม** `installmentScheduleId` / `paymentId` / `trigger` (กติกาเดียวกับหัวข้อถัดไป). `originalEntryId` **ต้องมี**: ยอดคงเหลือบนใบเสร็จ (`receipt-document-balance.ts`) ตีความรายการกลับด้วย metadata ของรายการต้นทาง |
| รายการ 2A เดิม | คง `POSTED` · ประทับ `reversed: true` + `reversedByEntryNumber` · **`reference` ไม่ถูกแก้** · หนึ่งรายการกลับต่อหนึ่งรายการ 2A เดิม ตามลำดับที่ลง |
| ตรวจทาน | เล่นซ้ำตามลำดับที่ลง: แต่ละใบเทียบกับ `buildPartialAccrual2ALines(ยอด Dr 11-2103 ของใบนั้น, ยอดที่ลงไว้ก่อนหน้าใบนั้น)` (ใบเดียวทั้งงวด = สูตรเต็มงวดเดิม) — ต่างกัน = สัญญาณเตือนเฉพาะใบนั้น ไม่หยุดการยกเลิก |
| งวด | `accrualJournalEntryId` ถูกล้าง และยอดสะสม `accruedAmount / accruedVat / accruedInterest` คืนเป็น 0 → งวดถูกตั้งลูกหนี้ใหม่ตามปกติ (ใบบางส่วน / ใบที่ทำให้ครบ / รอบกลางคืนในวันครบกำหนด) |
| `reference` ของ 2A ที่ตั้งใหม่ | `<id ของแถวตารางงวด>:re-accrual:<n>` โดย n = เลขแรก (เริ่มที่ 1) ที่ยังไม่มีรายการถืออยู่ หรือรายการที่ถืออยู่ยังมีผล (`InstallmentAccrual2ATemplate.resolveAccrualReference`) เพราะรายการเดิมยังถือ `reference` เดิมและ `journal_entries_ref_unique` ห้ามซ้ำ. **อ่านด้วยค่าเท่ากันบน `(referenceType, referenceId)` ทีละค่าเท่านั้น ห้ามค้นแบบ "ขึ้นต้นด้วย"** (ธุรกรรมของการรับชำระและรอบกลางคืนเป็น Serializable). งวดที่ไม่เคยถูกกลับได้ `reference` เดิมทุกตัวอักษร. **ผู้อ่านที่หารายการ 2A ด้วย `reference` ต้องใช้ `accrualJournalEntryId` (เลขที่รายการ) แทน** |
| audit | แถว `RECEIPT_VOID` เดิม (เขียนในธุรกรรม) เพิ่ม `newValue.accrualReversal`: `{ reversed: true, entryNos, accrualEntryNumbers }` (อาร์เรย์เรียงตามลำดับที่ลง — ก1) หรือ `{ reversed: false, reason }` หรือ `null` (การยกเลิกไม่ได้ทำให้งวดหมดการรับชำระ / ไม่มีแถวตารางงวด) |
| error ของฐานข้อมูล | ไม่ถูกแปลงใน template — การยกเลิกทำผ่านคิวอนุมัติซึ่งแปลง `P2002` / `P2034` เป็น 409 อยู่แล้ว (`payment-approval.controller.ts`) |
| สัญญาณเตือน | template ไม่เรียก Sentry เอง — คืน `warnings` แล้ว `ReceiptVoidService.voidReceipt` ส่งหลังธุรกรรม commit (`emitDeferredWarnings`) · การยกเลิกที่ล้มไม่ทิ้งสัญญาณ |

**ตัวเลขทอง (สัญญา 17,000 / 12 งวด):** รับชำระงวด 3 เต็มงวดก่อนครบกำหนด แล้วยกเลิกใบเสร็จก่อนครบกำหนด →
รายการกลับใบรับชำระ `Dr 11-2103 1,515.83 / Cr เงินสด 1,515.83` + รายการกลับรายการตั้งลูกหนี้งวด
`Dr 11-2101 1,416.66 · Dr 11-2105 99.17 · Dr 21-2101 99.17 · Dr 41-1101 500.00 / Cr 11-2103 1,515.83 ·
Cr 21-2102 99.17 · Cr 11-2106 500.00` (รวม 2,115.00) ⇒ ทุกบัญชีของงวดเท่ากับก่อนรับเงิน. ถึงวันครบกำหนดรอบกลางคืน
ตั้งลูกหนี้งวดใหม่ 1 รายการ `reference = <id>:re-accrual:1`.
**ตัวเลขทอง ก1:** รับบางส่วน 1,000 แล้ว 515.83 ก่อนครบกำหนด แล้วยกเลิกใบเสร็จก่อนครบกำหนด → รายการกลับ 2 ใบ
`Dr 11-2101 934.58 · Dr 11-2105 65.42 · Dr 21-2101 65.42 · Dr 41-1101 329.85 / Cr 11-2103 1,000.00 · Cr 21-2102 65.42 ·
Cr 11-2106 329.85` (1,395.27) และ `Dr 11-2101 482.08 · Dr 11-2105 33.75 · Dr 21-2101 33.75 · Dr 41-1101 170.15 /
Cr 11-2103 515.83 · Cr 21-2102 33.75 · Cr 11-2106 170.15` (719.73) ⇒ ทุกบัญชีของงวดเท่าก่อนรับเงิน · ยอดสะสม 0 ·
ถึงวันครบกำหนดรอบกลางคืนตั้งทั้งงวดใหม่ `reference = <id>:re-accrual:1` · รับบางส่วนใหม่หลังยกเลิก → `<id>:receipt-accrual:2`.
Tests: `journal/receipt-accrual-void.spec.ts` · `receipts/services/receipt-void.accrual-reversal.spec.ts` ·
`payments/services/accrue-at-receipt.integration.spec.ts` ("ยกเลิกใบเสร็จของงวดที่ตั้งลูกหนี้ ณ วันรับเงิน").

**ที่ยังเปิดอยู่:**
- **เส้นทางคืนเงิน (`RefundsService.markReversed`) ไม่ถูกแก้** — กลับเฉพาะรายการรับชำระและตั้งงวดเป็น `PENDING` โดยไม่ดู
  วันครบกำหนดและไม่กลับรายการตั้งลูกหนี้งวด ⇒ คืนเงินของงวดที่รับเงินก่อนครบกำหนด เหลือลูกหนี้งวดค้างเต็มงวดก่อนถึงกำหนด
  พร้อมดอกเบี้ยและภาษีขายที่รับรู้ไปแล้ว. รอฝ่ายบัญชีว่าจะให้ทำแบบเดียวกับการยกเลิกใบเสร็จหรือไม่
- ~~`TaxPreviewService.previewPP30` รวมเฉพาะบรรทัดเครดิตของ 21-2101 จึงไม่เห็นรายการกลับ~~ — **ปิดแล้ว** (ขึ้น prod พร้อมกันใน
  26.10.1): ผู้ใช้ตัวเลขภาษีขาย ภ.พ.30 ทุกตัวเรียก `computePp30OutputVat` = 21-2101 **สุทธิ** ⇒ รายการกลับรายการตั้งลูกหนี้งวด
  (`tag: 'REVERSAL'`) ลดภาษีขายของเดือนที่ยกเลิก และแสดงเป็น "กลับรายการ" ในรายละเอียด — หัวข้อ "ภ.พ.30 — ภาษีขายคำนวณที่เดียว"

### รายการกลับรายการผูกกับสัญญา (คำตัดสินฝ่ายบัญชี 2026-09-28)

`ReceiptVoidReversalTemplate` (ผู้เรียก 2 ราย: ยกเลิกใบเสร็จ flow `receipt-void`, คืนเงิน flow
`refund-reversal`) copy **`contractId` อย่างเดียว** จากรายการเดิมลงรายการกลับรายการ — เพื่อให้
`glContractBalance` (JP5 / ตัดหนี้สูญ / ด่านเปลี่ยนเครื่อง / ด่านถังพักของ JP4) หักยอดของใบที่ยกเลิกแล้ว.

- **ห้าม copy** `paymentId`, `installmentScheduleId`, `tag`, `flow`, `idempotencyKey`, `deltaApplied`,
  `principalCleared`, `lateFeePortion`, `genericConsume`, `parkConsume` — ผู้อ่านใบรับชำระ
  (`reconstructPriorCleared`, `loadLateFeePaidByPaymentIds`, void/refund matcher) จะเข้าใจผิดว่าเป็นใบรับชำระ
- ผู้กวาดรายการตามสัญญา**ต้องข้ามทุกรายการที่ `tag === 'REVERSAL'`** —
  `DefectExchangeReversalTemplate` เคยข้ามเฉพาะ 2 flow และจะ mirror `refund-reversal` ซ้ำ (แก้แล้วรอบเดียวกัน)
- แถวเดิมเติมด้วย migration `20261013000000_backfill_reversal_contract_id`
- ผลที่เห็นได้: หลังยกเลิกใบเสร็จ ด่านเปลี่ยนเครื่องเห็น 11-2103 ค้างและบล็อก "มีงวดค้างชำระ" (ถูกต้อง)

## สรุปรายวัน = เงินสดที่รับจริง (receipt-based, 2026-08-18)

`GET /payments/daily-summary` อ่านจาก **`Receipt`** ไม่ใช่ `Payment` — หนึ่งแถว = หนึ่งใบเสร็จ,
ยอด = `Receipt.amount` (เงินที่รับจริง). เดิมอ่าน `Payment.amountPaid` ซึ่งคือ **ยอดที่ตัดหนี้งวด
ได้** คนละตัวกับเงินสดทุกครั้งที่มีเครดิต 21-1103 เข้ามาเกี่ยว: จ่าย 3,800 บนงวด 3,671 + ค่าปรับ
100 → `amountPaid = 3,771` ส่วนเกิน 29 เข้า advance; งวดถัดไปจ่ายสด 3,742 แล้วดูดเครดิต 29
→ `amountPaid = 3,771` อีก. ทั้งวันยอดรวมบังเอิญตรง แต่ทุกแถวผิด.

ผลพลอยได้ที่หายไปพร้อมกัน (ไม่ต้องเขียนโค้ดเพิ่ม — เปลี่ยนแหล่งข้อมูลแล้วหายเอง):

| อาการเดิม | สาเหตุ |
|---|---|
| จ่ายบางส่วนไม่โผล่ในวันที่รับเงิน แล้วไปโผล่ก้อนเดียวในวันปิดงวด | `Payment.paidDate` เซ็ตเฉพาะตอน `isPaidInFull` |
| งวดเดียวหลายใบเสร็จยุบเป็นแถวเดียว ⇒ "จำนวนรายการ" ต่ำกว่าจริง | หนึ่งแถว = หนึ่ง `Payment` |
| เงินดาวน์ / ปิดยอด / ค่าปรับดิว ไม่ปรากฏเลย | ไม่มี `Payment.paidDate` ของตัวเอง |
| การ์ด "แยกตามวิธี" ไม่ตรงกับ "ยอดรวม" เมื่อวันนั้นเกิน 50 รายการ | byMethod บวกจาก **หน้าปัจจุบัน**, ยอดรวมมาจาก aggregate ⇒ ตอนนี้ใช้ `groupBy` ทั้งวัน |

ขอบเขต: ไม่รวมใบที่ `isVoided` และไม่รวม `CREDIT_NOTE` (ใบลดหนี้ถือยอด **บวก** ของใบเดิม
นับเข้าไปจะกลายเป็นคูณสอง ไม่ใช่หักล้าง) — นิยามเดียวกับ `computeCumulativePaid` ที่การ์ด
"ยอดชำระสะสม" ในหน้าประวัติใช้อยู่แล้ว ⇒ สองหน้าตรงกันโดยโครงสร้าง. **การ void จึงแก้ย้อนวัน
ที่ผิด** ซึ่งเป็นสิ่งที่ต้องการ และเป็นจริงอยู่แล้วไม่ว่าจะทำแบบไหน เพราะใบเสร็จที่ออกใหม่ถูกลง
วันที่รับเงินจริง (D4) ไม่ใช่วันที่คีย์.

`totalLateFees` = Σ ค่าปรับ **สุทธิ** (gross − waived) ของงวดที่ **แตกต่างกัน** ที่มีใบเสร็จในวันนั้น
— ค่าปรับอยู่ระดับงวด ไม่ใช่ระดับใบเสร็จ จึงนับครั้งเดียวแม้งวดนั้นจะแบ่งจ่ายสองใบ. Index รองรับ:
`receipts(paid_date, is_voided)` (migration `20260993000000_receipt_paid_date_index`).

## ห้ามข้ามงวด — บันทึกชำระตามลำดับงวดเท่านั้น (คำสั่งเจ้าของ 2026-08-19)

กติกา: **บันทึกรับชำระได้เฉพาะงวดค้างที่เก่าที่สุดของสัญญา** ("earliest unpaid") —
ไม่ใช่ "งวดที่จ่ายล่าสุด + 1" ซึ่งต่างกันตอน void: void งวด 2 ขณะ 3-6 จ่ายแล้ว ⇒
งวด 2 กลับเป็น earliest unpaid และจ่ายซ้ำได้ (flow "void → เปิด wizard งวดเดิม" พึ่งข้อนี้).

Single source of truth: `assertSequentialInstallment` ใน
`apps/api/src/modules/payments/services/installment-sequence.util.ts`
(unpaid = `PENDING/OVERDUE/PARTIALLY_PAID` — งวดก่อนหน้าที่ PARTIALLY_PAID ต้องปิดก่อน).

| จุดบังคับ | ที่ | หมายเหตุ |
|---|---|---|
| บันทึกชำระ (ทุกเส้นทาง) | `PaymentReceiptOrchestrator.recordPayment` — ในตัว serializable tx | ครอบ wizard / batch / draft-post / CSV import (ไฟล์ที่เรียงงวดมาแล้วผ่านปกติ แถวที่ข้ามงวด fail รายแถวพร้อมข้อความไทย) |
| ส่ง QR | `POST /payments/:id/partial-qr` (`assertSequentialByPaymentId`) | กันตั้งแต่ตอนส่ง เพราะ… |
| **Webhook PaySolutions** | **BYPASS** (`enforceSequence=false`) | เงินถูกตัดที่ gateway แล้ว — ปฏิเสธการบันทึก = เงินจริงค้างเติ่ง (handler ตอบ 200 ไม่ retry) จึงบังคับที่ตอนส่ง QR แทน |
| UI คิวรอชำระ | `getPendingPayments` ส่ง `hasEarlierUnpaid` ต่อแถว (คำนวณจาก DB ทั้งสัญญา ไม่ใช่แค่หน้าที่เห็น — งวดค้างอาจอยู่นอก filter ช่วงวันที่) | ปุ่มรับชำระ + checkbox batch ถูก disable พร้อม tooltip |

เส้นทางที่ **ไม่**เข้าข่ายโดยธรรมชาติ: `autoAllocatePayment` / `applyCreditBalance` (FIFO อยู่แล้ว),
early payoff (JP4 — ปิดทุกงวด), reschedule (เลื่อนดิว ไม่ใช่บันทึกชำระ; 6b bundled จ่ายผ่าน
orchestrator จึงโดน guard ตามปกติ). Tests: `installment-sequence.util.spec.ts`,
`pending-sequence-flag.spec.ts`, `PaymentTable.sequence.test.tsx`.

## ตั้งลูกหนี้งวด ณ วันรับเงิน (คำตัดสินฝ่ายบัญชี D2 "ทางเลือก ก" — 2026-09-28 · ตั้งเท่ายอดที่รับ ก1 "แบบ ข" — 2026-09-29)

Spec: `docs/superpowers/specs/2026-09-28-accounting-review-fixes-design.md` ข้อ 5.3 + คำตอบฝ่ายบัญชี ก1 (29/09/2569) ·
Plans: `docs/superpowers/plans/2026-09-29-acct-review-pr2-accrue-at-receipt.md` ·
`docs/superpowers/plans/2026-09-30-acct-review-pr2b-proportional-accrual.md`

**ปัญหาเดิม:** ใบรับชำระเครดิต 11-2103 ทันที แต่รายการตั้งลูกหนี้งวด (2A) ลงโดยรอบกลางคืน ณ วันครบกำหนดเท่านั้น
และรอบกลางคืนข้ามสัญญาที่ปิดแล้ว ⇒ งวดที่จ่ายล่วงหน้าแล้วสัญญาปิดก่อนถึงกำหนด (ยึดคืน / ตัดหนี้สูญ / ปิดยอดก่อนกำหนด /
จ่ายครบทุกงวดล่วงหน้า) ไม่เคยถูกตั้งลูกหนี้ — ดอกเบี้ยและภาษีขายของงวดนั้นไม่ถูกรับรู้ และ 11-2103 ค้างติดลบ.

**คำตอบฝ่ายบัญชี ก1 (29/09/2569 — เลือก "แบบ ข" จากตัวอย่างงวด 6,078.67 รับ 3,000):** รับเงินบางส่วนก่อนวันครบกำหนด →
ตั้งลูกหนี้งวดเท่ายอดที่รับ ณ วันรับเงิน · ส่วนที่เหลือตั้งโดยใบที่ทำให้งวดชำระครบ (ถ้าก่อนวันครบกำหนด) หรือโดยรอบกลางคืน
ณ วันครบกำหนด.

**กติกา:**

| เรื่อง | กติกา |
|---|---|
| เมื่อไร | ใบรับชำระของงวดที่ยังตั้งลูกหนี้งวดไม่ครบ (`InstallmentSchedule.accrualJournalEntryId` ว่าง) ของสัญญาในสถานะที่รอบกลางคืนดูแล — ลง 2A ก่อนใบรับชำระ ใน**ธุรกรรมเดียวกัน** เมื่อ (ก) ใบนี้**ทำให้งวดชำระครบ** → ตั้ง**ส่วนที่เหลือของงวด** (ยังไม่เคยตั้ง = ทั้งงวด) หรือ (ข) ใบนี้เป็น**ใบบางส่วนก่อนวันครบกำหนด** (ปฏิทินไทย ณ วันที่รับเงิน) และล้างลูกหนี้ของงวด > 0 → ตั้ง**เท่ายอดที่รับ**. กติกาอยู่ที่ฟังก์ชันเดียว `decideAccrueAtReceipt` (`journal/accrue-at-receipt-decision.ts` — ลำดับ: ตั้งครบแล้ว > สถานะที่ไม่ดูแล > ใบที่ทำให้ครบ > ถึงวันครบกำหนด/ไม่ได้ล้างลูกหนี้ > ตั้งเท่ายอดที่รับ) ซึ่ง template และ preview ถามตัวเดียวกัน |
| "ชำระครบ" | ครบสองข้อ: หลังใบนี้ยอดลูกหนี้ของงวดในบัญชีเป็นศูนย์ (`split.principalRemainingAfter`) **และ** ใบนี้คือใบที่ทำให้แถวงวดเป็น `PAID` (`isFinalReceipt`). ไม่ตัดสินจาก `Payment.status` หรือยอดเรียกเก็บ. นับเป็นครบ: จ่ายครบพอดี · เศษไม่เกิน 1 บาท (53-1503 / 52-1104) · หักเงินรับล่วงหน้าในใบเดียวกัน · ใบหลังที่จ่ายส่วนที่เหลือ · ใบที่จ่ายเฉพาะเศษของยอดเรียกเก็บหลังลูกหนี้ในบัญชีถูกล้างครบไปแล้ว (ถ้างวดยังตั้งไม่ครบ) |
| "ยอดที่รับ" | `split.principalCleared` — ยอดที่ใบนี้เครดิต 11-2103 ของงวด: **ไม่รวม** ค่าปรับ 42-1103 · กำไรปัดเศษ 53-1503 · เงินที่พักเป็นเงินรับล่วงหน้า 21-1103 · **รวม** เงินรับล่วงหน้า/เครดิตที่หักเข้าใบนี้. ยอดที่รับถึงส่วนที่เหลือของงวด (เช่น ยอดเรียกเก็บ 1,516.00 รับ 1,515.83 แบบบางส่วน) = ตั้งส่วนที่เหลือทั้งหมดและงวดตั้งครบ |
| สูตร (ก1) | ภาษีขาย = HALF_UP(ยอดที่รับ × 7/107) · มูลค่า = ยอดที่รับ − ภาษีขาย · ดอกเบี้ย = HALF_UP(ดอกเบี้ยของงวด × มูลค่า ÷ มูลค่าของงวด) · แต่ละบัญชีไม่เกินส่วนที่ยังไม่ได้ตั้ง · **ส่วนที่เหลือ = ยอดของงวด − ยอดที่ตั้งไปแล้ว ทีละบัญชี** (รายการสุดท้ายรับเศษ ยอดรวมเท่างวดพอดี). ฟังก์ชันบริสุทธิ์ `buildPartialAccrual2ALines` / `buildRemainderAccrual2ALines` คู่กับ `buildAccrual2ALines` (`journal/build-accrual-2a-lines.ts`) — ใช้ร่วมกันโดย template, รอบกลางคืน, preview และการตรวจทานตอนกลับรายการ |
| ใบบางส่วนตั้งแต่วันครบกำหนด | งวดยังตั้งไม่ครบ (รอบกลางคืนตกหล่น) + ใบนี้ยังไม่ทำให้ครบ → ลงใบรับชำระ ไม่ลง 2A (พฤติกรรมเดิม) — รอบกลางคืนตั้งส่วนที่เหลือ. ไม่มีสัญญาณเตือน (ถอด `accrue-at-receipt-skipped-partial` แล้ว) |
| สถานะสัญญา | รายการสถานะที่ไม่ตั้งลูกหนี้งวดประกาศที่เดียว: `ACCRUAL_EXCLUDED_CONTRACT_STATUSES` (`journal/accrual-contract-status.ts` — `TERMINATED` `CLOSED_BAD_DEBT` `COMPLETED` `EARLY_PAYOFF` `EXCHANGED` `DEFECT_EXCHANGED` `DRAFT` `CANCELED`; สองตัวหลังเพราะสัญญาร่างยังไม่เปิดใช้ (ไม่มี 1A) และสัญญาที่ยกเลิกถูกย้อนรายการแล้ว) ใช้ทั้งรอบกลางคืนและจุดเกี่ยวตอนรับเงิน. ตัดสินจาก**สถานะก่อนรับเงิน** (`contractStatusBeforeReceipt`) — ผู้เรียกที่ไม่ส่งค่า = ใช้สถานะปัจจุบันของสัญญา · webhook PaySolutions อ่านสถานะ**ในธุรกรรมของตัวเอง**หลังได้สิทธิ์ลิงก์. สถานะอยู่ในรายการ → ลงใบรับชำระตามเดิม **ไม่ลง 2A** (ทั้งใบที่ทำให้ครบและใบบางส่วน) + Sentry warning (tag `action: 'accrue-at-receipt-skipped-status'`) ที่ส่ง**หลังธุรกรรม commit** |
| จุดเกี่ยว | `PaymentReceiptTemplate.execute` จุดเดียว — หลังด่านของ template และ `splitReceipt` ก่อนลงใบรับชำระ (ใบที่ถูกด่านปฏิเสธไม่ทิ้ง 2A ไว้) → `InstallmentAccrual2ATemplate.accrueAtReceipt(id, วันที่รับเงิน, tx, ยอดที่รับ?)` (ไม่ส่งยอด = ส่วนที่เหลือ). ครอบ บันทึกรับชำระ · QR ของหน้ารับชำระ · auto-allocate · ใช้เครดิต · webhook PaySolutions · เครื่องมือ backfill (ใบบางส่วน วันที่ = ตอนที่รัน). **เส้นทางรับเงินค่างวดใหม่ต้องลงใบรับชำระผ่าน template นี้ และส่ง `contractStatusBeforeReceipt`** ห้ามลง `Cr 11-2103` เอง |
| วันที่ลง 2A | `min(วันครบกำหนด, วันที่รับเงิน)` (`resolveAccrualPostingDate`) — ทุกรายการลงวันที่ของ**ใบที่ทำให้เกิดรายการนั้น** (ใบบางส่วน = วันที่รับเงินของใบนั้นเสมอ เพราะก่อนวันครบกำหนดโดยนิยาม) · งวดที่ถึงกำหนดไปแล้วแต่รอบกลางคืนตกหล่น = วันครบกำหนด. "วันที่รับเงิน" = `postedAt` ที่ผู้เรียกส่ง: หน้าจอ = วันที่ที่พนักงานเลือก · ใช้เครดิต / auto-allocate / webhook / QR = เวลาที่ทำรายการนั้น |
| สถานะของงวด | คอลัมน์ `InstallmentSchedule.accruedAmount / accruedVat / accruedInterest` (Decimal(12,2) NOT NULL DEFAULT 0 — migration `20261014000000_installment_schedule_accrued_amounts`) = ยอดที่ตั้งไปแล้ว เขียนในธุรกรรมเดียวกับทุกรายการ 2A แบบ compare-and-set (ต้องยังไม่มีลิงก์ และ `accruedAmount` ต้องเท่ากับยอดที่รายการนั้นใช้คำนวณ — ไม่ตรง = P2025 ธุรกรรมล้ม). **`accrualJournalEntryId` = "ตั้งครบแล้ว"** — ประทับโดยรายการที่ทำให้ยอดสะสมเท่ายอดของงวด ผู้อ่านเดิมทุกรายจึงถูกต้องตามเดิม. แถวที่ตั้งครบก่อนมีคอลัมน์เก็บ 0 — ผู้อ่านต้องอ่านลิงก์ก่อน (ใช้คอลัมน์เฉพาะเมื่อลิงก์ว่าง) · **คอลัมน์ที่ไม่ได้เลือกมาไม่ถูกอ่านเป็น 0**: `accruedSoFarOf` throw เมื่อคอลัมน์ใดเป็น `undefined`/`null` ⇒ ผู้อ่านใหม่ที่ใช้ `select` ต้องเลือกลิงก์ + สามคอลัมน์ (และ mock ของเทสต้องมีครบ) |
| reference | รายการที่ทำให้งวดตั้งครบ: `<id>` หรือ `<id>:re-accrual:<n>` (เดิม) · รายการบางส่วน: `<id>:receipt-accrual:<k>` โดย k = เลขแรก (เริ่มที่ 1) ที่ยังไม่มีรายการถือ — ใบที่ถูกกลับยังถือ reference ของตัวเอง. อ่านด้วยค่าเท่ากันทีละค่าเท่านั้น (ห้าม `startsWith` / `contains` ในธุรกรรม Serializable) · สองใบที่ลงพร้อมกันได้ k เดียวกัน → unique index `journal_entries_ref_unique` กัน |
| แกนอย่างเดียว | 2A ตอนรับเงิน (ทุกแบบ) **ไม่หักเงินรับล่วงหน้า** (ถังรวม/ถังพัก) และ**ไม่แตะแถว Payment** |
| metadata | `tag: '2A'` + `trigger: 'receipt'` + `receiptDate` (ISO) · รายการบางส่วน `portion: 'partial'` · ส่วนที่เหลือของงวดที่เคยตั้งบางส่วน `portion: 'remainder'` (ทั้งงวดในรายการเดียว = ไม่มีคีย์ — เหมือนเดิมทุกตัวอักษร) · **ไม่มี `paymentId`**. ใบรับชำระที่ทำให้ลง 2A จดเลขที่ไว้ใน `metadata.accrualEntryNumber` (ให้เอกสาร/รายงานภาษีขายต่อใบเสร็จอ่านยอดจากสมุดบัญชี) |
| งวดบัญชี | ตรวจงวดของ FINANCE ด้วยวันที่จาก `resolveAccrualPeriodCheckDate(วันครบกำหนด, วันที่รับเงิน)` — เมื่อ 2A ลงวันเดียวกัน (ปฏิทินไทย) กับใบรับชำระ ใช้**ค่าเวลาเดียวกับที่เส้นทางรับชำระส่งให้ `validatePeriodOpen`** จึงตัดสินงวดเดียวกันเสมอ. ปิดแล้ว = ปฏิเสธการรับชำระทั้งรายการ (รวมใบบางส่วน) ข้อความบอก**เฉพาะเดือนที่ปิด** และให้ติดต่อฝ่ายบัญชี. auto-allocate และใช้เครดิตไม่เคยมีด่านงวดบัญชีมาก่อน — ได้ด่านนี้เมื่อเงินทำให้เกิดรายการ 2A |
| สัญญาณเตือน | template ไม่เรียก Sentry จากในธุรกรรม — คืน `warnings` ให้ผู้เรียกส่งหลังธุรกรรม commit (`journal/deferred-warning.ts` `emitDeferredWarnings` · ผู้เรียก 5 จุด: `recordPayment` / `autoAllocatePayment` / `applyCreditBalance` / webhook PaySolutions / เครื่องมือ backfill) · template ที่ห่อธุรกรรมเองส่งให้เองหลัง commit. ธุรกรรมที่ล้มไม่ทิ้งสัญญาณ |
| error ของฐานข้อมูล | template **ไม่แปลง** `P2002` / `P2025` / `P2034` — ผ่านออกไปตามเดิม (template ใช้ร่วมกับ webhook ที่อาศัยคำตอบ 5xx ในการส่งซ้ำ). เส้นทางคิวอนุมัติได้ 409 (จุดแปลงเดิมของ `payment-approval.controller.ts` — `P2002` / `P2034`); เส้นทางบันทึกตรงได้ข้อความทั่วไปของระบบ (HTTP 500) แล้วบันทึกซ้ำได้ · webhook ตอบ 5xx · QR ของหน้ารับชำระกลืน error แล้วตอบ 200 |
| Forward-only | ไม่แก้รายการของสัญญาเดิม ไม่มี backfill · งวดที่รับบางส่วนก่อน deploy มียอดสะสม 0 → ใบที่ทำให้ครบ/รอบกลางคืนตั้งทั้งงวด (prod ไม่มีสัญญาที่เปิดอยู่ ณ 2026-09-29) |

**รอบกลางคืน (`installment-accrual.cron.ts`)** — การเลือกงวดไม่เปลี่ยน (เฉพาะงวดที่ลิงก์ยังว่าง):
- ลง**ส่วนที่เหลือของงวด** (ยอดของงวด − ยอดสะสม) ลงวันครบกำหนด แล้วประทับลิงก์ — งวดที่ไม่เคยรับบางส่วน = ทั้งงวดเหมือนเดิมทุกตัวอักษร
- หักเงินรับล่วงหน้าถังรวมไม่เกิน **min(ยอดที่ยังค้างบนแถว Payment `feeNettedOutstanding`, ยอดลูกหนี้ของงวดที่ยังไม่ถูกล้างในบัญชี
  = ยอดของงวด − `reconstructPriorCleared`)** — เดิมหักได้ถึงเต็มงวด ทำให้งวดที่รับบางส่วนก่อนครบกำหนดใช้เงินรับล่วงหน้าเกิน
  11-2103 ติดลบ และ `amountPaid` เกินยอดเรียกเก็บ. ชั้นที่สองจำเป็นเพราะแถว Payment วัดจากยอดเรียกเก็บ (อาจปัดเลขกลมสูงกว่ายอดในบัญชี)
  · ถังพักของงวดสุดท้ายได้ชั้นเดียวกัน (หักส่วนที่ถังรวมล้างแล้ว) — **สองถังไม่ได้ใช้สูตรเดียวกันทั้งหมด**: ถังพักมีชั้น
  "ส่วนที่ถังรวมยังไม่ได้ล้าง" เพิ่มอีกชั้น
- งวดที่ตั้งครบ ณ วันรับเงินไม่มีทางถูกลง 2A ซ้ำ · รายการสถานะที่ข้ามมาจาก `ACCRUAL_EXCLUDED_CONTRACT_STATUSES` ตัวเดียวกัน ·
  งวดที่เคยถูกกลับรายการตั้งลูกหนี้งวด (ยกเลิกใบเสร็จ) ถูกตั้งใหม่ด้วย `reference` `<id>:re-accrual:<n>`

**ตัวเลขทอง:**
- ตัวอย่างที่ฝ่ายบัญชีเลือก (งวด 6,078.67 = มูลค่า 5,681.00 (ดอกเบี้ย 2,392.00) + VAT 397.67): รับ 3,000 ก่อนครบกำหนด →
  `Dr 11-2103 3,000.00 · Dr 21-2102 196.26 · Dr 11-2106 1,180.52 / Cr 11-2101 2,803.74 · Cr 11-2105 196.26 · Cr 41-1101 1,180.52 ·
  Cr 21-2101 196.26` (Σ 4,376.78) · ส่วนที่เหลือ `3,078.67 · VAT 201.41 · มูลค่า 2,877.26 · ดอกเบี้ย 1,211.48` (Σ 4,491.56)
- สัญญา 17,000 / 12 งวด (งวดละ 1,515.83 = 1,416.66 + 99.17 · ดอกเบี้ย 500.00): รับเต็มงวดก่อนครบกำหนด → 2A ทั้งงวด (Σ 2,115.00)
  ลงวันที่รับเงิน + ใบรับชำระ ⇒ 11-2103 = 0 · รับ 1,000 ทาง QR ก่อนครบกำหนด → 2A `1,000.00 / VAT 65.42 / มูลค่า 934.58 /
  ดอกเบี้ย 329.85` (Σ 1,395.27) ⇒ 11-2103 = 0 · รับอีก 515.83 (หรือรอบกลางคืน ณ วันครบกำหนด) → ส่วนที่เหลือ
  `515.83 / 33.75 / 482.08 / 170.15` (Σ 719.73) · สามครั้ง 500 / 600 / 415.83 → `32.71/467.29/164.93` · `39.25/560.75/197.91` ·
  `27.21/388.62/137.16` · งวดสุดท้าย (1,515.87 = 1,416.74 + 99.13) รับ 1,000 → ดอกเบี้ย 329.83 · ส่วนที่เหลือ `515.87 / 33.71 / 482.16 / 170.17`
- รับบางส่วน 1,000 ขณะมีเงินรับล่วงหน้า 2,000 → วันครบกำหนด: ส่วนที่เหลือ 515.83 + หักเงินรับล่วงหน้า 515.83 ⇒ เงินรับล่วงหน้าเหลือ
  1,484.17 · แถวงวด 1,515.83 `PAID` · 11-2103 = 0 · ถ้ายอดเรียกเก็บของงวดเป็น 1,516.00: หักเท่ากัน 515.83 (ไม่ใช่ 516.00) ·
  แถวงวด 1,515.83 `PARTIALLY_PAID` ค้าง 0.17 · 11-2103 = 0
- ยอดเรียกเก็บ 1,516.00 (บัญชี 1,515.83): รับ 1,515.83 แบบบางส่วน → ตั้งเท่ายอดที่รับ = ทั้งงวด (ครบ ประทับลิงก์) · รับ 0.17 → ไม่มี 2A
  เพิ่ม · 0.17 ลง 53-1503
- สัญญาที่ถูกบอกเลิกแล้ว (`TERMINATED`) ได้รับเงินเข้างวดที่ยังไม่ตั้งลูกหนี้ → ไม่มี 2A · 11-2103 ของสัญญา = −1,515.83 (พฤติกรรมเดิม)

**ปิดยอดก่อนกำหนด (JP4):** ตั้งแต่ PR5 รายการ JP4 ล้างตามยอดในบัญชีของสัญญา (หัวข้อ "ปิดยอดก่อนกำหนด (JP4) — ล้างตามยอดในบัญชี")
— ส่วนที่ใบรับชำระบางส่วนตั้งลูกหนี้งวดไปแล้วถูกหักออกจากยอดในบัญชีอยู่แล้ว ⇒ ดอกเบี้ยและภาษีขายของส่วนนั้นไม่ถูกรับรู้ซ้ำโดยไม่ต้องคำนวณ
`accruedUnpaid` (ที่ PR2ข ใช้ก่อน PR5 — ลบแล้ว) · งวดที่ตั้งครบแล้วแต่ยังไม่ `PAID` ล้าง 11-2103 ตามยอดค้างจริง (คำตอบข้อ 5.1).
ตัวอย่าง (6 งวดค้าง ค่างวด 1,515.83 ส่วนลด 50%, งวดแรกที่ค้างตั้งไปแล้ว 1,000): ลูกค้าจ่าย **7,062.28** → เงินสดในรายการ 7,062.28 ·
ล้าง 11-2101 7,565.46 · 11-2105 529.56 · ดอกเบี้ย 2,670.15 · **52-1106 1,032.74** (ก่อน PR5: เงินสด 6,759.90 น้อยกว่าเงินที่รับ 302.38 · ก่อน PR2ข:
7,594.98 มากกว่าเงินที่รับ 532.70 และ 11-2103 ค้าง −1,000.00) — ปักที่ `accrue-at-receipt.integration.spec.ts` "ปิดยอดก่อนกำหนด (JP4) …".

**ยึดเครื่อง (JP5) / ตัดหนี้สูญ / ใบลดหนี้ / ECL:** ยังถือ "ตั้งลูกหนี้แล้ว" = ลิงก์ (ตั้งครบ) — งวดที่ตั้งบางส่วนนับเป็นงวดที่ยังไม่ตั้ง:
ส่วนที่ตั้งแล้วถูกใบรับชำระล้างไปแล้ว (รับเงินแล้ว — ไม่มีใบลดหนี้ ม.82/5 ของส่วนนั้น) · ภาษีขายของส่วนที่ยังไม่ตั้งยังอยู่ 21-2102
และ JP5/ตัดหนี้สูญกวาดเข้า 21-2101 ด้วยขา deferred ตามเดิม · ขาล้างของ JP5 อ่านยอดในบัญชีจริงจึงถูกต้องเอง ·
ECL ของสัญญา `TERMINATED` (selection `ACCRUED`) ไม่นับงวดที่ตั้งบางส่วน — ส่วนที่ตั้งแล้วไม่มียอดค้างใน 11-2103 ·
ปักที่ `accrue-at-receipt.integration.spec.ts` ("ยึดเครื่อง (JP5) หลังงวด 1 รับบางส่วน 1,000"). ผลที่เปลี่ยน (โค้ด JP5 ไม่ถูกแก้):
ยึดคืนหลังรับบางส่วนก่อนวันครบกำหนด ขาดทุนลดลงเท่ายอดที่รับ (ตัวอย่าง 17,000/12 งวด ราคาเครื่อง 5,000: 13,190.00 → 12,190.00) และ
11-2103 ไม่ค้างติดลบ −1,000 หลังยึด (เดิมขาล้าง 11-2103 ของ JP5 ข้ามยอดติดลบ) · เปลี่ยนเครื่อง (A.2) ก็ล้างตามยอดในบัญชีเช่นกัน
(ปักที่ `exchange-priced-flow.integration.spec.ts`).

**เปลี่ยนเครื่องหลังรับบางส่วน:** งวดที่รับบางส่วนก่อนวันครบกำหนดมี 11-2103 = 0 (2A เท่ายอดที่รับ + ใบรับชำระล้างเท่ากัน) ⇒
ด่าน "มีงวดค้างชำระ" ของเปลี่ยนเครื่อง (`contract-exchange.service.ts` — 11-2103 ≠ 0 ทั้งตอน preview และ finalize)
ไม่บล็อกงวดนั้น (เดิมบล็อกเพราะ 11-2103 ติดลบ) · โค้ดเปลี่ยนเครื่องไม่ถูกแก้ — ตัดสินจากยอดในบัญชีตามเดิม · ปักที่
`exchange-priced-flow.integration.spec.ts` ("PR2ข (ก1): รับบางส่วน 1,000 ก่อนวันครบกำหนดแล้วเปลี่ยนเครื่อง …")
(เจ้าของยืนยัน 30/09/2569)

**หน้าจอ:** แผง "รายการบัญชี" ในหน้ารับชำระแสดงบล็อก 2A ที่จะลงพร้อมการรับชำระนี้ ติดป้าย "ลงพร้อมการรับชำระนี้" (QR: "ลงเมื่อเงินเข้า"
ไม่ระบุวันที่) · หัวบล็อกบอกชนิด: "2A — ตั้งลูกหนี้งวด (ACCRUAL)" (ทั้งงวด) / "2A — ตั้งลูกหนี้งวดเท่ายอดที่รับ (ACCRUAL)" /
"2A — ตั้งลูกหนี้งวดส่วนที่เหลือ (ACCRUAL)" · preview คืน `accrualPortion` (`FULL` / `PARTIAL` / `REMAINDER`) + `accrualAmount` +
`accruedBefore` ให้ป้ายและหมายเหตุ · **ด่านจ่ายบางส่วนบนหน้าจอพนักงานเหลือเฉพาะงวดที่ถึงวันครบกำหนดแล้วแต่ยังไม่ตั้งลูกหนี้งวด**
(`case: 'PARTIAL'` + ลิงก์ว่าง + ถึงวันครบกำหนด ณ วันที่รับเงิน → 400 ข้อความเดิม 2 แบบ · งวดที่ตั้งไปแล้วบางส่วนใช้ถ้อยคำ
"แต่ระบบยังตั้งลูกหนี้งวดไม่ครบ") — ใบบางส่วนก่อนวันครบกำหนดบันทึกได้พร้อม 2A เท่ายอดที่รับ · ยอด QR ที่ยังไม่ครบยอดที่ต้องชำระและไม่มี
เครดิตให้หัก → preview คำนวณแบบรับบางส่วน (เส้นทางยืนยันของผู้ให้บริการบันทึก `PARTIAL` เสมอ — ไม่ปิดส่วนขาดด้วย 52-1104) ·
QR ที่หน้าจอหักเครดิตออกให้แล้ว: ประโยคของ R17 บอกผลตามวันที่ ("…และตั้งลูกหนี้งวด (2A) เท่ายอดที่รับ" ก่อนวันครบกำหนด ·
"…และยังไม่ตั้งลูกหนี้งวด (2A)" ตั้งแต่วันครบกำหนด) · หน้าปรับดิว (ชำระทั้งก้อน 6b) แสดงรายการ 2A ในกล่อง "รายการบัญชี (ลงทันทีตอนยืนยัน)" ·
สัญญาในสถานะที่ไม่ตั้งลูกหนี้งวด: preview ไม่แสดงบล็อก 2A. ชื่อค่า `accrualMode` (`CONSOLIDATED_*`) เป็นชื่อเดิมที่คงไว้ —
**ระบบไม่เคยรวม 2A กับ 2B เป็นรายการเดียว**.

**ที่ยังเปิดอยู่:**
- **คืนเงิน (`RefundsService.markReversed`)** ไม่ถูกแก้ — ไม่กลับ 2A ทั้งใบบางส่วนและใบที่ทำให้ครบ (รอฝ่ายบัญชีข้อ 7). ขอบที่ต้องรู้:
  คืนเงินของใบบางส่วนก่อนวันครบกำหนด → 2A บางส่วนคงอยู่ (ยอดสะสม > 0 · 11-2103 ของงวดเป็นบวกเท่ายอดที่คืน) ⇒ ถ้าปิดยอดก่อนกำหนด
  ภายหลัง JP4 (PR5) ล้าง 11-2103 ส่วนนั้นตามยอดในบัญชี (เงินสดในรายการ = เงินที่รับ ไม่กระทบ) แต่เหตุผลของ JP5/ใบลดหนี้ที่ว่า
  "ส่วนที่ตั้งแล้วรับเงินแล้วเสมอ" ไม่จริงในกรณีนี้
- ลูกค้าปิดยอดเองผ่าน QR ในไลน์: webhook กระจายเงินเข้าทีละงวด งวดสุดท้ายที่เงินไปถึงไม่ครบ**ตั้งเท่ายอดที่รับ**ถ้ายังไม่ถึงวันครบกำหนด
  (เดิมไม่ตั้ง) — ปัญหาลิงก์ยอดปิดเองยังอยู่ (มีอยู่ก่อน นอกขอบเขตโค้ดของงานนี้)
- เงินที่รับของสัญญาในสถานะที่ไม่ตั้งลูกหนี้งวด (`ACCRUAL_EXCLUDED_CONTRACT_STATUSES` — บอกเลิก / ตัดหนี้สูญ / ปิด / เปลี่ยนเครื่อง /
  ร่าง / ยกเลิก) — ยังไม่มีกติกาบัญชี: ลงใบรับชำระอย่างเดียว (พฤติกรรมเดิม) + แจ้งเตือน รอฝ่ายบัญชี (ข้อ 6.1) · **ตั้งแต่ PR3 เงินนั้นได้ใบกำกับภาษี
  พร้อม VAT ของค่างวดด้วย** (ทางใช้เครดิตชำระ / ลิงก์ชำระ) ขณะที่ 21-2101 ยังไม่ลง — ดู "ใบกำกับภาษีตามบัญชี" หัวข้อ "ที่ยังเปิดอยู่"
- รับชำระย้อนวัน (D4): ใบบางส่วนตัดสิน "ก่อนวันครบกำหนด" จากวันที่รับเงินที่ย้อน — 2A บางส่วนลงวันที่ที่ย้อน ถ้างวดบัญชีของเดือนนั้นยังเปิด
  ภาษีขายของเดือนนั้นเพิ่ม
- ยอดเรียกเก็บปัดเลขกลมสูงกว่ายอดในบัญชี (เช่น 6,079.00 กับ 6,078.67): รอบกลางคืนหักเงินรับล่วงหน้าได้ไม่เกินยอดในบัญชีที่ยังค้าง
  ทั้งงวดที่ไม่เคยรับเงิน (แถว Payment ถูกจำกัดที่ยอดของงวดอยู่แล้ว) และงวดที่รับบางส่วนแล้ว (เพดานยอดในบัญชีของ PR2ข) —
  เศษ 0.33 ค้างบนแถว Payment (`PARTIALLY_PAID`) จนกว่าจะมีใบรับชำระมาปิด — ข้อมูลสำหรับงานยอดเรียกเก็บเลขกลม (O1 — PR แยกหลัง PR3)
- ~~ปิดยอดก่อนกำหนดหลังรับบางส่วน: เงินสดในรายการ JP4 ≠ เงินที่ลูกค้าจ่าย~~ — แก้แล้วใน PR5 (คำตอบข้อ 5.3)
- **VAT ของเงินที่จ่ายเกิน (PR4 — คำตอบเล่ม 1 ข้อ 2 "รับรู้ภาษีขายของเงินที่รับ ณ วันรับเงิน"):** เมื่อ PR4 รับรู้ภาษีขายตอนรับเงินที่จ่ายเกิน
  (21-1103) / เครดิตของลูกค้า (21-5101) แล้ว 2A บางส่วนที่ใช้เงินนั้น (หักเงินรับล่วงหน้าในใบเดียวกัน · ใช้เครดิตชำระ) จะรับรู้
  ภาษีขายของยอดนั้น**ซ้ำ** — PR4 ต้องหักส่วนที่มาจาก 21-1103 / 21-5101 ออกจากฐานภาษีของ 2A บางส่วน
- รอบตั้งลูกหนี้ปกติตรวจงวดบัญชีของ**บริษัทของสาขา** ขณะที่รายการลงฝั่ง FINANCE (มีอยู่ก่อน — ยังไม่แก้); 2A ณ วันรับเงินตรวจงวดของ FINANCE
- `validatePeriodOpen` อ่านเดือนตามเขตเวลาของโปรเซส — บน prod ทุกทางเข้ารันด้วย `TZ=Asia/Bangkok` เดือนจึงเป็นเดือนไทย ·
  เฉพาะโปรเซสที่รันเป็น UTC (เช่น jest บน CI) ที่ตรวจรายการเที่ยงคืนไทยของวันที่ 1 กับงวดของเดือนก่อน — ไม่มีผลบน prod
- เงินเข้าทาง PaySolutions ขณะงวดบัญชีของวันที่ลง 2A ปิด (รวมใบบางส่วน): webhook ตอบปฏิเสธ · QR ของหน้ารับชำระ: error ถูกกลืน (ตอบ 200)
  ⇒ **ไม่มีการส่งซ้ำ** — ทั้งสองกรณีต้องกระทบยอดมือจาก Sentry
- เครื่องมือ backfill (`backfill-orphan-partial-receipts.cli.ts`) ลงใบบางส่วนด้วยวันที่ตอนรัน ⇒ ถ้างวดยังไม่ถึงวันครบกำหนด จะลง 2A บางส่วน
  วันที่ตอนรันด้วย (ใบรับชำระก็ลงวันที่ตอนรันอยู่แล้ว)

**ต้องรู้ก่อน deploy (PR2ข):**
- **คำขออนุมัติปิดยอดก่อนกำหนด (EARLY_PAYOFF) ที่สร้างไว้ก่อน deploy จะได้ 409 ตอนเรียกใช้งาน** — `getEarlyPayoffQuote`
  เพิ่มฟิลด์ `accruedUnpaid` (ก1) เข้าไปในผลลัพธ์ ⇒ `canonical(quote)` (ที่ `earlyPayoff()` เทียบกับ `approval.reviewSummary`
  ที่ snapshot ไว้ตอนขออนุมัติ, `contract-payment.service.ts:418-420`) ต่างจากตอนขอเสมอ แม้ยอดเงินจะเท่าเดิมทุกบาท ⇒
  `ConflictException('ยอดปิดสัญญาเปลี่ยนแล้ว กรุณาส่งขออนุมัติใหม่')` (HTTP 409) ทุกใบที่ค้างอยู่ข้าม deploy — ไม่ใช่เฉพาะใบที่
  งวดมี 2A บางส่วนจริง. ก่อน deploy: ระบายคิวอนุมัติปิดยอดก่อนกำหนดให้ว่าง (อนุมัติ+ดำเนินการให้เสร็จ) หรือปฏิเสธ/ถอนคำขอที่ค้าง
  แล้วให้ผู้ขอส่งใหม่หลัง deploy (prod มีสัญญาเปิดอยู่ 0 สัญญา ตรวจ 2026-09-29 — คิวนี้ควรว่างอยู่แล้ว)
- **บิลด์ที่มีงาน "ใบรับชำระบางส่วนก่อนวันครบกำหนดตั้งลูกหนี้งวดเท่ายอดที่รับ" (จุดเกี่ยวตอนรับเงิน) แต่ไม่มีงาน "ยกเลิกใบเสร็จ
  กลับรายการตั้งลูกหนี้งวดทุกใบของงวด" (การกลับรายการ/ตรวจทาน) ต้องไม่ขึ้น prod เด็ดขาด** — งานแรกเริ่มสร้างสภาพใหม่ที่ยังไม่เคย
  มี (2A หลายรายการต่อหนึ่งงวด, คอลัมน์ `accrued*` ที่ไม่ใช่ 0) ซึ่งมีเฉพาะโค้ดของงานที่สองเท่านั้นที่รู้จักวิธีกลับให้ถูก
  (เล่นซ้ำทีละใบด้วย `buildPartialAccrual2ALines`, คืนคอลัมน์ `accrued*` เป็น 0) — ถ้าขาดงานที่สอง การยกเลิกใบเสร็จของงวด
  ที่เคยรับบางส่วนก่อนวันครบกำหนดจะกลับรายการผิด (เส้นทางกลับรายการเดิมรู้จักแค่ 2A ใบเดียวต่องวด). ทั้ง PR ต้อง merge/deploy
  เป็นก้อนเดียว ห้ามแยกปล่อยบางส่วน.
- หลังมีรายการ 2A บางส่วน (`metadata.portion = 'partial'`) เกิดขึ้นแล้ว ห้ามถอย revision กลับไปโค้ดก่อน PR2ข (ต่ำกว่า 26.10.1 — PR2 · PR2ข · PR3 · PR6 · ภ.พ.30 ขึ้น prod พร้อมกันที่ 26.10.1 ต่อจาก 26.9.69 · prod ไม่เคยมี 26.9.70–26.9.75) — โค้ดเดิมตั้งเต็มงวดซ้ำทั้งรอบกลางคืนและใบที่ทำให้ครบ (ดอกเบี้ยและภาษีขายรับรู้สองครั้ง) · แก้ไปข้างหน้าเท่านั้น
- หลัง deploy ให้พนักงานรีเฟรชหน้ารับชำระ (แท็บที่เปิดค้างจากเวอร์ชันเดิมยังแสดงคำว่า "เต็มงวด" ข้างบรรทัด 2A บางส่วน — แสดงผลเท่านั้น ตัวเลขที่ลงถูกต้อง)

## ใบกำกับภาษีตามบัญชี — เก็บค่าที่พิมพ์ ณ ตอนออกใบ (คำตัดสินฝ่ายบัญชี D3–D5 — 2026-09-28 · PR3)

ใบเสร็จรับเงิน / ใบกำกับภาษีค่างวดของ FINANCE พิมพ์ **มูลค่า / VAT / ค่าปรับ / ปัดเศษ / เงินรับล่วงหน้า ตามรายการบัญชี** และเก็บค่าที่พิมพ์ลง
แถว `Receipt` ณ ตอนออกใบ — `amountBeforeVat`, `vatAmount` + คอลัมน์ใหม่ `roundingAmount`, `lateFeeAmount`, `lateFeeWaivedAmount`,
`advanceAmount`, `advanceVatAmount` (migration `20261015000000_receipt_tax_breakdown`). PDF และใบลดหนี้อ่านค่าที่เก็บ ไม่คำนวณใหม่ตอนพิมพ์.
**ต้องเป็นจริงเสมอ:** `amountBeforeVat + vatAmount + roundingAmount + lateFeeAmount = amount`

| แถวบนเอกสาร | ค่า | ที่มา |
|---|---|---|
| ค่างวด | ยอดที่ใบนี้ล้างลูกหนี้ของงวด (Cr 11-2103 — รวมส่วนลดเศษสตางค์ และเงินรับล่วงหน้าที่หักเข้างวดในใบเดียวกัน) · VAT = กติกาเดียวกับ 2A (ก1): HALF_UP(ยอด × 7/107) · ใบที่ทำให้ยอดสะสมของงวดครบรับส่วนที่เหลือ (ภาษีของงวด − ภาษีที่เอกสารก่อนหน้าของงวดแสดงแล้ว) | `computeInstallmentReceiptTax` (`journal/receipt-tax-breakdown.ts`) ใน `PaymentReceiptTemplate` → `metadata.receiptTax` ของรายการรับชำระ → `generateReceipt` คัดลอก |
| เงินรับล่วงหน้า | + พักไว้ (Cr 21-1103) / − **หักเงินรับล่วงหน้า** (Dr 21-1103 · บรรทัดรอง "เงินที่ชำระไว้ก่อนแล้ว") · VAT = HALF_UP(\|ยอด\| × 7/107) เครื่องหมายตามยอด | ปกติเงินที่หักคือเงินที่ออกเอกสารพร้อมภาษีไปแล้วตอนรับ — ไม่แสดงซ้ำ (research §8.3) · ข้อยกเว้นดู "ที่ยังเปิดอยู่" |
| ค่าปรับ / อนุโลม | Cr 42-1103 − Dr 52-1105 (นอกฐานภาษี) / Dr 52-1105 | |
| ปัดเศษ (ไม่อยู่ในฐานภาษี) | Cr 53-1503 − Dr 52-1104 | บวก = เก็บเกิน · ลบ = ส่วนลดเศษสตางค์ (Q4: VAT เต็ม + ปัดเศษติดลบ) |

- "ภาษีที่เอกสารก่อนหน้าของงวดแสดงแล้ว" เล่นซ้ำจาก **Cr 11-2103 ของทุกรายการก่อนหน้าของงวดที่ยังมีผล** (รายการรับชำระ + รายการหักเงินรับล่วงหน้า
  ของรอบกลางคืน — `reconstructPriorCleared().priorClearings`) ด้วยกติกาเดียวกัน ⇒ แถวค่างวดของทุกเอกสารของงวดรวมกัน = ภาษีขายของงวดพอดี
- **ตรวจทาน:** ใบรับชำระที่ลง 2A พร้อมกัน — VAT ของแถวค่างวดต้องเท่า Cr 21-2101 ของ 2A นั้น (`AccrueAtReceiptResult.vat`) · ต่างกัน = Sentry
  `receipt-vat-accrual-mismatch` หลัง commit (ไม่หยุดการรับชำระ) — ต่างได้เมื่องวดมีใบรับบางส่วนที่ไม่ได้ตั้ง 2A ของตัวเอง: ใบก่อน PR2ข ·
  หรือใบตั้งแต่วันครบกำหนดในวันที่รอบกลางคืนไม่ได้ตั้งลูกหนี้งวด (ใบที่ทำให้ครบจึงได้ 2A ทั้งงวด แต่พิมพ์ส่วนที่เหลือ) · หรือใบบางส่วนที่รับขณะสัญญา
  อยู่ในสถานะที่ไม่ตั้งลูกหนี้งวด แล้วสถานะถูกคืนภายหลัง (เช่น ส่งกลับ / ยกเลิกใบรับเครื่องคืนแบบ VOLUNTARY) · และในทิศกลับ: คืนเงินของใบบางส่วน
  ก่อนวันครบกำหนด (`RefundsService` กลับรายการรับชำระแต่ไม่กลับ 2A บางส่วน ⇒ ใบที่ทำให้ครบพิมพ์ภาษีทั้งงวด ขณะที่ 2A ที่ลงพร้อมกันเป็นส่วนที่เหลือ)
- **ใช้ 7/107 ไม่ใช่ V×x/T ของสเปค ข้อ 5.4** — ในสัญญา 17,000/12 สองสูตรให้ VAT ต่างกัน 0.01 บาทที่ยอดรับราว 18% ของทุกค่าที่เป็นไปได้
  (26,917 จาก 151,483 ค่าสตางค์ — รับ 700 → 45.79 ตามบัญชี · สูตรสเปค 45.80) · สัญญาที่ V/T = 7/107 พอดี (เช่น 6,078.67) ให้ผลเท่ากันทุกค่า
- ใบเสร็จปิดยอดก่อนกำหนด (`EARLY_PAYOFF`) **ยังพิมพ์แบบเดิม** (ไม่ผูกรายการ JP4 · ไม่เก็บค่า · ถอด ×100/107 จากยอดรับ) — PR5 แก้เฉพาะรายการ JP4;
  รูปแบบใบรอคำตอบฝ่ายบัญชี (ฉบับรวม ข้อ 16 ยังไม่ได้ส่ง · ภาษีบนใบ ≠ 21-2101 ของ JP4 — หัวข้อ JP4 แถว "ใบเสร็จ") · ใบปรับดิว (`RESCHEDULE_FEE`) ไม่เก็บค่า (PR4) · ใบที่ออกก่อน PR3 = null ทุกช่อง → PDF ใช้ตรรกะเดิม
  (`legacyReceiptDocumentMoney`) · **ไม่มี backfill**
- **ใบลดหนี้ตอนยกเลิกใบเสร็จคัดลอกทุกบรรทัด** (Q5): ใบใหม่ = ค่าที่เก็บ · ใบเก่า = ตัวเลขที่ใบเดิมพิมพ์ (ตรรกะเดิมของ PDF — อ่านก่อนเปิดธุรกรรม
  ของการยกเลิก) · ตรรกะเดิมพิมพ์ใบนั้นไม่ได้ → ยอดอย่างเดียวแบบเดิม · ป้ายแถวเงินพักค่าปรับดิวบนใบลดหนี้ใช้งวดเป้าหมายของใบที่ถูกยกเลิก
  (`ReceiptQueryService.getReceipt` → `advanceTargetInstallmentNo`) — ใบลดหนี้ไม่มีประวัติการจัดสรรของตัวเอง
- **ทางรับชำระค่างวดทั้งสี่ออกใบเสร็จหลังธุรกรรม commit และผูกรายการรับชำระ** (คำสั่งเจ้าของ 2026-09-30): บันทึกรับชำระ (เดิม) · กระจายเงินอัตโนมัติ
  (เดิมออกใบในธุรกรรมผ่าน client หลัก — X5) · ใช้เครดิตชำระ (เดิมไม่มีใบ — ช่องทาง `CREDIT_BALANCE`) · เงินเข้าทางลิงก์ชำระ PaySolutions
  (เดิมไม่มีใบ — `ONLINE_GATEWAY` หนึ่งใบต่องวดที่เงินไปถึง)
- **ข้อความใบเสร็จทาง LINE:** ทุกทางส่งตามกติกาเดิมของ `generateReceipt` (คำตอบเจ้าของ 2026-09-30 — ไม่มีตัวเลือกปิด) · ข้อความใบเสร็จไปทาง
  OA ของ SHOP เฉพาะลูกค้าที่ผูก LINE FINANCE และ SHOP และยินยอม PDPA · หนึ่งข้อความต่อหนึ่งใบ — ลิงก์ชำระที่ครอบหลายงวดได้ข้อความใบเสร็จต่องวด
  (ลิงก์ปิดยอด 12 งวด = 12 ข้อความ) นอกเหนือจากข้อความ "ชำระสำเร็จ" ทาง OA ของ FINANCE · ป้ายวิธีชำระในข้อความตรงกับใบเสร็จ PDF
  (`line-oa/flex-messages/receipt.flex.ts`)
- **หนึ่งใบต่อรายการบัญชีหนึ่งรายการ:** `generateReceipt` คืนใบเดิมเมื่อรายการนั้นมีใบแล้ว (ตรวจหลังได้ล็อกเลขที่ใบ) + partial unique index
  `receipts_source_journal_entry_key` (SQL-only — ห้ามยอมรับ diff ที่เสนอ DROP)
- **สรุปรายวัน / Excel / รายการชำระแล้ว:** ใบใช้เครดิตชำระไม่ใช่เงินที่รับในวันนั้น — ไม่นับในยอดรวม / แยกตามวิธี / ค่าปรับรวม / ยอดของวัน
  (`MONEY_IN_RECEIPT` ใน `payment-query.service.ts`) และไม่นับเป็น "เงินที่รับจริง" ของรายการชำระแล้ว · ยังแสดงเป็นรายการ
  (ตาราง: "ไม่นับในยอดรับ" · Excel: ยอดรับจริง 0 + หมายเหตุบอกยอดเครดิต) · ใบลิงก์ชำระนับเป็นเงินรับตามสาขาของสัญญา
- **แก้ไปข้างหน้าเท่านั้น — ห้ามถอยกลับไปโค้ดก่อน PR3 (ต่ำกว่า 26.10.1) หลังมีใบที่เก็บค่าแล้ว:** โค้ดเดิมอ่าน `amountBeforeVat` / `vatAmount` ที่ PR3
  เก็บเป็น "VAT ที่ระบุไว้" (แขนเดียวกับใบลดหนี้อัตโนมัติ) และไม่รู้จักคอลัมน์ใหม่ ⇒ ใบที่มีปัดเศษพิมพ์มูลค่า + VAT ของแถวค่างวดไม่เท่ายอดรับ (ต่างเท่า
  ยอดปัดเศษ เช่น 0.33 — ไม่มีแถวปัดเศษ) · ยกเลิกใบที่เก็บค่าแล้วได้ใบลดหนี้แบบยอดอย่างเดียว (ไม่คัดลอกค่าที่เก็บ — VAT ของใบลดหนี้ถอด ×100/107 ใหม่
  จึงอาจไม่เท่าใบเดิม เช่น 815.83 → 53.37 ขณะที่ใบเดิมพิมพ์ 53.38)

### ออกใบเสร็จซ้ำ (ใบที่ออกไม่สำเร็จหลังเงินลงบัญชีแล้ว)

ทางกระจายเงิน / ใช้เครดิต / ลิงก์ชำระ ออกใบหลัง commit — ใบใดออกไม่สำเร็จ ระบบส่ง Sentry ระดับ error
(`tags.action = 'post-commit-receipt-failed'` · `tags.path` · `extra`: `contractId`, `paymentId`, `installmentNo`, `journalEntryNumber`,
`paymentMethod`, `amount`, `transactionRef`, `issuedById`, `paidDate` — อาร์กิวเมนต์ของการออกซ้ำครบทุกตัว).
หน้ารับชำระและปิดยอดก่อนกำหนดยังเขียนเฉพาะ log (`Failed to generate receipt …` / `Failed to generate EARLY_PAYOFF receipt …`) เหมือนเดิม —
ไม่ถึง Sentry ต้องหาจาก log.
เงินและรายการบัญชีถูกต้องแล้ว ขาดแค่เอกสาร · ผู้ให้บริการส่งซ้ำก็ไม่ถึงจุดออกใบอีก (ลิงก์ `USED`) ⇒ **ต้องออกซ้ำด้วยมือ**.

**ยังไม่มี endpoint หรือ CLI สำหรับออกซ้ำ** — `generateReceipt` เรียกได้จากในโปรเซสเท่านั้น (controller ของใบเสร็จมีแค่ `credit-note/issue` ·
`:id/void` · `:id/send-line`) ⇒ การออกซ้ำ = **นักพัฒนาเขียนงานครั้งเดียวตามแบบ Cloud Run job `backfill-orphan-receipts`**
(`backfill-orphan-partial-receipts.cli.ts`): `EXPECTED_DB_NAME` ต้องตรงกับ `current_database()` · ค่าเริ่มต้นคือ dry-run (แสดงใบที่จะออก ไม่เขียนอะไร) ·
ออกจริงเมื่อตั้ง `CONFIRM_BACKFILL=YES_I_AM_SURE` (บน prod ต้องมี `ALLOW_PROD_BACKFILL=YES_I_AM_SURE` ด้วย) · เรียก `ReceiptsService.generateReceipt`
ทีละใบ ใบหนึ่งล้มไม่หยุดใบอื่น. CLI ที่มีด่านครบเป็นงานต่อเนื่อง (ความถี่ที่คาดต่ำ — ทำเมื่อเกิดจริงบ่อย).

1. **ตรวจก่อนออก** — เปิดรายการ `journalEntryNumber`: `metadata.reversed` ต้องไม่เป็น `true` (ยกเลิกใบเสร็จ / คืนเงินกลับรายการไปแล้ว — โค้ดปฏิเสธ
   "รายการบัญชีรับชำระนี้ถูกกลับรายการแล้ว — ออกใบเสร็จไม่ได้" โดยไม่ออกเลขที่ใบ) · แถว Payment ของงวด (`metadata.paymentId`): สถานะและยอดที่ชำระ
   ต้องยังนับเงินก้อนนี้อยู่ · รายการยังไม่มีใบ (`receipts.source_journal_entry_id` — ตัวตรวจข้างล่าง)
2. **ค่าที่ต้องส่ง** ตามตารางข้างล่าง — Sentry มีครบ · หน้ารับชำระ (log อย่างเดียว) และโปรเซสที่ตายหลัง commit (ไม่มีแจ้งเตือน) ใช้ช่อง "สำรอง"
3. เรียก `generateReceipt(contractId, paymentId, 'INSTALLMENT', <ยอด>, installmentNo, <ช่องทาง>, <เลขอ้างอิง>, <ผู้ออก>, <วันที่รับเงิน>,
   <journalEntryNumber>)` — รายการที่มีใบแล้วได้ใบเดิมคืน (ไม่ออกเลขใหม่ · ไม่ส่งข้อความซ้ำ) · รายการที่ถูกกลับแล้วถูกปฏิเสธ (ข้อ 1) · ใบที่ได้เก็บค่า
   จากรายการเหมือนใบที่ออกตามปกติ · ลูกค้าที่ผูก LINE ได้ข้อความใบเสร็จตามกติกาเดิม (ใบที่ขาดไป)
   - **ยอดต้องเท่า `metadata.receiptTax.amount` พอดี** (เทียบทศนิยม 2 ตำแหน่ง) — ต่างแม้สตางค์เดียว ใบยังออกและผูกรายการ แต่ไม่เก็บค่าทั้ง 7 ช่อง
     (log เตือนอย่างเดียว) ⇒ พิมพ์ตรรกะเดิม
   - **ออกซ้ำให้เร็ว** — สถานะบนใบ (`paymentStatus`) ลำดับใบบางส่วน ยอดคงเหลือของงวด และยอดคงเหลือบนเอกสาร คำนวณ ณ ตอนออกซ้ำ (ช่องภาษีไม่เปลี่ยน)
     ⇒ ออกช้าได้สถานะภายหลัง เช่น งวดที่ถูกชำระต่อจนครบไปแล้ว
4. **`journalEntryNumber` เป็น `null`** (งวดไม่มีแถวตารางงวด — ในธุรกรรมมี Sentry `PAID installment has no postable 2B JE …` = ไม่มีรายการรับชำระ
   ให้ผูก) — ออกซ้ำโดยไม่ส่งเลขที่รายการได้ใบที่ไม่ผูกรายการและพิมพ์ตรรกะเดิม ⇒ แจ้งฝ่ายบัญชีทุกครั้ง
5. `backfill:receipts` (`backfill-payment-receipts.cli.ts`) ใช้เป็นทางสุดท้ายเท่านั้น — ออกใบที่ไม่ผูกรายการ (พิมพ์ตรรกะเดิม) และเฉพาะงวดที่
   `PAID` ที่ยังไม่มีใบเลย · **ห้ามใช้ร่วมกับการออกซ้ำแบบผูกรายการของ Payment เดียวกัน** — ใบของ CLI ไม่ผูกรายการ unique index
   `receipts_source_journal_entry_key` จึงกันเอกสารใบที่สองของเงินก้อนเดียวกันไม่ได้

| อาร์กิวเมนต์ | จาก Sentry (`extra`) | สำรอง |
|---|---|---|
| ยอด | `amount` | `metadata.receiptTax.amount` ของรายการ |
| ช่องทาง | `paymentMethod` | `payments.payment_method` ของงวด (ทางกระจายเงินเก็บช่องทางไว้ที่นี่เท่านั้น) · ใช้เครดิต = `CREDIT_BALANCE` · ลิงก์ชำระ = `ONLINE_GATEWAY` |
| เลขอ้างอิง | `transactionRef` | ลิงก์ชำระ: `transaction_id` ใน `Payment.gatewayResponse` หรือ `Payment.gatewayRef` (refno) · กระจายเงิน / ใช้เครดิต: `null` · หน้ารับชำระ: `ref:<เลข>` ใน `Payment.notes` |
| ผู้ออก | `issuedById` | ผู้บันทึกรับเงิน (`Payment.recordedById`) · ลิงก์ชำระ: ผู้ใช้ OWNER ของระบบ (คนแรกที่สร้าง — ตัวเดียวกับที่ webhook ใช้ลงรายการ) |
| วันที่รับเงิน | `paidDate` | `postedAt` ของรายการ |

**ตัวตรวจเงินที่ยังไม่มีใบเสร็จ** (อ่านอย่างเดียว) — ครอบโปรเซสที่ตายหลัง commit (ไม่มีแจ้งเตือนเลย) และหน้ารับชำระที่เขียน log อย่างเดียว ·
รันหลังวันแรกบน prod (คาดว่าไม่มีแถว — มีแถว = ตรวจและออกซ้ำตามข้อ 1–5) แล้วรันเป็นระยะ:

```sql
SELECT je.entry_number, je.posted_at,
       je.metadata->>'contractId' AS contract_id, je.metadata->>'paymentId' AS payment_id,
       je.metadata->'receiptTax'->>'amount' AS receipt_amount
FROM journal_entries je
WHERE je.status = 'POSTED' AND je.deleted_at IS NULL
  AND je.metadata->>'tag' = 'receipt'
  AND COALESCE(je.metadata->>'reversed', 'false') <> 'true'
  AND je.metadata ? 'receiptTax'
  AND NOT EXISTS (SELECT 1 FROM receipts r
                  WHERE r.source_journal_entry_id = je.id AND r.deleted_at IS NULL)
ORDER BY je.posted_at;
```

ผลบวกเท็จที่รู้: รายการที่ `backfill-orphan-partial-receipts` ลงให้ใบบางส่วนกำพร้าของยุคก่อน PR3 (ตรวจใบที่ออกไว้แบบไม่ผูกรายการของ Payment
เดียวกันก่อนออกซ้ำ) · ไม่ครอบ: รายการก่อน PR3 (ไม่มี `receiptTax`) · งวดที่ไม่มีรายการรับชำระเลย (ข้อ 4) · ใบเสร็จปิดยอดก่อนกำหนด (ไม่ผูกรายการ JP4 — รอคำตอบฝ่ายบัญชีข้อ 16)

**ที่ยังเปิดอยู่:**
- **ใบเสร็จของสัญญาในสถานะที่ไม่ตั้งลูกหนี้งวด** (`ACCRUAL_EXCLUDED_CONTRACT_STATUSES` เช่น `TERMINATED` — เข้าได้ทางใช้เครดิตชำระ (API ไม่มีด่านสถานะ)
  และลิงก์ชำระ; หน้ารับชำระและกระจายเงินรับเฉพาะ `ACTIVE` / `OVERDUE` / `DEFAULT`): ใบพิมพ์ VAT ของค่างวดตามกติกาเดียวกับสัญญาปกติ แต่ไม่มี 2A
  ลงพร้อมกัน ⇒ 21-2101 ของเงินนั้นเป็น 0 จนกว่าฝ่ายบัญชีตอบข้อ 6 (6.1 เสนอ "ตั้ง 2A + รับชำระตามปกติ" ซึ่งทำให้บัญชีเท่าเอกสาร) · ภาษีบนใบถึงกำหนด
  แล้วตามกฎหมาย — การขายตามสัญญาเช่าซื้อ ความรับผิดเกิดเมื่อถึงกำหนดชำระแต่ละงวด หรือเมื่อได้รับชำระ / ออกใบกำกับภาษีก่อนนั้น (ประมวลรัษฎากร ม.78)
  · รายงาน ภ.พ.30 อ่านภาษีขายจาก 21-2101 ⇒ **ภาษีบนใบเหล่านี้ไม่อยู่ใน ภ.พ.30** — รายการสำหรับกระทบยอดมือ = Sentry warning
  `accrue-at-receipt-skipped-status` (หนึ่งครั้งต่อใบรับชำระของงวดที่ยังตั้งลูกหนี้งวดไม่ครบ) · ตัวอย่าง: สัญญา `TERMINATED` ใช้เครดิต 2,000 →
  ใบ VAT 99.17 + 31.67 · 21-2101 = 0.00
- เงินรับล่วงหน้าที่ไม่มีเอกสารภาษีตอนรับ (ส่วนเกินจากลิงก์ชำระ → 21-1103 · เงินพักค่าปรับดิวแบบ 6a ที่ออกใบเสร็จไม่มี VAT) — แถว "หักเงินรับล่วงหน้า"
  หักภาษี 7/107 ที่ไม่เคยออกเอกสาร ⇒ VAT บนเอกสารของงวดนั้นต่ำกว่าบัญชีเท่าภาษีของส่วนนั้น จนกว่า PR4 (Q7/Q8) ลงภาษีของเงินรับล่วงหน้า ณ วันรับ
- เงินรับล่วงหน้าที่ถูกหักหลายครั้ง: ภาษีคิดทีละแถว (HALF_UP) ⇒ ผลรวมภาษีของแถวหักต่างจากภาษีที่พิมพ์ตอนรับได้ ±0.01 ต่อก้อน
  (500 → 32.71 · หัก 250 + 250 → 16.36 + 16.36 = 32.72)
- **เงินที่รับแล้วยังไม่มีใบเสร็จ:** ส่วนเกินจากลิงก์ชำระ (พักเป็นเงินรับล่วงหน้า 21-1103) และเงินเกินจากกระจายเงินอัตโนมัติ (เครดิตในสัญญา 21-5101)
  — มีใบเมื่อเงินนั้นถูกใช้ (ใช้เครดิตชำระ / หักเข้างวด) · ใบตอนรับรอ PR4 (ออกวันนี้จะพิมพ์ VAT ที่บัญชียังไม่ลง)
- เงินรับล่วงหน้าที่ถูกปันไปจ่ายค่าปรับก่อน (ค่าปรับก่อนเสมอ) ทำให้ภาษีสุทธิของเอกสารใบนั้นติดลบได้ (เอกสารพิมพ์ "ใบเสร็จรับเงิน" ไม่ใช่ใบกำกับภาษี)
  ⇒ ภาษีของเงินรับล่วงหน้าส่วนที่ไปจ่ายค่าปรับ (ซึ่งไม่มี VAT) **ค้างอยู่บนใบกำกับภาษีตอนรับเงินนั้น** — ใบที่ภาษีสุทธิติดลบเป็นใบเสร็จธรรมดา ไม่ใช่
  ใบลดหนี้ จึงไม่ลดภาษีที่ออกเอกสารไปแล้ว · ตัวอย่าง (งวด 1,515.83 · ใบก่อนหน้า 1,415.83 VAT 92.62 · เงินรับล่วงหน้า 140 ออกใบกำกับภาษีตอนรับ VAT 9.16 ·
  ใบสุดท้ายเงินสด 10 + หักเงินรับล่วงหน้า 140 จ่ายค่าปรับ 50 ก่อน): ใบสุดท้ายพิมพ์แถวค่างวด VAT 6.55 และแถวหัก −140.00 (−9.16) ภาษีสุทธิ −2.61 ⇒
  ใบกำกับภาษีของเงินค่างวดนั้นรวม 101.78 (92.62 + 9.16) ขณะที่บัญชีลงภาษีขาย 99.17 — เกิน 2.61
- คืนเงิน (`RefundsService`) ยกเลิกใบเสร็จโดยไม่ออกใบลดหนี้ (รอฝ่ายบัญชีข้อ 7.2)
- **เครดิตจากการเปลี่ยนเครื่องเสียภายใน 7 วัน** (`defect-exchange.service.ts`): ค่างวดที่ลูกค้าจ่ายไปแล้วของสัญญาเดิมถูกตั้งเป็น `creditBalance`
  ของสัญญาใหม่ · ใบเสร็จ/ใบกำกับภาษีของสัญญาเดิมไม่ถูกยกเลิกและไม่มีใบลดหนี้ (`DefectExchangeReversalTemplate` ข้ามรายการฝั่งรับชำระ) ⇒
  ตั้งแต่ PR3 การใช้เครดิตนั้นชำระ (`applyCreditBalance`) ออกใบกำกับภาษี `CREDIT_BALANCE` พร้อม VAT ให้เงินก้อนเดิมอีกครั้ง · เกิดได้เฉพาะเมื่อลูกค้า
  จ่ายค่างวดภายใน 7 วันหลังรับเครื่องแล้วเปลี่ยนเครื่อง (น้อยมาก) · ยอมรับชั่วคราว จนกว่างานต่อเนื่องตัดสินว่าจะออกใบลดหนี้ให้ใบของสัญญาเดิมตอนเปลี่ยนเครื่อง
  หรือให้ใบใช้เครดิตที่มาจากการเปลี่ยนเครื่องไม่พิมพ์ VAT (รอฝ่ายบัญชี — แผน PR3 ถ8)
- ยอดเรียกเก็บเลขกลม (O1) — PR แยกหลัง PR3 · ใบเสร็จปิดยอดก่อนกำหนด — รอคำตอบฝ่ายบัญชีข้อ 16 (PR5 แก้เฉพาะรายการบัญชี)
- **ไม่มี backfill ของใบที่ออกก่อน deploy** — ใบเดิมทุกใบไม่มีค่าที่เก็บ (7 ช่องว่าง) และพิมพ์ด้วยตรรกะเดิม (`legacyReceiptDocumentMoney`) ต่อไป ·
  ใบลดหนี้ของใบเหล่านั้นคัดลอกตัวเลขที่ใบเดิมพิมพ์ (ตรรกะเดิมพิมพ์ไม่ได้ = ยอดอย่างเดียว + log เตือนพร้อมเลขที่ใบ · อ่านใบไม่ได้ด้วยเหตุอื่น = + Sentry
  `subsystem: receipt-void-credit-note`)

## Document number convention (P2-3 — Fix Report v1.0)

All accounting modules use the same convention:

```
<TYPE>-YYYYMMDD-NNNN
```

| Module | Prefix | Example |
|---|---|---|
| Expense | `EX` | `EX-20260511-0001` |
| Credit Note | `CN` | `CN-20260511-0001` |
| Payroll | `PR` | `PR-20260511-0001` |
| Vendor Settlement | `SE` | `SE-20260511-0001` |
| Other Income | `OI` | `OI-20260511-0001[-R]` [^1] |
| Receipt (Other Income) | `RT` | `RT-202605-00001` (per-month seq) |

[^1]: `-R` suffix is appended automatically to OtherIncome reversal documents
      created via `POST /other-income/:id/reverse`. The original POSTED doc keeps
      its base number; the reversing doc is `<original>-R`. See W15 fix.

YYYYMMDD is **Asia/Bangkok local date** (so a doc created at 00:30 BKK = 17:30 UTC the previous day still numbers under today's date). The 4-digit sequence (`NNNN`) resets at BKK midnight per `<TYPE, day>` pair via an advisory lock — see `DocNumberService.next()` and `OtherIncomeService` / `DocNumberService.getBkkDayBounds()`.

Don't introduce alternative formats (`EX-2605110001`, `EX_2026-05-11_0001`, etc.) — keep one convention for grep-ability + downstream report parsing.

---

## Per-line WHT routing (P2-4 — Fix Report v1.0)

`ExpenseLine.whtFormType` is **optional** and overrides the document-level `whtFormType` for that line's WHT amount. Lets a single EX document mix individual + juristic vendors:

- Line.whtFormType = `'PND3'` → that line's WHT routes to **21-3102** (ภ.ง.ด. 3 ค้างจ่าย)
- Line.whtFormType = `'PND53'` → routes to **21-3103** (ภ.ง.ด. 53 ค้างจ่าย)
- Line.whtFormType = `null` → falls back to doc.whtFormType, defaults `'PND3'`

`expense-same-day.template.ts` aggregates WHT by form type and posts up to 2 Cr lines when needed. Legacy docs (line-level `whtFormType` all null) keep the original single-Cr-line behavior — backwards compatible.

VendorSettlement intentionally does NOT support per-line routing — by the model definition, a single SE doc clears one vendor only, so one form type applies to the whole settlement.

---

## DEFERRED to Phase A.5

| Item | Accounts | Notes |
|------|----------|-------|
| PPE + depreciation | 12-21XX, 53-16XX | Asset register + monthly depreciation cron |
| WHT | 21-31XX/32XX, 54-XXXX | Payroll + vendor withholding flows |
| Tax-disallowed expenses | 54-XXXX | Flag on expense type |
| 41-2101/02 HP Revenue | — | CSV omits: FINANCE income = interest, not principal |

> "SHOP-side accounting" graduated to Phase 3 SP5 — see "SHOP Accounting (Phase 3 SP5)" section below.

> "PEAK code mapping" graduated to Phase 3 SP3 — see "PEAK Code Mapping" section below.
> "SHOP-side accounting" graduated to Phase 3 SP5 — see "SHOP Accounting (Phase 3 SP5)" section below.

---

## SHOP Accounting (Phase 3 SP5)

BESTCHOICE runs as 1 legal entity but 2 business halves: SHOP (retail, not VAT-registered) and FINANCE (installment financing, VAT-registered at 7%). All Phase A.0-A.4 templates were FINANCE-only. P3-SP5 adds the SHOP-side chart + templates so SHOP can produce its own Trial Balance + P&L.

### Chart prefix convention

SHOP accounts live in the same `chart_of_accounts` table as FINANCE accounts but use a leading `S`:

| Group | FINANCE | SHOP |
|---|---|---|
| Cash | 11-1101..1103 | S11-1101..1103 |
| Bank | 11-1201..1203 | S11-1201..1202 |
| Inventory | 11-3101 (repo) | S11-2001 (new mobile), S11-2002 (used), S11-2003 (accessory), S11-2004 (pending eval) |
| Inter-co receivable | n/a | S11-3001 (FINANCE owes ยอดจัด), S11-3002 (FINANCE owes commission), S11-3003 (FINANCE ตีคืน) |
| AP | 21-1101..1104 | S21-1101 (supplier mobile), S21-1102 (supplier accessory), S21-1103 (สาขาค่าใช้จ่ายค้าง), **S21-1104** (เจ้าหนี้ FINANCE — หนี้ระหว่างกิจการ **ทุกประเภท** ตามคู่สัญญา; แทน S21-3001 เดิมที่ตั้งตามวัตถุประสงค์ — CPA 2026-08-24 ข้อ A1+B4) |
| เงินกู้ยืม | n/a | **S21-4101** (เงินกู้ยืมกรรมการ — บุคคลที่เกี่ยวข้องกัน ต้องเปิดเผยแยกในหมายเหตุงบ; เปิด 2026-08-24 รองรับยอดยกมา SHOP) |
| Customer down-payment | n/a | S21-2001 (down-payment payable), S21-2002 (deposit) |
| Equity | 31-1101, 32-1101, 33-1101 | S31-1101, S32-1101, S33-1101 |
| Revenue | 41-1101..1102 | S41-1101 (new mobile), S41-1102 (used), S41-1103 (accessory), S41-1201 (commission from FINANCE), S41-1202 (manufacturer promo) |
| COGS | n/a (FINANCE = interest income only) | S50-1101..1103, S50-1201 (used-buy-in) |
| OpEx | 51-XXXX..53-XXXX | S51-1101..1104 (selling), S52-1101..1301 (admin), S53-1101..1103 (other) |

The full list lives in `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/shop-coa.csv` (~50 accounts). Seeded by `apps/api/prisma/seed-coa-shop.ts`.

The unique constraint on `chart_of_accounts.code` is safe because the `S` prefix guarantees no overlap with FINANCE codes. When Phase 3 SP7 splits the entities into separate legal companies + separate DBs, the SHOP DB can drop the `S` prefix internally — until then it is the partition key.

### ⛔ ห้ามลง JV มือในบัญชีที่เลนส์ inter-co อ่านต่อสัญญา (2026-08-24)

Spec: `docs/superpowers/specs/2026-08-24-shop-opening-balance-design.md`

บัญชีกลุ่มนี้ถูกอ่านโดยเลนส์/cron ที่จับคู่ยอด **ต่อสัญญา** ผ่าน `metadata.contractId` /
`metadata.newContractId` — JV มือ (ยอดยกมา, รายการปรับปรุง) ไม่มีเลขสัญญาผูกอยู่ จึงมองไม่เห็น
จากเลนส์ แต่ **เห็นจากยอดรวมทั้งบัญชี** ⇒ สร้างส่วนต่างถาวรที่ตามหาต้นตอไม่ได้:

| บัญชี | ใครอ่าน | ลง JV มือแล้วเกิดอะไร |
|---|---|---|
| `11-2107` · `S21-1104` | `getTypedAccountDrift()` (`interco-aging.service.ts`) เทียบยอดทั้งบัญชี vs ยอดที่เลนส์ classify ได้ | finding **`ACCOUNT_DRIFT`** + Todo `HIGH` **ทุกเดือนตลอดไป** โดยไม่มีเลขสัญญาให้ตามต่อ |
| `S11-3001` · `S11-3002` | `getReconcileTotals()` (`interco-pending.service.ts`) — `glShopTotal` นับ**ทั้งบัญชี ไม่กรอง metadata** ส่วน `pendingTotal` นับเฉพาะสัญญาที่มี `contractId` | สองตัวเลขบนหน้าจอกระทบยอดห่างกันเท่ายอด JV ตลอดไป · และรอบจ่ายจะ**ไม่มีวันล้างยอดนั้น** เพราะสัญญาเก่ายังเป็น `legacyNoShop = true` ⇒ `buildShopLines` ข้ามไม่สร้างบรรทัด SHOP ให้ |
| `21-1101` · `21-1102` | เลนส์คิวรอจ่ายฝั่ง FINANCE (`HAVING SUM > 0` ต่อ `contractId`) | เข้าคิวจ่ายไม่ได้ + ทำ `drift` ของ `getReconcileTotals()` เพี้ยน |

**กติกา:** ยอดยกมา/รายการปรับปรุงที่ครอบหลายสัญญา ให้ตกที่ **ส่วนของเจ้าของ** (`S32-1101`)
แล้วเขียนหมายเหตุประกอบงบ — **ห้ามยัดลงบัญชีระหว่างกิจการเพื่อให้งบดูครบ** ถ้าจำเป็นต้องรับรู้
รายการระหว่างกิจการจริง ต้องแตกเป็น JE **ต่อสัญญา** พร้อม stamp `metadata.contractId` ซึ่งจะ
เปลี่ยนพฤติกรรมรอบจ่ายด้วย — เป็นการตัดสินใจที่ต้องผ่านเจ้าของ/CPA ก่อน

บัญชีที่ **ปลอดภัย** สำหรับ JV มือ (ไม่มีเลนส์ไหนอ่าน): เงินสด/ธนาคาร `S11-11xx`/`S11-12xx` ·
สินค้าคงเหลือ `S11-200x` · เจ้าหนี้การค้า `S21-1101/1102/1103` · เงินรับล่วงหน้า `S21-2001/2002` ·
เงินกู้ยืมกรรมการ `S21-4101` · ส่วนของเจ้าของ `S31/S32/S33-1101`

> **หมายเหตุ:** `POST /journal` **ไม่ตรวจ**ว่ารหัสบัญชีตรงกับ `companyId` ที่ผูกไว้
> (`journal.service.ts` — *"no companyId scoping"*) ⇒ ใบที่ใช้รหัส `S` แต่ผูก FINANCE จะ
> **หายจากทั้งสองรายงานโดยงบทดลองยังสมดุล** (รายงานกรอง `companyId` เมื่อ `scope != ALL`)
> ตรวจก่อน post เสมอ — ใบสร้างเป็น `DRAFT` และ DRAFT ไม่เข้างบทดลอง จึงมีจังหวะให้ตรวจอยู่แล้ว

### CSV loader regex

`apps/api/src/modules/journal/__tests__/csv-fixture-loader.ts` accepts `^S?\d{2}-\d{4}$` so both FINANCE and SHOP CoA CSVs parse with the same loader.

### Seeders

- `seedShopCoa(prisma)` — idempotent upsert (matches `seedFinanceCoa` shape; preserves owner-set `peakCode` values)
- Called from:
  - `apps/api/prisma/seed.ts` (dev reset)
  - `apps/api/prisma/seed-production.ts` (prod fresh seed)
  - `apps/api/src/cli/seed-coa.cli.ts` (`npm run seed:coa` — non-destructive upsert)
  - `apps/api/src/cli/wipe-accounting.cli.ts` (`npm run wipe:accounting` — destructive Phase A.4 helper)

### PairedJournalService

`apps/api/src/modules/journal/paired-journal.service.ts` posts BOTH SHOP and FINANCE JEs atomically in one `$transaction`, stamping the SAME `metadata.batchId` on both so audit reports can pair them. Each half is balance-checked up front; an unbalanced half throws BEFORE either side is posted.

```ts
await pairedJournal.postPaired({
  shop:    { companyCode: 'SHOP',    description: '...', lines: [...] },
  finance: { companyCode: 'FINANCE', description: '...', lines: [...] },
  batchRef: contractId,
});
```

Currently only inventory transfer uses paired wrapping; the existing FINANCE templates (e.g. `ContractActivation1ATemplate`) already book the FINANCE side of contract activation so most SHOP templates ship as SHOP-only single-side JEs.

### SHOP JE templates

> **⚠️ WIRING STATUS — DEFERRED (verified 2026-06-11).** The templates below are SCAFFOLDED
> (code + golden specs + module registration) but **only `ShopExchangeReturnTemplate` is wired
> to a production caller** (`contract-exchange.service.ts:396`). The other templates
> (`ShopCashSaleTemplate`, `ShopDownPaymentTemplate`, `ShopDownPaymentReversalTemplate`,
> `ShopInventoryTransferTemplate`, `ShopTradeInTemplate`, `ShopExpenseTemplate`) have **ZERO
> production callers** — contract activation / trade-in accept / cash sale do NOT post SHOP
> JEs. Consequence: the SHOP Trial Balance + P&L at `/shop/accounting` are **near-empty** even
> though SHOP is actively selling (real numbers live in the `Sale` table / Dashboard). The
> "Trigger" column below is the **intended** trigger, not a live one. Wiring is gated on an
> owner scope decision (Phase A.5 brief §4: should contract activation post SHOP+FINANCE
> atomically?). Do NOT treat the SHOP reports as authoritative for tax/audit until these are
> wired. Tracking: `docs/ceo-review/deep-audit-2026-06-11-findings.md` (F3).
>
> **Stale note (2026-08-01):** this box predates two events documented elsewhere in this file.
> (1) `ShopInventoryTransferTemplate` DID gain a production caller on 2026-06-23
> (`contract-workflow.service.ts`, commit `bbcfa7a3`, PR #1280) — see "Installment lifecycle
> 3-event flow" below; this box's "ZERO production callers" claim no longer holds for that one
> template specifically. (2) `ShopFinanceReceiptTemplate` — listed here as unwired as of
> 2026-06-11 — was **deleted outright** on 2026-08-01 (Inter-Co Settlement Batch, C2); it is
> removed from the list above rather than left as a dangling reference to a class that no
> longer exists. See "Inter-Co Settlement Batch — เมนูจ่ายให้หน้าร้าน (C2, 2026-08-01)" below.
>
> **Stale note #2 (2026-08-23 — void-sale Task 7):** `ShopCashSaleTemplate` is **ALSO wired**
> and has been since **2026-06-23** (commit `3a3fb03c2`, PR #1285 — `sale-writer.service.ts`
> `createCashSale` calls `execute()` once per product in the sale, bundle-aware). Cash POS sales
> DO post SHOP JEs; do not read this box as "the cash sale does not hit the ledger". That wiring
> shipped with a latent bug (F1 — per-piece JEs sharing one `reference`) that made every cash
> sale with a cost-bearing bundle item fail outright until 2026-08-23; see "ยกเลิกใบขาย (void
> sale)" below. The remaining genuinely-unwired templates in this list are
> `ShopDownPaymentTemplate` / `ShopDownPaymentReversalTemplate` / `ShopTradeInTemplate` /
> `ShopExpenseTemplate` (not re-verified 2026-08-23 — verify callers before relying on this).
>
> **Stale note #3 (2026-09-28 — ตรวจซ้ำแล้ว):** template ทั้งสี่ตัวข้างบน **มี production caller
> ครบแล้ว** (`contract-workflow.service.ts` / `contract-lifecycle.service.ts` /
> `trade-in-lifecycle.service.ts` / `expense-document-lifecycle.service.ts`) ⇒ ไม่เหลือ template
> ในรายการนี้ที่ยังไม่ถูกต่อ. **ที่ยังไม่ลงบัญชีจริง** คือเส้นทางที่ไม่มี template เลย:
> รับสินค้าเข้าจากใบสั่งซื้อ (`po-receiving.service.ts`) และการปรับสต๊อก
> (`stock-adjustments.service.ts`) — ไม่มีโค้ดไหน `Dr S11-2001` ตอนรับของ ⇒ ขายแล้วบัญชีสินค้าคงเหลือ
> เครื่องใหม่ติดลบ (รายได้/ต้นทุนขายถูก · สินค้าคงเหลือ/เจ้าหนี้ผู้จัดจำหน่ายผิด). ป้ายเตือนบนหน้า
> `/shop/accounting` เขียนตามข้อเท็จจริงนี้. รายการบัญชีตอนรับของ **ต้องให้ฝ่ายบัญชีเคาะก่อน — ห้ามเดา**.
>
> **Stale note #4 (2026-09-29):** ฝ่ายบัญชีเคาะแล้ว และ **การรับสินค้าเข้าลงบัญชีแล้ว**
> (`ShopGoodsReceivingTemplate` — ดูหัวข้อ "รับสินค้าเข้าจากใบสั่งซื้อ — ลงบัญชีตอนรับของ" ด้านล่าง).
> ที่ยังไม่ลงบัญชีเหลือ **การจ่ายเงินผู้จัดจำหน่าย (รวมมัดจำ)** และ **การปรับสต๊อก** เป็นสองก้อนหลัก —
> รายการเต็ม (รวมตีกลับจากคิวรอถ่ายรูป / แก้ต้นทุนด้วยมือ / เพิ่ม-ลบสินค้าด้วยมือ / ยอดยกมา) อยู่ในตาราง
> "ที่ยังเปิดอยู่" ของหัวข้อนั้น.

All live at `apps/api/src/modules/journal/cpa-templates/`. Each is idempotent via `metadata.flow + metadata.idempotencyKey` (DB-level partial unique index since P3-SP5 DEEP fix W8 — `journal_entries_idempotency_idx`).

`CompanyResolverService` (`apps/api/src/modules/journal/company-resolver.service.ts`) is the single source of truth for `companyCode → companyId` lookup. Templates inject it instead of caching per-instance state — eliminates stale-id bugs across test seed cycles (P3-SP5 DEEP fix W3).

| Template | Trigger | Companies | Notes |
|---|---|---|---|
| `ShopCashSaleTemplate` | Sale w/ `saleType=CASH` (**LIVE** since 2026-06-23, `sale-writer.service.ts`) | SHOP only | Dr cash / Cr revenue + Dr COGS / Cr inventory. No FINANCE involvement. **One JE per (sale, product)** — bundle items get their own JE (skipped when allocated revenue = 0, e.g. zero-cost freebie). `productId` is a REQUIRED input; `reference = sale:<saleId>:<productId>`, `idempotencyKey = shop-cash-sale:<saleId>:<productId>`, `metadata.saleId` stamped (the void sweep key). F1 fix 2026-08-23 — see "ยกเลิกใบขาย (void sale)". |
| `ShopDownPaymentTemplate` | Customer pays down at contract creation | SHOP only | Dr cash / Cr S21-2001 (down payable). Cleared by `ShopInventoryTransferTemplate` at activation (NOT by settlement — that's the C1 bug fixed). |
| `ShopDownPaymentReversalTemplate` (W2) | Contract canceled BEFORE activation | SHOP only | Dr S21-2001 / Cr cash. Stamps `metadata.reversedByIdempotencyKey` onto the original down JE. |
| `ShopInventoryTransferTemplate` | Contract activated (ownership SHOP→FINANCE) | SHOP only* | Posts TWO JEs in one `$transaction` sharing `metadata.batchId`: (A) Dr S50-XXXX / Cr S11-200X (COGS); (B) Dr S11-3001 + Dr S11-3002 + Dr S21-2001 / Cr S41-XXXX + Cr S41-1201 (revenue + receivables + down clearance). ASSERTS `financedAmount + downAmount === salePrice`. |
| ~~`ShopFinanceReceiptTemplate`~~ | ~~FINANCE wires `financedAmount + commission` to SHOP~~ | — | **DELETED 2026-08-01** (Inter-Co Settlement Batch, C2) — superseded by `IntercoSettlementService.approveBatch`'s `buildShopLines`, which posts the SAME clearing leg (`Dr <shopBankCode> / Cr S11-3001 + Cr S11-3002`) directly via `PairedJournalService`/`JournalAutoService`, batched across many contracts per wire instead of one template call per contract. See "Inter-Co Settlement Batch — เมนูจ่ายให้หน้าร้าน (C2, 2026-08-01)" below. |
| `ShopTradeInTemplate` (W4) | Trade-in ACCEPTED | SHOP only | Dr `inventoryAccountCode` (default S11-2002 sellable used; optional override to S11-2004 pending evaluation) / Cr cash. |
| `ShopExpenseTemplate` | Branch expense recorded (rent/salary/utilities/etc) | SHOP only | CASH mode (Dr expense / Cr bank) or ACCRUAL mode (Dr expense / Cr S21-1103 payable). |

*`ShopInventoryTransferTemplate` is SHOP-only by design — `ContractActivation1ATemplate` posts the FINANCE side. Phase 3 SP7 will reroute through `PairedJournalService` once SHOP and FINANCE split into separate legal companies.

### Installment lifecycle 3-event flow (P3-SP5 DEEP fix C1+C2)

The complete SHOP-side bookkeeping for one installment contract:

```
Event 1 — Customer pays down (at contract creation):
  ShopDownPaymentTemplate
    Dr  S11-1101 / S11-1201 (cash/bank)   [downAmount]
       Cr S21-2001 (down-payment payable)  [downAmount]

Event 2 — Contract activation = ownership transfer SHOP → FINANCE:
  ShopInventoryTransferTemplate  (2 JEs in one $tx, shared batchId)
    JE A (COGS):
      Dr  S50-1101/02/03 (COGS)          [costPrice]
         Cr S11-2001/02/03 (inventory)    [costPrice]
    JE B (revenue + receivable + down clearance):
      Dr  S11-3001 (FINANCE rec - financed) [financedAmount]
      Dr  S11-3002 (FINANCE rec - commission) [commission]
      Dr  S21-2001 (clear down-payable)     [downAmount]
         Cr S41-1101/02/03 (revenue)       [salePrice]
         Cr S41-1201 (commission income)   [commission]
    INVARIANT: financedAmount + downAmount === salePrice

Event 3 — FINANCE wires payment to SHOP (may be days later, may be batched):
  [RETIRED 2026-08-01 — was ShopFinanceReceiptTemplate, one contract at a time.
   Now: IntercoSettlementService.approveBatch, one JE per BATCH of contracts —
   see "Inter-Co Settlement Batch — เมนูจ่ายให้หน้าร้าน (C2, 2026-08-01)" below]
    Dr  <shopBankCode> (bank, default S11-1201)   [Σ financedGl + commissionGl over the batch]
       Cr S11-3001 (clear receivable, per contract) [financedGl]
       Cr S11-3002 (clear commission rec, per contract, skips zero) [commissionGl]
```

Cancellation paths:

```
Cancel BEFORE activation (Event 2 hasn't happened):
  ShopDownPaymentReversalTemplate
    Dr  S21-2001                          [downAmount]
       Cr S11-1101/1201 (refund cash)     [downAmount]

Cancel AFTER activation:
  use existing RepossessionJP5Template (FINANCE side) +
  future SHOP repossession-reversal template (deferred to P3-SP7).
```

### Reports — multi-scope balance check (P3-SP5 DEEP fix C5)

`getTrialBalance(asOfDate, scope)` and `getProfitLossFromJournal(start, end, companyId, scope)` now return per-scope subtotals always:

```ts
tb.perScope.shop    = { drTotal, crTotal, isBalanced }
tb.perScope.finance = { drTotal, crTotal, isBalanced }
tb.isAllBalanced    = scope==='ALL' ? (shop.isBalanced && finance.isBalanced) : <single>
```

`isAllBalanced` is STRICTER than the legacy combined `isBalanced` — for `scope='ALL'` it requires BOTH halves to balance independently, not just `grandDrTotal === grandCrTotal` (which can be coincidentally equal when the SHOP unbalance is equal-and-opposite to the FINANCE unbalance).

`getProfitLossFromJournal` likewise exposes `perScope.{shop,finance}.{revenueTotal, expenseTotal, netIncome}`.

W7 defense-in-depth: when `scope !== 'ALL'`, queries also filter by `journalEntry.companyId` (resolved via `CompanyResolverService`) — so even a misposted JE (S-code line under FINANCE companyId or vice versa) won't leak into the wrong report.

### Monthly close snapshot (P3-SP5 DEEP fix W1)

`MonthlyCloseService.generateReportSnapshots()` now calls `getTrialBalance(asOfDate, 'ALL')` so both FINANCE and SHOP rows make it into the closed-period snapshot. Without the explicit scope the SHOP half was silently dropped (default scope = FINANCE).

### Reports — endpoints

Two endpoints in `accounting.controller.ts`:

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/expenses/ledger/shop/trial-balance` | OWNER, FM, ACC | SHOP-scoped Trial Balance (filters `code.startsWith('S')` + companyId) |
| GET | `/expenses/ledger/shop/profit-loss` | OWNER, FM, ACC | SHOP-scoped P&L (Revenue=S41+S42, Expenses=S50+S51+S52+S53) |

W5 policy decision: BRANCH_MANAGER is INTENTIONALLY excluded from these endpoints — they aggregate across ALL SHOP branches into one report, and BM is NOT in `CROSS_BRANCH_ROLES` (see `apps/api/src/modules/auth/branch-access.util.ts`). Widening @Roles to include BM would 403 at BranchGuard anyway. A future per-branch SHOP P&L (with `?branchId=` filter) can re-add BM.

The existing `/expenses/ledger/trial-balance` and `/expenses/ledger/profit-loss` accept `scope=FINANCE|SHOP|ALL` (defaults to `FINANCE` for backward compat). The shop-specific paths are syntactic sugar for `?scope=SHOP`.

`AccountingService.codePrefix(code)` extracts the section prefix correctly for both FINANCE (`11-1101` → `11`) and SHOP (`S11-1101` → `S11`). `SECTION_MAP` includes both sets of prefixes with SHOP entries suffixed " (SHOP)" so a combined view (scope=ALL) makes the partition obvious.

### Frontend

`/shop/accounting` — `apps/web/src/pages/ShopAccountingPage.tsx`. Two tabs (Trial Balance + P&L) with date pickers. Wired into OWNER / FINANCE_MANAGER / ACCOUNTANT menu configs under the SHOP zone with consistent label "บัญชีหน้าร้าน (SHOP)" + Store icon (W6 standardisation). BRANCH_MANAGER does NOT see this menu (W5 policy — would 403 at the API).

### Out of scope for P3-SP5 (deferred to P3-SP7)

- Multi-entity legal split (`from_company_id`/`to_company_id` on JEs become FK to separate companies)
- SHOP-side VAT reports (SHOP not VAT-registered)
- SHOP-side payroll/SSO (handled at FINANCE level for now)
- Historical migration of past SHOP transactions (forward-only)
- SHOP-side balance sheet (Trial Balance + P&L only in SP5)

---

## รับสินค้าเข้าจากใบสั่งซื้อ — ลงบัญชีตอนรับเข้าคลัง (2026-09-29 · ปรับตามคำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8)

โค้ด: `purchase-orders/services/po-receiving.service.ts` (`runReceiveInTx` — ทางเดียวของทั้งรับตามใบสั่งซื้อ
และรับเข้าตรง) · `purchase-orders/services/receiving-acceptance-journal.ts` (หน่วยที่ลงตอนผ่านเข้าคลัง) ·
`purchase-orders/services/po-unit-cost.util.ts` · `journal/cpa-templates/shop-goods-receiving.template.ts` ·
Integration: `purchase-orders/__tests__/po-receiving-journal.integration.spec.ts` (CI glob `PO_FILES`)

**คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8 — "ปรับโปรแกรมลงสินค้าเข้าคลังและเจ้าหนี้ โดยไม่ลงสินค้าที่ไม่รับเข้าคลัง":**
ลงบัญชีเฉพาะหน่วยที่ **รับเข้าคลังจริง** (`IN_STOCK`) — หน่วยที่เข้าคลังทันทีตอนรับของ (มือถือใหม่ · อุปกรณ์เสริม ·
แท็บเล็ต · มือสองที่ถ่ายรูปครบ 6 มุมและมีราคาในใบรับของ) ลงในรายการของใบรับของ; มือสองที่ต้องเข้าคิวรอถ่ายรูป
(`PHOTO_PENDING`) **ยังไม่ลง** แล้วลงทีละหน่วยตอนผ่านเข้าคลังผ่าน `ReceivingAcceptanceJournal.bookIfPending` —
เครื่องที่ถูกกด "ไม่รับเข้าคลัง" (`rejectQC`) จึงไม่มีรายการบัญชีเลย. แถว `GoodsReceivingItem` เก็บ `receivedCost`
(ต้นทุนที่ปันไว้ตอนรับของ — ยอดที่ลง ไม่ใช่ `Product.costPrice` ปัจจุบันซึ่งแก้มือได้) และ `journalEntryId` (null = ยังไม่ลง) —
migration `20261016000000_goods_receiving_item_journal`.

**กติกาที่ต้องรักษา (invariant):** เครื่องจากใบสั่งซื้อออกจากสถานะก่อนเข้าคลัง (`PHOTO_PENDING` / `INSPECTION` /
`REFURBISHED` / ของหาย-ของเสีย) มาเป็น `IN_STOCK` ได้ทาง **4 ประตู** เท่านั้น และทั้ง 4 เรียก `bookIfPending` ใน tx
เดียวกับการเปลี่ยนสถานะ: `ProductPhotosService.completePhotos` · `ProductsService.update` (PATCH) ·
`ProductsService.returnToStock` · stock adjustment `FOUND`. ที่อื่นที่เขียน `status: 'IN_STOCK'` **ไม่ต้องเรียก** เพราะเป็น
เส้นทาง **คืนสภาพ** ของเครื่องที่เคยเป็น `IN_STOCK` มาก่อน (ขาย/จอง/โอน/จัดชุดของแถมต้องเริ่มจาก `IN_STOCK` ⇒ เครื่องผ่าน
ประตูมาแล้ว ลงบัญชีไปแล้ว): ยกเลิกสัญญา (`contract-cancellation.service.ts`) · ยกเลิกเปลี่ยนเครื่อง
(`contract-exchange-cancel.service.ts`) · ยกเลิกใบขาย (`sale-void.service.ts`) · ปลดจอง (`stock-reservation.service.ts`,
`contract-lifecycle.service.ts`) · ปลดของแถม (`contract-bundle.util.ts`) — บวกงานนำเข้าข้อมูล/CLI ทดสอบ (`tooltify-stock-parser`,
`seed-test-contracts`, `test-pack`) ที่ไม่มีใบรับของ. รายชื่อครบอยู่ที่หัวไฟล์ `products/product-enter-stock.util.ts`.
**ประตูใหม่ที่พาเครื่องจากสถานะก่อนเข้าคลังมา `IN_STOCK` ต้องเรียก `bookIfPending`** ไม่งั้นเครื่องจากใบสั่งซื้อจะอยู่ในคลัง
โดยไม่มีสินค้าคงคลัง/เจ้าหนี้ในบัญชี

**กดพร้อมกัน (ผลตรวจทานอิสระ 2026-09-30):** `bookIfPending` ล็อกแถวใบรับของแล้วตรวจซ้ำว่าเครื่องยัง `IN_STOCK` และไม่ถูกลบ —
ไม่ใช่ = 409 ทั้งรายการย้อนกลับ (การตีกลับ commit ก่อนแล้วผู้เรียก update สถานะทับเครื่องที่ถูกลบ) · `rejectQC` ลบด้วย
`updateMany` ที่มีเงื่อนไข `status: PHOTO_PENDING, deletedAt: null` และจำนวนต้องครบ — ไม่ครบ = 409 (อีกฝั่งยืนยันรูปเข้าคลัง
ไปก่อน). ไม่ใช้ `SELECT … FOR UPDATE` ใน `rejectQC` เพราะประตูเข้าคลังล็อกแถวสินค้าก่อนแถวใบรับของ — ล็อกกลับลำดับ = deadlock
· บัญชีเจ้าหนี้ของหน่วยที่ลงตอนผ่านเข้าคลังตามหมวดของรายการในใบสั่งซื้อ (`receivingCategory` — ตัวเดียวกับตอนรับของ) ส่วน
บัญชีสินค้าตามหมวดปัจจุบันของเครื่อง · ลงวันที่รับเข้าคลังแทนวันที่ใบรับของ (งวดปิดแล้ว) stamp `metadata.postedOnAcceptanceDate`

**คำตัดสินเจ้าของ 2026-09-29 + คำตอบฝ่ายบัญชี 2026-09-29 (ข้อ ข1 ข2 ข5) — ปิดประเด็น:**

```
Dr S11-2001 / S11-2002 / S11-2003 สินค้าคงคลัง (ตามประเภท)   [ต้นทุนของหน่วยที่รับ]
   Cr S21-1101 เจ้าหนี้ - ซัพพลายเออร์มือถือ   (มือถือใหม่ มือสอง แท็บเล็ต)
   Cr S21-1102 เจ้าหนี้ - อุปกรณ์เสริม
```

| เรื่อง | กติกา |
|---|---|
| หน่วยของรายการ | หนึ่งใบรับของ (`GoodsReceiving`) = หนึ่ง JE **ของหน่วยที่เข้าคลังทันที** — ใบสั่งซื้อที่รับหลายครั้งลงตามจำนวนที่รับจริงแต่ละครั้ง · หน่วยที่ตรวจไม่ผ่าน (`REJECT`) ไม่เข้ารายการ · หน่วยที่รอถ่ายรูป = หนึ่ง JE ต่อหน่วยตอนผ่านเข้าคลัง (`idempotencyKey: shop-goods-receiving-unit:<productId>` · `reference: gr:<receivingId>:<productId>` · `metadata.acceptedProductId` · คำอธิบาย "รับสินค้าเข้าคลังหลังตรวจรับ …") · ไม่มีหน่วยเข้าคลังเลย = ไม่มี JE ของใบรับของ (ผลลัพธ์บอก `unitsAwaitingStockEntry`) |
| วันที่ของหน่วยที่ลงตอนผ่านเข้าคลัง | วันแรกที่งวดยังเปิดตามลำดับ **วันที่ในเอกสาร → วันที่รับของ → วันที่รับเข้าคลัง** (`receivingPostingCandidates()` + วันรับเข้าคลัง — สองวันแรกตัวเดียวกับใบรับของ) · **ทุกวันก่อนวันรับเข้าคลังคือการลงย้อนหลัง ⇒ ตัดสินด้วย `isPeriodClosedForBackdating` (ตรวจเข้ม ไม่มีช่วงผ่อนผัน — ดูแถวถัดไป)** ทั้งวันที่ในเอกสารและวันที่รับของ (ผลตรวจทานรอบ 5: ถ้าวันที่รับของใช้ `validatePeriodOpen` เครื่องที่เข้าคลังต้นเดือนจะลงกลับเข้าเดือนที่ฝ่ายบัญชีเพิ่งปิด) · วันรับเข้าคลัง (วันนี้) ใช้ `validatePeriodOpen` ตามกติกาทั้งระบบ — เดือนปัจจุบันลงได้ตลอดช่วงผ่อนผันจึงแทบไม่ถูกปฏิเสธ (ฝ่ายบัญชีปิดเดือนปัจจุบันก่อนสิ้นเดือน = ลงในเดือนที่ปิดนั้นพร้อม stamp + งานแจ้ง · ปิดและพ้นช่วงผ่อนผัน = ปฏิเสธ) · ไม่ปฏิเสธการเข้าคลังเพราะงวดของวันที่ลงย้อนหลัง (พนักงานถ่ายรูปเปิดงวดเองไม่ได้) · ข้ามวันไหนไป = log เตือน + stamp `postedOnReceiveDate` / `postedOnAcceptanceDate` **+ สร้างงานแจ้งฝ่ายบัญชีใน tx เดียวกัน** (`/todos` MEDIUM tag `goods-receiving-period` + แท็กกันซ้ำ `receivingPeriodTodoKey(grNumber, receive|acceptance)` = `gr:<เลขใบรับของ>:<วันที่ที่ลงแทน>` เทียบด้วย `hasEvery` ไม่ค้นจากชื่องาน (เลขใบรับของเติมศูนย์ 3 หลัก — GR-…-100 อยู่ในชื่อของ GR-…-1000) · งานตอนรับของถือคีย์ `receive` เดียวกัน · หน่วยที่ตกไปลงวันรับเข้าคลัง ได้งานของตัวเอง · ชื่องาน/รายละเอียดบอกทุกวันที่ที่ถูกข้ามและเดือนของมัน · ผู้สร้าง = `receivedById` ของใบรับของ · สองเครื่องเข้าคลังพร้อมกันอาจได้งานซ้ำ — ไม่มีผลต่อบัญชี) · **ยังไม่ได้ถามฝ่ายบัญชี** — ถามในเอกสารฉบับถัดไป |
| ต้นทุนต่อหน่วย | **ราคารวม VAT หลังแบ่งส่วนลดท้ายบิลตามสัดส่วนราคา** — ปันยอดสุทธิแบบ **ปัดสะสมสองชั้น** (`po-unit-cost.util.ts`): ต้นทุนของรายการที่ i = `round(net × มูลค่าสะสมถึง i ÷ มูลค่ารวม) − round(… ถึง i−1)` แล้วต้นทุนของหน่วยที่ k ของรายการ = `round(ต้นทุนรายการ × k ÷ จำนวน) − round(… × (k−1) ÷ จำนวน)` · ส่วนลดก่อน VAT และหลัง VAT ถูกแบ่งทั้งคู่ เพราะคิดจากยอดสุทธิที่ต้องจ่ายผู้จัดจำหน่ายจริง ⇒ **เมื่อรับครบทั้งใบ** Σ ต้นทุนทุกหน่วย = ยอดสุทธิ = เจ้าหนี้ที่ตั้ง (รับไม่ครบ = เจ้าหนี้ที่ตั้งเท่าต้นทุนของหน่วยที่รับจริง) · หน่วยในรายการเดียวกันต่างกันได้ไม่เกิน 1 สตางค์ · รายการราคา 0 (ของแถมจากผู้จัดจำหน่าย) และใบที่ยอดสุทธิ 0 = ต้นทุน 0 |
| ยอดสุทธิที่ใช้ปัน | คิดจาก **องค์ประกอบ** (`Σ จำนวน × ราคา − discount + vatAmount − discountAfterVat`) ไม่เชื่อคอลัมน์ `netAmount` ตรง ๆ — คอลัมน์นั้น default 0 และแถวที่สร้างข้าม service (seed / ข้อมูลเก่า) ไม่ได้ตั้ง; ถ้าเชื่อ 0 ทุกเครื่องจะได้ต้นทุนศูนย์และไม่มี JE โดยเงียบ · ไม่ตรงกับคอลัมน์ = เตือนใน log แล้วใช้ค่าที่คิดได้ (`resolveNetAmount`) |
| `Product.costPrice` | **เก็บต้นทุนตัวเดียวกับที่ลงบัญชี** (เดิม = `POItem.unitPrice` ก่อน VAT ก่อนส่วนลด ผ่าน `Number()`) — ตอนขาย ต้นทุนขายเครดิตบัญชีสินค้าด้วย `costPrice` บัญชีสินค้าจึงกลับเป็นศูนย์พอดี · **กำไรขั้นต้นที่แสดงของเครื่องที่รับหลังวันนี้จึงลดลงเท่า VAT ซื้อ** (ตัวอย่าง 10,000 + VAT 700 ขาย 13,900: กำไร 3,900 → 3,200) |
| เศษสตางค์ | ไม่มีเศษเหลือให้ลงทีหลัง — การปัดสะสมทำให้ผลรวมเท่ายอดปลายทางพอดี · **หน่วยที่ตรวจผ่านเป็นลำดับที่ k ของรายการ (นับข้ามใบรับของ) ได้ต้นทุนของหน่วยที่ k เสมอ** จึงไม่ขึ้นกับว่ารับกี่ครั้งหรือรับรายการไหนก่อน · หน่วยที่ตรวจไม่ผ่านไม่กินลำดับ · **ห้ามกลับไปใช้ "ปัดรายหน่วยแล้วลงเศษหน่วยเดียวตอนรับครบ"**: ใบที่มีหน่วยราคาถูกจำนวนมาก (1,000 × 1.00 ส่วนลด 4.99 → เศษ −4.99) หรือรับของแถมราคาศูนย์เป็นชิ้นสุดท้าย ทำให้ต้นทุนติดลบและรับของไม่ครบตลอดไป (ผลตรวจทาน 2026-09-29) |
| VAT | SHOP ไม่จด VAT — ไม่มีบรรทัดภาษีซื้อ · การนำภาษีซื้อของเครื่องที่ขายผ่อนในเครือไปใช้เป็นเรื่องของสมุดไฟแนนซ์ (**ยังรอคำตอบฝ่ายบัญชี** — ข้อเสนอ `Dr 11-4101 / Cr 42-1108` ยังไม่ได้รับการยืนยัน ห้ามลงมือ) |
| วันที่ลงบัญชี (ข3 — ทำแล้ว 2026-10-01) | **วันที่ในเอกสารของผู้จัดจำหน่าย** (คำตอบฝ่ายบัญชีข้อ ข3 + แบบหน้าจอที่เจ้าของเคาะ 2026-10-01 artifact `TJnBm1PU3mx1BHD871RrvS`) — ใบรับของเก็บ `supplierDocType` (`TAX_INVOICE` / `DELIVERY_NOTE` / `CASH_BILL` / `NONE`) · `supplierDocNumber` · `supplierDocDate` (เที่ยงคืนเวลาไทย · migration `20261017000000_goods_receiving_supplier_doc`) · ลำดับวันที่ `receivingPostingCandidates()` (`receiving-acceptance-journal.ts` — มีวันที่ในเอกสาร = [วันที่ในเอกสาร, วันที่รับของ] ไม่มี = [วันที่รับของ]; ตอนรับของ วันที่รับของ = วันนี้ จึงตัดสินด้วย `validatePeriodOpen` ตามกติกาทั้งระบบ — เดือนปัจจุบันที่ถูกปิด ยังลงได้ด้วยช่วงผ่อนผันเหมือนรายการอื่นทุกชนิด ไม่ได้แก้ในงานนี้) · กติกาช่อง `normalizeSupplierDoc` (`purchase-orders/services/supplier-doc.util.ts` — หน้าเว็บมีสำเนา `supplierDocErrors` ข้อความตรงกัน): ประเภทบังคับที่ DTO (ผู้เรียกภายในที่ไม่ส่ง = ลงวันที่รับของแบบเดิม) · มีเอกสาร = เลขที่ + วันที่บังคับ วันที่ไม่เกินวันนี้และ**ย้อนหลังไม่เกิน 365 วัน** (ปฏิทินไทย — กันปีพิมพ์ผิดไปลงเดือนที่ไม่เคยมีแถวงวด; `SUPPLIER_DOC_MAX_AGE_DAYS` — เป็นค่าที่เราตั้งเอง ไม่ใช่คำตอบฝ่ายบัญชี) · **ไม่มีเอกสาร = ลงวันที่รับของ + บังคับเหตุผลในช่องหมายเหตุ** · **งวดของวันที่ในเอกสารปิดแล้ว (แบบ ข) = รับได้ ลงวันที่รับของแทน** เก็บวันที่ในเอกสารตามจริง — ตัดสินด้วย **`isPeriodClosedForBackdating` ซึ่งตรวจเข้มกว่าตอนลงบัญชี** (ใช้กับทุกวันที่ที่ลงย้อนหลัง): แถวงวดของเดือนไทยนั้นเป็น `CLOSED`/`SYNCED` = ปิด **ไม่มีช่วงผ่อนผัน** (ถ้าใช้ `validatePeriodOpen` ตรง ๆ ช่วงผ่อนผันต้นเดือนจะปล่อยให้ลงในเดือนที่ปิดงวดแล้ว — ผลตรวจทานอิสระ 2026-10-01) · ไม่ใช่สองสถานะนั้น = ใช้ `validatePeriodOpen` ตามเดิม · ใช้ตัวเดียวกันทั้งตอนรับของ / หน่วยที่ลงตอนผ่านเข้าคลัง / `GET /purchase-orders/receiving-doc-check` · stamp `metadata.supplierDocType/Number/Date` + `postedOnReceiveDate` · หลัง commit สร้างงาน (`/todos`) MEDIUM tag `goods-receiving-period` แจ้งฝ่ายบัญชี **เฉพาะเมื่อมีรายการลงจริงหรือมีหน่วยรอเข้าคลัง** (ทุกหน่วยตรวจไม่ผ่าน = ไม่มีอะไรต้องแจ้ง) — ห้าม throw · ผลลัพธ์บอก `supplierDocPeriodClosed` + `accountingNotified` (สร้างงานไม่สำเร็จ = ข้อความบนจอบอกให้แจ้งฝ่ายบัญชีเอง ไม่อ้างว่าแจ้งแล้ว) · วันที่รับของอยู่ในงวดที่ปิดด้วย = ปฏิเสธตามเดิม · เลขที่ซ้ำของผู้จัดจำหน่ายเดิม = เตือนบนจอ ไม่บล็อก (`GET /purchase-orders/receiving-doc-check` OWNER/BM — ค้นแบบไม่สนตัวพิมพ์ จึงไม่ได้ใช้ index ของคอลัมน์ — ยอมรับได้ที่ปริมาณวันนี้) · หมายเหตุ: `validatePeriodOpen` อ่านเดือนตามเขตเวลาของโปรเซส — เอกสารลงวันที่ 1 ของเดือนบนโปรเซส UTC (jest/CI) ถูกตรวจกับงวดของเดือนก่อน (prod รันเวลาไทย ไม่มีผล; ขั้นตรวจเข้มของ `isPeriodClosedForBackdating` อ่านแถวงวดด้วยเดือนไทย ส่วนตาข่าย `validatePeriodOpen` ข้างในอ่านตามเขตเวลาของโปรเซส — บนโปรเซส UTC เอกสารวันที่ 1 จึงอาจถูกนับว่าปิดตามงวดของเดือนก่อน ซึ่งตรงกับที่การลงบัญชีจะบังคับอยู่แล้ว) |
| Atomic | โพสต์ใน Serializable tx เดียวกับการรับของ — JE พัง/งวดบัญชี SHOP ปิด = การรับของไม่เกิด (ปักด้วย integration "รายการบัญชีพัง → การรับของทั้งใบไม่เกิด") · retry ของ P2002/P2034 ปลอดภัยเพราะทั้ง tx ถูก roll back · ทั้งสอง tx ตั้ง `timeout: 30_000` (ค่าเริ่มต้นของ Prisma 5 วินาที และ P2028 ไม่อยู่ในรายการ retry) |
| ไม่มี JE | ยอดรวมต้นทุนของใบรับของเป็นศูนย์ (ของแถมล้วน / ใบที่ยอดสุทธิ 0) หรือไม่มีหน่วยผ่านเลย ⇒ template คืน `null` ไม่โพสต์ใบเปล่า และ `journalEntryNo` ในผลลัพธ์เป็น `null` |
| metadata | `tag: 'SHOP_GOODS_RECEIVING'`, `flow: 'shop-goods-receiving'`, `idempotencyKey: shop-goods-receiving:<receivingId>`, `receivingId`, `grNumber`, `poId`, `poNumber`, `companyCode: 'SHOP'`, `unitCount`, `totalCost`, `productIds` (หน่วยที่อยู่ในรายการนี้) · `reference: gr:<receivingId>` · **ไม่ stamp `contractId`/`saleId`** |
| Dependency | `PurchaseOrdersService` รับ `ShopGoodsReceivingTemplate` + `ShopAccountResolver` + `CompanyResolverService` แบบ **บังคับ** (ไม่ใช่ `@Optional()`) — provider หายต้องบูตไม่ขึ้น ไม่ใช่รับของโดยไม่ลงบัญชี · spec ใช้ `po-journal.test-helpers.ts` |
| ยอดสุทธิติดลบ | **สร้างไม่ได้แล้ว** — `assertPoNetNotNegative` (`po-amounts.util.ts`) ปฏิเสธทั้ง `create()` และ `directReceive()` พร้อมบอกให้แก้ส่วนลด (รับเข้าตรงสร้างใบสั่งซื้อใน tx เดียวกับการรับของ ถ้าปล่อยให้ด่านตอนรับของปฏิเสธ ข้อความจะอ้างเลขใบที่ถูก roll back) · ด่านตอนรับของเหลือไว้สำหรับแถวเก่า ข้อความแยกสองกรณี: ยังไม่เคยรับของ → ปุ่ม "ยกเลิก PO" · รับไปบางส่วนแล้ว (ปุ่มถูกซ่อน) → แจ้งผู้ดูแลระบบ |
| ราคาเติมอัตโนมัติตอนสั่งซ้ำ | `ProductsService.findAccessorySkus` คืน `lastCost` = **ราคาในใบสั่งซื้อของชิ้นล่าสุด (ก่อน VAT)** ไม่ใช่ `cost_price` — ช่องราคาของใบสั่งซื้อเป็นราคาก่อน VAT ถ้าเติมด้วยต้นทุนรวม VAT จะทบ VAT ทุกรอบ (500 → 535 → 572.45) · ชิ้นที่ไม่ได้มาจากใบรับของใช้ `cost_price` ตามเดิม |
| Serializable | การรับของเป็น Serializable tx ที่ **อ่านและเขียน `journal_entries`** แล้ว (ตัวตรวจ idempotency + เลขที่รายการ) ⇒ เป็นคู่ conflict ของ writer ตัวอื่นในหัวข้อ "ผลข้างเคียงที่ต้องเฝ้า" (รับชำระ / accrual 2A / ยึดเครื่อง / ปรับดิว / webhook PaySolutions ซึ่งยังไม่แปลง P2034) — ตัวรับของเอง retry ได้ แต่ผู้แพ้ฝั่งนั้นได้ 500 ดิบ · ยังไม่ได้วัดด้วยเทสสองคอนเนกชัน |

Forward-only — ใบรับของก่อนวันที่ deploy ไม่มี JE และ `costPrice` ของเครื่องเหล่านั้นยังเป็นราคาก่อน VAT
(ข้อมูลบน prod เป็นข้อมูลทดสอบ จะถูกล้างก่อนใช้จริง).

**ที่ยังเปิดอยู่ (ห้ามเดา JE ปิดช่องเอง):**

| เรื่อง | สถานะ |
|---|---|
| จ่ายเงินผู้จัดจำหน่าย + มัดจำ (`Dr S21-110x / Cr ธนาคาร` · มัดจำพักที่ `S11-4201` — ฝ่ายบัญชีรับรองแล้ว ข้อ ข4 · **`S11-4201` ยังไม่เปิดในผัง** ไม่มีใน `shop-coa.csv`) | ยังไม่ทำ — ใบสั่งซื้อเก็บแค่ "ยอดจ่ายสะสม" (`paidAmount` ถูกเขียนทับ) ไม่มีวันที่จ่ายและบัญชีที่จ่ายออก ต้องออกแบบหน้าบันทึกการจ่ายเงินก่อน ⇒ **`S21-1101`/`S21-1102` สะสมโดยไม่ถูกล้าง และเงินสด/ธนาคารของ SHOP สูงกว่าจริงเท่าเงินที่จ่ายไป** จนกว่าจะทำ · หน้าเจ้าหนี้ (ยอดสุทธิของใบ − จ่ายแล้ว) กับเจ้าหนี้ในสมุด (เฉพาะของที่รับแล้ว) จึงเป็นคนละตัวเลข |
| ปรับสต๊อก หาย/เสียหาย/ตัดจำหน่าย (`Dr S53-1102` — รับรองแล้ว ข้อ ข6 ข7) | ยังไม่ทำ — วันนี้ไม่มีขั้นตอนอนุมัติจริง (ผู้ขอเลือกชื่อผู้อนุมัติเอง) เจ้าของสั่งให้เจ้าของอนุมัติทุกรายการ ต้องออกแบบขั้นตอนก่อน |
| ~~ตีกลับเครื่องจากคิวรอถ่ายรูป (`rejectQC`) หลังรับเข้าแล้ว~~ | **ปิดแล้ว (คำตอบฝ่ายบัญชี 2026-09-30 ข้อ 8)** — เครื่องในคิวยังไม่ลงบัญชี จึงตีกลับได้โดยไม่มีอะไรต้องกลับรายการ · เครื่องที่ลงไปแล้ว (เคยเข้าคลังแล้วถูกเปลี่ยนกลับมารอถ่ายรูป) `rejectQC` ปฏิเสธพร้อมให้แจ้งฝ่ายบัญชี |
| ปรับสต๊อก/ตัดจำหน่ายเครื่องจากใบสั่งซื้อที่ยังรอถ่ายรูป (งานก้อน 3) | เครื่องนี้ยังไม่มีสินค้าคงคลังในบัญชี (`journalEntryId` ว่าง) — รายการตัดจำหน่ายต้องตรวจ `journalEntryId` ก่อน ไม่งั้นจะเครดิตสินค้าที่ไม่เคยเดบิต |
| แก้ `costPrice`/หมวดสินค้าด้วยมือ (`PATCH /products/:id`) · เพิ่มสินค้าด้วยมือ (`POST /products`) · ลบสินค้า | ไม่ลงบัญชี (มีอยู่เดิม) |
| กดรับของซ้ำหลังหน้าจอค้าง | การรับของไม่มี idempotency ระดับคำขอ (มีอยู่เดิม) — อุปกรณ์เสริมที่ไม่มี IMEI รับซ้ำได้ และตอนนี้ลงบัญชีซ้ำด้วย |
| ป้ายช่องราคาในหน้ารับเข้าตรง ("ราคาทุน/ชิ้น") | เป็นราคาก่อน VAT แต่ต้นทุนที่เก็บเป็นราคารวม VAT — ยังไม่เปลี่ยนข้อความ (งานหน้าจอ รอเจ้าของ) |
| รายงานที่รวมต้นทุน (`transactional-report` ต้นทุนขาย/มูลค่าสต๊อก · `stock-overview` · `operational-report`) | ช่วงเปลี่ยนผ่านจะปนต้นทุนก่อน VAT (เครื่องเก่า) กับรวม VAT (เครื่องใหม่) · เพดานส่วนลดของพนักงานที่ POS (`discount-policy.util`) ขยับตามต้นทุนใหม่ |
| ยอดยกมาของสินค้าที่มีอยู่ก่อนเริ่มใช้ | รอคำตอบฝ่ายบัญชี |

---

## สมุดเงินหน้าร้าน + บิลจ่ายผสม (shop tenders — 2026-09-20)

Spec: `docs/superpowers/specs/2026-09-20-shop-tenders-daily-cash-design.md` · โค้ด:
`apps/api/src/modules/shop-tenders/` · Integration:
`apps/api/src/modules/contracts/__tests__/shop-tenders.integration.spec.ts`

**คำตัดสินเจ้าของ 2026-09-20 (ปิดประเด็น):** ต้องมีสรุปเงินหน้าร้านรายวัน (กันพนักงานโกง) ·
โอน/QR **บังคับเลขอ้างอิง** · ลูกค้าจ่ายผสมในบิลเดียว "มีบ่อย ต้องรองรับ" (สูงสุด 4 บรรทัด) · เลขอ้างอิงซ้ำ
ไม่บล็อกแต่ขึ้นป้ายแดงในรายงาน · คืนเงินตามวิธีที่รับมา · "นับเงินปิดวัน" เป็นรอบถัดไป.

- **ตาราง `shop_tenders`** = สมุดเงินเข้า/ออกของหน้าร้าน (แถวไม่ถูกแก้/ลบ — การคืนเงิน = แถว `OUT` ที่ชี้
  `reversesTenderId`). `actorId` = **ผู้ใช้ที่ล็อกอินและกดทำรายการ** ไม่ใช่ `salespersonId`. เขียนใน tx เดียวกับ JE
  ผ่าน `new ShopTenderRecorder(this.prisma)` (แบบเดียวกับ `TradeInCreditService` — ไม่เพิ่ม dependency ให้
  constructor ของ service เดิม). หน้าสรุปเงินรายวัน (`GET /shop-tenders/daily-summary`) อ่านจากตารางนี้ตารางเดียว
  — **ไม่ backfill** เอกสารเก่า.
- **กติกา tender อยู่ที่เดียว:** `normalizeTenders` (`shop-tender.util.ts`) — ผลรวมต้องเท่ายอดที่ต้องรับพอดี,
  โอน/QR ต้องมี `reference` 6–128 ตัว. caller ที่ไม่ส่ง `tenders` ได้บรรทัดเดียวจากฟิลด์เดิมแล้วผ่านกติกาเดียวกัน
  (โอน/QR แบบเดิมที่ไม่มีเลขอ้างอิง = 400).
- **คอลัมน์เดิม = tender แรก (primary):** `Sale.paymentMethod` / `Contract.downPaymentMethod` /
  `Booking.depositMethod` เก็บวิธีของบรรทัดแรก · `Contract.downPaymentReference` = เลขอ้างอิงของบรรทัดแรกที่
  ไม่ใช่เงินสด.

### JE ของบิลจ่ายผสม — flow `shop-tender-split` (ไม่แตะ template รับเงินเดิม)

Template รับเงินเดิม (`ShopCashSaleTemplate` / `ShopExternalFinanceSaleTemplate` / `ShopDownPaymentTemplate` /
`ShopBookingDepositTemplate`) ยังลง **เต็มยอด** เข้าบัญชีของ primary ตามเดิมทุกประการ แล้ว recorder โพสต์ใบ
"แยกยอด" 1 ใบเมื่อมีบรรทัดอื่นที่ลงคนละบัญชี:

```
Dr <บัญชีของวิธีอื่น>   [Σ บรรทัดที่บัญชีต่างจาก primary]      (เงินสด = ลิ้นชักสาขา · โอน/QR = S11-1201)
   Cr <บัญชี primary>
```

เหตุผลที่ไม่ทำ Dr หลายขาใน template เดิม: ขายสดลง JE **ทีละสินค้า** (`allocateCashSaleByCost`) ·
`TradeInCreditService.claim` เครดิตบัญชีเงินสดใบเดียว · deposit-applied ตอนแปลงใบจองเครดิต "บัญชีเดียวกับที่
ใบขายเดบิต" · ลบร่างสัญญาอ่าน JE ดาวน์ต้องเจอ debit `S11-*` เท่ายอดดาวน์ **1 บรรทัดพอดี** — ทั้งหมดยังถูกต้อง
ถ้า primary รับเต็มยอดก่อนแล้วค่อยย้ายส่วนของวิธีอื่นออก. ยอดสุทธิของลิ้นชัก/ธนาคาร = เงินจริงของแต่ละวิธี
(ปักด้วย integration: ขายสด 5,000 สด + 4,900 โอน → ลิ้นชัก 5,000 / S11-1201 4,900).

| เรื่อง | กติกา |
|---|---|
| metadata | `flow: 'shop-tender-split'`, `tenderDocType`, `tenderDocId`, `idempotencyKey: shop-tender-split:<docType>:<docId>` |
| ใบขาย | ใส่ `metadata.saleId` ⇒ `SaleVoidService` (sweep `saleId`) mirror ให้เองตอนยกเลิกใบขาย |
| **สัญญา** | **ห้ามใส่ `metadata.contractId`** — การยกเลิกสัญญา (C-1) และยกเลิกเปลี่ยนเครื่อง sweep ตาม `contractId` และมี **cash tripwire** ที่ throw เมื่อเจอบรรทัดเงินสด; JE ดาวน์เองก็จงใจไม่ถูก mirror ตอนยกเลิกสัญญา ⇒ ใบแยกยอดต้องอยู่นอก sweep เช่นกัน (ปักด้วย integration "เปิดใช้ → ยกเลิกสัญญา ไม่ชน tripwire") |
| ใบจอง | ไม่ใส่ key ที่ sweep ใดใช้ |
| ไฟแนนซ์นอกที่ JE ขายไม่ถูกโพสต์ (`execute()` คืน `null`) | เขียนแถว tender เสมอ แต่ **ไม่โพสต์ใบแยกยอด** (`postSplitJe: false`) — ห้ามย้ายเงินที่ยังไม่เคยลงบัญชี |

### การคืนเงิน

| เหตุการณ์ | บัญชี | tender |
|---|---|---|
| ยกเลิกใบขาย | sweep `saleId` mirror ทั้ง JE ขายและใบแยกยอด (ได้ฟรี) | `OUT SALE_VOID_REFUND` คู่กับแถว IN · actor = ผู้กดยกเลิก |
| ลบร่างสัญญา | reversal เดิมคืนเต็มยอดเข้า primary + `recordRefund(reverseSplitJe: true)` mirror ใบแยกยอด (flow `shop-tender-split-reversed`) | `OUT CONTRACT_DOWN_REFUND` |
| ยกเลิกใบจองที่รับมัดจำแล้ว | refund เดิม re-resolve จาก `depositMethod` (= primary) + mirror ใบแยกยอด | `OUT BOOKING_DEPOSIT_REFUND` |
| จ่ายรับซื้อมือสอง (`accept` BUYBACK) | ของเดิม | `OUT TRADE_IN_PAYOUT` (`TRANSFER` → `BANK_TRANSFER`, ไม่บังคับ reference) |

เอกสารก่อนมีสมุดนี้ไม่มีแถว IN ⇒ ไม่เขียนแถว OUT. ยึดมัดจำ (ใบจองหมดอายุ) ไม่มีเงินเคลื่อน ⇒ ไม่มี tender.
ใบขายจากออเดอร์ออนไลน์ (`ONLINE_GATEWAY`) ไม่เขียน tender — เงินไม่ผ่านมือพนักงานหน้าร้าน.

**เจ้าของเคาะ 2026-09-21: "ใช้แบบนี้ต่อไป"** — รูปแบบ "ลงเต็มยอดแล้วย้ายออก" (สมุดลิ้นชักเห็นเงินเข้า-ออกในวินาทีเดียวกัน ยอดสุทธิถูกต้อง)
คงไว้ ไม่รื้อ. จดหมาย `docs/accounting/cpa-question-split-tender-2026-09-20.txt` ยังส่งให้ผู้สอบ**เพื่อทราบ/ทักท้วง**ได้ แต่ไม่ใช่ตัวบล็อกอีกแล้ว.
ถ้าวันหน้าผู้สอบต้องการใบเดียวหลายขา ต้องรื้อ 4 จุดข้างบนพร้อมกัน — อย่าแก้จุดเดียว.

### ล้างข้อมูลทดสอบ (2026-09-20)

- `factory:reset`: `shop_tenders` อยู่ใน `WIPE_TABLES`.
- `cleanup:test-contracts` + cleanup ของ test-pack (`bookings`, `trade-in`) **ลบแถว `shop_tenders` ของเอกสารทดสอบถาวร**
  ผ่าน `src/cli/shop-tender-cleanup.util.ts` — เอกสารถูก soft delete ⇒ ถ้าไม่ลบ แถวทดสอบจะค้างในหน้าสรุปเงินรายวัน
  ของจริง; หน้ารายงาน**ห้าม**กรองด้วย `deletedAt` ของเอกสาร (ใบขายที่ถูก void ก็เป็น soft delete — แถวรับ+คืนของมันคือสิ่งที่
  ต้องเห็น). JE แยกยอดของสัญญา/ใบจองตามด้วย `metadata.tenderDocId` + mirror จาก `reversesEntryId`
  (`findTenderSplitEntries`) เพราะไม่ stamp `contractId`/`bookingId`.

### นับเงินปิดยอดลิ้นชักสาขา (shop cash close — คำตัดสินเจ้าของ 2026-09-20)

Spec: `docs/superpowers/specs/2026-09-20-shop-cash-close-design.md` · โค้ด: `shop-tenders/shop-cash-close.service.ts` ·
Integration: `contracts/__tests__/shop-cash-close.integration.spec.ts`

- **ลงบัญชีใบเดียวตอน "ยืนยันรับเงิน"** (คำตัดสินเจ้าของ 2026-09-21 — เดิมเก็บเป็นข้อมูลอย่างเดียว) · flow `shop-cash-close`,
  `idempotencyKey shop-cash-close:<closeId>`, `metadata.shopCashCloseId`/`branchId`, `companyId` = SHOP, ลงวันที่ = เวลาที่ยืนยัน,
  โพสต์ใน `$transaction` เดียวกับการเปลี่ยนสถานะ (JE พัง = การยืนยันไม่เกิด) · `ShopCashClose.journalEntryId` ผูกใบไว้ (migration
  `20261006000000_shop_cash_close_journal`). **ไม่ลงอะไรตอนนับ** — ยอดนับถูกตีกลับได้ จึงไม่มี JE ให้ต้องกลับรายการ

  ```
  นับขาด |V|  : Dr S53-1104 เงินขาด-เกินบัญชี / Cr <ลิ้นชักสาขา>      นับเกิน V : Dr <ลิ้นชักสาขา> / Cr S53-1104
  ส่งเงินออก   : Dr <ปลายทาง> [รับจริง] / Cr <ลิ้นชักสาขา> [ยอดแจ้งส่ง]   ต่างกัน = S53-1104 (ขาด Dr · เกิน Cr)
  ปลายทาง     : BANK_DEPOSIT → S11-1201 · OWNER_HOLD → S11-1104 เงินสด-เจ้าของเก็บรักษา · BRANCH_SAFE → S11-1105 เงินสด-ตู้เซฟสาขา
  ```
  รวมยอดต่อบัญชีแล้วออกบรรทัดเดียวต่อบัญชี (สมดุลโดยโครงสร้าง · ลิ้นชัก = ปลายทางบัญชีเดียวกันก็ไม่เกิด Dr/Cr บัญชีเดียวกัน).
  ตัวอย่างปัก: ต้องมี 12,710 นับได้ 12,510 ส่ง 10,510 รับจริง 10,500 ฝากธนาคาร → `Cr ลิ้นชัก 10,710 / Dr S11-1201 10,500 / Dr S53-1104 210`.
  หลังใบนี้ยอดลิ้นชักในสมุด = เงินทอนตั้งต้น (เมื่อสมุดเดินตรงกับสมุดเงินหน้าร้านมาตลอด)
- **บัญชีเดียว `S53-1104` ทั้งขาดและเกิน รวมส่วนต่างชั้นที่สอง** (เจ้าของเลือกแบบมาตรฐาน — ไม่แยกรายได้อื่น ไม่ตั้งลูกหนี้พนักงาน).
  บัญชีใหม่ 3 ตัว (`S11-1104`, `S11-1105`, `S53-1104`) ใส่ด้วย migration (`ON CONFLICT DO NOTHING`) + `shop-coa.csv` ⇒ prod ได้พร้อม deploy
  ไม่ต้องรัน `seed:coa` มือ. รหัสและชื่อเป็น**ข้อเสนอของเราที่เจ้าของเคาะ ยังไม่ใช่คำวินิจฉัยผู้สอบ** — จดหมาย
  `docs/accounting/cpa-question-cash-close-2026-09-20.txt` ส่งเพื่อทราบ/ทักท้วงได้; ถ้าผู้สอบให้รหัสอื่นต้องย้ายรายการที่ลงไปแล้วด้วย
- **ข้ามการลงบัญชีโดยไม่บล็อกการรับเงิน** เมื่อสาขายังไม่ตั้ง `shopCashAccountCode` หรือผังขาดบัญชี (`journalSkipped` ใน AuditLog
  `SHOP_CASH_CLOSE_CONFIRMED` + Sentry warning `subsystem: shop-cash-close`) — แบบเดียวกับ `externalFinanceAccountsReady`.
  นับตรงและไม่มีเงินส่ง = ไม่มีบรรทัดให้ลง ไม่โพสต์ใบเปล่า. งวดบัญชี SHOP ปิด → `validatePeriodOpen` โยน (การยืนยันไม่เกิด)
- **หลักฐานว่าเงินถึงบริษัท + บันทึกนำฝาก (คำตัดสินเจ้าของ 2026-09-21 รอบ 5 — mockup กระดาน 10–11):**
  - ปลายทาง `BANK_DEPOSIT` ที่มีเงินรับจริง > 0 **ต้องมีรูปสลิป + เลขอ้างอิง 6–128 ตัว** (`POST cash-close/:id/deposit-slip` แนบก่อน แล้วค่อยยืนยัน —
    service ตรวจ `depositSlipKey` ใน tx เดียวกับการยืนยัน) · `OWNER_HOLD` เลือกได้เฉพาะเมื่อผู้กดยืนยันเป็น **OWNER เอง** (เดิม ผจก.เลือกแทนได้โดยไม่มีอะไรยืนยัน) ·
    `BRANCH_SAFE` = เงิน **ยังไม่ถึงบริษัท** (`moneyState: AT_BRANCH`) จนกว่ายอดนำฝากสะสมจะครอบการปิดยอดครั้งนั้น
  - `ShopCashDeposit` (`shop_cash_deposits`, migration `20261007000000_shop_cash_deposit_proof`) = "บันทึกนำฝาก" เงินจากตู้เซฟสาขา/เงินที่เจ้าของเก็บ เข้าธนาคารของร้าน ·
    ฝากบางส่วนได้ · ห้ามเกินยอดค้าง (ใต้ advisory lock เดียวกับการนับ/ยืนยันของสาขา) · สลิป + เลขอ้างอิงบังคับ · ไม่มีคอลัมน์ผูกนำฝาก↔ปิดยอด โดยตั้งใจ —
    ยอดค้าง/ครั้งที่ "ถึงบริษัทแล้ว" คำนวณแบบ FIFO จากสองกอง (`shop-cash-holding.util.ts` `allocateDeposits`)
  - JE flow `shop-cash-deposit` (`idempotencyKey shop-cash-deposit:<depositId>`, company SHOP, ใน tx เดียวกับการบันทึก): `Dr S11-1201 / Cr S11-1105` (ตู้เซฟ) หรือ `Cr S11-1104` (เจ้าของเก็บ) —
    **ลงเฉพาะส่วนที่การปิดยอดต้นทางเคยลงบัญชี** (`postedPortion`): ต้นทางที่ข้าม JE (สาขาไม่ตั้งลิ้นชัก) ไม่มียอดให้ล้าง เครดิตไปจะทำให้บัญชีแหล่งเก็บติดลบ ⇒ ข้ามพร้อมเหตุผล
    `SOURCE_NOT_POSTED` ใน AuditLog `SHOP_CASH_DEPOSIT_RECORDED` + Sentry warning (ไม่บล็อกการบันทึกนำฝาก)
  - ⇒ `S11-1104`/`S11-1105` **ไม่สะสมค้างอีกแล้ว** เมื่อบันทึกนำฝากผ่านเมนู — JV มือ `Dr ธนาคาร / Cr S11-1104` เหลือไว้สำหรับกรณีเจ้าของ **ใช้จ่าย** เงินก้อนนั้นโดยไม่ฝาก (ยังไม่มีเมนู)
  - สถานะ "หนึ่งวันของหนึ่งสาขา" (ตารางของวัน + แถบ 14 วัน, `dayStates` ใน `shop-cash-overview.service.ts`): มีการปิดยอดที่ยังมีผลในวันนั้น → ครั้งที่แย่ที่สุด
    (รอยืนยัน > ยังอยู่ที่สาขา > ถึงบริษัทแล้ว) · ไม่มี แต่สิ้นวันยังมีเงินสดรับที่ไม่มีใครนับ (รวมเงินหลังปิดยอดของวันก่อน) → `MISSED` (วันนี้ = `NOT_COUNTED`) · นอกนั้น `NO_CASH`.
    แถบเตือนหน้าขาย (`GET cash-close/reminder`) ใช้ `findUnclosedYesterday` ตัวเดียวกับแท็บประวัติ/แดชบอร์ด — **เตือนอย่างเดียว ไม่ล็อกการขาย** (เจ้าของเคาะ)
- "ต้องมีในลิ้นชัก" อ่านจาก `shop_tenders` (`method = CASH`) ไม่ได้อ่านจาก GL — เป็นคนละเลนส์กับยอดบัญชี และ **ไม่รวมเงินสดที่ไม่ผ่าน
  สมุดเงินหน้าร้าน** (เช่น ค่าใช้จ่ายสาขาที่จ่ายจากลิ้นชัก, ใบขายออเดอร์ออนไลน์) ⇒ ส่วนต่างจากเรื่องพวกนี้ต้องอธิบายในช่องเหตุผล
- รอบ = ตั้งแต่ปิดยอดที่ยังมีผลครั้งก่อน (`PENDING_CONFIRM`/`CONFIRMED`) ถึงตอนนับ · แถว `SENT_BACK` ไม่เป็นขอบรอบ ·
  ตีกลับได้เฉพาะครั้งล่าสุดของสาขา · ผู้นับ (SALES/BM ของสาขา) ≠ ผู้ยืนยัน (OWNER/FM/BM) บังคับใน service
- `factory:reset`: `shop_cash_closes` + `shop_cash_deposits` อยู่ใน `WIPE_TABLES`

---

## ค่าคอมพนักงานขายของสัญญาผ่อน BESTCHOICE (คำตัดสินเจ้าของ 2026-09-20)

โค้ด: `apps/api/src/modules/contracts/services/contract-commission.util.ts` (ที่เดียว)

- **กติกา = เหมือนขายสด:** อัตราจาก `CommissionRule` ที่ active ล่าสุด (ไม่มีกฎ = 3%) × ราคาขายของสัญญา (`sellingPrice` —
  หลังส่วนลด/โบนัสเทิร์น) · `status: PENDING` · ผู้ได้ = `contract.salespersonId` ณ วันเปิดใช้ (`snapshotSalespersonId`)
- **สร้างตอนเปิดใช้สัญญา** (`ContractWorkflowService.activate` → `ensureContractCommission`) ไม่ใช่ตอนร่าง —
  สัญญาที่ไม่ถูกเปิดใช้ = ยังไม่ได้ขาย. เดิมสัญญาที่ทำผ่านหน้าสัญญา**ไม่มีค่าคอมเลย** (ค่าคอมเกิดได้ทางเดียวคือเส้นทางเก่า
  `POST /sales` แบบ `INSTALLMENT` ที่สร้างตั้งแต่ตอนร่าง — **ถอดแล้ว 2026-09-20**, ดูข้อสุดท้าย) — helper ไม่สร้างซ้ำถ้าสัญญา
  มีค่าคอมอยู่แล้ว (ร่างยุคเส้นทางเก่าที่อาจยังค้างในฐาน)
- งวดจ่าย (`period`) คิดตามปฏิทินไทย (`bangkokDateString`) · สัญญาจากการเปลี่ยนเครื่อง (device swap) **ไม่เข้าเส้นนี้**
- **ยกเลิกสัญญา (C-1/C-2)** → `clawbackContractCommission`: `PENDING`/`APPROVED` → `CLAWED_BACK` 100% ·
  ที่**จ่ายไปแล้วไม่เรียกคืน** (คำตัดสินเจ้าของ) · รอบจ่าย `DRAFT` ที่นับค่าคอมนี้ถูก soft-delete ให้กดสร้างใหม่ (กติกาเดียวกับ
  `SaleVoidService` G4b — `generatedAt = null` ถือว่าครอบ) · ตัว helper **ไม่บล็อกการยกเลิกสัญญา** แม้ค่าคอมถูกนับในรอบที่
  `APPROVED`/`PAID` (ต่างจากยกเลิกใบขายที่บล็อก) — รอบที่ล็อกถูกบันทึกใน AuditLog `CONTRACT_CANCELED*` →
  `newValue.commissionLockedPayoutIds` ให้เจ้าของ/ผจก.การเงินตัดสินเอง
- **สัญญาที่ใช้เครดิตเทิร์น = กติกาเดียวกัน (คำตัดสินเจ้าของ 2026-09-20 "ปล่อยให้ยกเลิกได้เหมือนสัญญาทั่วไป"):**
  `approveCancellation` เรียก `cleanupCreditContractSale` (`trade-in/services/credit-contract-cleanup.util.ts`) ด้วย
  `{ commissionHandledByCaller: true }` ⇒ ด่านค่าคอมของมัน (ค่าคอม `PAID` / รอบจ่าย `APPROVED`·`PAID` → ปฏิเสธ) **ถูกข้าม** และ
  `clawbackContractCommission` เป็นผู้จัดการค่าคอมทางเดียว. เดิม (ช่วงสั้น ๆ หลัง #1612) ด่านนั้นบล็อกสัญญาเครดิตเทิร์นทุกใบ
  ที่ค่าคอมอยู่ในรอบจ่ายที่อนุมัติแล้ว โดยไม่มีเมนูยกเลิกรอบจ่ายให้ไปต่อ. **`ContractLifecycleService.softDelete` (ลบร่าง) ไม่ส่ง
  option นี้** — ด่านเดิมยังคุมร่างยุคเส้นทางเก่าที่มีค่าคอมตั้งแต่ตอนร่าง. ปักที่ `e2e/credit-payment-flow.e2e-spec.ts`
  ("cancels an activated trade-credit contract even when…" + "does not return credit when a related commission payout…")
- **เส้นทางเก่าถอดแล้ว (2026-09-20):** `SaleWriterService.createInstallmentSale` ถูกลบ · `POST /sales` ที่ส่ง `saleType: 'INSTALLMENT'`
  ได้ 400 (`INSTALLMENT_VIA_CONTRACT_MSG` ใน `sale-creation.service.ts` — ชี้เมนู "สัญญาผ่อนชำระ" → ปุ่ม "สร้างสัญญา") ก่อนแตะแต้ม/
  เครดิตเทิร์น/สต๊อก · โค้ดเก็บกวาดร่างยุคเก่า (`cleanupCreditContractSale`, ตัวกรอง `contractStatus` ของ `SalesQueryService`) **คงไว้**
  เพราะร่างแบบนั้นอาจยังค้างในฐานจริง · e2e `credit-payment-flow` เหลือเส้นทางหน้าสัญญาทางเดียว

---

## ยกเลิกใบขาย (void sale — 2026-08-23)

Spec: `docs/superpowers/specs/2026-08-22-void-sale-design.md` · Plan:
`docs/superpowers/plans/2026-08-22-void-sale.md` · Service:
`apps/api/src/modules/sales/services/sale-void.service.ts` · Endpoint `POST /sales/:id/void`
(`@Roles('OWNER','BRANCH_MANAGER')`, DTO `{ reason }` 10-500 ตัวอักษร) · Integration:
`apps/api/src/modules/sales/__tests__/sale-void.integration.spec.ts` (CI glob `SALES_FILES`).

ที่มา: final review Phase 5 I-2 — เจ้าของกลับคำตัดสิน "ยอมรับช่องว่างไว้ก่อน" เป็น "ทำให้ถูกเลย"
ในวันเดียวกัน (2026-08-22). คำตัดสิน **D1** ครอบ `CASH` + `EXTERNAL_FINANCE` เท่านั้น
(`INSTALLMENT` ใช้เส้นทางยกเลิกสัญญา C-1/C-2 ตามเดิม) · **D2** บล็อกเมื่อ "เงินขยับจริง"
ไม่จำกัดวัน · **D3** ขั้นเดียว OWNER + BM ไม่มี maker-checker.

### Flow `shop-cash-sale-void` (mirror ของ `shop-cash-sale`)

ไม่มี template class ใหม่ — `SaleVoidService` เรียก **sweep engine เดิม**
(`ExchangeCancelReversalTemplate.reverse`) ด้วย `sweepBy: { path: 'saleId', value }` +
`flowLabel: 'shop-cash-sale-void'` + `descriptionPrefix: '[ยกเลิกใบขาย]'` (selector `sweepBy`
เพิ่มเข้า engine ใน void-sale Task 2 — ผู้เรียกเดิมที่ส่ง `contractId` ได้พฤติกรรมเดิม byte-identical).

| เรื่อง | ค่าจริง |
|---|---|
| ใบที่ถูกกวาด | ทุก `JournalEntry` ที่ `metadata.saleId = <saleId>` + `status: POSTED` + `deletedAt: null` (= JE ทุกใบที่ `ShopCashSaleTemplate` โพสต์ให้ใบขายนั้น — หนึ่งใบต่อชิ้น); ใบขาย `EXTERNAL_FINANCE` ไม่มี JE ⇒ `reversalEntryNumbers = []` ไม่ throw |
| mirror | สลับ Dr/Cr ทุกบรรทัด, `companyId` เดิม (SHOP), **ลงวันที่วันที่ยกเลิก** (`createAndPost` default `entryDate = postedAt = now`) |
| metadata ของ mirror | `flow: 'shop-cash-sale-void'`, `idempotencyKey: 'shop-cash-sale-void:<jeId ต้นทาง>'`, `reversesEntryId`, `tag: 'REVERSAL'`; **จงใจไม่ carry `saleId`** — กัน sweep รอบถัดไปไปเจอ mirror ของตัวเอง (engine ข้ามใบที่ `flow === flowLabel` อยู่อีกชั้น) |
| ใบต้นทาง | คง `POSTED` + stamp `reversed: true` / `reversedByEntryNumber` (pattern เดียวกับ `reverseBatch`) |
| period guard | `createAndPost` **ไม่มี** period guard ⇒ service เรียก `validatePeriodOpen(tx, now, companyId)` เองต่อทุก `companyId` ของใบที่จะกวาด (G2) — เป็น no-op เกือบตลอดเพราะโพสต์วันนี้เสมอ ทำงานจริงเฉพาะปลาย grace window |
| Isolation | `$transaction` Serializable ใบเดียวทั้งด่าน+เขียน; P2034 → 409 ไทย + `Sentry.captureMessage` warning เอง (`SentryExceptionFilter` จับเฉพาะ ≥500) |

**ไม่มีใบลดหนี้** — SHOP ไม่จด VAT (ไม่มีภาระ ม.86/10 ต่างจากใบเสร็จ FINANCE). ไม่มีเอกสารคืนเงินแยก
— mirror พาเงินสดออกจากบัญชี SHOP ให้แล้ว การส่งเงินคืนลูกค้าเป็นการกระทำหน้าร้าน.

### F1 — บั๊ก production เดิมที่พบระหว่างทำ (แก้แล้ว `e8d9a5246`, 2026-08-23)

PR #1285 (2026-06-23) ทำให้ `ShopCashSaleTemplate` โพสต์ **JE ต่อชิ้น** (bundle-aware) แต่ทุกใบยัง
ใช้ `reference: sale:<saleId>` เดียวกัน ⇒ ชน partial unique index `journal_entries_ref_unique`
(`(reference_type, reference_id) WHERE deleted_at IS NULL`, migration `20260428010000`) ที่ใบที่สอง
⇒ P2002 → `runSaleTransaction` retry 3 รอบชนซ้ำ → **ขายสด+ของแถมที่มีต้นทุน > 0 สร้างใบขายไม่ได้เลย
(raw 500 ที่ POS) ตั้งแต่วันนั้น**. รอดเฉพาะของแถม `costPrice = 0` (allocation ตามต้นทุน → revenue
ของชิ้นนั้น = 0 → caller `continue` ไม่เรียก template). unit spec mock prisma จึงไม่เคยเห็น (index
อยู่ระดับ DB) และ integration เดิมขายทีละชิ้น.

แก้: `reference = sale:<saleId>:<productId>` + `productId` เป็น **input บังคับ** ของ template
(ไม่มีผู้อ่าน prefix `sale:` ที่ไหน — เป็น provenance เขียนอย่างเดียว). sweep ของ void ไม่กระทบเพราะกวาดด้วย
`metadata.saleId` ไม่ใช่ reference. ปักด้วย integration (ขายสด + ของแถมมีต้นทุน → สำเร็จ + JE 2 ใบ).

### ด่าน (guards) — อ่านครบทุกข้อใน tx ก่อนเขียนอะไรทั้งสิ้น

| ด่าน | อ่านอะไร | หมายเหตุ |
|---|---|---|
| G1 | `Sale.deletedAt` | idempotency — ใบที่ยกเลิกแล้วปฏิเสธพร้อมเวลา |
| Branch scope | `Sale.branchId` vs `user.branchId` | **BM ยกเลิกได้เฉพาะสาขาตัวเอง** — `BranchGuard` ไม่ scope route ที่มีแต่ `:id` จึงบังคับใน service (precedent `contract-exchange-cancel.service.ts`); BM ที่ไม่มี `branchId` = fail-closed. OWNER ข้ามสาขาได้ |
| D1 | `saleType` | `INSTALLMENT` → ชี้ไปเส้นทางยกเลิกสัญญา; ชนิดที่ไม่รู้จัก → reject (exclude-list) |
| ข้อมูลเพี้ยน | `contractId` บนใบ CASH/EXTERNAL_FINANCE | reject (เดินต่อ = ทิ้งสัญญาลอย) |
| G6 | `onlineOrderId` | reject — **ยังไม่มีเส้นทางล้างสองฝั่ง** (`cancelOrder` ไม่แตะ Sale/product/JE; `markRefunded` รับเฉพาะ `PAYMENT_RECEIVED_UNFULFILLABLE` ซึ่งโดยนิยามไม่มีใบขาย) ⇒ ข้อความบอกให้เจ้าของตรวจก่อน ไม่ชี้ประตูที่ไม่มีจริง |
| **G8** | `Booking` ที่ `convertedToSaleId = sale.id` + `deletedAt: null` (relation `SaleBooking` — FK อยู่ฝั่ง Booking, `Sale` ไม่มี bookingId) | reject (sibling ของ G6, final review 2026-08-23) — `convertToSale` ตั้ง `downPaymentAmount = depositAmount` (มัดจำรับจริง) และ flip Booking → `CONVERTED` (สถานะสุดท้าย, `cancel()` ไม่รับ) ⇒ void = ใบจองชี้ไปใบที่ยกเลิก + มัดจำหายจากรายงาน. ข้อความระบุเลขใบจอง+ยอดมัดจำ ให้เจ้าของตรวจก่อน. หมายเหตุ pre-existing: ใบขายจากใบจอง**ไม่โพสต์ SHOP JE** — **CPA ตอบแล้ว 2026-08-24 (ข้อ C4): แก้ไปข้างหน้าอย่างเดียว ไม่บันทึกย้อนหลัง** (ยังไม่แก้โค้ด). ตรวจเพิ่มแล้วพบว่ากว้างกว่านั้น: โมดูล `bookings` **ไม่โพสต์ JE เลยแม้แต่ใบเดียว** ⇒ เงินมัดจำที่รับจริงก็ไม่เคยขึ้นสมุด และ `S21-2002` ไม่มีผู้สร้างรายการที่ไหนเลย. **สำคัญ: ถ้าแก้ให้โพสต์ JE ด่าน G8 นี้จะยิ่งจำเป็น ไม่ใช่เลิกจำเป็น** — เพราะ void จะกลับรายการเป็น `Cr เงินสด` ทั้งที่ไม่มีเมนูคืนมัดจำจริง. ดู `docs/accounting/cpa-answers-2026-08-24.md` ข้อ C4 |
| G7 | `RepairTicket` ที่ `productId ∈ {หลัก, ของแถม}` และ `status notIn [CLOSED, CANCELLED, REPLACED]` | **`RepairTicket` ไม่มี `saleId`** (spec เดิมเขียนว่า "อ้างอิงใบขายนี้") จึงตรวจผ่าน `productId`; enum จริงคือ `RepairStatus` |
| G5 | `assertProductNotHeld(tx, { ...p, expectedStatus }, 'RESTORE_TO_STOCK')` ทุกชิ้น | action ที่ 4 บน helper เดิม (ห้ามมีด่านชุดที่สอง). `expectedStatus` = `SOLD_CASH` (CASH) / `SOLD_INSTALLMENT` (EXTERNAL_FINANCE หลัก) — **ของแถมเป็น `SOLD_CASH` เสมอ** (`markBundleProductsSold` hardcode) จึงใบ EXTERNAL_FINANCE มีสองสถานะในใบเดียว. นับจำนวน product **ก่อน** วนด่าน |
| G3 | `FinanceReceivable` ของใบ (ไม่ผูก saleType) | บล็อกเมื่อ `status ∈ {RECEIVED, PARTIALLY_RECEIVED}` **หรือ** `receivedAmount > 0` — allow-list ตาม D2 (`DISPUTED`/`OVERDUE` = ยังไม่ได้เงิน; สเปคเดิม `status != PENDING` ล็อกใบถาวร) |
| G4 | `SalesCommission.status` | `CLAWABLE_COMMISSION_STATUSES = [PENDING, APPROVED]` เป็นตัวตัดสินสองงาน: ไม่อยู่ในลิสต์ (PAID / PARTIALLY_CLAWED_BACK / ค่าใหม่) = บล็อก, อยู่ = flip `CLAWED_BACK` |
| **G4b** | `CommissionPayout` คู่ `(salespersonId, period)` ของค่าคอมที่เจอ | ดูหัวข้อถัดไป |
| G2 | `validatePeriodOpen(tx, now, companyId)` ต่อ JE ที่จะกวาด | เฉพาะใบที่มี JE |

### G4b — รอบจ่ายค่าคอม + `CommissionPayout.generatedAt` (migration `20261000100000`)

มีสองเส้นทางจ่ายเงินอิสระกัน: `POST /commissions/:id/pay` เขียน `SalesCommission.status = PAID`
(G4 เห็น) แต่ `PATCH /commissions/payouts/:id/paid` เขียน **เฉพาะ `CommissionPayout`** ไม่แตะค่าคอม
(G4 บอด) ⇒ พนักงานรับเงินจริงแล้วค่าคอมยัง `PENDING`. รอบจ่ายผูกกับ `@@unique([salespersonId,
period])` ไม่ใช่ `saleId`.

| สถานะรอบจ่าย (`PayoutStatus`) | พฤติกรรม |
|---|---|
| `DRAFT` | **ไม่บล็อก** (คำตัดสินเจ้าของ 2026-08-23) + **soft-delete ร่างใน tx เดียวกัน** + audit `COMMISSION_PAYOUT_DRAFT_VOIDED` (entity `commission_payout`, `newValue` ระบุ saleNumber ที่เป็นเหตุ) |
| `CANCELLED` | ไม่บล็อก ไม่ลบ (ยังไม่มี endpoint ใดตั้งค่านี้ได้ — รองรับไว้ล่วงหน้า) |
| `APPROVED` / `PAID` / ค่าใหม่ | บล็อก (`UNPAID_PAYOUT_STATUSES = [DRAFT, CANCELLED]` เป็น exclude list) |

- **ทำไมลบร่าง ไม่ใช่หักยอด:** `generatePayouts` ข้ามรอบที่ยังอยู่ (`if (existing &&
  existing.deletedAt === null) continue`) ⇒ ปล่อยร่างไว้ = ยอดค้างเกินจริงถูกอนุมัติ/จ่ายตามยอดเก่า.
  ลบแล้วกดสร้างใหม่ ขา `upsert.update` ตั้ง `deletedAt: null` + คำนวณใหม่ (ตัด `CLAWED_BACK` เอง).
  **ห้าม `totalCommission -= commissionAmount`** — รอบที่ generate **ก่อน** ค่าคอมใบนี้เกิดไม่เคยนับ
  ใบนี้ ⇒ หักยอด = จ่ายพนักงานขาด (มีเทสปัก).
- **นับเฉพาะรอบที่ครอบค่าคอมใบนี้จริง:** `commission.createdAt <= payout.generatedAt`.
  `generatePayouts` stamp `generatedAt = new Date()` **ทั้งขา create และขา update** ของ upsert.
  **ห้ามใช้ `payout.createdAt`** — ขา restore หลัง soft-delete คำนวณยอดใหม่แต่ `createdAt` ยังเป็น
  ของรอบเดิม. `generatedAt = null` (แถวยุคก่อนคอลัมน์) = พิสูจน์ไม่ได้ ⇒ **ถือว่าครอบไว้ก่อน**
  (fail-closed).
- **ขา restore reset เป็น `DRAFT` เสมอ** (Task 4 carry, commit `eed8a68e6`): `upsert.update`
  ตั้ง `status: 'DRAFT', approvedById: null, approvedAt: null, paidById: null, paidAt: null` —
  ไม่งั้น `approvePayout` (READ COMMITTED) ที่ชนกับ void แล้ว generate ใหม่ จะทำให้รอบที่ฟื้นเป็น
  `APPROVED` โดยไม่ผ่านอนุมัติซ้ำ. ปิด race ได้ **บางส่วน** (ดู "ยังเปิดอยู่").

### สิ่งที่เขียน (หลังผ่านทุกด่าน, ลำดับในโค้ด)

1. product หลัก + ของแถม → `IN_STOCK` (**จงใจไม่ผ่าน `product-enter-stock.util`** — คลาสยกเว้นเดียว
   กับเส้นทางยกเลิกสัญญา/เปลี่ยนเครื่อง: ตอนขายบังคับ `IN_STOCK` มาก่อนและไม่มี flow แตะราคาระหว่างขาย;
   ดู `.claude/rules/database.md`). คิวจองที่ `preemptReservationsInTx` ตัดตอนขาย **ไม่ถูกคืน** (ข้อจำกัด
   ที่ยอมรับ spec §1)
2. sweep JE (ด้านบน)
3. `FinanceReceivable` → `deletedAt` (G3 การันตีว่ายังไม่มีเงินเข้า)
4. `SalesCommission` → `CLAWED_BACK` + stamp `clawbackAt = now` / `clawbackReason = 'ยกเลิกใบขาย <saleNumber>: <reason>'`
   / `clawbackPercent = 100` (pattern `commission.service.ts clawback()`; `clawbackAmount` ไม่ stamp เพราะ
   `updateMany` ตั้งต่อแถวไม่ได้ และผู้อ่านตัดสินจาก `status`) · 4b. ร่างรอบจ่ายที่ครอบ → `deletedAt` + audit
5. `Sale` → `deletedAt = now`, `voidReason`, `voidedById` (migration `20261000000000_sale_void_fields`;
   `voided_by_id TEXT` เพราะ `users.id` เป็น TEXT) — ไม่มีสถานะ `VOIDED` แยก
6. `AuditLog { action: 'SALE_VOIDED', entity: 'sale' }` ผ่าน `tx.auditLog.create` (atomic; ห้าม
   `AuditService.log` ใน tx)

### ผู้อ่าน `Sale` หลัง void (ใช้ `deletedAt` เป็นตัวกรอง)

- `findAll` (`sales-query.service.ts`) กรอง `deletedAt: null` ที่จุดสร้าง `where` จุดเดียว (ครอบ
  list/count/aggregate/groupBy ⇒ summary ด้วย) — opt-out ผ่าน `?includeVoided=true` (หน้าประวัติ
  การขายมีสวิตช์ + ป้ายเตือนว่ายอดสรุปรวมใบยกเลิก). สรุปรายวัน/สินค้าขายดี **ไม่มี** opt-out.
- `findOne` **เคยบล็อกใบที่ `deletedAt` ด้วย NotFound** → ตอนนี้เปิดดูได้ + คืน `voidReason`/
  `voidedBy {id,name}` (ยืนยันแล้วไม่มีผู้เรียกพึ่ง NotFound).
- `getMonthlyPLSummary` (`transactional-report.service.ts`) เติม `deletedAt: null` 2 จุด (revenue +
  COGS); `sale.aggregate` ใน balance sheet / cash flow กรองอยู่แล้ว.
- `generateSaleNumber` (`sequence.util.ts`) **ห้ามกรอง** — ใบที่ยกเลิกยังถือเลข ไม่งั้นเลขซ้ำ.
- ตาราง "8 จุดที่ยังไม่กรอง" ใน spec §4 ส่วนใหญ่เป็น false positive ของหน้าต่างสำรวจ 6 บรรทัด —
  ของจริงที่ต้องแก้คือ `findOne` (ทิศกลับ) + `getMonthlyPLSummary` 2 จุด.

### AuditLog actions (String ธรรมดา)

| Action | Entity | เขียนที่ | `newValue` |
|---|---|---|---|
| `SALE_VOIDED` | `sale` | `SaleVoidService.run` (ใน tx) | saleNumber, saleType, netAmount, reason, restoredProductIds, reversalEntryNumbers, commissionIds, financeReceivableId, voidedDraftPayoutIds |
| `COMMISSION_PAYOUT_DRAFT_VOIDED` | `commission_payout` | เดียวกัน (หนึ่งแถวต่อร่างที่ถูกลบ) | period, salespersonId, saleId, saleNumber, reason |

### ยังเปิดอยู่ (carries — ไม่ block merge)

- `assertProductNotHeld` overloads เพื่อให้ `expectedStatus` บังคับระดับ compile-time เฉพาะ action
  `RESTORE_TO_STOCK` โดยไม่แตะ caller เดิม (~4 บรรทัด) — ยังไม่ทำ
- ternary ข้อความ G4b: `PayoutStatus` ค่าใหม่ในอนาคตจะได้คำว่า "อนุมัติแล้ว" (cosmetic)
- `approvePayout` ยังเป็น READ COMMITTED — race กับ void ปิดได้บางส่วนด้วย restore-reset เท่านั้น
  (รอสัญญาณจริงก่อนยก isolation — หลักเดียวกับ P2034 ที่เส้นทางรับชำระ)
- ค่าคอม `CLAWED_BACK` ไม่คืนยอดให้รอบ `APPROVED`/`PAID` — ไม่มีทางเกิดวันนี้เพราะถูกบล็อก แต่ถ้ามี
  เมนูแก้ไข/ยกเลิกรอบจ่ายในอนาคต ต้องทบทวนพร้อมกัน
- ไม่มีเมนูยกเลิก/แก้ไขรอบจ่ายค่าคอม (`PayoutStatus.CANCELLED` ไม่มีใครตั้งได้) — ใบขายที่ค่าคอมถูกนับ
  ในรอบ `APPROVED`/`PAID` ยกเลิกไม่ได้จนกว่าจะมี; ข้อความบอกความจริงข้อนี้ตรง ๆ
- SALES เห็นใบยกเลิก + เหตุผล + คนกด ผ่าน `findAll?includeVoided=true` (API `findAll` เปิดทุก role
  อยู่ก่อนแล้ว — pre-existing, ไม่มี PII ใหม่)
- G6 ออเดอร์ออนไลน์ยังไม่มีเส้นทางล้างสองฝั่ง (ดูตารางด่าน)
- G5 "เครื่องถูกเปิดสัญญาต่อ" ไม่มีเคสใน integration (ตั้งฉากได้ทางเดียวคือเขียน `product.status` ตรง
  ซึ่งไฟล์ห้าม) — ครอบด้วย unit + `product-lifecycle.integration.spec.ts`

---

## Inter-Co Settlement Batch — เมนูจ่ายให้หน้าร้าน (C2, 2026-08-01)

Replaces the old per-transaction `intercompany.settle` line and the never-UI-wired
`shop-finance-settlement` module with a **batch** ("รอบจ่าย") document: FINANCE pays SHOP
the accumulated ยอดจัด (21-1101) + ค่าคอม (21-1102) for one or many contracts in ONE wire,
and both sides post atomically on approval.

Spec: `docs/superpowers/specs/2026-07-30-interco-settlement-batch-design.md`
Module: `apps/api/src/modules/interco-settlement/` (`interco-pending.service.ts`,
`interco-batch-number.service.ts`, `interco-settlement.service.ts`,
`interco-settlement.controller.ts`, `interco-settlement.module.ts`)

### Model

`InterCoSettlementBatch` (table `inter_co_settlement_batches`) + `InterCoSettlementItem`
(`inter_co_settlement_items`, one row per contract in the batch —
`@@unique([batchId, contractId])`, `onDelete: Restrict` both FKs — it's financial
evidence, never allowed to dangle). Enum `InterCoBatchStatus { DRAFT PENDING_APPROVAL
POSTED REVERSED CANCELLED }`.

Doc number: `IC-YYYYMMDD-NNNN` — `IntercoBatchNumberService.next()`, same BKK-day
advisory-lock pattern as `RepairTicketDocNumberService` (max-via-`findFirst`-desc, not
`count()`, because a soft-deleted batch still occupies its number via the unique
constraint).

**Phase 2 additive columns (หักกลบ — workbook 2026-08-19):**
`InterCoSettlementItem.itemType` (enum `InterCoItemType { SETTLEMENT RECALL }`, default
`SETTLEMENT`) + `swapCreditAmount` / `recallAmount` (both `Decimal @default(0)`);
`InterCoSettlementBatch.totalDeduction` (`@default(0)`) + `netTransferAmount` /
`shopNetAmount` — the latter two are **nullable**: `null` = batch approved before Phase 2
= จ่ายเต็ม (every reader falls back `?? totalAmount` / `?? shopPostedAmount`, identical
because those batches' deduction is definitionally 0). `@@unique([batchId, contractId])`
เดิมคงไว้ — สัญญาเดียวกันอยู่ทั้งรายการจ่ายและรายการเรียกคืนในรอบเดียวกันไม่ได้
(`buildSnapshot` reject พร้อมข้อความไทยก่อนชน DB constraint).

### Lifecycle

```
DRAFT --submit--> PENDING_APPROVAL --approve--> POSTED --reverse--> REVERSED
  ^                      |  |
  +------withdraw--------+  +--cancel--> CANCELLED
  |
  +--cancel--> CANCELLED
```

- `createBatch` / `updateBatch` (maker-only, DRAFT-only — `updateBatch` hard-deletes
  and recreates the item rows, safe pre-DRAFT since no JE references them yet):
  re-snapshots the 4 GL amounts per contract from
  `IntercoPendingService.getPendingContracts()` — **never** from
  `Contract.financedAmount`/`storeCommission` (spec F4 — those fields can legitimately
  diverge from the ledger, e.g. `storeCommission = null` while the 1A JE already booked
  a 10% fallback commission on 21-1102). Any requested contractId not currently in the
  pending queue (never activated / soft-deleted / already settled in another open batch)
  throws `BadRequestException` naming the contract number. Phase 2: `CreateBatchDto` also
  accepts optional `recallContractIds` — snapshotted from
  `IntercoPendingService.getPendingRecalls()` into `RECALL` item rows (ดูหัวข้อ
  "หักกลบเครดิตเปลี่ยนเครื่อง + เรียกคืน" ด้านล่าง).
- `submitBatch`: DRAFT → PENDING_APPROVAL, maker-only; re-checks none of the batch's
  contracts got grabbed by another `PENDING_APPROVAL`/`POSTED` batch since the snapshot
  (closes the race window between two makers). Phase 2: clash check เป็น **type-aware**
  (RECALL rows clash เฉพาะกับ RECALL items — ดูหัวข้อหักกลบ).
- `withdrawBatch`: PENDING_APPROVAL → DRAFT, maker-only.
- `cancelBatch`: DRAFT/PENDING_APPROVAL → CANCELLED — role-gated at the controller
  (`ACCOUNTANT`, `FINANCE_MANAGER`), not maker-restricted in the service itself.
- `uploadSlip`: attaches proof-of-transfer to `slipFileKey` (S3 upload + magic-byte
  re-check on top of the controller's `FileTypeValidator`; PDF/JPEG/PNG/WEBP, ≤5MB) —
  maker-only, DRAFT/PENDING_APPROVAL only, optional (a backfilled historical round may
  have no surviving slip).
- `approveBatch` / `reverseBatch`: role-gated at the controller
  (`OWNER`, `FINANCE_MANAGER`) — **no maker-restriction and no maker≠approver rule by
  default** since 2026-08-03. See "Approve — atomic paired JE" step 1b for the opt-in
  `interco_maker_checker_enabled` flag.

### Pending lens (คิวรอจ่าย) — `IntercoPendingService`

Per-contract "payableOrigin", GL-only (`interco-pending.service.ts`):

```
financedGl_i    = Σ(Cr−Dr) of 21-1101 from POSTED JEs where metadata.contractId = i
commissionGl_i  = Σ(Cr−Dr) of 21-1102 from POSTED JEs where metadata.contractId = i
shopFinancedGl_i / shopCommissionGl_i = same on SHOP S11-3001 / S11-3002, sign flipped (Dr−Cr)
legacyNoShop_i  = (shopFinancedGl_i == 0) AND (shopCommissionGl_i == 0)
```

Computed via raw `$queryRaw` (`GROUP BY je.metadata->>'contractId' HAVING SUM(credit-debit)
> 0`) — Prisma cannot `GROUP BY` a JSON path. **Settlement-batch JEs never enter this
lens by construction**: they stamp `metadata.items[]` (many contracts per JE), not a
single `metadata.contractId`, so there's no metadata-filter special-casing needed to keep
them out.

**สัญญาเปลี่ยนเครื่อง (PRICED device swap) ปรากฏในคิวนี้ตั้งแต่ 2026-08-03** — ก่อนหน้านั้น
A.3 ล้าง 21-1101/21-1102 ทันทีตอน finalize (D5) เลนส์ FINANCE (`HAVING SUM(credit-debit)
> 0`) จึงไม่มีวันเห็นสัญญาเหล่านั้นเลย. ตอนนี้เจ้าหนี้ทั้งสองบัญชีค้างไว้ตามปกติ สัญญาเปลี่ยนเครื่อง
จึงจ่ายผ่านรอบจ่ายเดียวกับการขายปกติทุกประการ (`legacyNoShop = false` เพราะ F2 SHOP leg
ตั้ง S11-3001/S11-3002 ไว้ให้ SHOP half ของรอบจ่ายล้าง). พิสูจน์ที่
`exchange-priced-flow.integration.spec.ts` Case 2A (assertion ตรงข้ามกับของเดิมทุกประการ).

**Phase 2 typed lenses (หักกลบ)** — `PendingContract` gains 3 fields:
`swapCreditGl` (Σ Dr−Cr of 11-2107 filtered to type `SWAP_CREDIT` — **explicit
`metadata.shopReceivableType` stamp ชนะ, flow เป็น fallback** ไม่ใช่ OR: stamp =
`SWAP_CREDIT`, **หรือ** ไม่มี/ไม่รู้จัก stamp แล้ว `metadata.flow =
'exchange-buyback-receivable-11-2107'` (legacy A.3). ข้อความเดิมที่เขียนว่า "stamp OR
flow" **ผิด** — แก้ 2026-08-21 ตาม Phase 4 Task 6 ให้ตรง `classifyShopReceivable` ที่เช็ค
`EXPLICIT.has(...)` ก่อน `FLOW_MAP` เสมอ; ถ้าเป็น OR จริง JE รูป A.3 ที่ stamp ประเภทอื่น
จะถูกนับสองประเภทพร้อมกัน ⇒ `intercoNet` บวมเท่าตัว), `shopBuybackPayableGl` (Σ Cr−Dr of S21-1104,
keyed by `metadata.newContractId` — the A.4 stamp), and `swapCreditEligible` (ดู
eligibility rule ในหัวข้อหักกลบด้านล่าง). `getPendingRecalls()` is a separate queue of
`RecallCandidate { recallGl, shopRecallGl }` rows — contracts with 11-2107
`PAYOUT_RECALL` ค้าง **สุทธิ** > 0 (Flow C-2; producer = C-2 redirect, live ตั้งแต่ Phase 3
2026-08-20 — ดูหัวข้อ "ยกเลิกสัญญา (Flow C — Phase 3)"). **สูตร NET (Phase 3 Task 4 — ปิด
carry b)**: `recallGl = typed PAYOUT_RECALL gross − Σ(swapCreditAmount + recallAmount)
ของ item ทุกประเภทใน batch POSTED ของสัญญานั้น` (`shopRecallGl` สูตรเดียวกันฝั่ง SHOP;
net ≤ 0.01 → หลุดคิว). เดิม (Phase 2) เขียนเป็น gross — ผิดสำหรับเคสยกเลิก swap ที่เคยถูก
หักเครดิตในรอบเก่า: redirect gross 11,000 แต่เงินที่ FINANCE โอนจริง 3,000 — เสนอ gross
จะหักซ้ำ 8,000 (11-2107 ติดลบ). `GET /interco-settlement/pending` now returns
`{ pending, recalls, reconcile }`. `SHOP_COLLECT` deliberately never enters either lens
(ล้างผ่าน `settleShopCollect` ตามเดิม — เงินลูกค้า ไม่ใช่เงินระหว่างกิจการ).

**Settled gate**: a contract leaves the pending queue the instant it has an
`InterCoSettlementItem` row inside a batch with status `PENDING_APPROVAL` or `POSTED`.
`REVERSED`/`CANCELLED` items do **not** count — reversing a batch puts every one of its
contracts straight back into the queue without touching the GL lens at all. **The recall
queue's gate filters `itemType: 'RECALL'` only** — a C-2 contract BY DEFINITION carries a
permanent SETTLEMENT item in some old POSTED batch; an any-type gate would make the
recall queue structurally empty forever.

`activatedAt` shown on the pending list = `MIN(je.posted_at)` of the JEs counted in the
lens — `Contract` has no reliable "date activated" field (`createdAt` is draft-creation
time, `updatedAt` moves on any unrelated edit).

`getReconcileTotals()` — account-level sanity check, shown alongside the queue:
`pendingTotal` (Σ over the queue) vs `glFinanceTotal` (whole-account 21-1101+21-1102
balance, no metadata filter) vs `glShopTotal` (S11-3001+S11-3002, no metadata filter). A
nonzero `drift` (`pendingTotal − glFinanceTotal`) means a stray JE exists without
`metadata.contractId` — almost certainly the old `inter-company-settlement` flow; the
pre-flight check (below) confirms this is 0 in prod before go-live. Phase 2 adds 3 typed
whole-account totals: `glSwapCreditTotal` (11-2107 typed SWAP_CREDIT), `glRecallTotal`
(11-2107 typed PAYOUT_RECALL), `glShopBuybackTotal` (S21-1104, no type filter). หมายเหตุ
ตาม gross-lens ruling: สองตัวแรกเป็น typed **gross สะสม** — ขา Cr 11-2107 ของ batch JE
ไม่ stamp type/contractId จึงไม่เคยลดตัวเลขนี้ — ส่วน `glShopBuybackTotal` เป็นยอดคงเหลือ
จริงของบัญชี (ขา Dr S21-1104 ของ batch ลดจริง) ⇒ สามตัวนี้**เลิก tie กันตั้งแต่รอบแรกที่มี
การหัก โดยตั้งใจ**; Σ สองประเภท = ยอด S21-1104 เฉพาะช่วงก่อนรอบหักแรกเท่านั้น.

### Approve — atomic paired JE (`approveBatch`, one `$transaction`)

Exact order as implemented in `interco-settlement.service.ts`:

1. **Load + status** — batch must be `PENDING_APPROVAL`.
1b. **Maker–checker (opt-in, DEFAULT OFF — คำสั่งเจ้าของ 2026-08-03)** — the hard
   "approver ≠ maker" rule was **retired**. Approval is now governed by **role
   assignment** alone: `@Roles('OWNER','FINANCE_MANAGER')` on
   `POST /interco-settlement/batches/:id/approve`. The SAME person may create a batch
   and approve it, provided they hold an approver role (กิจการเล็ก — เจ้าของสั่งให้คุม
   ด้วยการกำหนดสิทธิแทน). Strict segregation of duties is re-enablable **without a code
   change**: set SystemConfig **`interco_maker_checker_enabled` = `'true'`** and
   `approveBatch` restores `throw new ForbiddenException('ผู้อนุมัติต้องไม่ใช่ผู้สร้างรอบ')`
   when `batch.makerId === userId`. The key is **NOT seeded** anywhere — a missing row,
   or any value other than the exact string `'true'` (including `'false'`), means OFF.
   Read via `tx.systemConfig.findUnique({ where: { key: 'interco_maker_checker_enabled' } })`
   **inside the approve `$transaction`** so one value governs the whole approval — the
   same config-read shape as `OTHER_INCOME_MAKER_CHECKER_ENABLED`
   (`other-income-config.service.ts`) and `jp5_require_terminated_status`
   (`repossessions.service.ts`). No toggle endpoint / UI exists for this key yet —
   flip it with a SystemConfig row.
   **Audit trail is unchanged either way**: `makerId` and `approverId` are both still
   persisted on the batch row, and the `INTERCO_BATCH_APPROVED` AuditLog still records
   the acting `userId` — even when maker and approver are the same human.
2. **Double-batch re-check** — re-runs the "another open batch already grabbed this
   contract" query inside the tx (same query `submitBatch` ran, closes the remaining
   race window right up to the moment of posting). Phase 2: **type-aware** — SETTLEMENT
   rows keep the any-type clash (double-pay guard), RECALL rows clash only with other
   RECALL items (ดูหัวข้อหักกลบ — เหตุผลเชิงโครงสร้าง).
3. **Drift guard** — per item, reads the LIVE GL via `glContractBalance(tx, contractId,
   accountCode, side)` on all 4 lens accounts (`21-1101` cr, `21-1102` cr, `S11-3001` dr,
   `S11-3002` dr) and compares against the item's snapshot, tolerance `±0.01`. This
   deliberately does NOT reuse `IntercoPendingService.getPendingContracts()` — that
   service's own "settled" exclusion would hide this very batch's own
   `PENDING_APPROVAL` items from itself. Any drift → rejects the WHOLE batch, naming
   every drifted contract number, telling the maker to cancel and recreate (no partial
   approve). Phase 2 extends this with typed 11-2107/S21-1104 checks — a **two-branch**
   design (ดูหัวข้อหักกลบ): RECALL rows check both books' typed PAYOUT_RECALL balances
   against `recallAmount` instead of the 4 lens accounts.
4. **Period guard, both companies independently** —
   `validatePeriodOpen(tx, postedAt, financeCompanyId)` AND
   `validatePeriodOpen(tx, postedAt, shopCompanyId)` (SHOP has its own
   `AccountingPeriod` rows). `postedAt = postedAtOverride ?? batch.transferDate` (D4 —
   `ApproveBatchDto.postedAt` is the backdate override).
5. **Post JE(s)**:
   - If `buildShopLines` returns ≥1 line (i.e. ≥1 SETTLEMENT item with
     `legacyNoShop = false` **or** ≥1 deduction row — swap credit / recall) →
     `PairedJournalService.postPaired({ shop, finance, batchRef: batch.id }, tx)` —
     both halves in one transaction, balance-checked before either side posts.
   - If the SHOP half is empty (every item `legacyNoShop` and no deduction rows) →
     approve skips `postPaired` entirely and posts FINANCE alone via
     `JournalAutoService.createAndPost` — `shopJournalEntryId` stays `null`.
   - A concurrent double-approve losing the DB idempotency-index race gets a Thai
     `ConflictException` (409), not a raw 500 — the whole tx rolls back.
6. **Mark `InterCompanyTransaction`** rows whose `contractId` is in this batch →
   `RECONCILED` (best-effort `updateMany`, no-op if none exist — does not block posting).
7. **Batch → `POSTED`** + `financeJournalEntryId`/`shopJournalEntryId`/`approverId`/
   `postedAt` set + `AuditLog { action: 'INTERCO_BATCH_APPROVED', entity:
   'interco_settlement_batch' }`.
8. **AFTER the tx commits** — fire-and-forget `alarmNettingResiduals(batchId)` (spec
   §4.7): alarm-only, never awaited/thrown on the money path, root prisma only
   (doctrine R-1 — same rule as `alarmResidualParkOnCompletion`). ดูหัวข้อหักกลบ.

### JE structure (both halves — `buildFinanceLines`/`buildShopLines`, รูปหักกลบ Phase 2)

FINANCE half (always posted):
```
Dr 21-1101  financedGl      (ONE line PER SETTLEMENT contract, description "ล้างเจ้าหนี้ยอดจัด {contractNumber}")
Dr 21-1102  commissionGl    (one line per contract WITH commissionGl > 0 — zero-commission contracts skip this line)
   Cr 11-2107  swapCreditAmount|recallAmount   (one line PER deduction row — description ระบุประเภท:
                                                "หักเครดิตเปลี่ยนเครื่อง {no}" / "หักเรียกคืนจากยกเลิก {no}")
   Cr <financeBankCode>  netTransferAmount     (default '11-1201'; line SKIPPED when 0 —
                                                รอบที่หักจนเงินโอนจริงเป็นศูนย์ต้องไม่มีบรรทัดธนาคาร)
```

SHOP half (settlement legs over items with `legacyNoShop = false`; deduction legs over
every deduction row; the WHOLE half is omitted only when BOTH sets are empty):
```
Dr <shopBankCode>  shopNetAmount            (default 'S11-1201' = ShopAccountResolver.SHOP_RECEIVING_BANK; skipped when 0)
Dr S21-1104  swapCreditAmount|recallAmount  (one line per deduction row — "ล้างเจ้าหนี้ FINANCE-ค่าเครื่องรับคืน {no}" /
                                             "ล้างเจ้าหนี้ FINANCE-เรียกคืนยกเลิก {no}")
   Cr S11-3001  shopFinancedGl      (one line per non-legacy SETTLEMENT contract)
   Cr S11-3002  shopCommissionGl    (skips zero, same as the FINANCE half)
```

RECALL rows contribute ONLY the `Cr 11-2107` / `Dr S21-1104` legs — never a zero-amount
`Dr 21-1101` line. Pre-Phase 2 batches (`netTransferAmount`/`shopNetAmount` = `null`)
fall back to `totalAmount`/`shopPostedAmount` — identical lines to the old shape.

**ตัวอย่าง (golden ใน `interco-netting.integration.spec.ts` — 2 สัญญาปกติ/สวอป เจ้าหนี้
11,000 ต่อสัญญา (10,000 + 1,000), เครดิตสวอป 8,000 + เรียกคืน 11,000):**
`totalAmount = 22,000` / `totalDeduction = 19,000` / `netTransferAmount = shopNetAmount
= 3,000` → FINANCE: `Cr 11-2107 = 19,000` + `Cr 11-1201 = 3,000`; SHOP: `Dr S21-1104 =
19,000` + `Dr S11-1201 = 3,000`. หลัง approve บัญชี 11-2107 ทั้งบัญชีลดลง 19,000 จริง.

**Metadata on BOTH JEs** (confirmed straight from `interco-settlement.service.ts` —
these are the ACTUAL keys, do not assume the plan's shorthand `batchId` key name):

```ts
{
  flow: 'interco-settlement-batch',
  idempotencyKey: `interco:${batch.id}:FINANCE` /* or */ `interco:${batch.id}:SHOP`,
  settlementBatchId: batch.id,       // NOT "batchId" — that name is PairedJournalService's
                                      // own batchRef param, distinct from this metadata key
  batchNumber: batch.batchNumber,     // e.g. "IC-20260801-0001"
  transferDate: batch.transferDate.toISOString(),
  netTransferAmount: '<2dp string>',  // = totalAmount for pre-Phase 2 fallback
  items: [{ contractId, type: 'SETTLEMENT'|'RECALL', financed: '<2dp string>',
            commission: '<2dp string>', swapCredit: '<2dp string>',
            recall: '<2dp string>' }, ...],
}
```

**Deliberately NO top-level `contractId`/`shopReceivableType`** on batch JEs — the
architecture ruling (ดูหัวข้อหักกลบ) keeps them out of every per-contract lens.

Idempotency: the usual partial unique index `journal_entries_idempotency_idx` covers
`flow + idempotencyKey` — re-approving an already-POSTED batch is blocked at the status
guard (step 1) long before idempotency would even matter.

### หักกลบเครดิตเปลี่ยนเครื่อง + เรียกคืน (Phase 2 — workbook 2026-08-19)

Spec: `docs/superpowers/specs/2026-08-19-device-swap-netting-cancel-workbook-design.md`
§4. เปลี่ยนรอบจ่ายจาก "เงิน 2 ขา" (FINANCE จ่ายเต็ม → SHOP โอนราคารับซื้อกลับผ่าน
shop-collect) เป็น **หักกลบเหลือโอนสุทธิขาเดียว**: เครดิตราคารับซื้อ (11-2107
`SWAP_CREDIT` ↔ S21-1104) และยอดเรียกคืนจากยกเลิก C-2 (11-2107 `PAYOUT_RECALL` ↔
S21-1104) ถูกหักออกจากเงินโอนของรอบ. Typed-balance helpers 4 ตัวอยู่ที่
`interco-typed-balance.ts` (`swapCreditFinanceBalance` / `swapCreditShopBalance` — ฝั่ง
SHOP key ด้วย `metadata.newContractId` ตาม A.4 stamp / `recallFinanceBalance` /
`recallShopBalance` — key ด้วย `metadata.contractId`) — **SQL twins** ของเลนส์ใน
`IntercoPendingService` และต้องสอดคล้อง `classifyShopReceivable`: **แก้ที่ไหนต้องแก้ทุกที่**
(เงื่อนไข SWAP_CREDIT มี 4 จุด — ดูย่อหน้าถัดไป).

**เงื่อนไข SWAP_CREDIT ฝั่ง 11-2107 = precedence ไม่ใช่ OR** (แก้ 2026-08-21, Phase 4
Task 6 — ข้อความเดิม "explicit stamp **หรือ** legacy flow" อ่านเป็น OR ตรงๆ ซึ่งผิด):
explicit stamp **ชนะ** เสมอ, flow เป็น **fallback เฉพาะเมื่อไม่มี stamp หรือ stamp เป็นค่าที่
ไม่รู้จัก** — carve-out รูปเดียวกับ `shopCollectTypedBalance` (Phase 3 Task 6). สูตรนี้ถูก
เขียนซ้ำใน **4 จุด** (ต้องแก้พร้อมกันทุกจุด): `swapCreditFinanceBalance`
(`interco-typed-balance.ts`), เลนส์ต่อสัญญา + `glSwapCreditTotal` ทั้งสองตัวใน
`interco-pending.service.ts`, และ `SWAP_COND` ใน `interco-aging.service.ts` (ตัวหลัง
compose จาก `LEGACY_SWAP_COND` ซึ่งเป็น branch fallback ตัวเดียวกัน — ประกาศครั้งเดียว
แล้วใช้ซ้ำ). **แถวเก่าให้ผลเท่าเดิมทุกบาท**: A.3 ยุค Phase 1+ เข้า branch แรก, A.3 ยุค
legacy (ไม่มี stamp) เข้า fallback เหมือนเดิม.

**สถาปัตยกรรม "เลนส์ typed = GROSS + settled ผ่าน item gate"** (คำตัดสินระหว่าง implement
— บันทึกใน plan Task 5): batch JE **ไม่ stamp** top-level `contractId` /
`shopReceivableType` (กันรั่วเข้า payable lens — คุณสมบัติเดิมตั้งแต่ C2) ⇒ ขา
`Cr 11-2107`/`Dr S21-1104` ของ batch **ไม่ลด typed balance ต่อสัญญา** — typed lens อ่านได้
เฉพาะขาตั้งหนี้ (gross) โดยตั้งใจ. "หักแล้วหรือยัง" อยู่ที่ `InterCoSettlementItem`
(settled gate) ไม่ใช่ GL metadata. ผลตามมา: residual ที่แท้จริงของสัญญา = typed gross −
Σ deduction ของสัญญานั้นใน batch สถานะ `POSTED` ทั้งหมด (ไม่ใช่ "typed balance ต้องเป็น 0
หลัง approve" — ค่านั้นไม่มีวันเป็น 0 ใต้สถาปัตยกรรมนี้).

**Eligibility rule** (`swapCreditEligible` ใน pending lens): หักได้เมื่อ **สองสมุดมียอด
ทั้งคู่และเท่ากัน ±0.01** (`swapCreditGl > 0 && shopBuybackPayableGl > 0 && |diff| ≤
0.01`). **Legacy swap** (finalize ก่อน Phase 1 — มี 11-2107 แต่ไม่มี S21-1104, spec §11.4)
จึง `eligible = false` โดยโครงสร้าง → เข้ารอบจ่ายได้ตามปกติแต่**ไม่มีบรรทัดหัก** (จ่ายเต็ม)
— เครดิต 11-2107 ของมันค้างไว้ล้างผ่าน shop-collect ตามเดิม. ห้ามหักฝั่งเดียว: ฝั่ง SHOP
ไม่มี S21-1104 ให้ Dr → ใบ SHOP ไม่ balance.

**Guards ตอน snapshot (`buildSnapshot` — createBatch/updateBatch, จับตอน submit/approve
อีกทีผ่าน re-check/drift):**
- สองสมุดมียอดทั้งคู่แต่ไม่เท่ากัน (`swapCreditGl > 0 && shopBuybackPayableGl > 0 &&
  !eligible`) → reject "ยอดเครดิตเปลี่ยนเครื่องสองสมุดไม่ตรงกัน" — GL ผิดปกติ
  ห้ามเดาหักข้างใดข้างหนึ่ง (legacy swap ที่ SHOP = 0 ไม่เข้าเงื่อนไขนี้).
- **Workbook IF guard ("คงสูตร IF ห้ามลบ")**: `swapCreditAmount ≥ payable ของสัญญานั้น`
  → reject (ราคารับซื้อต้องน้อยกว่าเจ้าหนี้ — นโยบายธุรกิจบอกว่าไม่เกิด).
- **ยอดสุทธิ ≥ 0 ทั้งสองสมุด**: `netTransferAmount < 0 || shopNetAmount < 0` → reject
  พร้อมแนะให้เลือกสัญญาเพิ่มหรือเรียกเงินสดคืนผ่านช่องทางรับโอนจากหน้าร้านแทน.
- ยอดเรียกคืนสองสมุดไม่ตรงกัน (`|recallGl − shopRecallGl| > 0.01`) → reject.
- W1 ขยาย: GL component ติดลบตัวใดตัวหนึ่งใน 6 บัญชีเลนส์ (เดิม 4 + 11-2107/S21-1104)
  → Sentry warning (`subsystem: 'interco-settlement'`) + reject.

**RECALL rows** (Flow C-2): เลือกผ่าน `CreateBatchDto.recallContractIds` → validate กับ
`getPendingRecalls()`; แถวมี GL snapshot ทั้ง 4 = 0, `legacyNoShop = false`, มีเฉพาะ
`recallAmount` (= ยอด **net** จากคิว — สูตร Phase 3 Task 4 ด้านบน). **Producer ของ JE
`PAYOUT_RECALL` live แล้ว (Phase 3 2026-08-20)** — C-2 redirect ตอนยกเลิกสัญญาหลังตัดจ่าย
(ดูหัวข้อ "ยกเลิกสัญญา (Flow C — Phase 3)"). ล้างได้ 2 ทาง: หักกลบรอบจ่าย (ทางนี้) หรือรับ
เงินสดคืนผ่าน `POST /interco-settlement/recalls/:contractId/settle-cash` (Phase 3 Task 6 —
reuse `ShopCollectSettlementTemplate` + `typeStamp: 'PAYOUT_RECALL'` + SHOP leg).

**Type-aware clash checks** (submit + approve step 2): แถว SETTLEMENT clash กับ item
ทุกประเภทใน batch เปิดอื่น (กันจ่ายซ้ำ — พฤติกรรมเดิม); แถว RECALL clash **เฉพาะกับ RECALL
item** — จำเป็นเชิงโครงสร้าง: สัญญา C-2 โดยนิยามมี SETTLEMENT item ถาวรใน batch POSTED
เก่า (รอบที่เคยจ่ายมัน) — ถ้า clash any-type รอบที่มีแถว recall จะ submit/approve ไม่ได้
ตลอดกาล. Mirror นิยามเดียวกับ settled gate ของ `getPendingRecalls`.

**Drift guard สองชั้น (approve step 3, แถว SETTLEMENT):**
- **(ก)** `swapCreditAmount > 0` → live typed balance **ทั้งสองสมุด** ต้องเท่ากับ snapshot
  ±0.01 — ไม่ตรง = drift.
- **(ข)** snapshot = 0 แต่ live มีเครดิต **nettable ทั้งสองสมุด** (`scFin > 0.01 && scShop
  > 0.01`) → drift — เครดิตที่หักได้จริงงอกหลัง snapshot; จ่าย gross ทั้งที่มีเครดิต
  nettable จะทำให้เครดิตนั้นไม่มีเจ้าหนี้เหลือให้หักตลอดกาล. **เงื่อนไข "สองสมุด" สำคัญ**:
  เครดิตสมุดเดียว (`scFin > 0, scShop = 0` — legacy swap §11.4) จงใจ**ไม่ใช่ drift**
  เพราะมันหักไม่ได้โดยโครงสร้างอยู่แล้ว — ถ้านับเป็น drift รอบที่มี legacy swap จะอนุมัติ
  ไม่ได้ตลอดกาล (cancel → สร้างใหม่ก็ snapshot 0 เท่าเดิม = deadlock).
- แถว RECALL (สูตร NET — Phase 3 Task 4, ปิด carry b): เทียบ live typed `PAYOUT_RECALL`
  ทั้งสองสมุด **หักด้วย Σ deduction ที่ batch POSTED อื่นเคยหักไปแล้ว (ทุก itemType)** กับ
  `recallAmount` ±0.01 — snapshot จาก `getPendingRecalls` เป็น net อยู่แล้ว live จึงต้อง
  เทียบสูตรเดียวกัน (เทียบ gross ตรงๆ จะ reject รอบ recall ที่ถูกต้องตลอดกาลสำหรับ swap
  ที่เคยถูกหักเครดิตในรอบเก่า).

**Residual alarm (spec §4.7)** — `alarmNettingResiduals(batchId)`: fire-and-forget
**หลัง tx commit** จาก `approveBatch` (root prisma เท่านั้น, doctrine R-1 — ห้าม
throw/await บนเส้นทางเงิน). ต่อ item ที่มี deduction > 0 — **สูตร COMBINED ต่อสัญญา
(Phase 3 Task 4 — ปิด carry b)**: `typed gross = SWAP_CREDIT + PAYOUT_RECALL รวมสองประเภท
ต่อสมุด (แยกสมุด)`, `residual = typed gross − Σ deduction ทุก itemType ของสัญญานั้นใน
batch POSTED ทั้งหมด`; `|residual| > 0.01` → `Sentry.captureMessage` warning
`subsystem: 'interco-netting'` (extra: typedFinanceGross/typedShopGross/postedDeduction/
financeResidual/shopResidual). เหตุที่ต้องรวมประเภท: สัญญา swap ที่ถูกยกเลิกภายหลัง (C-2)
มีประวัติข้ามประเภทบนสัญญาเดียว — SWAP_CREDIT ถูก mirror ตอน cancel จน typed เหลือ 0 ขณะที่
deduction 8,000 ยังค้างถาวรใน item table ส่วน PAYOUT_RECALL ถือ gross 11,000 ของ redirect;
เทียบทีละประเภทตาม itemType ของแถว (สูตร Phase 2 เดิม) จะ false-alarm ทันที — invariant
"= 0" ถือจริงที่**ระดับสัญญา** ไม่ใช่ระดับประเภท. ค่าปกติ = 0 พอดี; > 0 = เครดิตงอกหลัง
snapshot/หักไม่ครบ; < 0 = หักซ้ำ.

**Reverse**: mirror สองใบตามเดิม (ไม่ต้องแก้อะไรเพิ่ม) — ขา mirror `Dr 11-2107 /
Cr S21-1104` ทำให้เครดิตกลับมาค้าง และสัญญา/แถว recall กลับเข้าคิวเองโดยนิยาม settled
gate (item หลุดจาก `POSTED`).

**CI**: `deploy-gcp.yml` vitest step ครอบอยู่แล้วโดยไม่ต้องแก้ — `INTERCO_FILES=$(ls
src/modules/interco-settlement/__tests__/*.integration.spec.ts)` glob จับ
`interco-netting.integration.spec.ts` อัตโนมัติ และ step รันด้วย `--no-file-parallelism`
อยู่แล้ว (integration specs แชร์ DB เดียวกัน).

**รอ Phase 4 (carry — บันทึกไว้ อย่าลืม; (a)/(b) ปิดโดย Phase 3 2026-08-20):**
- ~~(a) C-2 producer ต้องตั้ง `PAYOUT_RECALL` เฉพาะเมื่อ batch ที่จ่ายสัญญานั้น POSTED
  จริง~~ — **ปิดแล้ว (Phase 3 Task 3/5)**: ตัว detection ของ C-2 เองคือ "มี
  `InterCoSettlementItem` type SETTLEMENT ใน batch **POSTED**" (`settledPayoutByContract`)
  — recall เกิดเฉพาะเมื่อจ่ายจริงแล้วโดยนิยาม; batch DRAFT/PENDING_APPROVAL ถูก guard
  ให้ถอนก่อนยกเลิก.
- ~~(b) residual alarm ควรแยก `postedDeduction` ตาม `itemType` กัน false warning~~ —
  **ปิดแล้ว (Phase 3 Task 4) ด้วยทิศตรงข้าม**: invariant ถือจริงที่ระดับสัญญา ไม่ใช่ระดับ
  ประเภท — alarm รวม typed สองประเภทต่อสมุดก่อนหัก Σ POSTED deductions (ดู "Residual
  alarm" ด้านบน) และ recall lens/drift เปลี่ยนเป็นสูตร net.
- ~~(c) เครดิต A.3-only ที่งอก**หลัง** approve (drift guard จับได้เฉพาะก่อน approve)~~ —
  **ปิดแล้ว (Phase 4 Task 4)**: `interco-reconcile.cron` finding kind
  **`SWAP_CREDIT_ONE_BOOK`** จับสัญญาที่มี 11-2107 `SWAP_CREDIT` ค้างแต่ S21-1104 = 0
  ทุกเดือน (กัน legacy ออกด้วย `getPhase2SwapContractIds()` — swap ยุคก่อน Phase 1 เป็น
  สภาพปกติตาม spec §11.4). เครดิตที่งอกหลัง approve **บนสัญญา swap ยุค Phase 2+** จึงถูก
  เห็นทุกเดือน แม้ drift guard ตอน approve จะผ่านไปแล้ว. **ขอบเขตของ detector:** มันต้องการ
  `isPhase2Era` (มี JE `shop-exchange-return` ที่ stamp `newContractId`) ⇒ สัญญาที่ไม่เคยมี
  A.4 ยุค Phase 2 **ไม่เข้า detector นี้** — เห็นได้ทาง Sentry รวมของ cron รายวัน
  (`legacyOneBookNet`) + แท็บอายุลูกหนี้เท่านั้น.
- ~~(d) **TOCTOU settle-cash vs approveBatch**~~ — **ปิดแล้ว (Phase 4 Task 5 ที่ต้นเหตุ +
  Task 4 เป็นตาข่าย)**: `approveBatch` เปลี่ยนเป็น **Serializable** แล้ว (SSI ต้องการให้
  **ทั้งคู่** เป็น Serializable จึงจะเห็นกัน — writer ใต้ READ COMMITTED ไม่ลงทะเบียน
  rw-conflict กับ SIRead lock ของใครเลย ⇒ ก่อนหน้านี้ Serializable ฝั่ง `settleRecallCash`
  ฝ่ายเดียวไม่มีผล). ผู้แพ้ race ได้ **409 ไทย** (P2034 → `ConflictException` + log warn +
  Sentry warning — `SentryExceptionFilter` จับเฉพาะ ≥500 จึงต้องยิงเอง) ไม่ใช่ raw 500.
  ตาข่ายสุดท้ายคือ finding kind **`NEGATIVE_TYPED`** ของ reconcile cron ซึ่งอ่านจาก
  `getNegativeTypedRows()` (คนละแหล่งกับรายงานหลักโดยเจตนา — เคสหักเกินแบบ**สมมาตร**
  ทำให้สองสมุดติดลบเท่ากัน ⇒ `bookMismatch = false` และไม่มียอดบวก ⇒ ถ้าอ่านจากรายงานหลัก
  detector จะไม่มีวันยิงเลย).
- ~~(e) **คิว recall กรอง net ฝั่ง FINANCE เท่านั้น** (`recallGl.lte(0.01) → continue`)~~ —
  **ปิดแล้ว (Phase 4 Task 4)**: finding kind **`BOOK_MISMATCH`** เทียบ `intercoNet` กับ
  `shopMirrorNet` ต่อสัญญาทุกเดือนโดยไม่สนใจว่าอยู่ในคิวหรือไม่ (ไม่มี settled gate) —
  shop-net mismatch ที่เกิดหลัง snapshot จึงไม่เงียบจนถึงตอนใช้ยอดจริงอีกต่อไป. แถว
  `legacyOneBook` ถูกกันออกจาก detector นี้ (สองสมุดต่างกันโดยนิยาม — spec §11.4).

**ยังเปิดอยู่ → Phase 5:**
- **ค่าคอมโผล่สมุดเดียว (`COMMISSION_ONLY_GAP`)** — สัญญาที่ `storeCommission` ว่าง:
  `ContractActivation1ATemplate` ตั้ง fallback 10% บน 21-1102 ส่วน
  `ShopInventoryTransferTemplate` รับมาเป็น 0 (`contract.storeCommission ?? 0`) ⇒
  `PAYABLE_PAIR_MISMATCH` ที่ต่างกันเฉพาะขาค่าคอม. reconcile cron **รายงานแล้วพร้อมป้าย
  กำกับ** (ยุบเป็นบรรทัดสรุปเดียวใน Todo แต่ยังนับเต็มในยอดรวม + Sentry แยก counter) แต่
  **ยังไม่แก้ที่ต้นเหตุ** — เป็นส่วนต่างจริงในบัญชี (opening-balance gap ตาม interco spec
  §11) ที่ต้องให้เจ้าของ/CPA ตัดสินว่าจะ (ก) ให้ SHOP ตั้งลูกหนี้ค่าคอม fallback ให้ตรง
  หรือ (ข) ให้ 1A เลิกตั้ง fallback. **ห้ามเดา JE ปิดช่องนี้เอง.**

  > **⚖️ CPA ตอบแล้ว 2026-08-24 (ข้อ C1) — เลือกทางเลือก (ก) · แก้โค้ดแล้ว 2026-08-24**
  > *"ทำไมต้องตั้ง เพราะเป็นรายได้ หน้าร้าน S41-1201 รายได้ - ค่าคอมจาก FINANCE"*
  > ⇒ SHOP ต้องตั้งค่าคอมให้ตรงกับ FINANCE. ทางเลือก (ข) ตกไป.
  > **สิ่งที่ยังบล็อก:** รายการแก้ย้อนหลังของสัญญาที่จ่ายรอบจ่ายไปแล้ว — FINANCE เครดิตธนาคาร
  > `ยอดจัด + ค่าคอม` แต่ SHOP เดบิตแค่ `ยอดจัด` ⇒ SHOP ต่ำไปทั้งเงินสดและรายได้ ⇒ ต้องให้ผู้สอบ
  > ชี้ว่าเป็น `Dr S11-1201 ธนาคาร / Cr S41-1201` หรือ `Dr S11-3002 ลูกหนี้ / Cr S41-1201`
  > (เปลี่ยนว่าสินทรัพย์ตัวไหนถูกแสดง).
  > **สิ่งที่ทำไปแล้ว (2026-08-24):** สูตร fallback 10% เคยมี **6 สำเนา** (ไม่ใช่ 4 อย่างที่
  > สำรวจรอบแรกคิด) — ยุบเป็น helper เดียว **`resolveStoreCommission`**
  > (`apps/api/src/utils/store-commission.util.ts`) ใช้ร่วมกันทั้ง 6 จุด:
  > `contract-activation-1a.template.ts` · `exchange-new-contract-1a.template.ts` ·
  > `compute-installment-breakdown.ts` · `contract-workflow.service.ts` (SHOP leg) ·
  > `contract-exchange.service.ts` (SHOP leg) · `exchange-plan.util.ts` (ใช้ค่าคงที่
  > `STORE_COMMISSION_FALLBACK_RATE`). ปักด้วยเทส 15 ตัวที่ util + 2 ตัวที่
  > `contract-workflow.service.spec.ts` (ไม่ระบุค่าคอม → SHOP ได้ 1800 ไม่ใช่ 0 · ระบุ 0 → คง 0)
  >
  > **สองกับดักที่เจอระหว่างแก้ (อย่ารื้อ):**
  > 1. `newCommission` ที่ `contract-exchange.service.ts` ถูกใช้ **สองที่** — ส่งเข้า SHOP template
  >    และเป็น fallback **ราคารับซื้อ** (`buyback = buybackPrice ?? financed + commission`)
  >    ⇒ แยกเป็น `newCommissionRaw` (ราคารับซื้อ ไม่เติม fallback) กับ `newCommissionBooked`
  >    (ลงบัญชี เติม fallback). ผู้สอบตัดสินเรื่อง *การลงบัญชี* ไม่ได้ตัดสิน *ราคาซื้อขาย*
  > 2. สาขา legacy fallback ของ `approvePriced` เขียน `storeCommission: Decimal(0)` เมื่อสัญญาเดิม
  >    เป็น null — **จงใจ ห้ามเปลี่ยนเป็น null** (ต่างจาก `vatAmount` บรรทัดถัดไปที่ต้อง pass null
  >    through): สาขานั้น clone `monthlyPayment` แล้วถอดหลังหา `interestTotal` ⇒
  >    `grossExclVat = financed + commission + interest` จะเท่ากับยอดที่ลูกค้าผ่อนจริงก็ต่อเมื่อ
  >    commission = 0 · ปล่อย fallback ทำงาน = ลูกหนี้เกินยอดผ่อนจริง 10%
  >
  > **อัปเดต 2026-08-26 — ขายผ่านไฟแนนซ์ภายนอกลงบัญชีได้แล้ว (คำตัดสินเจ้าของ "ทำให้ลงได้เลย")**
  > เปิด `S11-3101 ลูกหนี้บริษัทไฟแนนซ์ภายนอก` (กลุ่มใหม่ `S11-31XX`) + `S51-1106 ค่าธรรมเนียม
  > บริษัทไฟแนนซ์` · ต่อ `ShopExternalFinanceSaleTemplate` เข้า `sale-writer.service.ts` และ
  > `ShopExternalFinanceReceiptTemplate` เข้า `finance-receivable.service.ts recordReceive`
  > ⚠️ **สองรหัสนี้เป็นข้อเสนอของเรา ไม่ใช่คำวินิจฉัยผู้สอบ** (คำถามรอบ 3 ข้อ 2 ยังไม่ได้คำตอบ)
  > ถ้าผู้สอบให้รหัสอื่นต้องย้ายรายการที่ลงไปแล้วด้วย ไม่ใช่แค่แก้ค่าคงที่
  > · JE ตอนขาย: `Dr เงินสด[ดาวน์] + Dr S11-3101[ยอดไฟแนนซ์] / Cr รายได้` + คู่ต้นทุน/สต็อก
  > · JE ตอนรับเงิน: `Dr ธนาคาร[รับจริง] + Dr S51-1106[ค่าธรรมเนียม] / Cr S11-3101[เต็มยอด]`
  > **ค่าธรรมเนียมลงเมื่อปิดยอดครบเท่านั้น** และ JE ใช้ **ส่วนต่าง** เพราะ
  > `FinanceReceivable.receivedAmount` เป็นการเซ็ตทับ ไม่ใช่บวกสะสม
  > · ด่านเปิด/ปิดคือ "ผังมีบัญชีครบไหม" (`externalFinanceAccountsReady`) ไม่ใช่ feature flag
  > · **ลูกหนี้ภายในเครือ (`BESTCHOICE FINANCE`) ไม่เข้าเส้นทางนี้** — ล้างผ่านรอบจ่าย INTER-CO
  >   ตามเดิม (template `throw` ถ้าเผลอเรียก) กันล้างซ้ำสองทาง

  > **ยังบล็อก (รายการแก้ย้อนหลัง):** สัญญาที่จ่ายรอบจ่ายไปแล้ว — FINANCE เครดิตธนาคาร
  > `ยอดจัด + ค่าคอม` แต่ SHOP เดบิตแค่ `ยอดจัด` ⇒ SHOP ต่ำไปทั้งเงินสดและรายได้ ⇒ ต้องให้ผู้สอบ
  > ชี้ว่าเป็น `Dr S11-1201 ธนาคาร / Cr S41-1201` หรือ `Dr S11-3002 ลูกหนี้ / Cr S41-1201`
  > (เปลี่ยนว่าสินทรัพย์ตัวไหนถูกแสดง) · และ **สัญญาเก่ายังถูก `COMMISSION_ONLY_GAP` จับต่อไป**
  > จนกว่าจะทำรายการแก้ — การแก้โค้ดนี้เป็น forward-only.
  > ดู `docs/accounting/cpa-answers-2026-08-24.md` ข้อ C1
- ~~**`approveCancellation` ยังเป็น READ COMMITTED**~~ — **ปิดแล้ว (Phase 5 Task 5 ข้อ 2,
  2026-08-22)**: เคส TOCTOU ที่ "ยังไม่มีใครพิสูจน์ได้" **พิสูจน์ได้แล้ว** ด้วยเทสสอง
  คอนเนกชัน (`contract-cancellation.integration.spec.ts` — "TOCTOU: อนุมัติยกเลิก … ชนกับ
  อนุมัติรอบจ่าย"): การยกเลิกผ่าน guard "ไม่มี item ใน batch DRAFT/PENDING_APPROVAL" ตอนที่
  **ยังไม่มีรอบจ่าย** แล้วรอบจ่ายถูก create→submit→approve จนจบในหน้าต่างนั้น ⇒ ยกเลิกเดิน
  เส้น **C-1** mirror-reverse เจ้าหนี้ 21-1101/21-1102 ที่รอบจ่ายเพิ่งล้างไป = เจ้าหนี้ติดลบ
  และเงินที่โอนให้หน้าร้านไม่มีลูกหนี้เรียกคืน (C-2 ควรตั้งให้). ก่อนแก้ **ทั้งสองฝั่ง commit
  สำเร็จพร้อมกันจริง** เพราะ SSI ต้องการให้ทั้งคู่เป็น Serializable. ตอนนี้
  `approveCancellation` เป็น Serializable + แปลง **P2034 → 409 ไทย** (log warn + Sentry
  warning ที่ยิงเอง เพราะ `SentryExceptionFilter` จับเฉพาะ ≥500) — ขา `P2002 → 409` เดิม
  ยังอยู่ครบ. **หมายเหตุ**: การยกเลิกจึงกลายเป็น writer Serializable ตัวที่สี่ของตระกูลนี้
  (คู่กับ `approveBatch`/`settleRecallCash`) และ SIRead lock ของมัน **ไม่ได้แคบแค่ระดับสัญญา**
  — filter เป็นต่อสัญญา แต่ predicate lock เกิดตาม heap scan บน `journal_entries.metadata`
  ที่ไม่มี index จึง escalate ถึงระดับ relation ได้เหมือน `approveBatch` (ต่างกันที่ความถี่
  เท่านั้น) ⇒ ผลข้างเคียงให้ดูหัวข้อ "ผลข้างเคียงที่ต้องเฝ้า" ท้ายไฟล์
  (ยังไม่มีตัวไหนบนเส้นทางรับชำระแปลง P2034).
- **`swapCreditShopBalance` / Query B ฝั่ง S21-1104 เป็น stamp-only ไม่มี flow fallback** —
  ทั้งที่ `FLOW_MAP` map `'shop-exchange-return' → 'SWAP_CREDIT'` ⇒ SQL ฝั่ง SHOP **แคบกว่า
  `classifyShopReceivable` โดยตั้งใจ** (asymmetry กับฝั่ง 11-2107 ที่มี fallback). ปลอดภัย
  ตราบใดที่ A.4 ยุค Phase 2+ stamp ประเภทเสมอ (ซึ่งเป็นจริงตั้งแต่ Phase 2 Task 1) — JE
  `shop-exchange-return` ที่ **ไม่มี** stamp จะถูก util จัดเป็น SWAP_CREDIT แต่เลนส์ SQL
  มองไม่เห็น. รอเคสจริง/CPA ก่อนตัดสินว่าจะเติม fallback ให้สมมาตรหรือประกาศว่า stamp
  บังคับถาวร — **ห้ามเติมข้างเดียวโดยไม่ตรวจว่ามีแถวแบบนั้นจริงบน prod**.
- **P2034 translation บนเส้นทางรับชำระ** — `approveBatch` เป็น Serializable แล้วและ SIRead
  lock ของมัน escalate ได้ (ดู "ผลข้างเคียงที่ต้องเฝ้า" ในหัวข้อ `approveBatch` ด้านล่าง) ⇒
  writer Serializable ตัวอื่น (`payment-receipt-orchestrator` / `installment-accrual-2a` /
  `repossessions` / `reschedule-collect` / `paysolutions-webhook`) กลายเป็นผู้แพ้ race ได้
  และ **ไม่มีตัวไหนแปลง P2034** ⇒ raw 500. **ทริกเกอร์ที่ให้ลงมือ: spike ของ Sentry
  `[interco] P2034 write-conflict translated to 409` หรือ `[cancellation] P2034 …`**
  (ตั้งแต่ Phase 5 การยกเลิกสัญญาเป็น Serializable writer อีกตัว และ predicate lock ของมัน
  ก็ escalate ได้เช่นกัน) — อย่าเติมล่วงหน้าแบบเหวี่ยงแห
  ให้เติมทั้งเส้นทางเมื่อเห็นสัญญาณจริง (pattern เดียวกับ `approveCancellation` ที่รอเคสจริง
  ก่อนยก isolation).
  **2026-09-29 (ตั้งลูกหนี้งวด ณ วันรับเงิน):** การรับชำระที่ทำให้งวดที่ยังไม่ตั้งลูกหนี้ชำระครบ ลงรายการ 2A เพิ่มใน
  ธุรกรรมเดียวกัน ⇒ มีคู่ชนใหม่กับรอบกลางคืน (unique index ของ `reference` → `P2002`) นอกเหนือจาก `P2034` เดิม.
  เส้นทางคิวอนุมัติ (`payment-approval.controller.ts`) แปลงทั้งสองรหัสเป็น 409 อยู่แล้ว; เส้นทางบันทึกตรง
  (`POST /payments/record`, auto-allocate, ใช้เครดิต) **ยังไม่แปลง** ⇒ ฝ่ายแพ้ได้ข้อความทั่วไปของระบบ (HTTP 500).
  template ที่ใช้ร่วมกับ webhook ห้ามเป็นที่แปลง. เมื่อลงมือเติมการแปลงตามทริกเกอร์ข้างบน ให้ครอบ `P2002` ของรายการ 2A ไปพร้อมกัน.
  **2026-09-30 (ก1):** ใบรับชำระบางส่วนก่อนวันครบกำหนดลง 2A ด้วย ⇒ ใบสองใบของงวดเดียวกันพร้อมกันชนกันได้ที่ `reference`
  `<id>:receipt-accrual:<k>` (`P2002`) หรือที่การเขียนยอดสะสมแบบ compare-and-set (`P2025`) นอกเหนือจาก `P2034` — กติกาเดียวกัน
  (ไม่แปลงใน template).
- **แถวผีของ swap ยุค legacy ที่ถูกยกเลิก** (mirror ไม่มี stamp) — วันนี้ = false alarm
  รายวันใน `legacyOneBookNet` + `ACCOUNT_DRIFT` รายเดือนที่ไม่มีเลขสัญญา (ดูรายละเอียดใน
  หัวข้อ "สมการของ `ACCOUNT_DRIFT` ระดับบัญชี"). ทางแก้ = backfill stamp ให้ mirror ยุคเก่า
  **หรือ** ให้เลนส์รู้จัก flow `exchange-cancel` — ต้องนับจำนวนแถวจริงบน prod ก่อนตัดสิน.
- **การจ่ายนำส่ง/opening balance ฝั่ง SHOP** (interco spec §11) — **CPA ตอบแล้ว 2026-08-24:**
  opening balance = ข้อ A2 "ต้องตั้ง" · บัญชีเจ้าหนี้ฝั่ง SHOP = ข้อ A1 `S21-1104` ·
  จ่ายนำส่งรวม = ข้อ C5 "ต้องแยกบันทึก". **ยังไม่แก้โค้ด** และแต่ละข้อยังมีคำถามค้างที่ต้องถาม
  รอบ 2 ก่อนลงมือ — ดู `docs/accounting/cpa-answers-2026-08-24.md`
  ไม่ได้อยู่ในขอบเขต Phase 4.

### `legacyNoShop` policy (F1/F2)

A contract is `legacyNoShop = true` when its SHOP-side GL (S11-3001 + S11-3002) is
exactly 0 for that contract. These contracts settle FINANCE-only: no SHOP JE line is
generated for them at all, and if EVERY item in a batch is `legacyNoShop`, the SHOP half
is skipped entirely (`shopJournalEntryId` stays `null`).

**นิยามแคบลง 2026-08-03** — สัญญาจาก **contract-exchange (device swap) ไม่ใช่กรณี
`legacyNoShop` อีกต่อไป** (ข้อความเดิมของหัวข้อนี้ที่นับ device swap รวมอยู่ด้วย **ยกเลิก**):
ตั้งแต่ 2026-08-01 (F2) มันโพสต์ SHOP leg แล้ว และตั้งแต่ 2026-08-03 (คำสั่งเจ้าของ ยกเลิก D5)
มันปล่อยให้ทั้งสองฝั่งค้างไว้ จึงเข้าคิวจ่ายเป็นแถวปกติที่ `legacyNoShop = false`.
`legacyNoShop = true` เหลือความหมายเดียวคือ **สัญญาที่ activate ก่อน 2026-06-23**
(commit `bbcfa7a3`, PR #1280 — ก่อน SHOP-side receivable ถูกต่อเข้า
`contract-workflow.service.ts`).

`batch.shopPostedAmount` only sums the non-legacy items, so it can be strictly less than
`batch.totalAmount` — the gap is real money FINANCE wired to SHOP with no SHOP-side
receivable on record to clear it against. **Phase 2 note: `shopPostedAmount` keeps its
original meaning — ยอดลูกหนี้ฝั่ง SHOP ที่ถูกล้าง (Σ Cr S11-3001 + S11-3002) — it is NO
LONGER the cash figure once a batch has deductions; เงินรับจริงฝั่ง SHOP =
`shopNetAmount` (= shopPostedAmount − totalDeduction).** Likewise `totalAmount` is still
Σ เจ้าหนี้ (gross), never the wire amount — that's `netTransferAmount`. **The system deliberately does not guess a JE
for that gap.** It was an open opening-balance question pending CPA ruling (spec §11):
should the SHOP books get a retroactive opening balance for the May–22 Jun 2026 window
(pre-SHOP-books era)?

> **⚖️ CPA ตอบแล้ว 2026-08-24 (ข้อ A2): "ต้องตั้ง"** — ยอดยกมาฝั่ง SHOP ต้องบันทึกย้อนหลัง
> **ยังไม่แก้โค้ด และยังลงมือไม่ได้** เพราะผู้สอบยังไม่ได้ตอบ: ลงเฉพาะงบดุลหรือรื้อ P&L ด้วย ·
> คู่บัญชีเป็น S32-1101 (กำไรสะสม) หรือ S33-1101 (กำไรปีปัจจุบัน) · ค่าคอมใช้ตัวเลข GL หรือฟิลด์สัญญา ·
> ลงวันที่อะไร · รวมเงินดาวน์ลูกค้า/สินค้าคงเหลือ/เจ้าหนี้ซัพพลายเออร์ด้วยไหม (สามอย่างหลังไม่ได้อยู่ใน
> คำถามที่ถามไป แต่เป็นรูในหน้าต่างเดียวกัน). คิวรีนับประชากรอ่านอย่างเดียว:
> `docs/accounting/shop-opening-balance-enumerate-2026-08.sql` · รายละเอียด:
> `docs/accounting/cpa-answers-2026-08-24.md` ข้อ A2

**จนกว่าจะได้คำตอบครบ — do not invent a JE to close this gap.** (The
sibling question "should device-swap contracts get a SHOP leg wired at all?" is **ANSWERED
— yes**, F2 2026-08-01; those contracts are no longer part of this gap.)

### Reverse (`reverseBatch`, POSTED → REVERSED)

`OWNER`/`FINANCE_MANAGER` only, `reason` required (≥10 characters, Thai error message on
violation). Mirror-reverses **both** JEs in one `$transaction`: for every line, swaps
Dr/Cr, keeps the same `companyId`, and posts via `JournalAutoService.createAndPost` with
`metadata.tag: 'REVERSAL'`, `metadata.flow: 'interco-settlement-batch-reverse'`,
`metadata.idempotencyKey: interco-reverse:<originalJeId>`, `metadata.reversesEntryId:
<originalJeId>` (the same reversal shape used elsewhere in the codebase, e.g.
`ExchangeCancelReversalTemplate`). The original JEs are NOT soft-deleted or unposted —
they're stamped `metadata.reversed = true` + `metadata.reversedByEntryNumber` and stay
`POSTED` for audit trail; the two mirror JEs sit beside them. Batch → `REVERSED` +
`reverseReason` persisted. Because the pending engine's "settled" gate only excludes
`PENDING_APPROVAL`/`POSTED` items, reversing a batch instantly returns every one of its
contracts to the pending queue — no GL-lens code path change needed, it falls out of the
gate definition automatically.

**Canceled-contract guard (final review Phase 3, 2026-08-21):** a batch containing ANY
contract that is `CANCELED` (or has an APPROVED `ContractCancellation` row —
belt-and-braces for hand-edited status drift) REFUSES to reverse with a Thai
`BadRequestException` naming the contract numbers — reversing would resurrect the
canceled contract into the pending queue at full gross (its 1A `Cr 21-1101/21-1102`
still sits in the lens; only the settled gate hid it) AND inflate its recall row back
to gross. The only path for such a round is a manual JV through the CPA. Defense in
depth: `getPendingContracts`' contract hydration also filters
`status: { not: 'CANCELED' }` so a canceled contract never re-enters the payable queue
even if the gate opens through some other path (the recall queue deliberately does NOT
filter — C-2 contracts are CANCELED by definition and must appear there).

### D4 — backdated / closed-period rounds

`ApproveBatchDto.postedAt` (optional ISO date string) lets the checker pin the posted
JE's date to a day inside an already-open accounting period, independent of
`batch.transferDate` (the real wire date, recorded once at `createBatch` time and always
echoed into the JE description via `formatBkkDate(batch.transferDate)` regardless of
which `postedAt` is chosen). If the period guard rejects either company's period,
`guardPeriodOpen` re-wraps the underlying `BadRequestException` to name WHICH company
(FINANCE or SHOP) has the closed period, and tells the maker their two options: pick a
`postedAt` in a month that's still open, or ask an OWNER to reopen the period through the
existing `PERIOD_REOPENED` flow (`.claude/rules/accounting.md` → "Reopen Period
workflow" above).

### Retirements

| Old thing | Status | Superseded by |
|---|---|---|
| `POST /accounting/intercompany/settle` (+ `settleWithJournal`) | Route kept, now returns `HttpStatus.GONE` (410) with a Thai message pointing at `/interco-settlement` — deliberately not deleted outright, so a stale script/client still calling it gets an actionable error instead of a silent 404 | `POST /interco-settlement/batches/:id/approve` |
| `apps/api/src/modules/shop-finance-settlement/` (whole module — never had a UI) | **Deleted** | `IntercoSettlementService.approveBatch`'s SHOP half (`buildShopLines`) |
| `ShopFinanceReceiptTemplate` | **Deleted** — zero remaining references anywhere under `apps/api/src`, including `journal.module.ts` (confirmed by grep) | SHOP JE lines built inline in `approveBatch` and posted via `PairedJournalService`/`JournalAutoService` directly — no template class for this leg anymore |
| `VendorClearanceTemplate` | **Deleted** — dead code, never had a production caller; removed from `journal.module.ts` | `buildFinanceLines` inline in `approveBatch` |
| `IntercompanyService.getOutstandingBalance()` | Formula corrected (was: FINANCE from `21-1102` only — missed `21-1101`, the bulk of the payable — plus SHOP from `11-2105`, a dead Phase A.3 placeholder account nothing ever posts to) | New: FINANCE = Σ(Cr−Dr) `21-1101`+`21-1102` (companyId FINANCE); SHOP = Σ(Dr−Cr) `S11-3001`+`S11-3002` (companyId SHOP); response includes `driftNote: 'ส่วนต่าง = สัญญาก่อน 2026-06-23/เปลี่ยนเครื่อง (สมุด SHOP ยังไม่ตั้งลูกหนี้)'` so a nonzero drift reads as expected-legacy rather than a bug |
| `InterCompanyTransaction` model | **Kept** (read-only history) — `approveBatch` step 6 marks matching rows `RECONCILED` best-effort; not retired this sprint |

### Pre-flight (prod, before enabling)

See `docs/accounting/interco-preflight-2026-08.sql` for the 3 read-only queries (old-flow
JE count, FINANCE/SHOP payable backlog split by pre/post 2026-06-23, GL S11-3001/S11-3002
vs FINANCE cross-check) — run via cloud-sql-proxy per the usual runbook before creating
the first live batch.

---

## PEAK Code Mapping (Phase 3 SP3)

The owner uses **PEAK** (peakaccount.com) as the CPA's external bookkeeping system. Phase 3 SP3 wires a per-account PEAK code so the journal can be exported in PEAK's chart and uploaded for tax/audit handoff. Internal codes stay unchanged — PEAK is a parallel external chart.

### Schema

`ChartOfAccount.peakCode String?` (column `peak_code`, max 20 chars, partial index for non-null values). Migration `20260946000000_add_peak_code_to_chart_of_accounts` is idempotent (uses `IF NOT EXISTS`).

CSV fixture `apps/api/src/modules/journal/__tests__/fixtures/cpa-cases/finance-coa.csv` already has column 9 "เลขบัญชีในพึค" reserved — the CSV loader at `apps/api/src/modules/journal/__tests__/csv-fixture-loader.ts` now reads it as `peakCode`. Values remain EMPTY in the CSV; owner fills them via UI. The seeder (`apps/api/prisma/seed-coa-finance.ts`) only writes `peakCode` when the CSV cell is non-empty, so re-seeding never overwrites owner-set values.

### Settings UI

`/settings#peak-mapping` (OWNER only — non-OWNER blocked by the global SettingsPage guard). Tab provides:

- Editable table: `รหัสบัญชี | ชื่อบัญชี | รหัส PEAK` (in-row input, max 20 chars).
- Search by code/name/peakCode.
- Bulk import: paste `internal_code,peak_code` lines (header row auto-skipped).
- "ดาวน์โหลด CSV" → calls `GET /chart-of-accounts/peak-mapping/csv`.
- "บันทึก" enables only when there are unsaved changes; clears dirty map on success.

ACC role cannot reach the tab (settings page is OWNER-only) but the API endpoint accepts ACC for parity with the future role expansion — see `peak-mapping.dto.ts`.

### Endpoints

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/chart-of-accounts/peak-mapping` | OWNER, FM, ACC | Returns `{ id, code, name, type, peakCode }` for active accounts |
| PUT | `/chart-of-accounts/peak-mapping` | OWNER, ACC | Bulk update; rejects empty-string (must be null or trimmed); writes `PEAK_MAPPING_UPDATED` audit log with diff |
| GET | `/chart-of-accounts/peak-mapping/csv` | OWNER, FM, ACC | `text/csv; charset=utf-8` + UTF-8 BOM; filename `peak-mapping-YYYYMMDD.csv` (BKK) |
| GET | `/expenses/journal/export-peak?startDate&endDate` | OWNER, FM, ACC | CSV of POSTED journal lines tagged with mapped PEAK code |

### Export semantics

`/expenses/journal/export-peak` returns CSV columns: `entryDate, entryNumber, peakCode, accountCode, accountName, debit, credit, description, reference`. Money values are emitted as `Prisma.Decimal.toString()` to preserve precision (never `Number()`).

Guards:
- Date range capped at 186 days (~6 months). Longer ranges → `BadRequestException`.
- Lines whose account has no PEAK mapping are SKIPPED. The skipped count returns via header `X-Skipped-Lines` (and total rows via `X-Row-Count`). Both headers are CORS-exposed via `Access-Control-Expose-Headers`.

Frontend `/finance/peak-export` (OWNER, FM, ACC) wraps the call with a date-range picker and surfaces the skipped count as a warning banner with a deep link back to the mapping settings.

### Audit

`PEAK_MAPPING_UPDATED` audit log entry (action string, no Prisma enum). `entity = 'chart_of_account'`, `entityId` = comma-joined account codes, `newValue.changes` = array of `{ code, before, after }`.

---

## Wipe CLI (Phase A.4 migration helper)

`apps/api/src/cli/wipe-accounting.cli.ts` truncates all accounting data and reseeds the FINANCE chart.
**DESTRUCTIVE — requires all 3 env vars:**

```bash
# Dev / staging
CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice_dev npm --prefix apps/api run wipe:accounting

# Production (requires additional ALLOW_PROD_WIPE)
CONFIRM_WIPE=YES_I_AM_SURE EXPECTED_DB_NAME=bestchoice_prod ALLOW_PROD_WIPE=YES_I_AM_SURE npm --prefix apps/api run wipe:accounting
```

Guards (C7 hardening PR #741):
1. `CONFIRM_WIPE=YES_I_AM_SURE` — basic consent
2. `NODE_ENV=production` → also requires `ALLOW_PROD_WIPE=YES_I_AM_SURE`
3. `EXPECTED_DB_NAME` must match `current_database()` — prevents wrong-DB runs
4. 5-second Ctrl+C cooldown printed to stderr before any TRUNCATE

---

## Other Income Module (42-XXXX entries)

FINANCE-side other income (interest on deposits, penalty income, miscellaneous revenue).
Module: `apps/api/src/modules/other-income/`
Frontend pages: `apps/web/src/pages/other-income/`
Routes: `/other-income`, `/other-income/new`, `/other-income/:id`, `/other-income/:id/receipt`, `/other-income/daily-sheet`

Key accounts (from FINANCE chart — 111 บัญชี ณ 2026-08-08):
- `42-1102` — ดอกเบี้ยเงินฝาก (Bank interest income — exempt from VAT, subject to 15% WHT)
- `42-1103` — ค่าปรับชำระล่าช้า (Late fee — usually auto-posted via `PaymentReceipt2BTemplate` together with installment payment. Also bookable here for "late-fee-only" scenarios where customer pays just the penalty without settling the installment. **Watch for duplicate-entry risk**: if booked here, do NOT also pass `lateFee` on the next installment Payment for the same month, or 42-1103 will be credited twice.)
- `42-1104` — รายได้จากการหักค่าจ้าง (Payroll deduction — Pattern B deferred until payroll module exists)
- `42-1105` — กำไรจากการจำหน่ายสินทรัพย์ (Gain on disposal of assets — VAT 7%)

JE template: `OtherIncomeTemplate` at `apps/api/src/modules/other-income/templates/other-income.template.ts`
Doc numbering: `OI-YYYYMMDD-NNNN` (advisory-lock per-day sequence)
Lifecycle: DRAFT → POSTED → REVERSED (soft-delete via `deletedAt`)
WHT: per-item `whtPct` field; WHT payable posts to `21-3101`

### Override JV (manual JE edit before POST)

`POST /other-income/:id/post` accepts optional `{ override: true, overrideLines: [...] }`. When provided:
- Server validates V1 (Dr=Cr ±0.01), V2 (≥2 lines), V5 (Dr XOR Cr per line) via `JournalOverrideService`
- Sets `OtherIncome.isOverridden = true`
- Writes `AuditLog { action: 'JV_OVERRIDDEN', oldValue: { jvLines: <auto> }, newValue: { jvLines: <override>, diffSummary: <Thai> } }`
- UI shows ✏ marker in list pages for these documents

Audit `JV_OVERRIDDEN` action string — no Prisma enum (AuditLog.action is plain String).

### Maker-Checker toggle (Other Income)

`PUT /other-income/maker-checker` (OWNER only) toggles `OTHER_INCOME_MAKER_CHECKER_ENABLED`. Emits `CONFIG_CHANGED` audit string. When turning OFF, UI shows count of READY docs from `GET /other-income/maker-checker/pending-ready-count` for awareness — they auto-approve on next post.

### Reopen Period workflow

`POST /expenses/periods/reopen` (OWNER only) accepts `ReopenPeriodDto { companyId, year, month, reasonType, reason, taxFiled, boardResolutionId? }`:
- `reasonType`: enum (WRONG_ENTRY / MISSED_RECORD / AUDITOR_REQUEST / OTHER)
- `reason`: free text, min 10 chars
- `taxFiled`: true if ภ.พ.30 has been submitted (UI banner adds warning when true)

Persists `reopenReason` (format `${reasonType}: ${reason}`) + `taxFiled` on `AccountingPeriod`. Emits `PERIOD_REOPENED` audit. `closePeriod()` emits `PERIOD_CLOSED`. Race-safe via CAS — `updateMany` with `status: 'CLOSED'` filter inside `$transaction` prevents concurrent reopen.

`GET /expenses/periods/reopened` lists currently-reopened periods (status=OPEN AND reopenedAt set) for the `ReopenedPeriodBanner` shown on OtherIncomeListPage + ExpensesPage.

### Settings UI consolidation (P1–P6, 2026-06)

`/settings` is a registry-driven panel, OWNER/FM/ACC with per-item role filtering from `apps/web/src/config/settings-registry.tsx` (9 categories: company / access / accounting / finance / products / comms / ai / integrations / system). Routes: `/settings` → first visible category; `/settings/:categoryId` (panel) → `SettingsCategoryRoute` (index) + `SettingsItemRoute` (`:itemId`). Inline items render as sections (with hash anchor + scroll-to-section); route items render full pages inside the panel; pages with their own tabs (document-config, rich-menu) + operational pages (users / branches / promotions / contract-templates / audit-logs / pdpa) stay external. Old hash tabs (`#vat`, `#users`, etc.) and old `/settings/<name>` paths redirect to the new `/settings/<cat>/<item>` URLs. Settings are also indexed into the global CommandPalette. Helpers: `visibleCategories` / `visibleItems` / `searchSettings` / `findItem` in `settings-access.ts`.

**เชื่อมต่อ (integrations: hub + MDM) split out of the system category into its own category on 2026-06-24; system is now OWNER-only.** Old `/settings/system/integrations` and `/settings/system/mdm` redirect to `/settings/integrations/hub` and `/settings/integrations/mdm` respectively. ACCOUNTANT can see the `integrations` category (hub item has ACCOUNTANT role) but no longer sees `system` (all remaining system items are OWNER-only).

**Navigation is sidebar-driven (P5):** the gear/"ตั้งค่ากลาง" zone sidebar lists the 9 registry categories (`buildSettingsZoneSections` in `menu.ts` → `getSidebarForRole(role,'settings')`); the panel itself has NO desktop left sub-nav (just `SettingsLayout` header + search + `<Outlet/>`); mobile keeps a `<select>` category dropdown. One nav set, no menu-in-menu.

**รายชื่อผู้ติดต่อ (contacts) is standalone (P6):** removed from the `company` category and surfaced as the FIRST item inside the gear-zone "ตั้งค่าระบบ" submenu (a single section via `buildSettingsZoneSections`, above the registry categories — relabelled from the earlier "สมุดผู้ติดต่อ"/separate "ข้อมูลหลัก" group on 2026-06-24) → the existing `/contacts` page (`ContactsPage` → `ContactsTab`; guarded OWNER/FM/ACC). Old `/settings#contacts` redirects to `/contacts`. Because contacts was the only ALL-role item under `company`, that category is now effectively OWNER-only (`company.roles: ['OWNER']`) and no longer appears in FM/ACC's panel — they reach contacts via the settings submenu + CommandPalette ("รายชื่อผู้ติดต่อ"). The user-facing term is "รายชื่อผู้ติดต่อ" across menu/palette/page/contact-picker; code/comments still use "party master".

---

## REPAIR_SERVICE (SP5 Phase 2)

Auto-created on RepairTicket close (`returnToCustomer()`) depending on who pays the repair cost.

### Payer routing

| Payer | Document Created | Account | Notes |
|-------|-----------------|---------|-------|
| `SHOP` | `ExpenseDocument` (DRAFT) | `S51-1105` ค่าซ่อมอุปกรณ์ลูกค้า (SHOP CoA) | Dr. SystemConfig key: `REPAIR_EXPENSE_ACCOUNT_CODE` |
| `CUSTOMER` | `OtherIncome` (DRAFT) | `S42-1101` รายได้บริการซ่อม (SHOP CoA, new S42 service-revenue group) | Cr. SystemConfig key: `REPAIR_INCOME_ACCOUNT_CODE` |
| `SUPPLIER_CLAIM` | No accounting document | n/a | Physical supplier claim — no JE |

### Key design points
- Vendor = `repairSupplierId` from the repair ticket (must be a Supplier with `isRepairCenter = true`).
- Both documents are created as **DRAFT** — accountant reviews and posts manually. No auto-post on ticket close.
- The document creation is **atomic** via Prisma `$transaction` alongside the status transition. If document creation fails, the ticket status does NOT advance.
- `metadata.repairTicketId` is stamped on the created document for traceability (visible in audit log + document detail page).
- Document number: `EX-YYYYMMDD-NNNN` (expense) or `OI-YYYYMMDD-NNNN` (other income) — same convention as all other modules.

### SystemConfig keys
| Key | Default | Type |
|-----|---------|------|
| `REPAIR_EXPENSE_ACCOUNT_CODE` | `S51-1105` | SHOP CoA code (ค่าซ่อมอุปกรณ์ลูกค้า) |
| `REPAIR_INCOME_ACCOUNT_CODE` | `S42-1101` | SHOP CoA code (รายได้บริการซ่อม — new S42 service-revenue group) |

Owner sign-off on codes: 2026-05-20 (S51-1105 + S42-1101 + new S42 service-revenue group).

### Source
`apps/api/src/modules/repair-tickets/repair-tickets.service.ts` → `returnToCustomer()` for the atomic cross-module flow.

### Repair Ticket document number
| Module | Prefix | Example |
|--------|--------|---------|
| Repair Ticket | `RT` | `RT-20260519-0001` (per-day BKK sequence) |

`RepairTicketDocNumberService` uses the same advisory-lock BKK-day-bounds pattern as `DocNumberService`.

---

## Year-End Closing (P3-SP1, + Step 4 C3 2026-08-01)

Runs once at the end of each fiscal year (typically Jan-March of the following
year, after all 12 monthly periods are CLOSED). Closes revenue + expense
accounts into Income Summary (39-9999), transfers net income/loss to Retained
Earnings — current year (33-1101 — กำไร(ขาดทุน)สุทธิประจำปี), then sweeps
33-1101 into Retained Earnings — accumulated (32-1101 — กำไร(ขาดทุน)สะสม).

**Step 4 เพิ่มตามคำสั่ง CPA CSV (owner อนุมัติ 2026-08-01)** — `finance-coa.csv`
rows 80/82 instruct: 33-1101 "กำไรปีปัจจุบัน — ปิดเข้า 32-1101 สิ้นปี", 32-1101
"ยกยอดจากปีก่อน ปิดบัญชีเข้านี้สิ้นปี". ก่อนหน้านี้ 33-1101 ไม่เคยถูกปิดเข้า
32-1101 จริง — Step 4 ทำให้ตรงตามผังบัญชี CPA ก่อนปิดปี 2026 จริง.

Template: `apps/api/src/modules/journal/cpa-templates/year-end-closing.template.ts`
Service: `apps/api/src/modules/accounting/closing.service.ts`
Page: `apps/web/src/pages/YearEndClosingPage.tsx` → route `/finance/year-end-closing`

### 4-step JE flow

All entries share `metadata.batchId` (uuid) for traceability:

```
Step 1 — Close revenue (per non-zero 41/42-XXXX account):
  Dr 41-XXXX  [net Cr balance for the year]
  Dr 42-XXXX  ...
    Cr 39-9999 Income Summary  [revenueTotal]

Step 2 — Close expenses (per non-zero 51/52/53/54-XXXX account):
  Dr 39-9999 Income Summary  [expenseTotal]
    Cr 51-XXXX  [net Dr balance]
    Cr 52-XXXX  ...

Step 3 — Transfer net to retained earnings, current year (skipped if net = 0):
  If profit:  Dr 39-9999 / Cr 33-1101  [netIncome]
  If loss:    Dr 33-1101 / Cr 39-9999  [|netLoss|]

Step 4 — Sweep 33-1101 into 32-1101, accumulated (skipped if the LIVE
33-1101 GL balance is effectively 0 after Step 3):
  If Cr balance (กำไร):    Dr 33-1101 / Cr 32-1101  [balance]
  If Dr balance (ขาดทุน):  Dr 32-1101 / Cr 33-1101  [|balance|]
```

Step 4 reads the **live GL balance of 33-1101** (query runs AFTER Step 3 posts,
inside the same `$transaction` — Postgres sees a transaction's own earlier
uncommitted writes) rather than passing `netIncome` straight through. This
means any PRIOR-YEAR residue already sitting in 33-1101 (e.g. a year closed
before Step 4 existed, or a manual correcting JE) sweeps into 32-1101 too —
not only the current year's net. A direct consequence: Step 4 can fire even
when Step 3 is skipped (net = 0 this year, but residue > 0 from before), and
Step 4 can skip even when Step 3 fires (rare: this year's net exactly offsets
a negative residue).

Entry-date for all JEs = `Dec 31 23:59:59.999 BKK` of the closed year (keeps
the closing entries inside the year window).

### Guards

- **Year window**: 2020-2030, must be strictly `< current year` (cannot close
  future or in-progress year)
- **Monthly periods**: all 12 months for FINANCE company must be in
  `CLOSED` or `SYNCED` status — otherwise `BadRequestException` with the
  list of open months
- **Idempotency**: a year can only be closed once. `ConflictException` on
  re-attempt unless prior batch was reversed first (then re-close allowed)
- **Tx atomicity**: all JEs (1-4) created in a single `$transaction` —
  partial failure rolls all of them back

### Reversal escape hatch (OWNER only)

```
POST /accounting/year-end-closing/reverse
Body: { year, reason }  // reason min 10 chars
```

Enumerates every JournalEntry with `metadata.flow = 'year-end-closing'` +
`metadata.year = year` (NOT a hardcoded step count/id list) and mirror-flips
each one (Dr/Cr swapped), dated today (NOT the original Dec 31) — so Step 4
is picked up and reversed automatically alongside Steps 1-3, with zero
changes needed in the reversal path when Step 4 was added. Original entries
keep their POSTED status — reversal sits beside them with
`metadata.flow = 'year-end-closing-reverse'` + back-ref via
`reversesEntryId`. Originals are marked `metadata.reversedByBatchId` so the
idempotency guard no longer blocks a re-close.

AuditLog actions:
- `YEAR_END_CLOSED` — entity=accounting_period, entityId=batchId, newValue includes year + netIncome + JE ids (step1-4)
- `YEAR_END_CLOSING_REVERSED` — entity=accounting_period, entityId=originalBatchId

### Reports impact

After year-end closing posts:
- `getProfitLossFromJournal(Jan-Dec)` for the closed year returns ~0 for
  Revenue and Expense (they've been zeroed out), and `netIncome ≈ 0`
- `getTrialBalance(asOfDate >= Dec 31)` shows 33-1101 back to **0.00** (swept
  by Step 4) and 32-1101 increased by the swept amount (current year's net,
  plus any prior residue), Income Summary (39-9999) back to 0
- `getBalanceSheetFromJournal(asOfDate >= Dec 31)` — equity section reflects
  the year's profit moved all the way to accumulated retained earnings
  (32-1101), not just parked in the current-year 33-1101 bucket

`getEquityStatementFromJournal` (`apps/api/src/modules/accounting/general-ledger-report.service.ts:905`)
returns a `caveat` string — "ค่าประมาณกำไรปีปัจจุบัน — ยังไม่ปิดบัญชีจริงเข้า
33-1101 / 32-1101 (รอปิดบัญชีสิ้นปี)" — alongside its `currentYearProfit`
number. That NUMBER genuinely goes to ~0 for a year that has been closed via
this flow (its `getProfitLossFromJournal(yearStart, periodEnd)` sub-call sees
Steps 1-2's zeroed-out revenue/expense). The caveat TEXT itself, however, is
**static** — the method has no branch that checks whether the year is
actually closed, so the label is always returned verbatim regardless of
closure status. Don't read "the caveat disappears after closing" as fact:
only the accompanying number changes; the explanatory string does not. (Not
in scope here to add that conditional — flagging it as a known, pre-existing
gap only.)

`/accounting/periods` redirects to `/settings#periods` via `window.location.replace` (preserves hash; react-router `<Navigate>` cannot set hash fragments).

---

## Equity Module — ธุรกรรมส่วนของผู้ถือหุ้น (2026-08-10)

Spec: `docs/superpowers/specs/2026-08-10-equity-module-design.md` · Plan: `docs/superpowers/plans/2026-08-10-equity-module.md`
Module: `apps/api/src/modules/equity/` · หน้า: `/finance/equity`, `/finance/dividend-register`

- 7 ประเภท: CAP_INIT (ครั้งเดียว, ชำระขั้นต่ำ 25% ม.1110, ค้างชำระเข้า **11-1310**), CAP_INC (31-1102 premium),
  CAP_DEC, DRAW (22-1102 Contra), DIV_DEC (Dr 32-1101 / Cr 21-4104 — TAS 10), DIV_PAY (WHT 10% → **21-3104**,
  เฉพาะบุคคลธรรมดา/นิติต่างชาติ; นิติไทย 0 ตาม ม.65 ทวิ(10)), PRIOR_ADJ (คู่ 32-1101 เท่านั้น — TAS 8)
- YE_CLOSE ของ prototype ถูกตัด — ใช้ `/finance/year-end-closing` เดิม
- JE: builder เดียว `equity-journal.builder.ts` → `JournalAutoService.createAndPost` ·
  `metadata.flow='equity'`, `idempotencyKey='equity:<docId>'` · reverse = mirror ตาม pattern interco
- Workflow: DRAFT→READY→POSTED→REVERSED · maker-checker opt-in ผ่าน SystemConfig
  **`EQUITY_MAKER_CHECKER_ENABLED`** (ไม่ seed — missing = OFF; เปิดแล้ว approver ≠ maker; อ่าน config
  แบบ fail-closed — DB error = โยน ไม่ใช่ปิดด่านเงียบ ต่างจาก other-income ที่กลืน error) ·
  CAP_INIT โพสต์ใต้ pg advisory lock กันตั้งทุน 2 ใบพร้อมกัน
- GL guards ตอนโพสต์: `V_DIV_PAY_LE_PAYABLE` (Σจ่าย ≤ ยอด 21-4104), `V_CAP_DEC_LE_CAPITAL` (Σลด ≤ 31-1101) —
  block · `DIV_VS_RE` (ประกาศ > 32-1101) — **warning ไม่ block** (ปันผลระหว่างกาลทำได้)
- ภ.ง.ด.2: `GET /tax/pnd2-preview` + `export-xlsx?form=PND2` — อ่านจากเอกสาร DIV_PAY POSTED (ไม่เดิน GL)
  — เฉพาะผู้รับบุคคลธรรมดา (ม.50(2)); นิติไทย exempt, นิติต่างชาติ = ภ.ง.ด.54 (deferred)
- งบ Equity เดิมเพิ่ม `capitalStatus` (authorized/paidUp/unpaid/premium) + caveat เป็น conditional ตามสถานะปิดปี
- AuditLog: `EQUITY_CREATED/UPDATED/DELETED/SUBMITTED/WITHDRAWN/POSTED/REVERSED` (entity `equity_document`)
- **Prod rollout**: (1) รัน `seed:coa` หลัง deploy (บัญชีใหม่ 11-1310) (2) สร้างทะเบียนผู้ถือหุ้นตาม บอจ.5
  (3) **CAP_INIT backfill** — **CPA ตอบแล้ว 2026-08-24 (ข้อ A3): ไม่ให้ตัวเลข** แต่สั่งว่า
  *"ทำเป็นคู่มือให้ไปตั้งต้นเอง / หรือทำให้สามารถไปบันทึกค่าเริ่มต้นเอง"* ⇒ กลายเป็น **งานระบบ**
  ไม่ใช่คำวินิจฉัยบัญชี. ข้อจำกัดที่ตรวจแล้ว: `CAP_INIT` สร้างได้แค่ขาทุน/ค่าหุ้นค้างชำระ —
  ยอดยกมาเต็มชุดต้องมีเงินสด/ธนาคาร + กำไรสะสม + ยอดคงเหลืออื่นด้วย และโมดูล Equity เป็น
  **FINANCE-only โดยโครงสร้าง** (ฝั่ง SHOP ใช้ไม่ได้เลย) ⇒ ทางที่เหมาะคือหน้าบันทึกรายการ
  ปรับปรุงทั่วไป (JV) + คู่มือ ครอบทั้งสองสมุด. ยังต้องตัดสิน: FINANCE อย่างเดียวหรือทั้งสองสมุด ·
  ลงวันไหน · เปิดหน้า JV ถาวรหรือครั้งเดียวปิดด้วย flag. ดู `docs/accounting/cpa-answers-2026-08-24.md`
  ข้อ A3. **ยังห้ามโพสต์ขา Dr ธนาคารเงียบๆ**
- Deferred: Capital Call (รับชำระค่าหุ้นค้างภายหลัง — Dr เงิน / Cr 11-1310), แบบยื่น ภ.ง.ด.2 ทางการ,
  การเคลียร์ 22-1102 (DRAW) — ต้องทำ JV/PRIOR_ADJ มือไปก่อน, ภ.ง.ด.54

---

## Bad Debt Provision — ECL v4 (Per-Installment Aging, 2026-07-26 redesign)

TFRS for NPAEs Ch.13 aging-based Expected Credit Loss, 6 buckets (B0 implicit + B1-B5) — same buckets/rates as the earlier v3, but the BASE changed: v3 keyed a contract's ENTIRE provision off a single bucket (the oldest overdue installment); **v4 ages every outstanding installment independently** off its own `Payment.dueDate`, gives each its own bucket/rate, and sums the per-installment provisions into the contract total. A contract carrying installments overdue 90/60/30 days now provisions `757.92 + 227.37 + 30.32 = 1,015.61` (each installment at its OWN bucket's rate), not the whole outstanding balance provisioned at a single rate (e.g. the 90-day rate applied to all three installments' combined outstanding).

Source: `apps/api/src/modules/accounting/bad-debt.service.ts` + `bad-debt-provision.cron.ts` + `apps/api/src/modules/journal/compute-cn-breakdown.ts` (`computeInstallmentOutstanding` engine, shared with the CN pro-rate util) + `apps/api/src/modules/journal/gl-contract-balance.ts` (shared GL-balance helper) + `apps/api/src/modules/journal/cpa-templates/{bad-debt-provision,bad-debt-writeoff,ecl-stage-reverse,repossession-jp5}.template.ts`.

Spec: `docs/superpowers/specs/2026-07-26-ecl-per-installment-design.md`. Plan: `docs/superpowers/plans/2026-07-26-ecl-per-installment.md`.

### Buckets & rates (unchanged from v3)

| Bucket | Days overdue | Rate | Contract status | Notes |
|---|---|---|---|---|
| B0 | 0 (ปกติ) | 0% | ACTIVE | Implicit — no provision row created |
| B1 | 1-30 | 2% | ACTIVE | |
| B2 | 31-60 | 15% | ACTIVE | 60d alert trigger |
| B3 | 61-90 | 50% | ควร TERMINATED | Manual — not enforced by code |
| B4 | 91-180 | 75% | TERMINATED | |
| B5 | 180+ | 100% | TERMINATED (NPL) | |

Rates configurable via SystemConfig **`bad_debt_provision_rates`** (JSON `{bucket: rate}`) — code defaults above apply if the row is missing OR the JSON fails to parse (corrupt JSON → Sentry alarm + safe fallback to defaults; never silently posts on a stale/zero basis). Buckets now apply PER INSTALLMENT rather than per contract (see Method below), but the rate table itself is unchanged.

### Method — per-installment engine

- **Engine**: `computeInstallmentOutstanding(client, contract, { selection, asOf, preloaded })` in `compute-cn-breakdown.ts` — single source of truth for "how much is still owed on installment `i`, and how old is it", feeding BOTH ECL (`selection: 'DUE'`) and the CN pro-rate util (`selection: 'ACCRUED'`, via `computeCnBreakdown`). Two deliberately different universes:
  - **DUE** (ECL): iterates `Payment` rows directly — `status != 'PAID' AND dueDate < bangkokStartOfDay(asOf)` (คำตัดสินฝ่ายบัญชี 2026-09-28 — งวดนับเป็นเกินกำหนดเมื่อ**พ้นวันครบกำหนดแล้ว**; งวดที่ครบกำหนดวันนี้ยังไม่เข้าฐาน). Does NOT require accrual to have run (resilience: the ECL base must not go blind just because the 2A cron missed a day).
  - **ACCRUED** (CN, unchanged definition): iterates `InstallmentSchedule` rows with `accrualJournalEntryId != null`; unpaid = no `Payment` row with `status = 'PAID'`.
- **Exhaustive DUE status allow-list** — `DUE_STATUS_MAP` in `compute-cn-breakdown.ts` is typed `satisfies Record<PaymentStatus, boolean>` (PENDING/PARTIALLY_PAID/OVERDUE = `true`, PAID = `false`). This is NOT `status !== 'PAID'` — a 5th `PaymentStatus` value added later (e.g. CANCELLED/REFUNDED) fails compilation instead of silently flowing into the ECL base as "still due", forcing a deliberate yes/no decision at the call site.
- **Fee-netted outstanding** — both DUE and ACCRUED share the exact same `feeNettedOutstanding` formula (FEE-FIRST, PR #1313 convention) — never re-derived independently:
  ```
  netFee       = lateFeeWaived ? 0 : lateFee
  feeCollected = min(amountPaid, netFee)
  baseCash     = amountPaid − feeCollected
  outstanding  = clamp(amountDue − baseCash, 0, installmentTotal)
  ```
- **Per-row rounding, then sum** — each installment's provision = `outstanding × rate(bucket)`, rounded `ROUND_HALF_UP` to 2dp, THEN summed across installments (never round-after-sum). `computePerInstallmentProvision` in `bad-debt.service.ts` is the ONE shared aggregator used by BOTH `calculateProvisions` (daily cron) and `reverseStageOnPayment` (real-time payment hook) — the two can never independently drift on what "the current provision for this contract" means.
- **daysOverdue** = `bangkokDayDiff(Payment.dueDate, asOf)` (จำนวนวันปฏิทินไทย — รอบ 00:30 ของวันถัดจากวันครบกำหนด = 1 วัน) per installment (DUE selection); informational-only for ACCRUED (CN never reads it).
- **Persisted row shape** (`BadDebtProvision`): `agingBucket` = bucket of the OLDEST outstanding installment — display/sort convention only, does NOT mean the whole balance provisions at that rate. `bucketBreakdown Json?` (new column, migration `20260982000000_add_bucket_breakdown_to_bad_debt_provisions`) persists the TRUE per-bucket split: `{ "<bucket>": { count, base, provision } }` (count = installment count in that bucket, base/provision as 2dp strings). `provisionRate` persisted = blended (`provision / base`, 4dp) for backward-compat with any UI/report expecting one rate per contract.

### Streak floor — DORMANT by default (semantics CHANGED 2026-07-26)

**Breaking change from v3**: SystemConfig `consecutive_missed_bucket_map` missing, empty (`{}`), or corrupt JSON now means **NO floor at all**. This is a deliberate reversal of the old v3 behavior, where any of those cases silently fell back to a code-default map (`DEFAULT_STREAK_BUCKET_MAP`) — that fallback has been REMOVED from the code entirely. Only an EXPLICIT, non-empty SystemConfig row activates the floor.

- Missing row → no floor. The `ConsecutiveMissedService.getStreaks` query is skipped entirely (not just ignored — never called).
- `{}` (empty object, after JSON.parse) → no floor.
- Corrupt JSON → `Sentry.captureException` + no floor (v3 behavior was: Sentry + fall back to code defaults; v4 is: Sentry + apply literally nothing).
- Explicit non-empty row, e.g. `{"2": "31-60", "3": "61-90"}` → for a contract with N consecutive missed/overdue installments (`ConsecutiveMissedService.getStreaks` — max run of `PENDING/OVERDUE/PARTIALLY_PAID` with `dueDate < now`) — ฝั่งค่าเผื่อฯ ส่ง `bangkokStartOfDay(now)` เป็น `asOf` ตั้งแต่ 2026-09-28; ผู้เรียกฝั่งเปลี่ยนสถานะ DEFAULT ยังส่ง `now` ตามเดิม, floor bucket = the entry whose threshold is the LARGEST `<= N`. ONE floor bucket per contract (streak is a contract-level metric) is compared against EACH installment's own aging bucket independently — `effectiveBucket` picks whichever of (aging, floor) carries the HIGHER provision rate; the floor can only escalate a row, never downgrade it.

If the CPA later reinstates the floor as the operational default, that is a 1-row SystemConfig `INSERT` — no code change required.

### Daily cron (00:30 BKK) — GL-delta, self-healing (mechanics UNCHANGED by the per-installment redesign)

`BadDebtProvisionCron` — `@Cron('30 0 * * *', { timeZone: 'Asia/Bangkok' })`, fires after the 00:01 2A accrual cron. System-wide single run (not per-branch/company).

- For each in-scope contract, computes the TARGET provision (now via the per-installment engine — see Method above), compares it against the contract's actual **11-2102** GL balance (not the `BadDebtProvision` DB rows), and posts only the **delta** via `BadDebtProvisionTemplate`:
  - delta > 0 (increase) → `Dr 51-1103 / Cr 11-2102`
  - delta < 0 (release) → `Dr 11-2102 / Cr 51-1103`
  - `|delta| < 0.005` → skipped, no JE
- Idempotent per `(flow='provision', contractId, runDate)` where `runDate` = today's Asia/Bangkok date (`YYYY-MM-DD`) — re-running the same BKK day is a no-op; a new BKK day always re-evaluates and can post again.
- **Self-healing**: because the delta compares to the LIVE GL balance rather than DB state, a prior day's JE failure (caught per-contract, Sentry-alarmed, does not abort the batch) is automatically absorbed into the next day's delta — no manual backfill needed.
- `BadDebtProvision` row maintenance (REVERSE stale ACTIVE rows + createMany fresh ones) happens in one `$transaction` up front, decoupled from the JE-posting loop.

### ECL base

The universe differs by contract status (C1 final-review fix, 2026-07-26 — see "TERMINATED contracts" below for the history):

- **ACTIVE/OVERDUE/DEFAULT** — `Σ outstanding` (fee-netted, per `feeNettedOutstanding` above) over each in-scope contract's **DUE** installments (Payment-row-driven, does NOT require accrual to have run). This is a **resilient SUPERSET** of GL **11-2103**, not an exact tie — it deliberately stays visible even when the 2A accrual cron lags a day, so it can include installments 11-2103 hasn't booked yet.
- **TERMINATED** — `Σ outstanding` over only the **ACCRUED** installments (`InstallmentSchedule.accrualJournalEntryId != null`, unpaid). This DOES tie literally to GL 11-2103, because the 2A cron stops firing post-termination and admitting an un-accrued installment into the base would provision against interest/VAT that was never recognized (spec §2.2 "deferred ไม่ตั้งสำรอง"). **Exception since 2026-09-28**: an installment that is already accrued but whose due date has not fully passed yet (Bangkok calendar — `bangkokDayDiff(dueDate, asOf) < 1`) sits in 11-2103 but is NOT yet in the allowance base, because `BadDebtService.eclRows` filters it out (same "พ้นวันครบกำหนดแล้ว" cutoff as the DUE branch above). On that one day the two figures genuinely differ by that installment's amount — this is not a bug, it's the accountant's ruling that a due-today installment doesn't provision yet even once accrued.

**Late fee is excluded from the base** either way — it isn't a GL asset (only recognized as `42-1103` income when actually collected), so folding it in would overstate exposure.

Stage-reverse on payment (`BadDebtService.reverseStageOnPayment`, invoked from the payment-receipt flow) applies the same DUE/ACCRUED split per contract status, and only considers installments with `dueDate < bangkokStartOfDay(now)` — both paths go through `BadDebtService.eclRows` (TERMINATED/ACCRUED rows are date-filtered there because the engine's ACCRUED branch is shared with the CN util and must stay unfiltered) — future-dated installments never enter the aging/base recompute, so pre-paying ahead of schedule can't manufacture a stage-drop.

### TERMINATED contracts — ACCRUED-gated (C1 final-review fix, 2026-07-26)

v3 gave TERMINATED contracts a special "carrying amount" base (`11-2103 + 11-2101 − 11-2106` GL balances), because the 2A accrual cron stops firing once a contract is TERMINATED. The initial per-installment redesign (same day) retired that override and UNIFIED TERMINATED with ACTIVE — both used plain **DUE** selection. **A same-day final-review caught that this reintroduced the exact problem the carrying-amount base existed to prevent**: DUE is Payment-row-driven and does not require accrual, so a TERMINATED contract's un-accrued future installments (2A never runs again post-termination) would cross `dueDate < now` and get provisioned against interest that was never recognized. **Fix**: `calculateProvisions` and `reverseStageOnPayment` both branch on `contract.status` — TERMINATED calls the engine with `selection: 'ACCRUED'` (only installments 2A already accrued, unpaid); ACTIVE/OVERDUE/DEFAULT keep `selection: 'DUE'`. `terminatedCarryingAmount()` is still gone — this is NOT a revival of the old carrying-amount formula, just a narrower installment universe feeding the SAME per-installment bucket/rate math (`computePerInstallmentProvision`) ACTIVE contracts use.

- TERMINATED contracts stay IN SCOPE for the daily recalc (escalate while awaiting repossession/write-off) — only `CLOSED_BAD_DEBT` (already written off) drops out. Unchanged from v3.
- `reverseStageOnPayment` mirrors the same status branch — ACTIVE/OVERDUE/DEFAULT compute `target` off DUE rows, TERMINATED off ACCRUED rows; either way it releases `min(existing.provisionAmount − target, GL 11-2102)`.
- The golden below (2,122.16) is unaffected — all 3 installments in that fixture went through a real 2A run before being aged, so ACCRUED and DUE selections coincide for that specific case. `bad-debt.service.spec.ts` adds the divergence proof: a TERMINATED contract with 3 accrued + 2 past-due-but-never-accrued installments provisions ONLY the 3 accrued (2,122.16), not all 5.
- **The old v3 carrying-amount goldens no longer apply and must not be cited**: the carrying-amount golden (base `12,797.51` → provision `9,598.13`) described a base formula that has been deleted from the code. `ecl-terminated-base.spec.ts` asserts the ACCRUED-gated per-installment golden instead — see the goldens table below (**2,122.16**).

### Golden fixtures — 17,000฿ / 12-month contract (installmentTotal 1,515.83, vatPerInst 99.17)

Per-installment aging only (no floor — `consecutive_missed_bucket_map` absent):

| Scenario | Per-installment math (ROUND_HALF_UP each, then sum) | Provision |
|---|---|---|
| Single 30d installment (1-30, 2%) | 1,515.83 × 0.02 = 30.3166 → HALF_UP | **30.32** |
| {60d, 30d} (31-60 15% + 1-30 2%) | 227.3745 + 30.3166 → 227.37 + 30.32 | **257.69** |
| {90d, 60d, 30d} (61-90 50% + 31-60 15% + 1-30 2%) | 757.915 + 227.3745 + 30.3166 → 757.92 + 227.37 + 30.32 | **1,015.61** |
| {120d, 90d, 60d, 30d} (91-180 75% + 61-90 50% + 31-60 15% + 1-30 2%) | 1,136.8725 + 757.915 + 227.3745 + 30.3166 | **2,152.48** |
| Partial payment: due 1,515.83, paid 1,000 (no fee), 40d overdue (31-60, 15%) | outstanding = 1,515.83 − 1,000 = 515.83 → 515.83 × 0.15 = 77.3745 | **77.37** |
| TERMINATED, 3 installments at 100d/70d/40d (91-180 75% + 61-90 50% + 31-60 15%) | 1,136.8725 + 757.915 + 227.3745 | **2,122.16** (`ecl-terminated-base.spec.ts`, `agingBucket` display = `91-180`, `outstandingAmount` = 4,547.49) |

Floor-enabled (`consecutive_missed_bucket_map = {"2": "31-60"}`, streak = 2 consecutive missed installments):

| Scenario | Without floor | With floor | Why |
|---|---|---|---|
| {60d, 30d}, streak 2 | 257.69 | **454.74** | BOTH installments floored to 31-60 (15%): 2 × HALF_UP(1,515.83 × 0.15) = 2 × 227.37 = 454.74. The 30d installment's own aging bucket (1-30, 2%) loses to the floor (31-60, 15%) per-installment — higher rate wins. |

- **วันครบกำหนดเอง (2026-09-28):** งวดครบกำหนด 27 ส.ค. · รอบ 27 ส.ค. 00:30 → ไม่มีค่าเผื่อ · รอบ 28 ส.ค. 00:30 → เกิน 1 วัน ช่วง `1-30` = 30.32 (`bad-debt.service.spec.ts` "คำตัดสินฝ่ายบัญชี 2026-09-28")

CN (ใบลดหนี้) goldens are UNCHANGED by this redesign — the ACCRUED selection was already shaped this way before 2026-07-26 (it just now runs through the shared `computeInstallmentOutstanding` engine instead of its own copy of the logic). See "เอกสารใบลดหนี้" below for those numbers.

**By design, ECL's `outstandingAmount` and a CN's `totalOutstanding` can differ on the SAME contract at the SAME moment** — ECL for an ACTIVE/OVERDUE/DEFAULT contract uses DUE (Payment-row-driven, includes un-accrued past-due installments), while a CN only ever fires from JP5/write-off (both ACCRUED-only, and only ever on a TERMINATED-adjacent contract). An ACTIVE contract with a past-due-but-never-accrued installment shows it in ECL's DUE base right away, but that installment would not appear in a CN computed at that same instant (there is no CN yet — CN only issues at repossession/write-off time). Do not expect the two figures to reconcile 1:1 outside the "TERMINATED, fully-accrued" case where DUE and ACCRUED happen to coincide.

### Write-off & JP5 — GL-based clearing legs + consume-then-release residual (2026-07-26)

v3's `RepossessionJP5Template`/`BadDebtWriteOffTemplate` derived their clearing legs (`Cr 11-2103`, `Cr 11-2101`, etc.) by RE-DERIVING `installmentTotal × count` — count-based math. If a real partial 2B receipt had already reduced 11-2103 for an accrued installment, the count-based leg OVER-CREDITED it (clearing the full `installmentTotal` regardless of what cash was actually collected), leaving a stale nonzero balance on 11-2103 forever. **This was an open backlog item and is now CLOSED.**

**GL-based legs** — shared helper `apps/api/src/modules/journal/gl-contract-balance.ts` (`glContractBalance(client, contractId, accountCode, side)`, extracted 2026-07-26 from 3 previously-independent copies of the same query in `BadDebtWriteOffTemplate`, `RepossessionJP5Template`, and `BadDebtService`'s ECL delta cron): every clearing leg now reads the ACTUAL live GL balance for that contract/account instead of re-deriving from installment count. Loss/gain is whatever is left to balance the JE (`ΣCr(GL-based lines) − ΣDr(GL-based lines)`) — not a separately re-derived formula.

**Consume-then-release residual** (symmetric between JP5 and write-off):
```
provisionBalance = GL balance of 11-2102 for this contract
consume = min(loss, provisionBalance)          → Dr 11-2102 (when loss > 0)
release = provisionBalance − consume           → Dr 11-2102 / Cr 51-1103 (when > 0)
```
Once a contract is repossessed or written off there is no more receivable to provide against, so **11-2102 for that contract always lands on exactly 0** after the JE — via consume alone (provision <= loss), release alone (gain / exact-wash, consume = 0), or both (provision > loss), ASSUMING the pre-JE `11-2102` balance was itself non-negative. `metadata.releasedProvision` (string, `"0.00"` when nothing was released) is stamped on every JP5/write-off JE for audit traceability.

**Caveat (M1 final-review fix, 2026-07-26)**: a NEGATIVE pre-JE `11-2102` balance (Dr > Cr — e.g. a past mis-posted JE) is a GL anomaly, and neither template auto-heals it. `RepossessionJP5Template`/`BadDebtWriteOffTemplate` both clamp what they REPORT (`releasedProvision` never goes negative in `metadata` — `Decimal.max(0, ...)` on JP5's return value; write-off's `provisionConsumed`/`releasedProvision` already clamp via their existing `provisionBalance.gt(0)` guards) and fire `Sentry.captureMessage` (`subsystem: 'bad-debt'`, level `warning`) on `provisionBalance.lt(0)` so the anomaly surfaces for manual investigation instead of silently zeroing itself out. Neither template attempts to correct the underlying negative balance — that requires a human-reviewed correcting JE.

**JP5 partial-over-credit backlog: CLOSED.** Earlier documentation here warned that "the receivable-clearing legs are still count-based, only the CN VAT line is pro-rated" — that caveat NO LONGER APPLIES and must not be repeated. `bal2103 = glContractBalance(client, contractId, '11-2103', 'dr')` (and every other clearing leg) reads the live post-receipt balance. Proven by `jp5-vat-split.spec.ts` ("Cr 11-2103 = GL net after a REAL partial 2B receipt — closes the backlog over-credit (11-2103 = 0 after JP5)"): GL 11-2103 for the contract is asserted `0.00` after JP5 posts, even with a real partial 2B receipt in the mix beforehand.

**JP5 golden — Scenario A** (composed full-flow, `jp5-vat-split.spec.ts`): 1A + 2A×4 (installments 1-4 accrued) + 2B×3 (installments 1-3 REALLY paid in full via posted receipts) + a pre-existing 30.32 provision (B1 on installment #4) + JP5 @ repossessionValue 5,000.00 —

```
Dr  11-1101 (cash)          5,000.00
Dr  21-2101 (CN VAT)           99.17   ← installment #4, only accrued+unpaid, fully outstanding
Dr  11-2106                 4,000.00   ← GL: 6,000 − 4×500
Dr  21-2102                   793.32   ← GL: 1,190 − 4×99.17
Dr  11-2102 (consume)          30.32   ← min(loss 8,543.34, provisionBalance 30.32)
Dr  51-1102 (loss plug)      8,513.02  ← remainingLoss = 8,543.34 − 30.32
   Cr 11-2103                1,515.83  ← GL after 3 real receipts (4×1,515.83 − 3×1,515.83)
   Cr 11-2101               11,333.36  ← GL: 17,000 − 4×1,416.66
   Cr 11-2105                  793.32  ← GL: 1,190 − 4×99.17
   Cr 21-2101 (deferred due)    793.32  ← mirrors 21-2102
   Cr 41-1101                4,000.00  ← mirrors 11-2106
ΣDr = ΣCr = 18,435.83 — metadata.releasedProvision = "0.00" (provision fully consumed)
```

**Write-off release-residual golden** (`bad-debt-writeoff.template.spec.ts`, all-deferred 1A-only contract, provision seeded 20,000.00 > loss 18,190.00): `provisionConsumed = 18,190.00` (Dr 11-2102), `releasedProvision = 1,810.00` (Dr 11-2102 / Cr 51-1103), NO `51-1102` loss line at all (fully absorbed) — GL 11-2102 nets to exactly `0.00` after the JE.

**JP5 gain-branch golden** (`jp5-vat-split.spec.ts`, no accrual, repossessionValue 20,000 vs remaining total 18,190.00, provision seeded 2,000.00): consume = 0 (no loss to consume against), release = the FULL 2,000.00 provision (`Dr 11-2102` / `Cr 51-1103`), gain `Cr 41-1102` = 1,810.00 recognized independently and unaffected by the release.

**Write-off, mixed accrued/deferred** (`bad-debt-writeoff.template.spec.ts`, unaffected by the release addition since provision < loss here): 3 accrued+unpaid installments → CN VAT (Dr 21-2101) = `99.17 × 3 = 297.51`; loss plug (Dr 51-1102) = **17,892.49**.

### Reports — `getProvisionSummary` + `calculateProvisions` (Task 7, 2026-07-26)

Both response shapes' `byBucket` are now aggregated from the TRUE per-installment split, not a whole-contract dump onto the oldest bucket:

- `calculateProvisions(...).byBucket` — built by summing each in-scope contract's `bucketAgg` (the same per-bucket aggregation `computePerInstallmentProvision` already computes) into the response, instead of adding the contract's whole `provisionAmount` under its single `contractBucket`. A `{90,60,30}` contract now shows `757.92` on `'61-90'`, `227.37` on `'31-60'`, `30.32` on `'1-30'` — not `1,015.61` dumped entirely onto `'61-90'`. **`count` per bucket is a count of INSTALLMENTS, not contracts** — that same `{90,60,30}` contract contributes `count:1` to EACH of `'61-90'`/`'31-60'`/`'1-30'`, not `count:3` piled onto one bucket.
- `getProvisionSummary().byBucket` — sums each ACTIVE row's persisted `bucketBreakdown` (see Method above) across contracts. Rows persisted BEFORE the per-installment migration carry no `bucketBreakdown` (`null`) — those fall back to the OLD whole-row attribution (their entire outstanding/provision keyed under their single `agingBucket`) so legacy data still reports sensibly instead of silently vanishing from the summary. **This means a legacy row's `count` contribution is a CONTRACT count (1), not an installment count** — until that contract is recalculated (gets a fresh `bucketBreakdown` on its next `calculateProvisions` run) or its provision is REVERSED, `byBucket.count` from this endpoint is a mix of true installment-counts (post-migration rows) and contract-counts (legacy rows); do not treat it as a pure installment tally until all legacy rows have aged out. `rate` per bucket is derived from the aggregated data (`provision / outstanding`) rather than re-read from the live rates config, since a bucket's aggregate reflects whatever rate was actually in effect when each contributing row was calculated. `details[]` keeps its existing shape and additionally passes through each row's `bucketBreakdown` (`null` for legacy rows).
- **Dry-run CLI** (`ecl-dry-run.cli.ts`) prints a per-bucket count/amount table sourced from the now-truthful `byBucket` (previously it dumped the raw, misleading-for-multi-bucket JSON).

### Enforcement gates (Phase 2, owner sign-off 2026-07-24)

| SystemConfig key | Value | Effect | Legal basis |
|---|---|---|---|
| `letter_auto_generate_enabled` | `'true'` | `LetterAutoGenerateCron` (09:15 BKK) actually fires RETURN_DEVICE_45D / CONTRACT_TERMINATION_60D letters. Was seeded `'false'` pending legal review — review now passed. | — |
| `jp5_require_terminated_status` | `'true'` | `RepossessionsService` (JP5) rejects a repossession unless `contract.status === 'TERMINATED'` | ปพพ. มาตรา 386 — เจ้าหนี้ต้องบอกเลิกสัญญาก่อนจึงจะใช้สิทธิยึดทรัพย์คืนได้ |

Fresh dev seed (`collections-foundation.seed.ts`) now seeds both `'true'`. **Existing environments** (already carrying a `letter_auto_generate_enabled` row) do NOT get flipped by re-seeding — the seeder's upsert only touches `label` on the UPDATE branch by design, so it never clobbers an operator's runtime value. Flip existing envs via the confirmation-gated manual SQL: `apps/api/prisma/migrations-manual/2026-07-23-enable-letter-auto-generate-and-jp5-strict.sql`. **Must run via `psql -f`** — the `\prompt` confirmation gate is silently skipped by GUI clients (DBeaver/pgAdmin "execute file").

### Dry-run CLI

```bash
DATABASE_URL=... npm --prefix apps/api run ecl:dry-run
```

`apps/api/src/cli/ecl-dry-run.cli.ts` — read-only: calls `calculateProvisions(systemUserId, undefined, dryRun=true)`, which skips BOTH the `BadDebtProvision` row writes AND JE posting. Reports per-contract delta vs the current `11-2102` GL balance (`prevGl`, `target`, `delta`), the (now truthful, per-installment) bucket totals, and aggregate increase/release. Point `DATABASE_URL` at a prod-copy via cloud-sql-proxy and run this before a prod rollout to sanity-check the blast radius.

### CI coverage (2026-07-26)

`.github/workflows/deploy-gcp.yml`'s vitest step now explicitly globs `src/modules/journal/cpa-templates/__tests__/*.spec.ts`. `jp5-vat-split.spec.ts` (the JP5 GL-based-legs golden suite above, ~960 lines) previously matched no glob in CI and had NEVER actually run there — a regression in it would not have been caught before merge. Any new spec placed directly under `cpa-templates/__tests__/` is now covered by construction; if a NEW subdirectory nesting level is ever introduced there, verify it is covered by an explicit glob too — do not assume `*.spec.ts` recurses into subdirectories on its own.

### เอกสารใบลดหนี้ (CN document — Phase 3)

Auto-issues the ม.82/5 ใบลดหนี้ (Credit Note) receipt that documents the VAT reversal already booked by JP5/write-off — closes the loop from "JE says CN VAT was reversed" to "customer actually received a CN document".

**Trigger.** `RepossessionsService.create` (JP5) and `BadDebtService.writeOffBadDebt` both call `CreditNoteDocumentService.issueForContract` **inside the same `$transaction`** that posted the source JE, so a CN-issuance failure rolls back the JE too (atomic). It does NOT gate on a `metadata.creditNoteIssued` flag read off the JE (no such read exists in the service) — instead it independently RE-DERIVES the accrued-unpaid set + pro-rated amounts via `computeCnBreakdown` (same util `RepossessionJP5Template`/`BadDebtWriteOffTemplate` use to stamp `metadata.creditNoteVatAmount` — see "Pro-rate ruling" below); zero accrued-unpaid → `SKIPPED_NO_ACCRUED`, no CN issued. It ASSERTS its own recomputed `totalCnVat` equals the JE's stamped `metadata.creditNoteVatAmount` for EVERY case (clean or partial), throwing (and rolling back the whole tx) on any mismatch — equivalent protection to trusting a boolean flag, but self-verifying against the source JE instead. LINE delivery (`CreditNoteDeliveryService.deliver`) is deliberately NOT called from inside that tx — both callers fire it fire-and-forget **after** the tx commits (`void this.cnDeliveryService.deliver(receiptId).catch(Sentry.captureException)`), so a rollback can never hand the customer a link to a receipt that turned out not to exist.

**Pro-rate — HELD gate retired (CPA ruling 2026-07-26).** `CreditNoteDocumentService.issueForContract` auto-issues a `Receipt` with `receiptType='CREDIT_NOTE'` for EVERY accrued-unpaid case, clean or partial — no dirty gate, no Todo, no held state. Amount/VAT/before-VAT come straight from `computeCnBreakdown(tx, contract)`: `amount=totalOutstanding`, `vatAmount=totalCnVat`, `amountBeforeVat=totalBeforeVat` (per-installment pro-rate formula documented in `compute-cn-breakdown.ts` — see the "Bad Debt Provision — ECL v4" section above for the shared util's CPA golden fixtures). `itemDescription` is `ใบลดหนี้ยกเลิกงวดค้าง {count} งวด — เลิกสัญญา (ม.82/5)`, with `(ลดตามสัดส่วนยอดค้างจริง)` appended whenever at least one accrued-unpaid installment's outstanding balance is less than a full installment (i.e. was pro-rated). Number `RT-YYYYMM-NNNNN` (same per-month advisory-lock sequencer as ordinary receipts — `ReceiptNumberService`). This SUPERSEDES the 2026-07-24 dirty gate: no more `HELD_PARTIAL_PAID` outcome, no more Todo tag `credit-note-review`, no more `CN_HELD_PARTIAL_PAID` audit action for new cases.

**JP5 clearing legs residual — CLOSED 2026-07-26 (superseded; see "Bad Debt Provision — ECL v4" → "Write-off & JP5" above).** This section previously warned (I3, final-review 2026-07-26) that `RepossessionJP5Template`'s `Cr 11-2103` clearing leg was still COUNT-based (`installmentTotal × accruedCount`) even after the CN VAT line was pro-rated — meaning a partially-paid accrued installment would OVER-credit `11-2103` and OVERSTATE the `51-1102` loss. **That gap was closed the same day** by the ECL-per-installment redesign's Task 5: every clearing leg (`11-2103`, `11-2101`, `11-2105`, `21-2102`/`21-2101`, `11-2106`/`41-1101`) now reads the live GL balance via the shared `glContractBalance` helper instead of re-deriving from installment count. `jp5-vat-split.spec.ts` proves GL `11-2103` nets to exactly `0.00` after JP5 even with a real partial 2B receipt in the mix. Do not resurrect the old "only the CN VAT line is pro-rated" caveat — it no longer describes the code.

**Monthly-close / ภ.พ.30 checklist — historical note (superseded 2026-07-26).** Before the CPA pro-rate ruling, a `HELD_PARTIAL_PAID` outcome meant the JP5/write-off JE had already reversed the ม.82/5 VAT in the ledger with no physical CN document yet, and every open Todo tagged `credit-note-review` was a period-close blocker (filing ภ.พ.30 without the mandated CN in hand is a ม.86/10 exposure). New repossessions/write-offs no longer produce this state — `CreditNoteDocumentService` auto-issues a pro-rated CN for every case (see above).

**Manual CN-issue endpoint — honesty about which legacy Todos it actually clears (I2, final-review 2026-07-26).** The manual endpoint (`POST /receipts/credit-note/issue`, `CreditNoteIssueService.issueManually` — CN pro-rate plan Task 5) reuses `CreditNoteDocumentService.issueForContract`'s own drift guard: it recomputes the CN breakdown via `computeCnBreakdown` and ASSERTS the result equals the JE's stamped `metadata.creditNoteVatAmount`, throwing `CnVatMismatchError` → mapped to `422 UnprocessableEntityException` on any mismatch (`mapIssueError` in `credit-note-issue.service.ts`). This means:
  - **JE posted AFTER the pro-rate util shipped** (`metadata.creditNoteVatAmount` already computed via `computeCnBreakdown`) → the endpoint works exactly as intended: issues the missing Receipt for a JE whose document-issuance step failed or was skipped.
  - **JE posted BEFORE the pro-rate util shipped, or a legacy full-amount JE from the pre-2026-07-24 dirty-gate era** → its `metadata.creditNoteVatAmount` is FROZEN at whatever the old (non-pro-rated or pre-existing) formula produced. `computeCnBreakdown`'s recompute will essentially never match that frozen value for a partially-paid installment, so calling the manual endpoint on one of these JEs throws the SAME `422` every single time — it does **not** self-resolve, and there is no retry that fixes it. Do not tell an accountant "just call the endpoint again" for these — it is a dead end until the JE itself is corrected.
  - **The only fix for the legacy-JE case**: an OWNER/CPA-approved ops SQL that updates the frozen JE metadata to match what `computeCnBreakdown` would compute today, e.g. `UPDATE journal_entries SET metadata = jsonb_set(metadata, '{creditNoteVatAmount}', '"<recomputed-value>"') WHERE entry_number = '<JE-...>';` — run this ONLY after a CPA has reviewed and approved the recomputed figure (this changes what ภ.พ.30-relevant amount the ledger claims was reversed), then re-run the manual endpoint, which will now pass the drift-guard cross-check. There is no automated backfill for this — it is a one-JE-at-a-time, human-reviewed operation.
  - **Current status (2026-07-26): zero legacy/frozen-metadata cases exist in prod** — the pro-rate util shipped before any real JE accumulated drifted metadata, so this is a documented dead-end path for future-proofing, not an active backlog item.

**Fields (Receipt model, migration `20260981000000_add_credit_note_source_fields`).**

| Field | Notes |
|---|---|
| `cnSource` | `'REPOSSESSION' \| 'WRITE_OFF'` (null = ordinary receipt or legacy void-CN). Partial unique index `(contract_id, cn_source) WHERE cn_source IS NOT NULL AND deleted_at IS NULL` — one auto-CN per contract per source. |
| `sourceJournalEntryId` | FK-by-value to the JE that triggered this CN (JP5 or write-off entry). |
| `publicToken` | `crypto.randomBytes(32).toString('base64url')` (256-bit), unique. `publicTokenExpiresAt` = issuance + 30 days. |

**Public endpoint.** `GET /receipts/public/:token/pdf` (`ReceiptsPublicController`) — a separate controller with **no class-level guards** (not `@Public()` on `ReceiptsController`, because that controller's `BranchGuard` reads `request.user` unconditionally and has no bypass). Access is entirely token-based: unknown token, expired token, soft-deleted receipt, and non-CN receipt all collapse to the **same** `404 ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว` so the response never confirms whether a token ever existed. Throttled 10/min per IP (`@Throttle`). This route is **intentionally NOT behind `ExportEnabledGuard`** — unlike the staff-facing `GET /receipts/:id/pdf` (which the OWNER can disable via `export_enabled` SystemConfig), this link is the customer's own legally-mandated tax document, not a staff bulk-export path; final call is pending owner sign-off during PR review. Already listed as an intentionally-public entry in `.claude/rules/security.md`.

**LINE delivery.** `CreditNoteDeliveryService.deliver` pushes a Flex card via `LineFinanceClientService` (same LINE FINANCE channel as payment flows) with a "ดูเอกสาร" button linking to `${baseUrl}/cn/:token` — `baseUrl` reuses `PAYMENT_LINK_BASE_URL`/`FRONTEND_URL` (no new env var). `${baseUrl}/cn/:token` is a public frontend route (`CreditNoteViewPage`, declared outside `ProtectedRoute`/`MainLayout`, fetches via `liffApi`) that streams the PDF inline. **PDPA: no consent gate** — a CN is a legally-mandated tax document (legitimate interest/legal obligation basis), unlike the discretionary payment-receipt Flex which does gate on `pdpaService.hasActiveConsent()`. **No auto-retry in v1** — a failed push writes a `NotificationLog` FAILED row + a MEDIUM-priority Todo (tag `credit-note`) for manual follow-up (e.g. attach to the EMS termination letter); a "ส่งซ้ำ" resend button exists in the UI (`ReceiptsTab`/`RepossessionsPage`) instead of automatic backoff. Delivery attempts log to `NotificationLog` with `category = 'CREDIT_NOTE'`. AuditLog action strings: `CN_ISSUED`, `CN_SENT`, `CN_SEND_FAILED` (all `entity` = `receipt`). `CN_HELD_PARTIAL_PAID` (`entity` = `contract`) was RETIRED 2026-07-26 along with the dirty gate — historical only, may still appear on audit rows predating the pro-rate ruling.

**Follow-ups pending (documented, not yet done — committed, NOT optional):**
- ~~Pro-rate CN for the `PARTIALLY_PAID`/HELD case~~ — DONE 2026-07-26 (CPA ruling): `computeCnBreakdown` pro-rates every accrued-unpaid installment's CN VAT to its outstanding balance; `CreditNoteDocumentService` auto-issues for every case, no more HELD state (see "Pro-rate — HELD gate retired" above). ~~The manual CN-issue endpoint~~ (CN pro-rate plan Task 5) — DONE (`POST /receipts/credit-note/issue`, `CreditNoteIssueService`); see "Manual CN-issue endpoint — honesty about which legacy Todos it actually clears" above for what it can and cannot fix.
- `computeCnBreakdown`'s outstanding formula nets out `Payment.amountPaid`'s FEE-FIRST late-fee component before comparing against `amountDue` (see `compute-cn-breakdown.ts` jsdoc) — otherwise a fee-heavy partial payment understated `outstanding`/`cnVat`. ~~`RepossessionJP5Template`'s `Cr 11-2103` clearing leg and loss/gain plug remain count-based~~ — DONE 2026-07-26 (ECL-per-installment Task 5): both now read the live GL balance via `glContractBalance`, closing the over-credit gap. See "JP5 clearing legs residual — CLOSED" above.
- The public token appears in the React Query `queryKey` (`['cn-view', token]`) and in the client-side download filename (`ใบลดหนี้-${token}.pdf`) on `CreditNoteViewPage` — same pre-existing pattern as other public-token pages (e.g. `/pay/:token`); not newly introduced here, but not yet remediated either.
- No backfill for CNs on JEs posted before this phase shipped — forward-only. A backfill CLI would be a separate, explicit task if the owner wants historical coverage.

---

## Device Swap — Priced Exchange (2026-07-29)

Spec: `docs/superpowers/specs/2026-07-29-device-swap-priced-exchange-design.md` (D1-D5 owner decisions)

- MEMO mode (รุ่นเดิม+ราคาเดิม): ไม่มี JE — เปลี่ยน `contract.productId` บนสัญญาเดิม (TFRS 9 modification, workbook Case 1). SP2 same-price + `case-8-same-price.csv` golden ถูก retire
- PRICED mode: A.1 (1A สัญญาใหม่) → **A.1b SHOP-leg** (`ShopInventoryTransferTemplate`, ดูหัวข้อถัดไป) → A.2 (derecognize ผ่าน 21-1106, VAT due ทันที ม.78/1 ไม่ออก CN) → **A.3 (ตั้งลูกหนี้-หน้าร้าน 11-2107 ล้างบัญชีพัก 21-1106 — ไม่มีขาเงินสด, ไม่แตะ 21-1101/21-1102 — คำสั่งเจ้าของ 2026-08-03 ยกเลิก D5 สำหรับเส้นทางนี้; เดิม "ตัดเจ้าหนี้ + ขาเงินสดโอนเพิ่ม/คืนลูกค้า D5 post ทันที")** → A.4 (SHOP ซื้อคืนที่ราคารับซื้อ — `Dr S11-2002 [buyback] / Cr S21-1104` ตั้งแต่ 2026-08-19, เดิม costPrice/Cr S50-1102) → A.5 (ECL reversal Dr 11-2102 / Cr 51-1103 — **CPA ruling 2026-08-01 (คำตอบข้อ A2.2 = ข): มาตรฐานเดียวทุกเส้นทาง**, was Cr 42-1106 per D2 — **บัญชี 42-1106 ถูกลบออกจากผังบัญชีแล้ว 2026-08-03**; same account `EclStageReverseTemplate`/JP5/write-off already use — no more asymmetry)
- **Workbook 2026-08-19 Phase 1** (spec `docs/superpowers/specs/2026-08-19-device-swap-netting-cancel-workbook-design.md`):
  (1) **A.2 = วิธีสุทธิ** — ไม่ตั้ง Cr 41-1101 จาก unearned อีกต่อไป; loss/gain = ราคารับซื้อ
  เทียบมูลค่าตามบัญชีสุทธิรวม VAT (ตัวเลข workbook: loss 126.64; fixture integration: 126.68 —
  เดิม 4,126.68). `metadata.method = 'NET'` (แถวเก่าไม่มี key = gross, forward-only).
  `expectedPl` ใน preview (`contract-exchange.service.ts`) ใช้สูตรสุทธิตัวเดียวกัน (preview === posted).
  (2) **A.4 = ซื้อคืนที่ราคารับซื้อ** — `Dr S11-2002 [buyback] / Cr S21-1104` + caller set
  `product.costPrice = buyback` และ snapshot `ContractExchangeRequest.previousCostPrice`
  (cancel restore กลับ). S21-1104 คือขาคู่ฝั่ง SHOP ของ 11-2107 SWAP_CREDIT — รอหักกลบใน
  รอบจ่าย INTER-CO (Phase 2). A.4 (`ShopExchangeReturnTemplate`) stamp
  `metadata.newContractId` (Phase 2 Task 1) — key ของเลนส์หักกลบ (`swapCreditShopBalance`
  query S21-1104 ด้วย path นี้ตรงๆ ไม่ join ผ่าน request row) และ cancel mirror
  (`exchange-cancel-reversal.template.ts`) copy key นี้ต่อ ให้เลนส์เห็นขากลับรายการด้วย.
  Prod ต้องรัน `seed:coa` หลัง deploy (บัญชีใหม่ S21-1104).
  (3) **11-2107/S21-1104 reference types** — `metadata.shopReceivableType`
  (`SWAP_CREDIT` | `PAYOUT_RECALL` | `SHOP_COLLECT` | **`DEVICE_RETURN`** ตั้งแต่ 2026-09-20 — ประกาศครั้งเดียวที่
  `SHOP_RECEIVABLE_TYPES` ใน `shop-receivable-type.util.ts`, SQL ทุกตัวสร้าง IN-list จาก `Prisma.join`) stamp JE รายสัญญาใหม่;
  **ยกเว้น batch JEs**: ใช้ metadata `items[]` ห้าม top-level `contractId`/`shopReceivableType` (gross lens + item deductions).
  แถวเก่า classify ตอนอ่านผ่าน `classifyShopReceivable()` (`apps/api/src/modules/journal/shop-receivable-type.util.ts`
  — `DEVICE_RETURN` **ไม่มี `FLOW_MAP` fallback**: แถวยึดเก่า flow `shop-repossession-intake` ที่ไม่มี stamp คือโหมด
  โอนทันทีซึ่งไม่แตะ S21-1104).
  จุดกำเนิด `SHOP_COLLECT` **เหลือทางเดียว (2026-09-20): JP4 ปิดยอดหน้าร้านรับแทน** — ต้นทาง JP5 ยึดเครื่องหน้าร้าน
  รับแทน (`repossession-jp5.template.ts`) ถูกแทนด้วย `DEVICE_RETURN` (ขา Dr 11-2107 ของ JP5 stamp `DEVICE_RETURN`
  เสมอ; แถวยึดก่อนหน้านั้นยัง `SHOP_COLLECT` ล้างทางเดิม). ส่วนใบ settle (`shop-collect-settlement.template.ts` —
  Dr cash / Cr 11-2107) เป็น**จุดล้าง** ไม่ใช่จุดกำเนิด แต่ stamp ตาม `typeStamp` (`SHOP_COLLECT` | `PAYOUT_RECALL` |
  `DEVICE_RETURN`) เพื่อให้ classify ครบทั้งสองขา — และมี**ด่านกันล้างซ้ำ**: `typeStamp !== 'DEVICE_RETURN'` แต่สัญญา
  มี `deviceReturnFinanceBalance > 0` **หรือมีประวัติ JE POSTED ที่ไม่ถูกลบ stamp DEVICE_RETURN + contractId
  และบรรทัด 11-2107 ที่ไม่ถูกลบ** → 400 แม้ยอดปัจจุบันถูกล้างเป็นศูนย์แล้ว (ดูหัวข้อ "ใบรับเครื่องคืน (DeviceReturn)" ในส่วนยึดเครื่อง).
- Approval: AUTO (≥NCV + ≥basePrice×0.85) / REVIEW (BM) / ESCALATE (<70% NCV — OWNER) — `exchange-tier.util.ts`
- Guards ก่อน finalize: GL 11-2103 = 0, ไม่มี advance/credit ค้าง
- Cancellation: ยกเลิกได้ทุกเมื่อถ้าสัญญาใหม่ยังไม่มีการชำระ (owner ยกเลิก windows/ค่าปรับ 2026-07-31) — mirror-reverse ทุก JE รวม A.5 + A.1b SHOP-leg (สวีปตาม `metadata.contractId` ไม่ hardcode บัญชี — สวีปจับ SHOP JE ได้เองแม้ไม่มี id เก็บบน request row); 2A cron backfill เอง; **42-1107 ถูกลบออกจากผังบัญชีแล้ว 2026-08-03 (คำสั่ง CPA/owner) — ไม่มีบัญชีรองรับค่าปรับยกเลิกอีกต่อไป**. **Phase 3 (2026-08-20): ยกเลิกหลังสัญญาใหม่ถูกตัดจ่ายรอบจ่าย INTER-CO POSTED แล้ว "ทำได้"** — ไม่ใช่ mirror ตรง (จะทำเจ้าหนี้ติดลบ) แต่ redirect ขาเจ้าหนี้/ลูกหนี้รอบจ่ายเป็นลูกหนี้เรียกคืน `PAYOUT_RECALL` + `cancelWindow: 'AFTER_PAYOUT'` — ดูหัวข้อ "ยกเลิกสัญญา (Flow C — Phase 3)" ด้านล่าง
- **42-1106 + 42-1107 = ลบออกจากผังบัญชีแล้ว (2026-08-03, คำสั่ง CPA/owner)** — ทั้งคู่เปิดไว้แต่ไม่เคยมี `journal_lines` แม้แถวเดียว: 42-1106 ("รายได้จากการโอนกลับค่าเผื่อฯ", rename จาก orphan "รายได้บริการซ่อม" — runtime repair ใช้ S42-1101) ถูกแทนที่ด้วย Cr 51-1103 มาตรฐานเดียวทุกเส้นทาง; 42-1107 ("รายได้ค่าปรับยกเลิกเปลี่ยนเครื่อง") หมดความหมายเมื่อ owner ยกเลิกกติกาค่าปรับ swap ทั้งชุด 2026-07-31. ถอดออกจาก `finance-coa.csv` แล้ว (ผัง FINANCE เหลือ **110** บัญชี) + `exchange-coa.spec.ts` พลิกเป็น assert ว่า **ไม่มี** ทั้งสองรหัส กันเพิ่มกลับเงียบๆ. Prod: `docs/accounting/remove-42-1106-42-1107-2026-08.sql` (soft delete + guard "ถ้ามี journal_lines แม้แถวเดียว → ROLLBACK")
- Integration E2E (DB จริง): `apps/api/src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts` — Case 2A (21-1106 net 0, Cr 11-2101 = GL-true 11,333.36 ไม่ใช่สูตรคูณ 11,333.28, loss plug 126.68 (วิธีสุทธิ 2026-08-19; เดิม 4,126.68 ตอน A.2 gross); A.3 = 2 บรรทัดพอดี Dr 11-2107 8,000 / Cr 21-1106 8,000 ไม่มีขาเงินสด; ค้างรอรอบจ่าย: 21-1101 15,000 / 21-1102 1,500 / S11-3001 15,000 / S11-3002 1,500, S11-1201 + เงินสด FINANCE = 0.00 ไม่ถูกแตะ; + F2 SHOP legs: S41-1101/S41-1201/S50-1101↔S11-2001 booked; อยู่ในคิวจ่าย INTER-CO ด้วย `legacyNoShop = false`), ECL 30.32 → 51-1103, cancel วันที่ 15 (reversalJeIds 6: A.1+A.2+A.3+A.4+2 SHOP legs) + วันที่ 45 (reversalJeIds 8: + 2 swept 2A accruals — ทั้งคู่ SUCCEED เหมือนกัน, ไม่มี window/penalty JE อีกต่อไป, owner ยกเลิก 2026-07-31 + mirror-reverse net 0 ทุกบัญชีรวม SHOP + 2A backfill), MEMO (JE count คงเดิม). CI: glob `src/modules/contract-exchange/__tests__/*.integration.spec.ts` ใน deploy-gcp.yml vitest step (jest มองไม่เห็นไฟล์ `*.integration.spec.ts` ตาม testPathIgnorePatterns)

### SHOP-leg wiring บนสัญญาใหม่ (F2, CPA ตอบข้อ 3 = ใช่, 2026-08-01)

ก่อนหน้านี้ exchange PRICED contracts post FINANCE templates เท่านั้น (A.1-A.3 + A.5) — ไม่มี SHOP-side revenue/COGS/receivable สำหรับสัญญาใหม่เลย (ต่างจาก activation ปกติที่ `ContractWorkflowService.activate` ต่อ `ShopInventoryTransferTemplate` เสมอ). F2 ต่อ `ShopInventoryTransferTemplate.execute` เข้า `ContractExchangeService.finalizeAfterActivation` (หลัง A.1, ก่อน A.2) — **เหมือน activation ปกติทุกประการ**:

```
JE A (COGS):    Dr S50-XXXX / Cr S11-200X          [costPrice ของเครื่องใหม่]
JE B (revenue): Dr S11-3001 [financedAmount] + Dr S11-3002 [commission]
                  Cr S41-XXXX [salePrice] + Cr S41-1201 [commission]
```

- **Invariant ตรวจแล้ว (JE B)**: `downPayment` บนสัญญาใหม่ = 0 เสมอ (hardcode ใน `approvePriced` ทั้ง snapshot branch และ legacy fallback branch) — นี่คือ invariant เดียวที่ hold ทุก branch จริงๆ. `financedAmount` **ไม่การันตี**เท่ากับ `sellingPrice` เสมอไป: snapshot branch (`usedSnapshot=true`) ตั้งทั้งสองค่าเท่ากันจาก `newPrice` เดียวกัน แต่ legacy fallback branch (`usedSnapshot=false`) clone `financedAmount: old.financedAmount` และ `sellingPrice: old.sellingPrice` เป็น**คนละค่าอิสระกัน**จากสัญญาเดิม — ถ้าสัญญาเดิมเคยมีดาวน์ (`old.downPayment > 0`) แล้ว `old.sellingPrice = old.financedAmount + old.downPayment > old.financedAmount` ไม่เท่ากัน. ด้วยเหตุนี้ `salePrice` ที่ส่งเข้า `ShopInventoryTransferTemplate` จึง**reconstruct เป็น `down(0)+financedAmount` เสมอ ไม่เคยอ่าน `contract.sellingPrice`** — invariant ของ template (`down+financed===salePrice`) จึง hold โดยโครงสร้าง (`salePrice` ก็คือ `down+financed` ตรงๆ ไม่ใช่ค่าที่ต้องมาเท่ากันโดยบังเอิญ) ทั้งสอง branch โดยไม่ต้องพึ่ง `financedAmount===sellingPrice`
- **idempotencyKey**: `shop-inventory-transfer:<newContractId>` (รูปแบบเดียวกับ `ContractWorkflowService.activate`, กันโพสต์ซ้ำข้ามเส้นทาง)
- **Fields บน `ExchangeContractForFinalize`**: เพิ่ม `contractNumber`/`downPayment`/`productCategory`/`productCostPrice` — มาจาก pre-tx `findOne(id)` snapshot เดียวกับที่ activation ปกติใช้ (ไม่ query DB ซ้ำใน tx) — race characteristics เหมือนเส้นทางปกติทุกประการ
- **S11-3001/S11-3002 ค้างไว้ ไปล้างที่รอบจ่าย INTER-CO** (คำสั่งเจ้าของ 2026-08-03) — ดูหัวข้อ "A.3 = ตั้งลูกหนี้ 11-2107 …" ด้านล่าง. JE C (`ExchangeShopInstantSettlementTemplate`, idempotencyKey `exchange-shop-receipt:<newContractId>`, มีอายุ 2026-08-02 → 2026-08-03) ที่เคยล้างสองบัญชีนี้ทันที **ถูกลบทิ้งทั้งไฟล์แล้ว** พร้อมกับ D5
- **Coverage**: `apps/api/src/modules/contract-exchange/__tests__/exchange-priced-flow.integration.spec.ts` (booking values ของ JE A/JE B, ยอดค้างหลัง finalize, การปรากฏในคิวจ่าย, cancel-sweep 2 SHOP JEs, net-zero ทุกบัญชีหลัง cancel รวม 11-2107)
- **Scope ไม่ครอบคลุม**: MEMO mode ยังไม่มี SHOP JE (unrelated — เป็น TFRS 9 modification ไม่มีรายได้ใหม่ ดู §12 ข้อ 4 ของ device-swap spec ซึ่งยังเปิดอยู่ ไม่เกี่ยวกับ F2)

### A.3 = ตั้งลูกหนี้ 11-2107 + เจ้าหนี้เข้าคิวจ่ายปกติ (คำสั่งเจ้าของ 2026-08-03 — SUPERSEDES D5)

**D5 ("สมมติฐานโอนวันเดียวกัน") ถูกยกเลิกสำหรับเส้นทางเปลี่ยนเครื่อง** — วันเปลี่ยนเครื่อง
**ไม่มีการเคลื่อนไหวเงินสดใดๆ** ทั้งฝั่ง FINANCE และ SHOP.

**A.3 รูปแบบใหม่** (`ExchangeBuybackReceivable11_2107Template`,
ไฟล์ `apps/api/src/modules/journal/cpa-templates/exchange-buyback-receivable-11-2107.template.ts` —
เปลี่ยนชื่อจาก `ExchangeClearVendor21_1106Template` เพราะไม่แตะบัญชีเจ้าหนี้อีกแล้ว):

```
Dr 11-2107 ลูกหนี้-หน้าร้าน              [buyback]
   Cr 21-1106 บัญชีพักเครดิตเปลี่ยนเครื่อง  [buyback]
```

ทิศทางเดียวเสมอ 2 บรรทัด ไม่มีการแตกกรณี (เดิมแตก 3 ทางตามส่วนต่าง buyback vs vendorSum)
และ balanced โดยโครงสร้าง. `metadata.flow = 'exchange-buyback-receivable-11-2107'`,
`idempotencyKey = newContractId`, `metadata.contractId = newContractId` (ให้ cancel sweep จับได้).

**เดิม (D5, 2026-07-29 → 2026-08-03):**
`Dr 21-1101 [ยอดจัดสัญญาใหม่] + Dr 21-1102 [ค่าคอม] + ขาเงินสดโอนเพิ่ม/คืนลูกค้า / Cr 21-1106 [buyback]`
— คือหักกลบเจ้าหนี้หน้าร้านของสัญญาใหม่กับเครดิตราคารับซื้อ แล้วจ่ายส่วนต่างเป็นเงินสดทันที.

**เหตุผลของรูปแบบใหม่ (เจ้าของ):**
1. ราคารับซื้อ = เงินที่ SHOP ติด FINANCE → เป็น **ลูกหนี้ฝั่ง FINANCE** บัญชี **11-2107
   ลูกหนี้-หน้าร้าน** (บัญชีเดิมที่มีอยู่แล้ว ใช้ร่วมกับเส้นทาง shop-collect — ล้างเมื่อหน้าร้าน
   โอนเงินเข้า FINANCE ด้วย `Dr <cash> / Cr 11-2107` ผ่าน
   `ContractPaymentService.settleShopCollect`). **ไม่มีการเปิดบัญชีใหม่.**
2. เจ้าหนี้ยอดจัด/ค่าคอมของสัญญาใหม่ (21-1101 / 21-1102 ที่ A.1 ตั้งไว้) **ค้างไว้ตามปกติ**
   → "จ่ายหน้าร้านเหมือนขายปกติ" ผ่านรอบจ่าย INTER-CO.

**`ExchangeShopInstantSettlementTemplate` ถูกลบทิ้งทั้งไฟล์** (มีอายุ 2026-08-02 → 2026-08-03,
ไม่เคยขึ้น production เป็นรอบจ่ายจริง): เมื่อ FINANCE ไม่รับเงินทันทีแล้ว SHOP ก็ต้องไม่รับทันที
เช่นกัน — S11-3001/S11-3002 **ค้างไว้** และไปล้างที่รอบจ่ายเดียวกัน. `ShopInventoryTransferTemplate`
(A.1b, การจองรายได้/COGS/ลูกหนี้ฝั่ง SHOP) **คงไว้ไม่เปลี่ยนแปลง**.

**GL หลัง finalize (สัญญาใหม่, ตัวอย่าง Case 2A ในสเปคทดสอบ — financed 15,000 / คอม 1,500 /
buyback 8,000):**

| บัญชี | ยอดคงค้างหลัง finalize |
|---|---|
| 21-1101 (Cr) | 15,000.00 — **ค้าง** รอรอบจ่าย |
| 21-1102 (Cr) | 1,500.00 — **ค้าง** รอรอบจ่าย |
| 11-2107 (Dr) | 8,000.00 — ลูกหนี้หน้าร้าน (ราคารับซื้อ) |
| S11-3001 (Dr) | 15,000.00 — **ค้าง** รอรอบจ่าย |
| S11-3002 (Dr) | 1,500.00 — **ค้าง** รอรอบจ่าย |
| S11-1201 | 0.00 — **ไม่ถูกแตะเลย** |
| เงินสด/ธนาคาร FINANCE (11-11xx/11-12xx) | 0.00 — **ไม่ถูกแตะเลย** |

**ASYMMETRY ที่รู้ตัวและตั้งใจ (สำหรับ CPA):** ผัง SHOP **ไม่มีบัญชี "เจ้าหนี้ FINANCE"**
ดังนั้นสมุด SHOP **ไม่มีขาคู่ของ 11-2107** — SHOP ไม่ได้บันทึกว่าตัวเองติดหนี้ FINANCE
เท่าราคารับซื้อ. นี่เป็นพฤติกรรมเดียวกับเส้นทาง shop-collect ที่มีอยู่เดิม (11-2107 เป็น
FINANCE-side-only มาตลอด) — **ไม่ได้ประดิษฐ์บัญชีใหม่ และไม่ได้เดา JE ปิดช่องนี้**.
> **⚖️ CPA ตอบแล้ว 2026-08-24 (ข้อ A1): "ต้องมี ตั้งรหัส S21-1104 เจ้าหนี้ FINANCE"**
> **สถานะ: เปลี่ยนรหัสในโค้ดแล้ว 2026-08-24** (`S21-3001` → `S21-1104` ทั้ง CSV + 194 จุดใน 34 ไฟล์)
> — ความไม่สมมาตรของ `SHOP_COLLECT` ต้นทาง **JP5 ปิดแล้ว 2026-09-05** (`ShopCollectShopLegs` — ดูหัวข้อ
> "ยึดเครื่อง — ราคาเดียว"); ต้นทาง **JP4** (ปิดยอดหน้าร้านรับแทน) ยังไม่ต่อ
> `S21-1104` เป็นบัญชีตาม **คู่สัญญา**
> (ติดหนี้ FINANCE) ไม่ใช่ตาม **วัตถุประสงค์** (ค่าเครื่องรับคืน) จึงรับหนี้ระหว่างกันได้ทุกประเภท
> รวมถึงการจ่าย ปกส./ภาษีหัก ณ ที่จ่าย แทนกัน (ข้อ C5).
> **ยังบล็อก:** ย้ายรายการเก่าบน prod หรือ forward-only (SQL เตรียมไว้แล้วที่
> `docs/accounting/retire-S21-3001-to-S21-1104-2026-08.sql` — บล็อกย้ายยัง comment ไว้ รอผู้สอบสั่ง) ·
> S21-1104 รับทุกประเภทเลยไหม (ต้องมี metadata แยกประเภทหรือไม่) · ชื่อบัญชีเป๊ะ ๆ ·
> ขาคู่ของ `SHOP_COLLECT`. ดู `docs/accounting/cpa-answers-2026-08-24.md` ข้อ A1+B4+C5

~~รอ CPA ตัดสินว่าจะเปิดบัญชีเจ้าหนี้ฝั่ง SHOP (คู่กับ S11-3001/S11-3002 ที่เป็นลูกหนี้) หรือไม่~~ **ตอบแล้ว — เปิด `S21-1104`**
— เป็นคำถามเดียวกับ opening-balance gap ใน interco spec §11.

**Cancel:** mirror-reverse ตามเดิมทุกประการ (สวีปด้วย `metadata.contractId`) — A.3 ใบใหม่ถูก
กลับรายการเหมือนกัน ทำให้ 11-2107 net = 0. จำนวน `reversalJeIds` **ลดลง 1 ใบ**
(instant-settlement หายไป): cancel วันที่ 15 = **6** ใบ (เดิม 7), cancel วันที่ 45 = **8** ใบ
(เดิม 9 — รวม 2A accrual ที่ถูกสวีป 2 ใบ). ทั้งหมดนี้คือเคส **ยังไม่ถูกตัดจ่ายรอบจ่าย**
(C-1 ของ exchange) — ถ้าสัญญาใหม่อยู่ใน batch POSTED แล้ว เส้นทาง cancel เดียวกันสลับเป็น
**C-2 semantics** (redirect แทน mirror ตรงบน 4 บัญชีรอบจ่าย, `cancelWindow: 'AFTER_PAYOUT'`)
— ดูหัวข้อ "ยกเลิกสัญญา (Flow C — Phase 3)".

**`depositAccountCode`:** ไม่บังคับอีกต่อไปบนคำขอ PRICED และ **ไม่มีผลต่อ JE ใดๆ** —
เหตุผลเดิมที่บังคับคือขาเงินสดของ A.3 (ถอด 2026-08-03) + penalty JE ตอน cancel
(ยกเลิกไปแล้ว 2026-07-31). คอลัมน์ `ContractExchangeRequest.depositAccountCode`
และฟิลด์ใน DTO **ยังคงอยู่** (ข้อมูลย้อนหลัง + API back-compat) แต่ไม่มีผู้อ่านในเส้นทางนี้แล้ว;
ช่องเลือกบัญชีบนหน้าจอส่งคำขอถูกถอดออก. `CASH_ACCOUNT_CODES` ที่ DTO import ถูกชี้กลับไปที่
`constants/cash-account.constants.ts` (แหล่งกลางที่ DTO อื่นอีก 6 ตัวใช้อยู่แล้ว) แทน template ที่ถูกลบ.

### AuditLog ของโมดูลนี้ = **เขียนหลัง tx commit เสมอ** (Phase 5 Task 5 ข้อ 0, 2026-08-22)

`AuditService.log` เปิด `$transaction` ของ **root client** เอง (hash chain: `nextval` +
อ่าน `prevRowHash` + insert ต้อง atomic) ⇒ การ `await` มันขณะที่ tx ของเรายังถือ connection
คือ nested root-tx ที่ **doctrine R-1 ห้าม** ⇒ **P2028 ทุกครั้ง** และ `log()` **กลืน error
ทิ้ง** (Sentry อย่างเดียว) ⇒ ไม่มีแถว audit เลยโดยที่ไม่มีใครรู้. Task 4 พิสูจน์บน DB จริง:
MEMO approve สำเร็จ 4 ครั้ง → `EXCHANGE_MEMO_APPLIED` **0 แถว** (ขณะที่ action ที่เขียนผ่าน
`tx.auditLog.create` ลงครบ) = ย้ายกรรมสิทธิ์เครื่องสองตัว + เปลี่ยน `contract.productId`
โดยไม่มีร่องรอย.

ตอนนี้ทุกเส้นทางในโมดูล exchange ใช้ pattern `pendingAudit` (จับ entry ไว้ใน tx → `await
this.audit.log(...)` **หลัง** `$transaction` คืนค่า) เหมือนที่ FINALIZED path ของ
`ExchangeCancelService` ทำมาตั้งแต่ Phase 3: `EXCHANGE_MEMO_APPLIED`,
`EXCHANGE_REQUEST_APPROVED`, `EXCHANGE_REQUEST_REJECTED`, `EXCHANGE_MEMO_CANCELED`,
`EXCHANGE_CANCELED` (PRE_FINALIZE). เลือก post-commit แทน `tx.auditLog.create` เพราะ
(ก) รักษา hash chain ครบ — แถวที่เขียนผ่าน tx ตรง ๆ ได้ `rowHash = null` แล้ว `verifyChain`
ข้าม, (ข) audit ต้องบรรยาย "งานที่ commit แล้ว" — เขียนใน tx ที่ roll back ได้ = phantom row.

**ยังค้าง (ไม่ใช่คลาสเดียวกัน):** `finalizeAfterActivation` เรียก `audit.log` **โดยไม่มี
`userId`** สองใบ (`EXCHANGE_FINALIZED`, `EXCHANGE_DEVICE_RETURNED_TO_SHOP`) ⇒
`AuditService.log` `return` ทิ้งตั้งแต่บรรทัดแรก (`if (!entry.userId) return`) — เงียบเหมือนกัน
แต่แก้ไม่ได้ที่จุดนั้น เพราะ `ContractWorkflowService.activate(id)` ทั้งเส้นทาง **ไม่มี actor
ให้ส่งต่อเลย**. ต้อง plumb userId ผ่าน activate ก่อน (งานแยก แตะเส้นทางเปิดสัญญา).

---

## ยกเลิกสัญญา (Flow C — Phase 3, workbook 2026-08-19)

Spec: `docs/superpowers/specs/2026-08-19-device-swap-netting-cancel-workbook-design.md` §5-6 ·
Plan: `docs/superpowers/plans/2026-08-20-device-swap-workbook-phase3.md` ·
Integration: `apps/api/src/modules/contracts/__tests__/contract-cancellation.integration.spec.ts` +
Task 5 golden ใน `exchange-priced-flow.integration.spec.ts` + Task 4/6 ใน
`interco-netting.integration.spec.ts`

**กติกา D3 (คำตัดสินเจ้าของ 2026-08-19 — ปิดประเด็น อย่าเสนอซ้ำ):** ยกเลิกสัญญาได้เฉพาะ
**ก่อนชำระงวดแรก** — เคยจ่ายแล้วต้อง void ใบเสร็จทั้งหมดก่อน (ใบลดหนี้ ม.86/10 ออกอัตโนมัติ
จาก receipt-void); สัญญาที่เดินไปแล้วใช้เส้นทางยึดเครื่อง (JP5) ตามเดิม. สองเคส:

| เคส | เงื่อนไข | พฤติกรรม |
|---|---|---|
| **C-1** | ยังไม่ถูกตัดจ่ายรอบจ่าย INTER-CO | sweep mirror-reverse ตรงทุกใบ — ทุกบัญชี net 0 ต่อสัญญา, สัญญาหลุดคิวจ่ายเองโดยนิยามเลนส์ (`HAVING SUM > 0` ไม่เจอ) |
| **C-2** | มี `InterCoSettlementItem` type `SETTLEMENT` ใน batch **POSTED** (detect ผ่าน `settledPayoutByContract` — ไม่อ่าน field บนสัญญา) | sweep เหมือน C-1 แต่ **redirect** ขาเจ้าหนี้/ลูกหนี้รอบจ่าย (batch ล้างไปแล้ว mirror ตรงจะติดลบ) เป็นลูกหนี้เรียกคืน `PAYOUT_RECALL` |

### สถาปัตยกรรม — sweep engine generalize (Task 1)

`ExchangeCancelReversalTemplate.reverse` (`exchange-cancel-reversal.template.ts`) ได้
options ใหม่ทั้งชุด: `excludeFlows` / `redirects: Record<account, {to, description}>` /
`redirectStamp` (stamp **เฉพาะ JE ที่มี redirect leg** — วาง spread ท้ายสุดให้ชนะค่า copy
จาก JE เดิม) / `flowLabel` / `descriptionPrefix` และคืน `redirectedTotals` (Σ Dr−Cr ของ
mirror legs ที่ถูก redirect เข้าแต่ละบัญชีปลายทาง — caller ใช้ cross-check). **Caller
exchange เดิมที่ส่งแค่ `{ jeIds, newContractId }` ได้พฤติกรรมเดิม byte-identical**
(flow `'exchange-cancel'`, idempotencyKey `cancel:<jeId>`, prefix `'[ยกเลิกเปลี่ยนเครื่อง]'`).
ห้ามเขียน sweep ตัวที่สอง — generic cancellation (`ContractCancellationTemplate`) delegate
เข้า engine ตัวนี้ด้วย `flowLabel: 'contract-cancellation'` + prefix `'[ยกเลิกสัญญา]'`.

### C-1 — `ContractCancellationTemplate` + `ContractCancellationService` (Task 2)

ยกเครื่องจาก mirror-1A-ใบเดียว (P4-SP4) → sweep ทุก JE ที่ stamp `metadata.contractId`
(1A + SHOP legs + 2A accruals + ฯลฯ). **JE refund เดิม (Dr 52-1106 / Cr 11-1201) ถูกลบ** —
`refundAmount > 0` โดน reject (field คงไว้ที่ DTO เพื่อ back-compat).

**`C1_EXCLUDED_FLOWS` — flows ที่ sweep ห้าม mirror (แชร์ constant เดียวกับ tripwire):**

| Flow | เหตุผล |
|---|---|
| `provision` | ECL รายวัน — mirror + release พร้อมกัน = double-debit 11-2102 ติดลบ (release แยกใบเดียวแทน — ดูล่าง) |
| `stage-reverse` | ขา release ของ ECL — คู่กับ provision ต้อง exclude ทั้งคู่ |
| `shop-collect-settlement` | **เงินสดจริง** (Dr cash / Cr 11-2107) — service guard บังคับ settle ให้ครบก่อนยกเลิกอยู่แล้ว |
| `shop-down-payment` | **เงินสดจริง** (Dr SHOP cash / Cr S21-2001) — mirror = fabricate การคืนเงินที่ยังไม่เกิด (ดู S21-2001 semantics ล่าง) |
| `reschedule-collect` | **เงินสดจริง** (6a fee เข้าตู้จริง) — park guard บังคับเคลียร์ก่อนยกเลิก |

**Positive cash tripwire** (นอกเหนือ deny-list): สแกน sweep candidates ชุดเดียวกับที่ engine
จะ mirror (เงื่อนไข skip เดียวกัน) — บรรทัดใดแตะบัญชีเงินสด/ธนาคาร (prefix `11-11` / `11-12` /
`S11-11` / `S11-12`) → `BadRequestException` ระบุ `entryNumber` — JE เงินสดที่ deny-list
ไม่รู้จักต้องดังไม่ใช่ถูก mirror เงียบ.

**ECL**: release **ใบเดียวจาก live GL** (pattern JP4 C1) — `glContractBalance(tx, id,
'11-2102', 'cr')` > 0 → `EclStageReverseTemplate` (`Dr 11-2102 / Cr 51-1103`) + flip
`BadDebtProvision` ACTIVE → REVERSED.

**Guards ใน `approveCancellation` (ทั้งหมดใน `$transaction` เดียว, ก่อน JE ใบแรก):**
1. Re-read contract **ใน tx** — ต้อง `ACTIVE` (กัน race กับ JP5/termination หลัง pre-tx read)
2. ไม่มี `Payment` ที่ `PAID` หรือ `amountPaid > 0` — เคยจ่ายต้อง void ก่อน (D3)
3. ไม่มี item ใน batch `DRAFT`/`PENDING_APPROVAL` — ถอน/ยกเลิกรอบก่อน (ระบุ batchNumber)
4. `refundAmount > 0` → reject (deprecated)
5. **Park 3 ถัง** (`advanceBalance + creditBalance + rescheduleAdvanceBalance > 0`) → reject
   — เงินพวกนี้เข้ามาเป็นเงินสดจริง (เช่น 6a fee ไม่ set `amountPaid` — หลุด guard ข้อ 2)
6. `shopCollectTypedBalance(tx, id)` ≠ 0 (typed lens ใหม่ใน `interco-typed-balance.ts` —
   explicit stamp ชนะ flow fallback, จำเป็นเพราะใบ settle เส้นทาง recall-cash ใช้ flow
   `'shop-collect-settlement'` เดิมแต่ stamp `PAYOUT_RECALL`) → reject

**Restore (ใน tx เดียวกัน):** product → `IN_STOCK` + `ownedByCompanyId` = SHOP;
soft-delete `Payment` + `InstallmentSchedule` ทุกแถว (cron/คิวเลิกเห็นสัญญา);
cancellation → APPROVED + `reversalJournalEntryId`; contract → `CANCELED`.
**ใบขาย `INSTALLMENT` ของสัญญา** (ที่ `activate` ออกให้) ถูกยกเลิกไปพร้อมกัน — `deletedAt` + `voidReason = 'ยกเลิกสัญญา <เลข>: <เหตุผล>'` +
`voidedById` (คำตัดสินเจ้าของ 2026-09-20; เดิมค้างในประวัติการขาย/ยอดสรุปเหมือนขายสำเร็จ เพราะ `completedSaleWhere` ตัดเฉพาะสัญญา `DRAFT`).
สัญญาเครดิตเทิร์นถูก `cleanupCreditContractSale` ยกเลิกใบขายไปก่อนแล้ว จึงเป็น 0 แถวที่ขั้นนี้. ลูกหนี้ไฟแนนซ์ในเครือของใบขายยุคเส้นทางเก่า
ปิดไปด้วยเฉพาะที่ยังไม่มีเงินเข้า. AuditLog `CONTRACT_CANCELED*` เพิ่ม `newValue.voidedSaleNumbers` (เฉพาะเมื่อมี). **ไม่มี JE เพิ่ม** —
sweep ด้านบนกลับรายการ JE ของการขายไปแล้ว ขั้นนี้แก้เฉพาะ "เอกสาร" ให้ตรงกับสมุด.

**S21-2001 semantics (ตั้งใจ — ไม่ใช่บั๊ก):** หลังยกเลิกสัญญาที่มีเงินดาวน์ S21-2001 ค้าง
**Cr downAmount** — sweep mirror JE B ของ activation (ที่เคย `Dr S21-2001` ล้างดาวน์) คืน
เจ้าหนี้เงินดาวน์กลับมา แต่ใบรับเงินดาวน์ (`shop-down-payment` — เงินสดจริง) ถูก exclude ⇒
ยอดค้างคือ **เจ้าหนี้รอคืนเงินลูกค้า** — การจ่ายคืนจริงเป็นขั้นตอนฝั่ง SHOP แยกต่างหาก
(`ShopDownPaymentReversalTemplate` เคสยังไม่ activate; JV มือเคสหลัง activate จนกว่าจะมี UI).

**Idempotency (DB-backed):** probe `ContractCancellation.reversalJournalEntryId` (persist
ใน tx เดียวกับ JEs) — ครอบทั้ง JE legacy P4-SP4 และ sweep ใหม่ (metadata probe เดิมมองไม่เห็น
sweep output เพราะ per-JE key ไม่มี cancellationId). ชั้นสอง: engine stamp `reversed:true`
ต่อใบ + DB idempotency index.

### C-2 — redirect + cross-check (Task 3, fold Task 4)

**Redirect map (`C2_REDIRECTS` — exported จาก `contract-cancellation.template.ts`,
ห้ามมีสำเนาที่สอง — exchange path import ชุดเดียวกัน):**

| บัญชีต้นทาง (mirror leg) | ปลายทาง | ความหมาย |
|---|---|---|
| 21-1101 (Dr mirror) | **11-2107** | ตั้งลูกหนี้เรียกคืน-หน้าร้าน (ยอดจัดที่ตัดจ่ายแล้ว) |
| 21-1102 (Dr mirror) | **11-2107** | ตั้งลูกหนี้เรียกคืน-หน้าร้าน (ค่าคอมที่ตัดจ่ายแล้ว) |
| S11-3001 (Cr mirror) | **S21-1104** | ตั้งเจ้าหนี้ FINANCE-เรียกคืน (ยอดจัด) |
| S11-3002 (Cr mirror) | **S21-1104** | ตั้งเจ้าหนี้ FINANCE-เรียกคืน (ค่าคอม) |

JE ที่มี redirect leg ถูก stamp `shopReceivableType: 'PAYOUT_RECALL'` (`C2_REDIRECT_STAMP`
— ระดับ JE, ชนะค่า copy จากใบเดิม). ยอด redirect = **gross ตาม GL ของใบที่ mirror** —
"หักไปแล้วเท่าไร" อ่านจาก item table ไม่ใช่ GL (สถาปัตยกรรม "เลนส์ gross + item gate").

**Cross-check หลัง sweep (ปิด carry (a) + กัน hand-JV, ใน tx — throw = rollback ทั้งชุด):**
`redirectedTotals['11-2107']` ต้อง = `settledTotal` (Σ financedGl+commissionGl ของ item
SETTLEMENT ใน batch POSTED) ±0.01 **และ** `redirectedTotals['S21-1104'].neg()` ต้อง =
`settledShopTotal` แยกสมุด — hand-JV ที่แตะเฉพาะสมุดเดียวผ่านเช็คสมุดเดียวได้ จึงต้องเช็ค
ทั้งคู่ (สัญญา `legacyNoShop` snapshot ฝั่ง SHOP = 0 → expected 0 = 0 ✓ โดยโครงสร้าง).

**Defensive check (C-2 เท่านั้น):** JE candidate ใดมีทั้งบรรทัดบน redirect source
(21-1101/21-1102/S11-3001/S11-3002) และบรรทัดบัญชี typed (`TYPED_LENS_ACCOUNTS` =
11-2107/S21-1104) หรือ `shopReceivableType` stamp เดิมในใบเดียวกัน → reject — redirect
stamp ทั้งใบจะทับความหมาย typed เดิม (เลนส์ Phase 2 อ่าน type ระดับ JE); producer จริง
ไม่มีทางสร้างใบแบบนี้ = hand-JV ผิดปกติ.

### เลขทองของเฟส — ยกเลิก swap หลังหักเครดิต 8,000 → เรียกคืนสุทธิ 3,000

สัญญาใหม่ของ swap: เจ้าหนี้ 11,000 (financed 10,000 + คอม 1,000), เครดิตสวอป 8,000 →
รอบจ่ายหัก 8,000 โอนจริง **3,000**. ยกเลิกหลัง batch POSTED:

- redirect เข้า 11-2107 = **11,000 gross** (= settledTotal — เจ้าหนี้ที่ batch ล้างไป)
  ⇒ typed `PAYOUT_RECALL` ทั้งสองสมุด = 11,000; typed `SWAP_CREDIT` net 0 (A.3/A.4 + mirror)
- delta ระดับบัญชีข้าม cancel: 11-2107 = **+3,000** (mirror A.3 −8,000 + redirect +11,000),
  S21-1104 = −3,000 (mirror A.4 +8,000 + redirect −11,000); 21-1101/21-1102/S11-3001/
  S11-3002 **ขยับ 0** (redirect ไม่ mirror ตรง — ไม่ติดลบ)
- คิวเรียกคืน (สูตร net Task 4): `recallGl = 11,000 − Σ POSTED deductions 8,000 = 3,000`
  = `shopRecallGl` — เลขเดียวสอดคล้องทุกชั้น: queue = drift RECALL = residual (0 หลังหัก) =
  audit `recallAmount` = เพดาน cash settle (settle เต็ม 3,000 แล้วหลุดคิว)

Golden ผ่าน production chain จริง (ไม่ synthetic): Task 5 spec ใน
`exchange-priced-flow.integration.spec.ts` — create→submit→approve batch จริง → cancel จริง.
Assertion ระดับบัญชีเป็น **delta** (batch JE ไม่ stamp `contractId` — per-contract lens
มองไม่เห็นขาหักโดยสถาปัตยกรรม).

### สูตร net ของ recall (ปิด carry (b) — แก้ Phase 2 ที่เขียนเป็น gross)

`getPendingRecalls` / drift guard แถว RECALL / `alarmNettingResiduals` ทั้งสามจุดเปลี่ยนจาก
gross → **net of Σ POSTED deductions (ทุก itemType)** — รายละเอียด+เหตุผลอยู่ในหัวข้อ
"หักกลบเครดิตเปลี่ยนเครื่อง + เรียกคืน (Phase 2)" (อัปเดตแล้ว 2026-08-20). สาเหตุที่ต้องแก้:
เคสยกเลิก swap ข้างบน — gross จะเสนอ 11,000 ให้หักซ้ำทั้งที่เงินจริงที่ต้องเรียกคืนคือ 3,000.

### เส้นทางรับเงินสดคืน (Task 6) — `POST /interco-settlement/recalls/:contractId/settle-cash`

Roles: `OWNER`/`FINANCE_MANAGER` (JE สองสมุดโพสต์ทันที ไม่มีชั้นเอกสาร/maker-checker —
gate ระดับ checker เหมือน approve/reverse). DTO: `amount` + `financeDepositAccountCode`
(FINANCE 6 บัญชี) + `shopPayoutAccountCode` (optional, default `S11-1201`) + `requestId`
(UUID ต่อการเปิด dialog). สองใบใน **Serializable `$transaction` เดียว**:

```
FINANCE — reuse ShopCollectSettlementTemplate + typeStamp: 'PAYOUT_RECALL'
  Dr <financeDepositAccountCode> / Cr 11-2107     (stamp shopReceivableType: 'PAYOUT_RECALL'
                                                   + metadata.contractId ⇒ typed recall lens
                                                   หักตรงประเภทต่อสัญญา — ต่างจากขา batch)
SHOP — journalAuto.createAndPost ตรง (flow 'interco-recall-cash-shop')
  Dr S21-1104 / Cr <shopPayoutAccountCode>        (stamp PAYOUT_RECALL เช่นกัน)
```

Guards ตามลำดับ: (0) idempotency `requestId` ก่อนทุกด่าน — retry หลัง settle เต็มจำนวน
ต้องคืนผลเดิมไม่ใช่ reject; ยอดไม่ตรงกับใบเดิม → 409; requestId เคยใช้กับ shop-collect
คนละเส้นทาง → 409 (กันใบขาเดียว); (1) มี RECALL item ใน batch `DRAFT`/`PENDING_APPROVAL`
→ reject ระบุรอบ (กันเงินก้อนเดียวถูกรับสด+หักในรอบพร้อมกัน); (2) สัญญาต้องอยู่ในคิว
`getPendingRecalls` (ยอด **net**); (3) สองสมุดตรงกัน ±0.01 (`recallGl` vs `shopRecallGl`
— ห้ามโพสต์ข้างเดียว); (4) `amount ≤ recallGl net + 0.01`. Race: SSI abort (P2034) และ
DB unique (P2002) แปลเป็น 409 ไทยทั้งคู่ — ไม่ใช่ raw 500. `typeStamp` default
`'SHOP_COLLECT'` บน template ⇒ caller เดิม (JP4 shop-collect settle) byte-identical.

**2026-09-20 — generalize เป็น `settleDeductionCash(contractId, type: 'PAYOUT_RECALL' | 'DEVICE_RETURN', dto, userId)`**
(`settleRecallCash` เหลือเป็น wrapper บาง ๆ ที่ส่ง `'PAYOUT_RECALL'`): route ใหม่
`POST /interco-settlement/device-returns/:contractId/settle-cash` (OWNER/FM, DTO เดียวกัน) — FINANCE ใช้
`ShopCollectSettlementTemplate` + `typeStamp: 'DEVICE_RETURN'`, SHOP flow `interco-device-return-cash-shop`
(`Dr S21-1104 / Cr <shopPayoutAccountCode>` stamp DEVICE_RETURN), guards ชุดเดียวกับ recall (คิว =
`getPendingDeviceReturns` ยอด net, item DEVICE_RETURN ใน batch เปิด → reject, สองสมุดตรง ±0.01, amount ≤ net + 0.01),
audit `INTERCO_DEVICE_RETURN_CASH_SETTLED`. UI: ปุ่ม "รับเงินสดค่าเครื่อง" ใน `PendingTab` รายการที่ 3 →
`RecallCashDialog kind='DEVICE_RETURN'`. บัญชีรับ FINANCE default `11-1201`; บัญชีจ่าย SHOP default
**DEVICE_RETURN = `S11-1202`**, ส่วน RECALL คง `S11-1201`.

### exchange-cancel C-2 (Task 5 — spec §5.5)

`ExchangeCancelService.cancel` ได้ branch เดียวกัน: guard batch เปิด + detect ผ่าน
`settledPayoutByContract(tx, [newContractId])` (helper เดียวกับ generic — export จาก
`contract-cancellation.service.ts`) + defensive check + redirect (`C2_REDIRECTS`/
`C2_REDIRECT_STAMP` import จาก generic template — ห้ามสำเนา) + cross-check สองสมุด +
`cancelWindow: 'AFTER_PAYOUT'` (C-1 ของ exchange ยังเป็น `'FREE'`). **FINALIZED-path audit
ย้ายไปหลัง tx commit** (doctrine R-1 — `AuditService.log` เปิด root-tx ซ้อน = P2028 pool
starvation + phantom audit row บน rollback; MEMO/PRE_FINALIZE audits ไม่แตะ).

### UI (Task 7)

- `ContractCancellationPage` (`/finance/contract-cancellation`): badge C-1/C-2 ต่อแถวจาก
  `listPendingCancellations` (`settledInBatch` + `recallAmount` **net** — สูตรเดียวกับ
  approve ผ่าน `settledPayoutByContract`, ห้าม duplicate) + confirm dialog แยกข้อความตามเคส
- `RecallCashDialog` (หน้า interco, `PendingTab` รายการเรียกคืน): default amount = net,
  `requestId` UUID สร้างใหม่ต่อการเปิด dialog (ปิด-เปิดใหม่ = คำขอใหม่)

### AuditLog actions (Phase 3 — String ธรรมดา ไม่มี Prisma enum)

| Action | Entity | เขียนที่ | newValue ที่สำคัญ |
|---|---|---|---|
| `CONTRACT_CANCELED` | `contract` | `approveCancellation` (C-1) | reversalEntryNumber/Count/JeIds, `refundAmount` (เขียนเสมอ — guard reject `> 0`; ค่าจริงคือ `cancellation.refundAmount.toString()` ซึ่ง Decimal normalize เป็น `"0"` ในทางปฏิบัติ) |
| `CONTRACT_CANCELED_AFTER_PAYOUT` | `contract` | `approveCancellation` (C-2) | + `settledTotal` (**gross** — ตรวจย้อน redirect), `recallAmount` (**net** = settled − deductions), `batchNumbers` |
| `EXCHANGE_CANCELED` | `contract_exchange_request` | `ExchangeCancelService` (action เดิม — C-2 เพิ่ม field) | `window: 'AFTER_PAYOUT'` + `recallAmount` (net) + `batchNumbers` เมื่อ C-2 |
| `INTERCO_RECALL_CASH_SETTLED` | `contract` | `settleRecallCash` | amount, financeEntryNo/shopEntryNo, requestId, `recallNetBefore` |
| `CANCELLATION_REJECTED` | `contract` | `rejectCancellation` (เดิม — ไม่เปลี่ยน) | reason |

**นิยาม `recallAmount` = net เสมอ** (settledTotal − settledDeductions) ทุกจุดที่โผล่:
audit ทั้งสอง action, `listPendingCancellations`, คิว recall — ตัวเลขเดียวกับเงินสดที่
FINANCE โอนจริงในรอบที่ตัดจ่าย.

### CI

`deploy-gcp.yml` vitest step เพิ่ม glob `src/modules/contracts/__tests__/*.integration.spec.ts`
(2026-08-20) — ไฟล์ `contract-cancellation.integration.spec.ts` อยู่ใต้ `__tests__/` ซึ่ง glob
เดิม `src/modules/contracts/*.integration.spec.ts` ไม่ครอบ (บทเรียน jp5-vat-split: glob
ไม่ recurse เอง — spec ใหม่ใน subdirectory ใหม่ต้องตรวจ glob ทุกครั้ง).

### Carry → Phase 4 — **ปิดครบแล้ว (2026-08-21)**

carry (a)/(b) ของ Phase 2 ปิดโดย Phase 3 (detection = POSTED item; สูตร net/combined).
carry (c)/(d)/(e) **ปิดโดย Phase 4** — (c) → finding kind `SWAP_CREDIT_ONE_BOOK`,
(d) → `approveBatch` เป็น Serializable ที่ต้นเหตุ + `NEGATIVE_TYPED` เป็นตาข่าย,
(e) → `BOOK_MISMATCH`. รายละเอียดพร้อมเหตุผลอยู่ที่หัวข้อ "รอ Phase 4 (carry)" ใน Inter-Co
section ด้านบน (ขีดฆ่าแล้วทั้งสามข้อ) และหัวข้อ **"การกระทบยอดระหว่างกิจการ (Phase 4)"**
ท้ายไฟล์. สิ่งที่ **ยังเปิดอยู่** (ค่าคอมโผล่สมุดเดียว `COMMISSION_ONLY_GAP` — reconcile
รายงานแล้วแต่ยังไม่แก้ต้นเหตุ เพราะเป็นความต่างจริงในบัญชีที่ต้องให้เจ้าของ/CPA ตัดสิน)
ชี้ไป Phase 5.

---

## การกระทบยอดระหว่างกิจการ (Phase 4 — 2026-08-21)

Spec: `docs/superpowers/specs/2026-08-19-device-swap-netting-cancel-workbook-design.md` §6 ·
Plan: `docs/superpowers/plans/2026-08-21-interco-reconcile-phase4.md` ·
Module: `apps/api/src/modules/interco-settlement/interco-aging.service.ts` +
`crons/shop-receivable-aging.cron.ts` + `crons/interco-reconcile.cron.ts` ·
UI: `apps/web/src/pages/interco/AgingTab.tsx`

เฟสนี้ **ไม่เพิ่ม JE ใหม่แม้แต่ใบเดียว** — เป็นชั้น "มองเห็น" ล้วน (รายงานอายุ + แจ้งเตือน +
กระทบยอด) บนบัญชี 11-2107 / S21-1104 ที่ Phase 1-3 สร้างขึ้น พร้อมปิด carry (c)/(d)/(e)
ของ Phase 2.

### ศัพท์ต่อสัญญา (**ชื่อตรงกัน**ทุกชั้น: service → endpoint → UI → cron ทั้งสองตัว)

> "ชื่อตรงกัน" ไม่ได้แปลว่า "ฟิลด์ครบทุกชั้น" — FE type (`apps/web/src/pages/interco/types.ts`)
> ตั้งใจรับเฉพาะฟิลด์ที่หน้าจอใช้ เช่น **`shopMirrorGross` ไม่มีใน FE** (ใช้ตัดสิน "สมุดเดียว"
> ฝั่ง reconcile cron เท่านั้น). ฟิลด์ไหนมีทั้งสองฝั่ง **ต้องชื่อเดียวกันและหมายถึงสิ่งเดียวกัน**.

| ฟิลด์ | นิยาม |
|---|---|
| `swapCreditGross` | 11-2107 typed `SWAP_CREDIT` Σ(Dr−Cr) ต่อสัญญา — **gross** (ขา Cr ของรอบจ่ายไม่ stamp จึงไม่ลดตัวนี้) |
| `payoutRecallGross` | 11-2107 typed `PAYOUT_RECALL` Σ(Dr−Cr) ต่อสัญญา — gross เช่นกัน |
| `settledDeduction` | Σ (`swapCreditAmount` + `recallAmount`) ของ `InterCoSettlementItem` **ทุก `itemType`** ใน batch `POSTED` ของสัญญานั้น |
| `intercoNet` | `swapCreditGross + payoutRecallGross − settledDeduction` = **ยอดกลุ่มระหว่างกิจการคงเหลือจริง**. รวมสองประเภทก่อนหักโดยเจตนา — invariant ถือที่ **ระดับสัญญา ไม่ใช่ระดับประเภท** (สัญญา swap ที่ถูกยกเลิกภายหลังมีประวัติข้ามประเภท: SWAP_CREDIT ถูก mirror จนเหลือ 0 ขณะที่ deduction เดิมยังค้างถาวรใน item table ส่วน PAYOUT_RECALL ถือ gross ของ redirect) — เหตุผลเดียวกับสูตร combined ของ `alarmNettingResiduals` (Phase 3 Task 4) |
| `shopCollect` | 11-2107 typed `SHOP_COLLECT` Σ(Dr−Cr) — **แยกคอลัมน์ ไม่ปนกลุ่ม interco** (เงินลูกค้าที่หน้าร้านรับแทน ไม่ใช่เงินระหว่างกิจการ; ล้างผ่าน `settleShopCollect` ตามเดิม) |
| `shopMirrorGross` | S21-1104 Σ(Cr−Dr) **ก่อน**หัก deduction (conditional group key: `SWAP_CREDIT` → `metadata.newContractId`, ประเภทอื่น → `metadata.contractId`) — ใช้ตัดสิน "สมุดเดียว" ตรงๆ โดยไม่ให้ deduction ของรอบจ่ายมาบังตัวเลข (สัญญาที่ถูกหักครบพอดีมี `shopMirrorNet = 0` เหมือนกันแต่มีขาคู่ครบ ไม่ใช่ anomaly) |
| `shopMirrorNet` | `shopMirrorGross − settledDeduction` — กระจกฝั่ง SHOP ของ `intercoNet` |
| `bookMismatch` | `abs(intercoNet − shopMirrorNet) > 0.01` (`shopCollect` ไม่นับ — เป็น FINANCE-side-only โดยธรรมชาติ) |
| `legacyOneBook` | มีบรรทัด 11-2107 ยุค legacy (flow A.3 โดย**ไม่มี** stamp) **และ** `shopMirrorGross = 0` = swap ยุคก่อน Phase 1 (spec §11.4). **เป็นสภาพปกติ ไม่ใช่ anomaly** — pending lens โมเดลมันเป็น `swapCreditEligible = false` อยู่แล้ว |

**ทำไมรายงานเป็น 2 กลุ่ม (interco / shop-collect) ไม่ใช่ 3 คอลัมน์ล้วนตาม spec:** spec §6
ข้อ 1 เขียนไว้ว่า "3 คอลัมน์ SWAP_CREDIT / PAYOUT_RECALL / SHOP_COLLECT" — implement จริง
ยุบสองประเภทแรกเป็น `intercoNet` เพราะ `settledDeduction` **หักข้ามประเภทโดยไม่แยก**
(item เก็บ `swapCreditAmount`/`recallAmount` แต่ยอดที่ต้องหักถือที่ระดับสัญญา) ⇒ ถ้าโชว์
3 คอลัมน์ **สุทธิ** จะต้องเดาว่า deduction ไปหักประเภทไหน = ตัวเลขผิด. คอลัมน์ gross
รายประเภทยังมีครบบนแถว (`swapCreditGross`/`payoutRecallGross`) เพียงแต่ยอด "คงเหลือจริง"
มีตัวเดียวคือ `intercoNet`. `legacyOneBook` / `bookMismatch` / `shopMirror*` ก็ไม่ได้อยู่ใน
spec เดิม — เพิ่มระหว่าง implement (ถ้าไม่มี `legacyOneBook` swap ยุคเก่าจะเตือนเท็จทุกวัน
ตลอดไป).

### Engine — `IntercoAgingService` (แหล่งเดียว ห้ามคำนวณเอง)

- `getShopReceivableAging(asOf?, thresholdDays = 30)` → `{ rows, asOf, totals }`.
  **จำนวน query คงที่ 4 ครั้ง ไม่ขึ้นกับจำนวนสัญญา** (Query A = 11-2107 typed sums 3
  ประเภท + MIN(posted_at) 2 กลุ่ม ใน CASE เดียว, Query B = S21-1104 conditional key,
  Query C = deductions groupBy, Query D = hydrate contract) — **ห้าม refactor กลับไปเรียก
  helper ต่อสัญญาในลูป** (N×5).
- **`asOf` มีผลกับการคำนวณ "อายุ" เท่านั้น — ยอดคงเหลือเป็นยอดปัจจุบันเสมอ** (ตรงกับ SQL
  twins ที่ไม่มี date filter; deduction gate อ่านสถานะ batch ปัจจุบันซึ่ง time-travel
  ไม่ได้อยู่แล้ว). UI จึง **ไม่มี date picker** โดยตั้งใจ — ให้ผู้ใช้เลือกวันที่จะสื่อผิดว่าเป็น
  "ยอด ณ วันย้อนหลัง".
- `totals.intercoNet` / `totals.shopCollect` / `totals.overdueCount` **ไม่รวมแถว
  `legacyOneBook`** — คอลัมน์ typed ของแถว legacy โกหกเชิงประเภท (ค้าง +8,000/−8,000 บน
  สัญญาที่ยอดจริงเป็น 0 หลัง settle ผ่าน shop-collect). หนี้ legacy ที่ยังค้างจริง**ไม่ถูก
  ซ่อน** — รายงานแยกใน `totals.legacyOneBookNet` = Σ(`intercoNet` + `shopCollect`) ของแถว
  legacy ซึ่ง **คือยอด 11-2107 จริงระดับสัญญา** (ยังไม่ล้าง = เต็ม, ล้างครบ = 0 พอดี).
- Predicates ที่ export เป็น **single source** — cron ทั้งสองตัวเรียกตัวเดียวกับที่ service
  ใช้ประกอบ `totals` (ปักด้วยเทสต์ anti-drift `flagged === totals.overdueCount`):
  `overdueArms` / `isShopReceivableOverdue` (แขน `INTERCO` กับ `SHOP_COLLECT` แยกกัน; ยอด
  ต้อง > 0.01 **คู่กับ** อายุถึงเกณฑ์ — แถวที่โผล่เพราะ `bookMismatch` แต่ยอดศูนย์ไม่ใช่
  หนี้ค้าง), `isReportableAgingRow`, `sortAgingRows`, `negativeTypedFields`,
  `isSwapCreditOneBook`. **การกันแถว `legacyOneBook` เป็นหน้าที่ของ caller** — predicate
  เหล่านี้เป็นคณิตศาสตร์ล้วน ไม่รู้จักบริบท legacy โดยตั้งใจ.
- `getNegativeTypedRows()` — **จงใจไม่อ่านจาก `getShopReceivableAging`**: รายงานหลักกรอง
  ด้วย `isReportableAgingRow` (ยอดบวก หรือสองสมุดไม่ตรง) ⇒ เคสหักเกินแบบ **สมมาตร**
  (`intercoNet = shopMirrorNet = ติดลบเท่ากัน` ⇒ `bookMismatch = false`, ไม่มียอดบวกเลย)
  จะ **ไม่มีวันถูกเห็น**. เหตุที่ไม่ขยาย filter ของรายงานหลักให้เก็บค่าติดลบแทน: `totals`
  เป็นผลรวมของ `rows` ⇒ แถวติดลบจะไป **หักล้างหนี้ค้างจริงของสัญญาอื่น** บนหัวแท็บ
  (บั๊กคลาสเดียวกับ carry ก ของ Phase 3).
- `getPayablePairing()` (เจ้าหนี้ 21-1101/21-1102 คู่กับลูกหนี้ SHOP S11-3001/S11-3002
  ต่อสัญญา — **ไม่มี settled gate** เพราะขาล้างของ batch ไม่ stamp `contractId` ทั้งสองฝั่ง
  ⇒ เลนส์ทั้งคู่ค้างที่ gross เท่ากันตลอดอายุสัญญา; ต่างกัน = มีมือมาแก้ข้างเดียว).
  **`mismatch` เทียบ *ต่อขา* (`financedDiff` หรือ `commissionDiff` เกิน 0.01) ไม่ใช่ผลรวม** —
  ห้าม "ทำให้ง่ายขึ้น" เป็น `diff` ก้อนเดียว: misclassification ที่ย้ายเงินระหว่าง 21-1101 กับ
  21-1102 (หรือ S11-3001 กับ S11-3002) ทำให้ผลรวมเป็น 0 พอดีแล้วจุดบอดจะกลับมา ·
  `getPhase2SwapContractIds()` · `getTypedAccountDrift()` · `getOpenBatchPayableGross()` —
  ใช้โดย reconcile cron (ดูล่าง).

### Endpoint + UI

| Method | Path | Roles |
|---|---|---|
| GET | `/interco-settlement/shop-receivable-aging?asOf&thresholdDays` | OWNER, FINANCE_MANAGER, ACCOUNTANT |
| GET | `/interco-settlement/reconcile-findings` (Phase 5) | OWNER, FINANCE_MANAGER, ACCOUNTANT |
| POST | `/interco-settlement/reconcile/run` (Phase 5) | OWNER, FINANCE_MANAGER |

`asOf` = ISO date (รูปแบบผิด → 400 ไทย); `thresholdDays` = **จำนวนเต็ม 1-365** (นอกช่วง →
400 ไทย) — ช่วงเดียวกับที่ cron รายวัน validate. UI = แท็บ **"อายุลูกหนี้หน้าร้าน"** ในหน้า
จ่ายให้หน้าร้าน (INTER-CO): ไม่มี date picker, เกณฑ์วันตรึงที่ default 30, แถว
`legacyOneBook` เป็น badge กลางๆ (ไม่ใช่สีแดง) + ไม่นับ overdue + ยอดแยกไปบรรทัด
"ค้าง swap ยุคเก่า" (ตรงสูตร `legacyOneBookNet` ฝั่ง server ทุกประการ), ส่วน `bookMismatch`
ที่ไม่ใช่ legacy = badge destructive.

> **หมายเหตุเกณฑ์วัน:** cron รายวันอ่านเกณฑ์จาก SystemConfig ส่วน FE **ไม่ส่ง query param
> เลย** (`api.get('/interco-settlement/shop-receivable-aging')` ไม่มี `thresholdDays`) ⇒
> `totals.overdueCount` ที่ได้คิดจาก **default 30 ของ service** และ FE ใช้ค่าคงที่
> `AGING_DEFAULT_THRESHOLD_DAYS = 30` (`interco/types.ts`) **เฉพาะทำป้ายบนแถว** เท่านั้น.
> ผลคือ ถ้าผู้ดูแลแก้ `shop_receivable_aging_alert_days` เป็นเลขอื่น **cron จะเตือนตามเลขใหม่
> แต่ทั้งตัวเลขและป้ายบนแท็บยังเป็น 30** จนกว่าจะส่ง query param ให้ตรงกัน (ยอด/อายุรายแถว
> ยังตรงกันเสมอเพราะมาจาก engine เดียว — ต่างเฉพาะ "นับว่าเกินเกณฑ์ไหม"). ตราบใดที่ยังไม่มี
> ใครแก้ config เลข 30 ตรงกันทุกชั้น.

### แท็บ "กระทบยอด" (Phase 5 Task 5 ข้อ 1+4 — 2026-08-22)

`GET /interco-settlement/reconcile-findings` →
`IntercoAgingService.getReconcileFindings()` คืน `{ asOf, pairMismatches, negativeRows }`:
คู่เจ้าหนี้/ลูกหนี้รอบจ่ายที่ `mismatch` (ติดป้าย `commissionOnly` ด้วย **predicate เดียวกับ
cron** — `isCommissionOnlyGap`) + แถวยอดติดลบพร้อม `negativeFields` (จาก
`negativeTypedFields` ตัวเดียวกัน). **FE ห้ามคำนวณป้าย/ช่องติดลบเอง** — ป้ายบนจอกับในใบ
Todo ต้องมาจากสูตรเดียว. ไม่มี query param โดยตั้งใจ (ยอดเป็นยอดปัจจุบันเสมอ เหมือนแท็บอายุ).

ทำไมเป็นแท็บใหม่ ไม่ยัดรวมแท็บอายุ: แท็บอายุคือ "หนี้ที่ต้องไปตาม" — กรองด้วย
`isReportableAgingRow` และ `totals` บนหัวแท็บเป็นผลรวมของแถวที่แสดง ⇒ เอาแถวติดลบไปปนจะไป
**หักล้างหนี้ค้างจริงของสัญญาอื่น** (บั๊กคลาสเดียวกับ carry ก ที่ Phase 4 เพิ่งปิด). สอง
มุมนี้คือ kind ที่ `KIND_TAB` map มาที่ `RECONCILE`.

`POST /interco-settlement/reconcile/run` (OWNER/FM) เรียก **`IntercoReconcileCron.tick()`
ตัวเดียวกับ cron รายเดือน** — ได้ dedup Todo ชุดเดิม (tag + yyyy-mm + ยังไม่ DONE), Sentry
ชุดเดิม และ **kill switch `interco_reconcile_enabled` ตัวเดิม** (ปิดอยู่ = คืน
`enabled: false` ไม่ทำอะไรเลย — เจตนา: สวิตช์เดียวคุมทั้งสองช่องทาง ไม่มีทางลัดข้ามสวิตช์;
UI บอกตรง ๆ ว่า "ยังไม่ได้ตรวจอะไรเลย" + คีย์นี้ยังไม่มีหน้าจอตั้งค่า ต้องแก้ที่ DB).
response = `{ enabled, failed, todoCreated, total, counts, findings }` (`counts` = นับตาม kind).
**`failed` แยก "รันแล้วพัง" ออกจาก "ถูกปิดไว้"** — ทั้งสองกรณีคืน `findings: []` เหมือนกัน
(tick ไม่ throw ตาม doctrine) ⇒ ถ้าไม่มีฟิลด์นี้ หน้าจอจะโชว์ "ไม่พบรายการผิดปกติ" ทั้งที่
ยังไม่ได้ตรวจอะไรเลย. FE branch `failed` **ก่อน** `enabled` เพราะ tick ที่พังจะคืน
`enabled: true` มาด้วย.
`tick()` ไม่ throw ตาม doctrine ⇒ endpoint ไม่มี error path ของตัวเอง. **หน้าจอนี้ไม่มีปุ่ม
แก้ GL** — doctrine "ไม่ตั้ง JE ปรับปรุงอัตโนมัติ" ยังเหมือนเดิมทุกประการ.

**M1 (Phase 5 ข้อ 3):** `buildAllRows` เลิก `continue` ทิ้งแถวที่ hydrate สัญญาไม่ได้ —
ใช้ป้าย `MISSING_CONTRACT_LABEL` (`'(ไม่พบสัญญา)'`) ตัวเดียวกับ `getPayablePairing` และ
hydrate **ไม่กรอง `deletedAt`** เหมือนกันทั้งสองที่ (รายงานกระทบยอด ไม่ใช่คิวงาน: GL ที่ไม่มี
สัญญารองรับคือสิ่งที่ต้องเห็น). เดิมยอดพวกนี้หายจากทั้ง `rows`/`totals`/`getNegativeTypedRows`
เหลือช่องทางเดียวคือ drift ระดับบัญชีซึ่ง **ไม่มีเลขสัญญา** ให้ตามต่อ.

### Cron รายวัน — `shop-receivable-aging.cron.ts` (09:07 BKK)

| SystemConfig key | Default | ความหมาย |
|---|---|---|
| `shop_receivable_aging_alerts_enabled` | `true` | kill switch (ไม่ seed — **missing = เปิด**, ต่างจาก opt-in flags อื่นในระบบที่ missing = ปิด) |
| `shop_receivable_aging_alert_days` | `30` | เกณฑ์วันค้าง — **ไม่ใช่ clamp**: ค่านอกช่วง 1-365 → คืน fallback 30 (`readIntFlag`) |

- แถวที่ค้างเกินเกณฑ์ → **Todo `MEDIUM` tag `interco-aging`**, dedup ต่อ **สัญญา** (tag +
  `title` มีเลขสัญญา + ยังไม่ `DONE`) — **ต่างจาก spec §6 ข้อ 2 ที่เขียนว่า "dedup ต่อ
  สัญญา+ประเภท"**: หนึ่งใบต่อสัญญาครอบทุกแขนที่ค้าง (แขนที่แก่ที่สุดขึ้นหัวเรื่อง, ราย
  ละเอียดทั้งสองแขน + วิธีล้างอยู่ในคำอธิบาย) — สองใบต่อสัญญาเป็นเสียงซ้ำที่คนจะเลิกอ่าน
  และ "ประเภท" ในรายงานนี้ยุบเป็น "แขน" อยู่แล้ว. Sentry warning ต่อแถว
  (`subsystem: 'interco-netting'`, ข้อความ `Shop receivable aged past threshold`) —
  **ยิงเฉพาะตอนสร้าง Todo ใบใหม่จริง ไม่ใช่ทุก tick** (final review Phase 4): `alarm()` อยู่
  **หลัง** dedup probe เพราะแถวที่ถูก dedup คือลูกหนี้ที่รอรอบจ่ายตามปกติซึ่งมี Todo ค้างอยู่
  แล้วตั้งแต่วันแรก — ยิงซ้ำทุกวันตลอดไปทำให้ Sentry เป็น heartbeat จนคนเลิกอ่าน (หลักเดียว
  กับ gate `legacyOneBookNet` ข้อถัดไป). ช่องทาง "ยังไม่หาย" = reconcile cron รายเดือน +
  แท็บอายุลูกหนี้. คำอธิบาย Todo ระบุ "ข้อมูล ณ <วันที่>" เสมอ เพราะ dedup ข้ามวันทำให้
  ยอด/อายุในใบแช่อยู่ที่วันที่สร้าง.
- **แถว `legacyOneBook` ไม่ alert รายแถว** (คำตัดสิน Task 3) — คอลัมน์ typed ของมันโกหก
  เชิงประเภท และแขน `shopCollect` บนแถว legacy ก็เป็น (หนี้ shop-collect จริง − ขาล้าง
  เครดิต legacy) ปนกัน ⇒ เตือนด้วยตัวเลขผิดคือทางลัดไปสู่การถูกเมิน. แต่หนี้จริง **ต้องมี
  ช่องทาง push**: tick ยิง Sentry **รวมหนึ่งอีเวนต์ต่อรอบ** (`Legacy one-book shop
  receivable outstanding`) + log warn เมื่อ `legacyOneBookNet > 0.01` — gate ด้วย
  **ยอดจริง ไม่ใช่จำนวนแถว** (แถวที่ล้างครบ net = 0 จึงเงียบเอง ไม่มีบรรทัด "0.00 บาท"
  รายวันให้คนชิน).
- doctrine R-1: root `PrismaService` เท่านั้น, ไม่อยู่บนเส้นทางเงิน, **ห้าม throw ออกจาก
  tick** (outer try/catch + per-row try/catch). ไม่มีผู้ใช้ SYSTEM → สร้าง Todo ไม่ได้เลย
  จึงเป็น **ข้อยกเว้นเดียว** ที่ Sentry ยังยิงครบทุกแถว (ไม่มีช่องทางอื่นเหลือ — pattern
  `alarmResidualParkOnCompletion`: alarm มาก่อน Todo); เคส dedup ปกติไม่ยิงซ้ำ (ดูด้านบน).

### Cron รายเดือน — `interco-reconcile.cron.ts` (วันที่ 1, 08:00 BKK)

kill switch **`interco_reconcile_enabled`** (default `true`, ไม่ seed). ผลลัพธ์ = **Todo
`HIGH` หนึ่งใบต่อเดือน** tag `interco-reconcile` (dedup ด้วย tag + `yyyy-mm` เวลาไทยใน
title + ยังไม่ `DONE` ⇒ รันซ้ำ/รันมือในเดือนเดียวกันไม่สร้างใบซ้ำ) + Sentry warning หนึ่ง
อีเวนต์พร้อม count แยกตาม kind.

| Finding kind | จับอะไร | เกณฑ์แยก legacy |
|---|---|---|
| `BOOK_MISMATCH` | `intercoNet` ≠ `shopMirrorNet` ต่อสัญญา (**ปิด carry e**) | ข้ามแถว `legacyOneBook` (สองสมุดต่างกันโดยนิยาม) |
| `SWAP_CREDIT_ONE_BOOK` | `swapCreditGross > 0` แต่ `shopMirrorGross = 0` (**ปิด carry c**) | นับ **เฉพาะ** สัญญาใน `getPhase2SwapContractIds()` (มี JE flow `shop-exchange-return` ที่ stamp `newContractId`) — swap ยุคก่อน Phase 1 ไม่เข้าเงื่อนไขโดยโครงสร้าง |
| `PAYABLE_PAIR_MISMATCH` | `financedDiff ≠ 0` **หรือ** `commissionDiff ≠ 0` ต่อสัญญา (21-1101 vs S11-3001 และ 21-1102 vs S11-3002) — **เทียบต่อขา ห้ามเทียบผลรวม**: misclassification ที่ย้ายเงินระหว่างยอดจัดกับค่าคอมทำให้ผลรวมเป็น 0 พอดี ⇒ เทียบผลรวมจะเงียบทั้งที่สองสมุดผูกกันผิดขา | ข้ามสัญญา `legacyNoShop` (activate ก่อน 2026-06-23 — สมุด SHOP ยังไม่มีลูกหนี้) |
| `NEGATIVE_TYPED` | ยอดติดลบ = ล้างเกิน (**ตาข่ายของ carry d**) | **ไม่ยกเว้น legacy** แต่วัดด้วย **ยอดรวมระดับสัญญา** (`intercoNet + shopCollect`) — แถว legacy มี `shopCollect` ติดลบเป็นปกติ (ล้างผ่านใบ shop-collect), เช็คทีละช่องคือ alert เท็จถาวร |
| `ACCOUNT_DRIFT` | ระดับบัญชี: มีบรรทัดที่เลนส์ต่อสัญญามองไม่เห็น | — |

- **`SWAP_CREDIT_ONE_BOOK` ชนะ `BOOK_MISMATCH`** บนสัญญาเดียวกัน (วินิจฉัยเฉพาะเจาะจงชนะ)
  — ไม่รายงานซ้ำสองใบบนสัญญาเดียว.
- **`ACCOUNT_DRIFT` ของคิวรอจ่ายต้อง "บวกกลับรอบที่ค้างอนุมัติ" ก่อนตัดสิน**: รอบ
  `PENDING_APPROVAL` จองสัญญาไว้แล้ว (หลุดจาก `pendingTotal`) แต่ **ยังไม่โพสต์ JE** ⇒ ยอด
  บัญชี 21-1101/21-1102 ยังเต็ม ⇒ `drift` ติดลบเท่ายอดรอบนั้นพอดี ซึ่งเป็น **สภาพปกติของ
  กิจการที่มีรอบรออนุมัติ**. สูตร: `driftResidual = getReconcileTotals().drift +
  getOpenBatchPayableGross()` — เป็น finding เฉพาะเมื่อ residual ยังเกิน 0.01; ถ้าอธิบาย
  ได้ครบด้วยรอบค้าง = log บรรทัดเดียว ไม่เตือน (ไม่งั้นส่งคนไปตามหา JE ที่ไม่มีอยู่จริง
  ทุกเดือนที่มีรอบค้าง).
- **สมการของ `ACCOUNT_DRIFT` ระดับบัญชี**: `ยอดบัญชีจริง = Σ บรรทัดที่เลนส์ classify ได้ −
  Σ deduction ของ batch POSTED`. ส่วนต่างคือบรรทัดที่ **ไม่มีเลนส์ไหนมองเห็น** — เช่น
  mirror ตอนยกเลิก swap ยุค legacy ที่ต้นฉบับไม่มี stamp (mirror จึงไม่ copy อะไรเลย และ
  flow เปลี่ยนเป็น `exchange-cancel`) หรือ JV มือ.
  **อย่าอ่านว่า "จับได้แล้ว จบ" — เคสนี้ยังเปิดอยู่และมีต้นทุนรายวัน (ปรับถ้อยคำ
  2026-08-21):** `ACCOUNT_DRIFT` จับได้เฉพาะ **ระดับบัญชี — ไม่มีเลขสัญญาติดมาด้วย** (สมการ
  เป็นยอดรวมทั้งบัญชี) คนอ่านจึงรู้แค่ "11-2107 เพี้ยน 8,000" แล้วต้องไปไล่ JE เอง; และแถวผี
  ของสัญญานั้น **ยังค้างอยู่ในรายงานอายุ** ด้วย `intercoNet = +8,000` ทั้งที่บัญชีจริงเป็น 0
  — แถวเป็น `legacyOneBook` จึงไม่ alert รายแถว **แต่ไปบวกใน `legacyOneBookNet`** ⇒ cron
  รายวันยิง Sentry `Legacy one-book shop receivable outstanding` **ทุกวันตลอดไป** และแท็บโชว์
  ยอดผีในบรรทัด "ค้าง swap ยุคเก่า". สรุป: นี่คือ **false alarm รายวัน + finding รายเดือนที่
  ไม่มีเลขสัญญา** ไม่ใช่แค่จุดบอดเงียบ ๆ. ทางแก้จริง (backfill stamp ให้ mirror ยุคเก่า หรือ
  ให้เลนส์รู้จัก flow `exchange-cancel`) เป็นงาน Phase 5 — ต้องตรวจก่อนว่ามีแถวแบบนี้จริงบน
  prod กี่ใบ. ปักพฤติกรรมไว้ที่ `interco-aging.integration.spec.ts` ("carry ข: mirror ของ
  swap ยุค legacy ที่ไม่มี stamp").
- **จัดลำดับก่อนตัดบรรทัด**: คำอธิบาย Todo ตัดที่ 20 บรรทัด แต่เรียงตามความรุนแรงก่อน
  (`NEGATIVE_TYPED` → `ACCOUNT_DRIFT` → `SWAP_CREDIT_ONE_BOOK` → `BOOK_MISMATCH` →
  `PAYABLE_PAIR_MISMATCH`) — ห้ามให้ความไม่ตรงเชิงโครงสร้างที่รู้สาเหตุแล้วมาดันเงินที่
  เคลื่อนผิดตกไปอยู่ใน "และอีก N รายการ".
- **`COMMISSION_ONLY_GAP` = pattern ที่รู้จัก** (`PAYABLE_PAIR_MISMATCH` ที่ต่างเฉพาะขา
  ค่าคอม): ถูก **ยุบเป็นบรรทัดสรุปเดียวนอกโควตา 20 บรรทัด — ยังนับเต็มในยอดรวมบนหัวเรื่อง
  และมี Sentry counter แยก ไม่ใช่ skip** (precedent: `legacyOneBookNet` ของ cron รายวัน).
  สาเหตุ: สัญญาที่ `storeCommission` ว่าง — `ContractActivation1ATemplate` ตั้ง fallback
  10% บน 21-1102 ส่วน `ShopInventoryTransferTemplate` รับมาเป็น 0
  (`contract.storeCommission ?? 0`) ⇒ ค่าคอมโผล่สมุดเดียว. **เป็นความต่างจริงในบัญชี
  (opening-balance gap ตาม interco spec §11) ไม่ใช่ artifact ของการอ่าน** — ยังเปิดอยู่
  รอเจ้าของ/CPA (ดู "ยังเปิดอยู่ → Phase 5" ในหัวข้อ Inter-Co ด้านบน).
- **footer ของ Todo เป็น kind-aware** — ชี้ **แท็บที่ถูกต้องต่อ kind** ไม่ใช่ชี้เหมารวม.
  แหล่งความจริงเดียวคือ **`KIND_TAB`** ใน `interco-reconcile.cron.ts` (Phase 5 Task 5 ข้อ 1
  แทน `OFF_TAB_KINDS` เดิมของ Phase 4 — ตอนนั้นสองใน kind เหล่านั้นยังไม่มีหน้าจอเลย):
  `BOOK_MISMATCH`/`SWAP_CREDIT_ONE_BOOK` → แท็บ **"อายุลูกหนี้หน้าร้าน"**,
  `NEGATIVE_TYPED`/`PAYABLE_PAIR_MISMATCH` → แท็บ **"กระทบยอด"** (ใหม่ Phase 5),
  `ACCOUNT_DRIFT` → **ไม่มีหน้าจอ** (ระดับบัญชี ไม่มีเลขสัญญาให้แสดง) ⇒ ใบ Todo ยังประกาศ
  "ไม่แสดงบนแท็บ: <kind> — ใช้ข้อมูลในใบนี้" เฉพาะ kind ที่ `KIND_TAB` = `null`. บรรทัด
  "และอีก N รายการ" อ้างแท็บได้ต่อเมื่อรายการที่ถูกตัด **ทุกใบ** มีแท็บ. เพิ่ม kind ใหม่
  เมื่อไรต้องตัดสินพร้อมกันว่ามันอยู่แท็บไหน/ไม่มีแท็บ.
- **กลุ่มที่ถูกยุบต้องมีเลขสัญญาถึงคน** — `COMMISSION_ONLY_GAP` ไม่กินโควตารายบรรทัด ⇒
  บรรทัดสรุปพิมพ์ **10 เลขแรก + "และอีก N สัญญา"** และ Sentry `extra` มี
  `patternCommissionOnlyContracts` (สูงสุด 50 เลข) คู่กับ counter เดิม. ตั้งแต่ Phase 5 กลุ่ม
  นี้ **มีหน้าจอแล้ว** (แท็บ "กระทบยอด" — ป้าย "ต่างเฉพาะค่าคอม" ต่อแถว) แต่เลขสัญญายังพิมพ์
  ในใบ Todo ต่อไปโดยตั้งใจ: ใบ Todo คือ **snapshot ของรอบนั้น** ส่วนแท็บโชว์สถานะปัจจุบัน —
  สองอย่างเสริมกัน ไม่ใช่ซ้ำกัน.
- **ไม่ผูกกับเกณฑ์วันของ alert รายวัน** — reconcile ไม่อ่าน
  `shop_receivable_aging_alert_days` เลย: สัญญาที่ผิดปกติแต่ยังไม่แก่พอ (หรือ operator ตั้ง
  เกณฑ์ไว้สูงจนแท็บ UI กับ cron รายวันมองต่างกัน) ก็ยังโผล่ที่นี่ทุกเดือนเสมอ.

### สิ่งที่ cron **ไม่ทำ** (doctrine — อย่าเสนอให้ทำ)

- **ไม่แตะ GL แม้แต่บรรทัดเดียว** — ไม่ตั้ง JE ปรับปรุง ไม่กลับรายการ ไม่ปัดเศษให้ตรง.
  ความไม่ตรงทุกแบบที่นี่ต้องให้ **มนุษย์/ผู้สอบบัญชี** ตัดสินว่าจะแก้ด้วย JV แบบไหน; การเดา
  JE ปรับปรุงเองคือคลาสเดียวกับ opening-balance gap (interco spec §11) ที่ยังรอ CPA อยู่.
  ข้อความปิดท้าย**ในใบ Todo ของ reconcile** ระบุตรงๆ ว่า "ระบบไม่ตั้ง JE ปรับปรุงให้
  อัตโนมัติ — ต้องให้ผู้มีอำนาจ/ผู้สอบบัญชีตัดสินก่อนแก้" (Todo ของ cron รายวันเป็นใบ
  "ตามหนี้" จบที่ "ข้อมูล ณ <วันที่>" ไม่มีประโยคนี้ — แต่ doctrine ครอบทั้งสองตัวเท่ากัน).
- **ไม่คำนวณยอด typed/net เองในไฟล์ cron** — ทุกตัวเลขมาจาก `IntercoAgingService` +
  `IntercoPendingService.getReconcileTotals()`; การตัดสิน "ผิดปกติหรือไม่" อยู่ใน predicate
  ที่ service export หรือ flag ที่ service คำนวณมาแล้ว. cron ทำแค่ประกอบข้อความ ⇒ ยอดใน
  กล่อง Todo กับบนแท็บ UI มาจากก้อนเดียวกันเสมอ.
- **ไม่ throw ออกจาก tick** — DB/service ล่มทั้งก้อน = Sentry + log แล้วจบรอบ (scheduler
  ต้องไม่ตาย; เดือนหน้าลองใหม่เอง และมนุษย์เปิดแท็บดูเองได้ทุกเมื่อ).

### `approveBatch` = Serializable (Phase 4 — ปิด carry d ที่ต้นเหตุ)

`settleRecallCash` เป็น Serializable มาตั้งแต่ Phase 3 แต่ **SSI ต้องการให้ทั้งคู่เป็น
Serializable จึงจะเห็นกัน** — writer ใต้ READ COMMITTED ไม่ลงทะเบียน rw-conflict กับ SIRead
lock ของใครเลย ⇒ ฝ่ายเดียวไม่มีผล. หน้าต่างที่ guard ปิดไม่ได้: คำขอรับเงินสดคืนเปิด tx ไว้
**ก่อน** รอบจ่ายถูกสร้าง (ยังไม่มี item ให้ guard "RECALL item ใน batch เปิด" เห็น) แล้ว
รอบจ่ายถูกสร้าง+ส่ง+อนุมัติจนจบในหน้าต่างนั้น — สองฝั่งอ่านยอดเรียกคืน net ก้อนเดียวกันแล้ว
หักคนละครั้ง ⇒ 11-2107 ติดลบ. ต้นทุนแทบเป็นศูนย์ (อนุมัติรอบจ่ายเป็นงานมือไม่กี่ครั้งต่อ
สัปดาห์) และด่านอื่นทั้งหมด (status guard / clash re-check / drift guard / period guard /
DB idempotency index) ยังทำงานเหมือนเดิมทุกประการ — ชั้นนี้เป็นตาข่ายสุดท้าย.

ผู้แพ้ race (Postgres `40001` → Prisma **`P2034`**) → **409 ไทย** พร้อม log warn + **Sentry
warning ที่ยิงเอง** (`SentryExceptionFilter` จับเฉพาะ status ≥ 500 — 409 ใบนี้จะมองไม่เห็น
จาก monitoring ถ้าไม่ยิง; จำเป็นเป็นพิเศษกับ Serializable ที่เพิ่งเปิดใช้ เพราะ spike ของ
P2034 = lock contention จริงที่ต้องรู้ก่อนจะกวนงานอนุมัติของผู้ใช้ — pattern เดียวกับ
`shop-collect-settlement.template.ts`). tx ทั้งก้อน roll back ⇒ ไม่มีทางอนุมัติซ้ำสองรอบ.

**ผลข้างเคียงที่ต้องเฝ้า — SIRead lock ของ `approveBatch` กว้างกว่าที่คิด:** drift guard
(ขั้นตอน 3) ยิง GL aggregate **6 ครั้งต่อแถว SETTLEMENT** (21-1101 / 21-1102 / S11-3001 /
S11-3002 / typed swap สองสมุด) และ 2 ครั้งต่อแถว RECALL บวก Σ deduction ⇒ **รอบ 20 สัญญา ≈
120-150 filtered scan บน `journal_lines` ภายใน tx เดียว**. ใต้ Serializable ทุก scan ทิ้ง
SIRead lock ไว้ และ Postgres **escalate page → relation** เมื่อ lock ต่อ tx เยอะเกิน
(`max_pred_locks_per_*`) ⇒ ช่วงที่ผู้อนุมัติกดปุ่ม writer Serializable **ตัวอื่น** ที่แตะ
`journal_lines` กลายเป็นคู่ conflict ได้ทั้งที่ทำงานคนละสัญญากันเลย. ตัวที่เข้าข่าย (เป็น
Serializable อยู่แล้วทั้งหมด): `payment-receipt-orchestrator.ts` ·
`installment-accrual-2a.template.ts` (cron 00:01) · `repossessions.service.ts` ·
`reschedule-collect.service.ts` · `paysolutions-webhook.service.ts` — และ **ไม่มีตัวไหนแปลง
`P2034` เลย** (ตรวจแล้ว 2026-08-21: P2034 translation มีเฉพาะ interco / shop-collect /
refund / sale-writer / po-receiving / reservation-preempt) ⇒ ผู้แพ้ฝั่งนั้นได้ **raw 500**
ไม่ใช่ข้อความไทย และผู้ใช้จะเห็นเป็น "บันทึกชำระไม่ผ่าน" ลอย ๆ.

**อัปเดต 2026-09-29 — การรับสินค้าเข้าเป็นคู่ conflict ตัวใหม่:** `po-receiving.service.ts` เป็น
Serializable มาก่อนแล้ว แต่ตั้งแต่ลงบัญชีตอนรับของ มัน **อ่านและเขียน `journal_entries`** ด้วย
(ตัวตรวจ idempotency กรองด้วย JSON path ⇒ heap scan · `nextEntryNumber` อ่านเลขล่าสุดของเดือน)
และใบรับของใบใหญ่ถือ tx นานกว่ารายการอื่น. ตัวรับของเอง retry P2002/P2034 ได้ 3 รอบ แต่ writer
ฝั่งรับชำระที่แพ้ให้มันยังได้ raw 500 เหมือนเดิม. **ยังไม่ได้วัดด้วยเทสสองคอนเนกชัน** — ถ้าเห็น 500
ที่เส้นทางรับชำระตรงกับเวลาที่หน้าร้านรับของ ให้สงสัยคู่นี้ก่อน.

สัญญาณที่ต้องเฝ้า: **spike ของ Sentry `[interco] P2034 write-conflict translated to 409`** —
ถ้าขึ้นบ่อยแปลว่า lock contention จริงเกิดแล้ว และ**ถึงเวลาต้องเติม P2034 translation ที่
เส้นทางรับชำระ** (รายการ Phase 5). ทางลดแรงกดที่ทำได้โดยไม่ลด isolation: อนุมัติรอบใหญ่ ๆ
นอกเวลาที่ cron 2A ทำงาน หรือแบ่งรอบให้เล็กลง.

เส้นทางคู่ขนาน: **`approveCancellation` แปลง `P2002` เป็น 409 ไทย** — ผู้แพ้ของ
double-approve ที่อ่านสถานะ **ก่อน** คำขอแรก commit จะผ่าน guard "สัญญาต้อง ACTIVE" ที่อ่าน
ใน tx แล้วไปชน partial unique index `journal_entries_idempotency_idx` (flow +
idempotencyKey ของ mirror ใบเดียวกัน — sweep engine ตั้งคีย์ต่อ JE ต้นทาง) ⇒ เดิมหลุดออกไป
เป็น raw 500.

**อัปเดต Phase 5 (2026-08-22): `approveCancellation` เป็น Serializable แล้วด้วย** — มันคือ
คู่ conflict ตัวจริงของ `approveBatch` (ตัดสิน C-1/C-2 จาก `InterCoSettlementItem` ที่
approveBatch เขียน ส่วน approveBatch อ่าน GL 21-1101/21-1102/S11-3001/S11-3002 ที่การยกเลิก
เขียน ⇒ rw-conflict สองทิศ) และ **พิสูจน์แล้วว่าเคยสำเร็จพร้อมกันได้จริง** จนเจ้าหนี้ติดลบ
(เทสสองคอนเนกชันใน `contract-cancellation.integration.spec.ts`). ผู้แพ้ได้ **409 ไทย** +
Sentry `[cancellation] P2034 write-conflict translated to 409` — เฝ้าคู่กับตัว `[interco]`
ด้วยเกณฑ์เดียวกัน (สองสตริงนี้คือ trigger ชุดเดียวกันของงาน "เติม P2034 translation ที่
เส้นทางรับชำระ" — spike ของตัวใดตัวหนึ่งก็นับ).

**ขอบเขตของ SIRead lock ที่เพิ่มมา — filter ต่อสัญญา แต่ predicate ระดับ relation:** ตัวกรอง
เชิงตรรกะเป็นต่อสัญญาจริง (sweep candidates + `glContractBalance` ของสัญญาเดียว) **แต่ SIRead
lock เกิดตามสิ่งที่ scan จริง ไม่ใช่ตามเงื่อนไข WHERE**: ทั้งสอง query กรองด้วย
`journal_entries.metadata->>'contractId'` ซึ่ง **ไม่มี index (GIN หรืออื่นใด) บน `metadata`**
⇒ เป็น heap scan ที่ทิ้ง predicate lock กว้างบน `journal_entries`/`journal_lines` และ
**escalate page → relation** ได้ด้วยกลไกเดียวกับที่บันทึกไว้ให้ `approveBatch` ("ผลข้างเคียง
ที่ต้องเฝ้า" ท้ายไฟล์). คำตัดสิน "ยกเป็น Serializable" ยังถูก — แต่เหตุผลคือ **ความถี่**
(งานมืออนุมัติทีละใบ ไม่กี่ครั้ง/สัปดาห์) ไม่ใช่ "lock แคบ". อย่าอ่านหัวข้อนี้แล้วสรุปว่าการ
ยกเลิกสัญญาชนกับ writer อื่นไม่ได้: ระหว่างที่มันรัน `payment-receipt-orchestrator` /
`installment-accrual-2a` (cron 00:01) และเพื่อน Serializable ตัวอื่นเป็นผู้แพ้ race ได้จริง
และ **ยังไม่มีตัวไหนบนเส้นทางรับชำระแปลง P2034** ⇒ ผู้แพ้ฝั่งนั้นได้ raw 500.

### Trial balance — ไม่ต้องแก้ (ยืนยันตาม spec §6 ข้อ 4)

`S21-1104` เข้ารายงานเองผ่าน prefix `S21` ที่มีอยู่แล้วใน `SECTION_MAP`
(`apps/api/src/modules/accounting/accounting-section-map.util.ts` — `'S21'` =
`'หนี้สินหมุนเวียน (SHOP)'`). ไม่มีการแก้โค้ดรายงานในเฟสนี้.

### Phase 5 (IMEI guards) อยู่คนละไฟล์

Phase 5 ของ workbook เดียวกัน (spec §7 — สถานะสินค้า/IMEI, guard การลบ, ปุ่มนำเข้าคลัง)
**ไม่แตะ GL และไม่เพิ่ม JE แม้แต่ใบเดียว** จึงไปอยู่ที่ **`.claude/rules/database.md`
หัวข้อ "สถานะสินค้า & IMEI (Phase 5)"** (partial unique index บน IMEI, `product-hold.util.ts`,
`product-enter-stock.util.ts`, `FOUND_POLICY`, state diagram + carries ที่เหลือ).
ส่วนที่ตกมาถึงไฟล์นี้มีสองข้อ: `approveCancellation` เป็น Serializable (ดูหัวข้อด้านบน)
และ carry "P2034 ที่เส้นทางรับชำระ" ซึ่งยังรอ Sentry spike.

### CI

`deploy-gcp.yml` **ไม่ต้องแก้ glob**: `interco-aging.integration.spec.ts` อยู่ใต้
`src/modules/interco-settlement/__tests__/` จึงถูกครอบโดย `INTERCO_FILES` glob เดิม
(`ls src/modules/interco-settlement/__tests__/*.integration.spec.ts`) และ step นั้นรันด้วย
`--no-file-parallelism` อยู่แล้ว. cron specs ทั้งสองไฟล์ (`shop-receivable-aging.cron.spec.ts`
/ `interco-reconcile.cron.spec.ts`) เป็น **jest mocked unit specs** ตามปกติ — jest
`testRegex` `.*\.spec\.ts$` จับให้เอง (ignore เฉพาะ `*.integration.spec.ts`) จึงรันใน step
"Test API" อยู่แล้วโดยไม่ต้องเพิ่มอะไร.
