function toBkkCalendarDay(d: Date): number {
  const bkk = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate());
}

/**
 * PR 5 §3.4 — "ยังอยู่ในกรอบ" ตอนยืนยัน = วันขายถึงวันนี้ต่างกัน 0–6 วันปฏิทินไทย (= `daysRemainingIn7Day > 0`
 * ของ RepairWarrantyService — วันที่ 7 ป้ายยังขึ้น IN_7DAY_DEFECT แต่ปุ่มปิด; ขายสดไม่มี override)
 */
export function cashExchangeWindowOpen(soldAt: Date, now: Date = new Date()): boolean {
  const diff = (toBkkCalendarDay(now) - toBkkCalendarDay(soldAt)) / 86_400_000;
  return diff >= 0 && diff <= 6;
}
