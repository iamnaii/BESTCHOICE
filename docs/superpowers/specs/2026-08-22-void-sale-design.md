# ยกเลิกใบขาย (Void Sale) — Design

**วันที่:** 2026-08-22 · **สถานะ:** approved (เจ้าของอนุมัติดีไซน์ 2026-08-22)
**ที่มา:** final review ของ Phase 5 (device-swap workbook sprint) พบว่าหลังปิดช่อง `FOUND` แล้ว
**ระบบไม่เหลือทางใดเลย**ที่จะแก้ "บันทึกขายผิด" — `SalesService` มีแค่ `findAll`/`findOne`/`create`
(controller ไม่มี `@Patch`/`@Delete`) และ `SOLD_*` อยู่ใน `SYSTEM_MANAGED_STATUSES` จึงแก้สถานะ
สินค้าด้วยมือไม่ได้ด้วย

> **หมายเหตุการกลับคำตัดสิน:** 2026-08-22 เจ้าของเคยตอบ "ยอมรับช่องว่างไว้ก่อน" แล้วเปลี่ยนเป็น
> "ทำให้ถูกเลยก็ได้" ในวันเดียวกัน ⇒ เอกสารนี้แทนที่ย่อหน้า "คำตัดสินเจ้าของ 2026-08-22" ใน
> `.claude/rules/database.md` หัวข้อ "บันทึกขายผิด" (ต้องอัปเดตย่อหน้านั้นตอน implement)

---

## 0. คำตัดสินเจ้าของ (ปิดประเด็น — อย่าเสนอซ้ำ)

| # | คำถาม | คำตัดสิน |
|---|---|---|
| D1 | ครอบการขายแบบไหน | **`CASH` + `EXTERNAL_FINANCE`** — `INSTALLMENT` ใช้เส้นทางยกเลิกสัญญาเดิม (Phase 3 C-1/C-2) |
| D2 | เงื่อนไขห้ามยกเลิก | **บล็อกเมื่อเงินขยับจริง** ไม่จำกัดจำนวนวัน (หลักเดียวกับยกเลิกสัญญาที่ดูว่าจ่ายมาหรือยัง ไม่ดูวัน) |
| D3 | สิทธิ์ / การอนุมัติ | **ขั้นเดียว `OWNER` + `BRANCH_MANAGER`** ไม่มี maker-checker ซ้อน (บรรทัดฐานเดียวกับที่เจ้าของสั่งปิด `interco_maker_checker_enabled` — "กิจการเล็ก คุมด้วยการกำหนดสิทธิ") |

---

## 1. ขอบเขต

### อยู่ในขอบเขต
- `Sale.saleType = 'CASH'` — มี JE ฝั่ง SHOP จริง (`ShopCashSaleTemplate` ต่อเข้า
  `sale-writer.service.ts` ตั้งแต่ **2026-06-23** commit `3a3fb03c2` / PR #1285 — **หมายเหตุใน
  `.claude/CLAUDE.md` ที่ว่า template นี้ "ZERO production callers" ล้าสมัยตั้งแต่วันนั้น
  ต้องแก้ตอน implement**) · สร้าง `SalesCommission` สถานะ `PENDING` ด้วย
- `Sale.saleType = 'EXTERNAL_FINANCE'` — **ไม่มี JE** (มีแต่ `TODO: perpetual inventory` ค้างไว้
  ในโค้ด) และ **ไม่สร้างค่าคอม** (ตรวจแล้ว `sale-writer.service.ts:468-532` ไม่มี
  `salesCommission.create` — ต่างจาก CASH และ INSTALLMENT) แต่มี `FinanceReceivable`

