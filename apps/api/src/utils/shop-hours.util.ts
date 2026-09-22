/**
 * เวลาทำการหน้าร้าน (KB store_location_hours: เปิดทุกวัน 10:00-19:00) — แหล่งเดียวของบอทขาย
 * (บรรทัดเวลาร้านที่แนบให้โมเดล / ข้อความสำรอง) และตัวส่งข้อความ (ข้อความรอแอดมินตอนร้านปิด)
 * เวลาไทยเสมอ (UTC+7 ไม่มีเวลาออมแสง) ไม่ขึ้นกับ timezone ของเครื่องที่รัน
 */
export const SHOP_OPEN_HOUR = 10;
export const SHOP_CLOSE_HOUR = 19;

/**
 * "10 โมง" — คำเรียกเวลาร้านเปิดในประโยคถึงลูกค้า ("ทีมงานตอบช่วงร้านเปิด 10 โมงนะคะ")
 * ผูกกับ SHOP_OPEN_HOUR ⇒ ข้อความของบอท/ตัวส่งข้อความเปลี่ยนตามเวลาเปิดร้านที่เดียว
 */
export const SHOP_OPEN_LABEL_TH = `${SHOP_OPEN_HOUR} โมง`;

/** ชั่วโมง 0-23 ตามเวลาไทย */
export function bangkokHour(now: Date): number {
  return new Date(now.getTime() + 7 * 3_600_000).getUTCHours();
}

export function isShopOpen(now: Date): boolean {
  const h = bangkokHour(now);
  return h >= SHOP_OPEN_HOUR && h < SHOP_CLOSE_HOUR;
}
