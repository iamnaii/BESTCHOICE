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
      // default: both keys absent (no SystemConfig rows) → spec default
      // format PREFIX-YYMM-NNN + legacy cycle daily.
      getKey: jest.fn().mockResolvedValue(null),
    };
    service = new DocNumberService(settings as unknown as SettingsService);
  });

  // ---------------------------------------------------------------------------
  // Spec default — PREFIX-YYMM-NNN (Settings_Audit_Core_v2.0 row 1.2.2).
  // ---------------------------------------------------------------------------
  describe('default format (PREFIX-YYMM-NNN per spec)', () => {
    it('returns EX-YYMM-001 for first EXPENSE on given date', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(
        tx as Prisma.TransactionClient,
        'EXPENSE',
        new Date('2026-05-10T12:00:00Z'),
      );
      expect(num).toBe('EX-2605-001');
    });

    it('increments sequence within the YYMM window', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-2605-042' });
      const num = await service.next(
        tx as Prisma.TransactionClient,
        'EXPENSE',
        new Date('2026-05-10T12:00:00Z'),
      );
      expect(num).toBe('EX-2605-043');
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

    it('acquires advisory lock with deterministic key', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringMatching(/^SELECT pg_advisory_xact_lock\(-?\d+\)$/),
      );
    });

    it('uses Asia/Bangkok timezone for date boundary (UTC late-night → next BKK day/month)', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      // 2026-05-31 19:00 UTC = 2026-06-01 02:00 BKK → YYMM = "2606"
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-31T19:00:00Z'));
      expect(num).toBe('EX-2606-001');
    });

    it('W4: throws when seq exceeds 999 on default format', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-2605-999' });
      await expect(
        service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z')),
      ).rejects.toThrow(/เกิน 999/);
    });

    it('W4: still works at 998 → 999', async () => {
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-2605-998' });
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-2605-999');
    });
  });

  // ---------------------------------------------------------------------------
  // D1.1.2.2 — whitelisted enum (all 4 variants).
  // ---------------------------------------------------------------------------
  describe('D1.1.2.2 — doc_number_format whitelist', () => {
    it('PREFIX-YYMM-NNN (explicit) produces YYMM + 3-digit seq', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_format' ? 'PREFIX-YYMM-NNN' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-2605-001');
    });

    it('PREFIX-YYYYMMDD-NNNN produces full date + 4-digit seq', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_format' ? 'PREFIX-YYYYMMDD-NNNN' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-20260510-0001');
    });

    it('PREFIX-YYYYMM-NNNNN produces YYYYMM + 5-digit seq', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_format' ? 'PREFIX-YYYYMM-NNNNN' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-202605-00001');
    });

    it('PREFIX-YYYY-NNNNNN produces YYYY + 6-digit seq', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_format' ? 'PREFIX-YYYY-NNNNNN' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-2026-000001');
    });

    it('bad / non-whitelisted format value falls back to spec default', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_format' ? 'PREFIX-WTF-99' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-2605-001');
    });

    it('seq width overflow throws on PREFIX-YYYYMM-NNNNN at 99999', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_format' ? 'PREFIX-YYYYMM-NNNNN' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-202605-99999' });
      await expect(
        service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z')),
      ).rejects.toThrow(/เกิน 99999/);
    });

    it('seq width overflow throws on PREFIX-YYYY-NNNNNN at 999999', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_format' ? 'PREFIX-YYYY-NNNNNN' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue({ number: 'EX-2026-999999' });
      await expect(
        service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z')),
      ).rejects.toThrow(/เกิน 999999/);
    });

    it('defensive fallback when SettingsService.getKey throws', async () => {
      settings.getKey.mockRejectedValue(new Error('db down'));
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-2605-001');
    });
  });

  // ---------------------------------------------------------------------------
  // Composition with D1.1.2.3 — when sibling PR #947 sets a reset_cycle key
  // this PR should respect it for advisory-lock scope (no visible change to
  // the emitted number; just lock-key dimension). When the key is absent
  // (#947 not merged) we default to legacy `daily` lock scope.
  // ---------------------------------------------------------------------------
  describe('D1.1.2.2 composition with D1.1.2.3 reset_cycle', () => {
    it('legacy fallback: no reset_cycle key → daily lock scope, default format unchanged', async () => {
      // both keys absent — legacy behaviour
      settings.getKey.mockResolvedValue(null);
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      expect(num).toBe('EX-2605-001');
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringMatching(/^SELECT pg_advisory_xact_lock\(-?\d+\)$/),
      );
    });

    it('respects reset_cycle=yearly: different days in same year hash to same lock key', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_reset_cycle' ? 'yearly' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue(null);

      await service.next(tx, 'EXPENSE', new Date('2026-01-15T12:00:00Z'));
      const lockKey1 = tx.$executeRawUnsafe.mock.calls[0][0];
      tx.$executeRawUnsafe.mockClear();

      await service.next(tx, 'EXPENSE', new Date('2026-11-15T12:00:00Z'));
      const lockKey2 = tx.$executeRawUnsafe.mock.calls[0][0];

      expect(lockKey1).toBe(lockKey2);
    });

    it('respects reset_cycle=daily: different days hash to different lock keys', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_reset_cycle' ? 'daily' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue(null);

      await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      const lockKey1 = tx.$executeRawUnsafe.mock.calls[0][0];
      tx.$executeRawUnsafe.mockClear();

      await service.next(tx, 'EXPENSE', new Date('2026-05-11T12:00:00Z'));
      const lockKey2 = tx.$executeRawUnsafe.mock.calls[0][0];

      expect(lockKey1).not.toBe(lockKey2);
    });

    it('bad reset_cycle value falls back to legacy daily', async () => {
      settings.getKey.mockImplementation(async (k: string) =>
        k === 'doc_number_reset_cycle' ? 'WTF' : null,
      );
      tx.expenseDocument.findFirst.mockResolvedValue(null);
      const num = await service.next(tx, 'EXPENSE', new Date('2026-05-10T12:00:00Z'));
      // Format still default — bad cycle doesn't break number issuance.
      expect(num).toBe('EX-2605-001');
    });
  });
});