### นอกขอบเขต (พร้อมเหตุผล)
| สิ่งที่ไม่ทำ | เหตุผล |
|---|---|
| `Sale.saleType = 'INSTALLMENT'` | มีเส้นทางยกเลิกสัญญาอยู่แล้ว (`ContractCancellationService`, Phase 3) ซึ่งคืนเครื่องเข้าสต็อก + กวาด JE + ปลด ECL ให้ครบอยู่แล้ว การทำซ้อนจะเป็นกติกาชุดที่สอง |
| ขายเครื่องยึด (`SOLD_RESELL`) | ไม่มีแถว `Sale` เลย — สถานะถูกตั้งโดย `repossessions.service.ts` `updateStatus` (`SOLD` → product `SOLD_RESELL`) ⇒ ถ้าคีย์ผิดต้องแก้ที่หน้ายึดเครื่อง เป็นงานคนละใบ |
| แก้ไขใบขายในที่ (edit) | เลือก **void + คีย์ใหม่** แทน: การแก้ราคา/สินค้าในที่ต้องกลับ JE เดิมแล้วโพสต์ใหม่อยู่ดี = ความซับซ้อนเท่ากันแต่มีทางพลาดมากกว่า และไม่เหลือหลักฐานว่าคีย์ผิดอะไรไว้ |
| คืนคิวจองบนเว็บที่ถูกตัดตอนขาย | `preemptReservationsInTx` ตัด hold ของลูกค้ารายอื่นไปแล้วตอนขาย — คืนไม่ได้จริง (ลูกค้าอาจไปซื้อที่อื่นแล้ว/ได้รับแจ้งไปแล้ว) **บันทึกเป็นข้อจำกัดที่ยอมรับ** ไม่ใช่บั๊ก |

---

## 2. เงื่อนไขห้ามยกเลิก (guards)

ทุกข้ออ่าน **ในทรานแซกชัน** ก่อนแตะ state ใด ๆ และให้ข้อความไทยที่**ชี้ทางออกที่ทำได้จริง**
(บทเรียน Phase 5: finding "ชี้ทางที่ไม่มีจริง" ซ้ำ 3 รอบ — ต้องเปิดโค้ดหน้าจอปลายทาง + `@Roles`
ก่อนเขียนข้อความ)

| # | เงื่อนไข | เหตุผล | ทางออกที่บอกผู้ใช้ |
|---|---|---|---|
| G1 | ใบขายถูกยกเลิกไปแล้ว (`deletedAt != null`) | idempotency | บอกว่ายกเลิกไปแล้วเมื่อไร โดยใคร |
| G2 | งวดบัญชีของวันที่จะโพสต์กลับรายการปิดแล้ว (เฉพาะใบที่มี JE) | โพสต์เข้าเดือนปิดไม่ได้ | ให้บัญชีเปิดงวดผ่านเส้นทาง `PERIOD_REOPENED` เดิม |
| G3 | ไฟแนนซ์ภายนอกโอนเงินมาแล้ว — `FinanceReceivable.receivedAmount > 0` **หรือ** `status != PENDING` | เงินเข้าจริงแล้ว ต้องคืนก่อน | ให้บันทึกคืนเงิน/ปรับรายการรับจากไฟแนนซ์ก่อน |
| G4 | ค่าคอมจ่ายออกไปแล้ว (`SalesCommission.status = 'PAID'`) | เงินออกจริง | ให้เรียกคืนจากพนักงาน/ปรับงวดค่าคอมก่อน |
| G5 | สินค้าถูกผูกไปที่อื่นแล้ว — reuse `assertProductNotHeld` (Phase 5) ด้วย action ใหม่ · **ตรวจทั้งสินค้าหลักและของแถมทุกชิ้น** ถ้าชิ้นใดชิ้นหนึ่งไม่ผ่าน = ยกเลิกทั้งใบไม่ได้ | เครื่องอาจถูกขายต่อ/จอง/เข้าสัญญาใหม่ไปแล้ว | ระบุ**ชื่อสินค้าและสถานะปัจจุบัน**ของชิ้นที่ติด + flow ที่ถูกต้อง |
| G6 | ใบขายมาจากออเดอร์ออนไลน์ (`Sale.onlineOrderId != null`) | สถานะสองฝั่งจะเพี้ยน (order ยัง `PAID`/`DELIVERED` แต่ใบขายหาย) | ให้จัดการที่เมนูออเดอร์ออนไลน์ |
| G7 | มีใบซ่อม/เคลมประกันอ้างอิงใบขายนี้ | ประกันอิงใบขาย (`repair-warranty.service.ts` อ่าน `Sale`) — ยกเลิกแล้วเคลมจะลอย | ให้ปิด/ยกเลิกใบซ่อมก่อน |

