/**
 * ข้อความค่างวดถึงลูกค้า — รูปแบบเดียวกับสติกเกอร์หน้าร้านและบอทขาย
 * (สคริปต์ขาย: เรียกแค่ "เรทที่ 1" / "เรทที่ 2" ห้ามเอ่ยชื่อไฟแนนซ์ ดอกเบี้ย หรือ %)
 * เรทที่ 1 = BESTCHOICE (สัญญาของเรา) · เรทที่ 2 = ไฟแนนซ์ภายนอก (GFIN)
 */

/** คั่นหลักพัน แบบ deterministic ไม่พึ่ง locale — ตัด .00 ทิ้ง, คงทศนิยมอื่นไว้ 2 หลัก */
export function formatBahtPlain(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const fixed = Math.abs(value).toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = value < 0 ? '-' : '';
  return decPart === '00' ? `${sign}${withSep}` : `${sign}${withSep}.${decPart}`;
}

export function formatRateLine(
  rateNo: 1 | 2,
  downAmount: number,
  monthlyPayment: number,
  months: number,
): string {
  return `เรทที่ ${rateNo} ดาวน์ ${formatBahtPlain(downAmount)} บาท ผ่อนเดือนละ ${formatBahtPlain(monthlyPayment)} บาท ${months} งวด`;
}

/** ตัวเลือก % ดาวน์ของ GFIN: จากขั้นต่ำที่ GFIN ตั้งให้ร้าน ถึง 80% ขั้นละ 5% */
export function gfinDownPctOptions(minPct: number, maxPct = 80, step = 5): number[] {
  const out: number[] = [];
  if (!(step > 0)) return out;
  for (let p = minPct; p <= maxPct; p += step) out.push(p);
  return out;
}
