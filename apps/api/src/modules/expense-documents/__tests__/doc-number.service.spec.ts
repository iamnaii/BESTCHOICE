import { DocNumberService } from '../services/doc-number.service';
import {
  DEFAULT_DOC_PREFIX_MAP,
  SettingsService,
} from '../../settings/settings.service';
import type { DocumentType, Prisma } from '@prisma/client';

describe('DocNumberService', () => {
  let service: DocNumberService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let settings: any;

  beforeEach(() => {
    tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      expenseDocument: {
        findFirst: jest.fn(),
      },
    };
    settings = {
      getDocPrefixMap: jest.fn().mockResolvedValue({ ...DEFAULT_DOC_PREFIX_MAP }),
    };
    service = new DocNumberService(settings as unknown as SettingsService);
  });

  it('returns EX-YYYYMMDD-0001 for first EXPENSE on given date', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue(null);
    const num = await service.next(
      tx as Prisma.TransactionClient,
      'EXPENSE',
      new Date('2026-05-10T12:00:00Z'),
    );
    expect(num).toBe('EX-20260510-0001');
  });

  it('increments sequence per type per day', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260510-0042' });
    const num = await service.next(
      tx as Prisma.TransactionClient,
      'EXPENSE',
      new Date('2026-05-10T12:00:00Z'),
    );
    expect(num).toBe('EX-20260510-0043');
  });

  it('uses correct prefix per type', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue(null);
    expect(await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'))).toMatch(/^EX-/);
    expect(await service.next(tx, 'CREDIT_NOTE', new Date('2026-05-10T12:00:00Z'))).toMatch(
      /^CN-/,
    );
    expect(await service.next(tx, 'PAYROLL', new Date('2026-05-10T12:00:00Z'))).toMatch(/^PR-/);
    expect(
      await service.next(tx, 'VENDOR_SETTLEMENT', new Date('2026-05-10T12:00:00Z')),
    ).toMatch(/^SE-/);
  });

  it('acquires advisory lock with deterministic key per (type, date)', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue(null);
    await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringMatching(/^SELECT pg_advisory_xact_lock\(-?\d+\)$/),
    );
  });

  it('uses Asia/Bangkok timezone for date boundary (UTC late-night → next BKK day)', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue(null);
    // 2026-05-10 19:00 UTC = 2026-05-11 02:00 BKK
    const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T19:00:00Z'));
    expect(num).toBe('EX-20260511-0001');
  });

  // W4 — explicit throw when seq overflows 4-digit slot (rather than silently
  // emitting EX-YYYYMMDD-10000 which sorts wrong and breaks downstream parsers).
  it('W4: throws when seq exceeds 9999 for a day', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260510-9999' });
    await expect(
      service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z')),
    ).rejects.toThrow(/เกิน 9999/);
  });

  it('W4: still works at 9998 → 9999', async () => {
    tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-20260510-9998' });
    const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
    expect(num).toBe('EX-20260510-9999');
  });

  // D1.1.2.1 — SystemConfig-driven prefix override.
  describe('D1.1.2.1 — doc_prefix_per_type override', () => {
    it('uses the SystemConfig-overridden prefix when SettingsService returns a remapped value', async () => {
      const overridden: Record<DocumentType, string> = {
        ...DEFAULT_DOC_PREFIX_MAP,
        EXPENSE: 'EXP',
      };
      settings.getDocPrefixMap.mockResolvedValue(overridden);
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EXP-20260510-0001');
    });

    it('falls back to default mapping when SettingsService throws (defensive)', async () => {
      settings.getDocPrefixMap.mockRejectedValue(new Error('db down'));
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'CREDIT_NOTE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('CN-20260510-0001');
    });

    it('partial override leaves other types on defaults', async () => {
      const partial: Record<DocumentType, string> = {
        ...DEFAULT_DOC_PREFIX_MAP,
        PAYROLL: 'PYR',
      };
      settings.getDocPrefixMap.mockResolvedValue(partial);
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const payroll = await service.next(tx, 'PAYROLL', new Date('2026-05-10T12:00:00Z'));
      const expense = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(payroll).toMatch(/^PYR-/);
      expect(expense).toMatch(/^EX-/);
    });

    it('overflow error message reflects the resolved (overridden) prefix', async () => {
      settings.getDocPrefixMap.mockResolvedValue({
        ...DEFAULT_DOC_PREFIX_MAP,
        EXPENSE: 'EXP',
      });
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EXP-20260510-9999' });
      await expect(
        service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z')),
      ).rejects.toThrow(/EXP/);
    });
  });
});
