import { BadRequestException } from '@nestjs/common';
import {
  accountingPeriodOf,
  lockedAccountingPeriods,
  validatePeriodOpen,
} from './period-lock.util';

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

  it('SYNCED period: still rejected after the grace window', async () => {
    jest.setSystemTime(new Date('2026-06-10T00:00:00Z')); // beyond default grace
    const prisma = mockPrisma({ period: { status: 'SYNCED' } });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1'),
    ).rejects.toThrow(BadRequestException);
  });

  // owner decision #23 (2026-10-31): a period already sent to PEAK locks the moment it is SYNCED —
  // no grace window (entries posted after the sync would never reach PEAK nor the close snapshot)
  it('SYNCED period: locks immediately — no grace window (owner decision #23)', async () => {
    jest.setSystemTime(new Date('2026-06-01T10:00:00+07:00')); // inside the default 5-day grace of May
    const prisma = mockPrisma({ period: { status: 'SYNCED' } });
    const attempt = validatePeriodOpen(prisma, new Date('2026-05-31T12:00:00+07:00'), 'co-1');
    await expect(attempt).rejects.toThrow(BadRequestException);
    await expect(attempt).rejects.toThrow(
      'ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว (2026/05 สถานะ: SYNCED)',
    );
    await expect(attempt).rejects.toThrow(/ส่งเข้า PEAK แล้ว.*ไม่มีช่วงผ่อนผัน/);
    await expect(attempt).rejects.toThrow(/เปิดงวดใหม่ไม่ได้/);
    await expect(attempt).rejects.toThrow(/ติดต่อฝ่ายบัญชี/);
  });

  it('SYNCED current month: locks even a posting dated today (no last-day grace)', async () => {
    jest.setSystemTime(new Date('2026-05-20T10:00:00+07:00'));
    const prisma = mockPrisma({ period: { status: 'SYNCED' }, graceDays: '30' });
    await expect(validatePeriodOpen(prisma, new Date(), 'co-1')).rejects.toThrow(
      /2026\/05 สถานะ: SYNCED/,
    );
  });

  it('CLOSED period keeps its grace window and its original message (no PEAK wording)', async () => {
    jest.setSystemTime(new Date('2026-06-10T00:00:00Z'));
    const prisma = mockPrisma({ period: { status: 'CLOSED' } });
    const attempt = validatePeriodOpen(prisma, new Date('2026-05-31'), 'co-1');
    await expect(attempt).rejects.toThrow(
      'ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว (2026/05 สถานะ: CLOSED)',
    );
    await expect(attempt).rejects.not.toThrow(/PEAK/);
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

  // ── owner rule 2026-10-31: grace counts whole Bangkok days AFTER month end ──
  // grace 0 = the period's own last day stays postable until 23:59:59.999 (Asia/Bangkok);
  // grace N = N full days after month end. Instants are written with +07:00 so the
  // assertions hold whatever the process TZ is (CI runs jest in UTC).

  it('grace=0 + current month closed early: its own last day still accepts until 23:59:59.999 BKK', async () => {
    jest.setSystemTime(new Date('2026-10-31T23:59:59.999+07:00'));
    const prisma = mockPrisma({ period: { status: 'CLOSED' }, graceDays: '0' });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-10-31T12:00:00+07:00'), 'co-1'),
    ).resolves.toBeUndefined();
  });

  it('grace=0: blocks from 00:00 BKK on the 1st of the next month (the day AFTER month end)', async () => {
    jest.setSystemTime(new Date('2026-11-01T00:00:00+07:00'));
    const prisma = mockPrisma({ period: { status: 'CLOSED' }, graceDays: '0' });
    await expect(
      validatePeriodOpen(prisma, new Date('2026-10-31T12:00:00+07:00'), 'co-1'),
    ).rejects.toThrow('ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว (2026/10 สถานะ: CLOSED)');
  });

  it('grace=5: the 5th day after month end is still inside for the whole day; the 6th blocks', async () => {
    const prisma = mockPrisma({ period: { status: 'CLOSED' }, graceDays: '5' });
    jest.setSystemTime(new Date('2026-11-05T23:59:59.999+07:00'));
    await expect(
      validatePeriodOpen(prisma, new Date('2026-10-31T12:00:00+07:00'), 'co-1'),
    ).resolves.toBeUndefined();
    jest.setSystemTime(new Date('2026-11-06T00:00:00+07:00'));
    await expect(
      validatePeriodOpen(prisma, new Date('2026-10-31T12:00:00+07:00'), 'co-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('December rolls into January: grace=0 accepts through 31 Dec BKK, blocks from 1 Jan', async () => {
    const prisma = mockPrisma({ period: { status: 'CLOSED' }, graceDays: '0' });
    jest.setSystemTime(new Date('2026-12-31T23:59:59.999+07:00'));
    await expect(
      validatePeriodOpen(prisma, new Date('2026-12-31T09:00:00+07:00'), 'co-1'),
    ).resolves.toBeUndefined();
    jest.setSystemTime(new Date('2027-01-01T00:00:00+07:00'));
    await expect(
      validatePeriodOpen(prisma, new Date('2026-12-31T09:00:00+07:00'), 'co-1'),
    ).rejects.toThrow('(2026/12 สถานะ: CLOSED)');
  });

  it('reads the period month on the Bangkok calendar whatever the process TZ', async () => {
    jest.setSystemTime(new Date('2026-11-02T12:00:00+07:00'));
    const prisma = mockPrisma({ period: null });
    // 17:30Z on 31 Oct = 00:30 on 1 Nov in Bangkok → the November period
    await validatePeriodOpen(prisma, new Date('2026-10-31T17:30:00Z'), 'co-1');
    expect(prisma.accountingPeriod.findUnique).toHaveBeenCalledWith({
      where: { companyId_year_month: { companyId: 'co-1', year: 2026, month: 11 } },
      select: { status: true },
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

  // ── one Thai-calendar month helper (review M2) — the guard and every period-row locker use it ──
  it('accountingPeriodOf reads the Bangkok calendar month whatever the process TZ', () => {
    expect(accountingPeriodOf(new Date('2026-10-31T16:59:59.999Z'))).toEqual({
      year: 2026,
      month: 10,
    });
    expect(accountingPeriodOf(new Date('2026-10-31T17:30:00Z'))).toEqual({ year: 2026, month: 11 });
    expect(accountingPeriodOf(new Date('2026-12-31T17:00:00Z'))).toEqual({ year: 2027, month: 1 });
  });

  // review M5: the per-period form of the same rule — a batch can exclude locked months up front
  it('lockedAccountingPeriods returns CLOSED periods past their grace window and every SYNCED period', async () => {
    jest.setSystemTime(new Date('2026-11-03T10:00:00+07:00'));
    const findMany = jest.fn().mockResolvedValue([
      { year: 2026, month: 9, status: 'CLOSED' }, // grace 5 ended 00:00 6 Oct → locked
      { year: 2026, month: 10, status: 'CLOSED' }, // grace runs to the end of 5 Nov → still open
      { year: 2026, month: 8, status: 'SYNCED' }, // SYNCED → locked (no grace — owner decision #23)
      { year: 2026, month: 11, status: 'SYNCED' }, // even the current month → locked
    ]);
    const prisma = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue({ value: '5' }) },
      accountingPeriod: { findMany },
    };
    await expect(lockedAccountingPeriods(prisma, 'co-1')).resolves.toEqual([
      { year: 2026, month: 9 },
      { year: 2026, month: 8 },
      { year: 2026, month: 11 },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { companyId: 'co-1', status: { in: ['CLOSED', 'SYNCED'] } },
      select: { year: true, month: true, status: true },
    });
  });
});
