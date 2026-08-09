/**
 * ภาษีเงินได้บุคคลธรรมดาหัก ณ ที่จ่ายแบบขั้นบันได (ม.48 + ม.50(1) ป.รัษฎากร) —
 * ค่า "แนะนำ" สำหรับช่อง WHT ในใบเงินเดือน (payroll round 3, 2026-08-06).
 *
 * ADVISORY ONLY — คำนวณแบบลดหย่อนมาตรฐานขั้นต่ำ:
 *   เงินได้ทั้งปี            = ฐานเดือน (รวมรายได้พิเศษที่เสียภาษี) × 12
 *   หักค่าใช้จ่าย 40(1)      = 50% ไม่เกิน 100,000
 *   ลดหย่อนส่วนตัว           = 60,000
 *   หักเงินสมทบ ปกส. จริง    = ssoEmployee × 12
 * ไม่รวมลดหย่อนรายบุคคล (คู่สมรส/บุตร/ประกัน/RMF ฯลฯ) — ระบบไม่มีข้อมูลนั้น
 * ค่าจริงที่พนักงานควรถูกหักอาจต่ำกว่านี้ ผู้ทำเงินเดือนแก้ทับได้เสมอ.
 *
 * ขั้นบันได ม.48 (เงินได้สุทธิ):
 *   0 – 150,000        ยกเว้น
 *   >150,000 – 300,000   5%
 *   >300,000 – 500,000  10%
 *   >500,000 – 750,000  15%
 *   >750,000 – 1,000,000 20%
 *   >1,000,000 – 2,000,000 25%
 *   >2,000,000 – 5,000,000 30%
 *   >5,000,000          35%
 */

const BRACKETS: Array<{ upTo: number; rate: number }> = [
  { upTo: 150_000, rate: 0 },
  { upTo: 300_000, rate: 0.05 },
  { upTo: 500_000, rate: 0.1 },
  { upTo: 750_000, rate: 0.15 },
  { upTo: 1_000_000, rate: 0.2 },
  { upTo: 2_000_000, rate: 0.25 },
  { upTo: 5_000_000, rate: 0.3 },
  { upTo: Infinity, rate: 0.35 },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ภาษีทั้งปีจากเงินได้สุทธิ (หลังหักค่าใช้จ่าย+ลดหย่อนแล้ว). */
export function annualTaxFromNetIncome(netIncome: number): number {
  if (!Number.isFinite(netIncome) || netIncome <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const b of BRACKETS) {
    if (netIncome <= lower) break;
    const taxableInBracket = Math.min(netIncome, b.upTo) - lower;
    tax += taxableInBracket * b.rate;
    lower = b.upTo;
  }
  return round2(tax);
}

/**
 * ค่า WHT แนะนำต่อเดือน. `monthlyTaxable` = ฐานเงินเดือน + รายได้พิเศษที่เสียภาษี
 * ของเดือนนั้น; `monthlySso` = เงินสมทบ ปกส. ที่หักจริง.
 */
export function suggestMonthlyWht(monthlyTaxable: number, monthlySso: number): number {
  if (!Number.isFinite(monthlyTaxable) || monthlyTaxable <= 0) return 0;
  const annualIncome = monthlyTaxable * 12;
  const expenseDeduction = Math.min(annualIncome * 0.5, 100_000);
  const personalAllowance = 60_000;
  const ssoDeduction = Math.max(0, Number.isFinite(monthlySso) ? monthlySso : 0) * 12;
  const netIncome = annualIncome - expenseDeduction - personalAllowance - ssoDeduction;
  return round2(annualTaxFromNetIncome(netIncome) / 12);
}
