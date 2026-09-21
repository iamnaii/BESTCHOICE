# ของแถมในสัญญาผ่อน + ปรับหน้า POS (2026-09-20)

Mockup ที่เจ้าของเคาะ: https://claude.ai/artifact/GW34MaRENebKFngkUiVzeN ("ok ตาม mock up เลย", 2026-09-20)

## ที่มา

เจ้าของถามว่า "ทำสัญญากับไฟแนนซ์ BESTCHOICE แล้วต้องมาตัดที่หน้า POS อีกไหม" — คำตอบคือ **ไม่ต้อง**
(`ContractWorkflowService.activate` ตัดสต๊อกเครื่องหลัก + สร้างใบขาย `INSTALLMENT` + ลง JE สองสมุดเอง)
แต่การตรวจพบ 3 เรื่องที่เจ้าของสั่งให้ปรับทั้งหมด:

1. **ของแถมที่ให้ไปกับสัญญาผ่อนไม่ถูกตัดสต๊อก** — หน้าสร้างสัญญาไม่มีช่องของแถม; `activate` อ่านของแถมจาก
   `Sale.bundleProductIds` แต่ใบขายที่มันสร้างเองมีค่า `[]` เสมอ ⇒ ขัดคำสั่งเจ้าของ 2026-08-26
   "ของแถมต้องตัดสต็อกทุกครั้ง" และ POS ก็บันทึกของแถมอย่างเดียวไม่ได้ (ต้องมีสินค้าหลัก + ราคา > 0)
2. **ปุ่ม "ผ่อนไฟแนนซ์" กำกวม** — หมายถึงไฟแนนซ์ภายนอก (GFIN) แต่ร้านเรียกผ่อนในเครือว่า "ไฟแนนซ์ BESTCHOICE"
3. **โค้ดขายผ่อนเก่าค้างใน POS** — สาขา `saleType === 'INSTALLMENT'` ที่หน้าจอเข้าไม่ถึง

## คำตัดสินเจ้าของ

| เรื่อง | คำตัดสิน |
|---|---|
| ของแถมเลือกจากอะไรได้ | **เฉพาะหมวดอุปกรณ์เสริม (`ACCESSORY`) ทั้งหน้าสัญญาและหน้า POS** — เดิม POS รับสินค้าพร้อมขายอะไรก็ได้ รวมมือถือทั้งเครื่องราคา 0 บาท |
| หน้าตา | ตาม mockup: ปุ่ม "ไฟแนนซ์นอก" + กล่องเขียวบอกว่าไม่ต้องบันทึก POS ซ้ำ · ช่องของแถมที่ขั้น 3 ของหน้าสร้างสัญญา · การ์ดของแถม 3 สถานะหน้ารายละเอียด |

## วงจรของแถม = เดินตามเครื่องหลัก

| จังหวะ | เครื่องหลัก | ของแถม | โค้ด |
|---|---|---|---|
| สร้างสัญญา (DRAFT) | `IN_STOCK → RESERVED` | `IN_STOCK → RESERVED` | `reserveContractBundles` ใน `ContractLifecycleService.create` |
| แก้ไขของแถม (DRAFT) | — | เพิ่ม = จอง · นำออก = ปล่อย | `updateBundles` — `PATCH /contracts/:id/bundles` |
| ลบร่าง | `RESERVED → IN_STOCK` | `RESERVED → IN_STOCK` | `releaseContractBundles` ใน `softDelete` |
| เปิดใช้ | `→ SOLD_INSTALLMENT` | `RESERVED → SOLD_CASH` + คัดลอกลง `Sale.bundleProductIds` | `sellContractBundles` ใน `activate` |
| ยกเลิกสัญญา (C-1/C-2) | `→ IN_STOCK` | `SOLD_CASH → IN_STOCK` | `restoreContractBundles` ใน `approveCancellation` |
| ยึดเครื่อง / เปลี่ยนเครื่อง | ตามเดิม | **ไม่แตะ** (อยู่กับลูกค้าแล้ว) | — |

ทั้งหมดอยู่ใน `apps/api/src/modules/contracts/services/contract-bundle.util.ts` — ไฟล์เดียว ห้ามเขียนชุดที่สอง.

**บัญชีไม่ต้องเพิ่มอะไร**: ขาต้นทุนของแถม (`ShopInventoryTransferTemplate.bundleCosts` — `Dr S50-xxxx / Cr S11-200x`)
มีอยู่แล้วและอ่านจาก `Sale.bundleProductIds`; อยู่ใน JE เดียวกับ COGS เครื่องหลักที่ stamp `metadata.contractId`
⇒ sweep ตอนยกเลิกสัญญากลับรายการให้เอง. งานนี้เพิ่มแค่ "ข้อมูลของแถมบนสัญญา" + "สถานะสินค้าให้ตรงกับสมุด".
พิสูจน์บน DB จริง: `contract-bundles.integration.spec.ts` (เปิดใช้ → `S11-2003` −200 · ยกเลิก → 0).

### คำตัดสินเชิงออกแบบ

- **เก็บที่ `Contract.bundleProductIds String[]`** (migration `20261003000000_contract_bundle_product_ids`, additive)
  ไม่ใช่สร้างใบขายตอนสร้างสัญญา — ร่างเป็นเจ้าของข้อมูลของตัวเอง ใบขายยังเกิดตอนเปิดใช้เหมือนเดิม
