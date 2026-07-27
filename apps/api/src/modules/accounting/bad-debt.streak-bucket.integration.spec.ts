import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { BadDebtService } from './bad-debt.service';
import { ConsecutiveMissedService } from '../overdue/consecutive-missed.service';

const prisma = new PrismaClient();
// These tests exercise PURE methods only; the 4 template deps + CN service + CN delivery service are unused here.
const svc = new BadDebtService(
  prisma as any, undefined as any, undefined as any, undefined as any, undefined as any,
  new ConsecutiveMissedService(prisma as any),
  undefined as any,
  undefined as any,
);
const RATES = { '1-30': 0.02, '31-60': 0.15, '61-90': 0.5, '91-180': 0.75, '180+': 1.0 };
// 2026-07-26 per-installment plan: streakToBucket no longer has an internal
// code-default map (DEFAULT_STREAK_BUCKET_MAP retired) — the floor is
// opt-in via an explicit SystemConfig row, so every caller must pass its own
// map. This mirrors what a seeded `consecutive_missed_bucket_map` looks like.
const STREAK_MAP = { '2': '31-60', '3': '61-90', '4': '91-180', '5': '180+' };

describe('streakToBucket / effectiveBucket', () => {
  it('maps streak counts to floor buckets (explicit map — no code-default fallback)', () => {
    expect((svc as any).streakToBucket(1, STREAK_MAP)).toBeNull();
    expect((svc as any).streakToBucket(2, STREAK_MAP)).toBe('31-60');
    expect((svc as any).streakToBucket(3, STREAK_MAP)).toBe('61-90');
    expect((svc as any).streakToBucket(7, STREAK_MAP)).toBe('180+');
  });

  it('takes the more-severe bucket by rate', () => {
    expect((svc as any).effectiveBucket('1-30', '61-90', RATES)).toBe('61-90');
    expect((svc as any).effectiveBucket('91-180', '31-60', RATES)).toBe('91-180');
    expect((svc as any).effectiveBucket('1-30', null, RATES)).toBe('1-30');
  });
});
