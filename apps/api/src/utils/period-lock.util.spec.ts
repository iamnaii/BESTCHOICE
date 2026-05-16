import { BadRequestException } from '@nestjs/common';
import { validatePeriodOpen } from './period-lock.util';

/**
 * Tests for D1.2.6.2 — `period_grace_days` SystemConfig knob. The default 5d
 * grace window lets owners post invoices into the just-closed period for a
 * few days after the period's last calendar day.
 *
 * Note: validatePeriodOpen reads `new Date()` to compare against `today` —
 * we use Jest's fake timers so the grace-window math is deterministic.
 */

describe('validatePeriodOpen — D1.2.6.2 period_grace_days', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function mockPrisma(opts: {
    period?: { status: string } | null;
    graceDays?: string | null; // raw string as stored in SystemConfig
    closedUntil?: string | null;
  }) {
    return {
      systemConfig: {
        findUnique: jest.fn().mockImplementation((args: { where: { key: string } }) => {
          if (args.where.key === 'period_grace_days') {
            return Promise.resolve(opts.graceDays ? { value: opts.graceDays } : null);
          }
          if (args.where.key === 'accounting_period_closed_until') {
            return Promise.resolve(opts.closedUntil ? { value: opts.closedUntil } : null);
          }
          return Promise.resolve(null);
        }),
      },
      accountingPeriod: {
        findUnique: jest.fn().mockResolvedValue(opts.period ?? null),
      },
    };
  }

  // ── Tier 1: AccountingPeriod (companyId provided) ──────────────────────

  it('CLOSED period: rejects when today is BEYOND grace window (default 5d)', async () => {
    jest.setSystemTime(new Date('2026-06-10T00:00:00Z')); // 10d past May 31
    const prisma = mockPrisma({ period: { status: 'CLOSED' } });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('CLOSED period: ALLOWS when today is WITHIN grace window (default 5d)', async () => {
    jest.setSystemTime(new Date('2026-06-03T00:00:00Z')); // 3d past May 31 — within grace
    const prisma = mockPrisma({ period: { status: 'CLOSED' } });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).resolves.toBeUndefined();
  });

  it('CLOSED period: OWNER-configured grace=0 → no grace, immediate block', async () => {
    jest.setSystemTime(new Date('2026-06-01T12:00:00Z')); // 1d past period end
    const prisma = mockPrisma({ period: { status: 'CLOSED' }, graceDays: '0' });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('CLOSED period: OWNER-configured grace=30 → extended window', async () => {
    jest.setSystemTime(new Date('2026-06-20T00:00:00Z')); // 20d past May 31
    const prisma = mockPrisma({ period: { status: 'CLOSED' }, graceDays: '30' });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).resolves.toBeUndefined();
  });

  it('OPEN period: never throws regardless of grace window', async () => {
    jest.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    const prisma = mockPrisma({ period: { status: 'OPEN' } });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).resolves.toBeUndefined();
  });

  it('SYNCED period: treated same as CLOSED for grace purposes', async () => {
    jest.setSystemTime(new Date('2026-06-10T00:00:00Z')); // beyond default grace
    const prisma = mockPrisma({ period: { status: 'SYNCED' } });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).rejects.toThrow(BadRequestException);
  });

  // ── Tier 2: legacy `accounting_period_closed_until` ────────────────────

  it('legacy closedUntil: rejects when today is BEYOND grace', async () => {
    jest.setSystemTime(new Date('2026-06-15T00:00:00Z'));
    const prisma = mockPrisma({ closedUntil: '2026-05-31' });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-30')),
    ).rejects.toThrow(BadRequestException);
  });

  it('legacy closedUntil: ALLOWS when today is WITHIN grace', async () => {
    jest.setSystemTime(new Date('2026-06-03T00:00:00Z'));
    const prisma = mockPrisma({ closedUntil: '2026-05-31' });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-30')),
    ).resolves.toBeUndefined();
  });

  // ── Edge: malformed/missing grace config falls back to default 5 ───────

  it('grace_days unparseable: falls back to default 5', async () => {
    jest.setSystemTime(new Date('2026-06-03T00:00:00Z'));
    const prisma = mockPrisma({ period: { status: 'CLOSED' }, graceDays: 'soon' });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).resolves.toBeUndefined();
  });

  it('grace_days negative: falls back to default 5', async () => {
    jest.setSystemTime(new Date('2026-06-10T00:00:00Z'));
    const prisma = mockPrisma({ period: { status: 'CLOSED' }, graceDays: '-2' });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).rejects.toThrow(BadRequestException);
  });
});
