import { Decimal } from '@prisma/client/runtime/library';
import { computeExchangeTier } from './exchange-tier.util';

const d = (v: string | number) => new Decimal(v);
// Workbook fixture: NCV = 7,333.28, basePrice สมมติ 9,176.47 → marketMin(85%) = 7,800.00
const NCV = d('7333.28');
const BASE = d('9176.47');

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
  it('Case 2F/2G: 11,000 / 12,000 → AUTO', () => {
    expect(t('11000')).toBe('AUTO');
    expect(t('12000')).toBe('AUTO');
  });
  it('≥ NCV, มี valuation, ผ่าน marketMin พอดีเป๊ะ (7,800.00) → AUTO', () =>
    expect(t('7800')).toBe('AUTO'));
});
