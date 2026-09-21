import { Test, TestingModule } from '@nestjs/testing';
import { DeviceReturnNumberService } from './device-return-number.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DeviceReturnNumberService', () => {
  let service: DeviceReturnNumberService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      deviceReturn: { findFirst: jest.fn() },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [DeviceReturnNumberService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(DeviceReturnNumberService);
  });

  it('generates first doc number for the day (DR-YYYYMMDD-0001)', async () => {
    prisma.deviceReturn.findFirst.mockResolvedValue(null);
    // 2026-09-20T05:30:00Z = 2026-09-20 12:30 BKK → 20260920
    expect(await service.next(prisma, new Date('2026-09-20T05:30:00Z'))).toBe('DR-20260920-0001');
  });

  it('increments sequence within the same BKK day', async () => {
    prisma.deviceReturn.findFirst.mockResolvedValue({ docNumber: 'DR-20260920-0007' });
    expect(await service.next(prisma, new Date('2026-09-20T05:30:00Z'))).toBe('DR-20260920-0008');
  });

  it('BKK-day rollover boundary: 16:59:59Z stays on the earlier day, 17:00:00Z rolls to the next', async () => {
    prisma.deviceReturn.findFirst.mockResolvedValue(null);
    expect(await service.next(prisma, new Date('2026-09-20T16:59:59Z'))).toBe('DR-20260920-0001');
    expect(await service.next(prisma, new Date('2026-09-20T17:00:00Z'))).toBe('DR-20260921-0001');
  });

  it('acquires a BKK-day advisory lock before reading the sequence and queries by day prefix desc', async () => {
    prisma.deviceReturn.findFirst.mockResolvedValue({ docNumber: 'DR-20260920-0099' });
    expect(await service.next(prisma, new Date('2026-09-20T05:30:00Z'))).toBe('DR-20260920-0100');
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
    );
    const findArgs = prisma.deviceReturn.findFirst.mock.calls[0][0];
    expect(findArgs.where.docNumber.startsWith).toBe('DR-20260920-');
    expect(findArgs.orderBy.docNumber).toBe('desc');
    expect(findArgs.where).not.toHaveProperty('deletedAt');
    expect(prisma.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.deviceReturn.findFirst.mock.invocationCallOrder[0],
    );
  });

  it('defaults to `new Date()` when no issueDate is passed', async () => {
    prisma.deviceReturn.findFirst.mockResolvedValue(null);
    jest.useFakeTimers().setSystemTime(new Date('2026-09-20T17:00:00Z'));
    try {
      expect(await service.next(prisma)).toBe('DR-20260921-0001');
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses the same lock within a BKK day and a different lock after midnight', async () => {
    prisma.deviceReturn.findFirst.mockResolvedValue(null);
    await service.next(prisma, new Date('2026-09-20T05:30:00Z'));
    await service.next(prisma, new Date('2026-09-20T16:59:59Z'));
    await service.next(prisma, new Date('2026-09-20T17:00:00Z'));
    const calls = prisma.$executeRawUnsafe.mock.calls;
    expect(calls[0][0]).toBe(calls[1][0]);
    expect(calls[2][0]).not.toBe(calls[1][0]);
  });

  it('does not read the sequence when the transaction lock fails', async () => {
    const error = new Error('lock failed');
    prisma.$executeRawUnsafe.mockRejectedValue(error);
    await expect(service.next(prisma, new Date('2026-09-20T05:30:00Z'))).rejects.toBe(error);
    expect(prisma.deviceReturn.findFirst).not.toHaveBeenCalled();
  });
});