**G5 — action ใหม่บน helper เดิม:** `assertProductNotHeld` (`product-hold.util.ts`) มี 3 action
แล้ว (`DELETE` / `CHANGE_IDENTITY` / `RESTORE_TO_CONTRACT`) — เพิ่ม **`RESTORE_TO_STOCK`**
โดยสถานะที่ยอมให้ผ่านคือสถานะที่ **ใบขายนี้เป็นคนตั้งเอง** (`SOLD_CASH` สำหรับ CASH,
`SOLD_INSTALLMENT` สำหรับ EXTERNAL_FINANCE) — สถานะอื่นทั้งหมดแปลว่ามีคนอื่นมาผูกต่อไปแล้ว
**ห้ามเขียน guard ชุดที่สอง**

---

## 3. สิ่งที่กลับรายการ

ทั้งหมดอยู่ใน `$transaction` เดียว `isolationLevel: 'Serializable'` (เท่ากับตอนสร้างการขาย —
`sale-writer.service.ts` ใช้ Serializable อยู่แล้ว) และ **P2034 → 409 ไทย** ตาม pattern
`approveBatch`/`approveCancellation` (log warn + `Sentry.captureMessage` level warning เอง เพราะ
`SentryExceptionFilter` จับเฉพาะ ≥500)

| ลำดับ | สิ่งที่ทำ | หมายเหตุ |
|---|---|---|
| 1 | สินค้าหลัก + ของแถม (`bundleProductIds`) → **`IN_STOCK`** | ตอนขาย `verifyProductInStock`/`markBundleProductsSold` บังคับว่าต้องเป็น `IN_STOCK` มาก่อน ⇒ คืนที่เดิมถูกต้องตามนิยาม **ไม่ต้องยืนยันราคาใหม่** (ไม่มี flow ไหนแตะราคาระหว่างขาย) |
| 2 | กลับรายการ JE ทุกใบที่ `metadata.saleId = <saleId>` (CASH เท่านั้น) | JE ประทับ `flow: 'shop-cash-sale'`, `tag: 'SHOP_CASH_SALE'`, `saleId` ไว้แล้ว · mirror สลับ Dr/Cr ลงวันที่ **วันที่ยกเลิก** · `metadata.flow = 'shop-cash-sale-void'`, `idempotencyKey = 'shop-cash-sale-void:<jeId>'` (**แก้ 2026-08-22 จากเดิมที่เขียน `sale-void:` ไว้**: sweep engine ผูก prefix กับ `flowLabel` และ unique index `journal_entries_idempotency_idx` scope ด้วย `flow` อยู่แล้ว ⇒ unique ต่อ JE ต้นทางและชนกับ flow อื่นไม่ได้โดยโครงสร้าง — การเพิ่ม option แค่ให้สตริงสวยคือการขยาย API บนเส้นทางเงินโดยไม่จำเป็น), `reversesEntryId` · ใบเดิมคง `POSTED` + ประทับ `reversed: true` (pattern เดียวกับ `reverseBatch`/`ExchangeCancelReversalTemplate`) |
| 3 | `FinanceReceivable` ของใบนี้ → soft delete | เฉพาะ EXTERNAL_FINANCE · G3 การันตีแล้วว่ายังไม่มีเงินเข้า |
| 4 | `SalesCommission` → `CLAWED_BACK` | **เฉพาะ CASH** (EXTERNAL_FINANCE ไม่สร้างค่าคอมตั้งแต่แรก) · ครอบทั้ง `PENDING` และ `APPROVED` (G4 บล็อกเฉพาะ `PAID` ⇒ สองสถานะนี้เข้ามาถึงขั้นนี้ได้) · สถานะมีอยู่แล้วใน enum ไม่ต้องเพิ่ม |
| 5 | `Sale` → `deletedAt = now()`, `voidReason`, `voidedById` | ดูข้อ 4 เรื่องทำไมใช้ `deletedAt` |
| 6 | `AuditLog { action: 'SALE_VOIDED', entity: 'sale' }` | `newValue` เก็บ saleNumber, saleType, netAmount, reason, productIds, reversalEntryNumbers, commissionIds |

