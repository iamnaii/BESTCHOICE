import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerInsightsService } from './customer-insights.service';

const mockPrisma = {
  customer: {
    findFirst: jest.fn(),
  },
  callLog: {
    findMany: jest.fn(),
  },
  dunningAction: {
    findMany: jest.fn(),
  },
  chatRoom: {
    findFirst: jest.fn(),
  },
};

describe('CustomerInsightsService', () => {
  let service: CustomerInsightsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    mockPrisma.callLog.findMany.mockResolvedValue([]);
    mockPrisma.dunningAction.findMany.mockResolvedValue([]);
    mockPrisma.chatRoom.findFirst.mockResolvedValue(null);

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerInsightsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = mod.get(CustomerInsightsService);
  });

  describe('getInsights', () => {
    it('returns null preferred fields when no data', async () => {
      const res = await service.getInsights('cust-1');
      expect(res.preferredContactTime).toBeNull();
      expect(res.preferredChannel).toBeNull();
      expect(res.channelResponseRates).toEqual({});
      expect(res.lineOnlineAt).toBeNull();
    });

    it('hour 6-12 (Bangkok) → MORNING bucket', async () => {
      // 09:00 Bangkok = 02:00 UTC
      const ans = (h: number) => ({
        callResult: 'ANSWERED',
        calledAt: new Date(Date.UTC(2026, 3, 25, h - 7, 0)),
      });
      mockPrisma.callLog.findMany.mockResolvedValueOnce([ans(9), ans(10), ans(11)]);
      const res = await service.getInsights('cust-1');
      expect(res.preferredContactTime).toBe('MORNING');
    });

    it('hour 12-18 → AFTERNOON bucket wins on tie-break majority', async () => {
      const ans = (h: number) => ({
        callResult: 'ANSWERED',
        calledAt: new Date(Date.UTC(2026, 3, 25, h - 7, 0)),
      });
      mockPrisma.callLog.findMany.mockResolvedValueOnce([
        ans(13), ans(14), ans(15), ans(16),
        ans(9),
      ]);
      const res = await service.getInsights('cust-1');
      expect(res.preferredContactTime).toBe('AFTERNOON');
    });

    it('hour 18-24 → EVENING bucket', async () => {
      const ans = (h: number) => ({
        callResult: 'ANSWERED',
        calledAt: new Date(Date.UTC(2026, 3, 25, h - 7, 0)),
      });
      mockPrisma.callLog.findMany.mockResolvedValueOnce([ans(19), ans(20), ans(21)]);
      const res = await service.getInsights('cust-1');
      expect(res.preferredContactTime).toBe('EVENING');
    });

    it('only ANSWERED counts toward preferred time bucket', async () => {
      mockPrisma.callLog.findMany.mockResolvedValueOnce([
        { callResult: 'NO_ANSWER', calledAt: new Date(Date.UTC(2026, 3, 25, 2, 0)) }, // 09:00 BKK
        { callResult: 'NO_ANSWER', calledAt: new Date(Date.UTC(2026, 3, 25, 2, 0)) },
      ]);
      const res = await service.getInsights('cust-1');
      expect(res.preferredContactTime).toBeNull();
    });

    it('computes channel response rates from DunningAction', async () => {
      mockPrisma.dunningAction.findMany.mockResolvedValueOnce([
        { channel: 'LINE', status: 'DELIVERED' },
        { channel: 'LINE', status: 'DELIVERED' },
        { channel: 'LINE', status: 'SENT' },
        { channel: 'LINE', status: 'FAILED' },
        { channel: 'SMS', status: 'DELIVERED' },
        { channel: 'SMS', status: 'FAILED' },
      ]);
      const res = await service.getInsights('cust-1');
      // LINE: 2 delivered / 4 total = 50%
      expect(res.channelResponseRates.LINE).toBe(50);
      expect(res.channelResponseRates.SMS).toBe(50);
      expect(res.preferredChannel).toBe('LINE'); // higher absolute count of delivered
    });

    it('CALL_TASK channel maps to CALL in response rates', async () => {
      mockPrisma.dunningAction.findMany.mockResolvedValueOnce([
        { channel: 'CALL_TASK', status: 'DELIVERED' },
        { channel: 'CALL_TASK', status: 'DELIVERED' },
      ]);
      const res = await service.getInsights('cust-1');
      expect(res.channelResponseRates.CALL).toBe(100);
      expect(res.preferredChannel).toBe('CALL');
    });

    it('returns lineOnlineAt from latest ChatRoom.lastMessageAt when present', async () => {
      const ts = new Date('2026-04-25T03:00:00Z');
      mockPrisma.chatRoom.findFirst.mockResolvedValueOnce({
        lastMessageAt: ts,
      });
      const res = await service.getInsights('cust-1');
      expect(res.lineOnlineAt).toEqual(ts);
    });

    it('throws when customer not found', async () => {
      mockPrisma.customer.findFirst.mockResolvedValueOnce(null);
      await expect(service.getInsights('missing')).rejects.toThrow(/ลูกค้า/);
    });
  });
});
