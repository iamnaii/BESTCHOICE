import { cashExchangeWindowOpen } from '../utils/cash-exchange-window';

const bkkMidnight = (d: Date) => {
  const s = new Date(d.getTime() + 7 * 3600_000);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - 7 * 3600_000);
};
const now = new Date('2026-10-12T10:00:00.000Z');
const daysAgo = (n: number) => new Date(bkkMidnight(now).getTime() - n * 86_400_000 + 3_600_000);

describe('cashExchangeWindowOpen — วัน 0–6 เปิด · วันที่ 7 ปิด (สูตรเดียวกับ daysRemainingIn7Day > 0)', () => {
  it.each([
    [0, true],
    [3, true],
    [6, true],
    [7, false],
    [8, false],
  ])('ขายเมื่อ %i วันก่อน → %s', (n, open) => {
    expect(cashExchangeWindowOpen(daysAgo(n), now)).toBe(open);
  });
});