**ป้องกันข้อมูลเพี้ยน:** ถ้าใบขาย `CASH`/`EXTERNAL_FINANCE` ดันมี `contractId` ผูกอยู่ (ไม่ควร
เกิด — เป็นของ `INSTALLMENT` เท่านั้น) ให้ **ปฏิเสธพร้อมข้อความว่าข้อมูลผิดปกติ** ไม่ใช่เดินต่อ
แล้วทิ้งสัญญาลอย

**Audit เขียนแบบไหน:** ใช้ `tx.auditLog.create` ในทรานแซกชันเดียวกัน (atomic กับการคืนสถานะ
สินค้า) ตามกติกาที่ Phase 5 เขียนไว้ใน `.claude/rules/database.md` — **ห้ามเรียก
`AuditService.log` ในทรานแซกชัน** เด็ดขาด (เปิด root `$transaction` ซ้อน → P2028 ถูกกลืน →
audit หายเงียบ ซึ่ง Phase 5 เพิ่งพิสูจน์ว่าเกิดจริง 100%)

---

## 4. ทำให้ใบที่ยกเลิกหายจากรายงานอย่างถูกต้อง

**ใช้ `Sale.deletedAt`** (มีคอลัมน์ + `@@index([deletedAt])` อยู่แล้ว) เพราะผู้อ่าน 10 จุดกรอง
`deletedAt: null` อยู่แล้ว ⇒ ยอดขาย/สรุปรายวัน/กำไรขาดทุน/ประกัน/สิทธิ์รีวิว หักใบที่ยกเลิก
ออกให้เองโดยไม่ต้องเดินแก้ทีละที่

**แต่มีผู้อ่าน 8 จุดที่ยังไม่กรอง — ต้องไล่ตรวจและเติมให้ครบเป็นส่วนหนึ่งของงานนี้**
(สำรวจ 2026-08-22; หน้าต่างตรวจ 6 บรรทัด อาจมี false positive ที่ `where` อยู่ไกลกว่านั้น —
ตอน implement ต้องเปิดดูทีละจุด):

| ไฟล์:บรรทัด | ต้องกรองไหม |
|---|---|
| `accounting/transactional-report.service.ts:400` | **ต้องกรอง** — รายงานบัญชี |
| `sales/services/sales-query.service.ts:63, 76, 77, 81, 139, 194` | **ต้องกรอง** — รายการขาย/สรุปรายวัน/สินค้าขายดี (ยกเว้นจุดที่ตั้งใจให้เห็นใบยกเลิกผ่าน flag `includeVoided`) |
| `utils/sequence.util.ts:45` | **ห้ามกรอง** — สร้างเลขที่ใบขาย ต้องนับใบที่ยกเลิกด้วย ไม่งั้นเลขซ้ำ |

**หน้าประวัติการขาย** มีสวิตช์ "แสดงใบที่ยกเลิกแล้ว" (ส่ง `includeVoided=true`) เพื่อตรวจย้อนหลัง
— ใบที่ยกเลิกแสดงป้ายชัดเจน + เหตุผล + คนกด + เวลา

---

## 5. โครงสร้างโค้ด

```
apps/api/src/modules/sales/
  services/
    sale-void.service.ts        ← ใหม่ (guards + reversal ใน tx เดียว)
  dto/void-sale.dto.ts          ← ใหม่ ({ reason: string, min 10 })
  sales.controller.ts           ← + POST /sales/:id/void  (@Roles OWNER, BRANCH_MANAGER)
apps/api/src/modules/products/
  product-hold.util.ts          ← + action 'RESTORE_TO_STOCK' (ไม่สร้าง helper ใหม่)
apps/web/src/pages/
  SalesHistoryPage.tsx          ← + ปุ่ม/ไดอะล็อก/สวิตช์แสดงใบที่ยกเลิก
```

`sale-void.service.ts` แยกจาก `sale-writer.service.ts` เพราะคนละความรับผิดชอบ (writer =
สร้าง 3 แบบ, void = กลับรายการ) และไฟล์ writer ใหญ่อยู่แล้ว (~530 บรรทัด)

**Migration:** additive 2 คอลัมน์บน `sales` — `void_reason TEXT NULL`,
`voided_by_id UUID NULL` (FK → `users`, `onDelete: Restrict` ตามกติกาหลักฐานทางการเงิน)
เวลาที่ยกเลิก = `deletedAt` ที่มีอยู่แล้ว ไม่เพิ่มคอลัมน์ซ้ำ

