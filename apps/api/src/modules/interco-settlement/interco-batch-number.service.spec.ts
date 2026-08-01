import { Test, TestingModule } from '@nestjs/testing';
import { IntercoBatchNumberService } from './interco-batch-number.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('IntercoBatchNumberService', () => {
  let service: IntercoBatchNumberService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      interCoSettlementBatch: { findFirst: jest.fn() },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [IntercoBatchNumberService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(IntercoBatchNumberService);
  });

  it('generates first batch number for the day (IC-YYYYMMDD-0001)', async () => {
    prisma.interCoSettlementBatch.findFirst.mockResolvedValue(null);
    // 2026-05-19T05:30:00Z = 2026-05-19 12:30 BKK → 20260519
    const n = await service.next(prisma, new Date('2026-05-19T05:30:00Z'));
    expect(n).toBe('IC-20260519-0001');
  });

  it('increments sequence within the same BKK day', async () => {
    prisma.interCoSettlementBatch.findFirst.mockResolvedValue({ batchNumber: 'IC-20260519-0007' });
    const n = await service.next(prisma, new Date('2026-05-19T05:30:00Z'));
    expect(n).toBe('IC-20260519-0008');
  });

  it('resets to 0001 on the next BKK day', async () => {
    prisma.interCoSettlementBatch.findFirst.mockResolvedValue(null);
    const n = await service.next(prisma, new Date('2026-05-20T05:30:00Z'));
    expect(n).toBe('IC-20260520-0001');
  });

  it('BKK-day rollover boundary: 16:59:59Z (=23:59:59 BKK) stays on the earlier day, 17:00:00Z (=00:00:00 BKK) rolls to the next', async () => {
    prisma.interCoSettlementBatch.findFirst.mockResolvedValue(null);
    const before = await service.next(prisma, new Date('2026-05-19T16:59:59Z'));
    expect(before).toBe('IC-20260519-0001');
    const after = await service.next(prisma, new Date('2026-05-19T17:00:00Z'));
    expect(after).toBe('IC-20260520-0001');
  });

  it('acquires a BKK-day advisory lock before reading the sequence', async () => {
    prisma.interCoSettlementBatch.findFirst.mockResolvedValue(null);
    await service.next(prisma, new Date('2026-05-19T05:30:00Z'));
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
    );
  });

  it('pads sequence to 4 digits and queries with the correct day prefix', async () => {
    prisma.interCoSettlementBatch.findFirst.mockResolvedValue({ batchNumber: 'IC-20260519-0099' });
    const n = await service.next(prisma, new Date('2026-05-19T05:30:00Z'));
    expect(n).toBe('IC-20260519-0100');

    const findArgs = prisma.interCoSettlementBatch.findFirst.mock.calls[0][0];
    expect(findArgs.where.batchNumber.startsWith).toBe('IC-20260519-');
    expect(findArgs.orderBy.batchNumber).toBe('desc');
  });

  it('defaults to `new Date()` when no issueDate is passed', async () => {
    prisma.interCoSettlementBatch.findFirst.mockResolvedValue(null);
    const n = await service.next(prisma);
    expect(n).toMatch(/^IC-\d{8}-0001$/);
  });
});
