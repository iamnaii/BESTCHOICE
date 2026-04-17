import { Prisma } from '@prisma/client';
import { d, dAdd, dSub, dMul, dDiv, dSum, dGte, dAbs, dRound, dCompare, dClose } from './decimal.util';

describe('decimal.util', () => {
  describe('d()', () => {
    it('converts number to Decimal', () => {
      expect(d(123.45).toString()).toBe('123.45');
    });
    it('converts string to Decimal', () => {
      expect(d('999.99').toString()).toBe('999.99');
    });
    it('passes through Prisma.Decimal', () => {
      const val = new Prisma.Decimal('100.00');
      expect(d(val).toString()).toBe('100');
    });
    it('handles null/undefined as zero', () => {
      expect(d(null).toString()).toBe('0');
      expect(d(undefined).toString()).toBe('0');
    });
  });

  describe('arithmetic', () => {
    it('dAdd adds two decimals', () => {
      expect(dAdd('100.10', '200.20').toString()).toBe('300.3');
    });
    it('dSub subtracts', () => {
      expect(dSub('300.30', '100.10').toString()).toBe('200.2');
    });
    it('dMul multiplies', () => {
      expect(dMul('10.50', '3').toString()).toBe('31.5');
    });
    it('dDiv divides', () => {
      expect(dDiv('100', '3').toDecimalPlaces(2).toString()).toBe('33.33');
    });
    it('dSum sums array', () => {
      expect(dSum(['10.10', '20.20', '30.30']).toString()).toBe('60.6');
    });
  });

  describe('comparison', () => {
    it('dGte returns true if a >= b', () => {
      expect(dGte('100.01', '100.00')).toBe(true);
      expect(dGte('100.00', '100.00')).toBe(true);
      expect(dGte('99.99', '100.00')).toBe(false);
    });
    it('dCompare returns -1, 0, 1', () => {
      expect(dCompare('100', '200')).toBe(-1);
      expect(dCompare('200', '200')).toBe(0);
      expect(dCompare('300', '200')).toBe(1);
    });
  });

  describe('dRound', () => {
    it('rounds to 2 decimal places (satang)', () => {
      expect(dRound('100.555').toString()).toBe('100.56');
      expect(dRound('100.554').toString()).toBe('100.55');
    });
  });

  describe('dAbs', () => {
    it('returns absolute value', () => {
      expect(dAbs('-100.50').toString()).toBe('100.5');
    });
  });

  describe('dClose', () => {
    it('returns true if within tolerance', () => {
      expect(dClose('100.00', '100.005')).toBe(true);
      expect(dClose('100.00', '100.02')).toBe(false);
    });
  });
});
