import { Test, TestingModule } from '@nestjs/testing';
import { BrokenPromiseFinanceCron } from './broken-promise-finance.cron';
import { PrismaService } from '../../../prisma/prisma.service';

describe('BrokenPromiseFinanceCron', () => {
  let cron: BrokenPromiseFinanceCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = { $executeRaw: jest.fn().mockResolvedValue(7) };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        BrokenPromiseFinanceCron,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    cron = mod.get(BrokenPromiseFinanceCron);
  });

  it('marks broken promises and returns the affected count', async () => {
    const result = await cron.handleCron();
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(result).toBe(7);
  });
});
