/** แถวของตารางดอกเบี้ยรายงวดในฟอร์ม — `ratePct` เป็นเปอร์เซ็นต์ (50 = 50%) · ส่ง API เป็นเศษส่วน (÷ 100) */
export interface RateRowForm {
  months: number;
  ratePct: number;
}

/** ข้อความ error แรก หรือ null — กติกาเดียวกับ API (`InterestConfigService.replaceRates`) */
export function validateRateRows(rows: RateRowForm[], minMonths: number, maxMonths: number): string | null {
  const seen = new Set<number>();
  for (const r of rows) {
    if (!Number.isInteger(r.months) || r.months < 1) return 'จำนวนงวดต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
    if (seen.has(r.months)) return `จำนวนงวดซ้ำกัน: ${r.months} งวด`;
    seen.add(r.months);
    if (r.months < minMonths || r.months > maxMonths) {
      return `${r.months} งวด อยู่นอกช่วงงวดต่ำสุด–สูงสุด (${minMonths}–${maxMonths} งวด)`;
    }
    if (!(r.ratePct > 0) || r.ratePct > 999.99) return 'ดอกเบี้ยรวมต้องมากกว่า 0% และไม่เกิน 999.99%';
  }
  return null;
}

/** งวดที่ใช้ทำตัวอย่างคำนวณ — มีตาราง: 12 ถ้ามี ไม่งั้นงวดมากสุดในตาราง · ไม่มีตาราง: งวดสูงสุด */
export function previewMonths(rows: { months: number }[], maxMonths: number): number {
  if (rows.length === 0) return maxMonths;
  if (rows.some((r) => r.months === 12)) return 12;
  return Math.max(...rows.map((r) => r.months));
}

/** ดอกเบี้ยรวมทั้งสัญญา (เปอร์เซ็นต์) ของงวดนั้น — กติกาเดียวกับสัญญา: มีแถว = ค่าในแถว · ไม่มีตาราง = ต่อเดือน × งวด */
export function totalInterestPct(
  rows: { months: number; ratePct: number }[],
  monthlyRatePct: number,
  months: number,
): number {
  const row = rows.find((r) => r.months === months);
  if (row) return row.ratePct;
  return monthlyRatePct * months;
}
