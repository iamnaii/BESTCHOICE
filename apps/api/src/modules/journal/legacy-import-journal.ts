/**
 * รูปของรายการบัญชีที่ตัวนำเข้าระบบเก่า (`cli/legacy-backoffice/writer.ts`) ลง — tag และ `reference` ของทั้งสามชนิด
 * (ชื่อ flow อยู่ที่ `accounting/peak-export-exclusion.ts`) · ผู้เขียน (ตัวนำเข้า) และผู้พิสูจน์สิทธิ์ดูรายการของสัญญา
 * (`employee-access/access-contract-journal-proof.ts`) ใช้ชุดเดียวกันนี้ ห้ามพิมพ์สตริงเอง
 *
 * `reference` เขียนลง `referenceId` คู่กับ `referenceType = 'AUTO'` (`JournalAutoService.createAndPost`) ⇒ unique ต่อสัญญา/งวด
 */

/** รายการยกมา — หนึ่งรายการต่อสัญญา ลงวันตัด */
export const LEGACY_OPENING_TAG = 'legacy-opening';
/** marker ยอดรับก่อนวันตัด — tag `2B` เพราะ `reconstructPriorCleared` นับยอดล้างของงวดจาก tag นี้ */
export const LEGACY_PRIOR_RECEIPT_TAG = '2B';
/** รายการไล่ VAT ของงวดค้างก่อนวันตัด (ลง 00:05 วันถัดจากวันตัด) */
export const LEGACY_VAT_CATCHUP_TAG = 'legacy-vat-catchup';

export const legacyOpeningReference = (legacyContractCode: string) =>
  `legacy-opening:${legacyContractCode}`;
export const legacyPriorReceiptReference = (installmentScheduleId: string) =>
  `legacy-prior:${installmentScheduleId}`;
export const legacyVatCatchUpReference = (legacyContractCode: string) =>
  `legacy-vat-catchup:${legacyContractCode}`;

/**
 * บัญชี "ย้ายจากระบบเก่า" — ตัวนำเข้าใช้เป็นผู้สร้างรายการบัญชี และเป็น `Payment.recordedById` ของงวดที่มียอดจ่ายก่อนวันตัด
 * (`writer.ts`) · ล็อกอินไม่ได้ · ซ่อนจากรายชื่อผู้ใช้ (`users.service.ts`) · ตรวจกลางคืนแยกงวดที่นำเข้าและยังไม่มีเส้นทาง
 * รับเงินใดแตะด้วยอีเมลนี้ (`data-audit/services/legacy-untouched-payment.ts`) ⇒ **ห้ามเปลี่ยนค่า ห้ามพิมพ์สำเนา**
 */
export const LEGACY_SYSTEM_USER_EMAIL = 'legacy-import@bestchoice.com';
