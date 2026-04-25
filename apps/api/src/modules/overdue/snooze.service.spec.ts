import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractSnoozeService } from './snooze.service';
import { SnoozeDuration } from './dto/snooze.dto';

const mockPrisma = {
  contract: {
    findFirst: jest.fn(),
  },
  contractSnooze: {
    updateMany: jest.fn(),
    create: jest.fn(),
  },
};

describe('ContractSnoozeService', () => {
  let service: ContractSnoozeService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.contract.findFirst.mockResolvedValue({ id: 'contract-1' });
    mockPrisma.contractSnooze.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.contractSnooze.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'snooze-1', ...args.data }),
    );

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ContractSnoozeService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = mod.get(ContractSnoozeService);
  });

  describe('snooze (create)', () => {
    it('throws NotFoundException when contract missing or soft-deleted', async () => {
      mockPrisma.contract.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.snooze('missing', 'user-1', { duration: SnoozeDuration.ONE_HOUR }),
      ).rejects.toThrow(NotFoundException);
    });

    it('1h preset → snoozedUntil ~1h in future', async () => {
      const before = Date.now();
      await service.snooze('contract-1', 'user-1', { duration: SnoozeDuration.ONE_HOUR });
      const after = Date.now();

      const created = mockPrisma.contractSnooze.create.mock.calls[0][0].data;
      const ms = (created.snoozedUntil as Date).getTime();
      expect(ms).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 100);
      expect(ms).toBeLessThanOrEqual(after + 60 * 60 * 1000 + 100);
    });

    it('2h preset → snoozedUntil ~2h in future', async () => {
      const before = Date.now();
      await service.snooze('contract-1', 'user-1', { duration: SnoozeDuration.TWO_HOURS });

      const created = mockPrisma.contractSnooze.create.mock.calls[0][0].data;
      const ms = (created.snoozedUntil as Date).getTime();
      expect(ms).toBeGreaterThanOrEqual(before + 2 * 60 * 60 * 1000 - 100);
    });

    it('tomorrow 09:00 preset → next-day 09:00 Asia/Bangkok', async () => {
      await service.snooze('contract-1', 'user-1', {
        duration: SnoozeDuration.TOMORROW_9AM,
      });
      const created = mockPrisma.contractSnooze.create.mock.calls[0][0].data;
      const dt = created.snoozedUntil as Date;
      // Bangkok 09:00 = UTC 02:00. Verify hour falls on UTC 02 (with ±1h
      // tolerance for DST / fractional UTC offsets — Asia/Bangkok is fixed +7
      // so this is exact, but keep cushion for test timing edge cases).
      expect(dt.getUTCHours()).toBe(2);
      expect(dt.getTime()).toBeGreaterThan(Date.now());
    });

    it('next_week preset → ~7 days in future', async () => {
      const before = Date.now();
      await service.snooze('contract-1', 'user-1', { duration: SnoozeDuration.NEXT_WEEK });
      const created = mockPrisma.contractSnooze.create.mock.calls[0][0].data;
      const ms = (created.snoozedUntil as Date).getTime();
      // 7 days ± a few hours (depending on rounding to start-of-day)
      expect(ms).toBeGreaterThanOrEqual(before + 6 * 86400 * 1000);
      expect(ms).toBeLessThanOrEqual(before + 8 * 86400 * 1000);
    });

    it('CUSTOM with future ISO string is honored', async () => {
      const future = new Date(Date.now() + 3 * 86400000).toISOString();
      await service.snooze('contract-1', 'user-1', {
        duration: SnoozeDuration.CUSTOM,
        snoozedUntil: future,
      });
      const created = mockPrisma.contractSnooze.create.mock.calls[0][0].data;
      expect((created.snoozedUntil as Date).toISOString()).toBe(future);
    });

    it('CUSTOM rejects past datetime', async () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      await expect(
        service.snooze('contract-1', 'user-1', {
          duration: SnoozeDuration.CUSTOM,
          snoozedUntil: past,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('CUSTOM without snoozedUntil throws BadRequest', async () => {
      await expect(
        service.snooze('contract-1', 'user-1', { duration: SnoozeDuration.CUSTOM }),
      ).rejects.toThrow(BadRequestException);
    });

    it('replaces any active snooze for same (contract, user) atomically', async () => {
      await service.snooze('contract-1', 'user-1', { duration: SnoozeDuration.ONE_HOUR });

      // Soft-delete sweep on prior actives must run before insert.
      expect(mockPrisma.contractSnooze.updateMany).toHaveBeenCalledWith({
        where: {
          contractId: 'contract-1',
          userId: 'user-1',
          deletedAt: null,
        },
        data: { deletedAt: expect.any(Date) },
      });
      const updateOrder =
        mockPrisma.contractSnooze.updateMany.mock.invocationCallOrder[0];
      const createOrder = mockPrisma.contractSnooze.create.mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(createOrder);
    });

    it('persists reason when supplied', async () => {
      await service.snooze('contract-1', 'user-1', {
        duration: SnoozeDuration.ONE_HOUR,
        reason: 'รอลูกค้าโทรกลับ',
      });
      const created = mockPrisma.contractSnooze.create.mock.calls[0][0].data;
      expect(created.reason).toBe('รอลูกค้าโทรกลับ');
    });
  });

  describe('unsnooze (delete)', () => {
    it('soft-deletes all active snoozes for (contract, user) and returns count', async () => {
      mockPrisma.contractSnooze.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.unsnooze('contract-1', 'user-1');

      expect(mockPrisma.contractSnooze.updateMany).toHaveBeenCalledWith({
        where: {
          contractId: 'contract-1',
          userId: 'user-1',
          deletedAt: null,
        },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result).toEqual({ unsnoozed: 1 });
    });

    it('returns unsnoozed:0 when no active snooze exists (idempotent)', async () => {
      mockPrisma.contractSnooze.updateMany.mockResolvedValueOnce({ count: 0 });
      const result = await service.unsnooze('contract-1', 'user-1');
      expect(result).toEqual({ unsnoozed: 0 });
    });
  });
});
