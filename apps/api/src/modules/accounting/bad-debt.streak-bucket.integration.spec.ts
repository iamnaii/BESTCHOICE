import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { BadDebtService } from './bad-debt.service';
import { ConsecutiveMissedService } from '../overdue/consecutive-missed.service';

const prisma = new PrismaClient();
// These tests exercise PURE methods only; the 4 template deps are unused here.
const svc = new BadDebtService(
  prisma as any, undefined as any, undefined as any, undefined as any, undefined as any,
  new ConsecutiveMissedService(prisma as any),
);
const RATES = { '1-30': 0.02, '31-60': 0.15, '61-90': 0.5, '91-180': 0.75, '180+': 1.0 };

describe('streakToBucket / effectiveBucket', () => {
  it('maps streak counts to floor buckets (default map)', () => {
    expect((svc as any).streakToBucket(1)).toBeNull();
    expect((svc as any).streakToBucket(2)).toBe('31-60');
    expect((svc as any).streakToBucket(3)).toBe('61-90');
    expect((svc as any).streakToBucket(7)).toBe('180+');
  });

  it('takes the more-severe bucket by rate', () => {
    expect((svc as any).effectiveBucket('1-30', '61-90', RATES)).toBe('61-90');
    expect((svc as any).effectiveBucket('91-180', '31-60', RATES)).toBe('91-180');
    expect((svc as any).effectiveBucket('1-30', null, RATES)).toBe('1-30');
  });
});
