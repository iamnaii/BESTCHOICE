import { buildEarlyPayoffSuccessFlex } from './early-payoff-success.flex';

describe('buildEarlyPayoffSuccessFlex — discount badge', () => {
  const base = {
    customerName: 'บีม',
    contractNumber: 'CT-2026-0001',
    amountPaid: 18450,
    originalAmount: 22030,
    savings: 3580,
    payoffDate: '15 เม.ย. 2568',
  };

  it('omits the discount badge when no discountPercent is given (no false "50%")', () => {
    const json = JSON.stringify(buildEarlyPayoffSuccessFlex(base));
    expect(json).not.toContain('ส่วนลดพิเศษ');
    expect(json).not.toContain('50%');
  });

  it('renders the ACTUAL discount percent when provided', () => {
    const json = JSON.stringify(buildEarlyPayoffSuccessFlex({ ...base, discountPercent: 30 }));
    expect(json).toContain('ส่วนลดพิเศษ 30%');
    expect(json).not.toContain('50%');
  });
});
