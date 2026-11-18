import { toBangkokDateString } from '@/lib/date';

/**
 * กรองประวัติสินทรัพย์รายตัวตามช่วงวันที่ (ฝั่ง client) — `fromDate` / `toDate` เป็น 'YYYY-MM-DD' = วันตามปฏิทินไทย
 * เทียบกับวันไทยของ `createdAt` ตรง ๆ ไม่สร้าง Date จากสตริงวันที่ (ไม่ขึ้นกับ TZ ของเบราว์เซอร์)
 */
export function isAuditLogInDayRange(createdAt: string, fromDate: string, toDate: string): boolean {
  if (!fromDate && !toDate) return true;
  const day = toBangkokDateString(new Date(createdAt));
  if (fromDate && day < fromDate) return false;
  if (toDate && day > toDate) return false;
  return true;
}
