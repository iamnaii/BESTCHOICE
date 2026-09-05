# ยึดเครื่อง — ราคาเดียว + ไม่มีเงินคืนส่วนต่าง — Design

**วันที่:** 2026-09-05 · **สถานะ:** เจ้าของอนุมัติในแชท ("ok" หลังยืนยันนโยบายไม่มีเงินคืน) · **branch:** `feat/stock-go-live-2026-09`
**ที่มา:** เจ้าของเห็น "ราคากลาง 13,520" โผล่บนหน้ายึดทั้งที่ยังไม่กรอก (= `product.costPrice` fallback)
→ ถามว่าราคาประเมินกับราคากลางต่างกันไหม → scrutinize พบว่าโมเดล "สองราคา" มีเหตุผลเฉพาะเมื่อมี
เงินคืนลูกค้า → เจ้าของยืนยันว่า**ไม่มีเงินคืนส่วนต่าง** ⇒ ยุบเป็นราคาเดียว

## คำตัดสิน

| # | เดิม (2026-07-09 / 2026-08-08) | ใหม่ (2026-09-05) |
|---|---|---|
| เงินคืนส่วนต่างลูกค้า | ติ๊กได้ → Cr 21-1107 = ราคากลาง − ยอดปิด | **ไม่มี** — UI ถอดติ๊ก, `create()` ปฏิเสธ `customerRefundEnabled=true`, preview คืน 0 เสมอ |
| ราคากลาง | ช่องกรอกแยก (เว้นว่าง = ราคาประเมิน; preview ถอยไป costPrice) | **ถอดจากหน้าจอ** — ตารางรับซื้อเป็นตัวอ้างอิงใต้ช่องราคาประเมิน |
| ราคาประเมิน | กรอกเอง | **ค่าตั้งต้นจากตารางรับซื้อตามเกรด** แก้ทับได้; ต่างเกิน ±15% ต้องมีเหตุผลในหมายเหตุ (UI + server) |
| กำไร/ขาดทุนบนจอ | ราคากลาง − ยอดปิด − เงินคืน (= 0 เมื่อคืนเงิน) | ราคาประเมิน − ยอดปิด |
| `Repossession.marketValue` | ราคากลางที่ใช้คิด (ไม่มีผู้อ่าน) | snapshot ราคาตารางรับซื้อ ณ วันยึด (ไม่มี = ราคาประเมิน) |

กฎหมาย: ปพพ. ม.574 ผู้ให้เช่าซื้อริบเงินที่ชำระแล้วและเอาของคืนได้ ไม่บังคับคืนส่วนต่าง ⇒ เป็นนโยบายเจ้าของ

## ขอบเขต

**ทำ:** `previewCalculation` (refund=0, valuation lookup, ไม่ถอย costPrice) · `create()` (ปฏิเสธ refund, ด่าน ±15%,
snapshot) · overlay (ช่องเดียว, hint ตาราง, ด่านเหตุผล) · เทสต์ทั้งสองฝั่ง · accounting.md

**ไม่ทำ:** ลบ 21-1107 / RefundPayout / RefundWaive / endpoints (คงไว้เพื่อแถวเก่า) · migration คอลัมน์ ·
แสดง snapshot ราคาตารางบนหน้ารายการยึด (รอบถัดไป) · ส่วนลดยอดปิดในสมุด (CPA 2026-08-08 ข้อ 1)

## เทสต์

- API `repossessions.service.spec.ts`: refund flag → 400 · ต่างเกิน 15% ไม่มี notes → 400 · มี notes → `marketValue` = ราคาตาราง, `profitLoss` = ราคาประเมิน − ยอดปิด · ไม่มีในตาราง → `marketValue` = ราคาประเมิน · preview ไม่ถอย costPrice
- Web `RepossessionOverlay.valuation.test.tsx`: เติมค่าตั้งต้น · ไม่พบล้างค่า + "—" · ไม่ทับค่าที่พิมพ์ · ด่าน ±15% ปิดปุ่มจนกว่าจะมีหมายเหตุ · ไม่มีช่องราคากลาง/ติ๊กคืนเงิน

## ภาคผนวก — 5 ข้อต่อเนื่อง (เจ้าของสั่ง "ทำต่อทั้ง 5 ข้อ" 2026-09-05)

| # | เรื่อง | ทำอะไร |
|---|---|---|
| 1 | ขาคู่ SHOP ตอนยึด | `ShopCollectShopLegs.postRepossessionIntake` ใน tx ของ JP5 (`Dr S11-2002 / Cr S21-1104` หรือ `Cr S11-1202`) + `postSettlement` ใน `shopCollectSettlement` เมื่อ S21-1104 SHOP_COLLECT คุ้มยอด (ไม่งั้น skip + flag) · เลนส์ S21-1104 (aging Query B / drift / typed-balance) รู้จัก SHOP_COLLECT · `ownedByCompanyId` → SHOP + `category` → PHONE_USED · JP4 ยังไม่ต่อ |
| 2 | ขายต่อเครื่องยึด | POS ทางเดียว: `closeRepossessionOnSale` (ขายสด/ไฟแนนซ์ภายนอก) ปิดแถวเป็น SOLD + ราคาขายจริง; void เปิดกลับ; ถอด "จัดการ→ขายแล้ว" ทั้ง UI/API |
| 3 | ปุ่ม "คืนเครื่อง" ในวิซาร์ด | preview คืน `eligibility` (สถานะ + strict mode) → overlay แบนเนอร์ + ปิดปุ่มยืนยัน |
| 4 | ปุ่ม "รับโอนหน้าร้าน" | `findAll` คืน `shopCollectOutstanding` → โชว์เฉพาะแถวที่มียอด + เติมยอด |
| 5 | ส่วนลดยอดปิดในสมุด | CPA-gated — ถามซ้ำที่ `docs/accounting/cpa-followup-2026-09-05.txt` |

เทสต์เพิ่ม: `shop-collect-shop-legs.template.spec.ts` (5) · repossessions spec +6 (intake legs, ownership,
period ทั้งสองบริษัท, eligibility ×2, SOLD ด้วยมือถูกปฏิเสธ) · web `RepossessionsPage.settlement-button.test.tsx` (3)
+ overlay eligibility (1) · integration: settlement / aging / sale-void / product-lifecycle รันบน DB local