- **กติกา "อุปกรณ์เสริมเท่านั้น" มีแหล่งเดียว**: `sales/services/bundle-policy.ts` `assertBundleIsAccessory`
  ใช้ทั้ง POS (`markBundleProductsSold`) และสัญญา (`reserveContractBundles`). หน้าจอกรองด้วย `category=ACCESSORY`
  ด่านฝั่งเซิร์ฟเวอร์กันคนยิง API ตรง
- **แก้ของแถมได้จนกว่าจะเปิดใช้** (ทุก `workflowStatus` ของ DRAFT) — กว้างกว่า `update()` ที่ล็อกหลังส่งตรวจ โดยตั้งใจ:
  ของแถมราคา 0 บาทไม่กระทบยอด/ตารางผ่อน/ลายเซ็น และทางเลือกอื่นของคนที่ลืมใส่คือลบร่าง ซึ่ง (ก) ลบได้เฉพาะ OWNER
  (ข) สิทธิ์อนุมัติเครดิตที่ใช้ไปแล้วใช้ซ้ำไม่ได้. สิทธิ์: OWNER · BRANCH_MANAGER สาขาตัวเอง (fail-closed) · SALES เจ้าของสัญญา
  — บังคับใน service (route รูป `/:id` ไม่มี `branchId` ให้ BranchGuard ตรวจ)
- **ช่องของแถมอยู่ขั้น 3** ไม่ใช่ขั้นเลือกสินค้า — ขั้นเลือกสินค้าเป็นรายการยาว ช่องจะถูกดันจนมองไม่เห็น
- **ยกเลิกสัญญา: ชิ้นที่คืนไม่ได้ไม่บล็อกการยกเลิก** — บันทึก `bundlesNotRestored` ใน AuditLog แทน
  (ฝั่งเงินต้องเดินต่อได้). `cleanupCreditContractSale` เลิกบล็อกของแถมที่ "สัญญาเป็นเจ้าของ" (ผู้เรียกคืนเอง)
  แต่ยังบล็อกของแถมของใบขายจากเส้นทางเก่า (ไม่มีใครคืนสต๊อกให้)
- **POS ส่งต่อของแถมไปหน้าสัญญา** ผ่าน `?bundleProductIds=a,b` (ผ่านตัวกรอง `contractReturnUrl`);
  หน้าสัญญาโหลดสถานะสดแล้วรับเฉพาะอุปกรณ์เสริมที่ยัง `IN_STOCK`
- AuditLog ใหม่: `CONTRACT_BUNDLES_UPDATED` (entity `contract`, เขียนใน tx — atomic กับการ flip สถานะสินค้า)

## ที่ตั้งใจไม่ทำในงานนี้

- > **อัปเดต 2026-09-20 (หลังเอกสารนี้):** ลำดับข้างล่างเดินครบแล้ว — เจ้าของเคาะค่าคอม → ย้ายไป `activate` (PR #1612) →
  > `createInstallmentSale` ถูกลบ และ `POST /sales` ปฏิเสธ `INSTALLMENT`. ข้อความเดิมเก็บไว้เป็นที่มา.
- **ไม่ลบ `createInstallmentSale` (POST /sales INSTALLMENT)** แม้ไม่มีหน้าจอเรียกแล้ว: แผน
  `2026-09-11-sales-contracts.md` ตั้งใจเก็บไว้พร้อมเทสเทียบผล `it.each(['direct','pos'])`
  (`apps/api/e2e/credit-payment-flow.e2e-spec.ts`) และมันคือ **ที่เดียวที่สร้าง `SalesCommission` ให้สัญญาผ่อน** —
  เส้นทางสัญญาปัจจุบันไม่สร้างค่าคอมพนักงานเลย. ลำดับที่ถูก: เจ้าของเคาะกติกาค่าคอมสัญญาผ่อน → ย้ายไป `activate` →
  ค่อยลบเส้นทางเก่า. ฝั่งหน้าจอ POS เก็บโค้ดตายแล้ว (สาขา INSTALLMENT, `PosConfig`, query `/sales/config` ที่ไม่ได้ใช้)
- สัญญาที่เปิดใช้ไปแล้วก่อนงานนี้ไม่ย้อนใส่ของแถม (forward-only; ข้อมูลช่วงนี้ยังเป็นข้อมูลทดสอบ)
- ไม่พิมพ์รายการของแถมลงเอกสารสัญญา PDF
- พบแต่ไม่แก้: ยกเลิกสัญญาที่**ไม่ได้**ใช้เครดิตเทิร์น ใบขาย `INSTALLMENT` อัตโนมัติไม่ถูก soft-delete
  (`cleanupCreditContractSale` ทำเฉพาะสัญญาที่มีเครดิตเทิร์น) ⇒ ใบขายของสัญญาที่ยกเลิกแล้วยังอยู่ในประวัติการขาย

## เทส

- API unit: `contract-bundle.util.spec.ts` · `sale-writer.service.spec.ts` (b0)
- API DB จริง (vitest): `contracts/__tests__/contract-bundles.integration.spec.ts` · `sales/__tests__/sale-void.integration.spec.ts` (ของแถม = ACCESSORY)
- Web: `components/bundle/BundleSearch.test.tsx` · `components/contract/ContractBundlesCard.test.tsx` ·
  `POSPage.test.tsx` · `useContractCreateData.test.tsx` · `ContractSummaryPanel.test.tsx` · `lib/contract-return.test.ts`
- Playwright `e2e/sales-menu-regression.spec.ts` ปรับชื่อปุ่ม/ข้อความ (ยังไม่ได้รันในเครื่อง)