---

## 6. การทดสอบ

**Unit (jest)** — guard ทุกข้อ G1-G7 มีเทสของตัวเอง + เทสว่าไม่มีการเขียน DB เมื่อ guard ตก

**Integration (vitest, DB จริง, `--no-file-parallelism`)** — ไฟล์ใหม่
`apps/api/src/modules/sales/__tests__/sale-void.integration.spec.ts` (prefix `VOIDTEST-`):

1. ขายสด (มีของแถม) → ยกเลิก → สินค้าหลัก **และ** ของแถมกลับเป็น `IN_STOCK` · JE ของใบนั้น
   **สุทธิเป็นศูนย์ทุกบัญชี** · ค่าคอม `CLAWED_BACK` · `Sale.deletedAt` ตั้ง · ขายเครื่องเดิมใหม่ได้
2. ขายผ่านไฟแนนซ์ภายนอก → ยกเลิก → `FinanceReceivable` หาย · ไม่มี JE ให้กลับรายการ (ยืนยันว่า
   ไม่ throw)
3. G3: ไฟแนนซ์โอนมาแล้ว → ปฏิเสธ · G4: ค่าคอมจ่ายแล้ว → ปฏิเสธ · G5: เครื่องถูกขายต่อไปแล้ว →
   ปฏิเสธ (ทั้งสามเคสต้องพิสูจน์ว่า **ไม่มีอะไรถูกเขียน**)
4. ยกเลิกซ้ำ (G1) → ปฏิเสธ ไม่สร้าง JE ใบที่สอง
5. **CI glob:** ต้องตรวจว่า `.github/workflows/deploy-gcp.yml` ครอบ
   `src/modules/sales/__tests__/*.integration.spec.ts` — บทเรียน `jp5-vat-split`: glob
   ไม่ recurse เอง ไดเรกทอรีใหม่ต้องเติม glob ใหม่เสมอ

**Web (vitest)** — ปุ่มเห็นเฉพาะ OWNER/BM · ไดอะล็อกบังคับเหตุผล ≥10 ตัวอักษร · สวิตช์แสดงใบที่
ยกเลิกส่ง query param ถูก

---

## 7. เอกสารที่ต้องอัปเดตตอน implement

1. `.claude/rules/database.md` — ย่อหน้า "คำตัดสินเจ้าของ 2026-08-22: ยอมรับช่องว่างไว้ก่อน"
   **ต้องเขียนใหม่** เป็น "ทำแล้ว ดู spec นี้" (เจ้าของกลับคำตัดสินในวันเดียวกัน)
2. `.claude/CLAUDE.md` — กล่อง "⚠ WIRING STATUS — DEFERRED" ที่อ้างว่า `ShopCashSaleTemplate`
   มี **ZERO production callers** ล้าสมัยแล้ว (`sale-writer.service.ts` เรียกจริงตั้งแต่เมื่อไร
   ต้องหาจาก git history ตอน implement) — แก้ให้ตรง ไม่งั้นคนอ่านจะสรุปผิดว่าการขายสดไม่ลง JE
3. `.claude/rules/accounting.md` — เพิ่ม `shop-cash-sale-void` เข้าตาราง flow ของ JE

---

## 8. สิ่งที่จงใจไม่ทำ (YAGNI)

- **ไม่มีใบลดหนี้** — SHOP ไม่จด VAT จึงไม่มีภาระ ม.86/10 (ต่างจากใบเสร็จฝั่ง FINANCE ที่ต้องมี
  ใบลดหนี้คู่เสมอ)
- **ไม่มีการคืนเงินเป็นรายการแยก** — การกลับรายการ JE พาเงินสดกลับออกจากบัญชีให้แล้ว การส่งเงิน
  คืนลูกค้าเป็นการกระทำจริงหน้าร้าน ไม่ต้องมีเอกสารที่สอง
- **ไม่มีสถานะ `VOIDED` บน `Sale`** — `deletedAt` + `voidReason` พอ และได้การกรองจากผู้อ่านเดิมฟรี
- **ไม่ยกเลิกบางส่วน** (เช่น ถอดของแถมชิ้นเดียว) — ยกเลิกทั้งใบแล้วคีย์ใหม่
