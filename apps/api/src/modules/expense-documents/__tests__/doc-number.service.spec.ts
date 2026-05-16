import { DocNumberService } from '../services/doc-number.service';
import { SettingsService } from '../../settings/settings.service';
import type { Prisma } from '@prisma/client';

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
      getKey: jest.fn().mockResolvedValue(null), // default format
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

  // W4 — explicit throw when seq overflows the configured digit width.
  it('W4: throws when seq exceeds 9999 for a day on default format', async () => {
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

  // D1.1.2.2 — doc_number_format whitelisted enum.
  describe('D1.1.2.2 — doc_number_format', () => {
    it('PREFIX-YYYYMM-NNNNN produces EX-YYYYMM-00001 with 5-digit seq', async () => {
      settings.getKey.mockResolvedValue('PREFIX-YYYYMM-NNNNN');
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-202605-00001');
    });

    it('PREFIX-YYYY-NNNNNN produces EX-YYYY-000001 with 6-digit seq', async () => {
      settings.getKey.mockResolvedValue('PREFIX-YYYY-NNNNNN');
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-2026-000001');
    });

    it('PREFIX-YYYYMMDD-NNNN (explicit default) produces 4-digit seq', async () => {
      settings.getKey.mockResolvedValue('PREFIX-YYYYMMDD-NNNN');
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0001');
    });

    it('bad / non-whitelisted format value falls back to default', async () => {
      settings.getKey.mockResolvedValue('PREFIX-WTF-99');
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0001');
    });

    it('seq width overflow throws on monthly format at 99999', async () => {
      settings.getKey.mockResolvedValue('PREFIX-YYYYMM-NNNNN');
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-202605-99999' });
      await expect(
        service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z')),
      ).rejects.toThrow(/เกิน 99999/);
    });

    it('seq width overflow throws on yearly format at 999999', async () => {
      settings.getKey.mockResolvedValue('PREFIX-YYYY-NNNNNN');
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-2026-999999' });
      await expect(
        service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z')),
      ).rejects.toThrow(/เกิน 999999/);
    });

    it('defensive fallback when SettingsService.getKey throws', async () => {
      settings.getKey.mockRejectedValue(new Error('db down'));
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0001');
    });
  });
});
