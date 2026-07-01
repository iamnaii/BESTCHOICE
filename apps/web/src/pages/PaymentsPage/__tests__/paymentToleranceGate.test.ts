import { describe, it, expect } from 'vitest';
import { paymentToleranceGate } from '../paymentToleranceGate';

describe('paymentToleranceGate', () => {
  // Regression: แบ่งชำระ (PARTIAL) an overdue installment short by 2,000฿ must NOT
  // be blocked by the ±1฿ tolerance gate.
  it('PARTIAL bypasses the gate even with a large shortfall', () => {
    expect(paymentToleranceGate('PARTIAL', 1854.55, 3854.55)).toEqual({ action: 'proceed', absDiff: 0 });
  });

  it('OVERPAY_ADVANCE bypasses the gate even with a large excess', () => {
    expect(paymentToleranceGate('OVERPAY_ADVANCE', 6000, 3854.55)).toEqual({ action: 'proceed', absDiff: 0 });
  });

  it('NORMAL exact payment proceeds', () => {
    expect(paymentToleranceGate('NORMAL', 3854.55, 3854.55)).toEqual({ action: 'proceed', absDiff: 0 });
  });

  it('NORMAL within ±1฿ needs approval (confirm)', () => {
    const r = paymentToleranceGate('NORMAL', 3854.05, 3854.55); // 0.50 short
    expect(r.action).toBe('confirm');
    expect(r.absDiff).toBe(0.5);
  });

  it('NORMAL over 1฿ off is blocked', () => {
    const r = paymentToleranceGate('NORMAL', 1854.55, 3854.55); // 2000 short in full-pay intent
    expect(r.action).toBe('block');
    expect(r.absDiff).toBe(2000);
  });

  it('UNDERPAY within tolerance still requires confirm (not bypassed)', () => {
    expect(paymentToleranceGate('UNDERPAY', 3853.55, 3854.55).action).toBe('confirm'); // 1.00 off
  });

  it('boundary: exactly 1฿ off is confirm, just over is block', () => {
    expect(paymentToleranceGate('NORMAL', 3853.55, 3854.55).action).toBe('confirm'); // 1.00
    expect(paymentToleranceGate('NORMAL', 3853.54, 3854.55).action).toBe('block'); // 1.01
  });
});
