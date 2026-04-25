import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OverdueTimelineService } from './timeline.service';

const mockPrisma = {
  contract: { findFirst: jest.fn() },
  callLog: { findMany: jest.fn() },
  payment: { findMany: jest.fn() },
  dunningAction: { findMany: jest.fn() },
  auditLog: { findMany: jest.fn() },
  contractLetter: { findMany: jest.fn() },
};

const emptyAll = () => {
  mockPrisma.callLog.findMany.mockResolvedValue([]);
  mockPrisma.payment.findMany.mockResolvedValue([]);
  mockPrisma.dunningAction.findMany.mockResolvedValue([]);
  mockPrisma.auditLog.findMany.mockResolvedValue([]);
  mockPrisma.contractLetter.findMany.mockResolvedValue([]);
};

describe('OverdueTimelineService', () => {
  let service: OverdueTimelineService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueTimelineService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(OverdueTimelineService);
  });

  describe('getFullTimeline', () => {
    it('throws NotFoundException when contract is missing', async () => {
      mockPrisma.contract.findFirst.mockResolvedValueOnce(null);
      emptyAll();
      await expect(service.getFullTimeline('no-such-id')).rejects.toThrow(NotFoundException);
    });

    it('returns empty array when all sources return empty', async () => {
      mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: 'c1' });
      emptyAll();
      const result = await service.getFullTimeline('c1');
      expect(result).toEqual([]);
    });

    it('merges call + payment + dunningAction events and sorts DESC by timestamp', async () => {
      mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: 'c1' });

      // call at T2 (later)
      mockPrisma.callLog.findMany.mockResolvedValueOnce([
        {
          id: 'call1',
          calledAt: new Date('2026-01-15T10:00:00Z'),
          result: 'PROMISED',
          notes: null,
          settlementDate: null,
          caller: { id: 'u1', name: 'แนน' },
        },
      ]);

      // payment at T1 (earlier)
      mockPrisma.payment.findMany.mockResolvedValueOnce([
        {
          id: 'pay1',
          updatedAt: new Date('2026-01-10T08:00:00Z'),
          amountPaid: { toNumber: () => 1500 },
          installmentNo: 3,
          paymentMethod: 'TRANSFER',
        },
      ]);

      // dunning at T3 (latest)
      mockPrisma.dunningAction.findMany.mockResolvedValueOnce([
        {
          id: 'da1',
          createdAt: new Date('2026-01-20T12:00:00Z'),
          channel: 'LINE',
          messageContent: 'แจ้งเตือนค้างชำระ',
          status: 'SENT',
          dunningRule: { name: 'เตือนงวดค้าง', channel: 'LINE' },
        },
      ]);

      mockPrisma.auditLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.contractLetter.findMany.mockResolvedValueOnce([]);

      const result = await service.getFullTimeline('c1');

      expect(result).toHaveLength(3);
      // Should be sorted DESC: dunning (T3) → call (T2) → payment (T1)
      expect(result[0].id).toBe('dunning-da1');
      expect(result[0].type).toBe('DUNNING_ACTION');
      expect(result[1].id).toBe('call-call1');
      expect(result[1].type).toBe('CALL');
      expect(result[1].title).toBe('นัดชำระ');
      expect(result[1].subtitle).toBe('แนน');
      expect(result[2].id).toBe('payment-pay1');
      expect(result[2].type).toBe('PAYMENT');
    });

    it('caps result at 100 events when total exceeds 100', async () => {
      mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: 'c1' });

      // Generate 60 call events + 60 payment events = 120 total
      // Use a base timestamp and offset by minutes to avoid invalid dates
      const baseCall = new Date('2026-01-01T10:00:00Z');
      const calls = Array.from({ length: 60 }, (_, i) => ({
        id: `call${i}`,
        calledAt: new Date(baseCall.getTime() + i * 60000),
        result: 'ANSWERED',
        notes: null,
        settlementDate: null,
        caller: { id: 'u1', name: 'ผู้โทร' },
      }));

      const basePay = new Date('2026-02-01T10:00:00Z');
      const payments = Array.from({ length: 60 }, (_, i) => ({
        id: `pay${i}`,
        updatedAt: new Date(basePay.getTime() + i * 60000),
        amountPaid: { toNumber: () => 1000 },
        installmentNo: i + 1,
        paymentMethod: null,
      }));

      mockPrisma.callLog.findMany.mockResolvedValueOnce(calls);
      mockPrisma.payment.findMany.mockResolvedValueOnce(payments);
      mockPrisma.dunningAction.findMany.mockResolvedValueOnce([]);
      mockPrisma.auditLog.findMany.mockResolvedValueOnce([]);
      mockPrisma.contractLetter.findMany.mockResolvedValueOnce([]);

      const result = await service.getFullTimeline('c1');
      expect(result).toHaveLength(100);
    });

    it('maps audit MDM events to MDM type and STATUS_CHANGE to STATUS_CHANGE type', async () => {
      mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: 'c1' });
      emptyAll();

      mockPrisma.auditLog.findMany.mockResolvedValueOnce([
        {
          id: 'a1',
          createdAt: new Date('2026-01-12T09:00:00Z'),
          action: 'MDM_LOCK_APPROVED',
          newValue: null,
          entity: 'contract',
        },
        {
          id: 'a2',
          createdAt: new Date('2026-01-11T09:00:00Z'),
          action: 'STATUS_CHANGE',
          newValue: { from: 'ACTIVE', to: 'OVERDUE' },
          entity: 'contract',
        },
      ]);

      const result = await service.getFullTimeline('c1');
      expect(result).toHaveLength(2);
      const mdmEvent = result.find((e) => e.id === 'audit-a1');
      const statusEvent = result.find((e) => e.id === 'audit-a2');
      expect(mdmEvent?.type).toBe('MDM');
      expect(mdmEvent?.title).toBe('ล็อคเครื่องแล้ว');
      expect(statusEvent?.type).toBe('STATUS_CHANGE');
      expect(statusEvent?.title).toBe('สถานะสัญญาเปลี่ยน: ACTIVE → OVERDUE');
    });

    it('maps letter events correctly with LETTER type', async () => {
      mockPrisma.contract.findFirst.mockResolvedValueOnce({ id: 'c1' });
      emptyAll();

      const dispatchedAt = new Date('2026-01-18T14:00:00Z');
      mockPrisma.contractLetter.findMany.mockResolvedValueOnce([
        {
          id: 'l1',
          createdAt: new Date('2026-01-17T10:00:00Z'),
          dispatchedAt,
          letterType: 'WARNING_1',
          letterNumber: 'LT-0001',
          trackingNumber: 'TH123456789',
          status: 'DISPATCHED',
        },
      ]);

      const result = await service.getFullTimeline('c1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('letter-l1');
      expect(result[0].type).toBe('LETTER');
      expect(result[0].timestamp).toBe(dispatchedAt.toISOString());
      expect(result[0].title).toContain('TH123456789');
    });
  });
});
