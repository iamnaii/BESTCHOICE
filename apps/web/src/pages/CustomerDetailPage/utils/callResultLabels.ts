/** ป้ายผลการโทร — ตรงกับ CALL_RESULT_LABELS ของ apps/api/src/modules/overdue/timeline.service.ts */
export const CALL_RESULT_LABELS: Record<string, string> = {
  NO_ANSWER: 'ไม่รับสาย',
  ANSWERED: 'รับสาย',
  PROMISED: 'นัดชำระ',
  REFUSED: 'ปฏิเสธ',
  WRONG_NUMBER: 'เบอร์ผิด',
  OTHER: 'อื่น ๆ',
};
