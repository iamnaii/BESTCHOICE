import { describe, expect, it } from 'vitest';
import { saleMargin } from './sale-margin';
describe('recorded main-device margin', () => {
  it('preserves satang and explicit zero', () => { expect(saleMargin('0.30', '0.10')).toBe(0.2); expect(saleMargin('0.30', '0')).toBe(0.3); });
  it('keeps losses and unknown costs distinct', () => { expect(saleMargin('0.10', '0.30')).toBe(-0.2); expect(saleMargin('100', null)).toBeNull(); });
});
