import { BadRequestException } from '@nestjs/common';
import { validatePeriodOpen } from './period-lock.util';

/**
 * Period-lock enforcement — single source of truth = AccountingPeriod.
 *
 * (2026-06 unify) The legacy SystemConfig key `accounting_period_closed_until`
 * was removed as an enforcement mechanism. AccountingPeriod (per-company,
 * per-month status) is now the ONLY source of truth; `period_grace_days` still
 * tunes the post-close grace window (D1.2.6.2).
 *
 * Enforcement requires a companyId — every accounting write path resolves the
 * FINANCE/SHOP companyId before calling the guard. A call with no companyId is
 * intentionally a no-op (see the "no companyId" test below).
 *
 * validatePeriodOpen reads `new Date()` for the grace-window comparison — we use
 * Jest fake timers so the math is deterministic.
 */
describe('validatePeriodOpen — AccountingPeriod single source of truth', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function mockPrisma(opts: {
    period?: { status: string } | null;
    graceDays?: string | null; // raw string as stored in SystemConfig
    legacyClosedUntil?: string | null; // only used to PROVE the legacy key is ignored
  }) {
    return {
      systemConfig: {
        findUnique: jest.fn().mockImplementation((args: { where: { key: string } }) => {
          if (args.where.key === 'period_grace_days') {
            return Promise.resolve(opts.graceDays ? { value: opts.graceDays } : null);
          }
          if (args.where.key === 'accounting_period_closed_until') {
            return Promise.resolve(opts.legacyClosedUntil ? { value: opts.legacyClosedUntil } : null);
          }
          return Promise.resolve(null);
        }),
      },
      accountingPeriod: {
        findUnique: jest.fn().mockResolvedValue(opts.period ?? null),
      },
    };
  }

  // ── AccountingPeriod status semantics ──────────────────────────────────

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

  it('SYNCED period: treated same as CLOSED for grace purposes', async () => {
    jest.setSystemTime(new Date('2026-06-10T00:00:00Z')); // beyond default grace
    const prisma = mockPrisma({ period: { status: 'SYNCED' } });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('OPEN period: never throws regardless of grace window', async () => {
    jest.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    const prisma = mockPrisma({ period: { status: 'OPEN' } });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).resolves.toBeUndefined();
  });

  it('REVIEW period: not yet closed → never throws', async () => {
    jest.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    const prisma = mockPrisma({ period: { status: 'REVIEW' } });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).resolves.toBeUndefined();
  });

  it('no AccountingPeriod row for the month → never throws', async () => {
    jest.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    const prisma = mockPrisma({ period: null });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).resolves.toBeUndefined();
  });

  // ── single source of truth: no companyId + legacy key both = NOT guarded ──

  it('no companyId provided → not guarded (resolves) even when the month is CLOSED', async () => {
    jest.setSystemTime(new Date('2026-06-10T00:00:00Z'));
    const prisma = mockPrisma({ period: { status: 'CLOSED' } });
    await expect(validatePeriodOpen(prisma, new Date('2026-05-31'))).resolves.toBeUndefined();
  });

  it('ignores the legacy accounting_period_closed_until key (removed as a source of truth)', async () => {
    jest.setSystemTime(new Date('2026-06-15T00:00:00Z')); // well past the legacy cutoff
    const prisma = mockPrisma({ legacyClosedUntil: '2026-05-31' });
    await expect(validatePeriodOpen(prisma, new Date('2026-05-30'))).resolves.toBeUndefined();
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalledWith({
      where: { key: 'accounting_period_closed_until' },
    });
  });

  // ── grace config edge cases fall back to default 5 ──────────────────────

  it('grace_days unparseable: falls back to default 5 (within window → allows)', async () => {
    jest.setSystemTime(new Date('2026-06-03T00:00:00Z'));
    const prisma = mockPrisma({ period: { status: 'CLOSED' }, graceDays: 'soon' });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).resolves.toBeUndefined();
  });

  it('grace_days negative: falls back to default 5 (beyond window → rejects)', async () => {
    jest.setSystemTime(new Date('2026-06-10T00:00:00Z'));
    const prisma = mockPrisma({ period: { status: 'CLOSED' }, graceDays: '-2' });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).rejects.toThrow(BadRequestException);
  });
});
