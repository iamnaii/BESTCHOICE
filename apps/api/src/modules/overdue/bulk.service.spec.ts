import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MdmLockService } from './mdm-lock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OverdueBulkService } from './bulk.service';

const mockPrisma = {
  contract: {
    updateMany: jest.fn(),
    findMany: jest.fn(),
  },
  auditLog: { createMany: jest.fn() },
  dunningRule: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};

const mockMdmLock = {
  proposeManual: jest.fn(),
};

const mockNotifications = {
  send: jest.fn(),
};

describe('OverdueBulkService', () => {
  let service: OverdueBulkService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverdueBulkService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MdmLockService, useValue: mockMdmLock },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(OverdueBulkService);

    // Default: auditLog.createMany resolves to a benign value so bulkSendLine
    // audit-trail writes don't blow up in tests that don't assert on them.
    mockPrisma.auditLog.createMany.mockResolvedValue({ count: 0 });
  });

  describe('bulkAssign', () => {
    it('updates contracts and creates audit logs atomically via $transaction', async () => {
      const contractIds = ['c1', 'c2', 'c3'];
      mockPrisma.contract.updateMany.mockReturnValueOnce({ count: 3 });
      mockPrisma.auditLog.createMany.mockReturnValueOnce({ count: 3 });
      mockPrisma.$transaction.mockResolvedValueOnce([{ count: 3 }, { count: 3 }]);

      const result = await service.bulkAssign(
        { contractIds, assignedToId: 'user-99' },
        'actor-1',
      );

      expect(result).toEqual({ updated: 3, requested: 3 });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

      const updateArg = mockPrisma.contract.updateMany.mock.calls[0][0];
      expect(updateArg.where.id.in).toEqual(contractIds);
      expect(updateArg.data.assignedToId).toBe('user-99');

      const auditArg = mockPrisma.auditLog.createMany.mock.calls[0][0];
      expect(auditArg.data).toHaveLength(3);
      expect(auditArg.data[0].action).toBe('BULK_ASSIGN');
      expect(auditArg.data[0].userId).toBe('actor-1');
    });
  });

  describe('bulkProposeLock', () => {
    it('returns partial success when some proposeManual calls fail', async () => {
      mockMdmLock.proposeManual
        .mockResolvedValueOnce({ id: 'r1' })
        .mockRejectedValueOnce(new Error('device missing'))
        .mockResolvedValueOnce({ id: 'r3' });

      const result = await service.bulkProposeLock(
        { contractIds: ['c1', 'c2', 'c3'], reason: 'ลูกค้าไม่ตอบสนอง' },
        'actor-1',
      );

      expect(result).toEqual({
        proposed: 2,
        failed: 1,
        requested: 3,
        // Z8: created MdmLockRequest ids surfaced for FE undo (DELETE one as
        // representative reverse — the FE picks the first to undo).
        requestIds: ['r1', 'r3'],
      });
    });

    it('returns all proposed when all calls succeed', async () => {
      mockMdmLock.proposeManual.mockResolvedValue({ id: 'r1' });

      const result = await service.bulkProposeLock(
        { contractIds: ['c1', 'c2'], reason: 'ลูกค้าไม่รับสาย 3 วัน' },
        'actor-1',
      );

      expect(result).toEqual({
        proposed: 2,
        failed: 0,
        requested: 2,
        // Same id appears twice because the mock returns the same value on
        // every call — production proposeManual returns distinct ids.
        requestIds: ['r1', 'r1'],
      });
    });
  });

  describe('bulkSendLine', () => {
    it('throws BadRequestException when neither templateId nor customMessage provided', async () => {
      await expect(
        service.bulkSendLine({ contractIds: ['c1'] }, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('counts contracts without lineId as failed', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          contractNumber: 'BC-001',
          customer: { lineIdFinance: null, phone: '0812345678', name: 'ลูกค้า 1' },
        },
        {
          id: 'c2',
          contractNumber: 'BC-002',
          customer: { lineIdFinance: 'U123', phone: '0812345679', name: 'ลูกค้า 2' },
        },
      ]);
      mockNotifications.send.mockResolvedValueOnce({ id: 'n1', status: 'SENT' });

      const result = await service.bulkSendLine(
        { contractIds: ['c1', 'c2'], customMessage: 'กรุณาชำระเงินค้างชำระ' },
        'actor-1',
      );

      expect(result).toEqual({ sent: 1, failed: 1, total: 2 });
      expect(mockNotifications.send).toHaveBeenCalledTimes(1);
    });

    it('uses customMessage verbatim when provided', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          contractNumber: 'BC-001',
          customer: { lineIdFinance: 'U999', phone: '0899999999', name: 'ทดสอบ' },
        },
      ]);
      mockNotifications.send.mockResolvedValueOnce({ id: 'n1', status: 'SENT' });

      await service.bulkSendLine(
        { contractIds: ['c1'], customMessage: 'ข้อความทดสอบ 10 ตัวอักษร' },
        'actor-1',
      );

      const sendArg = mockNotifications.send.mock.calls[0][0];
      expect(sendArg.message).toBe('ข้อความทดสอบ 10 ตัวอักษร');
      expect(sendArg.recipient).toBe('U999');
      expect(sendArg.channel).toBe('LINE');
    });

    it('renders templateId message with customerName and contractNumber vars', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          contractNumber: 'BC-2026-001',
          customer: { lineIdFinance: 'U777', phone: '0811111111', name: 'สมชาย ใจดี' },
        },
      ]);
      mockPrisma.dunningRule.findUnique.mockResolvedValueOnce({
        id: 'rule-1',
        messageTemplate: 'เรียน {{customerName}} สัญญา {{contractNumber}} มียอดค้างชำระ',
      });
      mockNotifications.send.mockResolvedValueOnce({ id: 'n1', status: 'SENT' });

      const result = await service.bulkSendLine(
        { contractIds: ['c1'], templateId: 'rule-1' },
        'actor-1',
      );

      expect(result.sent).toBe(1);
      const sendArg = mockNotifications.send.mock.calls[0][0];
      expect(sendArg.message).toBe('เรียน สมชาย ใจดี สัญญา BC-2026-001 มียอดค้างชำระ');
    });

    it('throws BadRequestException when templateId does not exist', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          contractNumber: 'BC-001',
          customer: { lineIdFinance: 'U111', phone: '0800000000', name: 'ลูกค้า' },
        },
      ]);
      mockPrisma.dunningRule.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.bulkSendLine({ contractIds: ['c1'], templateId: 'no-such-template' }, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('counts notification send failures as failed (does not throw)', async () => {
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          contractNumber: 'BC-001',
          customer: { lineIdFinance: 'U100', phone: '0800000001', name: 'ผู้ทดสอบ' },
        },
        {
          id: 'c2',
          contractNumber: 'BC-002',
          customer: { lineIdFinance: 'U200', phone: '0800000002', name: 'ผู้ทดสอบ 2' },
        },
      ]);
      mockNotifications.send
        .mockRejectedValueOnce(new Error('LINE API down'))
        .mockResolvedValueOnce({ id: 'n2', status: 'SENT' });

      const result = await service.bulkSendLine(
        { contractIds: ['c1', 'c2'], customMessage: 'ข้อความทดสอบสำหรับการส่ง' },
        'actor-1',
      );

      expect(result).toEqual({ sent: 1, failed: 1, total: 2 });
    });
  });
});
