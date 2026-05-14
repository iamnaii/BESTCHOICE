import { DocNumberService } from '../services/doc-number.service';
import type { Prisma } from '@prisma/client';

describe('DocNumberService', () => {
  let service: DocNumberService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;

  beforeEach(() => {
    tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      expenseDocument: {
        findFirst: jest.fn(),
      },
    };
    service = new DocNumberService();
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
});
