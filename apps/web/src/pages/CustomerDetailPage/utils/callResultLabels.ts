import { CALL_RESULTS } from '@/pages/CollectionsPage/components/CallResultChips';

/**
 * ป้ายผลการโทรชุดเดียวของหน้ารายละเอียดลูกค้า — `lastCall.result` มาจาก CallLog.result (สตริงอิสระ)
 * - ANSWERED / NO_ANSWER / PROMISED / REFUSED / WRONG_NUMBER / OTHER: ค่าที่ LogContactDto, CreateCallLogDto,
 *   การบันทึกนัดชำระ และ Yeastar เขียนลง `result` — ป้ายตรงกับ CALL_RESULT_LABELS ของ
 *   apps/api/src/modules/overdue/timeline.service.ts
 * - BUSY / DEVICE_OFF / UNREACHABLE: ค่าของ enum CallResult (คอลัมน์ callResult) — ป้ายอ่านจากชิปของหน้าติดตามหนี้
 *   (CallResultChips) ตัวเดียวกัน (ANSWERED/NO_ANSWER ในชิปก็ใช้คำเดียวกับข้างบน)
 */
export const CALL_RESULT_LABELS: Record<string, string> = {
  PROMISED: 'นัดชำระ',
  REFUSED: 'ปฏิเสธ',
  WRONG_NUMBER: 'เบอร์ผิด',
  OTHER: 'อื่น ๆ',
  ...Object.fromEntries(CALL_RESULTS.map((r) => [r.value, r.label])),
};

/** ค่าที่ไม่รู้จักแสดงเป็น "อื่น ๆ" — ไม่โชว์ enum ดิบให้พนักงานเห็น */
export function callResultLabel(result: string): string {
  return CALL_RESULT_LABELS[result] ?? CALL_RESULT_LABELS.OTHER;
}
