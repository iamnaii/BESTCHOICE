import { GoneException } from '@nestjs/common';

/**
 * คำตัดสินเจ้าของ 2026-10-06 — "ลูกค้าต้องปิดยอดก่อนถึงจะทำสัญญาผ่อนใหม่ได้" ⇒ **ปิดเมนูเปลี่ยนเครื่อง
 * (device swap — คำขอ `ContractExchangeRequest` ทั้ง PRICED และ MEMO) ทั้งหมด** ไม่มีการเปลี่ยนรุ่น/เปลี่ยน
 * เครื่องกลางสัญญาอีกต่อไป. เปลี่ยนเครื่องตำหนิภายใน 7 วัน (`SAME_MODEL_EXCHANGE` — `DefectExchangeService`)
 * เป็นคนละเรื่อง ไม่ถูกปิด.
 *
 * สิ่งที่ปิด (410 Gone — ไม่ใช่ 404 เงียบ ให้ไคลเอนต์เก่า/ลิงก์ค้างได้ข้อความชี้ทาง):
 *  - `AfterSalesCaseService.createCase` outcome `PRICED_EXCHANGE` (ก่อนแตะ storage/lookup/tx)
 *  - `AfterSalesExchangeService.approvePriced` / `preview`
 *  - `ContractExchangeController` submit / preview / approve (`/insurance/exchange-requests`)
 *  - `computeOutcomes` คืน `PRICED_EXCHANGE` เป็น enabled:false พร้อม `DEVICE_SWAP_CLOSED_REASON` (จอแสดงเหตุผลใต้ปุ่ม)
 * สิ่งที่ยังเปิด (สำหรับคำขอที่ค้างอยู่ก่อนปิดเมนู): ปฏิเสธ (`rejectPriced` / `reject`) · ยกเลิก swap ที่ลงผลแล้ว
 * (`cancelSwap` / `cancel`) · `finalizeAfterActivation` ของสัญญาใหม่ที่อนุมัติไว้ก่อน · รายการ pending/recent.
 * engine `ContractExchangeService.submit/buildPreview/approve` ไม่มีผู้เรียกใน production อีกต่อไป (คง
 * integration spec ของกติกาบัญชี A.1–A.5 ไว้).
 */
export const DEVICE_SWAP_CLOSED_REASON =
  'ปิดใช้ตามนโยบาย — ลูกค้าต้องปิดยอดสัญญาเดิมก่อนจึงทำสัญญาผ่อนใหม่ได้';

export const DEVICE_SWAP_CLOSED_MESSAGE =
  `เมนูเปลี่ยนเครื่องแบบมีราคาปิดใช้แล้ว (คำตัดสินเจ้าของ 06/10/2569): ${DEVICE_SWAP_CLOSED_REASON} · ` +
  'ให้ลูกค้าปิดยอดสัญญาเดิมที่หน้าสัญญา (ปุ่ม "ปิดยอดก่อนกำหนด") แล้วเปิดสัญญาผ่อนใหม่ · ' +
  'คำขอที่ค้างรออนุมัติ: เจ้าของกด "ปฏิเสธ" เพื่อปิดเคส';

export function deviceSwapClosed(): GoneException {
  return new GoneException(DEVICE_SWAP_CLOSED_MESSAGE);
}
