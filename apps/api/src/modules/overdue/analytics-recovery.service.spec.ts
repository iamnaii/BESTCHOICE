import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsRecoveryService } from './analytics-recovery.service';

const mockPrisma = {
  $queryRawUnsafe: jest.fn(),
};

describe('AnalyticsRecoveryService', () => {
  let service: AnalyticsRecoveryService;
  const from = new Date('2026-04-01T00:00:00Z');
  const to = new Date('2026-04-30T23:59:59Z');

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsRecoveryService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(AnalyticsRecoveryService);
  });

  it('returns 4 zero rows when no actions in range', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    const result = await service.getRecoveryByChannel({ from, to });
    expect(result).toHaveLength(4);
    expect(result.map((r) => r.channel)).toEqual([
      'LINE',
      'SMS',
      'CALL',
      'INTERNAL_ALERT',
    ]);
    expect(result.every((r) => r.actionsSent === 0 && r.recovered === 0)).toBe(true);
  });

  it('computes recovery rate when payment is within 7 days', async () => {
    // 10 LINE actions, 4 followed by payment within 7 days, avg paid = 2500
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        channel: 'LINE',
        actions_sent: BigInt(10),
        recovered: BigInt(4),
        recovered_amount: '2500',
      },
    ]);
    const result = await service.getRecoveryByChannel({ from, to });
    const line = result.find((r) => r.channel === 'LINE')!;
    expect(line.actionsSent).toBe(10);
    expect(line.recovered).toBe(4);
    expect(line.recoveryRate).toBe(40); // 4/10 * 100
    expect(line.avgRecoveryAmount).toBe(2500);
  });

  it('returns recoveryRate=0 and avg=0 when no recovery within window', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        channel: 'SMS',
        actions_sent: BigInt(5),
        recovered: BigInt(0),
        recovered_amount: 0,
      },
    ]);
    const result = await service.getRecoveryByChannel({ from, to });
    const sms = result.find((r) => r.channel === 'SMS')!;
    expect(sms.actionsSent).toBe(5);
    expect(sms.recovered).toBe(0);
    expect(sms.recoveryRate).toBe(0);
    expect(sms.avgRecoveryAmount).toBe(0);
  });

  it('aggregates multiple channels and maps CALL_TASK -> CALL', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        channel: 'LINE',
        actions_sent: BigInt(20),
        recovered: BigInt(10),
        recovered_amount: '3000',
      },
      {
        channel: 'CALL_TASK',
        actions_sent: BigInt(8),
        recovered: BigInt(6),
        recovered_amount: '5500',
      },
      {
        channel: 'SMS',
        actions_sent: BigInt(15),
        recovered: BigInt(3),
        recovered_amount: '1800',
      },
    ]);
    const result = await service.getRecoveryByChannel({ from, to });
    expect(result.find((r) => r.channel === 'LINE')).toMatchObject({
      actionsSent: 20,
      recovered: 10,
      recoveryRate: 50,
      avgRecoveryAmount: 3000,
    });
    expect(result.find((r) => r.channel === 'CALL')).toMatchObject({
      actionsSent: 8,
      recovered: 6,
      recoveryRate: 75,
      avgRecoveryAmount: 5500,
    });
    expect(result.find((r) => r.channel === 'SMS')).toMatchObject({
      actionsSent: 15,
      recovered: 3,
      recoveryRate: 20,
      avgRecoveryAmount: 1800,
    });
    // INTERNAL_ALERT untouched
    expect(result.find((r) => r.channel === 'INTERNAL_ALERT')).toMatchObject({
      actionsSent: 0,
      recovered: 0,
    });
  });

  it('ignores unknown channel values gracefully', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        channel: 'EMAIL', // not in enum
        actions_sent: BigInt(3),
        recovered: BigInt(1),
        recovered_amount: '999',
      },
    ]);
    const result = await service.getRecoveryByChannel({ from, to });
    expect(result.every((r) => r.actionsSent === 0)).toBe(true);
  });

  it('returns zero rows on DB error (no throw)', async () => {
    mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error('boom'));
    const result = await service.getRecoveryByChannel({ from, to });
    expect(result).toHaveLength(4);
    expect(result.every((r) => r.actionsSent === 0)).toBe(true);
  });

  it('passes from and to params to the query', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    await service.getRecoveryByChannel({ from, to });
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.any(String),
      from,
      to,
    );
  });
});
