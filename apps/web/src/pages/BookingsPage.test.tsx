import { describe, it, expect } from 'vitest';
import {
  computeBookingTotal,
  isDepositInRange,
  STATUS_LABEL,
  type BookingStatus,
} from './BookingsPage';

describe('computeBookingTotal', () => {
  it('totalAmount = sum(quantity * unitPrice) per row, rounded to 2dp', () => {
    const total = computeBookingTotal([
      { quantity: 1, unitPrice: 35000 },
      { quantity: 2, unitPrice: 5990 },
    ]);
    expect(total).toBe(46980);
  });

  it('returns 0 when there are no items', () => {
    expect(computeBookingTotal([])).toBe(0);
  });
});

describe('isDepositInRange', () => {
  it('accepts 0 <= deposit <= total', () => {
    expect(isDepositInRange(0, 1000)).toBe(true);
    expect(isDepositInRange(500, 1000)).toBe(true);
    expect(isDepositInRange(1000, 1000)).toBe(true);
  });

  it('rejects negative deposit OR deposit > total', () => {
    expect(isDepositInRange(-1, 1000)).toBe(false);
    expect(isDepositInRange(1001, 1000)).toBe(false);
  });
});

describe('STATUS_LABEL (Thai)', () => {
  it('covers all 5 BookingStatus values in Thai', () => {
    const expected: Record<BookingStatus, string> = {
      PENDING_DEPOSIT: 'รอชำระมัดจำ',
      PAID: 'มัดจำแล้ว',
      CANCELED: 'ยกเลิก',
      EXPIRED: 'หมดอายุ',
      CONVERTED: 'ขายแล้ว',
    };
    expect(STATUS_LABEL).toEqual(expected);
  });
});
