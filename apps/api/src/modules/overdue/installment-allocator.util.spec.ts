import { Decimal } from '@prisma/client/runtime/library';
import { allocateFifo } from './installment-allocator.util';

describe('allocateFifo', () => {
  it('fills oldest installments first within target amount', () => {
    const installments = [
      { id: 'i1', dueDate: new Date('2026-03-01'), remainingAmount: new Decimal(4000) },
      { id: 'i2', dueDate: new Date('2026-04-01'), remainingAmount: new Decimal(4000) },
      { id: 'i3', dueDate: new Date('2026-05-01'), remainingAmount: new Decimal(4000) },
    ];
    expect(allocateFifo(installments, new Decimal(5000))).toEqual(['i1', 'i2']);
  });

  it('returns single installment when target fits in oldest', () => {
    const installments = [
      { id: 'i1', dueDate: new Date('2026-03-01'), remainingAmount: new Decimal(4000) },
      { id: 'i2', dueDate: new Date('2026-04-01'), remainingAmount: new Decimal(4000) },
    ];
    expect(allocateFifo(installments, new Decimal(3000))).toEqual(['i1']);
  });

  it('handles empty list', () => {
    expect(allocateFifo([], new Decimal(1000))).toEqual([]);
  });

  it('returns all when target exceeds total', () => {
    const installments = [
      { id: 'i1', dueDate: new Date('2026-03-01'), remainingAmount: new Decimal(4000) },
      { id: 'i2', dueDate: new Date('2026-04-01'), remainingAmount: new Decimal(4000) },
    ];
    expect(allocateFifo(installments, new Decimal(99999))).toEqual(['i1', 'i2']);
  });
});
