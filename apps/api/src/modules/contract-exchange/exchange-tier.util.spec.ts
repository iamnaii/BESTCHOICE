import { Decimal } from '@prisma/client/runtime/library';
import { computeExchangeTier } from './exchange-tier.util';

const d = (v: string | number) => new Decimal(v);
// Workbook fixture: NCV = 7,333.28, basePrice สมมติ 9,176.47 → marketMin(85%) = 7,800.00
// และ marketMax(115%) = 10,552.9405 (I5 upper bound)
const NCV = d('7333.28');
const BASE = d('9176.47');
// I5 fixture adjustment (2026-07-29 final review): เดิม Case 2F/2G ใช้ BASE 9,176.47
// กับ buyback 11,000/12,000 — ผ่านเพราะยังไม่มี marketMax. เมื่อเพิ่ม upper bound
// (11,000 > 10,552.94 → REVIEW) จึงยก basePrice ของ 2 เคสนั้นเป็น 11,000
// (marketMin 9,350 ≤ 11,000/12,000 ≤ marketMax 12,650) เพื่อรักษา intent เดิม:
// "AUTO เมื่อ ≥ NCV และผ่าน market check"
const BASE_HIGH = d('11000');

describe('computeExchangeTier (spec §6)', () => {
  const t = (buyback: string, basePrice: Decimal | null = BASE) =>
    computeExchangeTier({ buyback: d(buyback), ncv: NCV, basePrice, marketCheckPct: 15 });

  it('Case 2A: 8,000 ≥ NCV และ ≥ marketMin → AUTO', () => expect(t('8000')).toBe('AUTO'));
  it('Case 2B: 9,000 → AUTO', () => expect(t('9000')).toBe('AUTO'));
  it('Case 2C resolved: = NCV แต่ตก market check (7,333.28 < 7,800) → REVIEW', () =>
    expect(t('7333.28')).toBe('REVIEW'));
  it('= NCV และไม่มี valuation row → REVIEW (force)', () =>
    expect(t('7333.28', null)).toBe('REVIEW'));
  it('Case 2D: 6,000 ∈ [70%NCV, NCV) → REVIEW', () => expect(t('6000')).toBe('REVIEW'));
  it('boundary: = 70%×NCV (5,133.296) → REVIEW ไม่ใช่ ESCALATE', () =>
    expect(t('5133.296')).toBe('REVIEW'));
  it('Case 2E: 3,200 < 70%×NCV → ESCALATE', () => expect(t('3200')).toBe('ESCALATE'));
  it('Case 2F/2G: 11,000 / 12,000 → AUTO (basePrice ยกเป็น 11,000 — ดู I5 fixture note)', () => {
    expect(t('11000', BASE_HIGH)).toBe('AUTO');
    expect(t('12000', BASE_HIGH)).toBe('AUTO');
  });
  it('≥ NCV, มี valuation, ผ่าน marketMin พอดีเป๊ะ (7,800.00) → AUTO', () =>
    expect(t('7800')).toBe('AUTO'));

  // I5 — marketMax upper bound (symmetric ±15%): จ่ายแพงเกินราคากลางต้อง REVIEW
  it('I5: buyback = marketMax พอดี (10,552.94 ≤ 10,552.9405) → AUTO', () =>
    expect(t('10552.94')).toBe('AUTO'));
  it('I5: buyback 10,600 > marketMax 10,552.9405 → REVIEW (overpay เกินราคากลาง)', () =>
    expect(t('10600')).toBe('REVIEW'));
});
