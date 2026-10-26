import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useDisposalCalculation } from './useDisposalCalculation';
vi.mock('@/hooks/useCoa', () => ({ useCoaByCodes: () => ({ data: [] }) }));
const asset = {
  category: 'EQUIPMENT' as const, netBookValue: '900.00', accumulatedDepr: '100.00',
  purchaseCost: '1000.00', coaCostAccount: null, coaDeprAccount: null,
};

it.each(['', ' ', 'invalid', NaN, Infinity, undefined])('keeps an empty/incomplete sale preview safe: %s', proceeds => {
  const { result } = renderHook(() => useDisposalCalculation(asset, { disposalType: 'SALE', proceeds }));
  expect(result.current.proceeds).toBe(0);
  expect(result.current.isBalanced).toBe(false);
  expect(result.current.journalLines.every(line => Number.isFinite(line.debit) && Number.isFinite(line.credit))).toBe(true);
});

it('recalculates exact sale amounts after clearing and refilling the input', () => {
  const { result, rerender } = renderHook(({ proceeds }) => useDisposalCalculation(asset, {
    disposalType: 'SALE', proceeds, depositAccountCode: '11-1101',
  }), { initialProps: { proceeds: '950.01' } });
  expect(result.current.gainLoss).toBe(50.01);
  expect(result.current.isBalanced).toBe(true);
  rerender({ proceeds: '' });
  expect(result.current.isBalanced).toBe(false);
  rerender({ proceeds: '899.99' });
  expect(result.current.gainLoss).toBe(-0.01);
  expect(result.current.isBalanced).toBe(true);
});

it('supports write-off without sale proceeds', () => {
  const { result } = renderHook(() => useDisposalCalculation(asset, { disposalType: 'WRITE_OFF' }));
  expect(result.current.gainLoss).toBe(-900);
  expect(result.current.isBalanced).toBe(true);
});
