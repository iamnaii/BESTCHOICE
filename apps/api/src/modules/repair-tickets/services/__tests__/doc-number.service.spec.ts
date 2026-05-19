import { Test, TestingModule } from '@nestjs/testing';
import { RepairTicketDocNumberService } from '../doc-number.service';
import { PrismaService } from '../../../../prisma/prisma.service';

describe('RepairTicketDocNumberService', () => {
  let service: RepairTicketDocNumberService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      repairTicket: { findFirst: jest.fn() },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        RepairTicketDocNumberService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(RepairTicketDocNumberService);
  });

  it('generates first ticket number for the day (RT-YYYYMMDD-0001)', async () => {
    prisma.repairTicket.findFirst.mockResolvedValue(null);
    // 2026-05-19T05:30:00Z = 2026-05-19 12:30 BKK → 20260519
    const n = await service.nextTicketNumber(prisma, new Date('2026-05-19T05:30:00Z'));
    expect(n).toBe('RT-20260519-0001');
  });

  it('increments sequence within the same BKK day', async () => {
    prisma.repairTicket.findFirst.mockResolvedValue({ ticketNumber: 'RT-20260519-0007' });
    const n = await service.nextTicketNumber(prisma, new Date('2026-05-19T05:30:00Z'));
    expect(n).toBe('RT-20260519-0008');
  });

  it('resets to 0001 on next BKK day', async () => {
    prisma.repairTicket.findFirst.mockResolvedValue(null);
    const n = await service.nextTicketNumber(prisma, new Date('2026-05-20T05:30:00Z'));
    expect(n).toBe('RT-20260520-0001');
  });

  it('acquires advisory lock per BKK day', async () => {
    prisma.repairTicket.findFirst.mockResolvedValue(null);
    await service.nextTicketNumber(prisma, new Date('2026-05-19T05:30:00Z'));
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
    );
  });

  it('pads sequence to 4 digits', async () => {
    prisma.repairTicket.findFirst.mockResolvedValue({ ticketNumber: 'RT-20260519-0099' });
    const n = await service.nextTicketNumber(prisma, new Date('2026-05-19T05:30:00Z'));
    expect(n).toBe('RT-20260519-0100');
  });
});
